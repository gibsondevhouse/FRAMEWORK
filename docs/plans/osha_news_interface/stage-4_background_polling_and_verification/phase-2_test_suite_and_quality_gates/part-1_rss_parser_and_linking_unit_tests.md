# Stage 4 · Phase 2 · Part 1: Offline Tests

## 1. Objectives
Offline `unittest.TestCase` suites (pytest collects them), following the repo's existing patterns. They use fixtures shaped exactly like the verified live payloads and **never touch the network**: an autouse guard patches `httpx.Client.send` to raise in every news test module. Write each suite alongside the part it covers, not at the end.

## 2. Fixtures (`reader/tests/news_fixtures.py`)
Field names are copied from live responses (FR documents: Stage 1 · Phase 1 · Part 1 §4.2; PI keys: §4.3, verified 2026-11-16; DOL: Stage 1 · Phase 2 · Part 2 §2).
- `FR_DOCS_JSON`: three results: a Rule (the observed `2026-17726`, with `cfr_references` part 42), a Proposed Rule with `comments_close_on` and a prose `29 CFR 1910.1200(a)(1)` in the abstract, and a Notice with no CFR refs.
- `PI_JSON`: two results, one sharing `document_number` with a published fixture (to test the no-duplicate path), one only on file. They use the real keys (`filed_at`, `filing_type`, `publication_date`, `docket_numbers`, …).
- `DOL_VIOLATIONS`: rows for two inspections. They include a deleted row (`delete_flag` set), a `"19101030 G02   IIA"` Willful, a `"19260501 B13"` Serious, a General Duty code, a non-matching state-plan code, and a row with an empty `current_penalty` and an `initial_penalty`.
- `DOL_INSPECTIONS`: the two matching inspection rows (e.g. `activity_nr 306953084`, `estab_name "CHRISTMAS TREE SHOPS"`, `SALEM`, `NH`, `insp_type "F"`).
- `CITATION_CASES`: one shared table of `(text, expected_sections, expected_parts)` for both the Python and the JS linkifier checks.

FR/DOL HTTP is faked with `httpx.MockTransport`, routed on path. The handler also records request headers and params so the tests can assert on them.

## 3. Suites

### `tests/test_news_parsing.py` (pure functions; no DB)
- `normalize_dol_standard`: the cases in Stage 1 · Phase 2 · Part 1 §5, including `""`, `None` and `"5A0001"` → `None`.
- `is_general_duty`, and that state-plan codes are counted as `unmapped_standards`.
- `extract_citations` over `CITATION_CASES`, including the negatives (`$1999.5 million`, `§ 541.100`, `40 CFR 261.3`).
- `group_violations`: drops deleted rows, groups by `activity_nr`, keeps the newest `max_inspections` (try 1 and 50).
- `build_enforcement_article`: guid, state, `published_at` = newest `issuance_date`, the penalty fallback per row, sorted `sections`, `violation_types`, the General Duty count.
- `takeaways`: exactly three bullets per kind (rule, proposed rule, notice, PI, enforcement), and every fallback string in Stage 2 · Phase 2 · Part 1 §2.
- `fr_document_item` / `pi_item`: same guid for the same `document_number`, `published_at` always `YYYY-MM-DD`, every item-shape key present.

### `tests/test_news_schedule.py` (pure functions; fixed aware `now` values, no clock or sleep)
- `latest_window` / `is_stale` for `federal_register`:
  - a success Monday 06:20 ET is fresh until Tuesday 06:15;
  - a success Friday 06:20 ET is still fresh Saturday, Sunday, and Monday 06:14;
  - it becomes stale Monday 06:15.
- `federal_register_pi`: stale at 09:00, 11:30 and 16:30 ET in turn; a success at 16:31 Friday is fresh until Monday 09:00.
- `dol_osha`: stale exactly 24h after the last success, weekends included.
- `last_ok_at = None` is always stale.
- **DST**: a window on the Monday after the November change and one in July both land at 06:15 *local* (11:15 vs 10:15 UTC).
- **Holidays are not skipped**: a weekday federal holiday is treated as a business day (asserted on purpose, so nobody adds a holiday table by accident).
- `retry_after`: 5m, 15m, 1h, 6h, and still 6h at the 9th failure; `None` at `fail_count = 0`. `is_due` is false inside a backoff and true after it.
- `fr_since`: first sync → today − retention days; otherwise the last success date − 3 days (in ET).
- `dol_window`: `None` → (30, 1000, 50); 10 days ago → (30, 1000, 50); 45 days ago → (90, 5000, 150).

### `tests/test_news_fetch.py` (MockTransport)
- The FR request carries the honest User-Agent, every required `fields[]` (`cfr_references`, `action`, `effective_on`, `comments_close_on`, `citation`), and `conditions[publication_date][gte]` from `since`.
- FR paging: a first page with `next_page_url` and a second without it gives both pages' items; a page chain longer than 10 stops at 10.
- The DOL violation request uses the `days` / `limit` it is given, and `max_inspections` caps the inspection `in` list.
- `news_worker.sync_sources(["federal_register_pi"])` touches only the PI endpoint (no FR or DOL requests).
- `news_worker.due_sources(now)` with a seeded `sync_status` returns exactly the stale, non-backoff sources, and DOL only when a key is set.
- `request_sync(force=False)` with everything fresh queues nothing. `request_sync(force=True)` queues every enabled source, even one in backoff. (Tested without starting the thread: it only reads state and sets the wake event.)
- The DOL fetchers send `X-API-KEY` as a header (never in the URL), use the `in` filter on `activity_nr`, and make exactly two requests for enforcement.
- 500, timeout and malformed JSON each raise `SourceUnavailable`.
- `news_worker.sync_sources([...all three])` with FR failing still stores PI and DOL items, and records the FR error (`fail_count` 1) in `sync_status`.
- Without `DOL_API_KEY`, no DOL request is made.

### `tests/test_news_store.py` (temp `DATA_DIR`, like `fake_titles.py`)
- `init_db` creates the schema under the patched `config.DATA_DIR`, and running it twice is harmless.
- An upsert is idempotent: one `articles` row, one FTS row, and stable citation rows.
- PI then published → one row, published. Published then PI → still published (`upsert_article` returns `False`).
- `prune` removes old rows from all three tables, and stale PI rows past `scheduled_on + 7`.
- Foreign keys are on (deleting an article cascades its citations).
- `record_error` twice → `fail_count` 2 with `last_ok_at` unchanged. Then `record_ok` → `fail_count` 0 and `last_error` cleared. `sync_rows()` returns aware UTC datetimes.

### `tests/test_news_api.py` (TestClient without lifespan, seeded store)
- **Route ordering:** `GET /api/news/section/1910.1030` and `/api/news/part/1910` return 200 (not 422).
- `/api/news`: each category; `q` (FTS, plus `§ 1910.1030` and `91 FR 55744` lookups); `section`; `part`; `state`; `min_penalty`; `gravity`; combinations; `limit`/`offset`/`total`; JSON columns returned as arrays; 422 for a bad `category`/`state`/`gravity`.
- FTS syntax in `q` (`"`, `*`, `NEAR(`, `-x`, `col:`) returns 200.
- `/api/news/status`: `dol_configured` follows the environment; counts per category; per-source `stale` / `retry_after` / `next_due_at` / `fail_count` from a seeded `sync_status` (with `news_schedule`'s clock patched); top-level `due`. Calling it never sets the worker's wake event.
- `/api/news/facets`: states with counts.
- `/api/news/refresh`: `{"force": true}` → 202 with every enabled source; `{"force": false}` with fresh sources → 200 `{"queued": []}`; with a stale source → 202 with just that source. 409 while a sync is "running" (hold the lock in the test), 503 with `NEWS_SYNC=0`.
- A fresh `DATA_DIR` with no news DB: every endpoint returns empty, well-formed results.
- No thread named `news-worker` is alive.

### Updated: `tests/test_sidebar_rail.py`
The new rail order and link set, the `data-keys` shortcut regex (`G [OHCPNLS]`), `GO_KEYS.n`, and Alt 1–7 (Stage 2 · Phase 1 · Part 3 §7).

### JS linkifier parity (`tests/test_news_frontend.py`)
The repo has no JS test runner, so follow `test_sidebar_rail.py` and assert on the source: `NEWS_CITE_RE` in `app.js` is the agreed pattern. Then run `CITATION_CASES` through a Python port of that regex (`re.compile` of the same string with the JS-only flags mapped) to keep the two in step.

## 4. Acceptance Criteria
- [ ] `cd reader && ../.venv/bin/python -m pytest tests -q` passes on a fresh clone with no network and no titles or news installed.
- [ ] The news suites add no noticeable time (target: under 1s together).
- [ ] Fixture field names match the live payloads. Re-check them against a live call whenever a fetcher changes, and note the date in the fixture docstring.
