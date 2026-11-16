# Stage 5: Vite Wrap -> Legacy Cleanup -> ES Module Split -> Incremental TypeScript

## Goal
Migrate `reader/static/app.js` (5,950 lines) into a modular, Vite-built, TypeScript-ready frontend committed to `reader/static/dist/`—verifying every step independently against the Playwright parity harness.

## Phased Sub-Steps

### Phase 5A: Vite Baseline Wrap (Before Splitting)
1. Initialize `reader/frontend/` with `package.json` and `vite.config.js`:
   - Configure `base: '/static/dist/'` and `outDir: '../static/dist'`.
   - Emit **fixed, unminified** filenames (`app.js`, `app.css`, `index.html`) so committed diffs in `reader/static/dist/` stay readable and work cleanly with `RevalidatedStaticFiles` (`Cache-Control: no-cache`).
   - Write `reader/static/dist/build-stamp.json` containing a SHA-256 hash of `reader/frontend/src/` and `reader/frontend/index.html`.
2. Move `reader/static/css/` once into `reader/frontend/src/styles/` and wrap the **unchanged** `app.js` as Vite's single entry (`<script type="module">` is safe because `app.js` already uses `'use strict'` and exports no `window.*` globals).
3. Keep the `<head>` pre-paint theme and `railState` script **inline and blocking** in `reader/frontend/index.html`.
4. Install pinned `marked` and `dompurify` via npm inside `reader/frontend/`.
5. Update `reader/app/main.py:90` (`index()`) to serve `config.STATIC_DIR / "dist" / "index.html"`.
6. Add a zero-Node Python test (`reader/tests/test_build_stamp.py`) that recomputes the hash of `frontend/src/` + `frontend/index.html` and fails if it differs from `dist/build-stamp.json`.
7. **Verify**: Run `npm run build` and verify the Stage 1 Playwright + Pillow suite passes on the untouched Vite-wrapped bundle.

### Phase 5B: Remove Legacy Files & Repoint Markup Tests
1. Delete legacy `reader/static/app.js`, `reader/static/styles.css`, `reader/static/index.html`, and `reader/static/vendor/` so stale duplicates cannot remain served or drift.
2. Update markup assertions (`test_sidebar_rail.py`, `test_settings_env.py`, `test_news_frontend.py`) to inspect `reader/frontend/index.html` and modular CSS/JS paths.
3. Retire brittle JS function-slicing assertions (`split("function renderSettingsPanel(")`) in favor of the Stage 1 Playwright suite.

### Phase 5C: Plain ES Module Split (`reader/frontend/src/`)
1. **Shared State Object (`src/state.js`)**: Move all **43 top-level `let`/`var` variables** (`currentTitle`, `installedTitles`, `treeData`, `currentSection`, `routeSeq`, `railObserver`, `isGenerating`, etc.) into a single mutable `export const state = { ... }` object so imported modules never hit ES module read-only binding errors (`state.routeSeq++`).
2. **Circular Call Bridge (`src/nav_bridge.js`)**: Break hoisted circular calls (`syncNavToRoute` ↔ view loaders) with a lightweight callback/event bridge. Keep deliberate in-place DOM patching (transfer dock counters, `refreshSettingsViews`) intact rather than rewriting into a reactive framework.
3. **Target Layout (`reader/frontend/src/`)**:
   - `main.js`, `state.js`, `dom.js`, `api.js`, `router.js`, `nav_bridge.js`
   - `components/`: `rail.js`, `chat.js`, `transfer_dock.js`, `search_bar.js`, `palette.js`, `pin_pop.js`, `env_modal.js`
   - `views/`: `overview.js`, `reader.js`, `search.js`, `library.js`, `projects.js`, `news.js`, `help.js`, `settings.js`
4. Rebuild `reader/static/dist/` and verify Playwright + Pillow screenshot baselines pass.

### Phase 5D: Incremental TypeScript Migration
1. Add `tsconfig.json` with `allowJs: true` and `checkJs: true`.
2. Split `src/api.js` -> `src/api/` (per domain) and add `src/types/` as modules are converted from `.js` to `.ts` one by one.
3. Ensure the `NEWS_CITE_RE` regex parity test in `test_news_frontend.py` handles optional `: RegExp` TS annotations cleanly.

## Dev Loop & Build Hygiene
- **Standard Dev Loop**: Run `npm run watch` (`vite build --watch`) alongside `uvicorn app.main:app --reload --reload-dir app` so `node_modules` never triggers Python reloader stalls and development matches production single-origin serving.
- **Docs Sync**: Update `CLAUDE.md` immediately upon stage completion.

## Exit Gate
- Committed `reader/static/dist/` passes `test_build_stamp.py` and runs with zero Node.js dependency at runtime.
- All Python tests and Playwright + Pillow parity tests pass.
