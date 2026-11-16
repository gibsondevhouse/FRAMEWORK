# Stage 1: API Snapshots & Browser Parity Harness

## Goal
Build automated behavioral, API-shape, and visual baselines against the untouched codebase *before* modifying any routes, CSS, or JavaScript.

## Tasks

1. **API JSON Response Snapshots**
   - FastAPI routes currently declare no Pydantic `response_model`, meaning OpenAPI schemas do not lock response payload shapes.
   - Add a snapshot suite (`reader/tests/test_api_snapshots.py`) running against `FakeTitles` and seeded news fixtures to record and assert exact JSON structures/keys for:
     - `/api/titles`, `/api/meta`, `/api/tree`, `/api/section/{id}`, `/api/part/{part}`, `/api/part/{part}/full`, `/api/search`
     - `/api/{title}/meta`, `/api/{title}/tree`, `/api/{title}/section/{id}`, `/api/{title}/part/{part}`, `/api/{title}/search`, `/api/{title}/models`
     - `/api/library`, `/api/library/jobs`, `/api/library/storage`, `/api/library/wire`, `/api/library/{title}`, `/api/library/{title}/part/{part}`
     - `/api/news`, `/api/news/status`, `/api/settings/env`

2. **Playwright Browser & Visual Baseline Suite (`pip`)**
   - Add Playwright-based tests under `reader/tests/test_browser_parity.py` running against the live FastAPI `TestClient`/uvicorn test server using `FakeTitles`.
   - Use `pytest.importorskip("playwright.sync_api")` (and skip gracefully if browser binaries are missing) so environments without Playwright continue running unit tests smoothly.
   - Cover core behaviors currently untested by string-matching:
     - Hash navigation (`#/`, `#/library`, `#/news`, `#/projects`, `#/settings`, `#/help`, `#/title/29/section/1910.120`)
     - Activity rail & drawer states (`drawer-collapsed`, `drawer-retracted`, `drawer-fly`, drag resize persistence)
     - Keyboard shortcuts (`Control+b` / `Meta+b`, `g` then `o`/`h`/`c`/`p`/`n`/`l`/`s`, `Alt+1..7`, `>` command palette)
     - Transfer dock in-place progress patching & search typeahead dropdown
     - `.env` editor modal and section Pin popover
   - Capture reference screenshots (dark/light themes, desktop `1280x800` and mobile `390x844`) for Stage 4 CSS verification.

## Exit Gate
- API JSON snapshots recorded and passing.
- Playwright parity suite passes against untouched `app.js` and `styles.css`.
