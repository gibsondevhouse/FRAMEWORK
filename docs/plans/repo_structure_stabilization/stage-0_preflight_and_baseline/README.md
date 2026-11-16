# Stage 0: Pre-Flight & Clean Baseline

## Goal
Establish a hermetic, reproducible baseline before any structural refactoring begins—ensuring tests pass on every machine regardless of `.env`, blocking all real HTTP clients (sync and async), pinning dependencies, and self-hosting fonts so visual baselines never shift mid-refactor.

## Tasks

1. **Tag Existing Baseline Commit**
   - Baseline commit `370762e` is already committed; tag it (`git tag pre-stabilization-baseline 370762e`) so parity diffs reference a fixed point.

2. **Fix Environment Leak Across All `TRACKED_KEYS`**
   - `reader/app/config.py` calls `load_dotenv(ROOT_DIR / ".env")` at import time. Currently, `DOL_API_KEY` in `reader/.env` breaks 9 tests (`test_news_api.py`, `test_news_fetch.py`), and `ANTHROPIC_API_KEY` leaks into `chat.py` / `/api/{title}/models`.
   - Update `NetworkGuardTestCase.setUp` (extracted into a shared test base module, e.g., `reader/tests/test_guard.py`) to clear **all 6 `TRACKED_KEYS`** (`DOL_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `NEWS_AGENCIES`, `NEWS_SYNC`, `NEWS_RETENTION_DAYS` from `test_settings_env.py:14`) via `mock.patch.dict(os.environ, {k: "" for k in TRACKED_KEYS})` with `addCleanup`, except where an individual test explicitly sets one.

3. **Enforce Dual-Transport Network Guard Across Every Test Suite**
   - Patch **both** `httpx.HTTPTransport.handle_request` (sync) **and** `httpx.AsyncHTTPTransport.handle_async_request` (covering `AsyncAnthropic` in `chat.py:84`).
   - Keep the guard in a shared `unittest.TestCase` base class—**not** a pytest-only `conftest.py` fixture—so both `pytest` and `python -m unittest discover tests` run with the guard active.
   - Apply this base class to all suites (`test_library.py`, `test_library_suites.py`, `test_library_front_page.py`, `test_api_endpoints.py`, etc.).

4. **Pin Python Dependencies (`requirements.txt` & `requirements-dev.txt`)**
   - Do **not** use `pyproject.toml` inside `reader/` (setuptools fails with "multiple top-level packages" across `app`, `tests`, `static`, `data`, `frontend`).
   - Create `reader/requirements.txt` (`fastapi`, `uvicorn[standard]`, `httpx`, `anthropic`, `python-dotenv`, `tzdata`) and `reader/requirements-dev.txt` (`-r requirements.txt`, `pytest`, `playwright`, `Pillow`).
   - Document the one-time Playwright browser step (`playwright install chromium`, ~150 MB).

5. **Self-Host Geist & Inter Fonts Locally**
   - Download local `.woff2` font files for Geist and Inter into `reader/static/fonts/` and add `@font-face` declarations to `reader/static/styles.css`.
   - Remove the Google Fonts `<link>` tags at `reader/static/index.html:9-11` so the app is 100% local-first and Stage 1 screenshot baselines capture the final fonts.

## Exit Gate
- Baseline commit `370762e` is tagged and `git status` is clean.
- `PYTHONPATH=reader pytest reader/tests -q` and `cd reader && python -m unittest discover tests` pass **all tests** even with populated secrets in `reader/.env`.
