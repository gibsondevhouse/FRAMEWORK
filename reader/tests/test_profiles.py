"""The first-run profile table (app/profiles.py) and the endpoint that serves it."""
import unittest

from fastapi.testclient import TestClient

from app import profiles
from app.main import app
from tests.base import HermeticTestCase


class ProfileTableTests(HermeticTestCase):
    def test_every_profile_is_well_formed(self):
        self.assertTrue(profiles.PROFILES)
        ids = [p["id"] for p in profiles.PROFILES]
        self.assertEqual(len(ids), len(set(ids)), "profile ids must be unique")
        for p in profiles.PROFILES:
            with self.subTest(profile=p["id"]):
                self.assertTrue(p["name"].strip())
                self.assertTrue(p["description"].strip())
                self.assertTrue(p["downloads"], "a profile downloads something")
                seen = set()
                for d in p["downloads"]:
                    self.assertEqual(set(d) - {"part"}, {"title"}, f"unexpected keys in {d}")
                    self.assertIsInstance(d["title"], int)
                    self.assertTrue(1 <= d["title"] <= 50, f"title {d['title']} is not a CFR title")
                    self.assertNotEqual(d["title"], 35, "Title 35 is reserved")
                    if "part" in d:
                        self.assertIsInstance(d["part"], str)
                        self.assertTrue(d["part"].strip())
                    key = (d["title"], d.get("part"))
                    self.assertNotIn(key, seen, f"{key} listed twice")
                    seen.add(key)
                # A whole title and one of its parts in the same profile is a contradiction.
                whole = {d["title"] for d in p["downloads"] if "part" not in d}
                for d in p["downloads"]:
                    if "part" in d:
                        self.assertNotIn(d["title"], whole)

    def test_title_names_cover_all_fifty(self):
        self.assertEqual(sorted(profiles.TITLE_NAMES), list(range(1, 51)))
        self.assertTrue(all(name.strip() for name in profiles.TITLE_NAMES.values()))

    def test_spec_profiles_present(self):
        by_id = {p["id"]: p for p in profiles.PROFILES}
        safety = by_id["safety"]["downloads"]
        self.assertIn({"title": 29}, safety)
        self.assertIn({"title": 30}, safety)
        self.assertEqual([d["part"] for d in safety if d["title"] == 49], [str(n) for n in range(171, 181)])
        self.assertEqual(by_id["food-drugs"]["downloads"], [{"title": 21}])


class ProfilesEndpointTests(HermeticTestCase):
    def test_served_from_one_place(self):
        client = TestClient(app)
        res = client.get("/api/profiles")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["profiles"], profiles.PROFILES)
        # JSON object keys are strings; the frontend indexes by title number as a string.
        self.assertEqual(body["title_names"]["29"], "Labor")


if __name__ == "__main__":
    unittest.main()
