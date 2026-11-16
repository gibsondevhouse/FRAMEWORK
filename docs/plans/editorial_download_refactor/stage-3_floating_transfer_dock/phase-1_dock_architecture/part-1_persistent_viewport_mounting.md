# Stage 3 · Phase 1 · Part 1: Persistent Global Viewport Mounting

## 1. Objectives
Mount a dedicated `#global-transfer-dock` DOM node directly inside `#app` (sibling to `.main` and `.sidebar`) in `reader/static/index.html` and `reader/static/app.js` so it persists independently of hash route view updates.

## 2. Technical Specification

### 2.1 DOM Hierarchy (`reader/static/index.html`)
```html
<div id="app">
  <aside class="side" id="sidebar">...</aside>
  <main class="main" id="main">
    <div id="view-head"></div>
    <div class="view" id="view"></div>
  </main>
  <aside class="chat" id="chat">...</aside>
  <!-- Persistent Floating Transfer Dock -->
  <div id="global-transfer-dock" class="transfer-dock" hidden aria-live="polite"></div>
</div>
```

### 2.2 Dock Mounting & Polling Controller (`reader/static/app.js`)
```javascript
const domDock = document.getElementById('global-transfer-dock');

function updateGlobalDock() {
  const hasJobs = Boolean(jobs.current || jobs.queued.length);
  if (!hasJobs) {
    if (domDock && !domDock.hidden) {
      domDock.classList.remove('is-visible');
      setTimeout(() => { if (!jobs.current && !jobs.queued.length) domDock.hidden = true; }, 300);
    }
    return;
  }
  domDock.hidden = false;
  // Trigger entry animation via rAF
  requestAnimationFrame(() => domDock.classList.add('is-visible'));
  domDock.innerHTML = renderDockContent();
}
```

### 2.3 Floating CSS Positioning (`reader/static/styles.css`)
```css
.transfer-dock {
  position: fixed;
  bottom: 24px;
  right: 28px;
  width: 380px;
  max-width: calc(100vw - 40px);
  z-index: 1000;
  border-radius: var(--r-8);
  border: 1px solid var(--line-strong);
  background: color-mix(in srgb, var(--panel) 94%, #000);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  transition: opacity var(--t-base) var(--ease), transform var(--t-base) var(--ease);
  pointer-events: none;
}

.transfer-dock.is-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
```

## 3. Acceptance Criteria
- [ ] Dock appears smoothly without stutter when a job starts.
- [ ] Navigating between Library and Reader retains dock state without unmounting.
- [ ] Screen readers announce job progress through `aria-live="polite"`.
