# Stage 4 · Phase 1 · Part 1: Projects JSON Schema & Dossiers

## 1. Objectives
Define the data structure for compliance dossiers in `localStorage`, supporting project creation, editing, deletion, and export.

## 2. Technical Specification

### 2.1 Project JSON Schema
```json
{
  "id": "proj_9f82d1",
  "name": "OSHA HazCom 2026 Audit",
  "description": "Chemical labeling and safety data sheet compliance review for Plant B.",
  "created_at": "2026-11-16T00:15:00Z",
  "updated_at": "2026-11-16T00:18:00Z",
  "tags": ["OSHA", "HazCom", "Plant B"],
  "sections": [
    {
      "title": 29,
      "id": "1910.1200",
      "heading": "Hazard Communication",
      "pinned_at": "2026-11-16T00:16:00Z",
      "note": "Verify Appendix A health hazard criteria updates."
    },
    {
      "title": 29,
      "id": "1910.134",
      "heading": "Respiratory Protection",
      "pinned_at": "2026-11-16T00:17:00Z",
      "note": "Review fit test frequency in paragraph (f)."
    }
  ]
}
```

### 2.2 CRUD Operations Helper (`reader/static/app.js`)
```javascript
const PROJECTS_STORE_KEY = 'framework_projects_v1';

function loadProjects() {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_STORE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveProjects(projects) {
  try {
    localStorage.setItem(PROJECTS_STORE_KEY, JSON.stringify(projects));
  } catch (e) {}
}

function createProject({ name, description, tags = [] }) {
  const projects = loadProjects();
  const newProject = {
    id: `proj_${Date.now().toString(36)}`,
    name,
    description,
    tags,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sections: []
  };
  projects.unshift(newProject);
  saveProjects(projects);
  return newProject;
}
```

## 3. Acceptance Criteria
- [ ] Projects store reliably offline without server dependencies.
- [ ] Schema allows unlimited pinned sections with individual notes.
