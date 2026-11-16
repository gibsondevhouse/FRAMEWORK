# Stage 1 · Phase 1 · Part 1: Federal Register & DOL v4 API Client + Normalization

## 1. Objectives
Implement `reader/app/news.py` to fetch regulatory filings and enforcement actions only through sanctioned government APIs:
1. **Federal Register API v1**: published documents and Public Inspection filings, both as JSON, no key required.
2. **DOL Open Data API v4** (`apiprod.dol.gov/v4`), with an optional free `X-API-KEY` from `https://dataportal.dol.gov/registration`.

Each fetcher returns plain dicts in one **item shape** (section 4.1), which `news_store.upsert_article` (Part 2) persists. Fetchers never touch the database, and the store never touches the network.

## 2. Verified Official Documentation
- Federal Register API Docs: https://www.federalregister.gov/developers/documentation/api/v1
- Federal Register OpenAPI Spec: https://www.federalregister.gov/api/v1/documentation.json
- Federal Register Developer Resources: https://www.federalregister.gov/reader-aids/developer-resources
- DOL Open Data Portal: https://dataportal.dol.gov/
- DOL API User Guide (PDF, updated 08/05/2024): https://www.dataportal.dol.gov/pdf/dol-api-user-guide.pdf
- DOL API Key Registration: https://dataportal.dol.gov/registration
- DOL Unauthenticated Dataset Catalog: https://apiprod.dol.gov/v4/datasets?limit=100

## 3. Configuration (`reader/app/config.py` + `reader/.env.example`)
Follow the existing `anthropic_key()` pattern: read at call time, so tests can patch the environment.

```python
def dol_api_key() -> str | None:
    key = os.getenv("DOL_API_KEY", "").strip()
    return key or None


def news_agencies() -> list[str]:
    """Federal Register agency slugs to follow. Only OSHA is supported in this plan."""
    raw = os.getenv("NEWS_AGENCIES", "occupational-safety-and-health-administration")
    return [s.strip() for s in raw.split(",") if s.strip()]


def news_sync_enabled() -> bool:
    """False turns the background news worker off (tests, offline use)."""
    return os.getenv("NEWS_SYNC", "1").strip().lower() not in ("0", "false", "no", "off")
```

`.env.example` gains four commented, optional entries: `DOL_API_KEY=` (with the registration URL), `NEWS_AGENCIES=` (with a note that only OSHA is supported), `NEWS_SYNC=1`, and `NEWS_RETENTION_DAYS=365` (also the first sync's FR backfill window; read by `news_store.retention_days()`).

## 4. Verified Live Endpoints & Payloads

### 4.1 Item shape (what every fetcher returns)
```python
{
    "guid": "fr:2026-17726",          # fr:{document_number} for BOTH published and PI; dol-insp:{activity_nr}
    "source": "federal_register",     # federal_register | federal_register_pi | dol_osha
    "agency": "occupational-safety-and-health-administration",
    "category": "rules",              # rules | rulemaking | notices | public_inspection | enforcement
    "doc_type": "Rule",
    "title": "...", "link": "https://...", "pdf_url": None, "citation": None,
    "action": None, "effective_on": None, "comments_close_on": None,
    "scheduled_on": None,             # PI only: the date it will be published
    "published_at": "2026-08-31",     # always YYYY-MM-DD (PI: date of filed_at; DOL: latest issuance_date)
    "description": "",
    "docket_ids": [],
    "cfr_parts": [{"title": 29, "part": "42"}],
    "sections": ["1910.1030"],        # Title 29 section ids
    "company": None, "city": None, "state": None, "naics": None,
    "penalty_usd": None, "violation_types": [], "general_duty": 0, "unmapped_standards": 0,
}
```
**Why one guid for PI and published documents.** A Public Inspection filing and the document it becomes share a `document_number`. Keying both as `fr:{document_number}` means the published record replaces the PI one in place, so no duplicate is created. Part 2 makes sure a PI fetch can never overwrite a published record.

### 4.2 Federal Register published documents (verified `200 OK`)
By default `/api/v1/documents.json` omits `cfr_references`, `action`, `effective_on`, `dates`, `citation`, `comments_close_on` and `body_html_url`. They must be requested with `fields[]`.

```http
GET https://www.federalregister.gov/api/v1/documents.json
  ?conditions[agencies][]=occupational-safety-and-health-administration
  &conditions[publication_date][gte]=2026-11-13
  &per_page=200&order=newest
  &fields[]=title&fields[]=document_number&fields[]=publication_date&fields[]=type
  &fields[]=abstract&fields[]=action&fields[]=dates&fields[]=effective_on
  &fields[]=comments_close_on&fields[]=cfr_references&fields[]=citation
  &fields[]=html_url&fields[]=pdf_url&fields[]=body_html_url&fields[]=agencies&fields[]=docket_ids
```
**Fetch by date, not by page size** (verified live 2026-11-16). The `publication_date[gte]` lower bound comes from `news_schedule.fr_since()` (Stage 4 · Phase 1 · Part 1): the last success minus 3 days, or the whole retention window on the first sync. Results page through `next_page_url` (`per_page` accepts up to 1000). OSHA publishes ~125–150 documents a year (147 in 2024, 124 in 2025; a 365-day window was 102), so even the first sync is one request at `per_page=200`. Follow `next_page_url` anyway, capped at 10 pages.

Verified response item (observed live for `2026-17726`):
```json
{
  "title": "Rescission of Coordinated Enforcement Regulations",
  "document_number": "2026-17726",
  "publication_date": "2026-08-31",
  "type": "Rule",
  "abstract": "The Department of Labor (Department) is rescinding...",
  "action": "Final rule.",
  "dates": "This final rule is effective September 30, 2026.",
  "effective_on": "2026-09-30",
  "cfr_references": [{ "chapter": null, "citation_url": null, "part": "42", "title": 29 }],
  "citation": "91 FR 55744",
  "html_url": "https://www.federalregister.gov/documents/2026/08/31/2026-17726/rescission-of-coordinated-enforcement-regulations",
  "pdf_url": "https://www.govinfo.gov/content/pkg/FR-2026-08-31/pdf/2026-17726.pdf",
  "body_html_url": "https://www.federalregister.gov/documents/full_text/html/2026/08/31/2026-17726.html",
  "docket_ids": ["Docket No. ETA-2025-0003"]
}
```
`comments_close_on` is a documented FR field that was not in the observed sample. Confirm it comes back on a Proposed Rule before relying on it.

### 4.3 Federal Register Public Inspection (verified `200 OK`, JSON)
```http
GET https://www.federalregister.gov/api/v1/public-inspection-documents.json
  ?conditions[agencies][]=occupational-safety-and-health-administration
```
Default result keys (verified live on 2026-11-16): `agencies, agency_letters, agency_names, docket_numbers, document_number, editorial_note, excerpts, filed_at, filing_type, html_url, json_url, last_public_inspection_issue, num_pages, page_views, pdf_file_name, pdf_file_size, pdf_updated_at, pdf_url, publication_date, raw_text_url, subject_1, subject_2, subject_3, title, toc_doc, toc_subject, type`.

The endpoint lists only what is on file now. It carries no `cfr_references`; CFR links come from the title and excerpts through prose extraction (Phase 2 Part 1).

### 4.4 RSS (verified, not used in v1)
`documents.rss` and `public-inspection-documents.rss` (same `conditions[agencies][]` filter) return `200 application/rss+xml`. Their `<item>`s carry only `title/link/description/pubDate/guid/dc:creator`: no document number, CFR refs or dates. The JSON endpoints above are strictly richer, so v1 reads JSON only. Keep these URLs in the docs as the documented fallback.

### 4.5 DOL Open Data API v4 (`apiprod.dol.gov/v4`)
From `https://apiprod.dol.gov/v4/datasets?limit=100` (all 11 OSHA datasets update `Daily`):
- `inspection` (`id: 10334`): `.../get/OSHA/inspection/json`
- `violation` (`id: 10338`): `.../get/OSHA/violation/json`
- `violation_gen_duty_std` (`id: 10340`), `accident` (`10331`), `accident_abstract` (`10332`), `accident_injury` (`10333`), `accident_lookup2` (`10330`), `related_activity` (`10336`), `emphasis_codes` (`10337`), `optional_code_info` (`10356`), `violation_event` (`10357`)

Query rules from `dol-api-user-guide.pdf` (verified live 2026-11-16):
- Auth: `X-API-KEY` **query parameter** (`?X-API-KEY=…`; the `/v4/get/*` gateway rejects header-only `X-API-KEY` with `401`). Strip request/URL details from logs and exceptions so the key is never printed.
- Empty matches: a valid `filter_object` matching 0 rows returns **HTTP `204 No Content`** with an empty body (`[]`).
- Limits: up to **5 MB or 10,000 records per request** (default `10`).
- Parameters: `limit`, `offset`, `fields` (comma-separated), `sort` (`asc`/`desc`), `sort_by`, `filter_object` (a JSON string with `field`, `operator` ∈ `eq|neq|gt|lt|in|not_in|like`, `value`, plus `and`/`or`).
- Envelope: `{"data": [...]}`.

**Fetch violations first, then inspections.** Citations are issued weeks to months after an inspection opens, so the newest inspections by `open_date` mostly have no violations or penalties yet. The news moment is the **citation issuance**:
1. `violation` sorted `issuance_date desc`, filtered to `issuance_date gt {today − lookback}`. Rows with `delete_flag` set are dropped (Phase 2 Part 2).
2. Group the rows by `activity_nr`, keep the newest `max_inspections`, and fetch those inspections in **one** request with `filter_object {"field": "activity_nr", "operator": "in", "value": [...]}`.

The window comes from `news_schedule.dol_window()` (Stage 4 · Phase 1 · Part 1):
- **normally** 30 days, 1000 rows, 50 inspections;
- **first sync or catching up** (never synced, or last success over 30 days ago): 90 days, 5000 rows, 150 inspections.

`load_dt` exists on the `violation` dataset (catalog metadata, verified 2026-11-16). Keep it in mind as the sort key if `issuance_date` turns out to lag data loads.

**Live check (2026-11-16):** `gt` on `issuance_date`, `in` on integer `activity_nr`, `sort_by=issuance_date`, `5A0001` General Duty codes, and state-plan standards all verified `200 OK` against `apiprod.dol.gov/v4` with `?X-API-KEY=` (newest live `issuance_date` was 32 days old, confirming why first sync uses 90 days and `_dol_get` treats `204` as `[]`; `fetch_dol_inspections` chunks `in` queries at 50 ids because 150 ids produced a ~2.3 KB GET URL rejected with `403`).

## 5. Implementation Sketch (`reader/app/news.py`)

```python
from __future__ import annotations

import json
from datetime import date, timedelta

import httpx

from . import config

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
        raise SourceUnavailable(f"{url}: {e}") from e


FR_PER_PAGE = 200
FR_MAX_PAGES = 10


def fetch_federal_register_documents(c: httpx.Client, agency: str, since: str) -> list[dict]:
    """Every document published on or after `since` (ISO date), following next_page_url."""
    params = [("conditions[agencies][]", agency), ("conditions[publication_date][gte]", since),
              ("order", "newest"), ("per_page", str(FR_PER_PAGE))]
    params += [("fields[]", f) for f in FR_FIELDS]
    url, results = f"{FR_BASE}/documents.json", []
    for _ in range(FR_MAX_PAGES):
        page = _get_json(c, url, params)
        results += page.get("results", [])
        url, params = page.get("next_page_url"), None     # next_page_url carries the query
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
        "published_at": doc.get("publication_date") or "",
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
        "guid": f"fr:{doc['document_number']}",
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


def fetch_enforcement(c: httpx.Client, key: str, days: int, limit: int, max_inspections: int) -> list[dict]:
    """Recent violations -> group_violations -> one inspection request -> one item per inspection
    (Phase 2 Part 2). Arguments come from news_schedule.dol_window()."""
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
        r = c.get(f"{DOL_BASE}/get/OSHA/{dataset}/json", params=params, headers={"X-API-KEY": key})
        r.raise_for_status()
        return r.json().get("data", [])
    except (httpx.HTTPError, ValueError) as e:
        raise SourceUnavailable(f"DOL {dataset}: {e}") from e
```
`empty_item()` returns the full item shape from 4.1 with defaults, so every item has every key. Citation extraction (`sections`, extra `cfr_parts`) and takeaways are added by the worker after fetching, using Phase 2 and Stage 2 · Phase 2 helpers. Fetchers stay pure I/O + mapping.

## 6. Acceptance Criteria
- [ ] Every request sends `User-Agent: FRAMEWORK-ComplianceReader/1.0 (local-reader)`. Nothing spoofs a browser.
- [ ] The FR `fields[]` list includes `cfr_references`, `action`, `effective_on`, `comments_close_on` and `citation`.
- [ ] The FR fetch is bounded by `publication_date[gte]` and follows `next_page_url` (capped at 10 pages).
- [ ] The DOL window (days, row limit, inspection cap) is passed in, never hard-coded in the fetcher.
- [ ] A PI item and its later published document produce the same `guid` (`fr:{document_number}`).
- [ ] Every item has every key from 4.1, and `published_at` is always `YYYY-MM-DD`.
- [ ] With no DOL key the DOL fetchers are never called. With a key it is sent only as the `X-API-KEY` header.
- [ ] Network, HTTP and JSON errors surface as `SourceUnavailable`, never as an unhandled exception.
- [ ] The DOL `gt` date filter and `in` list filter have been verified live with a real key, and the result is noted in 4.5.
