# Stage 2 · Phase 2 · Part 1: Featured Compliance Suite Hero

## 1. Objectives
Create the 65% width primary hero card on the Library front page, spotlighting the core compliance package (EHS: Titles 29, 40, and 49) with high-density quick parts and a prominent batch download trigger.

## 2. Technical Specification

### 2.1 Visual Layout & Structure
```
┌─────────────────────────────────────────────────────────────┐
│ 🌟 FEATURED COMPLIANCE SUITE             [🟢 2 of 3 Active] │
│ Environmental Health & Safety (EHS Core)                    │
│ Complete statutory baseline for workplace safety (OSHA),     │
│ environmental protection (EPA), and hazmat transport (DOT). │
│                                                             │
│ • Title 29 (OSHA) ── Part 1910 General Industry, 1926 Const.│
│ • Title 40 (EPA)  ── Part 261 Hazardous Waste, 63 Air Toxics│
│ • Title 49 (DOT)  ── Part 172 Hazmat Table, 395 Hours Svc   │
│ ─────────────────────────────────────────────────────────── │
│ 64,056 Total Sections · ~88 MB      [ Download Full Suite ] │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 JavaScript Rendering (`renderSuiteHero`)
```javascript
function renderSuiteHero(d) {
  const titles = [29, 40, 49].map(n => d.titles.find(t => t.title === n)).filter(Boolean);
  const installedCount = titles.filter(t => t.installed).length;
  const isAllInstalled = installedCount === titles.length;

  return `
    <article class="suite-hero" aria-label="Featured EHS Suite">
      <div class="suite-kicker-row">
        <span class="story-kicker">FEATURED COMPLIANCE SUITE</span>
        <span class="stat-pill ${isAllInstalled ? 'is-synced' : installedCount > 0 ? 'is-partial' : 'is-uninstalled'}">
          <span class="stat-dot ${isAllInstalled ? 'is-synced' : installedCount > 0 ? 'is-partial' : 'is-uninstalled'}" aria-hidden="true"></span>
          ${isAllInstalled ? 'Suite Installed' : installedCount > 0 ? `${installedCount} of 3 Installed` : 'Available'}
        </span>
      </div>
      <h2 class="suite-title">EHS & Workplace Safety Suite</h2>
      <p class="suite-dek">
        The complete foundational regulatory corpus spanning OSHA occupational standards, EPA emissions and hazardous waste controls, and DOT hazardous materials transport.
      </p>
      <div class="suite-titles-list">
        ${titles.map(t => `
          <div class="suite-title-item">
            <span class="suite-title-num">Title ${t.title}</span>
            <span class="suite-title-name">${escapeHtml(t.name)}</span>
            <span class="suite-title-stat">${t.installed ? 'Installed' : 'Available'}</span>
          </div>`).join('')}
      </div>
      <div class="suite-footer">
        <div class="suite-telemetry">64,056 Sections · ~88 MB Footprint</div>
        <div class="suite-actions">
          ${isAllInstalled
            ? `<a class="btn" href="#/title/29/">Open Suite</a>`
            : `<button type="button" class="btn is-brand" data-act="download-suite" data-suite="ehs">
                ${icon('download')} Download EHS Suite
              </button>`}
        </div>
      </div>
    </article>`;
}
```

### 2.3 CSS Styling
```css
.suite-hero {
  padding: 20px 22px;
  border-radius: var(--r-8);
  border: 1px solid var(--line-strong);
  background: var(--field);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.suite-kicker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.suite-title {
  margin: 0;
  font-size: 20px;
  line-height: 1.25;
  font-weight: var(--w-semibold);
  letter-spacing: -.02em;
  color: var(--fg);
}

.suite-dek {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--fg-2);
}

.suite-titles-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0;
  padding: 10px 12px;
  background: var(--panel);
  border-radius: var(--r-6);
  border: 1px solid var(--line-soft);
}

.suite-title-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12px;
}

.suite-title-num {
  font-weight: var(--w-medium);
  color: var(--fg);
  min-width: 60px;
}

.suite-title-name {
  color: var(--fg-2);
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suite-title-stat {
  font-size: 11px;
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}

.suite-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
}

.suite-telemetry {
  font-size: 12px;
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}
```

## 3. Acceptance Criteria
- [ ] Primary card stands out prominently as the lead visual anchor on the page.
- [ ] Single-click "Download EHS Suite" initiates batch queuing for Titles 29, 40, and 49.
