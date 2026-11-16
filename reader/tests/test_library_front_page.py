"""The Library front page: editorial summaries/desks and the catalog fields the frontend reads.

No network and nothing from reader/data: eCFR's title list and install state are patched.
"""
import unittest
from unittest import mock

from app import library

FAKE_ECFR = [
    {"number": 29, "name": "Labor", "latest_amended_on": "2026-11-10", "up_to_date_as_of": "2026-11-12", "reserved": False},
    {"number": 35, "name": "Reserved", "latest_amended_on": None, "up_to_date_as_of": None, "reserved": True},
    {"number": 99, "name": "Brand New Title", "up_to_date_as_of": "2026-11-12", "reserved": False},
]


class BlurbContentTests(unittest.TestCase):
    def setUp(self):
        self.blurbs = library._BLURBS

    def test_every_title_has_a_summary_and_a_known_desk(self):
        titles = self.blurbs["titles"]
        self.assertEqual(sorted(titles, key=int), [str(n) for n in range(1, 51)])
        for n, b in titles.items():
            with self.subTest(title=n):
                self.assertTrue(b["summary"].strip())
                self.assertLessEqual(len(b["summary"]), 140)
                self.assertIn(b["desk"], library.DESKS)

    def test_every_desk_is_used(self):
        used = {b["desk"] for b in self.blurbs["titles"].values()}
        self.assertEqual(used, set(library.DESKS))

    def test_featured_titles_lead_the_page(self):
        featured = sorted(int(n) for n, b in self.blurbs["titles"].items() if b.get("featured"))
        self.assertEqual(featured, [29, 40, 49])


class CatalogTests(unittest.TestCase):
    def rows(self):
        with mock.patch.object(library, "ecfr_titles", lambda refresh=False: FAKE_ECFR), \
                mock.patch.object(library, "installed", lambda n: None):
            return {r["title"]: r for r in library.catalog()}

    def test_catalog_carries_editorial_fields(self):
        r = self.rows()[29]
        self.assertEqual(r["desk"], "Workplace & Labor")
        self.assertTrue(r["featured"])
        self.assertIn("OSHA", r["summary"])
        self.assertEqual(r["amended"], "2026-11-10")
        self.assertEqual(r["latest"], "2026-11-12")
        self.assertIsNone(r["installed"])

    def test_title_without_editorial_entry_still_lists(self):
        r = self.rows()[99]
        self.assertEqual(r["summary"], "")
        self.assertEqual(r["desk"], library.OTHER_DESK)
        self.assertFalse(r["featured"])
        self.assertIsNone(r["amended"])

    def test_reserved_title_is_flagged(self):
        self.assertTrue(self.rows()[35]["reserved"])


if __name__ == "__main__":
    unittest.main()
