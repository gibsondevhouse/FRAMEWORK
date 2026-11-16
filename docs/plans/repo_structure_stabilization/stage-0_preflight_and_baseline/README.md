# Stage 0: Pre-Flight & Clean Baseline

## Goal
Establish a reproducible, hermetically sealed baseline before any structural refactoring begins.

## Tasks

1. **Commit & Tag Current Baseline**
   - Review and commit the ~400 lines of currently uncommitted changes across `CLAUDE.md`, `reader/static/app.js`, `reader/static/index.html`, `reader/static/styles.css`, and `reader/tests/test_settings_env.py`.
   - Tag the baseline commit (e.g., `pre-stabilization-baseline`) so every subsequent diff and parity check compares against a fixed reference.

2. **Fix the `DOL_API_KEY` Environment Leak in Tests**
   - `reader/app/config.py` calls `load_dotenv(ROOT_DIR / ".env")` at import time. When `reader/.env` contains a real `DOL_API_KEY`, 9 tests in `reader/tests/test_news_api.py` and `reader/tests/test_news_fetch.py` fail because they assume no key is configured.
   - Update `NetworkGuardTestCase.setUp` in `reader/tests/news_fixtures.py` to clear `DOL_API_KEY` (and `ANTHROPIC_API_KEY` / other `.env`-leaked test variables) via `mock.patch.dict(os.environ, {"DOL_API_KEY": ""}, clear=False)` with `addCleanup`.

3. **Enforce Universal Network Guard**
   - Currently only news test suites inherit `NetworkGuardTestCase`. `test_library.py`, `test_library_suites.py`, `test_library_front_page.py`, and `test_api_endpoints.py` lack the `httpx.HTTPTransport.handle_request` guard.
   - Move `NetworkGuardTestCase` (or an autouse pytest fixture in `reader/tests/conftest.py`) to block all real outbound HTTP requests across **every** test module, ensuring broken test stubs fail loudly instead of silently hitting eCFR or external APIs.

4. **Pin Python Dependencies**
   - Create `reader/pyproject.toml` (or `reader/requirements.txt`) pinning `fastapi`, `uvicorn[standard]`, `httpx`, `anthropic`, `python-dotenv`, `pytest`, and `tzdata`, plus an optional `[dev]` group for `playwright`.

## Exit Gate
- `git status` is clean and baseline tag exists.
- `PYTHONPATH=reader pytest reader/tests -q` passes **221 / 221** even with a populated `reader/.env`.
