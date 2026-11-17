# Stage 4: Cascade-Preserving CSS Split (`styles.css`)

## Goal
Split the 2,066-line `reader/static/styles.css` into focused modular files while preserving the **exact original selector cascade order**—including all inline `@media` blocks—verified by Stage 1 per-platform screenshot baselines.

## Branch & Tag Discipline
- Branch `stage-4-css-split` from `stage-3-passed`; merge via PR after gate passes and tag `stage-4-passed`.

## Target Layout
```
reader/static/
├── styles.css                   # Ordered @import manifest
└── css/
    ├── 01_tokens.css            # Design tokens (--bg, --panel, --fg, --brand, etc.) + @font-face
    ├── 02_base.css              # Base resets, typography, buttons
    ├── 03_layout.css            # Topbar, 4-track layout grid, activity rail, drawer
    ├── 04_sidebar.css           # Drill-down TOC sidebar
    ├── 05_home_overview_lib.css # Home (line 542), Overview, Library, status pills, newsroom cards, transfer dock
    ├── 06_panels_proj.css       # Drawer panels & Projects pages
    ├── 07_reader.css            # Section/part headers & regulation text typography
    ├── 08_chat.css              # Chat panel & bubbles
    ├── 09_responsive.css        # Standalone Responsive section (lines 1631–1712)
    ├── 10_news.css              # News (#/news)
    └── 11_settings_help.css     # Help (#/help), .env modal, Settings (#/settings)
```

*(In Stage 5, `reader/static/css/` is moved once via `git mv` into `reader/frontend/src/styles/`.)*

## Critical Implementation Constraints
1. **Keep Inline `@media` Blocks In Place**:
   - Six `@media` blocks sit inline inside feature sections (`styles.css` lines 756, 971, 1048, 1053, 1217, 1457). Keep every one in its owning feature file at its exact original position rather than moving them into `09_responsive.css`.
2. **Assign Every Section Explicitly**:
   - Ensure `Home` (`styles.css:542`) is placed in `05_home_overview_lib.css` in order.
3. **Update Test Assertions & Docs**:
   - Update CSS comment-header slice assertions in `test_news_frontend.py`, `test_settings_env.py`, and `test_sidebar_rail.py` to read from the modular CSS files.
   - Update `CLAUDE.md` CSS architecture section at stage completion.

## Exit Gate
- All Python tests pass.
- Stage 1 Playwright behavioral suite and per-platform (`darwin` & `win32`) Pillow screenshot baselines pass in CI (`REQUIRE_BROWSER=1`).
