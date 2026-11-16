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
from datetime import date, timedelta

import httpx

from . import config
# Reuse the reader's CFR citation grammar instead of writing a new loose regex
# (lists, ranges and paragraph suffixes are already handled there).
from .render import _CROSS_TITLE, _NUM_IN_LIST, _XREF

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
    except (httpx.HTTPError, ValueError) as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: {type(e).__name__}") from e


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

def fetch_enforcement(c: httpx.Client, key: str, days: int, limit: int, max_inspections: int) -> list[dict]:
    """Recent violations -> group_violations -> one inspection request -> one item per
    inspection. The window arguments come from news_schedule.dol_window()."""
    groups = group_violations(fetch_dol_recent_violations(c, key, days, limit), max_inspections)
    inspections = {int(i["activity_nr"]): i for i in fetch_dol_inspections(c, key, list(groups))}
    return [build_enforcement_article(inspections[a], v) for a, v in groups.items() if a in inspections]


def fetch_dol_recent_violations(c: httpx.Client, key: str, days: int, limit: int) -> list[dict]:
    since = (date.today() - timedelta(days=days)).isoformat()
    params = {
        "limit": limit, "sort": "desc", "sort_by": "issuance_date",
        "fields": "activity_nr,citation_id,delete_flag,standard,viol_type,issuance_date,"
                  "initial_penalty,current_penalty,nr_instances,nr_exposed",
        "filter_object": json.dumps({"field": "issuance_date", "operator": "gt", "value": since}),
    }
    return _dol_get(c, key, "violation", params)


def fetch_dol_inspections(c: httpx.Client, key: str, activity_nrs: list[int]) -> list[dict]:
    if not activity_nrs:
        return []
    params = {
        "limit": len(activity_nrs),
        "fields": "activity_nr,estab_name,site_city,site_state,naics_code,insp_type,"
                  "safety_hlth,open_date,close_case_date",
        "filter_object": json.dumps({"field": "activity_nr", "operator": "in", "value": activity_nrs}),
    }
    return _dol_get(c, key, "inspection", params)


def _dol_get(c: httpx.Client, key: str, dataset: str, params: dict) -> list[dict]:
    try:
        # The key goes in the header only, never in a URL that could be logged.
        r = c.get(f"{DOL_BASE}/get/OSHA/{dataset}/json", params=params, headers={"X-API-KEY": key})
        r.raise_for_status()
        return r.json().get("data", [])
    except (httpx.HTTPError, ValueError) as e:
        raise SourceUnavailable(f"DOL {dataset}: {type(e).__name__}") from e


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


def build_enforcement_article(insp: dict, violations: list[dict]) -> dict:
    act_nr = int(insp["activity_nr"])
    company = (insp.get("estab_name") or "Unknown establishment").strip().title()
    city = (insp.get("site_city") or "").strip().title() or None
    state = (insp.get("site_state") or "").strip().upper() or None
    loc = ", ".join(p for p in (city, state) if p)
    label = INSP_TYPE_LABELS.get((insp.get("insp_type") or "").upper(), "OSHA inspection")

    total, sections, counts, gdc, unmapped = 0.0, set(), {}, 0, 0
    for v in violations:
        # current_penalty reflects settlements and contest outcomes; fall back to the initial amount.
        cur = v.get("current_penalty")
        total += _money(cur) if cur not in (None, "") else _money(v.get("initial_penalty"))
        std = v.get("standard") or ""
        if (sec := normalize_dol_standard(std)):
            sections.add(sec)
        elif is_general_duty(std):
            gdc += 1
        elif std.strip():
            unmapped += 1
        vt = (v.get("viol_type") or "").strip().upper()
        if vt:
            counts[vt] = counts.get(vt, 0) + 1

    issued = max((str(v.get("issuance_date") or "")[:10] for v in violations), default="")
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
        "published_at": issued or str(insp.get("open_date") or "")[:10],
        "description": "",  # the takeaways carry the substance; FTS indexes company + title
        "company": company, "city": city, "state": state, "naics": insp.get("naics_code"),
        "penalty_usd": round(total, 2) if total > 0 else None,
        "violation_types": sorted(counts),
        "violation_counts": counts,          # used by takeaways; not stored as a column
        "general_duty": gdc,
        "unmapped_standards": unmapped,
        "opened_on": str(insp.get("open_date") or "")[:10] or None,  # used by takeaways
        "sections": sorted(sections),
    }


# ---------------------------------------------------------------------------
# Citation normalisation
# ---------------------------------------------------------------------------

# DOL `violation.standard` is fixed-width: 4-digit part, zero-padded 4-digit section,
# then the paragraph code ("19101030 G02   IIA").
DOL_STANDARD_RE = re.compile(r"^(19\d{2})(\d{4})(?=\s|$|[A-Z])")

# "29 CFR parts 1910 and 1926" — _CROSS_TITLE only handles the singular "part N".
_CFR_PARTS = re.compile(
    r"\b(\d{1,2})\s*C\.?F\.?R\.?\s*[Pp]arts?\s+"
    r"(\d{1,4}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or|through|to)\s+)\d{1,4})*)",
    re.IGNORECASE,
)
_PART_NUM = re.compile(r"\d{1,4}")


def normalize_dol_standard(raw: str | None) -> str | None:
    """'19101030 G02   IIA' -> '1910.1030'; '19100134 A01' -> '1910.134'.
    None if not a 29 CFR 19xx code (General Duty, state-plan standards)."""
    m = DOL_STANDARD_RE.match((raw or "").strip())
    if not m:
        return None
    return f"{m.group(1)}.{int(m.group(2))}"


def is_general_duty(raw: str | None) -> bool:
    """Section 5(a)(1) citations carry a non-CFR code ('5A0001'); believed stable, but
    verify against live data when a DOL key is available."""
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
    for m in _CROSS_TITLE.finditer(t):
        if int(m.group(1)) != 29:
            continue
        if m.group(2):  # "part 1904"
            parts.add(re.sub(r"\D", "", m.group(2)))
        for src in (m.group(4), m.group(5)):  # "§§ a and b" list, or a bare "1910.1200(a)"
            if src:
                for im in _NUM_IN_LIST.finditer(src):
                    sections.add(im.group(1))
    for m in _CFR_PARTS.finditer(t):
        if int(m.group(1)) == 29:
            parts.update(_PART_NUM.findall(m.group(2)))
    for m in _XREF.finditer(t):  # bare § citations: OSHA's 1900-1999 range only
        for im in _NUM_IN_LIST.finditer(m.group(2)):
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
