# Stage 1 · Phase 2 · Part 1: Rail Item Tokens & Active Glow Pills

## 1. Objectives
Implement Linear's trademark left-aligned active glowing pill and icon button tokens for the 48px rail.

## 2. Technical Specification

### 2.1 CSS Styling for Rail Buttons (`reader/static/styles.css`)
```css
.rail-btn {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: var(--r-6);
  border: 0;
  background: transparent;
  color: var(--fg-3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--t-quick) var(--ease);
}

.rail-btn:hover {
  background: var(--hover);
  color: var(--fg);
}

.rail-btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/* Linear-style left illuminated border pill */
.rail-btn::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 18px;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
  transition: transform var(--t-quick) var(--ease);
}

.rail-btn.is-active {
  background: var(--active);
  color: var(--fg);
}

.rail-btn.is-active::before {
  transform: translateY(-50%) scaleY(1);
}
```

## 3. Acceptance Criteria
- [ ] Active rail item displays an understated 3px vertical accent pill on the left edge.
- [ ] Hover and focus states feel instant and tactile.
- [ ] Inactive icons remain comfortably legible in `--fg-3`.
