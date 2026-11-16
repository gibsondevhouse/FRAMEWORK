# Stage 4 · Phase 2 · Part 1: Automated Rail & Sidebar Integration Tests

## 1. Objectives
Implement test coverage to verify that DOM elements, hash routing, and drawer state transitions function without regressions.

## 2. Technical Specification

### 2.1 Python Test Suite (`reader/tests/test_sidebar_rail.py`)
```python
import unittest
from pathlib import Path

class SidebarRailDOMTests(unittest.TestCase):
    def setUp(self):
        self.html = (Path(__file__).parent.parent / "static" / "index.html").read_text(encoding="utf-8")
        self.css = (Path(__file__).parent.parent / "static" / "styles.css").read_text(encoding="utf-8")
        self.js = (Path(__file__).parent.parent / "static" / "app.js").read_text(encoding="utf-8")

    def test_rail_and_drawer_containers_exist(self):
        self.assertIn('id="activity-rail"', self.html)
        self.assertIn('id="sliding-drawer"', self.html)
        self.assertIn('id="drawer-body"', self.html)

    def test_rail_targets_include_all_required_verticals(self):
        for target in ["overview", "home", "reader", "projects", "download", "settings"]:
            self.assertIn(f'data-target="{target}"', self.html)

    def test_css_variables_and_transitions_defined(self):
        self.assertIn('--rail-w: 48px;', self.css)
        self.assertIn('.sliding-drawer', self.css)
        self.assertIn('.activity-rail', self.css)
```

## 3. Acceptance Criteria
- [ ] Tests run instantly offline via `pytest tests -q`.
- [ ] Validates all 6 target attributes and DOM containers.
