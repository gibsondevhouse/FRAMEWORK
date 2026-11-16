"""The activity rail + sliding drawer (static markup and styles) and the storage endpoints
behind the drawer's Settings panel.

The rail's behaviour lives in app.js and is checked in a browser; these tests pin the
contract between index.html, styles.css and app.js that the behaviour relies on. Storage
tests use a temporary DATA_DIR, never reader/data.
"""
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app import config, library
from app.main import app
from tests.base import HermeticTestCase
from tests.frontend_sources import combined_css

STATIC = Path(__file__).resolve().parent.parent / "static"


class RailMarkupTests(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (STATIC / "index.html").read_text(encoding="utf-8")
        cls.css = combined_css()
        cls.js = (STATIC / "app.js").read_text(encoding="utf-8")

    def test_rail_and_drawer_containers_exist(self):
        for id_ in ("activity-rail", "sidebar", "drawer-title", "drawer-close", "drawer-mode", "tree", "tree-filter", "pin-pop"):
            with self.subTest(id=id_):
                self.assertIn(f'id="{id_}"', self.html)

    def test_rail_targets_cover_every_vertical(self):
        targets = re.findall(r'class="ar-btn"[^>]*data-target="(\w+)"', self.html)
        self.assertEqual(targets, ["overview", "home", "reader", "projects", "news", "library", "settings"])

    def test_route_targets_are_links_and_panels_are_buttons(self):
        for t in ("overview", "home", "news"):
            self.assertRegex(self.html, rf'<a class="ar-btn" data-target="{t}" href="#/')
        for t in ("reader", "projects", "library", "settings"):
            self.assertRegex(self.html, rf'<button type="button" class="ar-btn" data-target="{t}" aria-controls="sidebar" aria-expanded="false"')

    def test_nav_targets_go_keys_and_alt_digits_cover_news(self):
        self.assertIn("const NAV_TARGETS = ['overview', 'home', 'reader', 'projects', 'news', 'library', 'settings']", self.js)
        self.assertRegex(self.js, r"const GO_KEYS = \{[^}]*n: 'news'[^}]*\}")
        self.assertIn("/^Digit[1-7]$/", self.js)
        self.assertNotIn("Digit[1-6]", self.js)

    def test_every_panel_target_has_a_panel(self):
        for panel in ("reader", "projects", "library", "settings", "history"):
            with self.subTest(panel=panel):
                self.assertIn(f'data-panel="{panel}"', self.html)
                self.assertIn(f"{panel}:", self.js.split("const NAV_PANELS = {", 1)[1].split("};", 1)[0])

    def test_rail_items_have_labels_and_shortcuts(self):
        for m in re.finditer(r'<(?:a|button)[^>]*class="ar-btn"[^>]*>', self.html):
            tag = m.group(0)
            with self.subTest(tag=tag[:60]):
                self.assertIn("aria-label=", tag)
                self.assertRegex(tag, r'data-keys="G [OHCPNLS]"')

    def test_layout_tokens_and_states(self):
        self.assertIn("--rail-w: 48px", self.css)
        self.assertIn("grid-template-columns: var(--rail-w) var(--drawer-col) minmax(0, 1fr) var(--chat-col)", self.css)
        for state in ("drawer-collapsed", "drawer-retracted", "drawer-fly"):
            with self.subTest(state=state):
                self.assertIn(f"html.{state}", self.css)
                self.assertIn(state, self.js)

    def test_first_paint_script_knows_the_rail_state(self):
        self.assertIn('localStorage.getItem("railState")', self.html)
        self.assertIn("lsSet('railState'", self.js)

    def test_no_hard_coded_colours_in_rail_styles(self):
        block = self.css.split("/* ---------- Activity rail ----------", 1)[1].split("/* ---------- Drawer ----------", 1)[0]
        self.assertNotRegex(block, r"#[0-9a-fA-F]{3,6}\b")


class StorageEndpointTests(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "title-40.sqlite3").write_bytes(b"x" * 3000)
        (self.tmp / "tree-40.json").write_bytes(b"{}")
        (self.tmp / "title-49.tmp").write_bytes(b"y" * 500)
        (self.tmp / "title-49.xml.tmp.download").write_bytes(b"z" * 200)
        self.patch = mock.patch.object(config, "DATA_DIR", self.tmp)
        self.patch.start()
        self.q = library.Queue()
        self.qpatch = mock.patch.object(library, "queue", self.q)
        self.qpatch.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.qpatch.stop()
        self.patch.stop()

    def test_storage_reports_titles_and_temp_files(self):
        st = self.client.get("/api/library/storage").json()
        self.assertEqual(st["titles"], [{"title": 40, "bytes": 3002}])
        self.assertEqual((st["temp_files"], st["temp_bytes"]), (2, 700))
        self.assertEqual(st["total_bytes"], 3702)

    def test_prune_removes_only_temp_files(self):
        res = self.client.post("/api/library/storage/prune").json()
        self.assertEqual(res, {"removed": 2, "freed_bytes": 700})
        self.assertTrue((self.tmp / "title-40.sqlite3").exists())
        self.assertFalse((self.tmp / "title-49.tmp").exists())

    def test_prune_refused_while_a_download_is_queued(self):
        self.q._ensure_worker = lambda: None
        self.q.submit(49, "title", None, "Title 49")
        res = self.client.post("/api/library/storage/prune")
        self.assertEqual(res.status_code, 409)
        self.assertTrue((self.tmp / "title-49.tmp").exists())


if __name__ == "__main__":
    unittest.main()
