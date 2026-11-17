# Stage 1: Related Inspections Cross-Links (`OSHA/related_activity`)

## Goal
Connect related OSHA inspections (follow-ups, referrals, multi-employer companion inspections, complaints) directly inside the **Inspection Case File** (`#/news/inspection/{activity_nr}`) so investigators can click across linked inspections in-app instead of dead-ending at external portals.

---

## Verified DOL Schema (`OSHA/related_activity`, `HTTP 200 OK`)

| Field | Example / Type | Meaning |
| :--- | :--- | :--- |
| `activity_nr` | integer | Parent/queried inspection ID |
| `rel_type` | string / code | Relationship type (e.g., Accident, Complaint, Referral, Related, Programmed) |
| `rel_act_nr` | integer | Linked inspection ID (target of `#/news/inspection/{rel_act_nr}`) |
| `rel_safety` | `"Y"` / `null` | Related safety inspection flag |
| `rel_health` | `"Y"` / `null` | Related health inspection flag |
| `load_dt` | ISO timestamp | Warehouse load timestamp |

> Also check bidirectional links: query `activity_nr eq {nr}` AND keep room to check `rel_act_nr eq {nr}` or resolve local metadata if `rel_act_nr` already exists in `enforcement_cases` / `articles`.

---

## Implementation Plan

### 1. Storage Migration (`reader/app/news_store.py`)
1. Add `related_json TEXT NOT NULL DEFAULT '[]'` column to `enforcement_cases`.
2. In `connect()` (`readonly=False`), inspect `PRAGMA table_info(enforcement_cases)` and run `ALTER TABLE enforcement_cases ADD COLUMN related_json TEXT NOT NULL DEFAULT '[]'` when absent (preserving `PRAGMA user_version = 1` and all cached rows).
3. Update `save_enforcement_case()` to accept `related: list[dict] | None` and `get_enforcement_case()` to parse and return `"related": [...]` plus local enrichment hints (whether each `rel_act_nr` is already cached with `estab_name`, `open_date`, `penalty_usd`).

### 2. Fetcher & Enricher (`reader/app/news.py`)
1. Add `REL_TYPE_LABELS` map for `rel_type` codes (verify exact IMIS `rel_type` meanings against live `OSHA/related_activity` records or display clean normalized codes when unmapped).
2. In `fetch_inspection_case(c, key, activity_nr)`, fetch `OSHA/related_activity` filtered by `activity_nr eq {activity_nr}` (limit `100`). Also hydrate summary headers for up to 1 batch (`DOL_INSP_BATCH`) of `rel_act_nr`s via `OSHA/inspection` if they are not already in `enforcement_cases`, or defer individual inspection fetch until clicked (`GET /api/news/inspection/{rel_act_nr}` + auto-enrich on demand).

### 3. API Contract (`reader/app/routers/news.py`)
1. Return `"related": [...]` inside `GET /api/news/inspection/{activity_nr}` and `POST /api/news/inspection/{activity_nr}/enrich`.
2. When `GET /api/news/inspection/{activity_nr}` is requested for an `activity_nr` not yet stored in `osha_news.sqlite3` (e.g., clicking an uncached `rel_act_nr`), either return `{ "cached": false, "activity_nr": ... }` cleanly for the UI to trigger `POST /enrich`, or document explicit `Refresh from DOL` CTA inside the uncached shell.

### 4. Frontend Case File Panel (`reader/frontend/src/views/news.js` & `10_news.css`)
1. Add `inspectionRelatedHtml(data)` rendered inside `renderInspectionCase()` as a subtle editorial panel below Citations / General Duty when `related.length > 0`.
2. Each row shows `Inspection #{rel_act_nr}` (linked to `#/news/inspection/${rel_act_nr}`), relationship label (`rel_type`), Safety/Health scope tags, and if cached locally, establishment name + total penalty.
3. Add CSS rules in `10_news.css` using tokens from `01_tokens.css` only (no raw hex values).

---

## Exit Gate
- `FakeAPI` in `reader/tests/news_fixtures.py` serves `OSHA/related_activity` fixtures.
- `test_news_store.py` verifies non-destructive `ALTER TABLE` upgrade on a legacy v1 `enforcement_cases` table without `related_json`.
- `test_news_api.py` and `test_browser_parity.py` verify clicking a related inspection navigates `#/news/inspection/{A}` -> `#/news/inspection/{B}`.
- `REQUIRE_BROWSER=1 pytest tests -q` passes with rebuilt `reader/static/dist/`.
