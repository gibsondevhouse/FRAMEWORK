# Stage 0: Pre-Flight & Clean Baseline

## Goal
Establish a hermetic, cross-platform baseline before any refactoring: tag the baseline commit, fix `.env` key leaks across all `TRACKED_KEYS`, enforce sync + async network guards across every test suite, add `.gitattributes`, pin Python dependencies, and self-host variable Geist & Inter fonts.

## Branch & Tag Discipline
- Work on branch `stage-0-preflight-baseline`.
- Tag commit `370762e` as `pre-stabilization-baseline`.
- Upon passing Stage 0's gate, merge via PR and tag `stage-0-passed`.

## Tasks

1. **Tag Existing Baseline Commit**
   - `git tag pre-stabilization-baseline 370762e`.

2. **Pop-and-Restore Env Hygiene Across All `TRACKED_KEYS`**
   - `reader/app/config.py` calls `load_dotenv(ROOT_DIR / ".env")` at import time.
   - **Critical**: Do **NOT** set keys to `""` (`mock.patch.dict(os.environ, {k: ""})`): `config.news_agencies()` (`config.py:72`) falls back to `"occupational-safety-and-health-administration"` only when `NEWS_AGENCIES` is *absent*; setting it to `""` returns `[]` and breaks 4 tests.
   - Instead, mirror `test_settings_env.py:20-33`: save `os.environ.get(k)` for all 6 `TRACKED_KEYS` (`DOL_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `NEWS_AGENCIES`, `NEWS_SYNC`, `NEWS_RETENTION_DAYS`), call `os.environ.pop(k, None)`, and restore original values in `tearDown` / `addCleanup`.

3. **Enforce Dual-Transport Network Guard Across Every Test Suite**
   - Extract `NetworkGuardTestCase` into a shared test base module (e.g., `reader/tests/test_guard.py`) so both `pytest` and `python -m unittest discover tests` execute it (**do not** rely on a pytest-only `conftest.py` fixture).
   - Patch **both** `httpx.HTTPTransport.handle_request` (sync) **and** `httpx.AsyncHTTPTransport.handle_async_request` (covering `AsyncAnthropic` in `chat.py:84`).
   - Inherit from this shared base class across **all** test suites (`test_library.py`, `test_library_suites.py`, `test_library_front_page.py`, `test_api_endpoints.py`, etc.).

4. **Add `.gitattributes` for Cross-Platform LF & Binary Safety**
   - Create root `.gitattributes` enforcing `reader/frontend/** text eol=lf` and marking `*.png binary` and `*.woff2 binary` so Windows CRLF checkouts never break Stage 5 `build-stamp.json` hash checks or corrupt binary baselines/fonts.

5. **Pin Python Dependencies (`requirements.txt` & `requirements-dev.txt`)**
   - Avoid `pyproject.toml` in `reader/` (setuptools fails with "multiple top-level packages" across `app`, `tests`, `static`, `data`, `frontend`).
   - Create `reader/requirements.txt` (`fastapi`, `uvicorn[standard]`, `httpx`, `anthropic`, `python-dotenv`, `tzdata`) and `reader/requirements-dev.txt` (`-r requirements.txt`, `pytest`, pinned exact `playwright==...`, pinned exact `Pillow==...`).
   - Document one-time `playwright install chromium` (~150 MB) for running browser tests locally.

6. **Self-Host Variable Geist & Inter Fonts Locally**
   - Download **variable** `.woff2` font files for Geist and Inter (so weights `400`, `510`, `590` render identically) plus their **OFL license files** into `reader/static/fonts/`.
   - Add `@font-face` declarations to `reader/static/styles.css` with exact `font-family` names matching `--sans` at `styles.css:10` (`"Geist"` and `"Inter Variable"` / `"Inter"`).
   - Remove the external Google Fonts `<link>` tags at `reader/static/index.html:9-11`.

## Exit Gate
- `PYTHONPATH=reader pytest reader/tests -q` AND `cd reader && python -m unittest discover tests` pass **all tests** even when `reader/.env` contains real `DOL_API_KEY` and `ANTHROPIC_API_KEY` values.
