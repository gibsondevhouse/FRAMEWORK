# Stage 3: Narratives FTS5 (GDC + Accidents), NAICS Benchmarks & Emphasis Facets

## Goal
Index **both** General Duty Clause `5(a)(1)` (`OSHA/violation_gen_duty_std`) and **Accident / Fatality Abstracts** (`OSHA/accident*`) in SQLite FTS5, unlock unused DOL fields (`emphasis`, `hazcat`, `state_flag`), deliver `naics_code` industry benchmarks, and populate local search automatically via spaced priority enrichment.

---

## Motivation from Verified Data

1. **Dual Narrative Blind Spot:** `fetch_inspection_case()` already fetches `OSHA/violation_gen_duty_std` (`5A0001` hazards with no CFR section) **and** `OSHA/accident` / `OSHA/accident_injury` / `OSHA/accident_abstract` (`event_desc`, `event_keyword`, `fatality`, `fall_distance`, `fat_cause`, `abstract_text`), yet neither is FTS-indexed today.
2. **Unused High-Signal Fields:** `OSHA/violation` and `OSHA/inspection` already supply `emphasis` (NEP/LEP campaigns like Trenching, Silica, Heat), `hazcat`, and `state_flag` (Federal OSHA vs. State Plan — separating state-plan codes avoids skewing Title 29 metrics).
3. **Empty Index Cold-Start:** If narrative indexes only fill on manual `/enrich` clicks, FTS over GDC/accidents starts mostly empty after a fresh sync.

---

## Implementation Plan

### 1. Unified Narratives FTS5 Index (`reader/app/news_store.py`)
1. Create virtual table (idempotent in `connect()`):
   - `enforcement_narratives_fts USING fts5(activity_nr UNINDEXED, kind UNINDEXED, ref_id UNINDEXED, body_text, tokenize = 'porter unicode61')` (`kind` ∈ `'gdc' | 'accident'`).
2. Whenever `save_enforcement_case()` persists non-empty `gdc` lines or `accidents` entries (`event_desc`, `keywords`, `fat_cause`, `abstract`), delete-and-reinsert that `activity_nr`'s rows atomically.
3. Merge `search_narratives()` into `GET /api/news?q=...` (when `category` is `all` or `enforcement`) so searching `"heat"`, `"trench"`, `"forklift"`, or `"fall"` surfaces matching cases with `\x02`/`\x03` snippets.

### 2. Industry Benchmarks & High-Signal Facets (`reader/app/news_store.py`, `reader/app/routers/news.py`)
1. Add `naics_summary(con, naics: str | None = None, *, federal_only: bool = False, limit: int = 12)` aggregating distinct inspections, total `penalty_usd`, GDC count, fatality count, and top cited `29 CFR` sections/parts by `naics_code` prefix (2/3/6-digit).
2. Add optional query params to `GET /api/news`: `naics`, `gdc` (`1`), `fatality` (`1`), `emphasis`, `hazcat`, and `jurisdiction` (`all | federal | state_plan` via `state_flag`).
3. Extend `GET /api/news/facets` with `top_naics`, `emphasis_codes`, and `jurisdictions`, and add `GET /api/news/enforcement/naics/{code}`.

### 3. Spaced Priority Background Enrichment (`reader/app/news_worker.py`, `reader/app/news.py`)
1. After a scheduled DOL sync finishes, allow `news_worker` to trickle-enrich a strictly small cap (e.g., **max `3–5` un-enriched cases per 24h sync**) prioritized by `insp_type IN ('A', 'M')` or `general_duty > 0`.
2. Run through `_dol_get()`'s shared rate-pacer (`>= 2s` spacing) and abort immediately on `HTTP 429` without failing the main sync status or starving interactive Stage 4 queries.

### 4. Frontend UI (`reader/frontend/src/views/news.ts`, `10_news.css`)
1. Keep `#/news?cat=enforcement` primary chips focused and uncluttered: **NAICS**, **`5(a)(1)` General Duty**, **`Fatality / Accident`**, and **Federal OSHA / State Plan** (`state_flag`), surfacing `emphasis` / `hazcat` inside Case File metadata and a compact secondary dropdown rather than top-bar chip sprawl.
2. Surface top cited `29 CFR` sections (linking straight to `#/title/29/section/...`) for the active NAICS filter inside `enforcementSummaryHtml()` or a compact industry drawer.

---

## Exit Gate
- Searching GDC or accident abstract terms on `GET /api/news?q=...` returns enriched inspections with `\x02`/`\x03` snippets.
- `jurisdiction=federal` cleanly excludes state-plan `unmapped_standards` from federal Title 29 rollups.
- `news_worker` priority backfill respects `429` circuit breaker and never starts under test.
- Full offline unit + API + Playwright checks pass.
