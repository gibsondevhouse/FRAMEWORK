# Stage 4: Cascade-Preserving CSS Split (`styles.css`)

## Goal
Break the 2,066-line `reader/static/styles.css` into focused modules while preserving the **exact original cascade order**—including inline `@media` blocks—so specificity and visual output remain unchanged.

## Target Layout
```
reader/static/
├── styles.css               # Ordered @import manifest
└── css/
    ├── 01_tokens.css        # Design tokens (--bg, --panel, --fg, --brand, etc.) + @font-face
    ├── 02_base.css          # Base resets, typography, buttons
    ├── 03_layout.css        # Topbar, 4-track layout grid, activity rail, drawer
    ├── 04_sidebar.css       # Drill-down TOC sidebar
    ├── 05_home_overview_lib.css # Home (line 542), Overview, Library, status pills, newsroom cards, transfer dock
    ├── 06_panels_proj.css   # Drawer panels & Projects pages
    ├── 07_reader.css        # Section/part headers & regulation text typography
    ├── 08_chat.css          # Chat panel & bubbles
    ├── 09_responsive.css    # Standalone Responsive section (lines 1631–1712)
    ├── 10_news.css          # News (#/news)
    └── 11_settings_help.css # Help (#/help), .env modal, Settings (#/settings)
```

*(Note: When Stage 5 initializes `reader/frontend/`, `reader/static/css/` is moved once via `git mv` into `reader/frontend/src/styles/`.)*

## Critical Implementation Constraints
1. **Do NOT Relocate Inline `@media` Blocks**:
   - Six `@media` blocks sit inline inside feature sections (`styles.css` lines 756, 971, 1048, 1053, 1217, 1457). Keep every one in its owning feature file at its exact original position rather than sweeping them into `09_responsive.css`.
2. **Assign Every Section Explicitly**:
   - Ensure `Home` (`styles.css:542`) is cleanly placed in `05_home_overview_lib.css` in order.
3. **Update Test Assertions**:
   - Update CSS comment-header slice checks in `test_news_frontend.py`, `test_settings_env.py`, and `test_sidebar_rail.py` to point to the split modular stylesheets.
4. **Docs Sync**:
   - Update `CLAUDE.md` CSS architecture section at stage completion.

## Exit Gate
- Stage 1 Playwright behavioral suite and per-platform Pillow screenshot comparisons pass within tolerance across dark/light themes and desktop/mobile viewports.
