# Stage 1 · Phase 2 · Part 2: Notification & Transfer Badges

## 1. Objectives
Add micro-indicator overlays directly onto rail icons to alert users of active background downloads, new updates, or unread notes without needing to open the drawer.

## 2. Technical Specification

### 2.1 Micro-Badge Geometry (`reader/static/styles.css`)
```css
.rail-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  pointer-events: none;
}

.rail-badge.stat-dot {
  width: 5px;
  height: 5px;
}

/* Numeric notification pill (for projects / updates) */
.rail-num-badge {
  position: absolute;
  top: 4px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--brand);
  color: #fff;
  font: var(--w-semibold) 9px/14px var(--sans);
  text-align: center;
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--bg);
}
```

### 2.2 Badge Controller (`reader/static/app.js`)
```javascript
function updateRailBadges() {
  const downloadBadge = document.getElementById('rail-download-badge');
  if (!downloadBadge) return;
  const isDownloading = Boolean(jobs.current || jobs.queued.length);
  downloadBadge.hidden = !isDownloading;
  if (isDownloading) {
    downloadBadge.className = 'rail-badge stat-dot is-busy';
  }
}
```

## 3. Acceptance Criteria
- [ ] Active background transfers illuminate a pulsing dot on the Download rail icon.
- [ ] Badges do not obscure the central glyph of the icon.
