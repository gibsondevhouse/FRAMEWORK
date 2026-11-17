# Stage 3 · Phase 2 · Part 1: Linear Progress Bar & Glow Animation

## 1. Objectives
Create the Linear-style 3px progress bar with brand gradient fill, subtle leading edge glow, and smooth CSS width transitions.

## 2. Technical Specification

### 2.1 CSS Track & Fill Architecture (`reader/static/styles.css`)
```css
.dock-progress-track {
  position: relative;
  height: 3px;
  background: var(--line-soft);
  border-radius: 2px;
  overflow: hidden;
  margin: 10px 0 8px;
}

.dock-progress-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: linear-gradient(90deg, var(--brand), var(--accent));
  border-radius: 2px;
  transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 50%, transparent);
}

/* Indeterminate slide animation for initial connection phase */
.dock-progress-fill.is-indeterminate {
  width: 35% !important;
  animation: dock-slide-indeterminate 1.4s var(--ease) infinite;
}

@keyframes dock-slide-indeterminate {
  0% { left: -35%; }
  100% { left: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .dock-progress-fill.is-indeterminate {
    animation: none;
    left: 0;
    width: 100% !important;
    opacity: 0.5;
  }
}
```

## 3. Acceptance Criteria
- [ ] Progress increments smoothly without jumping backwards.
- [ ] Indeterminate state slides smoothly while eCFR connection is being established.
- [ ] Respects reduced-motion user preferences.
