# Stage 1 · Phase 1 · Part 1: Status Dot Tokens & Animation

## 1. Objectives
Define the core Linear status dot tokens and micro-glow keyframe animations in `reader/static/styles.css`.

## 2. Technical Specification

### 2.1 Color Tokens & Glow Geometry
The status dot is an ultra-crisp 6px circular element with an optional high-frequency pulse ring for active operations:

```css
/* Status indicators: Linear precision dot matrix */
.stat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 6px;
  background: var(--fg-4);
  transition: background-color var(--t-quick) var(--ease), box-shadow var(--t-quick) var(--ease);
}

/* Synced & Up-to-Date (Emerald) */
.stat-dot.is-synced {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.45);
}

/* Update Available / Outdated (Amber) */
.stat-dot.is-stale {
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.45);
}

/* Active Transfer / In Flight (Indigo / Accent Pulse) */
.stat-dot.is-busy {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
  animation: stat-pulse-ring 1.6s cubic-bezier(0.24, 0, 0.38, 1) infinite;
}

/* Partial Installation (Violet / Indigo Half) */
.stat-dot.is-partial {
  background: #818cf8;
  box-shadow: 0 0 5px rgba(129, 140, 248, 0.4);
}

/* Available / Uninstalled (Muted Gray) */
.stat-dot.is-uninstalled {
  background: var(--fg-4);
  opacity: 0.7;
}

@keyframes stat-pulse-ring {
  0% { transform: scale(0.92); opacity: 0.8; }
  50% { transform: scale(1.35); opacity: 1; }
  100% { transform: scale(0.92); opacity: 0.8; }
}

@media (prefers-reduced-motion: reduce) {
  .stat-dot.is-busy { animation: none; }
}
```

## 3. Acceptance Criteria
- [ ] Dot scales precisely to 6px without blur or pixel distortion on high-DPI displays.
- [ ] Active pulse ring respects `prefers-reduced-motion`.
- [ ] Contrast meets WCAG AA standards against both `--panel` and `--field` backgrounds.
