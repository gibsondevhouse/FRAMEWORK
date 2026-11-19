# FRAMEWORK Planning Archive (Historical 10-Series)

> [!IMPORTANT]
> **Linear is the Source of Truth for Plans (as of 2026-11-19):**
> All active, upcoming, and future planning for **FRAMEWORK** lives in **Linear (`FRAMEWORK` / `P-DEV-2`)** — do not author new plans in `docs/plans/`.
>
> **Product Direction:** FRAMEWORK is a **federal-only platform** for staying up to date on codes and laws across federal frameworks (**CFR, Federal Register, U.S.C.**). **State-law coverage and HSE-specific functions are out of scope.**
> **Immediate Priority:** Move the UI beyond its CFR-centric focus so CFR, Federal Register, and U.S.C. operate as peer federal frameworks.

This directory is retained as a **historical archive** of earlier 10-series design plans (`10_`–`50_`). Active implementation code lives in [`reader/`](../../reader/).

---

## Plan Series Index

| Series / Subject | Plan | Status | Summary |
| :--- | :--- | :--- | :--- |
| **10 — Platform & Architecture** | [`11_multi_title_foundation/`](10_platform_and_architecture/11_multi_title_foundation/) | Historical | Initial scaling from Title 29 to all 50 eCFR Titles (`phase-1_multi-title`). |
| **10 — Platform & Architecture** | [`12_repo_structure_stabilization/`](10_platform_and_architecture/12_repo_structure_stabilization/MASTER_PLAN.md) | Completed | FastAPI domain routers, backend package splits, CSS modules, Vite + TS entry, deterministic snapshots & Playwright CI. |
| **10 — Platform & Architecture** | [`13_frontend_architecture_and_hardening/`](10_platform_and_architecture/13_frontend_architecture_and_hardening/MASTER_PLAN.md) | Completed | Decoupled frontend graph (0 circular imports), `src/api/` & `src/core/`, strict TS (`checkJs: true`), perf/security/a11y hardening, Node JS unit tests + CI gates. |
| **10 — Platform & Architecture** | [`14_ui_visual_craft_and_typography/`](10_platform_and_architecture/14_ui_visual_craft_and_typography/MASTER_PLAN.md) | **Completed** (`2026-11-18`) | OKLCH semantic color calibration, dark-mode optical typography & `66ch` prose measure, grounded card physics, control/chevron parity, and snappy `90–240ms` motion curves. |
| **20 — App Shell, Home & Library** | [`21_sliding_rail_sidebar/`](20_app_shell_and_workspace/21_sliding_rail_sidebar/MASTER_PLAN.md) | Completed | 4-track CSS grid layout, icon rail, sliding drawer panels, workspaces, hotkeys. |
| **20 — App Shell, Home & Library** | [`22_editorial_download_refactor/`](20_app_shell_and_workspace/22_editorial_download_refactor/MASTER_PLAN.md) | Completed | Broadsheet `#/library` front page, Compliance Suites batch queue, persistent Transfer Dock. |
| **20 — App Shell, Home & Library** | [`23_home_screen_refactor/`](20_app_shell_and_workspace/23_home_screen_refactor/MASTER_PLAN.md) | Completed | End-user `#/` Home screen bands, `/api/titles/snapshot`, SQLite read-only/concurrency hardening. |
| **20 — App Shell, Home & Library** | [`24_dark_newsroom_multi_jurisdiction_ui/`](20_app_shell_and_workspace/24_dark_newsroom_multi_jurisdiction_ui/MASTER_PLAN.md) | Completed (macOS baselines) | Dark-mode-only obsidian palette, 9-tier semantic link colors & Reference Ledger, `#/corpus/` routing & Tiered Corpus Switcher, Desk ribbon, Authority Stack, Subject Workspaces housing nested Action Projects. |
| **20 — App Shell, Home & Library** | [`25_white_glove_ui_ux_refinement/`](20_app_shell_and_workspace/25_white_glove_ui_ux_refinement/MASTER_PLAN.md) | **Paused** *(Phase 1 Completed)* | Phase 1 visual craft & live bug fixes shipped; Phases 2–5 deferred behind the immediate federal multi-framework UI refocus (moving beyond CFR-centric UI). |
| **30 — CFR Reader & Citations** | [`31_reader_development/`](30_cfr_reader_and_citations/31_reader_development/MASTER_PLAN.md) | Completed (macOS baselines) | Unified citation parser, inline peeks, split reading, micro-downloads, broadsheet Title Start & References Hub, IBR graph & type safety (`win32` CI baseline refresh noted). |
| **40 — Regulatory Intelligence & DOL** | [`41_osha_news_interface/`](40_regulatory_intelligence_and_dol/41_osha_news_interface/MASTER_PLAN.md) | Completed *(Existing Foundation)* | `#/news` hub, FR API v1 + DOL v4 pipeline, bidirectional reader links, schedule-gated sync, and Inspection Case File (`#/news/inspection/{activity_nr}`). |
| **40 — Regulatory Intelligence & DOL** | [`42_dol_api_expansion/`](40_regulatory_intelligence_and_dol/42_dol_api_expansion/MASTER_PLAN.md) | Completed *(Existing Foundation)* | Shared quota pacer & `case_mod_date` delta guard, bidirectional related inspections, contested/FTA/abatement & raw-count paragraph hotspots, GDC + accident FTS5 & NAICS/`state_flag` facets, rate-safe live DOL lookup, and CLI `/v4/datasets` catalog probe. *(DOL/HSE workflows do not define future scope.)* |
| **40 — Regulatory Intelligence & DOL** | [`43_federal_register_and_ecfr_hardening/`](40_regulatory_intelligence_and_dol/43_federal_register_and_ecfr_hardening/MASTER_PLAN.md) | **Completed** (`2026-11-18`) | eCFR HTTP `429`/edition-pinning/completeness hardening + disk hygiene, multi-agency & multi-title Federal Register sync (`29`/`40`/`49`/…), cross-title `#btn-news-activity`, and on-demand `body_html_url` FR preamble reader (`#/news/fr/{document_number}`). |
| **50 — Long-Term Strategy** | [`51_hse_platform_roadmap/`](50_long_term_strategy/51_hse_platform_roadmap/HSE_PLATFORM_ROADMAP.md) | **Archived / Superseded** | Historical strategy doc. HSE-specific suites and state-law coverage are **out of scope**; only federal-only platform capabilities (U.S.C. ingestion, MCP server, Hybrid RAG, Federal Change Radar, cross-citation graph) carry forward in Linear. |

---

## Adding New Plans

Do **not** add new plan files here. Create and track all new initiatives, milestones, and technical specs directly in **Linear (`FRAMEWORK` / `P-DEV-2`)**.
