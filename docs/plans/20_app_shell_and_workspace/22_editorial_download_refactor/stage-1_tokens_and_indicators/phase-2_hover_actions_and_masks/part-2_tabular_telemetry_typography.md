# Stage 1 · Phase 2 · Part 2: Tabular Telemetry & Dateline Typography

## 1. Objectives
Standardize tabular numerals and micro-telemetry formatting across all library cards and rows to ensure consistent vertical alignment when numbers tick or vary in width.

## 2. Technical Specification

### 2.1 Tabular Numeral Font Features
All section counts, file sizes, and amendment dates must use `font-variant-numeric: tabular-nums`:

```css
.story-date,
.story-telemetry,
.lib-status,
.lib-num {
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.story-telemetry {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--fg-3);
}

.story-telemetry .telemetry-metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
```

### 2.2 Telemetry Formatter Helpers (`reader/static/app.js`)
```javascript
const fmtBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

const fmtSections = (count) => {
  if (!count) return '';
  return `${fmt(count)} ${count === 1 ? 'sec' : 'secs'}`;
};
```

## 3. Acceptance Criteria
- [ ] Dates and numbers align vertically without jitter during filtering or re-sorting.
- [ ] Storage sizes and section counts display with clear unit abbreviations.
