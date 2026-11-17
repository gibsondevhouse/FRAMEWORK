# Master Plan: OSHA Regulatory Intelligence & News Interface (Sanctioned APIs + RSS)

## Executive Overview

This master plan defines the architecture and implementation roadmap for **FRAMEWORK**'s **OSHA Regulatory Intelligence & News Hub** (`#/news`), built exclusively on **sanctioned, publicly documented U.S. government APIs and RSS feeds** — with zero web scraping and zero browser-spoofing workarounds.

### Why We Replaced `osha.gov/rss`
Direct automated requests to `https://www.osha.gov/rss` and `dol.gov` RSS feeds return `403 Forbidden` to honest programmatic clients. Rather than bypassing WAF protections with spoofed browser headers, this platform combines two official, developer-supported federal interfaces:

1. **Engine 1 — Federal Register API v1 (`federalregister.gov/api/v1`)** *(Zero API key required)*:
   - Official REST JSON for OSHA **Final Rules**, **Proposed Rules (NPRMs)**, **Notices**, and **Public Inspection (pre-publication) filings**. The matching `application/rss+xml` feeds exist and respond, but they carry no document number or CFR references, so v1 reads the JSON endpoints only (see Stage 1 · Phase 1 · Part 1).
   - Delivers structured `cfr_references` (`title`, `part`), Federal Register citations (`91 FR 55744`), effective dates, comment deadlines, abstracts, and official `govinfo.gov` PDF links.
2. **Engine 2 — U.S. Department of Labor Open Data API v4 (`apiprod.dol.gov/v4`)** *(Free `X-API-KEY` via `dataportal.dol.gov/registration`)*:
   - Official, daily-updated REST endpoints for OSHA **Inspections**, **Violations & Penalties**, **General Duty Clause (5(a)(1)) narratives**, and **Accident Abstracts**.
   - Supplies employer names (`estab_name`), site cities/states (`site_city`, `site_state`), cited standards (`standard`, e.g. `19101030 G02   IIA`), violation gravity (`viol_type`), and penalty amounts (`initial_penalty`, `current_penalty`).

These two engines feed a newsroom interface combining:
- **Structured takeaways**: every card carries three fixed bullets built from the record's own fields (*Action / Incident*, *Standards cited*, *Dates / Penalty*), with source attribution and CFR citation chips. No language model writes or summarises anything.
- **News-front layout pacing** (inspired by Bing News): a breaking banner, category tabs (*All*, *Final Rules*, *Proposed Rules*, *Enforcement & Penalties*, *Public Inspection*, *Notices*), and a lead hero card.
- **Linear precision styling**: the existing design tokens in `static/styles.css` (`--bg`, `--panel`, `--field`, `--line`), 6px status dots, tabular numerals, and hairline borders.
- **Bidirectional CFR reader linking**: every rule or violation links to `#/title/29/section/{id}` or `#/title/29/part/{part}`, and section and part pages in the reader show related rulemaking and recent citations.

---

## Decisions (2026-11-16)

| # | Question | Decision |
| :- | :--- | :--- |
| 1 | Which agencies? | **OSHA first.** The agency is a setting (`NEWS_AGENCIES` in `reader/.env`, default `occupational-safety-and-health-administration`), but only OSHA is built, tested and supported in this plan. EPA / PHMSA (the rest of the 29/40/49 suite) are a later plan. |
| 2 | Who writes the takeaways? | **Fixed bullets** built server-side from record fields (`news.takeaways(item)`), testable offline. No Claude summaries. |
| 3 | Where does News live? | A **News** item in the activity rail **between Projects and Library**, shortcut **G N** (Alt/⌥+5; Library and Settings shift to 6 and 7, so the range becomes 1–7). In the reader, an **activity button in the section's actions row, next to Pin**. |
| 4 | Interpretations in the timeline? | **Dropped.** OSHA letters of interpretation are only on osha.gov, which this plan does not scrape. The timeline shows rulemaking and enforcement only. |
| 5 | Search integration? | **Inside `#/news` only.** News results stay out of the topbar search (`#/search`), and Claude gets no news tool for now. |
| 6 | Refresh cadence? | **Schedule-gated sync** (revised 2026-11-16, replacing the first draft's fixed 6-hour loop). Each source syncs when its publication window has passed: FR at 06:15 ET and PI at 09:00 / 11:30 / 16:30 ET on weekdays, DOL every 24h. Failures back off 5m → 15m → 1h → 6h. Opening `#/news` on stale data asks for a sync. See "Re-fetch structure" below. |

### Out of scope for this plan
- Agencies other than OSHA (the code is parameterised, but nothing else is built or tested).
- LLM-written summaries, and a Claude `search_news` tool.
- Letters of interpretation, directives, and anything else that would need osha.gov scraping.
- News results in the topbar search or the Overview page.
- A rail badge for unread news.

### Re-fetch structure (decision 6)
Researched and verified live on 2026-11-16; the evidence is in [REFETCH_CADENCE_RESEARCH.md](REFETCH_CADENCE_RESEARCH.md), and the design is in [Stage 4 · Phase 1 · Part 1](stage-4_background_polling_and_verification/phase-1_background_sync_worker/part-1_daemon_rss_sync_thread.md).
- **When sources change.** The Federal Register publishes on weekdays by 06:00 ET. Public Inspection posts regular filings at 08:45 ET and special filings at 11:15 and 16:15 ET. DOL OSHA datasets are `Daily` (`R/P1D`), at an unpublished hour.
- **No cheap "anything new?" check exists.** Neither API sends `ETag` / `Last-Modified`, and DOL's catalog `updated_at` is catalog-edit time. The real fetches are small anyway (filtered PI ≈ 5 KB; DOL is two requests).
- **Design.**
  - The worker wakes every 30 minutes and syncs only sources whose window has passed since their last success. Windows are 06:15 ET for FR and 09:00 / 11:30 / 16:30 ET for PI on weekdays, and 24h for DOL.
  - It skips weekends. Federal holidays are polled anyway: one wasted request beats a wrong holiday table.
  - Failures back off 5m → 15m → 1h → 6h per source, and `fail_count` is stored so the backoff survives a restart.
  - **GET requests never trigger a sync.** `/api/news/status` reports which sources are due, and the page posts `/api/news/refresh` with `force: false` when it opens on stale data. This also covers the macOS sleep gap, since the worker's timer doesn't advance while the machine sleeps.
  - Refresh and Retry send `force: true`, which ignores staleness and backoff.
- **Gap healing.** FR fetches by `publication_date ≥ last success − 3 days` (the whole 365-day retention window on the first sync; OSHA publishes ~125–150 documents a year, so that's one request at `per_page=200`). DOL widens from 30 to 90 days when the last success is over 30 days old.

---

## Official Documentation & Verified Endpoints

All four endpoints below returned `200` to `User-Agent: FRAMEWORK-ComplianceReader/1.0 (local-reader)` on 2026-11-16.

| Source | Purpose | Auth | Official Documentation |
| :--- | :--- | :--- | :--- |
| **Federal Register API v1** | Rulemaking JSON, `cfr_references`, `fields[]` queries | None | [API Docs](https://www.federalregister.gov/developers/documentation/api/v1) · [OpenAPI JSON](https://www.federalregister.gov/api/v1/documentation.json) · [Developer Resources](https://www.federalregister.gov/reader-aids/developer-resources) |
| **Federal Register Public Inspection JSON** | Pre-publication OSHA filings (`document_number`, `filed_at`, `filing_type`, scheduled `publication_date`) | None | [`public-inspection-documents.json`](https://www.federalregister.gov/api/v1/public-inspection-documents.json?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration) |
| **Federal Register RSS Feeds** *(verified, not used in v1)* | RSS 2.0 for published & pre-pub filings | None | [`documents.rss`](https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration) · [`public-inspection-documents.rss`](https://www.federalregister.gov/api/v1/public-inspection-documents.rss?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration) |
| **DOL Open Data API v4** | Daily OSHA inspections, violations, penalties, accidents | Free `X-API-KEY` | [DOL Data Portal](https://dataportal.dol.gov/) · [API User Guide PDF](https://www.dataportal.dol.gov/pdf/dol-api-user-guide.pdf) · [Register Key](https://dataportal.dol.gov/registration) · [Datasets JSON](https://apiprod.dol.gov/v4/datasets?limit=100) |
| **eCFR Versioner API** *(existing)* | Section-level regulatory XML & edition diffs | None | [eCFR API Docs](https://www.ecfr.gov/developers/documentation/api/v1) |

> [!NOTE]
> **Graceful degradation without a DOL key**: the Federal Register engine needs **no credentials** and works out of the box. The DOL engine switches on when `DOL_API_KEY` is set in `reader/.env`. Without it, the Enforcement tab shows setup instructions, and no other part of the app is affected.

---

## System Data Flow

```
┌──────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│ ENGINE 1: FEDERAL REGISTER API v1        │   │ ENGINE 2: DOL OPEN DATA API v4           │
│ (No API key · User-Agent: FRAMEWORK)     │   │ (Optional DOL_API_KEY via X-API-KEY)     │
│                                          │   │                                          │
│ • /api/v1/documents.json (fields[]=...,  │   │ • /v4/get/OSHA/violation/json            │
│   publication_date ≥ last success − 3d)  │   │   (newest by issuance_date, 30/90 days)  │
│ • /api/v1/public-inspection-documents    │   │ • /v4/get/OSHA/inspection/json           │
│   .json                                  │   │   (joined by activity_nr, `in` filter)   │
└────────────────────┬─────────────────────┘   └────────────────────┬─────────────────────┘
                     │                                              │
                     └──────────────────────┬───────────────────────┘
                                            ▼
                     ┌─────────────────────────────────────────────┐
                     │ news_worker (daemon, schedule-gated:        │
                     │   FR 06:15 · PI 09:00/11:30/16:30 ET · DOL  │
                     │   24h · backoff · refresh-on-open)          │
                     │ • news.py: fetch, normalise, cite, bullets  │
                     │   "19101030 G02" -> "1910.1030" (Title 29)  │
                     │ • news_store.py: data/osha_news.sqlite3     │
                     │   + FTS5, keyed by FR document_number       │
                     └──────────────────────┬──────────────────────┘
                                            │  /api/news… (news_router,
                                            │  registered before /api/{title})
              ┌─────────────────────────────┴─────────────────────────────┐
              ▼                                                           ▼
┌───────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
│ NEWSROOM (#/news, rail item "News", G N)  │   │ IN-READER CONTEXT (#/section/{id}, part)  │
│ • Breaking banner (filings & high fines)  │   │ • Activity button next to Pin:            │
│ • Category tabs + FTS filter box          │   │   "3 rules & citations"                   │
│ • State / penalty / gravity facets        │   │ • Popover timeline of FR rules and OSHA   │
│ • Cards with 3 fixed bullets + CFR chips  │   │   enforcement for the section             │
└───────────────────────────────────────────┘   └───────────────────────────────────────────┘
```

---

## Conventions every stage follows

These come from `CLAUDE.md`. They are listed here so no stage has to repeat them:
- **Icons** are inline 16px stroked SVGs through `icon()` / `ICON_PATHS` (add a `news` path), never emoji or Unicode glyphs such as ↗ › 🔴.
- **Status dots** come from `statPill(state, text)` and only mean sync state (synced / stale / busy / partial / uninstalled). Penalties and FR citations are plain tabular text, not pills.
- **Buttons**: `.btn`, `.btn-sm`, and `.btn-accent` for the primary action. (`.is-brand` does not exist.)
- **No inline `onclick`**. Use event delegation on the view, like the Library and Projects do.
- **Routing**: every loader captures `routeSeq` and bails after each `await` if it changed. Pages call `setViewHead('')`, `clearTreeSelection()` and `enterView()`.
- **Escaping**: `escapeHtml` on every field. External links must be `http(s)` only, `target="_blank" rel="noopener"`.
- **Motion** honours `prefers-reduced-motion`. Transitions name their properties (no `transition: all`).
- **`localStorage`** goes through `lsGet` / `lsSet` (wrapped in try/catch).
- **Tests run offline**: no test may reach the network, and the news worker never starts under test.
- **Docs**: the last step of each stage updates `CLAUDE.md`, `README.md`, `reader/README.md`, `reader/API.md` and `reader/.env.example` for what it shipped. The venv install line gains `tzdata`, which `zoneinfo` needs on Windows.

---

## Directory Hierarchy & Plan Architecture

```
docs/plans/40_regulatory_intelligence_and_dol/41_osha_news_interface/
├── MASTER_PLAN.md
├── REFETCH_CADENCE_RESEARCH.md        (evidence for decision 6)
├── stage-1_feed_pipeline_and_citation_engine/
│   ├── README.md
│   ├── phase-1_multi_feed_rss_crawler/
│   │   ├── part-1_feed_discovery_and_normalization.md
│   │   ├── part-2_sqlite_news_store.md
│   │   └── part-3_news_api_endpoints.md
│   └── phase-2_cfr_citation_and_entity_linking/
│       ├── part-1_citation_regex_and_linking.md
│       └── part-2_penalty_and_violation_parser.md
├── stage-2_perplexity_bing_newsroom_ui/
│   ├── README.md
│   ├── phase-1_bing_style_multicategory_newsroom/
│   │   ├── part-1_breaking_news_ticker_and_hero.md
│   │   ├── part-2_category_tabs_and_deck_filters.md
│   │   └── part-3_route_rail_and_shell_integration.md
│   └── phase-2_perplexity_style_story_cards/
│       ├── part-1_structured_takeaways_card.md
│       └── part-2_citation_chips_and_source_byline.md
├── stage-3_news_search_and_reader_bidirectional_linking/
│   ├── README.md
│   ├── phase-1_in_reader_news_context/
│   │   ├── part-1_section_news_badge_and_drawer.md
│   │   └── part-2_regulatory_timeline_view.md
│   └── phase-2_fts_and_faceted_filtering/
│       ├── part-1_news_fts5_search_indexing.md
│       └── part-2_region_and_penalty_facets.md
└── stage-4_background_polling_and_verification/
    ├── README.md
    ├── phase-1_background_sync_worker/
    │   ├── part-1_daemon_rss_sync_thread.md
    │   └── part-2_offline_news_caching.md
    └── phase-2_test_suite_and_quality_gates/
        ├── part-1_rss_parser_and_linking_unit_tests.md
        └── part-2_ui_visual_regression_checklist.md
```

Folder and file names are kept from the first draft so links stay stable. Where a name no longer fits (`multi_feed_rss_crawler`, `perplexity_bing`, `rss_parser`), the document's heading is what it covers.

### Build order
Stage 1 (Parts 1 → 2 → 3, then Phase 2) → Stage 4 Phase 1 Part 1 (worker, so there is real data) → Stage 2 → Stage 3 → Stage 4 Phase 1 Part 2 (client cache) → Stage 4 Phase 2 (tests are written alongside each part; the checklist runs last).
