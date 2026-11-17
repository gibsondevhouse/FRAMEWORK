# Stage 2 · Phase 1 · Part 1: Reader TOC Drilldown Drawer

## 1. Objectives
Seamlessly transplant the existing 3-tier Table of Contents (Agencies › Parts › Sections), filter input, and foldable subparts from `#tree` directly into the sliding drawer when the Reader icon is active.

## 2. Technical Specification

### 2.1 Drawer Header & Controls (`reader/static/app.js`)
```javascript
function mountReaderDrawer() {
  const title = currentTitle ? (metaInfo.name || `Title ${currentTitle}`) : 'Regulations';
  document.getElementById('drawer-title').textContent = title;
  
  const body = document.getElementById('drawer-body');
  body.innerHTML = `
    <div class="side-filter">
      <input id="tree-filter" type="search" placeholder="Filter agencies, parts, sections…" autocomplete="off" spellcheck="false" aria-label="Filter parts and sections" aria-controls="tree" value="${escapeHtml(treeFilterStr || '')}">
      <div class="side-nav-tabs" id="side-nav-tabs" role="tablist" aria-label="Sidebar view mode">
        <button type="button" class="side-nav-tab ${rootViewMode === 'agencies' ? 'active' : ''}" id="tab-agencies" role="tab" aria-selected="${rootViewMode === 'agencies'}" data-mode="agencies">By agency</button>
        <button type="button" class="side-nav-tab ${rootViewMode === 'all-parts' ? 'active' : ''}" id="tab-parts" role="tab" aria-selected="${rootViewMode === 'all-parts'}" data-mode="all-parts">All parts</button>
      </div>
    </div>
    <div class="tree" id="tree"></div>`;

  renderTreeContents();
}
```

### 2.2 Preserving Tree State & Fold Persistence
- All existing keyboard shortcuts, Alt-click to fold all subparts, and `localStorage` `sideFolded` keys remain completely intact.
- Calling `selectTreeNode('s-1910.1200')` automatically opens the Reader drawer if collapsed.

## 3. Acceptance Criteria
- [ ] Reader drawer faithfully reproduces all existing drilldown capabilities.
- [ ] Filtering sections in the tree operates with identical speed and accuracy.
