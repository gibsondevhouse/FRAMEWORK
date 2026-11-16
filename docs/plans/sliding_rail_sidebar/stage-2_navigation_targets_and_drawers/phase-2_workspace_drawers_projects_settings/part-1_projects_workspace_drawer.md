# Stage 2 · Phase 2 · Part 1: Projects Workspace Drawer

## 1. Objectives
Create the Projects drawer enabling enterprise compliance teams to organize regulations into custom dossiers, research audits, and tagged clause sets (e.g., "OSHA HazCom 2026 Audit", "Air Permit Review", "Fleet DOT Safety").

## 2. Technical Specification

### 2.1 Drawer HTML Structure (`mountProjectsDrawer`)
```javascript
function mountProjectsDrawer() {
  document.getElementById('drawer-title').textContent = 'Compliance Projects';
  const projects = loadProjects();
  const body = document.getElementById('drawer-body');

  body.innerHTML = `
    <div class="drawer-projects-view">
      <div class="drawer-projects-toolbar">
        <button type="button" class="btn is-brand w-full" id="btn-new-project">
          ${icon('plus')} New Compliance Dossier
        </button>
      </div>

      <div class="drawer-section-label">Active Dossiers (${projects.length})</div>
      <div class="drawer-projects-list" id="drawer-projects-list">
        ${projects.map(p => `
          <div class="drawer-project-card" data-project-id="${p.id}">
            <div class="project-card-header">
              <span class="project-card-title">${escapeHtml(p.name)}</span>
              <span class="project-card-count">${p.sections.length}</span>
            </div>
            <p class="project-card-desc">${escapeHtml(p.description || 'No description')}</p>
            <div class="project-card-tags">
              ${(p.tags || []).map(t => `<span class="project-tag">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}
```

### 2.2 Dossier Card Styling (`reader/static/styles.css`)
```css
.drawer-project-card {
  padding: 10px 12px;
  border-radius: var(--r-6);
  border: 1px solid var(--line-soft);
  background: var(--field);
  cursor: pointer;
  transition: all var(--t-quick) var(--ease);
  margin-bottom: 8px;
}

.drawer-project-card:hover {
  border-color: var(--line-strong);
  background: var(--active);
}

.project-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.project-card-title {
  font-size: 13px;
  font-weight: var(--w-medium);
  color: var(--fg);
}

.project-card-count {
  font-size: 11px;
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}

.project-tag {
  display: inline-block;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--r-4);
  background: var(--panel);
  color: var(--accent);
  margin-right: 4px;
}
```

## 3. Acceptance Criteria
- [ ] Users can browse existing projects and trigger new dossier creation.
- [ ] Clicking a project card switches the reader view to the project's pinned sections.
