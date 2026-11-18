"""Unit & API tests for Phase 5/6 References Hub, Cited-By reverse graph, and IBR resolver."""
from __future__ import annotations

import copy
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import fake_titles
from app import config, store
from app.citations import graph
from app.main import app
from tests.base import HermeticTestCase

IBR_AUGMENTED_XML = fake_titles.XML[29].replace(
    '<DIV6 N="Subpart H" TYPE="SUBPART">',
    '<DIV6 N="Subpart A" TYPE="SUBPART"><HEAD>Subpart A—General</HEAD>'
    + fake_titles._section(
        "1910.6",
        "Incorporation by reference.",
        "<P>(e) <I>ANSI.</I> (73) American National Standards Institute (ANSI) Z89.1-2009, "
        "Industrial Head Protection; IBR approved for § 1910.135. "
        "Web site: www.safetyequipment.org. Legacy portal: https://www.wdol.gov/sca.aspx.</P>",
    )
    + "</DIV6>"
    + '<DIV6 N="Subpart H" TYPE="SUBPART">',
)

IBR_AUGMENTED_STRUCT = copy.deepcopy(fake_titles.STRUCTURE[29])
IBR_AUGMENTED_STRUCT["children"][0]["children"][0]["children"][0]["children"].insert(
    0,
    {
        "type": "subpart",
        "identifier": "A",
        "label": "Subpart A",
        "label_description": "General",
        "children": [fake_titles._sec("1910.6", "Incorporation by reference.")],
    },
)


class GraphAndReferencesTests(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.fake = fake_titles.FakeTitles(titles=(29, 40))
        with mock.patch.dict(fake_titles.XML, {29: IBR_AUGMENTED_XML}), \
             mock.patch.dict(fake_titles.STRUCTURE, {29: IBR_AUGMENTED_STRUCT}):
            cls.fake.install()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.fake.remove()
        store.reset_connections()
        super().tearDownClass()

    def test_references_endpoint_categorizes_and_flags_legacy(self):
        res = self.client.get("/api/29/references")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["title"], 29)
        self.assertGreaterEqual(data["total"], 2)
        by_host = {item["host"]: item for item in data["items"]}
        self.assertIn("safetyequipment.org", by_host)
        self.assertEqual(by_host["safetyequipment.org"]["category"], "standards")
        self.assertIn("wdol.gov", by_host)
        self.assertEqual(by_host["wdol.gov"]["category"], "portals")
        self.assertIsNotNone(by_host["wdol.gov"]["legacy"])
        self.assertIn("sam.gov", by_host["wdol.gov"]["legacy"]["replacement_url"])
        self.assertEqual(by_host["wdol.gov"]["cited_in"][0]["id"], "1910.6")

        # Enriched broadsheet metadata: host rollups, IBR catalog, most-cited hubs
        self.assertGreaterEqual(data["host_total"], 2)
        hosts = {h["host"]: h for h in data["hosts"]}
        self.assertIn("safetyequipment.org", hosts)
        self.assertIn("wdol.gov", hosts)
        self.assertGreaterEqual(data["ibr_total"], 1)
        self.assertTrue(any("Z89.1" in s["code"] for s in data["ibr_standards"]))
        self.assertGreaterEqual(data["most_cited_total"], 1)
        self.assertTrue(any(s["id"] == "1910.134" for s in data["most_cited"]))

    def test_cited_by_and_ibr_resolution(self):
        # 1910.134 is cited by 1910.120 in fake_titles.XML
        res_134 = self.client.get("/api/29/citations/1910.134")
        self.assertEqual(res_134.status_code, 200)
        g_134 = res_134.json()
        self.assertGreaterEqual(g_134["cited_by_count"], 1)
        self.assertTrue(any(c["id"] == "1910.120" for c in g_134["cited_by"]))

        # 1910.135 cites ANSI Z89.1 -> loosely resolves to ANSI Z89.1-2009 in § 1910.6(e)(73)
        res_135 = self.client.get("/api/29/citations/1910.135")
        self.assertEqual(res_135.status_code, 200)
        g_135 = res_135.json()
        self.assertTrue(len(g_135["ibr"]) >= 1)
        ansi = next((x for x in g_135["ibr"] if "Z89.1" in x["code"]), None)
        self.assertIsNotNone(ansi)
        self.assertEqual(ansi["org"], "ANSI")
        self.assertIsNotNone(ansi["approved_in"])
        self.assertEqual(ansi["approved_in"]["section_id"], "1910.6")
        self.assertEqual(ansi["approved_in"]["para"], "(e)(73)")

        res_404 = self.client.get("/api/29/citations/9999.99")
        self.assertEqual(res_404.status_code, 404)

    def test_plural_ibr_title_and_precomputed_table(self):
        self.assertTrue(graph._is_ibr_catalog_section("Incorporations by reference.", "60.17"))
        self.assertTrue(graph._is_ibr_catalog_section("Reference material.", "171.7"))
        with store.read_db(29) as con:
            row = con.execute("SELECT payload FROM title_graph WHERE key = 'index'").fetchone()
        self.assertIsNotNone(row)


if __name__ == "__main__":
    unittest.main()
