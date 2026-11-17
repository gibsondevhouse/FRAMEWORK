# Stage 2 · Phase 2 · Part 2: The Regulatory Wire Ticker

## 1. Objectives
Implement the 35% width secondary column beside the hero: a chronological wire service ticker showing recently amended federal titles and edition deltas.

## 2. Technical Specification

### 2.1 Visual Layout & Structure
```
┌──────────────────────────────────────┐
│ ⚡ THE REGULATORY WIRE               │
│ Recent eCFR Amendments (7 Days)      │
│ ──────────────────────────────────── │
│ [●] Title 40 (EPA)             Today │
│     Part 261 Hazardous waste amended │
│                                      │
│ [●] Title 49 (DOT)            Nov 12 │
│     Part 172 Hazmat tables updated   │
│                                      │
│ [●] Title 29 (OSHA)           Nov 10 │
│     Part 1910 Subpart Z revisions    │
│ ──────────────────────────────────── │
│ [ View Federal Register Feed › ]     │
└──────────────────────────────────────┘
```

### 2.2 JavaScript Implementation (`renderRegulatoryWire`)
```javascript
function renderRegulatoryWire(d) {
  const live = d.titles.filter(t => !t.reserved && t.amended);
  // Sort descending by amendment date
  const sorted = [...live].sort((a, b) => b.amended.localeCompare(a.amended)).slice(0, 5);

  return `
    <aside class="reg-wire" aria-label="The Regulatory Wire">
      <div class="wire-header">
        <span class="wire-title">⚡ The Regulatory Wire</span>
        <span class="wire-badge">Live eCFR</span>
      </div>
      <div class="wire-sub">Chronological amendments stream</div>
      <div class="wire-items">
        ${sorted.map(t => `
          <div class="wire-entry">
            <div class="wire-entry-head">
              <span class="wire-entry-title">Title ${t.title} · ${escapeHtml(t.name)}</span>
              <span class="wire-entry-date">${escapeHtml(shortDate(t.amended))}</span>
            </div>
            <p class="wire-entry-summary">${escapeHtml(t.summary || 'Federal regulatory revision active in current edition.')}</p>
          </div>`).join('')}
      </div>
      <div class="wire-footer">
        <a class="wire-link" href="#/search?title=all&scope=amended">Browse recent regulatory deltas ›</a>
      </div>
    </aside>`;
}
```

### 2.3 CSS Specification
```css
.reg-wire {
  padding: 18px 20px;
  border-radius: var(--r-8);
  border: 1px solid var(--line);
  background: var(--field);
  display: flex;
  flex-direction: column;
}

.wire-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wire-title {
  font-size: 13px;
  font-weight: var(--w-semibold);
  letter-spacing: -.01em;
  color: var(--fg);
}

.wire-badge {
  font-size: 10px;
  font-weight: var(--w-semibold);
  text-transform: uppercase;
  letter-spacing: .06em;
  padding: 1px 6px;
  border-radius: var(--r-4);
  background: var(--active);
  color: var(--accent);
}

.wire-sub {
  font-size: 11px;
  color: var(--fg-3);
  margin-top: 2px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line-soft);
}

.wire-items {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0;
}

.wire-entry-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.wire-entry-title {
  font-size: 12px;
  font-weight: var(--w-medium);
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wire-entry-date {
  font-size: 11px;
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.wire-entry-summary {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--fg-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wire-footer {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--line-soft);
}

.wire-link {
  font-size: 11px;
  color: var(--accent);
}
```

## 3. Acceptance Criteria
- [ ] Wire automatically surfaces the 5 most recently amended titles.
- [ ] Overflowing summaries cleanly clamp at 2 lines with ellipsis.
- [ ] Mobile collapse seamlessly reorders the wire below the hero suite card.
