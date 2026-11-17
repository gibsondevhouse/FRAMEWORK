# Stage 3 · Phase 1 · Part 1: Pinned Dock vs. Flyout Peek Mode

## 1. Objectives
Implement two distinct sliding drawer modes:
1. **Pinned Dock Mode**: The drawer takes up physical layout space and pushes the reading panel (`.main`).
2. **Flyout / Peek Mode**: The drawer floats directly over the reading panel with a frosted blur backdrop, leaving the text column untouched.

## 2. Technical Specification

### 2.1 CSS Mode Definitions (`reader/static/styles.css`)
```css
/* Pinned Mode (Default on desktop) */
.nav-system.is-pinned .sliding-drawer {
  position: relative;
  box-shadow: none;
}

/* Flyout / Peek Mode (Default on tablet or toggleable) */
.nav-system.is-flyout .sliding-drawer {
  position: absolute;
  top: 0; bottom: 0; left: var(--rail-w);
  box-shadow: var(--shadow-pop);
  z-index: 50;
  background: color-mix(in srgb, var(--panel) 95%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.nav-system.is-flyout .drawer-backdrop {
  position: fixed;
  inset: var(--topbar-h) 0 0 var(--rail-w);
  background: rgba(0, 0, 0, 0.4);
  z-index: 45;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--t-base) var(--ease);
}

.nav-system.is-flyout:not(.is-collapsed) .drawer-backdrop {
  opacity: 1;
  pointer-events: auto;
}
```

## 3. Acceptance Criteria
- [ ] Users can toggle between Pinned and Flyout mode in Settings.
- [ ] Clicking the backdrop in Flyout mode slides the drawer closed smoothly.
- [ ] Reading column width does not recompute when opening in Flyout mode.
