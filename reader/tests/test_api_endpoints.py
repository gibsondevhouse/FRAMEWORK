"""Test FastAPI HTTP endpoints."""
import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestApiEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_list_titles(self):
        res = self.client.get("/api/titles")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        titles = [t["title"] for t in data]
        self.assertIn(29, titles)
        self.assertIn(40, titles)
        self.assertIn(49, titles)

    def test_title_meta(self):
        res = self.client.get("/api/29/meta")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["title"], 29)

    def test_legacy_meta_compatibility(self):
        res = self.client.get("/api/meta")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["title"], 29)

    def test_title_section(self):
        res = self.client.get("/api/40/section/261.3")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["id"], "261.3")
        self.assertEqual(res.json()["title"], 40)

    def test_long_section_units(self):
        whole = self.client.get("/api/29/section/1910.1200").json()
        self.assertEqual(whole["mode"], "units")
        self.assertIsNone(whole["unit"])
        keys = [u["key"] for u in whole["outline"]]
        self.assertEqual(keys[:3], ["a", "b", "c"])
        self.assertIn("i", keys)  # (i) Trade secrets is a clause, not a roman numeral

        first = self.client.get("/api/29/section/1910.1200", params={"unit": ""}).json()
        self.assertEqual(first["unit"], "a")
        self.assertIsNone(first["unit_prev"])
        self.assertEqual(first["unit_next"]["key"], "b")
        self.assertLess(len(first["html"]), len(whole["html"]) // 20)

        chapter = self.client.get("/api/29/section/1910.1200", params={"unit": "appendix-a-a-1"}).json()
        self.assertEqual(chapter["unit"], "appendix-a-a-1")
        self.assertIn("img.federalregister.gov", chapter["html"])

    def test_short_section_ignores_unit(self):
        sec = self.client.get("/api/29/section/1910.135", params={"unit": "b"}).json()
        self.assertEqual(sec["mode"], "page")
        self.assertIsNone(sec["unit"])

    def test_global_search(self):
        res = self.client.get("/api/search?q=waste&title=all&limit=5")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreater(data["total"], 0)
        self.assertTrue(len(data["results"]) > 0)

    def test_uninstalled_title_404(self):
        res = self.client.get("/api/35/meta")
        self.assertEqual(res.status_code, 404)

    def test_out_of_range_title_422(self):
        res = self.client.get("/api/99/meta")
        self.assertEqual(res.status_code, 422)


if __name__ == "__main__":
    unittest.main()

