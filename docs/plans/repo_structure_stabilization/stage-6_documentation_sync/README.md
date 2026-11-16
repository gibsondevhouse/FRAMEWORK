# Stage 6: Documentation Sync

## Goal
Bring all repository documentation into strict alignment with the stabilized modular architecture.

## Files to Update
1. **`CLAUDE.md`**:
   - Update directory layout (`reader/app/routers/`, `reader/app/render/`, `reader/app/library/`, `reader/app/ingest/`, `reader/frontend/`, `reader/static/dist/`).
   - Update dev commands: `uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app`, `reader/pyproject.toml` install instructions, optional Playwright test usage, and Vite frontend build workflow (`npm run build` to update committed `reader/static/dist/`).
   - Replace the ~100 monolithic `app.js` function/section references with the modular `reader/frontend/src/` module map.
2. **`README.md` & `reader/README.md`**:
   - Document Python-only runtime (using committed `reader/static/dist/`) vs. frontend contributor setup (Node/Vite).
   - Document local-first fonts and zero-external-CDN behavior.
3. **`reader/API.md`**:
   - Verify all documented endpoints against the extracted `reader/app/routers/` modules and Stage 1 API snapshots.

## Exit Gate
- Every path, command, and symbol reference in `CLAUDE.md`, `README.md`, `reader/README.md`, and `reader/API.md` matches the running codebase.
- Full test suite passes (`PYTHONPATH=reader pytest reader/tests`).
