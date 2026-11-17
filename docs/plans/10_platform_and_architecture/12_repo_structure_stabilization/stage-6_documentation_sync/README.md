# Stage 6: Final Documentation & Launcher Sync

## Goal
Ensure all project documentation and launch scripts match the stabilized modular architecture (noting `CLAUDE.md` was kept current incrementally at Stages 2–5).

## Branch & Tag Discipline
- Branch `stage-6-docs-sync` from `stage-5-passed`; merge via PR after gate passes and tag `stage-6-passed`.

## Tasks
1. **Update `Start FRAMEWORK.command`**:
   - Replace the hard-coded `pip install` command at line 26 (which omits `tzdata`) with `pip install -r "$ROOT/reader/requirements.txt"`.
2. **`CLAUDE.md` Final Audit**:
   - Verify directory layout, `requirements.txt` / `requirements-dev.txt`, `uvicorn --reload --reload-dir app`, `vite build --watch`, Playwright `REQUIRE_BROWSER=1` instructions, local variable fonts, `reader/frontend/src/` module index, and `unittest discover` parity.
3. **`README.md` & `reader/README.md`**:
   - Document Python-only runtime (powered by committed `reader/static/dist/` and local fonts—no Node required).
   - Document frontend contributor workflow (`cd reader/frontend && npm install && npm run watch`, `.nvmrc`).
4. **`reader/API.md`**:
   - Cross-check all endpoints, query params, and response schemas against `reader/app/routers/` and Stage 1 API/SSE snapshots.

## Exit Gate
- Zero stale references to legacy `static/app.js`, `static/styles.css`, Google Fonts CDN, or hard-coded `Start FRAMEWORK.command` package lists.
- Full test suite + `test_build_stamp.py` + CI (`REQUIRE_BROWSER=1`, macOS + Windows) pass cleanly.
