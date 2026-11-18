# FRAMEWORK — Mapped Plan Portfolio Overview (10-Series)

**Document Set:** `MAPPED_PLAN_OVERVIEW.md` + `MAPPED_PLAN_OVERVIEW.docx`  
**Recorded:** 2026-11-17 · **Codebase:** `reader/` (FastAPI + SQLite FTS5 + Vite ES/TS) · **Plan Series:** `docs/plans/` (`10_`–`50_`)

> **Executive Snapshot:** Across **5 subject series** (`10_`–`50_`), FRAMEWORK currently holds **11 numbered plans** plus **1 cleanup dev log** (`docs/notes/2026-11-16_pre-feature-orders.md`): **1** historical foundation record (`11`), **8** completed implementation plans (`12`, `13`, `21`, `22`, `23`, `24`, `31`, `41`), **2** queued/in-progress plans (**`25_white_glove_ui_ux_refinement`** and **`42_dol_api_expansion`**), and **1** long-horizon strategic blueprint (`51`).

---

## 1. Portfolio Summary & Status Dashboard

| Count | Bucket | Plans Included | Current State |
| :--- | :--- | :--- | :--- |
| **1** | Historical Foundation | `11_multi_title_foundation` | Superseded/archived record of expanding Title 29 to 50 CFR titles |
| **8** | Shipped in `reader/` | `12`, `13`, `21`, `22`, `23`, `24`, `31`, `41` | Running in codebase; Plan `24`/`31` note `win32` CI baseline refresh if merging on Windows |
| **2** | **Planned / In Progress** | **`25_white_glove_ui_ux_refinement`**, **`42_dol_api_expansion`** | `25` covers white-glove UI/UX polish (Phase 1 in progress); `42` covers DOL Open Data API v4 expansion |
| **1** | Strategic Horizon | `51_hse_platform_roadmap` | Future multi-phase blueprint (MCP server, Policy Linter, Hybrid RAG, Bots) |

---

## 2. Master 10-Series Catalog (By Subject)

| Series | Subject | Plan ID | Title | Status | Primary Modules / Routes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | Platform & Architecture | `11` | [Multi-Title Foundation](10_platform_and_architecture/11_multi_title_foundation/) | Historical | `app/build.py`, `app/store.py`, federated `title-N.sqlite3` |
| **10** | Platform & Architecture | `12` | [Repo Structure Stabilization](10_platform_and_architecture/12_repo_structure_stabilization/MASTER_PLAN.md) | Completed | `app/routers/`, `render/`, `library/`, `ingest/`, Vite + TS + CSS split, `.github/workflows/ci.yml` |
| **10** | Platform & Architecture | `13` | [Frontend Architecture & Hardening](10_platform_and_architecture/13_frontend_architecture_and_hardening/MASTER_PLAN.md) | Completed | `src/api/`, `src/core/`, `doc_utils.ts`, strict `.ts` (`checkJs: true`), perf/a11y, Node JS tests |
| **20** | App Shell, Home & Library | `21` | [Sliding Rail Sidebar](20_app_shell_and_workspace/21_sliding_rail_sidebar/MASTER_PLAN.md) | Completed | `#activity-rail`, `#sidebar`, 4-track CSS grid, `views/projects.js` |
| **20** | App Shell, Home & Library | `22` | [Editorial Download Refactor](20_app_shell_and_workspace/22_editorial_download_refactor/MASTER_PLAN.md) | Completed | `#/library`, `app/library/suites.py`, `#transfer-dock` |
| **20** | App Shell, Home & Library | `23` | [Home Screen Refactor](20_app_shell_and_workspace/23_home_screen_refactor/MASTER_PLAN.md) | Completed | `#/`, `GET /api/titles/snapshot`, SQLite read-only `mode=ro` & lock hardening |
| **20** | App Shell, Home & Library | `24` | [Dark Newsroom & Multi-Jurisdiction UI](20_app_shell_and_workspace/24_dark_newsroom_multi_jurisdiction_ui/MASTER_PLAN.md) | Completed *(macOS)* | Obsidian `:root`, 9-tier semantic links, `#/corpus/`, Desk ribbon, Subject Workspaces |
| **20** | App Shell, Home & Library | **`25`** | [**White-Glove UI/UX Refinement**](20_app_shell_and_workspace/25_white_glove_ui_ux_refinement/MASTER_PLAN.md) | **Planned** | Tier bar polish, geometric mark, `0 of 0` fix, `.doc-actions` + mobile jumper, Audit Brief export, Obligation Lens |
| **30** | CFR Reader & Citations | `31` | [CFR Reader Development](30_cfr_reader_and_citations/31_reader_development/MASTER_PLAN.md) | Completed *(macOS)* | `app/citations/`, peeks, `Alt+Click` split view, click-to-download, broadsheet Title Start & References Hub |
| **40** | Regulatory Intel & DOL | `41` | [OSHA News Interface](40_regulatory_intelligence_and_dol/41_osha_news_interface/MASTER_PLAN.md) | Completed | `#/news`, `#/news/inspection/{activity_nr}`, `news.py`, `news_store.py`, `news_worker.py` |
| **40** | Regulatory Intel & DOL | **`42`** | [**DOL API v4 Expansion**](40_regulatory_intelligence_and_dol/42_dol_api_expansion/MASTER_PLAN.md) | **Planned (Next)** | `OSHA/related_activity`, reduction/FTA metrics, NAICS + `5(a)(1)` index, `dol:` lookup, `/v4/datasets` |
| **50** | Long-Term Strategy | `51` | [HSE Platform Roadmap](50_long_term_strategy/51_hse_platform_roadmap/HSE_PLATFORM_ROADMAP.md) | Strategic Blueprint | MCP server, automated Policy Linter, Hybrid RAG, Horizon Radar, Slack/Teams bots |

---

## 3. Architecture Dependency Map (How the Series Stack Together)

```text
[10 SERIES: Platform & Architecture]
  11 Multi-Title Engine (50 CFR DBs) --> 12 Repo Stabilization (Routers, Vite/TS, CI Snapshots)
         |                                      |
         +--------------------+-----------------+
                              v
[20 SERIES: Shell, Home & Library]              [30 SERIES: Reader & Citations]
  21 Rail + Drawer + Workspaces                 31 Reader Development (Milestones 1-3):
  22 Newsroom #/library + Transfer Dock  <--->    Unified citations, peeks, split pane,
  23 End-User #/ Home + SQLite Hardening          Title Start broadsheet & IBR graph
  24 Dark Newsroom + Multi-Jurisdiction UI
  25 White-Glove UI/UX Refinement (Planned)
         |                                                ^
         +------------------------+-----------------------+
                                  v
[40 SERIES: Regulatory Intelligence & DOL]
  41 OSHA News Interface (Completed): FR API v1 + DOL v4 + In-App Inspection Case File
         |
         v
  42 DOL API v4 Expansion (NEXT PLAN - NOT EXECUTED):
     Stage 1: Related Inspections -> Stage 2: Contested/FTA Analytics -> Stage 3: NAICS & 5(a)(1)
     Stage 4: Live Search (Cmd-K & #/news) + Stage 5: Rate-Safe /v4/datasets Discovery
                                  |
                                  v
[50 SERIES: Long-Term Strategy]
  51 HSE Platform Roadmap: MCP Server · Policy Linter · Hybrid RAG · Change Radar · Bots
```

### Key Cross-Plan Touchpoints

- **Series 10 -> All Later Series:** `12_repo_structure_stabilization` introduced `tests/test_build_stamp.py` (`npx tsc --noEmit && npm run build`), `tests/test_api_snapshots.py` (`route_inventory.json`), and `REQUIRE_BROWSER=1` Playwright CI gates that every plan (`23`, `31`, `41`, `42`) must keep green.
- **Series 20 <-> Series 30:** Plan `22` (`TransferDock` + `app/library/jobs.py`) powers Plan `31` Phase 4's seamless in-reader click-to-download of uninstalled cross-title CFR references.
- **Series 30 <-> Series 40:** Plan `31`'s citation parser patterns and Title Start layout wire directly into Plan `41`'s `#/news` CFR linking and Title 29 regulatory wire; Plan `42` Stages 2–3 surface enforcement/FTA/NAICS metrics right inside Title 29 section/part views.
- **Series 40 -> Series 50:** Plan `41` + `42` lay the structured enforcement and agency-catalog datasets that Plan `51`'s Executive Liability Scoring, Multi-Facility NAICS Crosswalk, and Regulatory Horizon Radar depend on.

---

## 4. Subject-by-Subject Breakdown

### 10 Series — Platform & Architecture (`10_platform_and_architecture/`)

- **`11_multi_title_foundation/` (Historical):** Captured the initial transition from hardcoded Title 29 to parameterized 1–50 eCFR ingestion (`iterparse` XML streaming, federated `title-N.sqlite3` DBs, Title 40 EPA & Title 49 DOT verification, and initial federated API/tool routing). Paths and counts reflect Windows development notes from Nov 2026.
- **`12_repo_structure_stabilization/` (Completed, Stages 0–6):** Modularized monolithic Python and JS files without changing behavior:
  - Stage 0–1: Hermetic env hygiene (`TRACKED_KEYS`), dual-transport httpx test guards, self-hosted variable `Geist`/`Inter` `.woff2` fonts, full API/SSE golden snapshots, and Playwright + Pillow visual CI on macOS & Windows.
  - Stage 2–3: Split `main.py` into domain routers (`routers/`) enforcing module-only imports and `news_router` before `title_router`; split `render/`, `library/`, and `ingest/` packages.
  - Stage 4–6: Preserved cascade across `frontend/src/styles/01_tokens.css`–`11_settings_help.css`, migrated frontend into Vite ES modules + TS entry emitting unminified committed `reader/static/dist/`, and synchronized docs.
- **`13_frontend_architecture_and_hardening/` (Completed, Phases 1–5; closes Order 3):** Decoupled the 32-file frontend import web into unidirectional layers with **0 circular imports**, centralized `src/api/` (`client.ts`, `jobs.ts`) and shared reader/split controllers in `doc_utils.ts`, decomposed oversized view modules (`news.ts`/`news_case.ts`, `core.ts`/`ref_almanac.ts`, `library.ts`), migrated submodules under `src/` to strict `.ts` (`"checkJs": true`, `"strict": true` in `tsconfig.json`), hardened chat/search aborting, Part TOC scroll-scoped lazy hydration, URL/DOMPurify safety, and modal focus traps, and added Node JS unit tests (`npm test`) + CI checks alongside expanded Playwright coverage.

### 20 Series — App Shell, Home & Library (`20_app_shell_and_workspace/`)

- **`21_sliding_rail_sidebar/` (Completed, Stages 1–4):** Built the 4-track app shell (`rail`, `drawer`, `main`, `chat`), collapsible/flyout drawer state machine, `G`-chord & `⌘B`/`⌘D` shortcuts, 3-tier Contents tree, Library/Settings drawer panels, and `framework_projects_v1` Workspaces engine.
- **`22_editorial_download_refactor/` (Completed, Stages 1–4):** Redesigned `#/library` as an editorial front page (metrics tiles, featured Compliance Suite hero, 7-day Regulatory Wire, topic desks), backed by `COMPLIANCE_SUITES`, batch queue endpoints, and the persistent floating `#transfer-dock`.
- **`23_home_screen_refactor/` (Completed, Stages 1–3):** Replaced developer clutter on `#/` with an end-user 3-band layout (**Band 1** Continue Reading + Workspaces, **Band 2** Downloaded Titles snapshot via `/api/titles/snapshot`, **Band 3** quiet Regulatory Pulse) while hardening `store.py` (`known_ids` uncached error guard, `PRAGMA query_only`), `library/jobs.py` lock transitions, and read-only `news_store.connect(readonly=True)`.
- **`24_dark_newsroom_multi_jurisdiction_ui/` (Completed, Phases 1–5; macOS baselines current):** Locked the UI to an obsidian dark-mode-only "Yakuza Editorial" palette (`--bg: #070708`), implemented the 9-tier semantic reference chromatics across links/chips/peeks and `#btn-refs-ledger`, pre-wired multi-jurisdiction `AuthorityTier`/`DeskId`/`CorpusSummary` contracts with `#/corpus/...` routing and searchable Corpus Switcher, elevated Home/Title Start/Library/Search/News across regulatory desks, and added Authority grouping + nested Action Projects inside Subject Workspaces.
- **`25_white_glove_ui_ux_refinement/` (Planned, Phases 1–5):** Fixes curved `border-left` tier-bar hooks, vestigial `"E"` mobile mark/favicon, `0 of 0 installed` suite counts, empty Wire/tier catalog clutter, CTA inflation, and multi-row `.doc-actions` wrapping; adds interactive mobile `.unit-context` jumping, `#view-head` scrolled position context, structured Workspace clips + **Audit Brief** (`.md`/print PDF) exports, offline **Obligation & Deadline Lens**, and `> Commands` / first-run discovery polish.

### 30 Series — CFR Reader & Citations (`30_cfr_reader_and_citations/`)

- **`31_reader_development/` (Completed — Milestones 1–3; `win32` CI baseline note):** Evolved the CFR Reader across 7 planned phases plus a cross-cutting refactor track:
  - **Milestone 1 (Phases 1–2):** `trim_tree` HTML tag stripping, unified `app/citations/parser.py` (fixing plural cross-title traps), deterministic table/figure/footnote IDs, sticky headers, paper-mat dark figures + lightbox, and `@container main` proportional rail rules.
  - **Milestone 2 (Phases 3–4):** Shared collision-aware `createPopover`, inline paragraph/table/footnote peeks, `Alt+Click` split reading pane, and click-to-download micro-cards wired to `TransferDock`.
  - **Milestone 3 (Phases 5–7):** Dynamic 50-title Start Page + broadsheet newsroom redesign + References & Authorities Hub, reverse `"Cited By"` backlinks + IBR consensus-standard resolver, clause permalinks/clipping, and cross-cutting cancellation/typing work.

### 40 Series — Regulatory Intelligence & DOL (`40_regulatory_intelligence_and_dol/`)

#### `41_osha_news_interface/` (Completed + In-App Inspection Case File)
Built exclusively on sanctioned government JSON APIs (`federalregister.gov/api/v1` and `apiprod.dol.gov/v4`) with zero web scraping:
- Schedule-gated daemon sync (`FR` 06:15 ET, `PI` 09:00/11:30/16:30 ET weekdays, `DOL` 24h) with persistent failure backoff (`sync_status.fail_count`).
- Local `osha_news.sqlite3` (`articles`, `article_citations`, `articles_fts`, `enforcement_cases`), deterministic 3-bullet `news.takeaways`, `#/news` newsroom UI, Title 29 activity popover (`#btn-news-activity`), and the **in-app Inspection Case File** (`#/news/inspection/{activity_nr}`) with paragraph-level DOL standard decoding (`parse_dol_standard`), `POST /api/news/inspection/{activity_nr}/enrich`, and the 4-card Enforcement Briefing strip (`GET /api/news/enforcement/summary`).

#### `42_dol_api_expansion/` (NEXT PLAN — NOT EXECUTED)
Targets verified, live-probed capabilities on `https://apiprod.dol.gov/v4` while enforcing strict rate-limit (`HTTP 429`) and URL-size (`~2 KB`) guardrails (and excluding `OSHA/optional_info`, `OSHA/history`, and `OSHA/strategic_codes`, which returned upstream `HTTP 500`):

| Stage | Target Capabilities | Primary Upstream / Local Assets | Key Guardrails |
| :--- | :--- | :--- | :--- |
| **Stage 1** | **Related Inspections Graph** | `OSHA/related_activity` (`rel_act_nr`, `rel_type`), `enforcement_cases.related_json` | Non-destructive `ALTER TABLE`; no key leakage |
| **Stage 2** | **Contested & FTA Analytics** | `initial_penalty` vs `current_penalty`, `OSHA/violation_event`, `fta_*` fields | No `statPill()` misuse for alerts; hairline UI badges only |
| **Stage 3** | **NAICS & `5(a)(1)` Index** | `naics_code` grouping, `gdc_fts` FTS5 over `OSHA/violation_gen_duty_std` | Parameterized prefix queries; FTS sentinel highlighting |
| **Stage 4** | **Live DOL Lookup (`⌘K` & `#/news`)** | `GET /api/news/dol/search` (`estab_name`, `naics`, `hazsub1`–`5`, `standard`) | **Explicit submit only** (zero calls on typing) + 10m TTL cache + 429 cooldown |
| **Stage 5** | **Rate-Safe Catalog Discovery** | `GET /v4/datasets` (`total_count: 45`), `dol_datasets` table -> Title 29/30 map | Spaced pagination (`delay_s`) + partial-save resume under 429 |

### 50 Series — Long-Term Strategy (`50_long_term_strategy/`)

- **`51_hse_platform_roadmap/` (`HSE_PLATFORM_ROADMAP.md` — Strategic Blueprint):** Multi-year product vision atop the core FastAPI + SQLite platform covering IDE **MCP Server**, **Policy Linter**, **Hybrid RAG** (`sqlite-vec` + BM25 RRF), **Regulatory Horizon Radar** (eCFR diffs + LLM impact synthesis), **Cross-Citation Dependency Graph**, **Enterprise Chat Bots** (Slack/Teams/Discord), and dedicated toolsets for HSE Directors, Managers, and Field Coordinators.

---

## 5. Pending Housekeeping & Follow-Ups (`docs/notes/`)

Alongside Plan `42_dol_api_expansion`, [`docs/notes/2026-11-16_pre-feature-orders.md`](../notes/2026-11-16_pre-feature-orders.md) records **Order 3 (Pending)** after Orders 1 & 2 shipped:
1. Replace brittle JS source-slicing assertions (`test_settings_env.py`, `test_news_frontend.py`, `test_sidebar_rail.py`) with Playwright checks in `test_browser_parity.py`, and swap `mask.getdata()` -> `get_flattened_data()`.
2. Extract a shared `src/api/` client module and untangle circular imports across `nav.js` / `router.js` / `views/`.
3. Incrementally type `AppState` and convert remaining `.js` frontend modules to `.ts` (adding `npx tsc --noEmit` to `.github/workflows/ci.yml`).
4. Refresh Windows visual baselines (`tests/baselines/win32/`) via CI when merging Milestone 1–3 UI changes.

---

## 6. Recommended Execution Queue

1. **Plan `42` — Stages 1–3 (Local Intelligence First):** Land related-inspection cross-links, contested settlement/FTA metrics, and NAICS + General Duty `5(a)(1)` search directly atop cached/enriched inspection data.
2. **Plan `42` — Stage 4 (Live Archive Lookup):** Add rate-limited explicit-submit search across national OSHA history from `#/news` and `⌘K` (`dol:`).
3. **Plan `42` — Stage 5 (Catalog Discovery):** Slowly inventory all 45 `/v4/datasets` entries to scope **Plan `43`+** (e.g., Wage & Hour / OWCP / MSHA integration across other CFR titles).
4. **Housekeeping (`Order 3` + `win32` CI):** Tackle incrementally as small clean PRs before starting **Series `50`** capabilities (MCP server, Policy Linter, Hybrid RAG).
