# Stage 3: NAICS Industry Benchmarks & General Duty `5(a)(1)` Index

## Goal
Make non-CFR **General Duty Clause `5(a)(1)`** narratives (`OSHA/violation_gen_duty_std`) searchable alongside federal rules and turn `naics_code` + Title 29 citations into actionable **Industry Benchmarks** (*"What OSHA cites most in NAICS X"*).

---

## Motivation from Verified Data

1. **General Duty Invisible Gap**: Many serious and fatality OSHA inspections cite `5A0001` (Section `5(a)(1)` of the OSH Act) when no specific `29 CFR 1910/1926` rule applies (e.g., heat illness, ergonomics, combustible dust hazards). Currently `normalize_dol_standard("5A0001")` returns no CFR section, so `article_citations` cannot match it on section pages and FTS doesn't index `OSHA/violation_gen_duty_std.line_text`.
2. **NAICS Context**: Every `OSHA/inspection` row carries `naics_code` (6-digit industry classification). Aggregating local violations per NAICS reveals industry citation concentration.

---

## Implementation Plan

### 1. Local FTS5 Indexing of General Duty Narratives (`reader/app/news_store.py`)
1. Add a companion virtual table (idempotent `CREATE VIRTUAL TABLE IF NOT EXISTS` in `connect()`):
   - `gdc_fts USING fts5(activity_nr UNINDEXED, citation_id UNINDEXED, line_text, tokenize = 'porter unicode61')`
2. Populate `gdc_fts` whenever `save_enforcement_case()` persists non-empty `gdc` lines from `OSHA/violation_gen_duty_std` (idempotent delete-then-insert per `activity_nr`).
3. Extend `fts_query()` (or add `search_gdc()` merged into `GET /api/news?q=...` when `category` is `all` or `enforcement`) so searching `"heat"`, `"struck-by"`, or `"5(a)(1)"` surfaces cases whose General Duty hazard description matches, with FTS snippets.

### 2. NAICS Aggregation & Facet Queries (`reader/app/news_store.py`)
1. Add `naics_summary(con, naics: str | None = None, limit: int = 12)` aggregating from `articles` + `enforcement_cases`:
   - Distinct inspections, total `penalty_usd`, and top cited `29 CFR` sections/parts per `naics_code` prefix (supporting 2-digit sector e.g. `23` Construction, 3-digit subsector, or full 6-digit code).
2. Add optional `naics` filter param to `GET /api/news` (exact 6-digit or prefix match `naics LIKE ? || '%'`).

### 3. API Endpoints (`reader/app/routers/news.py`)
1. Add `naics: str | None = Query(default=None)` to `GET /api/news`.
2. Add `GET /api/news/facets` support for `top_naics` alongside `states` (additive fields, preserving snapshot contract or updating golden snapshots cleanly).
3. Add `GET /api/news/enforcement/naics/{code}` returning top cited CFR sections, GDC count, and total penalties for that industry.

### 4. Frontend UI (`reader/frontend/src/views/news.js` & `10_news.css`)
1. Add interactive NAICS pills/facet selector in `#/news?cat=enforcement` (e.g., clicking `NAICS 221320` on an inspection card or Case File filters Enforcement to that industry).
2. Add a clean `"General Duty Clause 5(a)(1)"` filter chip on `#/news?cat=enforcement` (`gdc=1`) reusing existing editorial chips.
3. Inside `enforcementSummaryHtml` or an expandable Industry drawer, list the top cited CFR standards for the active `naics` filter with clickable links straight to the CFR Reader (`#/title/29/section/...`).

---

## Exit Gate
- Searching GDC narrative keywords on `GET /api/news?q=...` returns enriched inspections with `\x02`/`\x03` highlighted snippets.
- Filtering by `naics` (prefix and full 6-digit) narrows Enforcement articles accurately and safely (`no SQL injection`, parameterized prefix `LIKE`).
- Full offline unit + API + Playwright checks pass.
