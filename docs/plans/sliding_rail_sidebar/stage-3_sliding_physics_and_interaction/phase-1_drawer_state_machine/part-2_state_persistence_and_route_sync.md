# Stage 3 · Phase 1 · Part 2: State Persistence & Route Synchronization

## 1. Objectives
Persist rail and drawer states across browser reloads and sync drawer targets with active hash routes.

## 2. Technical Specification

### 2.1 State Object & LocalStorage Schema
```javascript
const RAIL_STATE_KEY = 'framework_rail_state';

const defaultRailState = {
  activeTarget: 'reader',
  isCollapsed: false,
  isPinned: true,
  drawerWidth: 288
};

function loadRailState() {
  try {
    const raw = localStorage.getItem(RAIL_STATE_KEY);
    return raw ? { ...defaultRailState, ...JSON.parse(raw) } : defaultRailState;
  } catch (e) {
    return defaultRailState;
  }
}

function saveRailState(state) {
  try {
    localStorage.setItem(RAIL_STATE_KEY, JSON.stringify(state));
  } catch (e) {}
}
```

### 2.2 Route Synchronization
When a user navigates directly via URL hash or link:
- `#/section/{id}` or `#/part/{id}` ➔ Activates `reader` rail.
- `#/library` ➔ Activates `download` rail.
- `#/projects` ➔ Activates `projects` rail.
- `#/settings` ➔ Activates `settings` rail.
- `#/` ➔ Activates `overview` rail and retracts drawer.

## 3. Acceptance Criteria
- [ ] Direct page refresh restores exact drawer width and collapsed state.
- [ ] Route transitions automatically light the corresponding rail icon.
