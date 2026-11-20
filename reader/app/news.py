"""OSHA regulatory news: fetchers for the Federal Register API v1 and the DOL Open Data
API v4, plus citation normalisation and the fixed takeaway bullets.

Fetchers are pure I/O + mapping: they return plain dicts in the one item shape
(`empty_item()`), never touch the database, and surface every failure as
`SourceUnavailable`. The worker (`news_worker.py`) enriches items (`enrich_item`) and
stores them (`news_store.py`).

No scraping: every request goes to a documented JSON API with the honest FRAMEWORK
User-Agent. osha.gov is only ever opened by the user's own browser.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import date, datetime, timedelta
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx

from . import config
# Reuse the canonical CFR citation grammar instead of duplicating regexes.
from .citations.parser import (
    CROSS_TITLE_EXT_RE,
    CROSS_TITLE_PARTS_RE,
    CROSS_TITLE_RE,
    PART_NUM,
    SECTION_ITEM_RE,
    XREF_RE,
)

# The Federal Register plumbing is shared with the corpus builder (fr_build.py).
from . import fr_client
from .fr_client import (FR_BASE, USER_AGENT, SourceUnavailable,  # noqa: F401  (re-exported)
                        client, fetch_fr_body, sanitize_fr_html)
from .fr_client import FrSanitizer as _FrSanitizer  # noqa: F401
from .fr_client import DOC_NUM_RE as _FR_DOC_NUM_RE  # noqa: F401
from .fr_client import is_fr_host as _is_fr_host  # noqa: F401
from .fr_client import get_json as _get_json

DOL_BASE = "https://apiprod.dol.gov/v4"

FR_FIELDS = fr_client.NEWS_FIELDS
FR_TYPE_TO_CATEGORY = {"Rule": "rules", "Proposed Rule": "rulemaking",
                       "Notice": "notices", "Presidential Document": "notices"}

FR_PER_PAGE = 200
FR_MAX_PAGES = 10

VIOL_TYPE_LABELS = {"W": "Willful", "R": "Repeat", "S": "Serious", "O": "Other-than-Serious",
                    "U": "Unclassified"}
INSP_TYPE_LABELS = {"A": "Accident investigation", "B": "Complaint inspection",
                    "C": "Referral inspection", "F": "Follow-up inspection",
                    "H": "Planned inspection", "M": "Fatality/catastrophe investigation"}
SAFETY_HLTH_LABELS = {"S": "Safety", "H": "Health", "B": "Safety & Health"}
INSP_SCOPE_LABELS = {"A": "Complete", "B": "Partial", "C": "Records only", "D": "No inspection"}
OWNER_TYPE_LABELS = {"A": "Private sector", "B": "Local government", "C": "State government", "D": "Federal agency"}
UNION_STATUS_LABELS = {"A": "Unionized", "B": "Non-union", "N": "Not specified"}
VIOL_EVENT_LABELS = {"I": "Issued", "C": "Contested", "F": "Final order", "M": "Modified",
                     "S": "Informal settlement", "D": "Deleted", "P": "Penalty modified", "A": "Abated"}
REL_TYPE_LABELS = {
    **INSP_TYPE_LABELS,
    "A": "Accident",
    "B": "Complaint",
    "C": "Referral / Complaint",
    "D": "Unprogrammed related",
    "F": "Follow-up",
    "H": "Planned",
    "I": "Companion inspection",
    "M": "Fatality / catastrophe",
    "R": "Related inspection",
    "FTA": "Failure-to-Abate follow-up",
}

DOL_MIN_INTERVAL_SEC = 0.35
DOL_COOLDOWN_SEC = 60.0
_dol_rate_lock = threading.Lock()
_dol_last_call = 0.0
_dol_cooldown_until = 0.0


def reset_dol_rate_state() -> None:
    """Reset the shared DOL rate-pacer, 429 cooldown, and search TTL cache (used in tests)."""
    global _dol_last_call, _dol_cooldown_until
    with _dol_rate_lock:
        _dol_last_call = 0.0
        _dol_cooldown_until = 0.0
    _dol_search_cache.clear()


HAZSUB_LABELS = {
    "0150": "Arsenic",
    "0210": "Asbestos",
    "0320": "Benzene",
    "0430": "Beryllium",
    "0480": "Cadmium",
    "0660": "Carbon monoxide",
    "0730": "Chlorine",
    "0780": "Chromium (hexavalent)",
    "0910": "Coal tar pitch volatiles",
    "1010": "Copper",
    "1050": "Cotton dust",
    "1220": "Ethylene oxide",
    "1300": "Formaldehyde",
    "1490": "Hydrogen sulfide",
    "1540": "Isocyanates",
    "1590": "Lead",
    "1660": "Manganese",
    "1720": "Mercury",
    "1790": "Methylene chloride",
    "1950": "Nickel",
    "2050": "Noise",
    "2240": "Silica (crystalline)",
    "2390": "Styrene",
    "2460": "Sulfur dioxide",
    "2530": "Toluene",
    "2580": "Trichloroethylene",
    "2640": "Vinyl chloride",
    "2690": "Welding fumes",
    "2730": "Wood dust",
    "9010": "Silica (respirable)",
}

DOL_SEARCH_TTL_SEC = 600.0
DOL_SEARCH_CACHE_MAX = 64
_dol_search_cache: dict[tuple, tuple[float, dict]] = {}


def hazsub_label(code: str | None) -> str:
    c = (code or "").strip().zfill(4) if (code or "").strip().isdigit() else (code or "").strip()
    lbl = HAZSUB_LABELS.get(c)
    return f"{lbl} ({c})" if lbl else (code or "").strip()


def cfr_to_imis_prefix(section: str) -> str:
    """'1910.147' -> '19100147'; '1910.1200' -> '19101200'."""
    s = re.sub(r"^§+\s*", "", (section or "").strip())
    if "." in s:
        p, sec = s.split(".", 1)
        sec_digits = re.match(r"\d+", sec)
        if p.isdigit() and sec_digits:
            return f"{p.zfill(4)}{sec_digits.group(0).zfill(4)}"
    return re.sub(r"\D", "", s)


def dol_cooldown_remaining() -> float:
    """Seconds remaining in an active HTTP 429 cooldown, or 0.0 if clear."""
    with _dol_rate_lock:
        rem = _dol_cooldown_until - time.monotonic()
        return round(rem, 2) if rem > 0 else 0.0


def empty_item() -> dict:
    """Every key of the item shape, so fetchers only fill what they know."""
    return {
        "guid": "", "source": "", "agency": "", "category": "", "doc_type": None,
        "title": "", "link": "", "pdf_url": None, "citation": None,
        "action": None, "effective_on": None, "comments_close_on": None,
        "scheduled_on": None, "published_at": "", "description": "",
        "docket_ids": [], "cfr_parts": [], "sections": [],
        "company": None, "city": None, "state": None, "naics": None,
        "penalty_usd": None, "violation_types": [], "general_duty": 0,
        "unmapped_standards": 0, "takeaways": [],
    }


# ---------------------------------------------------------------------------
# Federal Register: published documents and Public Inspection filings
# ---------------------------------------------------------------------------

def _fr_paginated(c: httpx.Client, base_params: list[tuple[str, str]]) -> list[dict]:
    results, _count, _urls = fr_client.paginate(c, base_params, FR_FIELDS, FR_MAX_PAGES)
    return results


def fetch_federal_register_documents(c: httpx.Client, agency: str, since: str) -> list[dict]:
    """Every document published on or after `since` (ISO date) for `agency`, following next_page_url."""
    params = [("conditions[agencies][]", agency), ("conditions[publication_date][gte]", since),
              ("order", "newest"), ("per_page", str(FR_PER_PAGE))]
    results = _fr_paginated(c, params)
    return [fr_document_item(d, agency) for d in results if d.get("document_number")]


def fetch_federal_register_by_cfr_title(c: httpx.Client, title_num: int, since: str) -> list[dict]:
    """Every document published on or after `since` (ISO date) referencing CFR `title_num`."""
    params = [("conditions[cfr][title]", str(int(title_num))), ("conditions[publication_date][gte]", since),
              ("order", "newest"), ("per_page", str(FR_PER_PAGE))]
    results = _fr_paginated(c, params)
    return [fr_document_item(d, None) for d in results if d.get("document_number")]


def _fr_agency_slug(doc: dict, fallback: str | None = None) -> str:
    if fallback:
        return fallback
    for ag in doc.get("agencies") or []:
        if isinstance(ag, dict) and ag.get("slug"):
            return str(ag["slug"]).strip()
    return "federal-register"


def fr_document_item(doc: dict, agency: str | None = None) -> dict:
    doc_type = doc.get("type") or "Notice"
    return {
        **empty_item(),
        "guid": f"fr:{doc['document_number']}",
        "source": "federal_register",
        "agency": _fr_agency_slug(doc, agency),
        "category": FR_TYPE_TO_CATEGORY.get(doc_type, "notices"),
        "doc_type": doc_type,
        "title": (doc.get("title") or "").strip(),
        "link": doc.get("html_url") or "",
        "pdf_url": doc.get("pdf_url"),
        "citation": doc.get("citation"),
        "action": doc.get("action"),
        "effective_on": doc.get("effective_on"),
        "comments_close_on": doc.get("comments_close_on"),
        "published_at": (doc.get("publication_date") or "")[:10],
        "description": (doc.get("abstract") or doc.get("dates") or "").strip(),
        "docket_ids": doc.get("docket_ids") or [],
        "cfr_parts": [{"title": int(r["title"]), "part": str(r["part"])}
                      for r in (doc.get("cfr_references") or []) if r.get("title") and r.get("part")],
    }


# Sanitizer, host guard and on-demand body fetch live in fr_client (re-exported above).


def fetch_public_inspection(c: httpx.Client, agency: str) -> list[dict]:
    results = _get_json(c, f"{FR_BASE}/public-inspection-documents.json",
                        {"conditions[agencies][]": agency}).get("results", [])
    return [pi_item(d, agency) for d in results if d.get("document_number")]


def pi_item(doc: dict, agency: str) -> dict:
    excerpt = " ".join(x for x in (doc.get("subject_1"), doc.get("subject_2"), doc.get("subject_3")) if x)
    return {
        **empty_item(),
        "guid": f"fr:{doc['document_number']}",  # same guid as the published document (no duplicates)
        "source": "federal_register_pi",
        "agency": agency,
        "category": "public_inspection",
        "doc_type": doc.get("type") or "Public Inspection",  # the type it WILL have once published
        "title": (doc.get("title") or "").strip(),
        "link": doc.get("html_url") or "",
        "pdf_url": doc.get("pdf_url"),
        "scheduled_on": doc.get("publication_date"),
        "published_at": (doc.get("filed_at") or "")[:10],
        "description": excerpt,
        "docket_ids": doc.get("docket_numbers") or [],
    }


# ---------------------------------------------------------------------------
# DOL Open Data API v4: violations first, then their inspections
# ---------------------------------------------------------------------------

def fetch_enforcement(
    c: httpx.Client,
    key: str,
    days: int,
    limit: int,
    max_inspections: int,
    today: date | None = None,
) -> list[dict]:
    """Recent violations -> group_violations -> one inspection request -> one item per
    inspection. The window arguments come from news_schedule.dol_window()."""
    groups = group_violations(fetch_dol_recent_violations(c, key, days, limit, today=today), max_inspections)
    inspections = {int(i["activity_nr"]): i for i in fetch_dol_inspections(c, key, list(groups))}
    return [build_enforcement_article(inspections[a], v) for a, v in groups.items() if a in inspections]


def fetch_dol_recent_violations(
    c: httpx.Client,
    key: str,
    days: int,
    limit: int,
    today: date | None = None,
) -> list[dict]:
    ref_day = today or datetime.now(ZoneInfo("America/New_York")).date()
    since = (ref_day - timedelta(days=days)).isoformat()
    params = {
        "limit": limit, "sort": "desc", "sort_by": "issuance_date",
        "fields": "activity_nr,citation_id,delete_flag,standard,viol_type,issuance_date,"
                  "abate_date,abate_complete,initial_penalty,current_penalty,"
                  "contest_date,final_order_date,nr_instances,nr_exposed,gravity,emphasis,hazcat,"
                  "fta_insp_nr,fta_issuance_date,fta_penalty,hazsub1,hazsub2,hazsub3,hazsub4,hazsub5",
        "filter_object": json.dumps({"field": "issuance_date", "operator": "gt", "value": since}),
    }
    return _dol_get(c, key, "violation", params)


DOL_INSP_BATCH = 50  # API Gateway / WAF rejects GET queries >~2 KB (e.g. 150-id `in` filter -> 403)


def fetch_dol_inspections(c: httpx.Client, key: str, activity_nrs: list[int]) -> list[dict]:
    if not activity_nrs:
        return []
    rows: list[dict] = []
    for i in range(0, len(activity_nrs), DOL_INSP_BATCH):
        batch = activity_nrs[i:i + DOL_INSP_BATCH]
        params = {
            "limit": len(batch),
            "fields": "activity_nr,reporting_id,state_flag,estab_name,site_address,site_city,"
                      "site_state,site_zip,owner_type,adv_notice,safety_hlth,sic_code,naics_code,"
                      "insp_type,insp_scope,why_no_insp,union_status,nr_in_estab,open_date,"
                      "case_mod_date,close_conf_date,close_case_date",
            "filter_object": json.dumps({"field": "activity_nr", "operator": "in", "value": batch}),
        }
        rows.extend(_dol_get(c, key, "inspection", params))
    return rows


def _dol_should_pace(c: httpx.Client) -> bool:
    return not isinstance(getattr(c, "_transport", None), httpx.MockTransport)


def _dol_pace(c: httpx.Client, agency: str, dataset: str) -> None:
    global _dol_last_call
    while True:
        with _dol_rate_lock:
            now = time.monotonic()
            if now < _dol_cooldown_until:
                raise SourceUnavailable(f"DOL {agency}/{dataset}: HTTP 429 (cooldown)")
            if not _dol_should_pace(c) or DOL_MIN_INTERVAL_SEC <= 0:
                _dol_last_call = now
                return
            wait = (_dol_last_call + DOL_MIN_INTERVAL_SEC) - now
            if wait <= 0:
                _dol_last_call = now
                return
        time.sleep(wait)


def _record_dol_429(headers: httpx.Headers | None = None) -> None:
    global _dol_cooldown_until
    delay = DOL_COOLDOWN_SEC
    if headers:
        raw = (headers.get("Retry-After") or "").strip()
        if raw.isdigit():
            delay = float(max(1, min(int(raw), 300)))
    with _dol_rate_lock:
        _dol_cooldown_until = max(_dol_cooldown_until, time.monotonic() + delay)


def _dol_get(
    c: httpx.Client,
    key: str,
    dataset: str,
    params: dict,
    *,
    agency: str = "OSHA",
) -> list[dict]:
    _dol_pace(c, agency, dataset)
    try:
        # DOL v4 /v4/get/* endpoints reject header-only X-API-KEY with 401; pass it in
        # query params and strip URL/request details (`from None`) so errors never leak the key.
        r = c.get(f"{DOL_BASE}/get/{agency}/{dataset}/json", params={**params, "X-API-KEY": key})
        r.raise_for_status()
        if r.status_code == 204 or not r.content.strip():
            return []
        return r.json().get("data", [])
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            _record_dol_429(e.response.headers)
        raise SourceUnavailable(f"DOL {dataset}: HTTP {e.response.status_code}") from None
    except (httpx.HTTPError, ValueError) as e:
        raise SourceUnavailable(f"DOL {dataset}: {type(e).__name__}") from None


def group_violations(rows: list[dict], max_inspections: int) -> dict[int, list[dict]]:
    """Drop deleted rows; group by activity_nr; keep the max_inspections with the newest
    issuance. max_inspections is 50 normally, 150 on a catch-up run (news_schedule.dol_window)."""
    groups: dict[int, list[dict]] = {}
    for r in rows:
        if r.get("delete_flag") or not r.get("activity_nr"):
            continue
        groups.setdefault(int(r["activity_nr"]), []).append(r)
    newest = sorted(groups, key=lambda a: max(str(v.get("issuance_date") or "") for v in groups[a]),
                    reverse=True)
    return {a: groups[a] for a in newest[:max_inspections]}


def _money(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _opt_int(v) -> int | None:
    try:
        if v is None or str(v).strip() == "":
            return None
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return None


def _iso_day(v) -> str | None:
    s = str(v or "").strip()
    return s[:10] if len(s) >= 10 else (s or None)


def _norm_violation_row(v: dict) -> dict:
    raw_std = (v.get("standard") or "").strip()
    parsed = parse_dol_standard(raw_std)
    vt = (v.get("viol_type") or "").strip().upper()
    init_p = _money(v.get("initial_penalty")) if v.get("initial_penalty") not in (None, "") else 0.0
    cur_raw = v.get("current_penalty")
    cur_p = _money(cur_raw) if cur_raw not in (None, "") else init_p
    fta_p = _money(v.get("fta_penalty")) if v.get("fta_penalty") not in (None, "") else 0.0
    hazsubs = [str(v.get(k)).strip() for k in ("hazsub1", "hazsub2", "hazsub3", "hazsub4", "hazsub5")
               if v.get(k) not in (None, "", "0")]
    return {
        "citation_id": str(v.get("citation_id") or "").strip(),
        "raw_standard": raw_std,
        "section_id": parsed["section"],
        "para": parsed["para"],
        "standard_display": parsed["display"],
        "is_general_duty": parsed["is_general_duty"],
        "is_state_plan": parsed["is_state_plan"],
        "viol_type": vt,
        "viol_label": VIOL_TYPE_LABELS.get(vt, vt or "Unknown"),
        "issuance_date": _iso_day(v.get("issuance_date")),
        "abate_date": _iso_day(v.get("abate_date")),
        "abate_complete": str(v.get("abate_complete") or "").strip() or None,
        "initial_penalty": round(init_p, 2),
        "current_penalty": round(cur_p, 2),
        "contest_date": _iso_day(v.get("contest_date")),
        "final_order_date": _iso_day(v.get("final_order_date")),
        "nr_instances": _opt_int(v.get("nr_instances")),
        "nr_exposed": _opt_int(v.get("nr_exposed")),
        "gravity": str(v.get("gravity") or "").strip() or None,
        "emphasis": str(v.get("emphasis") or "").strip() or None,
        "hazcat": str(v.get("hazcat") or "").strip() or None,
        "fta_insp_nr": _opt_int(v.get("fta_insp_nr")),
        "fta_issuance_date": _iso_day(v.get("fta_issuance_date")),
        "fta_penalty": round(fta_p, 2) if fta_p > 0 else None,
        "hazsubs": hazsubs,
    }


def build_enforcement_article(insp: dict, violations: list[dict]) -> dict:
    act_nr = int(insp["activity_nr"])
    company = (insp.get("estab_name") or "Unknown establishment").strip().title()
    city = (insp.get("site_city") or "").strip().title() or None
    state = (insp.get("site_state") or "").strip().upper() or None
    loc = ", ".join(p for p in (city, state) if p)
    insp_type_code = (insp.get("insp_type") or "").strip().upper()
    label = INSP_TYPE_LABELS.get(insp_type_code, "OSHA inspection")

    total, initial_total, sections, counts, gdc, unmapped = 0.0, 0.0, set(), {}, 0, 0
    total_instances, max_exposed = 0, 0
    contested_count, fta_count, fta_total = 0, 0, 0.0
    open_abate_count, overdue_abate_count = 0, 0
    today_iso = date.today().isoformat()
    viol_rows: list[dict] = []
    for v in violations:
        if v.get("delete_flag"):
            continue
        row = _norm_violation_row(v)
        viol_rows.append(row)
        total += row["current_penalty"]
        initial_total += row["initial_penalty"]
        if row["contest_date"]:
            contested_count += 1
        if row["fta_penalty"] or row["fta_insp_nr"]:
            fta_count += 1
            fta_total += row["fta_penalty"] or 0.0
        ab_done = (row["abate_complete"] or "").upper() in ("X", "3", "Y")
        if row["abate_date"] and not ab_done:
            open_abate_count += 1
            if row["abate_date"] < today_iso:
                overdue_abate_count += 1
        if row["nr_instances"]:
            total_instances += row["nr_instances"]
        if row["nr_exposed"] and row["nr_exposed"] > max_exposed:
            max_exposed = row["nr_exposed"]
        if row["section_id"]:
            sections.add(row["section_id"])
        elif row["is_general_duty"]:
            gdc += 1
        elif row["raw_standard"]:
            unmapped += 1
        vt = row["viol_type"]
        if vt:
            counts[vt] = counts.get(vt, 0) + 1

    viol_rows.sort(key=lambda r: (r["citation_id"], r["raw_standard"]))
    issued = max((str(v.get("issuance_date") or "")[:10] for v in violations if not v.get("delete_flag")), default="")

    sh_code = (insp.get("safety_hlth") or "").strip().upper()
    scope_code = (insp.get("insp_scope") or "").strip().upper()
    owner_code = (insp.get("owner_type") or "").strip().upper()
    union_code = (insp.get("union_status") or "").strip().upper()
    address = (insp.get("site_address") or "").strip().title() or None

    reduction_usd = round(max(0.0, initial_total - total), 2)
    reduction_pct = round((initial_total - total) / initial_total * 100.0, 1) if initial_total > total and initial_total > 0 else 0.0

    inspection_detail = {
        "activity_nr": act_nr,
        "reporting_id": str(insp.get("reporting_id") or "").strip() or None,
        "state_flag": str(insp.get("state_flag") or "").strip().upper() or None,
        "estab_name": company,
        "site_address": address,
        "site_city": city,
        "site_state": state,
        "site_zip": str(insp.get("site_zip") or "").strip() or None,
        "naics_code": str(insp.get("naics_code") or "").strip() or None,
        "sic_code": str(insp.get("sic_code") or "").strip() or None,
        "insp_type": insp_type_code or None,
        "insp_type_label": label,
        "safety_hlth": sh_code or None,
        "safety_hlth_label": SAFETY_HLTH_LABELS.get(sh_code, sh_code or None),
        "insp_scope": scope_code or None,
        "insp_scope_label": INSP_SCOPE_LABELS.get(scope_code, scope_code or None),
        "owner_type": owner_code or None,
        "owner_type_label": OWNER_TYPE_LABELS.get(owner_code, owner_code or None),
        "union_status": union_code or None,
        "union_status_label": UNION_STATUS_LABELS.get(union_code, union_code or None),
        "adv_notice": str(insp.get("adv_notice") or "").strip().upper() or None,
        "why_no_insp": str(insp.get("why_no_insp") or "").strip().upper() or None,
        "nr_in_estab": _opt_int(insp.get("nr_in_estab")),
        "open_date": _iso_day(insp.get("open_date")),
        "close_conf_date": _iso_day(insp.get("close_conf_date")),
        "close_case_date": _iso_day(insp.get("close_case_date")),
        "case_mod_date": _iso_day(insp.get("case_mod_date")),
        "initial_penalty_usd": round(initial_total, 2),
        "current_penalty_usd": round(total, 2),
        "reduction_usd": reduction_usd,
        "reduction_pct": reduction_pct,
        "contested_count": contested_count,
        "fta_count": fta_count,
        "fta_total_usd": round(fta_total, 2),
        "open_abate_count": open_abate_count,
        "overdue_abate_count": overdue_abate_count,
        "total_instances": total_instances,
        "max_exposed": max_exposed,
        "citation_count": len(viol_rows),
    }

    return {
        **empty_item(),
        "guid": f"dol-insp:{act_nr}",
        "source": "dol_osha",
        "agency": "occupational-safety-and-health-administration",
        "category": "enforcement",
        "doc_type": label,
        "title": f"{company} cited after {label.lower()}" + (f" in {loc}" if loc else ""),
        # The user's browser opens this; FRAMEWORK never fetches osha.gov.
        "link": f"https://www.osha.gov/ords/imis/establishment.inspection_detail?id={act_nr}",
        "published_at": issued or str(insp.get("open_date") or "")[:10] or date.today().isoformat(),
        "description": "",  # the takeaways carry the substance; FTS indexes company + title
        "company": company, "city": city, "state": state, "naics": insp.get("naics_code"),
        "penalty_usd": round(total, 2) if total > 0 else None,
        "violation_types": sorted(counts),
        "violation_counts": counts,          # used by takeaways; not stored as a column
        "general_duty": gdc,
        "unmapped_standards": unmapped,
        "opened_on": str(insp.get("open_date") or "")[:10] or None,  # used by takeaways
        "sections": sorted(sections),
        "inspection_detail": inspection_detail,
        "violations_list": viol_rows,
    }


def _dol_get_optional(c: httpx.Client, key: str, dataset: str, params: dict) -> list[dict]:
    """Fetch supplementary DOL dataset rows, degrading cleanly on 204/429/500."""
    try:
        return _dol_get(c, key, dataset, params)
    except SourceUnavailable:
        return []


def fetch_inspection_case(c: httpx.Client, key: str, activity_nr: int) -> dict | None:
    """On-demand full case file fetch for one inspection via DOL Open Data API v4."""
    insp_rows = _dol_get(c, key, "inspection", {
        "limit": 1,
        "fields": "activity_nr,reporting_id,state_flag,estab_name,site_address,site_city,"
                  "site_state,site_zip,owner_type,adv_notice,safety_hlth,sic_code,naics_code,"
                  "insp_type,insp_scope,why_no_insp,union_status,nr_in_estab,open_date,"
                  "case_mod_date,close_conf_date,close_case_date",
        "filter_object": json.dumps({"field": "activity_nr", "operator": "eq", "value": activity_nr}),
    })
    if not insp_rows:
        return None
    insp = insp_rows[0]
    viol_rows: list[dict] = []
    viol_offset = 0
    while True:
        page = _dol_get(c, key, "violation", {
            "limit": 200,
            "offset": viol_offset,
            "fields": "activity_nr,citation_id,delete_flag,standard,viol_type,issuance_date,"
                      "abate_date,abate_complete,initial_penalty,current_penalty,"
                      "contest_date,final_order_date,nr_instances,nr_exposed,gravity,emphasis,hazcat,"
                      "fta_insp_nr,fta_issuance_date,fta_penalty,hazsub1,hazsub2,hazsub3,hazsub4,hazsub5",
            "filter_object": json.dumps({"field": "activity_nr", "operator": "eq", "value": activity_nr}),
        })
        viol_rows.extend(page)
        if len(page) < 200 or viol_offset >= 1800:
            break
        viol_offset += 200
    active_viols = [v for v in viol_rows if not v.get("delete_flag")]
    article = enrich_item(build_enforcement_article(insp, active_viols))

    events_raw = _dol_get_optional(c, key, "violation_event", {
        "limit": 100,
        "fields": "activity_nr,citation_id,pen_fta,hist_event,hist_date,hist_penalty,hist_abate_date,hist_vtype",
        "filter_object": json.dumps({"field": "activity_nr", "operator": "eq", "value": activity_nr}),
    })
    events = []
    for ev in events_raw:
        code = str(ev.get("hist_event") or "").strip().upper()
        events.append({
            "citation_id": str(ev.get("citation_id") or "").strip(),
            "event": code,
            "event_label": VIOL_EVENT_LABELS.get(code, code or "Update"),
            "date": _iso_day(ev.get("hist_date")),
            "penalty": round(_money(ev.get("hist_penalty")), 2) if ev.get("hist_penalty") not in (None, "") else None,
            "abate_date": _iso_day(ev.get("hist_abate_date")),
            "viol_type": str(ev.get("hist_vtype") or "").strip().upper() or None,
            "pen_fta": str(ev.get("pen_fta") or "").strip().upper() or None,
        })
    events.sort(key=lambda e: (e["date"] or "", e["citation_id"]))

    gdc_list: list[dict] = []
    if article.get("general_duty"):
        gdc_rows = _dol_get_optional(c, key, "violation_gen_duty_std", {
            "limit": 200,
            "fields": "activity_nr,citation_id,line_nr,line_text",
            "filter_object": json.dumps({"field": "activity_nr", "operator": "eq", "value": activity_nr}),
        })
        by_cit: dict[str, list[tuple[int, str]]] = {}
        for gr in gdc_rows:
            cid = str(gr.get("citation_id") or "").strip()
            ln = _opt_int(gr.get("line_nr")) or 0
            txt = str(gr.get("line_text") or "").rstrip()
            if txt:
                by_cit.setdefault(cid, []).append((ln, txt))
        for cid, lines in sorted(by_cit.items()):
            lines.sort(key=lambda x: x[0])
            gdc_list.append({"citation_id": cid, "text": " ".join(t for _, t in lines)})

    accidents: list[dict] = []
    if (insp.get("insp_type") or "").strip().upper() in ("A", "M"):
        inj_rows = _dol_get_optional(c, key, "accident_injury", {
            "limit": 20,
            "fields": "summary_nr,rel_insp_nr,degree_of_inj,fall_distance,fall_ht,fat_cause",
            "filter_object": json.dumps({"field": "rel_insp_nr", "operator": "eq", "value": activity_nr}),
        })
        sum_nrs = sorted({int(r["summary_nr"]) for r in inj_rows if r.get("summary_nr")})
        if sum_nrs:
            acc_rows = _dol_get_optional(c, key, "accident", {
                "limit": len(sum_nrs),
                "fields": "summary_nr,event_date,event_desc,event_keyword,fatality,abstract_text",
                "filter_object": json.dumps({"field": "summary_nr", "operator": "in", "value": sum_nrs}),
            })
            abs_rows = _dol_get_optional(c, key, "accident_abstract", {
                "limit": 200,
                "fields": "summary_nr,line_nr,abstract_text",
                "filter_object": json.dumps({"field": "summary_nr", "operator": "in", "value": sum_nrs}),
            })
            abs_by_sum: dict[int, list[tuple[int, str]]] = {}
            for ar in abs_rows:
                snr = _opt_int(ar.get("summary_nr"))
                if snr is not None and ar.get("abstract_text"):
                    abs_by_sum.setdefault(snr, []).append((_opt_int(ar.get("line_nr")) or 0, str(ar["abstract_text"]).strip()))
            for ac in acc_rows:
                snr = int(ac["summary_nr"])
                lines = sorted(abs_by_sum.get(snr, []), key=lambda x: x[0])
                narrative = " ".join(t for _, t in lines) or str(ac.get("abstract_text") or "").strip()
                accidents.append({
                    "summary_nr": snr,
                    "event_date": _iso_day(ac.get("event_date")),
                    "event_desc": str(ac.get("event_desc") or "").strip(),
                    "keywords": str(ac.get("event_keyword") or "").strip(),
                    "fatality": str(ac.get("fatality") or "").strip() or None,
                    "abstract": narrative,
                })

    related_by_key: dict[tuple[int, str], dict] = {}
    for direction, field in (("related", "activity_nr"), ("parent", "rel_act_nr")):
        rel_rows = _dol_get_optional(c, key, "related_activity", {
            "limit": 100,
            "fields": "activity_nr,rel_type,rel_act_nr,rel_safety,rel_health",
            "filter_object": json.dumps({"field": field, "operator": "eq", "value": activity_nr}),
        })
        for rr in rel_rows:
            target_nr = _opt_int(rr.get("rel_act_nr") if field == "activity_nr" else rr.get("activity_nr"))
            if target_nr is None or target_nr == activity_nr:
                continue
            rtype = str(rr.get("rel_type") or "").strip().upper() or "R"
            k = (target_nr, rtype)
            if k not in related_by_key:
                related_by_key[k] = {
                    "rel_act_nr": target_nr,
                    "rel_type": rtype,
                    "rel_label": REL_TYPE_LABELS.get(rtype, f"Related ({rtype})"),
                    "direction": direction,
                    "safety": str(rr.get("rel_safety") or "").strip().upper() == "Y",
                    "health": str(rr.get("rel_health") or "").strip().upper() == "Y",
                }
    for vr in article.get("violations_list") or []:
        fta_nr = vr.get("fta_insp_nr")
        if fta_nr and fta_nr != activity_nr:
            k = (int(fta_nr), "FTA")
            if k not in related_by_key:
                related_by_key[k] = {
                    "rel_act_nr": int(fta_nr),
                    "rel_type": "FTA",
                    "rel_label": REL_TYPE_LABELS["FTA"],
                    "direction": "fta",
                    "safety": False,
                    "health": False,
                }
    related = sorted(related_by_key.values(), key=lambda x: (x["rel_act_nr"], x["rel_type"]))

    return {
        "activity_nr": activity_nr,
        "article": article,
        "events": events,
        "gdc": gdc_list,
        "accidents": accidents,
        "related": related,
    }


def _dol_and_filter(clauses: list[dict]) -> dict | None:
    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return {"and": clauses}


def search_dol_inspections(
    c: httpx.Client,
    key: str,
    *,
    estab_name: str | None = None,
    naics: str | None = None,
    state: str | None = None,
    since: str | None = None,
    sort_by: str = "open_date",
    offset: int = 0,
    limit: int = 25,
) -> list[dict]:
    """Query DOL OSHA/inspection on explicit user submit (verified like/and/sort_by)."""
    clauses: list[dict] = []
    if estab_name and estab_name.strip():
        clean = estab_name.strip().upper().replace("%", "")
        clauses.append({"field": "estab_name", "operator": "like", "value": f"%{clean}%"})
    if naics and naics.strip():
        clean_n = re.sub(r"\D", "", naics.strip())
        if clean_n:
            op = "eq" if len(clean_n) == 6 else "like"
            val = clean_n if op == "eq" else f"{clean_n}%"
            clauses.append({"field": "naics_code", "operator": op, "value": val})
    if state and state.strip():
        clauses.append({"field": "site_state", "operator": "eq", "value": state.strip().upper()})
    if since and since.strip():
        clauses.append({"field": "open_date", "operator": "gt", "value": since.strip()[:10]})
    params: dict = {
        "limit": max(1, min(int(limit), 25)),
        "offset": max(0, int(offset)),
        "sort": "desc",
        "sort_by": "open_date" if sort_by != "open_date" else "open_date",
        "fields": "activity_nr,estab_name,site_city,site_state,naics_code,open_date,insp_type,state_flag",
    }
    fobj = _dol_and_filter(clauses)
    if fobj:
        params["filter_object"] = json.dumps(fobj)
    rows = _dol_get(c, key, "inspection", params)
    out: list[dict] = []
    for r in rows:
        act = _opt_int(r.get("activity_nr"))
        if act is None:
            continue
        it = str(r.get("insp_type") or "").strip().upper() or None
        out.append({
            "activity_nr": act,
            "estab_name": (r.get("estab_name") or "Unknown establishment").strip().title(),
            "site_city": (r.get("site_city") or "").strip().title() or None,
            "site_state": (r.get("site_state") or "").strip().upper() or None,
            "naics_code": str(r.get("naics_code") or "").strip() or None,
            "open_date": _iso_day(r.get("open_date")),
            "insp_type": it,
            "insp_type_label": INSP_TYPE_LABELS.get(it or "", "OSHA inspection"),
            "state_flag": str(r.get("state_flag") or "").strip().upper() or None,
        })
    return out


def search_dol_violations(
    c: httpx.Client,
    key: str,
    *,
    standard: str | None = None,
    hazsub: str | None = None,
    state: str | None = None,
    min_penalty: float | None = None,
    since: str | None = None,
    sort_by: str = "open_date",
    offset: int = 0,
    limit: int = 25,
) -> list[dict]:
    """Query DOL OSHA/violation by IMIS CFR prefix or substance, joined with OSHA/inspection."""
    clauses: list[dict] = []
    if standard and standard.strip():
        imis = cfr_to_imis_prefix(standard)
        if imis:
            clauses.append({"field": "standard", "operator": "like", "value": f"{imis}%"})
    if hazsub and hazsub.strip():
        hz = hazsub.strip()
        if not hz.isdigit():
            # Allow searching by common substance name from HAZSUB_LABELS.
            low = hz.lower()
            hit = next((k for k, v in HAZSUB_LABELS.items() if low in v.lower()), None)
            hz = hit or hz
        clauses.append({"field": "hazsub1", "operator": "eq", "value": hz})
    if min_penalty is not None and min_penalty > 0:
        clauses.append({"field": "current_penalty", "operator": "gt", "value": float(min_penalty)})
    if since and since.strip():
        clauses.append({"field": "issuance_date", "operator": "gt", "value": since.strip()[:10]})
    params: dict = {
        "limit": max(1, min(int(limit) * 2, 50)),
        "offset": max(0, int(offset)),
        "sort": "desc",
        "sort_by": "current_penalty" if sort_by == "penalty" else "issuance_date",
        "fields": "activity_nr,citation_id,delete_flag,standard,viol_type,issuance_date,current_penalty,hazsub1,hazsub2",
    }
    fobj = _dol_and_filter(clauses)
    if fobj:
        params["filter_object"] = json.dumps(fobj)
    vrows = _dol_get(c, key, "violation", params)
    by_act: dict[int, dict] = {}
    for v in vrows:
        if v.get("delete_flag") or not v.get("activity_nr"):
            continue
        act = int(v["activity_nr"])
        pen = _money(v.get("current_penalty"))
        parsed = parse_dol_standard(v.get("standard"))
        cur = by_act.get(act)
        if cur is None or pen > cur["current_penalty"]:
            by_act[act] = {
                "activity_nr": act,
                "matched_standard": parsed["display"],
                "section_id": parsed["section"],
                "current_penalty": round(pen, 2),
                "issuance_date": _iso_day(v.get("issuance_date")),
                "hazsubs": [hazsub_label(v.get(k)) for k in ("hazsub1", "hazsub2") if v.get(k) not in (None, "", "0")],
            }
        if len(by_act) >= max(1, min(int(limit), 25)):
            break
    if not by_act:
        return []
    insp_rows = fetch_dol_inspections(c, key, list(by_act))
    insp_map = {int(i["activity_nr"]): i for i in insp_rows}
    out: list[dict] = []
    want_state = state.strip().upper() if state and state.strip() else None
    for act, meta in by_act.items():
        insp = insp_map.get(act)
        if not insp:
            continue
        st = (insp.get("site_state") or "").strip().upper() or None
        if want_state and st != want_state:
            continue
        it = str(insp.get("insp_type") or "").strip().upper() or None
        out.append({
            "activity_nr": act,
            "estab_name": (insp.get("estab_name") or "Unknown establishment").strip().title(),
            "site_city": (insp.get("site_city") or "").strip().title() or None,
            "site_state": st,
            "naics_code": str(insp.get("naics_code") or "").strip() or None,
            "open_date": _iso_day(insp.get("open_date")),
            "insp_type": it,
            "insp_type_label": INSP_TYPE_LABELS.get(it or "", "OSHA inspection"),
            "state_flag": str(insp.get("state_flag") or "").strip().upper() or None,
            **meta,
        })
    return out


def live_dol_search(
    c: httpx.Client,
    key: str,
    *,
    q: str,
    mode: str = "employer",
    state: str | None = None,
    since: str | None = None,
    min_penalty: float | None = None,
    sort_by: str = "open_date",
    offset: int = 0,
    limit: int = 25,
) -> dict:
    """Cached live DOL archive search across OSHA/inspection or OSHA/violation."""
    norm_q = q.strip()
    cache_key = (
        mode, norm_q.lower(), (state or "").upper(), (since or "")[:10],
        float(min_penalty or 0.0), sort_by, int(offset), int(limit),
    )
    now_m = time.monotonic()
    hit = _dol_search_cache.get(cache_key)
    if hit and (now_m - hit[0]) < DOL_SEARCH_TTL_SEC:
        return {**hit[1], "cached": True}

    if mode == "employer":
        rows = search_dol_inspections(
            c, key, estab_name=norm_q, state=state, since=since, sort_by=sort_by, offset=offset, limit=limit)
    elif mode == "naics":
        rows = search_dol_inspections(
            c, key, naics=norm_q, state=state, since=since, sort_by=sort_by, offset=offset, limit=limit)
    elif mode == "standard":
        rows = search_dol_violations(
            c, key, standard=norm_q, state=state, min_penalty=min_penalty, since=since,
            sort_by=sort_by, offset=offset, limit=limit)
    else:
        rows = search_dol_violations(
            c, key, hazsub=norm_q, state=state, min_penalty=min_penalty, since=since,
            sort_by=sort_by, offset=offset, limit=limit)

    payload = {
        "mode": mode,
        "query": norm_q,
        "results": rows,
        "count": len(rows),
        "offset": offset,
        "limit": limit,
        "has_more": len(rows) >= limit,
        "cached": False,
    }
    if len(_dol_search_cache) >= DOL_SEARCH_CACHE_MAX:
        oldest = min(_dol_search_cache, key=lambda k: _dol_search_cache[k][0])
        _dol_search_cache.pop(oldest, None)
    _dol_search_cache[cache_key] = (now_m, payload)
    return payload


# ---------------------------------------------------------------------------
# Citation normalisation
# ---------------------------------------------------------------------------

# DOL `violation.standard` is fixed-width: 4-digit part, zero-padded 4-digit section,
# then the paragraph code ("19101030 G02   IIA").
DOL_STANDARD_RE = re.compile(r"^(19\d{2})(\d{4})(?=\s|$|[A-Z])")
_DOL_CLAUSE_RE = re.compile(r"^([A-Z])(\d{1,2})?$")
_DOL_ROMAN_LETTER_RE = re.compile(r"^(X{0,3}(?:IX|IV|V?I{1,3}|V))([A-Z])?$")


def parse_dol_standard(raw: str | None) -> dict:
    """Parse a DOL IMIS standard code like '19101030 G02   IIA' or '19100028 B03 IV'
    into section id + CFR paragraph path (e.g. '(g)(2)(ii)(A)')."""
    s = (raw or "").strip()
    if is_general_duty(s):
        return {
            "section": None, "para": None,
            "display": "General Duty Clause · Section 5(a)(1)",
            "is_general_duty": True, "is_state_plan": False,
        }
    m = DOL_STANDARD_RE.match(s)
    if not m:
        return {
            "section": None, "para": None,
            "display": s or "Unknown standard",
            "is_general_duty": False, "is_state_plan": bool(s),
        }
    section = f"{m.group(1)}.{int(m.group(2))}"
    rest = s[m.end():].strip().split()
    tokens: list[str] = []
    if rest:
        first = _DOL_CLAUSE_RE.match(rest[0].upper())
        if first:
            tokens.append(f"({first.group(1).lower()})")
            if first.group(2):
                tokens.append(f"({int(first.group(2))})")
            rest = rest[1:]
        for tok in rest:
            up = tok.upper()
            if up.isdigit():
                tokens.append(f"({int(up)})")
                continue
            rm = _DOL_ROMAN_LETTER_RE.match(up)
            if rm:
                tokens.append(f"({rm.group(1).lower()})")
                if rm.group(2):
                    tokens.append(f"({rm.group(2)})")
                continue
            if len(up) == 1 and up.isalpha():
                tokens.append(f"({up})")
    para = "".join(tokens) or None
    return {
        "section": section,
        "para": para,
        "display": f"§ {section}{para or ''}",
        "is_general_duty": False,
        "is_state_plan": False,
    }


def normalize_dol_standard(raw: str | None) -> str | None:
    """'19101030 G02   IIA' -> '1910.1030'; '19100134 A01' -> '1910.134'.
    None if not a 29 CFR 19xx code (General Duty, state-plan standards)."""
    m = DOL_STANDARD_RE.match((raw or "").strip())
    if not m:
        return None
    return f"{m.group(1)}.{int(m.group(2))}"


def is_general_duty(raw: str | None) -> bool:
    """Section 5(a)(1) citations carry a non-CFR code ('5A0001'); verified against live DOL rows 2026-11-16."""
    return (raw or "").strip().upper().startswith("5A")


def extract_citations(text: str) -> tuple[list[str], list[dict]]:
    """Return (sorted section ids, part refs [{'title': 29, 'part': '1904'}]) found in prose.

    Rules, chosen to avoid false positives (a bare `1999.5` in prose never becomes a citation):
    - "29 CFR 1910.1200(a)(1)" / "29 C.F.R. §§ ..." -> sections, any Title 29 part.
    - "29 CFR part 1904" / "29 CFR parts 1910 and 1926" -> part-level references.
    - A bare "§ 1910.134" (no title) -> a Title 29 section only if the part is 1900-1999.
    - Citations to other titles (40 CFR 261.3) are ignored while OSHA is the only agency;
      when more agencies arrive, `sections` becomes [{"title", "id"}].
    """
    t = text or ""
    sections: set[str] = set()
    parts: set[str] = set()
    masked = list(t)

    def _mask(start: int, end: int) -> None:
        for idx in range(start, end):
            masked[idx] = " "

    for m in CROSS_TITLE_PARTS_RE.finditer(t):
        _mask(m.start(), m.end())
        if int(m.group(1)) == 29:
            for pm in re.finditer(PART_NUM, m.group(3)):
                tok = pm.group(0)
                if tok.isdigit():
                    parts.add(tok)

    for m in CROSS_TITLE_EXT_RE.finditer(t):
        _mask(m.start(), m.end())
        if int(m.group(1)) != 29:
            continue
        src = m.group(3) or m.group(4) or ""
        for im in SECTION_ITEM_RE.finditer(src):
            sections.add(im.group(1))

    for m in CROSS_TITLE_RE.finditer(t):
        _mask(m.start(), m.end())
        if int(m.group(1)) != 29:
            continue
        if m.group(2):  # "part 1904"
            parts.add(re.sub(r"\D", "", m.group(2)))
        for src in (m.group(4), m.group(5)):
            if src:
                for im in SECTION_ITEM_RE.finditer(src):
                    sections.add(im.group(1))

    unclaimed = "".join(masked)
    for m in XREF_RE.finditer(unclaimed):  # bare § citations: OSHA's 1900-1999 range only
        for im in SECTION_ITEM_RE.finditer(m.group(2)):
            part = im.group(1).split(".", 1)[0]
            if part.isdigit() and 1900 <= int(part) <= 1999:
                sections.add(im.group(1))
    return sorted(sections), [{"title": 29, "part": p}
                              for p in sorted(parts, key=lambda p: (len(p), p))]


def extract_all_citations(text: str) -> tuple[list[dict], list[dict]]:
    """Return ([{"title": t, "id": sec}], [{"title": t, "part": p}]) across all CFR titles 1-50."""
    t = text or ""
    secs: set[tuple[int, str]] = set()
    parts: set[tuple[int, str]] = set()
    masked = list(t)

    def _mask(start: int, end: int) -> None:
        for idx in range(start, end):
            masked[idx] = " "

    for m in CROSS_TITLE_PARTS_RE.finditer(t):
        _mask(m.start(), m.end())
        t_num = int(m.group(1))
        if 1 <= t_num <= 50:
            for pm in re.finditer(PART_NUM, m.group(3)):
                tok = pm.group(0)
                if tok.isdigit():
                    parts.add((t_num, tok))

    for m in CROSS_TITLE_EXT_RE.finditer(t):
        _mask(m.start(), m.end())
        t_num = int(m.group(1))
        if 1 <= t_num <= 50:
            src = m.group(3) or m.group(4) or ""
            for im in SECTION_ITEM_RE.finditer(src):
                secs.add((t_num, im.group(1)))

    for m in CROSS_TITLE_RE.finditer(t):
        _mask(m.start(), m.end())
        t_num = int(m.group(1))
        if 1 <= t_num <= 50:
            if m.group(2):
                p_tok = re.sub(r"\D", "", m.group(2))
                if p_tok:
                    parts.add((t_num, p_tok))
            for src in (m.group(4), m.group(5)):
                if src:
                    for im in SECTION_ITEM_RE.finditer(src):
                        secs.add((t_num, im.group(1)))

    unclaimed = "".join(masked)
    for m in XREF_RE.finditer(unclaimed):  # bare § citations: OSHA's 1900-1999 range only
        for im in SECTION_ITEM_RE.finditer(m.group(2)):
            part = im.group(1).split(".", 1)[0]
            if part.isdigit() and 1900 <= int(part) <= 1999:
                secs.add((29, im.group(1)))

    return (
        [{"title": tn, "id": sid} for tn, sid in sorted(secs)],
        [{"title": tn, "part": p} for tn, p in sorted(parts, key=lambda x: (x[0], len(x[1]), x[1]))],
    )


# ---------------------------------------------------------------------------
# Takeaways: three fixed bullets per item, built from the record's own fields
# ---------------------------------------------------------------------------

_MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
_SENTENCE = re.compile(r"(.+?[.!?])(?:\s|$)", re.DOTALL)
TAKEAWAY_MAX_CHARS = 200


def _fmt_date(iso: str | None) -> str:
    try:
        d = date.fromisoformat((iso or "")[:10])
    except ValueError:
        return (iso or "").strip()
    return f"{_MONTHS[d.month - 1]} {d.day}, {d.year}"


def _fmt_money(v: float) -> str:
    return f"${v:,.0f}"


def _first_sentence(text: str | None) -> str:
    s = (text or "").strip()
    m = _SENTENCE.match(s)
    return (m.group(1) if m else s).strip()


def _clip(text: str, limit: int = TAKEAWAY_MAX_CHARS) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(" ·,;")
    return cut + "…"


def _cfr_text(item: dict) -> str:
    by_title: dict[int, list[str]] = {}
    for r in item.get("cfr_parts") or []:
        by_title.setdefault(int(r["title"]), []).append(str(r["part"]))
    bits = [f"{t} CFR {'Part' if len(ps) == 1 else 'Parts'} {', '.join(ps)}"
            for t, ps in sorted(by_title.items())]
    secs = item.get("sections") or []
    if secs:
        shown = ", ".join(f"§ {s}" for s in secs[:4])
        bits.append(shown + (f" +{len(secs) - 4} more" if len(secs) > 4 else ""))
    return " · ".join(bits)


def _fr_dates_text(item: dict) -> str:
    text = ""
    if item.get("doc_type") == "Rule" and item.get("effective_on"):
        text = f"Effective {_fmt_date(item['effective_on'])}"
    elif item.get("doc_type") == "Proposed Rule" and item.get("comments_close_on"):
        text = f"Comments close {_fmt_date(item['comments_close_on'])}"
    if not text:
        text = f"Published {_fmt_date(item.get('published_at'))}"
    dockets = item.get("docket_ids") or []
    if dockets:
        first = str(dockets[0]).strip()
        # FR docket ids sometimes already carry the word ("Docket No. ETA-2025-0003").
        text += f" · {first}" if first.lower().startswith("docket") else f" · Docket {first}"
    return text


def _enforcement_takeaways(item: dict) -> list[dict]:
    head = f"{item.get('doc_type') or 'OSHA inspection'} at {item.get('company') or 'unknown establishment'}"
    loc = ", ".join(p for p in (item.get("city"), item.get("state")) if p)
    if loc:
        head += f", {loc}"
    incident_bits = [head]
    if item.get("naics"):
        incident_bits.append(f"NAICS {item['naics']}")
    if item.get("opened_on"):
        incident_bits.append(f"opened {_fmt_date(item['opened_on'])}")

    std_bits = []
    secs = item.get("sections") or []
    if secs:
        std_bits.append(", ".join(f"§ {s}" for s in secs[:4])
                        + (f" +{len(secs) - 4} more" if len(secs) > 4 else ""))
    if item.get("general_duty"):
        std_bits.append(f"General Duty Clause ×{item['general_duty']}")
    if item.get("unmapped_standards"):
        std_bits.append(f"{item['unmapped_standards']} state-plan standards")

    counts = item.get("violation_counts") or {}
    counts_text = ", ".join(f"{counts[k]} {VIOL_TYPE_LABELS[k]}" for k in "WRSOU" if counts.get(k))
    issued = f"issued {_fmt_date(item['published_at'])}" if item.get("published_at") else ""
    if item.get("penalty_usd"):
        # "Current" because open cases can still be contested and amounts change.
        pen_bits = [f"{_fmt_money(item['penalty_usd'])} current penalty"]
    else:
        pen_bits = ["No penalty assessed"]
    pen_bits += [b for b in (counts_text, issued) if b]

    return [
        {"key": "incident", "label": "Incident", "text": _clip(" · ".join(incident_bits))},
        {"key": "standards", "label": "Standards", "text": _clip(" · ".join(std_bits) or "No standards listed")},
        {"key": "penalty", "label": "Penalty", "text": _clip(" · ".join(pen_bits))},
    ]


def takeaways(item: dict) -> list[dict]:
    """Three deterministic bullets per item. No language model writes or summarises anything;
    a missing field gives a plainly worded fallback, never an invented one."""
    cat = item.get("category")
    if cat == "enforcement":
        return _enforcement_takeaways(item)
    if cat == "public_inspection":
        filed = f"{item.get('doc_type') or 'Document'} filed for public inspection"
        if item.get("published_at"):
            filed += f" {_fmt_date(item['published_at'])}"
        sched = (f"Scheduled for {_fmt_date(item['scheduled_on'])}" if item.get("scheduled_on")
                 else "Publication date not yet scheduled")
        return [
            {"key": "action", "label": "Filing", "text": _clip(filed)},
            {"key": "cfr", "label": "CFR", "text": _clip(_cfr_text(item) or "CFR parts appear when it publishes")},
            {"key": "dates", "label": "Publishes", "text": _clip(sched)},
        ]
    action = " ".join(x for x in ((item.get("action") or "").strip(),
                                  _first_sentence(item.get("description"))) if x)
    return [
        {"key": "action", "label": "Action", "text": _clip(action or "See the document for details.")},
        {"key": "cfr", "label": "CFR", "text": _clip(_cfr_text(item) or "No CFR parts listed")},
        {"key": "dates", "label": "Dates", "text": _clip(_fr_dates_text(item))},
    ]


def enrich_item(item: dict) -> dict:
    """Add prose citations (merged with the structured cfr_references) and the takeaways.
    The worker calls this on every fetched item before upserting."""
    prose = " ".join(x for x in (item.get("title"), item.get("description")) if x)
    title_sections, part_refs = extract_all_citations(prose)
    merged = {(int(r["title"]), str(r["part"])) for r in item.get("cfr_parts") or []}
    merged.update((int(r["title"]), str(r["part"])) for r in part_refs)
    item["cfr_parts"] = [{"title": t, "part": p}
                         for t, p in sorted(merged, key=lambda x: (x[0], len(x[1]), x[1]))]
    item["_title_sections"] = title_sections
    item["sections"] = sorted(set(item.get("sections") or []) | {ts["id"] for ts in title_sections})
    item["takeaways"] = takeaways(item)
    return item
