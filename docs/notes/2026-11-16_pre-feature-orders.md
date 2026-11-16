# Pre-Feature Cleanup Notes (Orders 1–3)

*Recorded: 2026-11-16 · Baseline: `main` after Stage 6 (`7ce794e`)*

Lightweight dev log tracking the three pre-feature cleanup orders so future work can spin small, targeted tasks from them rather than full multi-stage plan trees.

---

## Order 1 — Resolve Orphaned Worktree & Merged Branches (Completed)

- **Decision:** Port the orphaned first-run profile picker (`claude/quizzical-cori-20290c`, commit `49c94da`) cleanly onto the modular `main` architecture rather than discarding it, then delete the stale worktree and merged `stage-*` branches.
- **Why:** Auto-building Title 29 inside FastAPI `lifespan` blocked first startup (and crashed offline), forced non-OSHA users to download ~28 MB of Title 29 before seeing the UI, and conflicted with `DELETE /api/library/{t}` refusing to delete the only installed title.
- **What shipped:**
  - `reader/app/profiles.py` (`PROFILES`, `HAZMAT_PARTS`, `TITLE_NAMES` for 1–50) + `GET /api/profiles` in `reader/app/routers/reader.py`.
  - `reader/app/main.py` `lifespan` no longer builds Title 29 when `DATA_DIR` is empty.
  - `reader/app/routers/reader.py` & `chat.py`: `search_global` validates non-`"all"` titles (`404`), and legacy un-prefixed Title 29 aliases (`/api/meta`, `/api/tree`, `/api/section/…`, `/api/part/…`, `/api/models`, `/api/chat`) call `deps.valid_installed_title(29)` so they return `404` instead of `FileNotFoundError` (`500`) when Title 29 is absent.
  - Frontend: `reader/frontend/src/views/welcome.js`, `state.ts`/`state_init.js` (`noTitles`), `router.js`, `main.js`, `components/title_switcher.js` (`setReaderEnabled`), `components/transfer_dock.js` (`refreshTitles` wakes reader & exits `.welcome` when the first title lands), `components/chat.js`, `components/search_bar.js`, `components/env_modal.js`, `nav.js`, `views/library.js`, and `.welcome*` tokens in `styles/05_home_overview_lib.css`.
  - Cross-title verticals (`/library`, `/news`, `/projects`, `/settings`, `/help`) stay reachable while `noTitles` is true (improved over the original `49c94da` draft, which gated everything except `/library`).
  - Tests & cleanup: `reader/tests/test_profiles.py`, `reader/tests/test_empty_server.py`, `route_inventory.json` + `get_profiles.json` snapshots, Playwright empty-server behavioral check in `test_browser_parity.py`; removed `.claude/worktrees/quizzical-cori-20290c`, `claude/quizzical-cori-20290c`, and merged local `stage-0-*`…`stage-6-*` branches (keeping `stage-*-passed` tags).

---

## Order 2 — Debug Live `dol_osha` Sync & Error Reporting (Completed)

- **Root causes found (live probe 2026-11-16 against `apiprod.dol.gov/v4`):**
  1. `apiprod.dol.gov/v4/get/OSHA/*` rejected header-only `X-API-KEY` with **HTTP `401`** (*"The API key is either incorrect or missing from your query"*), whereas `?X-API-KEY=` in query params returned **`200 OK`**.
  2. With a 30-day window (`issuance_date gt 2026-10-17`), DOL returned **HTTP `204 No Content`** with an empty body because the newest live violation row was `2026-10-15T00:00:00` (32 days old); `_dol_get` called `r.json()` unconditionally, crashing with `JSONDecodeError`.
  3. On catch-up / first sync (`150` inspections), a single `in` query hit **HTTP `403 Forbidden`** (`url_len=2295` exceeded API Gateway/WAF ~2 KB GET URL limit), whereas batches of `50` (`url_len=994`) succeeded with **`200 OK`**.
  4. Verified live: `filter_object` `gt` on `issuance_date`, `in` on integer `activity_nr`, `sort_by=issuance_date` + `sort=desc`, `normalize_dol_standard`, `is_general_duty` (`5A0001`), and state-plan standards (`296-800-15030`) all worked against real DOL data.
- **What shipped:**
  - `reader/app/news.py`: `_dol_get` passes `X-API-KEY` via `params` (keeping query/request URLs out of tracebacks with `from None`), handles `204` / empty responses as `[]`, preserves `HTTP {status}` in `SourceUnavailable`, and `fetch_dol_inspections` chunks `activity_nr` lists in batches of `50` (`DOL_INSP_BATCH`).
  - `reader/app/news_schedule.py`: `dol_window` uses the `(90, 5000, 150)` catch-up window on first sync (`last_ok_at is None`) as well as `>30` days stale.
  - `reader/app/news_worker.py` & `reader/frontend/src/views/news.js`: `sync_status.last_error` retains safe error details (e.g., `(HTTP 401)`), and `#/news` exposes `failed.last_error` in the status pill tooltip (`title`).
  - `reader/tests/test_news_fetch.py` & `test_news_schedule.py`: updated for query-param auth, `204` handling, non-leaking HTTP errors, and first-sync `dol_window`.
  - *(Future, separate task)*: Multi-agency News expansion (EPA/PHMSA) currently capped by `config.news_agencies()[0]` in `news_worker.py` and Title-29-only filtering in `news.extract_citations`.

---

## Order 3 — Frontend Refactor Cleanup & Browser Test Gaps (Pending)

- **Observed state (2026-11-16):**
  - **TypeScript (Stage 5D) incomplete:** 2 of 34 frontend source files are `.ts` (`state.ts` with all `any`s; 3-line `citations.ts`); `tsconfig.json` has `checkJs: false` (enabling `--checkJs` yields **1,231 errors**); `src/api/` and `src/types/` do not exist; `.github/workflows/ci.yml` does not run `tsc --noEmit`.
  - **ES module coupling:** Automated `acorn` split left **18 mutual 2-way / 68 directed import cycles** across `nav.js`, `router.js`, `views/`, `components/`, `panels/`, and three large files (`components/sidebar.js` 789 lines, `views/library.js` 745 lines, `views/news.js` 646 lines).
  - **Brittle JS slice tests:** `test_settings_env.py`, `test_news_frontend.py`, and `test_sidebar_rail.py` still slice `tests/frontend_sources.app_js()` by function/comment boundaries.
  - **Browser test & warning gaps:** `test_browser_parity.py` does not yet cover active Transfer Dock progress/cancel, Library download actions, News search/tabs/facets/in-reader popover, Settings controls, or full-part scroll anchoring; `mask.getdata()` at `test_browser_parity.py` emits 6 Pillow `DeprecationWarning`s (`get_flattened_data()`).
- **Lightweight next steps (can be tackled as small independent PRs):**
  1. Replace JS slice assertions in `test_settings_env.py`, `test_news_frontend.py`, and `test_sidebar_rail.py` with Playwright checks in `test_browser_parity.py`, and switch `mask.getdata()` -> `get_flattened_data()`.
  2. Extract a shared `src/api/` client module and break the `nav.js` / `router.js` / `views/` circular imports (e.g., lightweight callbacks/bridge) before adding Phase 2 HSE UI tools.
  3. Incrementally type `AppState` and convert modules `.js` -> `.ts` (optionally add `npx tsc --noEmit` to `.github/workflows/ci.yml`).
