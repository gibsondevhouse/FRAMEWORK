# Stage 1 · Phase 1 · Part 2: Status Pill Component Architecture

## 1. Objectives
Refactor `titleState(t)` in `reader/static/app.js` to return semantic `.stat-pill` HTML elements rather than concatenated plain strings, preserving all accessibility tags and screen reader semantics.

## 2. Technical Specification

### 2.1 CSS Definition (`reader/static/styles.css`)
```css
.stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 1;
  font-weight: var(--w-medium);
  letter-spacing: 0.02em;
  padding: 3px 8px;
  border-radius: var(--r-4);
  border: 1px solid var(--line);
  background: var(--field);
  color: var(--fg-2);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.stat-pill.is-synced { border-color: rgba(16, 185, 129, 0.2); }
.stat-pill.is-stale { border-color: rgba(245, 158, 11, 0.2); color: #fbbf24; }
.stat-pill.is-busy { border-color: color-mix(in srgb, var(--accent) 30%, transparent); color: var(--accent); }
.stat-pill.is-partial { border-color: rgba(129, 140, 248, 0.2); }
.stat-pill.is-uninstalled { border-color: var(--line-soft); color: var(--fg-3); }
```

### 2.2 JavaScript Rendering Function (`reader/static/app.js`)
```javascript
function renderStatusPill(t) {
  const j = jobFor(t.title, 'title');
  if (j) {
    const label = j.state === 'running' ? 'Downloading…' : 'Queued';
    return `<span class="stat-pill is-busy"><span class="stat-dot is-busy" aria-hidden="true"></span>${label}</span>`;
  }
  const inst = t.installed;
  if (!inst) {
    return `<span class="stat-pill is-uninstalled"><span class="stat-dot is-uninstalled" aria-hidden="true"></span>Available</span>`;
  }
  const stale = t.latest && inst.edition && t.latest > inst.edition;
  if (stale) {
    return `<span class="stat-pill is-stale"><span class="stat-dot is-stale" aria-hidden="true"></span>Update available</span>`;
  }
  if (!inst.whole) {
    const partsText = inst.parts ? plural(inst.parts, 'part') : plural(inst.sections || 0, 'section');
    return `<span class="stat-pill is-partial"><span class="stat-dot is-partial" aria-hidden="true"></span>Partial (${partsText})</span>`;
  }
  return `<span class="stat-pill is-synced"><span class="stat-dot is-synced" aria-hidden="true"></span>Installed</span>`;
}
```

## 3. Acceptance Criteria
- [ ] Status pills accurately reflect title state across whole, partial, stale, busy, and uninstalled.
- [ ] Screen readers receive the plain-text status while `aria-hidden="true"` prevents punctuation noise from dots.
- [ ] Pills integrate seamlessly inside both `libStory` cards and `libRow` table views.
