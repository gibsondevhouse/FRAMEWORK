# Stage 3 · Phase 2 · Part 1: Hotkeys & Global Command Bar Integration

## 1. Objectives
Implement keyboard shortcuts for power-user rail navigation (`Cmd+B`, `Cmd+1`–`5`, `Esc`) and integrate navigation targets into the global search bar (`Cmd+K`).

## 2. Technical Specification

### 2.1 Global Hotkey Listeners (`reader/static/app.js`)
```javascript
window.addEventListener('keydown', (e) => {
  const isCmd = e.metaKey || e.ctrlKey;
  
  // Cmd+B / Ctrl+B: Toggle drawer sliding
  if (isCmd && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    toggleDrawerCollapse();
    return;
  }

  // Cmd+1 through 5: Direct rail targets
  if (isCmd && !e.shiftKey && ['1', '2', '3', '4', '5'].includes(e.key)) {
    e.preventDefault();
    const map = { '1': 'overview', '2': 'home', '3': 'reader', '4': 'projects', '5': 'download' };
    switchRailTarget(map[e.key]);
    return;
  }

  // Escape: Close flyout drawer if focused inside
  if (e.key === 'Escape' && !railState.isPinned && !railState.isCollapsed) {
    toggleDrawerCollapse(true);
  }
});
```

### 2.2 Command Search Integration
Typing keywords in `⌘K` search like `> projects`, `> library`, or `> settings` surfaces quick navigation shortcuts at the top of search results.

## 3. Acceptance Criteria
- [ ] `Cmd+B` immediately triggers sliding transition.
- [ ] Number shortcuts jump between verticals without mouse dependency.
