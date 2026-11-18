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

## Order 3 — Frontend Refactor Cleanup & Browser Test Gaps (Completed via Plan 13)

- **Observed state (2026-11-16):**
  - TypeScript was incomplete (`checkJs: false`, 1,231+ diagnostics), 18 mutual 2-way / 68 directed import cycles spanned `nav.js`/`router.js`/`views/`/`components/`/`panels/`, raw `fetch()` calls lived across views, and Python tests sliced `app_js()` source strings.
- **What shipped (2026-11-18 — [`docs/plans/10_platform_and_architecture/13_frontend_architecture_and_hardening/`](../plans/10_platform_and_architecture/13_frontend_architecture_and_hardening/MASTER_PLAN.md)):**
  - **Architecture & Decoupling:** Created `src/api/client.ts`, `src/api/jobs.ts`, `src/core/events.ts`, `src/core/view_dispatch.ts` (`onView`), `src/core/library_meta.ts`, `src/core/news_format.ts`, and `src/core/projects_store.ts`; decomposed `news_case.ts`, `ref_almanac.ts`, `data/home_content.ts`, and `components/part_toc.ts`; consolidated shared reader/`#split-pane` interactions (`createParaToolsController`, `bindBrokenImageFallback`, `hydrateSectionGraph`, `updateRefsBadge`) in `views/doc_utils.ts`. Import graph now has **0 mutual 2-cycles** and **0 multi-file SCCs**.
  - **Strict TypeScript:** Eliminated `unknown` fields in `state.ts`, enabled `"checkJs": true` + `"strict": true` in `tsconfig.json`, and converted all 51 submodules under `reader/frontend/src/` to `.ts` (keeping `main.js` checked via `checkJs: true`); `npx tsc --noEmit` exits `0`.
  - **Hardening & Testing:** Added `AbortController` cancellation + `rAF` batching in `chat.ts`/`search_bar.ts`, `IntersectionObserver` + bounded queue (`4`) in `part_toc.ts`, scroll-sync `ResizeObserver` replacement in `reader_part.ts`, `DOMPurify` + `safeHttpUrl` hardening, modal focus traps + `inert` + ARIA live announcements, and `NEWS_SCOPES` parameterization in `news.ts`.
  - **Tests & CI:** Added `reader/frontend/tests/unit.test.ts` (`npm test` via `rolldown` + `node --test`), retired brittle JS slice assertions in `test_sidebar_rail.py`/`test_news_frontend.py`/`test_settings_env.py` in favor of Playwright behavioral tests in `test_browser_parity.py`, switched `mask.getdata()` -> `get_flattened_data()`, and added Node `npx tsc --noEmit` + `npm test` steps to `.github/workflows/ci.yml`.
