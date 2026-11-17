"""The HTTP API over fake Titles 29, 40 and 49 (see fake_titles.py): title discovery, legacy
Title 29 aliases, sections and reading units, parts, search and the guards on bad titles."""
import unittest

from fastapi.testclient import TestClient

from app.main import app
from fake_titles import FakeTitles
from tests.base import HermeticTestCase


class TestApiEndpoints(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeTitles()
        cls.fake.install()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.fake.remove()

    def test_list_titles(self):
        res = self.client.get("/api/titles")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual([t["title"] for t in data], [29, 40, 49])
        self.assertEqual(data[1]["name"], "Protection of Environment")
        self.assertEqual(data[1]["section_count"], 2)
        self.assertFalse(data[1]["partial"])

    def test_title_meta(self):
        res = self.client.get("/api/29/meta")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["title"], 29)
        self.assertEqual(res.json()["edition"], "2026-01-02")

    def test_legacy_aliases_are_title_29(self):
        self.assertEqual(self.client.get("/api/meta").json()["title"], 29)
        self.assertEqual(self.client.get("/api/section/1910.135").json()["title"], 29)
        self.assertEqual(self.client.get("/api/tree").json()["id"], "29")

    def test_tree(self):
        tree = self.client.get("/api/40/tree").json()
        self.assertEqual(tree["id"], "40")
        part = tree["c"][0]["c"][0]
        self.assertEqual(part["id"], "261")
        self.assertEqual([s["id"] for s in part["c"]], ["261.2", "261.3"])

    def test_title_section(self):
        res = self.client.get("/api/40/section/261.3")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["id"], "261.3")
        self.assertEqual(body["title"], 40)
        self.assertEqual(body["title_label"], "Definition of hazardous waste.")
        self.assertEqual(body["ecfr_url"], "https://www.ecfr.gov/current/title-40/section-261.3")
        self.assertEqual(body["html"].count("<a "), 1)   # "40 CFR part 262" is one link, not nested
        # Without eCFR path metadata the link falls back to the part.
        other = self.client.get("/api/29/section/1910.135").json()
        self.assertEqual(other["ecfr_url"], "https://www.ecfr.gov/current/title-29/part-1910")
        self.assertEqual(self.client.get("/api/40/section/1910.120").status_code, 404)

    def test_long_section_units(self):
        whole = self.client.get("/api/29/section/1910.1200").json()
        self.assertEqual(whole["mode"], "units")
        self.assertIsNone(whole["unit"])
        keys = [u["key"] for u in whole["outline"]]
        self.assertEqual(keys[:3], ["a", "b", "c"])
        self.assertIn("i", keys)  # (i) Trade secrets is a clause, not a roman numeral
        self.assertEqual(keys[-4:], ["appendix-a-a-1", "appendix-a-a-2", "appendix-a-a-3", "appendix-a-a-4"])

        first = self.client.get("/api/29/section/1910.1200", params={"unit": ""}).json()
        self.assertEqual(first["unit"], "a")
        self.assertIsNone(first["unit_prev"])
        self.assertEqual(first["unit_next"]["key"], "b")
        self.assertLess(len(first["html"]), len(whole["html"]) // 10)

        chapter = self.client.get("/api/29/section/1910.1200", params={"unit": "appendix-a-a-1"}).json()
        self.assertEqual(chapter["unit"], "appendix-a-a-1")
        self.assertEqual(chapter["unit_prev"]["key"], "j")
        self.assertEqual(chapter["outline"][-1]["group_label"], "Appendix A")
        self.assertIn("img.federalregister.gov", chapter["html"])

        group = self.client.get("/api/29/section/1910.1200", params={"unit": "appendix-a"}).json()
        self.assertEqual(group["unit"], "appendix-a-a-1")   # a group key opens its first chapter

    def test_short_section_ignores_unit(self):
        sec = self.client.get("/api/29/section/1910.135", params={"unit": "b"}).json()
        self.assertEqual(sec["mode"], "page")
        self.assertIsNone(sec["unit"])
        self.assertIn("protective helmet", sec["html"])

    def test_part_front_matter_and_full(self):
        front = self.client.get("/api/29/part/1910").json()
        self.assertIn("29 U.S.C. 653", front["part"])
        full = self.client.get("/api/29/part/1910/full").json()
        self.assertEqual(full["title"], 29)
        self.assertEqual([s["id"] for s in full["sections"]], ["1910.120", "1910.134", "1910.135", "1910.1200"])
        self.assertEqual(self.client.get("/api/29/part/9999/full").status_code, 404)

    def test_search_in_title(self):
        res = self.client.get("/api/49/search", params={"q": "hazardous"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual([r["id"] for r in res.json()["results"]], ["172.101"])

    def test_global_search(self):
        res = self.client.get("/api/search", params={"q": "waste", "title": "all", "limit": 5})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["title"], "all")
        self.assertEqual({r["title"] for r in data["results"]}, {29, 40})
        # Unprefixed search without `title` is Title 29.
        only29 = self.client.get("/api/search", params={"q": "waste"}).json()
        self.assertEqual({r["title"] for r in only29["results"]}, {29})

    def test_uninstalled_title_404(self):
        self.assertEqual(self.client.get("/api/35/meta").status_code, 404)
        self.assertEqual(self.client.get("/api/21/section/1.1").status_code, 404)

    def test_out_of_range_title_422(self):
        self.assertEqual(self.client.get("/api/99/meta").status_code, 422)

    def test_fixed_prefix_routes_precede_title_router(self):
        """If a fixed-prefix router were mounted after /api/{title}, these would all
        be captured as a (non-integer) title and 422."""
        for url in ("/api/settings/env", "/api/library/jobs", "/api/library/storage", "/api/news/status"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_chat_without_key_is_400(self):
        from unittest import mock
        from app import config
        with mock.patch.object(config, "anthropic_key", lambda: None):
            res = self.client.post("/api/29/chat", json={"messages": [{"role": "user", "content": "hi"}], "model": "x"})
        self.assertEqual(res.status_code, 400)
        models = self.client.get("/api/29/models").json() if not config.anthropic_key() else None
        if models is not None:
            self.assertEqual(models, {"configured": False, "models": [], "default": None})

    def test_titles_snapshot_and_fault_isolation(self):
        from unittest import mock
        import sqlite3
        from app import store

        res = self.client.get("/api/titles/snapshot")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("cache-control"), "no-store")
        body = res.json()
        self.assertEqual([t["title"] for t in body["titles"]], [29, 40, 49])
        self.assertIn("OSHA", body["titles"][0]["agencies"])
        self.assertTrue(body["titles"][0]["summary"])
        self.assertIsNone(body["titles"][0]["scope_parts"])

        orig_meta = store.meta

        def flaky_meta(t):
            if t == 40:
                raise sqlite3.OperationalError("database disk image is malformed")
            return orig_meta(t)

        with mock.patch.object(store, "meta", flaky_meta):
            r_list = self.client.get("/api/titles")
            r_snap = self.client.get("/api/titles/snapshot")
        self.assertEqual(r_list.status_code, 200)
        self.assertEqual([x["title"] for x in r_list.json()], [29, 40, 49])
        self.assertEqual(r_snap.status_code, 200)
        by_t = {x["title"]: x for x in r_snap.json()["titles"]}
        self.assertFalse(by_t[29]["unreadable"])
        self.assertTrue(by_t[40]["unreadable"])

    def test_titles_snapshot_partial_scope_parts(self):
        from unittest import mock
        import json
        from app import store

        orig_safe = store.safe_meta

        def partial_safe(t):
            m, bad = orig_safe(t)
            if t == 29:
                m = {**m, "scope": json.dumps({"parts": ["1910"], "sections": [{"t": "section", "id": "1926.501", "part": "1926"}]})}
            return m, bad

        with mock.patch.object(store, "safe_meta", partial_safe):
            snap = self.client.get("/api/titles/snapshot").json()
        t29 = next(x for x in snap["titles"] if x["title"] == 29)
        self.assertTrue(t29["partial"])
        self.assertEqual(t29["scope_parts"], ["1910", "1926"])
        self.assertEqual(t29["scope_sections_count"], 1)


if __name__ == "__main__":
    unittest.main()
