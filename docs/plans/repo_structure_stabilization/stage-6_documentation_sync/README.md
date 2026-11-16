# Stage 6: Final Documentation & Parity Sweep

## Goal
Ensure all project documentation matches the stabilized modular architecture (noting that `CLAUDE.md` was already kept current incrementally at the end of Stages 2–5).

## Tasks
1. **`CLAUDE.md` Final Verification**:
   - Confirm directory layout, `requirements.txt` / `requirements-dev.txt`, `uvicorn --reload --reload-dir app`, `vite build --watch`, Playwright instructions, local fonts, and `reader/frontend/src/` module index are accurate.
   - Verify whether `python -m unittest discover tests` remains accurate with the shared network-guard base class.
2. **`README.md` & `reader/README.md`**:
   - Document the Python-only runtime workflow (powered by committed `reader/static/dist/` and local fonts—no Node required).
   - Document the frontend contributor workflow (`cd reader/frontend && npm install && npm run watch`).
3. **`reader/API.md`**:
   - Cross-check all endpoint paths, query parameters, and response shapes against `reader/app/routers/` and Stage 1 API snapshots.

## Exit Gate
- Zero stale references to legacy `static/app.js`, `static/styles.css`, Google Fonts CDN, or missing `requirements.txt`.
- Full test suite + build-stamp check + Playwright suite pass cleanly.
