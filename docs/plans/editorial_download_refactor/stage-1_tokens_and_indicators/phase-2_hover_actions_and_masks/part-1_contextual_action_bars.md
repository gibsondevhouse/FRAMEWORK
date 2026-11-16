# Stage 1 · Phase 2 · Part 1: Contextual Action Bars with Gradient Fade

## 1. Objectives
Implement Linear-style hover action disclosures in `reader/static/styles.css` utilizing dual CSS mask linear gradients to ensure long regulatory text smoothly dissolves behind incoming buttons rather than colliding or truncating abruptly.

## 2. Technical Specification

### 2.1 CSS Masking Architecture
```css
.story-actions {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 28px;
  opacity: 0;
  pointer-events: none;
  background: linear-gradient(to right, transparent, var(--hover) 24px);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 20px);
  mask-image: linear-gradient(to right, transparent, #000 20px);
  transition: opacity var(--t-quick) var(--ease);
}

/* Disclose on hover, focus-within, or when armed for deletion */
.lib-story:hover .story-actions,
.lib-story:focus-within .story-actions,
.story-actions:has(.is-armed) {
  opacity: 1;
  pointer-events: auto;
}

/* Touch devices always show actions */
@media (hover: none) {
  .story-actions {
    position: static;
    opacity: 1;
    pointer-events: auto;
    padding-left: 0;
    background: none;
    mask-image: none;
    -webkit-mask-image: none;
  }
}
```

### 2.2 Button Action Micro-Interactions
The action buttons follow Linear's 24px compact pill geometry:
```css
.lib-act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: var(--r-4);
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--fg-2);
  font: var(--w-medium) 12px/1 var(--sans);
  cursor: pointer;
  transition: all var(--t-quick) var(--ease);
}

.lib-act:hover {
  background: var(--active);
  border-color: var(--line-strong);
  color: var(--fg);
  text-decoration: none;
}

.lib-act.is-primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.lib-act.is-primary:hover {
  filter: brightness(1.1);
}
```

## 3. Acceptance Criteria
- [ ] Hovering over any title card smoothly fades in the action bar.
- [ ] Dateline text underneath cleanly dissolves without clipping borders.
- [ ] Two-step armed confirmation on "Remove" keeps the action bar pinned until timeout or confirm.
