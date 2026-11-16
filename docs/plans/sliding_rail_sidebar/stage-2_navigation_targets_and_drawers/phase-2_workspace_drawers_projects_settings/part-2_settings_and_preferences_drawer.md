# Stage 2 · Phase 2 · Part 2: Settings & Preferences Drawer

## 1. Objectives
Create the quick-access Settings drawer consolidating reader typography, theme toggles, offline cache management, model choice, and keyboard shortcut cheatsheets.

## 2. Technical Specification

### 2.1 Drawer HTML Structure (`mountSettingsDrawer`)
```javascript
function mountSettingsDrawer() {
  document.getElementById('drawer-title').textContent = 'Preferences';
  const body = document.getElementById('drawer-body');
  const currentSize = localStorage.getItem('readerSize') || '16';
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';

  body.innerHTML = `
    <div class="drawer-settings-view">
      <!-- Theme Switcher -->
      <div class="settings-group">
        <label class="settings-label">Appearance</label>
        <div class="lib-seg w-full">
          <button type="button" class="${currentTheme === 'dark' ? 'is-active' : ''}" data-set-theme="dark">Dark</button>
          <button type="button" class="${currentTheme === 'light' ? 'is-active' : ''}" data-set-theme="light">Light</button>
        </div>
      </div>

      <!-- Typography -->
      <div class="settings-group">
        <div class="settings-label-row">
          <label class="settings-label">Reader Font Size</label>
          <span class="settings-val" id="val-font-size">${currentSize}px</span>
        </div>
        <input type="range" min="14" max="22" step="1" value="${currentSize}" id="input-font-size" class="range-slider">
      </div>

      <!-- Cache Management -->
      <div class="settings-group">
        <label class="settings-label">Offline Storage</label>
        <div class="cache-stat-box">
          <span class="cache-size">~482 MB cached</span>
          <button type="button" class="btn is-danger btn-sm" id="btn-prune-cache">Prune Temp</button>
        </div>
      </div>

      <!-- Hotkeys Cheatsheet -->
      <div class="settings-group">
        <label class="settings-label">Keyboard Shortcuts</label>
        <div class="hotkeys-grid">
          <div><kbd>⌘B</kbd> Toggle Drawer</div>
          <div><kbd>⌘K</kbd> Search / FTS</div>
          <div><kbd>Ctrl K</kbd> Ask Claude</div>
          <div><kbd>⌘1–5</kbd> Switch Rail</div>
        </div>
      </div>
    </div>`;
}
```

## 3. Acceptance Criteria
- [ ] Changing font size updates `--reader-size` live without reloading.
- [ ] Prune button safely cleans temporary SQLite and XML artifacts.
- [ ] Cheatsheet provides quick reference for power users.
