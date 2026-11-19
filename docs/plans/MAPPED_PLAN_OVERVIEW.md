# FRAMEWORK — Historical Plan Archive Overview (10-Series)

> [!IMPORTANT]
> **Archived Snapshot — Linear Is the Source of Truth (2026-11-19):** All active, upcoming, and future plans are managed in **Linear (`FRAMEWORK` / `P-DEV-2`)**. This file is a historical record of the earlier 10-series plans in `docs/plans/` and is no longer maintained for new work.

**Updated:** 2026-11-19 · **Codebase:** `reader/` (FastAPI + SQLite FTS5 + Vite strict TS) · **Source of Truth:** Linear (`FRAMEWORK` / `P-DEV-2`)

> **Product Direction & Immediate Priority (2026-11-19):** FRAMEWORK is a **federal-only platform** for staying up to date on codes and laws across federal frameworks (**CFR, Federal Register, and U.S.C.**) — not an HSE workstation or a CFR-focused reader. **State-law coverage and HSE-specific functions are out of scope.**
>
> **Immediate Priority:** Move the UI away from its CFR-centric focus so readers work across federal frameworks without treating CFR as the default or primary framework. This takes precedence over Plan `25` Phases 2–5 and supersedes the HSE-oriented roadmap in Plan `51`.

> **Executive Snapshot:** Across **5 subject series** (`10_`–`50_`), FRAMEWORK holds **14 numbered plans** plus **1 cleanup dev log** (`docs/notes/2026-11-16_pre-feature-orders.md`): **1** historical foundation record (`11`), **11** completed implementation plans (`12`, `13`, `14`, `21`, `22`, `23`, `24`, `31`, `41`, `42`, `43`) plus the Two-Layer Sidebar & Multi-Framework Home redesign (`05e0a70`), **1** paused plan (**`25_white_glove_ui_ux_refinement`** — Phase 1 shipped, Phases 2–5 deferred behind the federal UI refocus), and **1** archived/superseded HSE strategy document (`51`).

---

## 1. Portfolio Summary & Status Dashboard

| Count | Bucket | Plans Included | Current State |
| :--- | :--- | :--- | :--- |
| **1** | Historical Foundation | `11_multi_title_foundation` | Superseded/archived record of expanding Title 29 to 50 CFR titles |
| **11** | Shipped in `reader/` | `12`, `13`, `14`, `21`, `22`, `23`, `24`, `31`, `41`, `42`, `43` (+ `05e0a70`) | Running in codebase; existing DOL/OSHA enforcement code (`41`/`42`) remains supported foundation but does not define future scope; `win32` CI baseline refresh pending |
| **1** | **Paused / Deferred** | **`25_white_glove_ui_ux_refinement`** | Phase 1 shipped; Phases 2–5 deferred while **Federal Multi-Framework UI Refocus** (moving beyond CFR-centric UI) runs first |
| **1** | **Archived / Superseded** | `51_hse_platform_roadmap` | HSE suites and state-law coverage **removed from scope**; federal-only platform items (U.S.C. ingestion, MCP server, Hybrid RAG, Federal Change Radar, cross-framework citation graph) tracked in Linear |

---

## 2. Master 10-Series Catalog (By Subject)

| Series | Subject | Plan ID | Title | Status | Primary Modules / Routes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | Platform & Architecture | `11` | [Multi-Title Foundation](10_platform_and_architecture/11_multi_title_foundation/) | Historical | `app/build.py`, `app/store.py`, federated `title-N.sqlite3` |
| **10** | Platform & Architecture | `12` | [Repo Structure Stabilization](10_platform_and_architecture/12_repo_structure_stabilization/MASTER_PLAN.md) | Completed | `app/routers/`, `render/`, `library/`, `ingest/`, Vite + TS + CSS split, `.github/workflows/ci.yml` |
| **10** | Platform & Architecture | `13` | [Frontend Architecture & Hardening](10_platform_and_architecture/13_frontend_architecture_and_hardening/MASTER_PLAN.md) | Completed | `src/api/`, `src/core/`, `doc_utils.ts`, strict `.ts` (`checkJs: true`), perf/a11y, Node JS tests |
| **10** | Platform & Architecture | `14` | [UI Visual Craft & Typography](10_platform_and_architecture/14_ui_visual_craft_and_typography/MASTER_PLAN.md) | Completed *(macOS)* | `01_tokens.css`–`11_settings_help.css`, `oklch` color physics, `66ch` measure, control/motion parity |
| **20** | App Shell, Home & Library | `21` | [Sliding Rail Sidebar](20_app_shell_and_workspace/21_sliding_rail_sidebar/MASTER_PLAN.md) | Completed | `#activity-rail`, `#sidebar`, 4-track CSS grid, `views/projects.js` |
| **20** | App Shell, Home & Library | `22` | [Editorial Download Refactor](20_app_shell_and_workspace/22_editorial_download_refactor/MASTER_PLAN.md) | Completed | `#/library`, `app/library/suites.py`, `#transfer-dock` |
| **20** | App Shell, Home & Library | `23` | [Home Screen Refactor](20_app_shell_and_workspace/23_home_screen_refactor/MASTER_PLAN.md) | Completed | `#/`, `GET /api/titles/snapshot`, SQLite read-only `mode=ro` & lock hardening |
| **20** | App Shell, Home & Library | `24` | [Dark Newsroom & Multi-Jurisdiction UI](20_app_shell_and_workspace/24_dark_newsroom_multi_jurisdiction_ui/MASTER_PLAN.md) | Completed *(macOS)* | Obsidian `:root`, 9-tier semantic links, `#/corpus/`, Desk ribbon, Subject Workspaces |
| **20** | App Shell, Home & Library | **`25`** | [**White-Glove UI/UX Refinement**](20_app_shell_and_workspace/25_white_glove_ui_ux_refinement/MASTER_PLAN.md) | **Paused** *(Phase 1 completed; Phases 2–5 deferred)* | Tier bar polish, geometric mark, `0 of 0` fix (shipped); Phases 2–5 deferred behind federal multi-framework UI refocus |
| **30** | CFR Reader & Citations | `31` | [CFR Reader Development](30_cfr_reader_and_citations/31_reader_development/MASTER_PLAN.md) | Completed *(macOS)* | `app/citations/`, peeks, `Alt+Click` split view, click-to-download, broadsheet Title Start & References Hub |
| **40** | Regulatory Intel & DOL | `41` | [OSHA News Interface](40_regulatory_intelligence_and_dol/41_osha_news_interface/MASTER_PLAN.md) | Completed *(Existing Foundation)* | `#/news`, `#/news/inspection/{activity_nr}`, `news.py`, `news_store.py`, `news_worker.py` |
| **40** | Regulatory Intel & DOL | `42` | [DOL API v4 Expansion](40_regulatory_intelligence_and_dol/42_dol_api_expansion/MASTER_PLAN.md) | Completed *(Existing Foundation)* | `OSHA/related_activity`, reduction/FTA/abatement & para hotspots, GDC+accident FTS5, `dol:` lookup + Claude `search_enforcement`, CLI `dol_catalog.py` |
| **40** | Regulatory Intel & DOL | `43` | [FR Expansion & eCFR Hardening](40_regulatory_intelligence_and_dol/43_federal_register_and_ecfr_hardening/MASTER_PLAN.md) | Completed *(macOS)* | eCFR `429`/edition-pinning/completeness + `/api/library/reload`, multi-agency & installed-title FR sync, cross-title `#btn-news-activity`, `#/news/fr/{document_number}` preamble reader |
| **50** | Long-Term Strategy | `51` | [HSE Platform Roadmap](50_long_term_strategy/51_hse_platform_roadmap/HSE_PLATFORM_ROADMAP.md) | **Archived / Superseded** | HSE suites & state codes out of scope; federal-only platform capabilities tracked in Linear |

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
  24 Dark Newsroom + Multi-Jurisdiction UI (+ 05e0a70 Two-Layer Sidebar)
  25 White-Glove UI/UX Refinement (Paused: Phase 1 shipped; Phases 2-5 deferred)
  [IMMEDIATE PRIORITY] Federal Multi-Framework UI Refocus (Beyond CFR-Centric UI)
         |                                                ^
         +------------------------+-----------------------+
                                  v
[40 SERIES: Regulatory Intelligence & DOL (Existing Foundation)]
  41 OSHA News Interface (Completed): FR API v1 + DOL v4 + In-App Inspection Case File
         |
         v
  42 DOL API v4 Expansion (Completed; does not define future scope):
     Stage 1: Quota Pacer & Bidirectional Related/FTA -> Stage 2: Contested/Abatement & Paragraph Hotspots
     Stage 3: GDC + Accident FTS5, NAICS, Emphasis/State-Flag & Priority Backfill
     Stage 4: Live Search (Cmd-K & #/news), Workspaces & Local Claude + Stage 5: /v4/datasets Catalog & Schema Probe
         |
         v
  43 FR Expansion & eCFR Hardening (Completed):
     eCFR 429/edition-pinning/completeness -> Multi-agency & installed-title FR sync -> #/news/fr/{document_number} reader
                                  |
                                  v
[50 SERIES: Federal Platform Expansion (HSE Suites & State Codes Removed)]
  Next: U.S.C. Ingestion Adapters · MCP Server · Hybrid RAG · Federal Change Radar
  Horizon: Cross-Framework Citation Graph · Team Chat Integrations
```

### Key Cross-Plan Touchpoints

- **Series 10 -> All Later Series:** `12_repo_structure_stabilization` introduced `tests/test_build_stamp.py` (`npx tsc --noEmit && npm run build`), `tests/test_api_snapshots.py` (`route_inventory.json`), and `REQUIRE_BROWSER=1` Playwright CI gates that every change must keep green.
- **Series 20 <-> Series 30:** Plan `22` (`TransferDock` + `app/library/jobs.py`) powers Plan `31` Phase 4's seamless in-reader click-to-download of uninstalled cross-title CFR references.
- **Series 30 <-> Series 40:** Plan `31`'s citation parser patterns and Title Start layout wire directly into Plan `41` & `43`'s `#/news` Federal Register linking and in-reader activity timelines across all installed titles.
- **Series 40 -> Series 50:** Plan `43`'s eCFR edition pinning and multi-title Federal Register preamble reader provide the foundation for Federal Change Radar and cross-framework (U.S.C. ↔ CFR ↔ FR) tracking.

---

## 4. Subject-by-Subject Breakdown

### 10 Series — Platform & Architecture (`10_platform_and_architecture/`)

- **`11_multi_title_foundation/` (Historical):** Captured the initial transition from hardcoded Title 29 to parameterized 1–50 eCFR ingestion (`iterparse` XML streaming, federated `title-N.sqlite3` DBs, Title 40 EPA & Title 49 DOT verification, and initial federated API/tool routing). Paths and counts reflect Windows development notes from Nov 2026.
- **`12_repo_structure_stabilization/` (Completed, Stages 0–6):** Modularized monolithic Python and JS files without changing behavior:
  - Stage 0–1: Hermetic env hygiene (`TRACKED_KEYS`), dual-transport httpx test guards, self-hosted variable `Geist`/`Inter` `.woff2` fonts, full API/SSE golden snapshots, and Playwright + Pillow visual CI on macOS & Windows.
  - Stage 2–3: Split `main.py` into domain routers (`routers/`) enforcing module-only imports and `news_router` before `title_router`; split `render/`, `library/`, and `ingest/` packages.
  - Stage 4–6: Preserved cascade across `frontend/src/styles/01_tokens.css`–`11_settings_help.css`, migrated frontend into Vite ES modules + TS entry emitting unminified committed `reader/static/dist/`, and synchronized docs.
- **`13_frontend_architecture_and_hardening/` (Completed, Phases 1–5; closes Order 3):** Decoupled the 32-file frontend import web into unidirectional layers with **0 circular imports**, centralized `src/api/` (`client.ts`, `jobs.ts`) and shared reader/split controllers in `doc_utils.ts`, decomposed oversized view modules (`news.ts`/`news_case.ts`, `core.ts`/`ref_almanac.ts`, `library.ts`), migrated submodules under `src/` to strict `.ts` (`"checkJs": true`, `"strict": true` in `tsconfig.json`), hardened chat/search aborting, Part TOC scroll-scoped lazy hydration, URL/DOMPurify safety, and modal focus traps, and added Node JS unit tests (`npm test`) + CI checks alongside expanded Playwright coverage.
- **`14_ui_visual_craft_and_typography/` (Completed, Phases 1–4):** Elevates studio-grade visual craft across `frontend/src/styles/` via luminance-calibrated `oklch()` `--ref-*` & `oklab` tints, preserved card top-sheen on hover, corrected Geist vs. Inter typography features, `66ch` prose measure, continuous `.lvl-*` thread lines, standardized input/focus/mask-chevron controls, `scrollbar-gutter: stable`, grounded multi-action cards, and crisp `90ms/160ms/240ms` motion curves.

### 20 Series — App Shell, Home & Library (`20_app_shell_and_workspace/`)

- **`21_sliding_rail_sidebar/` (Completed, Stages 1–4):** Built the 4-track app shell (`rail`, `drawer`, `main`, `chat`), collapsible/flyout drawer state machine, `G`-chord & `⌘B`/`⌘D` shortcuts, 3-tier Contents tree, Library/Settings drawer panels, and `framework_projects_v1` Workspaces engine.
- **`22_editorial_download_refactor/` (Completed, Stages 1–4):** Redesigned `#/library` as an editorial front page (metrics tiles, featured Compliance Suite hero, 7-day Regulatory Wire, topic desks), backed by `COMPLIANCE_SUITES`, batch queue endpoints, and the persistent floating `#transfer-dock`.
- **`23_home_screen_refactor/` (Completed, Stages 1–3):** Replaced developer clutter on `#/` with an end-user 3-band layout (**Band 1** Continue Reading + Workspaces, **Band 2** Downloaded Titles snapshot via `/api/titles/snapshot`, **Band 3** quiet Regulatory Pulse) while hardening `store.py` (`known_ids` uncached error guard, `PRAGMA query_only`), `library/jobs.py` lock transitions, and read-only `news_store.connect(readonly=True)`.
- **`24_dark_newsroom_multi_jurisdiction_ui/` (Completed, Phases 1–5; macOS baselines current):** Locked the UI to an obsidian dark-mode-only "Yakuza Editorial" palette (`--bg: #070708`), implemented the 9-tier semantic reference chromatics across links/chips/peeks and `#btn-refs-ledger`, pre-wired multi-jurisdiction `AuthorityTier`/`DeskId`/`CorpusSummary` contracts with `#/corpus/...` routing and searchable Corpus Switcher, elevated Home/Title Start/Library/Search/News across regulatory desks, and added Authority grouping + nested Action Projects inside Subject Workspaces.
- **`25_white_glove_ui_ux_refinement/` (Paused — Phase 1 completed; Phases 2–5 deferred behind federal multi-framework UI refocus):** Phase 1 fixed curved `border-left` tier-bar hooks, the vestigial `"E"` mobile mark/favicon, `0 of 0 installed` suite counts, empty Wire/tier catalog clutter, and truncated blurbs. Phases 2–5 (single-row `.doc-actions`, interactive mobile `.unit-context` jumper, structured Workspace clips + Audit Brief exports, offline Obligation Lens, discovery polish) are deferred while the UI shifts beyond its CFR-centric focus.

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

#### `42_dol_api_expansion/` (Completed)
Targets verified, live-probed capabilities on `https://apiprod.dol.gov/v4` while enforcing strict rate-limit (`HTTP 429`) and URL-size (`~2 KB`) guardrails (and excluding `OSHA/optional_info`, `OSHA/history`, and `OSHA/strategic_codes`, which returned upstream `HTTP 500`):

| Stage | Target Capabilities | Primary Upstream / Local Assets | Key Guardrails |
| :--- | :--- | :--- | :--- |
| **Stage 1** | **Quota Foundation & Bidirectional Related Graph** | Shared `_dol_get()` pacer & `agency` param, `hazsub1`–`5`, `case_mod_date` skip, `OSHA/related_activity` (`activity_nr` & `rel_act_nr`), `fta_insp_nr` | Non-destructive `SCHEMA_VERSION` `2 -> 3`; `429` circuit breaker; no key leakage |
| **Stage 2** | **Contested, Abatement & Paragraph Hotspots** | `initial_penalty` vs `current_penalty`, `OSHA/violation_event`, `fta_*`, `abate_complete`, `(section_id, para)` stats | No `statPill()` misuse for alerts; hairline UI badges only |
| **Stage 3** | **Narratives FTS5, NAICS & Emphasis Facets** | `enforcement_narratives_fts` (GDC `5(a)(1)` + `OSHA/accident*`), `naics_code`, `emphasis`, `hazcat`, `state_flag`, worker trickle | Parameterized prefix queries; FTS sentinel highlighting; Federal vs State Plan split |
| **Stage 4** | **Live DOL Lookup, Workspaces & Local Claude** | `GET /api/news/dol/search` (`sort_by`, `since`, `min_penalty`, `offset`, `hazsub1`–`5` labels), Case Clipping, `chat.py` `search_enforcement` | **Explicit submit only** + 10m TTL cache + `429` cooldown; Claude reads SQLite only |
| **Stage 5** | **CLI-First Catalog & Schema Probe** | `python -m app.dol_catalog --probe` (`GET /v4/datasets` + `limit=1` probe) -> `dol_datasets` & `DOL_CATALOG_INVENTORY.md` | Spaced pagination (`delay_s`) + partial-save resume under `429`; UI deferred to Plan 43+ |

#### `43_federal_register_and_ecfr_hardening/` (Completed, Phases 1–4; macOS baselines current)
Hardens eCFR ingestion and widens Federal Register coverage beyond Title 29 / OSHA, still on documented JSON APIs only:
- **Phases 1–2 (eCFR):** `429 Retry-After` honoring, fast-fail on non-transient `4xx`, edition pinning from `library/jobs.py` into `build.build(edition=…)`, `missing_leaves` completeness metadata in `meta`, orphan `.download`/`.tmp` cleanup, and `POST /api/library/reload` so CLI rebuilds are picked up without a server restart.
- **Phase 3 (FR sync):** `news_worker.sync_sources` syncs every configured `NEWS_AGENCIES` slug plus installed CFR titles (`conditions[cfr][title][]`), deduplicated by `fr:{document_number}`; `extract_all_citations` covers titles `1–50`; `#btn-news-activity` works for every installed title.
- **Phase 4 (FR reader):** `GET /api/news/fr/{document_number}` lazily fetches, sanitizes, linkifies and caches (`fr_bodies`) the `body_html_url` preamble, shown at `#/news/fr/{document_number}`.

### 50 Series — Long-Term Strategy (`50_long_term_strategy/`)

- **`51_hse_platform_roadmap/` (`HSE_PLATFORM_ROADMAP.md` — Archived / Superseded 2026-11-19):** Historical strategy blueprint. Per the federal-only pivot in Linear (`FRAMEWORK`), **state-law coverage** and **HSE-specific tools** (Written Safety Program & Policy Linter, OSHA Part 1904 Recordability Engine, Multi-Agency Chemical/NAICS/Penalty Crosswalk, Field Operations Toolkit) are **out of scope**. General federal-platform capabilities carry forward in Linear as future candidates: U.S.C. & federal framework ingestion adapters, IDE **MCP Server**, local **Hybrid RAG** (`sqlite-vec` + BM25 RRF), **Federal Change Radar** (eCFR diffs + FR impact briefs), **Cross-Framework Citation Knowledge Graph**, and team chat integrations.

---

## 5. Pending Housekeeping & Follow-Ups (`docs/notes/`)

[`docs/notes/2026-11-16_pre-feature-orders.md`](../notes/2026-11-16_pre-feature-orders.md) records Orders 1–3, all completed. Order 3's frontend items (shared `src/api/` client and zero import cycles, typed `AppState` with every module in `.ts` under `"checkJs": true`, `npx tsc --noEmit` + `npm test` in `.github/workflows/ci.yml`, Playwright checks in place of JS source-slicing assertions, `mask.get_flattened_data()`) shipped through Plan `13`. What is still open:
1. Refresh Windows visual baselines (`tests/baselines/win32/`) through the CI workflow's `record_baselines` dispatch input (best run after the immediate Federal Multi-Framework UI Refocus lands).

---

## 6. Recommended Execution Queue (Synced with Linear `FRAMEWORK`)

1. **Immediate Priority — Federal Multi-Framework UI Refocus (Linear `Now`):** Move the UI beyond its CFR-centric focus so **CFR, Federal Register, and U.S.C.** operate as peer federal frameworks across Home, primary sidebar, topbar switcher, onboarding (`welcome.ts`), Library, Search, and Reader entry points; remove out-of-scope State/County tiers and HSE framing from the interface.
2. **Housekeeping:** Refresh `win32` visual baselines via the CI `record_baselines` dispatch once the UI refocus settles.
3. **Next — Federal Code Ingestion & Platform Intelligence:** Author dedicated plans and build U.S.C. / federal framework ingestion adapters (`IRegulatoryIngest` + URRI scheme), IDE MCP Server, local Hybrid RAG, Federal Change Radar & eCFR diffs, and selectively fold in reusable Plan `25` reader ergonomics.
4. **Horizon:** Cross-framework citation knowledge graph & blast radius and federal team chat integrations.
