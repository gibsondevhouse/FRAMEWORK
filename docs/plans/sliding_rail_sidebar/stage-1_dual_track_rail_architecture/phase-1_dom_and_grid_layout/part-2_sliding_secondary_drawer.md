# Stage 1 · Phase 1 · Part 2: Sliding Secondary Drawer Container

## 1. Objectives
Create the secondary sliding drawer container that morphs to host the active rail's view, with silky sliding transitions, width persistence, and resize handle support.

## 2. Technical Specification

### 2.1 DOM Hierarchy (`reader/static/index.html`)
```html
<nav class="nav-system" id="nav-system">
  <aside class="activity-rail" id="activity-rail">...</aside>
  <!-- Secondary Sliding Drawer -->
  <section class="sliding-drawer" id="sliding-drawer" aria-label="Navigation drawer">
    <div class="drawer-header" id="drawer-header">
      <h2 class="drawer-title" id="drawer-title">Contents</h2>
      <button class="drawer-close-btn" id="drawer-collapse" title="Collapse drawer (⌘B)" aria-label="Collapse drawer">
        <svg class="icon" viewBox="0 0 16 16"><path d="M10 4 6 8l4 4"/></svg>
      </button>
    </div>
    <div class="drawer-body" id="drawer-body">
      <!-- Active view content mounted dynamically (Tree, Projects, Download, Settings) -->
    </div>
    <div class="drawer-resizer" id="drawer-resizer" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
  </section>
</nav>
```

### 2.2 CSS Sliding Physics & Transition Matrix (`reader/static/styles.css`)
```css
.nav-system {
  display: flex;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.sliding-drawer {
  width: var(--drawer-w);
  flex: 0 0 var(--drawer-w);
  height: 100%;
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  position: relative;
  transition: transform var(--t-base) var(--ease), width var(--t-quick) var(--ease), opacity var(--t-quick) var(--ease);
  will-change: transform;
  z-index: 25;
}

/* Collapsed sliding rail state */
.nav-system.is-collapsed .sliding-drawer {
  transform: translateX(-100%);
  width: 0;
  flex-basis: 0;
  opacity: 0;
  pointer-events: none;
  border-right-color: transparent;
}

/* Resizer handle on sliding rail */
.drawer-resizer {
  position: absolute;
  top: 0; right: -3px; bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 40;
  transition: background-color var(--t-quick) var(--ease);
}
.drawer-resizer:hover, .drawer-resizer.is-dragging {
  background: var(--accent);
}
```

## 3. Acceptance Criteria
- [ ] Toggling `.is-collapsed` slides the drawer in and out without horizontal jitter.
- [ ] Content inside `#drawer-body` renders smoothly at custom dragged widths.
- [ ] Hardware acceleration (`will-change: transform`) keeps animation pinned at 60/120fps.
