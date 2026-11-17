# Stage 2 · Phase 1 · Part 3: Overview & Home Retraction Behaviors

## 1. Objectives
Define the intelligent sliding drawer behaviors when navigating to high-canvas views like Overview (`#/`) and Title Home (`#/title/{n}/`).

## 2. Technical Specification

### 2.1 Auto-Retraction Policy
When navigating to the Overview or Home page:
- The broadsheet layouts benefit from full horizontal canvas width.
- The sliding drawer automatically smoothly slides closed (`.is-collapsed`), leaving only the 48px activity rail.
- Clicking the Overview or Home icon on the rail while already on that page toggles a "Recent Reading History & Pinned Bookmarks" quick drawer.

### 2.2 History Quick Drawer
```javascript
function mountHistoryDrawer() {
  document.getElementById('drawer-title').textContent = 'Recent History';
  const u = loadUsage();
  const body = document.getElementById('drawer-body');
  
  // Render recently visited sections
  body.innerHTML = `
    <div class="drawer-history-list">
      <div class="drawer-section-label">Recently Read Sections</div>
      ${renderRecentSectionsList(u)}
    </div>`;
}
```

## 3. Acceptance Criteria
- [ ] Navigating to Overview retracts the drawer to maximize broadsheet viewing width.
- [ ] Re-clicking Overview opens recent reading history.
