# Stage 4: Cascade-Preserving CSS Split (`styles.css`)

## Goal
Split the 2,066-line `reader/static/styles.css` into focused stylesheets without altering CSS selector specificity or cascade precedence.

## Target Layout
```
reader/static/ (or reader/frontend/src/styles/ in Stage 5)
├── styles.css               # Ordered @import manifest
└── css/
    ├── 01_tokens.css        # Design tokens (--bg, --panel, --fg, --brand, etc.)
    ├── 02_base.css          # Base resets, typography, buttons
    ├── 03_layout.css        # Topbar, 4-track layout grid, activity rail, drawer
    ├── 04_sidebar.css       # Drill-down TOC sidebar
    ├── 05_overview_lib.css  # Overview, Library catalog, status pills, newsroom cards, transfer dock
    ├── 06_panels_proj.css   # Drawer panels & Projects pages
    ├── 07_reader.css        # Section/part headers & regulation text typography
    ├── 08_chat.css          # Chat panel & bubbles
    ├── 09_responsive.css    # Media queries (<=900px, <=1200px)
    ├── 10_news.css          # News (#/news)
    └── 11_settings_help.css # Help (#/help), .env modal, Settings (#/settings)
```

## Critical Implementation Constraints
1. **Exact Cascade Order**: Sections MUST be imported in the exact line order they appear in `styles.css` today so no rule priority changes.
2. **Test Alignment**: Update the CSS comment-header slice assertions in `test_news_frontend.py`, `test_settings_env.py`, and `test_sidebar_rail.py` to read from the corresponding modular CSS file (or verify computed styles via Stage 1 Playwright tests).

## Exit Gate
- Stage 1 Playwright behavioral and screenshot comparison tests pass across dark/light themes and desktop/mobile viewports with zero visual diffs.
