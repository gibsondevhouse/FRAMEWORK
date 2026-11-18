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
from datetime import date, datetime, timedelta
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

USER_AGENT = "FRAMEWORK-ComplianceReader/1.0 (local-reader)"
FR_BASE = "https://www.federalregister.gov/api/v1"
DOL_BASE = "https://apiprod.dol.gov/v4"

FR_FIELDS = [
    "title", "document_number", "publication_date", "type", "abstract", "action", "dates",
    "effective_on", "comments_close_on", "cfr_references", "citation", "html_url", "pdf_url",
    "body_html_url", "agencies", "docket_ids",
]
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


class SourceUnavailable(Exception):
    """A source failed (network, HTTP status, bad payload). The worker records it and moves on."""


def client(extra: dict[str, str] | None = None) -> httpx.Client:
    """One client per sync run (the worker opens it and passes it to every fetcher)."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    headers.update(extra or {})
    return httpx.Client(headers=headers, timeout=20.0, follow_redirects=True)


def _get_json(c: httpx.Client, url: str, params) -> dict:
    try:
        r = c.get(url, params=params)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: HTTP {e.response.status_code}") from None
    except (httpx.HTTPError, ValueError) as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: {type(e).__name__}") from None


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

def fetch_federal_register_documents(c: httpx.Client, agency: str, since: str) -> list[dict]:
    """Every document published on or after `since` (ISO date), following next_page_url."""
    params = [("conditions[agencies][]", agency), ("conditions[publication_date][gte]", since),
              ("order", "newest"), ("per_page", str(FR_PER_PAGE))]
    params += [("fields[]", f) for f in FR_FIELDS]
    url, results = f"{FR_BASE}/documents.json", []
    for _ in range(FR_MAX_PAGES):
        page = _get_json(c, url, params)
        results += page.get("results", [])
        url, params = page.get("next_page_url"), None  # next_page_url carries the query
        if not url:
            break
    return [fr_document_item(d, agency) for d in results if d.get("document_number")]


def fr_document_item(doc: dict, agency: str) -> dict:
    doc_type = doc.get("type") or "Notice"
    return {
        **empty_item(),
        "guid": f"fr:{doc['document_number']}",
        "source": "federal_register",
        "agency": agency,
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
                  "fta_insp_nr,fta_issuance_date,fta_penalty,hazsub1,hazsub2,hazsub3",
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


def _dol_get(c: httpx.Client, key: str, dataset: str, params: dict) -> list[dict]:
    try:
        # DOL v4 /v4/get/* endpoints reject header-only X-API-KEY with 401; pass it in
        # query params and strip URL/request details (`from None`) so errors never leak the key.
        r = c.get(f"{DOL_BASE}/get/OSHA/{dataset}/json", params={**params, "X-API-KEY": key})
        r.raise_for_status()
        if r.status_code == 204 or not r.content.strip():
            return []
        return r.json().get("data", [])
    except httpx.HTTPStatusError as e:
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
    viol_rows: list[dict] = []
    for v in violations:
        if v.get("delete_flag"):
            continue
        row = _norm_violation_row(v)
        viol_rows.append(row)
        total += row["current_penalty"]
        initial_total += row["initial_penalty"]
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

    inspection_detail = {
        "activity_nr": act_nr,
        "reporting_id": str(insp.get("reporting_id") or "").strip() or None,
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
                      "fta_insp_nr,fta_issuance_date,fta_penalty,hazsub1,hazsub2,hazsub3",
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

    return {
        "activity_nr": activity_nr,
        "article": article,
        "events": events,
        "gdc": gdc_list,
        "accidents": accidents,
    }


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
    secs, part_refs = extract_citations(prose)
    merged = {(int(r["title"]), str(r["part"])) for r in item.get("cfr_parts") or []}
    merged.update((r["title"], r["part"]) for r in part_refs)
    item["cfr_parts"] = [{"title": t, "part": p}
                         for t, p in sorted(merged, key=lambda x: (x[0], len(x[1]), x[1]))]
    item["sections"] = sorted(set(item.get("sections") or []) | set(secs))
    item["takeaways"] = takeaways(item)
    return item
