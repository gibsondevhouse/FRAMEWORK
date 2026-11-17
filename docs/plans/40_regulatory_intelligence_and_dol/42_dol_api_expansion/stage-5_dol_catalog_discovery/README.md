# Stage 5: Rate-Safe DOL Catalog Discovery (`/v4/datasets`)

## Goal
Systematically discover and catalog all **`45`+ datasets** hosted under `https://apiprod.dol.gov/v4/datasets` using a **rate-limit-safe, resumable fetcher** so FRAMEWORK has an accurate, verified inventory of which non-OSHA DOL datasets (e.g., Wage & Hour, OWCP, EBSA, MSHA) exist and which **Title 29 / Title 30 CFR** parts they map to for future plans.

---

## Observed API Behavior (2026-11-17 Probe)

- `GET /v4/datasets?limit=200&X-API-KEY=...` returned `meta.total_count: 45` (observed `OWCP_energy_statistics_weekly_20260101_present` in page results before consecutive burst requests triggered **`HTTP 429`**).
- Because catalog metadata changes infrequently, discovery must be **explicitly invoked and locally persisted**, never polled in a hot loop or run inside normal tests.

---

## Implementation Plan

### 1. Resumable Paced Discovery Client (`reader/app/dol_catalog.py` or `reader/app/news.py`)
1. Implement `fetch_dol_catalog(c, key, *, page_size=20, delay_s=2.0, max_retries=2)`:
   - Iterates `offset=0, page_size, ...` until `total_count` is collected (3 requests max at `page_size=20`).
   - Inserts a deliberate pause (`delay_s`) between pages when running live; respects `Retry-After` / stops gracefully on `429` while saving already-fetched partial pages.
   - Extracts each dataset's canonical API slug (`agency/dataset`), human title, agency, update frequency, description, and field schema list (only fetching schema samples when explicitly requested).
2. Add CFR mapping heuristics (`map_dataset_to_cfr(entry)`):
   - Inspects dataset agency/title/description against known regulatory domains (e.g., OSHA -> `29 CFR 1900–1999`, WHD/FLSA/FMLA -> `29 CFR 500–899`, MSHA -> `30 CFR 1–199`, EBSA/ERISA -> `29 CFR 2509–2590`, OWCP -> `20 CFR`).
   - Marks mapped slugs clearly as `candidate` until verified against live row samples (`200 OK` vs `500` upstream).

### 2. Catalog Persistence (`reader/app/news_store.py`)
1. Add idempotent DDL for `dol_datasets` table inside `osha_news.sqlite3` (optional/non-destructive):
   - Columns: `slug TEXT PRIMARY KEY`, `agency TEXT`, `title TEXT`, `frequency TEXT`, `cfr_title INTEGER`, `cfr_parts_json TEXT`, `raw_json TEXT`, `status TEXT`, `discovered_at TEXT`.
2. Add `save_dol_catalog(con, entries)` and `list_dol_catalog(con)`.

### 3. CLI / Read-Only Settings Exposure (`reader/app/routers/news.py` + optional CLI entrypoint)
1. Expose read-only `GET /api/news/dol/catalog` returning locally stored `dol_datasets` grouped by agency and mapped CFR title (never triggers network calls).
2. Provide an opt-in trigger (`POST /api/news/dol/catalog/refresh` or CLI helper `python -m app.dol_catalog`) protected behind `DOL_API_KEY` + cooldown lock (`409` while running, `503` if key absent) so discovery runs safely on user demand.
3. Surface a clean read-only summary table inside Settings (`#/settings` or `#/news` source info drawer) showing discovered DOL agencies and candidate CFR links for future Plan 43+ expansion.

---

## Exit Gate
- Offline tests using paginated `FakeAPI` fixtures verify multi-page collection, `429` partial-save recovery, zero secret leakage in errors, and read-only `GET /api/news/dol/catalog`.
- Optional manual live verification run (`DOL_API_KEY`) records the verified inventory of all `45` datasets into a checked-in reference table inside `docs/plans/40_regulatory_intelligence_and_dol/42_dol_api_expansion/DOL_CATALOG_INVENTORY.md` for future plans.
- `REQUIRE_BROWSER=1 pytest tests -q` passes and `route_inventory.json` snapshot is updated.
