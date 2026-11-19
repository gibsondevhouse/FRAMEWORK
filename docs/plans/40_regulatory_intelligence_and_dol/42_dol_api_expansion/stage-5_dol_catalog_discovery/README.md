# Stage 5: CLI-First DOL Catalog Discovery & Schema Probe (`/v4/datasets`)

## Goal
Systematically discover, health-check, and schema-probe all **`45+` datasets** hosted under `https://apiprod.dol.gov/v4/datasets` via a **rate-limit-safe CLI tool**—giving FRAMEWORK a verified, machine-readable inventory of non-OSHA DOL sources (**WHD**, **EBSA**, **MSHA**, **OWCP**) and their real columns mapped to **Title 20 / Title 29 / Title 30 CFR** parts, without adding premature Settings/News UI until Plan 43+.

---

## Observed API Behavior (2026-11-17 Probe)

- `GET /v4/datasets?limit=200&X-API-KEY=...` returned `meta.total_count: 45` (observed `OWCP_energy_statistics_weekly_20260101_present` before consecutive burst requests triggered **`HTTP 429`**).
- Three OSHA sub-endpoints (`OSHA/optional_info`, `OSHA/history`, `OSHA/strategic_codes`) returned **`HTTP 500`**, proving that catalog presence alone does not guarantee endpoint health.

---

## Implementation Plan

### 1. Resumable Paced Discovery & `limit=1` Probe (`reader/app/dol_catalog.py`)
1. Implement `fetch_dol_catalog(c, key, *, page_size=20, delay_s=2.0, probe_schemas=False)`:
   - Collects `/v4/datasets` pages via `_dol_get()`'s shared rate-pacer, saving partial pages cleanly if `HTTP 429` occurs.
   - When `--probe` (`probe_schemas=True`) is passed on explicit CLI invocation, performs one spaced `GET /v4/get/{agency}/{dataset}/json?limit=1` per candidate dataset using the agency-parameterized `_dol_get()` from Stage 1, recording:
     - `probe_status`: `healthy_200` | `empty_204` | `upstream_500` | `rate_limited` | `unprobed`
     - `fields_json`: actual column keys observed from the sample row.
2. Add CFR mapping heuristics (`map_dataset_to_cfr(entry)`):
   - OSHA → `29 CFR 1900–1999`, WHD/FLSA/FMLA → `29 CFR 500–899`, EBSA/ERISA → `29 CFR 2509–2590`, MSHA → `30 CFR 1–199`, OWCP → `20 CFR`.

### 2. Catalog Persistence (`reader/app/news_store.py`)
1. Add idempotent `CREATE TABLE IF NOT EXISTS dol_datasets` inside `osha_news.sqlite3`:
   - Columns: `slug TEXT PRIMARY KEY`, `agency TEXT`, `title TEXT`, `frequency TEXT`, `probe_status TEXT NOT NULL DEFAULT 'unprobed'`, `fields_json TEXT NOT NULL DEFAULT '[]'`, `cfr_title INTEGER`, `cfr_parts_json TEXT`, `raw_json TEXT`, `discovered_at TEXT`.
2. Add `save_dol_catalog(con, entries)` and `list_dol_catalog(con)`.

### 3. CLI Entrypoint & Checked-In Inventory (No Frontend UI Yet)
1. Provide `python -m app.dol_catalog [--probe] [--write-doc]` reading `DOL_API_KEY` from `reader/.env` cleanly without logging keys/URLs.
2. Defer any `/api/news/dol/catalog` HTTP routes or `#/settings` UI tables to **Plan 43+** once non-OSHA datasets actually power end-user workflows—keeping Plan 42's UI and snapshot surface lean.

---

## Exit Gate
- Offline tests using paginated `FakeAPI` fixtures verify multi-page collection, `429` partial-save recovery, `limit=1` `200`/`204`/`500` status recording, and zero key leakage.
- Optional manual live CLI run (`python -m app.dol_catalog --probe --write-doc`) records all `45+` verified datasets into `docs/plans/40_regulatory_intelligence_and_dol/42_dol_api_expansion/DOL_CATALOG_INVENTORY.md`.
- Full test suite (`REQUIRE_BROWSER=1 pytest tests -q`) passes cleanly.
