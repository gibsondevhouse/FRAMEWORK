# Stage 1 · Phase 1 · Part 1: Primary Icon Rail DOM Structure

## 1. Objectives
Create the fixed 48px activity icon rail in `reader/static/index.html` and `reader/static/styles.css` hosting icon anchors for Overview, Home, Reader, Projects, Download, and Settings.

## 2. Technical Specification

### 2.1 DOM Hierarchy (`reader/static/index.html`)
```html
<nav class="nav-system" id="nav-system" aria-label="Application navigation">
  <!-- Primary Fixed Activity Rail -->
  <aside class="activity-rail" id="activity-rail" role="tablist" aria-orientation="vertical" aria-label="Workspace verticals">
    <div class="rail-top">
      <button class="rail-btn" data-target="overview" role="tab" aria-selected="false" title="Overview (⌘1)">
        <svg class="icon" viewBox="0 0 16 16"><path d="M2 6.5 8 2l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z"/></svg>
        <span class="sr-only">Overview</span>
      </button>
      <button class="rail-btn" data-target="home" role="tab" aria-selected="false" title="Title Home (⌘2)">
        <svg class="icon" viewBox="0 0 16 16"><path d="M1.5 5.5h13M2.5 13.5h11M4 5.5v8M8 5.5v8M12 5.5v8M8 2.5l5.5 3H2.5Z"/></svg>
        <span class="sr-only">Title Home</span>
      </button>
      <button class="rail-btn is-active" data-target="reader" role="tab" aria-selected="true" title="Reader & Table of Contents (⌘3)">
        <svg class="icon" viewBox="0 0 16 16"><path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5V13l-4-2-4 2Z"/></svg>
        <span class="sr-only">Reader</span>
      </button>
      <button class="rail-btn" data-target="projects" role="tab" aria-selected="false" title="Compliance Projects & Dossiers (⌘4)">
        <svg class="icon" viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5Z"/></svg>
        <span class="sr-only">Projects</span>
      </button>
      <button class="rail-btn" data-target="download" role="tab" aria-selected="false" title="Library & Downloads (⌘5)">
        <svg class="icon" viewBox="0 0 16 16"><path d="M8 2v8M4.5 7.5 8 10.5l3.5-3M2.5 13.5h11"/></svg>
        <span class="rail-badge stat-dot is-busy" id="rail-download-badge" hidden></span>
        <span class="sr-only">Downloads</span>
      </button>
    </div>
    <div class="rail-bottom">
      <button class="rail-btn" data-target="settings" role="tab" aria-selected="false" title="Settings & Preferences (⌘,)">
        <svg class="icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/></svg>
        <span class="sr-only">Settings</span>
      </button>
    </div>
  </aside>
  <!-- Secondary Sliding Drawer will mount adjacent to this -->
</nav>
```

### 2.2 Layout Variables & Dimensions (`reader/static/styles.css`)
```css
:root {
  --rail-w: 48px;
  --drawer-w: 288px;
  --drawer-min-w: 220px;
  --drawer-max-w: 520px;
}

.activity-rail {
  width: var(--rail-w);
  flex: 0 0 var(--rail-w);
  height: 100%;
  background: var(--bg);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  z-index: 30;
}

.rail-top, .rail-bottom {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  align-items: center;
}
```

## 3. Acceptance Criteria
- [ ] Activity rail stays pinned at 48px on the extreme left.
- [ ] All 6 core targets render crisp stroked icons.
- [ ] Keyboard navigation (`Tab`, `Up/Down` arrow keys) moves focus smoothly through rail items.
