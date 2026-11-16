# Stage 4 · Phase 3 · Part 1: Backend Suite & Queue Unit Tests

## 1. Objectives
Add automated unit tests in `reader/tests/test_library_suites.py` to ensure suite registration, catalog enrichment, batch download queuing, and update-all endpoints function reliably with zero network access.

## 2. Technical Specification

### 2.1 Test Suite (`reader/tests/test_library_suites.py`)
```python
import unittest
from unittest import mock
from fastapi.testclient import TestClient

from app import library
from app.main import app

FAKE_TITLES = [
    {"number": 29, "name": "Labor", "up_to_date_as_of": "2026-11-15", "latest_amended_on": "2026-11-10", "reserved": False},
    {"number": 40, "name": "Environment", "up_to_date_as_of": "2026-11-15", "latest_amended_on": "2026-11-12", "reserved": False},
    {"number": 49, "name": "Transportation", "up_to_date_as_of": "2026-11-15", "latest_amended_on": "2026-11-14", "reserved": False},
]

class ComplianceSuiteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @mock.patch.object(library, "ecfr_titles", return_value=FAKE_TITLES)
    def test_library_catalog_includes_suites(self, _mock_titles):
        res = self.client.get("/api/library")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("suites", data)
        self.assertIn("ehs", data["suites"])
        self.assertEqual(data["suites"]["ehs"]["titles"], [29, 40, 49])

    @mock.patch.object(library, "ecfr_titles", return_value=FAKE_TITLES)
    @mock.patch.object(library, "installed", return_value=None)
    def test_batch_download_suite(self, _mock_inst, _mock_titles):
        res = self.client.post("/api/library/batch-download", json={"suite": "ehs"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["count"], 3)
```

## 3. Acceptance Criteria
- [ ] Tests execute offline in sub-second time.
- [ ] Pytest discovers and runs all suite tests alongside the existing 70 tests.
