# Execution Prompt — Plan 42: DOL Open Data API v4 Expansion

> **Status:** Ready for future execution (**Do NOT execute until explicitly instructed**)

## Role
You are a senior full-stack engineer (Python / FastAPI / SQLite FTS5 + vanilla ES6/TS + Vite CSS) working in **FRAMEWORK** (`reader/`).

Implement **Plan 42: DOL Open Data API v4 Expansion** (`docs/plans/40_regulatory_intelligence_and_dol/42_dol_api_expansion/`) stage by stage, leaving every stage passing the full offline pytest + Playwright suite before moving on.

## Pre-Flight Reading
Before editing any file, read:
1. `CLAUDE.md`
2. `docs/plans/40_regulatory_intelligence_and_dol/41_osha_news_interface/MASTER_PLAN.md` (already implemented baseline)
3. `docs/plans/40_regulatory_intelligence_and_dol/42_dol_api_expansion/MASTER_PLAN.md`
4. The active Stage `README.md` for the step you are executing.

## Hard Execution Rules
- **Respect DOL `HTTP 429` rate limits**: Never trigger live DOL calls on keystrokes, hover events, or FastAPI `GET` renders unless explicitly cached and rate-guarded. Use `FakeAPI` in `reader/tests/news_fixtures.py` for all tests.
- **No broken schemas**: Existing user `reader/data/osha_news.sqlite3` files must upgrade seamlessly without deleting cached articles or cases.
- **UI & Style Contracts**: Check `reader/tests/test_news_frontend.py`, `reader/tests/test_api_snapshots.py`, and `reader/tests/test_build_stamp.py`. After every frontend edit run `npx tsc --noEmit && npm run build` inside `reader/frontend/`.
- **Documentation Sync**: When finishing all stages, update `reader/API.md`, `CLAUDE.md`, `docs/plans/README.md` status (`Completed`), and `route_inventory.json`.
- **Final Gate**: Run `cd reader && REQUIRE_BROWSER=1 ../.venv/bin/python -m pytest tests -q` and inspect Playwright screenshots in dark and light mode.
