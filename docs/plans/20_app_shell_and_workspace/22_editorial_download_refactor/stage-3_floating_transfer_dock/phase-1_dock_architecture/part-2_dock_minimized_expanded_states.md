# Stage 3 · Phase 1 · Part 2: Dock Minimized and Expanded States

## 1. Objectives
Support minimizing the Transfer Dock to a compact 32px pill indicator so power users can minimize visual obstruction while actively reading dense legal text.

## 2. Technical Specification

### 2.1 State Management (`reader/static/app.js`)
```javascript
let isDockMinimized = false;

function toggleDockMinimized() {
  isDockMinimized = !isDockMinimized;
  try { localStorage.setItem('dockMinimized', isDockMinimized ? '1' : '0'); } catch (e) {}
  updateGlobalDock();
}
```

### 2.2 Dual-State HTML Rendering
```javascript
function renderDockContent() {
  const j = jobs.current;
  const pct = j && j.total ? Math.min(100, Math.round(j.done / j.total * 100)) : null;

  if (isDockMinimized) {
    return `
      <div class="dock-minimized" onclick="toggleDockMinimized()" role="button" aria-label="Expand download manager">
        <span class="stat-dot is-busy" aria-hidden="true"></span>
        <span class="dock-mini-text">${j ? escapeHtml(j.label) : 'Transferring…'}</span>
        <span class="dock-mini-pct">${pct != null ? `${pct}%` : '…'}</span>
      </div>`;
  }

  return `
    <div class="dock-expanded">
      <div class="dock-header">
        <div class="dock-title-group">
          <span class="stat-dot is-busy" aria-hidden="true"></span>
          <span class="dock-title">${j ? escapeHtml(j.label) : 'Starting…'}</span>
        </div>
        <div class="dock-actions">
          <button type="button" class="dock-btn-icon" onclick="toggleDockMinimized()" title="Minimize" aria-label="Minimize">
            ${icon('minimize')}
          </button>
        </div>
      </div>
      ...
    </div>`;
}
```

### 2.3 CSS Transition between States
```css
.dock-minimized {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 12px;
  font-weight: var(--w-medium);
  color: var(--fg);
}

.dock-mini-pct {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
```

## 3. Acceptance Criteria
- [ ] Clicking the minimize icon shrinks the dock into a compact pill.
- [ ] Clicking the pill restores full telemetry mode.
- [ ] State preference persists in `localStorage`.
