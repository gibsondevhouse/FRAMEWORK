# Stage 4: Compliance Suites, Batch Operations & Backend Engine

## Goal
Implement compliance suite bundle definitions, enrich the catalog API with estimated disk sizes and agency tags, add backend batch queuing endpoints for one-click suite downloads, and establish thorough automated unit and UI verification tests.

## Phases & Parts

- **Phase 1: Compliance Suite Definitions & Catalog Enrichment**
  - [Part 1: Suite Catalog Metadata Schema](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-4_compliance_suites_and_backend/phase-1_compliance_suite_definitions/part-1_suite_catalog_metadata.md)
  - [Part 2: Estimated Size & Agency Acronym Enrichment](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-4_compliance_suites_and_backend/phase-1_compliance_suite_definitions/part-2_size_and_leaf_enrichment.md)
- **Phase 2: Batch Queue Engine**
  - [Part 1: Batch Download API Endpoint](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-4_compliance_suites_and_backend/phase-2_batch_queue_engine/part-1_batch_download_endpoint.md)
  - [Part 2: "Update All Outdated" Automated Job](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-4_compliance_suites_and_backend/phase-2_batch_queue_engine/part-2_update_all_outdated_job.md)
- **Phase 3: Testing & Verification**
  - [Part 1: Backend Suite & Queue Unit Tests](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-4_compliance_suites_and_backend/phase-3_testing_and_verification/part-1_backend_suite_tests.md)
  - [Part 2: UI Regression & Performance Checklist](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-4_compliance_suites_and_backend/phase-3_testing_and_verification/part-2_ui_regression_checklist.md)

## Success Criteria
- Pre-defined suites (EHS, Financial & Trade, GovCon FAR) accessible via `/api/library`.
- Atomic queuing of multi-title packages without thread-lock or SQLite contention.
- 100% test pass rate across `reader/tests` with new unit tests covering suite operations.
