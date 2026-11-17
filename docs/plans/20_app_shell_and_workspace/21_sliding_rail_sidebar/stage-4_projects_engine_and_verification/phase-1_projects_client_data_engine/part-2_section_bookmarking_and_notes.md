# Stage 4 · Phase 1 · Part 2: Section Bookmarking & Annotation Storage

## 1. Objectives
Enable one-click section bookmarking directly from the reading panel into any active project, with optional inline annotations.

## 2. Technical Specification

### 2.1 Reading View "Pin to Project" Button (`#view-head`)
Add a bookmark trigger beside the section headline or in `#view-head`:
```html
<button class="doc-step-btn" id="btn-pin-section" title="Pin to Project (⌘D)" aria-label="Pin section to project">
  <svg class="icon" viewBox="0 0 16 16"><path d="M3 2.5h10v11l-5-2.5-5 2.5Z"/></svg>
  <span>Pin</span>
</button>
```

### 2.2 Pinning Controller (`reader/static/app.js`)
```javascript
function pinCurrentSection(projectId, note = '') {
  if (!currentSection) return;
  const projects = loadProjects();
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;

  const alreadyPinned = proj.sections.some(s => s.id === currentSection && s.title === currentTitle);
  if (!alreadyPinned) {
    proj.sections.push({
      title: currentTitle,
      id: currentSection,
      heading: metaInfo.section_heading || `§ ${currentSection}`,
      pinned_at: new Date().toISOString(),
      note
    });
    proj.updated_at = new Date().toISOString();
    saveProjects(projects);
    showToast(`Pinned § ${currentSection} to ${proj.name}`);
  }
}
```

## 3. Acceptance Criteria
- [ ] Users can pin regulations to projects with a single shortcut (`⌘D`).
- [ ] Pinned sections immediately display in the Projects drawer.
