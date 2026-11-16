# Stage 1: Sanctioned API Ingestion Pipeline + Citation Engine

## Goal
Build the backend: `reader/app/news.py` (fetch, normalise, cite, takeaways), `reader/app/news_store.py` (SQLite + FTS5, sync status, retention) and `reader/app/news_api.py` (the `/api/news…` router). It is fed by the **Federal Register API v1** and the **DOL Open Data API v4**, and it normalises citations to Title 29 CFR. OSHA only (see the decisions in [MASTER_PLAN.md](../MASTER_PLAN.md)).

## Phases & Parts

- **Phase 1: Sanctioned API Ingestion, Storage & Endpoints**
  - [Part 1: Federal Register & DOL v4 API Client + Normalization](phase-1_multi_feed_rss_crawler/part-1_feed_discovery_and_normalization.md)
  - [Part 2: SQLite News, Rulemaking & Enforcement Store](phase-1_multi_feed_rss_crawler/part-2_sqlite_news_store.md)
  - [Part 3: News API Endpoints](phase-1_multi_feed_rss_crawler/part-3_news_api_endpoints.md)
- **Phase 2: CFR Citation Normalization & Enforcement Parsing**
  - [Part 1: CFR Reference & DOL Standard Code Linkifier](phase-2_cfr_citation_and_entity_linking/part-1_citation_regex_and_linking.md)
  - [Part 2: DOL Enforcement Violation, Gravity & Penalty Builder](phase-2_cfr_citation_and_entity_linking/part-2_penalty_and_violation_parser.md)

## Success Criteria
- Honest identification (`User-Agent: FRAMEWORK-ComplianceReader/1.0 (local-reader)`) on every request, with no browser spoofing.
- Federal Register documents and Public Inspection filings ingest as JSON without keys. A filing and its published document share one record.
- FR is fetched by `publication_date` since the last success (the whole retention window on the first sync), following `next_page_url`. The DOL window (30 or 90 days) is passed in by the scheduler (Stage 4 · Phase 1 · Part 1).
- `sync_status` records per-source success, error and `fail_count`. `/api/news/status` reports `stale` / `due` / `retry_after` / `next_due_at` and never triggers a sync. `POST /api/news/refresh` takes `force`.
- DOL data activates only when `DOL_API_KEY` is set. Enforcement items are built violations-first and dated by citation issuance.
- `cfr_references`, DOL `standard` codes and prose citations normalise to Title 29 ids, without false positives from bare numbers.
- `/api/news…` routes are reachable (registered before `/api/{title}`) and return empty results, never errors, on a fresh install.
- Docs updated: `reader/API.md` (endpoints), `reader/.env.example` (`DOL_API_KEY`, `NEWS_AGENCIES`, `NEWS_SYNC`, `NEWS_RETENTION_DAYS`), `CLAUDE.md` (architecture paragraph).
