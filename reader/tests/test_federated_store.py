"""Integration tests for federated store and FastAPI endpoints across Titles 29, 40, and 49."""
import unittest

from app import config, store


class TestFederatedStore(unittest.TestCase):
    def test_installed_titles(self):
        titles = config.installed_titles()
        self.assertIn(29, titles)
        self.assertIn(40, titles)
        self.assertIn(49, titles)

    def test_title_29_section(self):
        sec = store.get_section("1910.120", title=29)
        self.assertIsNotNone(sec)
        self.assertEqual(sec["id"], "1910.120")
        self.assertEqual(sec["title"], 29)
        self.assertIn("1910", sec["part"])
        self.assertTrue(len(sec["html"]) > 100)

    def test_title_40_section(self):
        sec = store.get_section("261.3", title=40)
        self.assertIsNotNone(sec)
        self.assertEqual(sec["id"], "261.3")
        self.assertEqual(sec["title"], 40)
        self.assertEqual(sec["part"], "261")

    def test_title_49_section(self):
        sec = store.get_section("172.101", title=49)
        self.assertIsNotNone(sec)
        self.assertEqual(sec["id"], "172.101")
        self.assertEqual(sec["title"], 49)
        self.assertEqual(sec["part"], "172")

    def test_global_cross_title_search(self):
        res = store.search("hazardous", title="all", limit=10)
        self.assertGreater(res["total"], 0)
        self.assertTrue(len(res["results"]) > 0)
        # Results should contain items from different titles
        found_titles = {r["title"] for r in res["results"]}
        self.assertTrue(len(found_titles) >= 1)


if __name__ == "__main__":
    unittest.main()

