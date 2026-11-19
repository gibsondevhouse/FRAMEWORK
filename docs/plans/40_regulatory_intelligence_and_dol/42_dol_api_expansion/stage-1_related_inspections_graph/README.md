# Stage 1: Quota Foundation & Bidirectional Related Inspections (`OSHA/related_activity`)

## Goal
Establish shared `DOL_API_KEY` quota stewardship inside `_dol_get()` and connect related OSHA inspections (follow-ups, referrals, multi-employer companion inspections, complaints, and Failure-to-Abate follow-ups) bidirectionally inside `#/news/inspection/{activity_nr}`.

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

> Also pair `fta_insp_nr` from `OSHA/violation` and query `OSHA/related_activity` bidirectionally (`activity_nr eq {nr}` and `rel_act_nr eq {nr}`) so parent and child inspections link both ways.

---

## Implementation Plan

### 1. Shared Quota Stewardship & Client Generalization (`reader/app/news.py`)
1. Generalize `_dol_get(c, key, dataset, params, *, agency="OSHA")` so `DOL_BASE/get/{agency}/{dataset}/json` supports non-OSHA DOL agencies in Stage 5 without breaking existing callers.
2. Add a shared, thread-safe inter-request pacer and `HTTP 429` circuit breaker (`Retry-After` or default 60s cooldown) inside `_dol_get()` so background sync, `/enrich`, live search, and catalog discovery share one quota guard.
3. Update `fetch_dol_recent_violations()` and `fetch_inspection_case()` field lists to request `hazsub1,hazsub2,hazsub3,hazsub4,hazsub5` (matching `_norm_violation_row()`).
4. In `POST /api/news/inspection/{activity_nr}/enrich`, accept optional `force: bool = False`; skip redundant upstream sub-calls only when the cached `enforcement_cases` row already has `enriched_at`, its Stage 1+ `related_json` column is populated, **and** its `case_mod_date` matches the current summary header (when not `force=true`), returning `"cached": true` with `0` upstream sub-calls.

### 2. Storage Migration (`reader/app/news_store.py`)
1. Add `related_json TEXT NOT NULL DEFAULT '[]'` to `enforcement_cases`.
2. In `connect()` (`readonly=False`), inspect `PRAGMA table_info(enforcement_cases)` and apply a non-destructive `ALTER TABLE` / `SCHEMA_VERSION` `2 -> 3` upgrade without dropping `articles` or `enforcement_cases` (updating `connect(readonly=True)` to match `SCHEMA_VERSION`).
3. Update `save_enforcement_case()` to accept `related: list[dict] | None` and `get_enforcement_case()` to return `"related": [...]` enriched with local cache hints (`estab_name`, `open_date`, `penalty_usd` when `rel_act_nr` is already stored locally).

### 3. Bidirectional Fetcher & API Contract (`reader/app/news.py`, `reader/app/routers/news.py`)
1. Add `REL_TYPE_LABELS` for `rel_type` codes (gracefully falling back to normalized code labels when unmapped).
2. In `fetch_inspection_case()`, query `OSHA/related_activity` for `activity_nr eq {nr}` and `rel_act_nr eq {nr}` (deduped by `(rel_act_nr, rel_type)`), plus any distinct `fta_insp_nr` values from violations.
3. Return `"related": [...]` inside `GET /api/news/inspection/{activity_nr}` and `POST /api/news/inspection/{activity_nr}/enrich`.

### 4. Frontend Case File Panel (`reader/frontend/src/views/news_case.ts`, `10_news.css`)
1. Add `inspectionRelatedHtml(data)` rendered inside `renderInspectionCase()` below Citations / General Duty when `related.length > 0`.
2. Render each row as `Inspection #{rel_act_nr}` (`#/news/inspection/${rel_act_nr}`), relationship label (`rel_type` or `FTA Follow-Up`), Safety/Health scope tags, and local establishment + penalty metadata when cached.
3. Keep all styles in `10_news.css` using `01_tokens.css` variables only (zero raw `#hex`).

---

## Exit Gate
- `FakeAPI` in `reader/tests/news_fixtures.py` serves bidirectional `OSHA/related_activity` and `429` `Retry-After` responses.
- `test_news_store.py` verifies non-destructive `SCHEMA_VERSION` `2 -> 3` migration preserving legacy rows.
- Tests verify unchanged `case_mod_date` skips redundant `/enrich` fetches (`0` sub-calls) and shared `429` cooldown blocks immediate follow-up bursts.
- `test_news_api.py` and `test_browser_parity.py` verify `#/news/inspection/{A}` → `#/news/inspection/{B}` navigation, with `REQUIRE_BROWSER=1 pytest tests -q` passing.
