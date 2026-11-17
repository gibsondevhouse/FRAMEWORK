# FRAMEWORK Planning Registry (10-Series by Subject)

Plans under `docs/plans/` are organized in a **10-series** by technical subject (`10_`–`50_`), with individual plans numbered within each subject decade (`11_`, `21_`, `31_`, `41_`, `42_`, `51_`) so related initiatives stay grouped and room remains for future plans.

> [!NOTE]
> For a unified portfolio overview, dependency map, and stage-by-stage breakdown, see [`MAPPED_PLAN_OVERVIEW.md`](MAPPED_PLAN_OVERVIEW.md) and [`MAPPED_PLAN_OVERVIEW.docx`](MAPPED_PLAN_OVERVIEW.docx). Lightweight cleanup logs and follow-ups live in [`docs/notes/`](../notes/). Active implementation code lives in [`reader/`](../../reader/).

---

## Plan Series Index

| Series / Subject | Plan | Status | Summary |
| :--- | :--- | :--- | :--- |
| **10 — Platform & Architecture** | [`11_multi_title_foundation/`](10_platform_and_architecture/11_multi_title_foundation/) | Historical | Initial scaling from Title 29 to all 50 eCFR Titles (`phase-1_multi-title`). |
| **10 — Platform & Architecture** | [`12_repo_structure_stabilization/`](10_platform_and_architecture/12_repo_structure_stabilization/MASTER_PLAN.md) | Completed | FastAPI domain routers, backend package splits, CSS modules, Vite + TS entry, deterministic snapshots & Playwright CI. |
| **20 — App Shell, Home & Library** | [`21_sliding_rail_sidebar/`](20_app_shell_and_workspace/21_sliding_rail_sidebar/MASTER_PLAN.md) | Completed | 4-track CSS grid layout, icon rail, sliding drawer panels, workspaces, hotkeys. |
| **20 — App Shell, Home & Library** | [`22_editorial_download_refactor/`](20_app_shell_and_workspace/22_editorial_download_refactor/MASTER_PLAN.md) | Completed | Broadsheet `#/library` front page, Compliance Suites batch queue, persistent Transfer Dock. |
| **20 — App Shell, Home & Library** | [`23_home_screen_refactor/`](20_app_shell_and_workspace/23_home_screen_refactor/MASTER_PLAN.md) | Completed | End-user `#/` Home screen bands, `/api/titles/snapshot`, SQLite read-only/concurrency hardening. |
| **30 — CFR Reader & Citations** | [`31_reader_development/`](30_cfr_reader_and_citations/31_reader_development/MASTER_PLAN.md) | Completed (macOS baselines) | Unified citation parser, inline peeks, split reading, micro-downloads, broadsheet Title Start & References Hub, IBR graph & type safety (`win32` CI baseline refresh noted). |
| **40 — Regulatory Intelligence & DOL** | [`41_osha_news_interface/`](40_regulatory_intelligence_and_dol/41_osha_news_interface/MASTER_PLAN.md) | Completed | `#/news` hub, FR API v1 + DOL v4 pipeline, bidirectional reader links, schedule-gated sync, and Inspection Case File (`#/news/inspection/{activity_nr}`). |
| **40 — Regulatory Intelligence & DOL** | [`42_dol_api_expansion/`](40_regulatory_intelligence_and_dol/42_dol_api_expansion/MASTER_PLAN.md) | **Planned (Next)** | **Next Plan (Not Executed):** Related inspections, contested/FTA analytics, NAICS & General Duty `5(a)(1)` index, rate-safe live DOL lookup (`⌘K` / `#/news`), and `/v4/datasets` catalog discovery. |
| **50 — Long-Term Strategy** | [`51_hse_platform_roadmap/`](50_long_term_strategy/51_hse_platform_roadmap/HSE_PLATFORM_ROADMAP.md) | Strategic Blueprint | Multi-horizon platform vision: MCP server, policy linter, hybrid RAG, regulatory change radar, enterprise bots. |

---

## Adding New Plans

1. Pick the matching subject series (`10_` Platform, `20_` Shell/Library, `30_` Reader/Citations, `40_` Regulatory Intelligence/DOL, `50_` Strategy — or `60_+` for a new subject domain).
2. Allocate the next two-digit plan code inside that subject (e.g., `32_...`, `43_...`).
3. Include a `MASTER_PLAN.md` with clear status (`Planned`, `In Progress`, `Completed`, `Historical`), grounded codebase touchpoints, and stage/exit-gate specs, then register the plan in this index.
