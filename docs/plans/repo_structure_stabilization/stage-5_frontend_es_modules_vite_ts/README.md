# Stage 5: Vite Wrap -> Legacy Cleanup -> ES Module Split -> Incremental TypeScript

## Goal
Migrate `reader/static/app.js` (5,950 lines) into a modular, Vite-built, TypeScript-ready frontend emitting fixed unminified assets to committed `reader/static/dist/`—verifying every sub-step against the Playwright parity harness.

## Branch & Tag Discipline
- Branch `stage-5-frontend-modularization` from `stage-4-passed`; merge via PR after gate passes and tag `stage-5-passed`.

## Phased Sub-Steps

### Phase 5A: Vite Baseline Wrap (Untouched `app.js`)
1. Initialize `reader/frontend/` with pinned Node (`.nvmrc` + `package.json` `"engines"`), committed `package-lock.json`, and `vite.config.js`:
   - Configure `base: '/static/dist/'` and `outDir: '../static/dist'`.
   - Emit **fixed, unminified** filenames (`app.js`, `app.css`, `index.html`) so committed `dist/` diffs stay readable and work cleanly with `RevalidatedStaticFiles` (`Cache-Control: no-cache`).
   - Add a Vite build plugin that sorts files in `reader/frontend/src/` + `reader/frontend/index.html` by POSIX `/` path, normalizes `\r\n` -> `\n`, and writes SHA-256 to `reader/static/dist/build-stamp.json`.
2. Move `reader/static/css/` once via `git mv` into `reader/frontend/src/styles/` and wrap the **unchanged** `app.js` as Vite's single entry (`<script type="module">` is safe because `app.js` uses `'use strict'` and sets no `window.*` globals).
3. Keep `marked.min.js` (15.0.12) and `purify.min.js` (3.4.17) as classic scripts in `reader/frontend/public/vendor/` during 5A so `app.js` needs **zero edits** in 5A.
4. Keep the `<head>` pre-paint theme and `railState` script **inline and blocking** in `reader/frontend/index.html`.
5. Update `reader/app/main.py:90` (`index()`) to serve `config.STATIC_DIR / "dist" / "index.html"`.
6. Add `reader/tests/test_build_stamp.py` (pure Python, LF-normalized, sorted `/` paths) that fails if `frontend/src/` or `frontend/index.html` diverges from `dist/build-stamp.json`.
7. **Verify**: Run `npm run build` and confirm Playwright + Pillow baselines pass with `REQUIRE_BROWSER=1`.

### Phase 5B: Remove Legacy Static Files & Repoint Markup Tests
1. Delete legacy `reader/static/app.js`, `reader/static/styles.css`, `reader/static/index.html`, and `reader/static/vendor/` so no stale duplicates remain served.
2. Repoint HTML markup checks (`test_sidebar_rail.py`, `test_settings_env.py`, `test_news_frontend.py`) to `reader/frontend/index.html` and modular CSS paths.
3. Retire brittle JS function-slicing assertions (`split("function renderSettingsPanel(")`)—covered now by `REQUIRE_BROWSER=1` Playwright tests.

### Phase 5C: Plain ES Module Split (`reader/frontend/src/`)
1. **Shared State Object (`src/state.js`)**: Move all **43 top-level `let`/`var` variables** (`currentTitle`, `installedTitles`, `treeData`, `currentSection`, `routeSeq`, `railObserver`, `isGenerating`, etc.) into one mutable `export const state = { ... }` object so imported modules never hit ES module read-only binding errors (`state.routeSeq++`).
2. **Circular Call Bridge (`src/nav_bridge.js`)**: Break hoisted circular calls (`syncNavToRoute` ↔ view loaders) with a lightweight dispatcher, keeping deliberate in-place DOM patching (transfer dock counters, `refreshSettingsViews`) intact.
3. **NPM Vendor Migration**: Install pinned `"marked": "15.0.12"` and `"dompurify": "3.4.17"` via npm in `reader/frontend/` and delete `reader/frontend/public/vendor/`.
4. **Target Layout (`reader/frontend/src/`)**:
   - `main.js`, `state.js`, `dom.js`, `api.js`, `router.js`, `nav_bridge.js`
   - `components/`: `rail.js`, `chat.js`, `transfer_dock.js`, `search_bar.js`, `palette.js`, `pin_pop.js`, `env_modal.js`
   - `views/`: `overview.js`, `reader.js`, `search.js`, `library.js`, `projects.js`, `news.js`, `help.js`, `settings.js`
5. **Test Source Helpers**:
   - Add a multi-file source-concatenation helper for remaining JS text assertions (`NAV_TARGETS`, `GO_KEYS`, `/^Digit[1-7]$/`, `checkPath === '/news'`, `lsSet('railState'`).
   - Update `test_news_frontend.py`'s `NEWS_CITE_RE` path directly to `reader/frontend/src/views/news.js` (or `citations.js`).
6. Rebuild `reader/static/dist/` and verify `REQUIRE_BROWSER=1` Playwright + Pillow baselines pass.

### Phase 5D: Incremental TypeScript Migration
1. Add `tsconfig.json` with `allowJs: true` and `checkJs: true`.
2. Split `src/api.js` -> `src/api/` and add `src/types/` as modules migrate `.js` -> `.ts` one by one.
3. Ensure `test_news_frontend.py` regex extraction handles optional `: RegExp` TS type annotations cleanly.

## Dev Loop & Docs Sync
- **Standard Dev Loop**: Run `npm run watch` (`vite build --watch`) alongside `uvicorn app.main:app --reload --reload-dir app`.
- **Docs Sync**: Update `CLAUDE.md` immediately upon stage completion.

## Exit Gate
- Committed `reader/static/dist/` passes `test_build_stamp.py` and serves with zero Node runtime in Python.
- All Python tests (`pytest` + `unittest discover`) and CI (`REQUIRE_BROWSER=1`, macOS + Windows baselines) pass.
