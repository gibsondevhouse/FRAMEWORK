# Coding Agent Execution Prompt — OSHA Regulatory News Interface

## Role
You are a senior full-stack engineer (Python / FastAPI / SQLite FTS5 + vanilla ES6 JS / CSS) working in the **FRAMEWORK** repository (`reader/`).

Execute the finalized **OSHA Regulatory Intelligence & News Interface** plan in `docs/plans/osha_news_interface/`.

Before writing any code, read:
1. `CLAUDE.md`
2. `docs/plans/osha_news_interface/MASTER_PLAN.md`
3. `docs/plans/osha_news_interface/REFETCH_CADENCE_RESEARCH.md`
4. The Stage, Phase, and Part specs in `docs/plans/osha_news_interface/` as you reach each step.

---

## Environment & Constraints
- **OS / Python:** macOS, Python 3.12 venv at repo root `.venv/`. Always run commands from `reader/` (`cd reader`).
  - Run server: `../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`
  - Run tests: `../.venv/bin/python -m pytest tests -q`
- **Dependencies:** Standard library + existing packages only (`fastapi`, `uvicorn[standard]`, `httpx`, `anthropic`, `python-dotenv`, `pytest`). Do **not** add npm/bundlers or new Python packages.
- **No scraping / no spoofing:** Every outbound request must send `User-Agent: FRAMEWORK-ComplianceReader/1.0 (local-reader)`. Never fetch `osha.gov/rss` or `dol.gov/rss`, and never spoof a browser User-Agent.
- **Do not edit anything under `docs/plans/`** during implementation (update `CLAUDE.md`, `README.md`, `reader/README.md`, `reader/API.md`, and `reader/.env.example` at the end).

---

## Scope & Hard Rules (from `MASTER_PLAN.md`)
1. **OSHA only** (`NEWS_AGENCIES`, default `occupational-safety-and-health-administration`).
2. **Deterministic takeaways:** `news.takeaways(item)` builds three fixed bullets server-side from record fields. No LLM summaries.
3. **No interpretations:** Do not add OSHA letters of interpretation or directives anywhere in the UI or timeline.
4. **Search stays in `#/news`:** Do not touch topbar `#/search`, `/api/search`, or Claude's tools.
5. **Graceful no-key degradation:** Federal Register JSON endpoints work with zero credentials. DOL Open Data API v4 (`apiprod.dol.gov/v4`) activates only when `DOL_API_KEY` is set in `reader/.env` (passed via `X-API-KEY` header, never in URLs). Without it, the Enforcement tab renders the setup card linking to `https://dataportal.dol.gov/registration`.
6. **UI conventions:**
   - Use existing CSS tokens (`--bg`, `--panel`, `--field`, `--card`, `--card-hover`, `--line`, `--line-strong`, `--fg`, `--fg-2`, `--fg-3`, `--fg-strong`, `--accent`, `--warn`, `--partial`, `--danger`) and classes (`.btn`, `.btn-sm`, `.btn-accent`, `.ar-btn`, `.lib-seg`). Never use `.is-brand`.
   - Use `icon()` / `ICON_PATHS` 16px stroked SVGs (add a `news` icon path) and literal inline SVG in `index.html`. Zero emoji or Unicode arrows (`↗`, `›`, `🔴`).
   - Use `statPill()` strictly for sync/freshness states—never for penalties or FR citations.
   - No inline `onclick` handlers; use delegated listeners on `#view` / `#sidebar`.
   - Always sanitize with `escapeHtml()`, validate external URLs with `safeHttpUrl()` (`http:`/`https:` only, `target="_blank" rel="noopener"`), guard async loaders with `routeSeq`, and wrap `localStorage` via `lsGet`/`lsSet`.

---

## Build Order & Tasks

Work strictly in this order, writing offline tests alongside each step and running `../.venv/bin/python -m pytest tests -q` after every step:

### Step 1 — Stage 1: Config, Fetchers, Store, Citations & API (`reader/app/`)
1. **Config (`app/config.py`, `reader/.env.example`):** Add call-time helpers `dol_api_key()`, `news_agencies()`, `news_sync_enabled()`.
2. **Fetchers & Citation/Penalty Engine (`app/news.py`):**
   - Implement `fetch_federal_register_documents()` (explicit `fields[]` including `cfr_references`, `action`, `effective_on`, `comments_close_on`, `citation`) and `fetch_public_inspection()`. Both share `guid = f"fr:{document_number}"`.
   - Implement `normalize_dol_standard()` (`"19101030 G02   IIA"` → `"1910.1030"`, `"5A0001"` → `None`), `is_general_duty()`, and `extract_citations()` reusing `app/render.py` CFR patterns (ignoring bare non-19xx numbers and non-Title-29 citations).
   - Implement `fetch_dol_recent_violations()`, `group_violations()`, `fetch_dol_inspections()` (batched `in` query), `build_enforcement_article()`, and `takeaways(item)` (Stage 2 · Phase 2 · Part 1 §2).
   - *(Note: If `DOL_API_KEY` is present in `reader/.env`, verify live `gt` date filter, `in` list filter, and General Duty / state-plan codes, and note findings in your summary; if no key is configured, rely on verified schemas and offline fixtures.)*
3. **SQLite Store (`app/news_store.py`):**
   - Create `{config.DATA_DIR}/osha_news.sqlite3` on call-time connection (`WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `PRAGMA user_version = 1`), with `articles`, `article_citations`, `articles_fts` (FTS5 `porter unicode61`), and `sync_status`.
   - Enforce `WHERE NOT (excluded.source = 'federal_register_pi' AND articles.source = 'federal_register')` on upsert, plus `prune()` (365-day retention + 7-day stale PI cleanup).
4. **API Router (`app/news_api.py`, `app/main.py`):**
   - Implement `news_router = APIRouter(prefix="/api/news")` with `GET /api/news`, `GET /api/news/status`, `GET /api/news/facets`, `POST /api/news/refresh`, `GET /api/news/section/{section_id:path}`, and `GET /api/news/part/{part}`, all with `NO_STORE` headers.
   - **Critical:** Register `app.include_router(news_router)` **before** `app.include_router(title_router)` in `app/main.py` so `/api/news/section/...` is not caught by `/api/{title}` with a 422.
5. **Tests:** Create `tests/news_fixtures.py`, `tests/test_news_parsing.py`, `tests/test_news_fetch.py` (`httpx.MockTransport` + autouse `httpx.Client.send` network guard), `tests/test_news_store.py`, and `tests/test_news_api.py`.

### Step 2 — Stage 4 · Phase 1 · Part 1: Schedule-Gated Background Worker (`app/news_worker.py`, `app/main.py`)
- Implement `news_worker.py` following **both** `stage-4/.../part-1_daemon_rss_sync_thread.md` and the verified schedule rules in `REFETCH_CADENCE_RESEARCH.md`:
  - Wake periodically (30 min check) + `trigger_sync()` wake event, evaluating staleness in `America/New_York` (`zoneinfo.ZoneInfo("America/New_York")`):
    - `federal_register`: stale after **06:15 ET** on Mon–Fri (excl. US federal holidays).
    - `federal_register_pi`: stale after **09:00, 11:30, 16:30 ET** on Mon–Fri (excl. US federal holidays).
    - `dol_osha`: stale after **24h** (widen lookback up to `90 days` / `limit=5000` if `last_ok_at` is `>30 days` old).
  - Exponential per-source error backoff (`5m → 15m → 1h → 6h`), bypassed on `POST /api/news/refresh`.
  - Non-blocking refresh-on-open: if `#/news` loads when any enabled source is stale and no sync is running, wake the worker in the background without delaying the response.
- Wire `news_store.init_db(); news_worker.start()` into `main.py` `lifespan` only when `config.news_sync_enabled()`, and call `news_worker.stop()` on shutdown. Never start `news-worker` during tests.

### Step 3 — Stage 2: Newsroom UI, Activity Rail & Shell (`static/index.html`, `static/app.js`, `static/styles.css`)
- **Shell & Rail (`stage-2/.../part-3_route_rail_and_shell_integration.md`):**
  - Add `<a class="ar-btn" data-target="news" href="#/news" aria-label="News" data-tip="News" data-keys="G N">` between Projects and Library in `index.html`, plus `news` in `ICON_PATHS`.
  - Update `NAV_TARGETS` (`['overview', 'home', 'reader', 'projects', 'news', 'library', 'settings']`), `GO_KEYS.n = 'news'`, Alt/⌥ digit handler to `Digit[1-7]`, cheatsheet text (`1–7`), `routeTarget()`, `goTarget()`, `syncNavToRoute()` (retract pinned drawer on `#/news`), `commandList` (`Go to News`, `Refresh news`), and Settings read-only News status row.
  - Update `tests/test_sidebar_rail.py` — **including** `test_rail_items_have_labels_and_shortcuts` regex (`G [OHCPLS]` → `G [OHCPNLS]`), target list, link assertions, `GO_KEYS`, and Alt 1–7 checks.
- **Newsroom Page (`#/news`):**
  - Implement `loadNews(params)`, breaking banner (PI ≤ 3d or enforcement `penalty_usd >= 50000` ≤ 14d), lead hero card, 6 `.lib-seg` category tabs with counts & keyboard navigation, `#news-q` debounced search, `newsCardHtml()` with 3 fixed `<dl>` bullets, `fmtMoney()`, `safeHttpUrl()`, `extLink()`, `linkifyNewsText()` (`NEWS_CITE_RE`), `sectionHref`/`partHref` (falling back to `#/library/{t}` when uninstalled), `Load more` paging, and all 5 status/empty/error states.
  - Add `tests/test_news_frontend.py` verifying `NEWS_CITE_RE` parity with `CITATION_CASES` and markup/route contracts.

### Step 4 — Stage 3: In-Reader Activity Button, Timeline, FTS5 Search & Facets
- **In-Reader Context (`app.js`, `styles.css`):**
  - Add hidden `#btn-news-activity` immediately after Pin in `.doc-actions` for Title 29 section and part pages; populate asynchronously via `fillNewsActivity()` with session `newsActivityCache` (zero extra requests when stepping clauses).
  - Build popover timeline (`role="dialog"`) with node kinds (`rules`, `rulemaking`, `notices`, `public_inspection`, `enforcement` — no interpretations) and footer link `See all in News` (`#/news?section=…` / `#/news?part=…`).
- **FTS5 Search & Facets (`news_api.py`, `app.js`, `styles.css`):**
  - Handle `q` in `GET /api/news` using `store.fts_query()`, section-id fast path (`store.normalize_id(q)`), FR citation fast path (`91 FR …`), and `\x02`/`\x03` `<mark>` snippet highlights.
  - Render State (from `/api/news/facets`), Penalty, and Gravity (`W`/`R`/`S`) facets strictly on the Enforcement tab when `dol_configured` is true, with removable active filter chips and URL sync.

### Step 5 — Stage 4 · Phase 1 · Part 2: Client Cache (`app.js`)
- Implement `lsGetJSON`/`lsSetJSON` stale-while-revalidate caching (`newsCache:v1:{category}`, `newsCache:v1:status`) for default tab views only, always revalidating in the background and preserving scroll position (`data-guid` anchor) only if `guid` order or `last_ok_at` changed.

### Step 6 — Verification & Documentation
1. Run the full test suite from `reader/`: `../.venv/bin/python -m pytest tests -q` — all tests must pass with zero network access and no live `news-worker` thread.
2. Start the local server and verify `#/news`, `G N`, `Alt+5`, dark/light themes, mobile/narrow widths (`<800px` / `<640px`), and Title 29 reader activity popover (with `news.sqlite3` populated and missing).
3. Update `CLAUDE.md`, `README.md`, `reader/README.md`, `reader/API.md`, and `reader/.env.example` to document what shipped.

---

## Final Summary Requirements
Finish with a concise summary listing:
- Files created and modified
- Exact `pytest` command and output observed after the final edit
- Whether `DOL_API_KEY` was available for live verification or verified via offline mocks only
- Any remaining manual checks or follow-ups
