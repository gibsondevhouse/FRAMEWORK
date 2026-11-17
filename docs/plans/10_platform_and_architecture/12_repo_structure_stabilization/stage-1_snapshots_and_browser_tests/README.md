# Stage 1: API/SSE Snapshots, Playwright Harness & CI

## Goal
Build deterministic JSON, SSE stream, behavioral, and per-platform visual baselines against the untouched backend and frontend—plus automated macOS/Windows CI—before decomposing any routes, stylesheets, or scripts.

## Branch & Tag Discipline
- Work on branch `stage-1-snapshots-and-ci` (from `stage-0-passed`), merge via PR, and tag `stage-1-passed`.

## Tasks

1. **Deterministic API & SSE Snapshots (`reader/tests/test_api_snapshots.py`)**
   - FastAPI routes declare no Pydantic `response_model`, so OpenAPI schemas cannot verify payload shapes.
   - **Hermetic Setup**:
     - Patch `config.ROOT_DIR` to a temp directory (`test_settings_env.py:23`) so `/api/settings/env` never reads real `reader/.env`.
     - Stub `library.ecfr_titles` and `library.ecfr_title` so `/api/library` and `/api/library/wire` never call eCFR.
     - Normalize dynamic timestamps (`checked_at`, `amended`, `built_at`, `created_at`) before snapshot comparison.
     - For `POST` download/update routes (`/api/library/download`, `/api/library/batch-download`, `/api/library/{title}/update`, `/api/library/update-all`), snapshot using a fresh `library.Queue` instance whose background worker never starts so jobs cannot race or leak across tests.
     - Stub `news_worker.request_sync` when snapshotting `POST /api/news/refresh`.
   - **Complete Route & Stream Coverage**:
     - All GET routes: `/api/titles`, `/api/meta`, `/api/tree`, `/api/section/{id}`, `/api/part/{part}`, `/api/part/{part}/full`, `/api/search`, `/api/{title}/...` equivalents, `/api/models`, `/api/{title}/models`, `/api/library`, `/api/library/jobs`, `/api/library/storage`, `/api/library/wire`, `/api/library/{title}`, `/api/library/{title}/part/{part}`, `/api/news`, `/api/news/status`, `/api/news/facets`, `/api/news/section/{id}`, `/api/news/part/{part}`, `/api/settings/env`.
     - All POST & DELETE routes: `/api/settings/env`, `/api/library/download`, `/api/library/batch-download`, `/api/library/{title}/update`, `/api/library/{title}` (DELETE), `/api/library/update-all`, `/api/library/jobs/{id}/cancel`, `/api/library/jobs/clear`, `/api/library/storage/prune`, `/api/news/refresh`.
     - **Chat SSE Stream Snapshots**: Snapshot `/api/chat` and `/api/{title}/chat` using a fake `AsyncAnthropic` streaming a scripted `text | tool | tool_result | done` (and `error`) SSE exchange.
     - **Error Shapes**: Snapshot `404`, `409`, `422`, and `503` responses.

2. **In-Process Playwright + Pillow Visual Parity Suite (`reader/tests/test_browser_parity.py`)**
   - **Runner Compatibility**: Use a `try/except ImportError` guard with `unittest.skipUnless` (never `pytest.importorskip`, which breaks `python -m unittest discover tests`). Support `REQUIRE_BROWSER=1`: when set, missing Playwright or Chromium **fails** instead of skipping.
   - **In-Process Server**: Start `uvicorn` on `127.0.0.1:0` in a background thread inside the test process so `FakeTitles`, `FakeAPI`, and the Stage 0 network guard remain active.
   - **Keep `NEWS_SYNC` Enabled**: Do **NOT** set `NEWS_SYNC=0` (that triggers 503 on `/api/news/refresh` and alters Newsroom screenshots). Leave `NEWS_SYNC` enabled and stub `news_worker.start` and `news_worker.request_sync`.
   - **Determinism Controls**:
     - Freeze browser time via `page.clock` AND freeze server-side `now` (`news_schedule` / `news_store`) alongside fixed fixture timestamps so `due` and relative timestamps ("Updated 3 min ago") never drift.
     - Seed deterministic `localStorage` (`usage`, `railState`, `framework_projects_v1`).
     - Set `device_scale_factor=1` and `reduced_motion="reduce"`.
     - Assert zero external network requests.
   - **Behavioral Assertions**: Hash routes, rail/drawer states, shortcuts (`Control+b`/`Meta+b`, `g` then `o/h/c/p/n/l/s`, `Alt+1..7`, `>` palette), transfer dock in-place updates, search dropdown, `.env` modal, Pin popover.
   - **Strict Per-Platform Pillow Baselines**:
     - Compare screenshots via Pillow with a small pixel-diff tolerance against `reader/tests/baselines/darwin/` and `reader/tests/baselines/win32/` (dark/light themes, desktop `1280x800`, mobile `390x844`).
     - **Missing baselines FAIL** by default; support `UPDATE_BASELINES=1` only for explicit baseline recording/updating.

3. **GitHub Actions CI Workflow (`.github/workflows/ci.yml`)**
   - Run on `macos-latest` and `windows-latest`, installing `reader/requirements-dev.txt` + Playwright Chromium, and executing `PYTHONPATH=reader REQUIRE_BROWSER=1 pytest reader/tests`.
   - Include a workflow dispatch/helper path to generate/artifact-export `win32` baselines when needed.

## Exit Gate
- Full API/SSE snapshots, `REQUIRE_BROWSER=1` Playwright + Pillow suite, and CI pass on both `macos-latest` and `windows-latest`.
