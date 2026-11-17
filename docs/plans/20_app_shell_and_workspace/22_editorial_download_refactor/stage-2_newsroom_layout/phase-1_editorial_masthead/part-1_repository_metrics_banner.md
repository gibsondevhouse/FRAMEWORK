# Stage 2 · Phase 1 · Part 1: Repository Metrics Banner

## 1. Objectives
Add an authoritative 4-card metric strip beneath the library header to surface repository footprint, total titles tracked, weekly amendments, and out-of-sync indicators.

## 2. Technical Specification

### 2.1 Component Wireframe
```
┌────────────────────┬────────────────────┬────────────────────┬────────────────────┐
│ 🟢 API CONNECTION  │ 💾 LOCAL STORAGE   │ ⚡ AMENDMENTS      │ 🔄 SYNC FRESHNESS  │
│ eCFR v1 Online     │ 12 Titles (410 MB) │ 6 Amended This Wk  │ All Synced (0 Old) │
│ Latency: ~140ms    │ 64,120 sections    │ Edition: Nov 15    │ [Check Updates]    │
└────────────────────┴────────────────────┴────────────────────┴────────────────────┘
```

### 2.2 JavaScript Implementation (`reader/static/app.js`)
```javascript
function renderLibraryTelemetry(d) {
  const live = d.titles.filter(t => !t.reserved);
  const installed = live.filter(t => t.installed);
  const totalSections = installed.reduce((acc, t) => acc + (t.installed.section_count || 0), 0);
  const stale = live.filter(t => t.installed && t.latest && t.installed.edition && t.latest > t.installed.edition);
  
  // Weekly amendments calculation
  const newest = d.titles.reduce((m, t) => (t.latest && t.latest > m ? t.latest : m), '');
  let recentAmended = 0;
  if (newest) {
    const [y, m, dd] = newest.split('-').map(Number);
    const cut = new Date(Date.UTC(y, m - 1, dd - 7)).toISOString().slice(0, 10);
    recentAmended = d.titles.filter(t => t.amended && t.amended >= cut).length;
  }

  return `
    <div class="lib-metrics-bar" role="region" aria-label="Repository Telemetry">
      <div class="metric-card">
        <div class="metric-label"><span class="stat-dot is-synced" aria-hidden="true"></span>eCFR Connection</div>
        <div class="metric-val">v1 Online</div>
        <div class="metric-sub">${live.length} titles tracked</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Local Repository</div>
        <div class="metric-val">${installed.length} Installed</div>
        <div class="metric-sub">${fmt(totalSections)} sections cached</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Weekly Activity</div>
        <div class="metric-val">${recentAmended} Amended</div>
        <div class="metric-sub">Past 7 days</div>
      </div>
      <div class="metric-card${stale.length ? ' is-alert' : ''}">
        <div class="metric-label">Edition Sync</div>
        <div class="metric-val">${stale.length ? `${stale.length} Outdated` : 'Up to Date'}</div>
        <div class="metric-sub">${stale.length ? `<button type="button" class="metric-act" data-act="update-all">Update all</button>` : 'All editions current'}</div>
      </div>
    </div>`;
}
```

### 2.3 CSS Specification (`reader/static/styles.css`)
```css
.lib-metrics-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 18px 0 24px;
}

.metric-card {
  padding: 12px 14px;
  border-radius: var(--r-8);
  border: 1px solid var(--line);
  background: var(--field);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-card.is-alert {
  border-color: rgba(245, 158, 11, 0.3);
  background: color-mix(in srgb, #f59e0b 5%, var(--field));
}

.metric-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: var(--w-semibold);
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--fg-3);
}

.metric-val {
  font-size: 18px;
  font-weight: var(--w-semibold);
  letter-spacing: -.02em;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}

.metric-sub {
  font-size: 12px;
  color: var(--fg-3);
}

@media (max-width: 800px) {
  .lib-metrics-bar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

## 3. Acceptance Criteria
- [ ] Metric cards accurately report local section totals and amendment numbers.
- [ ] Clicking "Update all" initiates a batch update job if any titles are outdated.
- [ ] Responsive wrap cleanly handles narrow viewports.
