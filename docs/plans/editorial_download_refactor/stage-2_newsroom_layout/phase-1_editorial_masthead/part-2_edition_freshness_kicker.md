# Stage 2 · Phase 1 · Part 2: Edition Freshness Kicker & Global Stats

## 1. Objectives
Enhance the Library top kicker and headline subtitle to clearly convey edition dates, federal publication timelines, and data freshness.

## 2. Technical Specification

### 2.1 Refactored Subtitle Logic (`reader/static/app.js`)
```javascript
const editionDateText = newest ? `eCFR Edition ${fmtDate(newest)}` : 'eCFR Synchronized';
const amendedText = recent ? `${recent} amended this week` : 'No amendments this week';
const activeCountText = `${live.length} active titles`;

sub = `Official Code of Federal Regulations · ${editionDateText} · ${activeCountText} · ${amendedText}`;
```

### 2.2 Breadcrumb & Header Geometry
```css
.doc-kicker {
  font-size: 11px;
  font-weight: var(--w-semibold);
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--fg-3);
  margin-bottom: 6px;
}

.lib-sub {
  margin: 0;
  color: var(--fg-3);
  font-size: 13px;
  line-height: 1.5;
  max-width: 720px;
}
```

## 3. Acceptance Criteria
- [ ] Subtitle cleanly parses the newest ISO date into a localized string (e.g., "Nov 15, 2026").
- [ ] Punctuation and separation dots remain crisp with proper ARIA hidden attributes.
