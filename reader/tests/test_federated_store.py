"""The federated store across several installed titles: discovery, per-title sections, ID
normalisation, cross-title citation links and merged search. Runs on fake Titles 29, 40 and 49
built into a temp directory (see fake_titles.py); nothing needs to be downloaded."""
import unittest

from app import config, store
from fake_titles import FakeTitles


class TestFederatedStore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeTitles()
        cls.fake.install()

    @classmethod
    def tearDownClass(cls):
        cls.fake.remove()

    def test_installed_titles(self):
        self.assertEqual(config.installed_titles(), [29, 40, 49])
        self.assertEqual(store.meta(40)["title_name"], "Protection of Environment")
        self.assertEqual(store.meta(29)["section_count"], "4")

    def test_section_in_each_title(self):
        for title, sid, part in ((29, "1910.120", "1910"), (40, "261.3", "261"), (49, "172.101", "172")):
            sec = store.get_section(sid, title=title)
            self.assertIsNotNone(sec, (title, sid))
            self.assertEqual(sec["id"], sid)
            self.assertEqual(sec["title"], title)
            self.assertEqual(sec["part"], part)
            self.assertIn('class="reg-body"', sec["html"])

    def test_section_id_normalisation(self):
        for raw in ("§ 261.3", "40 CFR 261.3", "261.3(a)(1)"):
            self.assertEqual(store.normalize_id(raw, 40), "261.3")
        self.assertEqual(store.get_section("29 CFR 1910.120(a)", title=29)["id"], "1910.120")

    def test_section_missing_from_a_title(self):
        self.assertIsNone(store.get_section("261.3", title=29))
        self.assertIsNone(store.get_section("1910.120", title=40))

    def test_prev_next_follow_reading_order(self):
        sec = store.get_section("1910.134", title=29)
        self.assertEqual(sec["prev"]["id"], "1910.120")
        self.assertEqual(sec["next"]["id"], "1910.135")
        self.assertIsNone(store.get_section("1910.120", title=29)["prev"])

    def test_cross_title_citations_link_when_installed(self):
        html = store.get_section("1910.120", title=29)["html"]
        self.assertIn('href="#/title/40/section/261.3"', html)
        self.assertIn('href="#/title/49/section/172.101"', html)
        self.assertIn('href="#/title/29/section/1910.134"', html)   # bare § stays in the current title

    def test_search_within_one_title(self):
        res = store.search("hazardous", title=40, limit=10)
        self.assertEqual(res["title"], 40)
        self.assertEqual([r["id"] for r in res["results"]], ["261.3"])
        hit = res["results"][0]
        self.assertEqual(hit["title"], 40)
        self.assertEqual(hit["title_label"], "Definition of hazardous waste.")
        self.assertIn("\x02", hit["snippet"])

    def test_exact_section_number_comes_first(self):
        res = store.search("1910.135", title=29)
        self.assertEqual(res["results"][0]["id"], "1910.135")
        self.assertTrue(res["results"][0]["exact"])

    def test_global_cross_title_search(self):
        res = store.search("hazardous", title="all", limit=10)
        self.assertEqual(res["title"], "all")
        self.assertEqual(res["total"], 4)
        self.assertEqual({r["title"] for r in res["results"]}, {29, 40, 49})
        ids = {(r["title"], r["id"]) for r in res["results"]}
        self.assertEqual(ids, {(29, "1910.120"), (29, "1910.1200"), (40, "261.3"), (49, "172.101")})

    def test_global_search_respects_limit(self):
        res = store.search("hazardous", title="all", limit=2)
        self.assertEqual(res["total"], 4)
        self.assertEqual(len(res["results"]), 2)

    def test_part_full_renders_every_section(self):
        secs = store.part_full("1910", title=29)
        self.assertEqual([s["id"] for s in secs], ["1910.120", "1910.134", "1910.135", "1910.1200"])
        self.assertTrue(all(s["html"] for s in secs))


if __name__ == "__main__":
    unittest.main()
