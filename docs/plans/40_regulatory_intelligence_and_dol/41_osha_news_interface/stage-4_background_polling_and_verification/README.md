# Stage 4: Schedule-Gated Sync, Client Cache & Verification

## Goal
- A daemon worker that syncs each source after its publication window has passed, with backoff on failure. FR is due at 06:15 ET, PI at 09:00 / 11:30 / 16:30 ET (weekdays), and DOL every 24h with a key.
- Syncs can be requested from the page. The worker never runs under test.
- A stale-while-revalidate cache, so `#/news` paints instantly and asks for a sync when it opens on stale data.
- Offline test suites built from verified payload shapes, and a manual UI checklist.

## Phases & Parts

- **Phase 1: Schedule-Gated Sync & Client Cache**
  - [Part 1: Schedule-Gated Sync Worker](phase-1_background_sync_worker/part-1_daemon_rss_sync_thread.md)
  - [Part 2: Stale-While-Revalidate Client Cache](phase-1_background_sync_worker/part-2_offline_news_caching.md)
- **Phase 2: Tests & Verification**
  - [Part 1: Offline Tests](phase-2_test_suite_and_quality_gates/part-1_rss_parser_and_linking_unit_tests.md)
  - [Part 2: UI Verification Checklist](phase-2_test_suite_and_quality_gates/part-2_ui_visual_regression_checklist.md)

## Success Criteria
- Decision 6 as designed: per-source publication windows in `America/New_York`, weekends skipped and holidays not, a 30-minute local check that makes no requests when nothing is due, backoff of 5m → 15m → 1h → 6h stored in `sync_status.fail_count`, and refresh-on-open through `POST /api/news/refresh` (GETs never sync). The evidence is in [REFETCH_CADENCE_RESEARCH.md](../REFETCH_CADENCE_RESEARCH.md).
- Gaps heal on their own: FR by publication date since the last success, DOL by widening from 30 to 90 days.
- A failing source, a missing `DOL_API_KEY` or no network never affects startup or the reader.
- Tests run offline, never start the worker, and cover the schedule (including DST and weekends), parsing, fetching, the store, every endpoint, route ordering and the rail changes.
- The checklist passes in both themes at three widths, with and without a DOL key.
- Docs: add `tzdata` to the venv install line (Windows needs it for `zoneinfo`).
