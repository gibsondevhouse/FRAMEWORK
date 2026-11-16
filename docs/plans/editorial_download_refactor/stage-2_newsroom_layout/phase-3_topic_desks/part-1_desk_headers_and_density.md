# Stage 2 · Phase 3 · Part 1: Desk Header Anatomy & Grid Layout

## 1. Objectives
Refactor the topic desk containers into responsive, hairline-separated Linear editorial grids supporting high-density browsing.

## 2. Technical Specification

### 2.1 CSS Layout & Media Queries
```css
.lib-desk {
  margin-top: 36px;
}

.lib-desk-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px 8px;
  border-bottom: 1px solid var(--line-strong);
  margin-bottom: 12px;
}

.lib-desk-name {
  margin: 0;
  font-size: 13px;
  font-weight: var(--w-semibold);
  letter-spacing: -.01em;
  color: var(--fg);
}

.lib-desk-count {
  font-size: 11px;
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}

.lib-stories {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
}

/* Widescreen 3-column optimization */
@media (min-width: 1400px) {
  .lib-stories {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* Tablet & Mobile single-column collapse */
@media (max-width: 768px) {
  .lib-stories {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
```

## 3. Acceptance Criteria
- [ ] Topic desks expand cleanly to 3 columns on large displays (>1400px).
- [ ] Section count badges reflect the exact number of titles under each desk.
- [ ] Desks without matching filter items collapse completely without leaving orphan headers.
