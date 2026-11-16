# Stage 5: Frontend Plain ES Modules -> Vite -> Incremental TypeScript

## Goal
Decompose the 5,950-line `reader/static/app.js` monolith into clean, maintainable modules built by Vite into a committed `reader/static/dist/` bundle, followed by incremental module-by-module TypeScript adoption.

## Phased Sub-Steps

### Phase 5A: Plain ES Module Split with Shared State Object
- **Shared State (`src/state.js`)**: Extract the **43 top-level `let`/`var` variables** (`currentTitle`, `installedTitles`, `treeData`, `currentSection`, `routeSeq`, `railObserver`, `isGenerating`, etc.) into one shared mutable state object (`export const state = { ... }`) so modules can mutate fields (e.g., `state.routeSeq++`) without ES module read-only binding compile errors.
- **Circular Call Resolution (`src/nav_bridge.js`)**: Break hoisted circular calls (`syncNavToRoute` ↔ view loaders) with an explicit lightweight dispatcher/registry, avoiding a reactive framework rewrite and keeping intentional in-place DOM updates (transfer dock counters, `refreshSettingsViews`) intact.
- **Module Tree (`reader/frontend/src/`)**:
  - `main.js`, `state.js`, `dom.js`, `api.js`, `router.js`, `nav_bridge.js`
  - `components/`: `rail.js`, `chat.js`, `transfer_dock.js`, `search_bar.js`, `palette.js`, `pin_pop.js`, `env_modal.js`
  - `views/`: `overview.js`, `reader.js`, `search.js`, `library.js`, `projects.js`, `news.js`, `help.js`, `settings.js`

### Phase 5B: `index.html`, Local Fonts & Vite Build Setup
- Initialize `reader/frontend/` with `package.json` and `vite.config.js` (`base: '/static/dist/'`, `outDir: '../static/dist'`).
- **Inline `<head>` Pre-Paint Script**: Keep the blocking inline script in `index.html` `<head>` that applies `theme`, `--reader-size`, `--sidebar-w`, `drawer-fly`, `drawer-collapsed`, and `drawer-retracted` before first paint.
- **Local Fonts**: Download and self-host **Geist** and **Inter** font files under `reader/frontend/public/fonts/` instead of Google Fonts CDN (`index.html:9-11`), achieving true offline/local-first parity.
- **Vendored Libraries**: Install pinned `marked` and `dompurify` via npm inside `reader/frontend/` (removing manual `static/vendor/` scripts or bundling them cleanly).
- **FastAPI Integration**: Update `reader/app/main.py:90` (`index()`) to serve `config.STATIC_DIR / "dist" / "index.html"`.
- **Committed Distribution**: Run `npm run build` and **commit `reader/static/dist/`** to Git so Python-only users and Windows machines require zero Node.js installation.
- **Dev Server Safety**: Run uvicorn with `--reload-dir app` so `reader/frontend/node_modules/` does not stall file watching.

### Phase 5C: Frontend Test Transition
- Retire brittle string-slicing tests in `test_settings_env.py`, `test_sidebar_rail.py`, and `test_news_frontend.py` (which slice between `function renderHelp(` / `renderSettingsPanel(`) in favor of the Stage 1 Playwright suite.
- Retain `NEWS_CITE_RE` regex parity testing by pointing it directly at `reader/frontend/src/views/news.js` (or `src/citations.js`) and handling both `.js` and optional `: RegExp` TS syntax cleanly.

### Phase 5D: Incremental TypeScript Migration
- Add `tsconfig.json` with `allowJs: true` and `checkJs: true`.
- Migrate modules from `.js` -> `.ts` incrementally: `types/` -> `state.ts` -> `api/` -> `router.ts` -> components -> views.

## Exit Gate
- `npm run build` succeeds cleanly and committed `reader/static/dist/` serves the full app with Node completely absent from the Python runtime path.
- All Playwright behavioral & screenshot tests pass.
- All Python tests pass.
