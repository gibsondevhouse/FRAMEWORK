# Stage 1: API Snapshots & Browser Parity Harness

## Goal
Create deterministic API-shape snapshots and automated in-process Playwright visual/behavioral baselines against the untouched `app.js` and `styles.css` before refactoring backend or frontend code.

## Tasks

1. **Deterministic API JSON Response Snapshots (`reader/tests/test_api_snapshots.py`)**
   - FastAPI routes declare no Pydantic `response_model`, so OpenAPI schemas cannot verify payload shapes.
   - **Hermetic Setup**:
     - Patch `config.ROOT_DIR` to a temp directory (as in `test_settings_env.py:23`) so `/api/settings/env` never reads real `reader/.env`.
     - Stub `library.ecfr_titles` and `library.ecfr_title` so `/api/library` and `/api/library/wire` never touch eCFR.
     - Normalize dynamic timestamps (`checked_at`, `amended`, `built_at`, `created_at`, etc.) before snapshot comparison.
   - **Full Endpoint Coverage**:
     - All GET routes: `/api/titles`, `/api/meta`, `/api/tree`, `/api/section/{id}`, `/api/part/{part}`, `/api/part/{part}/full`, `/api/search`, `/api/{title}/...` equivalents, `/api/models`, `/api/{title}/models`, `/api/library`, `/api/library/jobs`, `/api/library/storage`, `/api/library/wire`, `/api/library/{title}`, `/api/library/{title}/part/{part}`, `/api/news`, `/api/news/status`, `/api/news/facets`, `/api/news/section/{id}`, `/api/news/part/{part}`, and `/api/settings/env`.
     - All POST and DELETE routes: `/api/settings/env`, `/api/library/download`, `/api/library/batch-download`, `/api/library/{title}/update`, `/api/library/{title}` (DELETE), `/api/library/update-all`, `/api/library/jobs/{id}/cancel`, `/api/library/jobs/clear`, `/api/library/storage/prune`, `/api/news/refresh`, `/api/chat`, and `/api/{title}/chat`.
     - Error response shapes: `404`, `409`, `422`, and `503`.

2. **In-Process Playwright + Pillow Visual Parity Suite (`reader/tests/test_browser_parity.py`)**
   - FastAPI `TestClient` does not open a socket; run `uvicorn` on an ephemeral `127.0.0.1:0` port in an in-process background thread with `NEWS_SYNC=0` so all test mocks (`FakeTitles`, `FakeAPI`) and network guards remain active.
   - Guard imports with `pytest.importorskip("playwright.sync_api")` / `@unittest.skipUnless` so tests skip cleanly if Playwright or Chromium binaries are absent.
   - **Determinism Controls**:
     - Freeze browser time with `page.clock` (so relative timestamps like "Updated 3 min ago" or "amended this week" never drift).
     - Seed deterministic `localStorage` (`usage`, `railState`, `framework_projects_v1`).
     - Enable `reduced_motion="reduce"` to eliminate route fade-in and dock-pulse timing variance.
     - Fail on any unexpected external network requests (local fonts are already self-hosted in Stage 0).
   - **Behavioral Assertions**:
     - Hash routes (`#/`, `#/library`, `#/news`, `#/projects`, `#/settings`, `#/help`, `#/title/29/section/1910.120`).
     - Rail & drawer states (`drawer-collapsed`, `drawer-retracted`, `drawer-fly`, drag resize persistence).
     - Shortcuts (`Control+b` / `Meta+b`, `g` then `o`/`h`/`c`/`p`/`n`/`l`/`s`, `Alt+1..7`, `>` command palette).
     - Transfer dock live patching, search dropdown, `.env` modal, and Pin popover.
   - **Per-Platform Screenshot Baselines**:
     - Python Playwright lacks `to_have_screenshot`; implement a Pillow pixel-diff helper with a small configurable tolerance against **per-platform** directories (`reader/tests/baselines/darwin/` and `reader/tests/baselines/win32/`) covering dark/light themes and desktop (`1280x800`) / mobile (`390x844`) viewports.

## Exit Gate
- Full API JSON snapshots recorded and passing.
- Playwright behavioral and screenshot baseline tests pass on the untouched frontend.
