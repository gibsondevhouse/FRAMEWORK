# Stage 2 · Phase 1 · Part 2: Download & Library Management Drawer

## 1. Objectives
Create the quick-access Download drawer displaying active jobs, installed title inventory, compliance suite triggers, and single-click access to the full Library newsroom.

## 2. Technical Specification

### 2.1 Drawer HTML Structure (`mountDownloadDrawer`)
```javascript
function mountDownloadDrawer() {
  document.getElementById('drawer-title').textContent = 'Library & Downloads';
  const live = (lib.data?.titles || []).filter(t => t.installed);
  const body = document.getElementById('drawer-body');

  body.innerHTML = `
    <div class="drawer-download-view">
      <div class="drawer-download-head">
        <a class="btn is-brand w-full" href="#/library">
          ${icon('download')} Open Full Newsroom Library
        </a>
      </div>
      
      <!-- Active Job Telemetry -->
      ${jobs.current ? `
        <div class="drawer-job-card">
          <div class="drawer-job-header">
            <span class="stat-dot is-busy"></span>
            <span class="drawer-job-title">${escapeHtml(jobs.current.label)}</span>
          </div>
          <div class="dock-progress-track">
            <div class="dock-progress-fill" style="width: ${jobs.current.total ? Math.round(jobs.current.done / jobs.current.total * 100) : 30}%"></div>
          </div>
          <div class="drawer-job-phase">${escapeHtml(jobs.current.phase)}</div>
        </div>` : ''}

      <!-- Installed Titles Quick List -->
      <div class="drawer-section-label">Installed Titles (${live.length})</div>
      <div class="drawer-installed-list">
        ${live.map(t => `
          <a class="drawer-installed-row" href="#/title/${t.title}/">
            <span class="drawer-title-num">${t.title}</span>
            <span class="drawer-title-name">${escapeHtml(t.name)}</span>
            <span class="stat-dot is-synced"></span>
          </a>`).join('')}
      </div>
    </div>`;
}
```

## 3. Acceptance Criteria
- [ ] Users can review active download status and installed titles without leaving their current section.
- [ ] One-click button jumps straight to `#/library`.
