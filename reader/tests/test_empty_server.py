"""A fresh install: the server starts with no title installed, builds nothing on its own, and
reports an empty title list so the frontend can show the first-run profile picker."""
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app import build, config, store
from app.main import app
from tests.base import HermeticTestCase


class EmptyServerTests(HermeticTestCase):
    def setUp(self):
        super().setUp()
        os.environ["NEWS_SYNC"] = "0"  # keep lifespan from starting news-worker under test
        self.tmp = Path(tempfile.mkdtemp())  # an empty DATA_DIR: nothing installed
        self.patches = [
            mock.patch.object(config, "DATA_DIR", self.tmp),
            mock.patch.object(build, "build", side_effect=AssertionError("startup must not build a title")),
        ]
        for p in self.patches:
            p.start()
        store.reset_connections()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        store.reset_connections()
        shutil.rmtree(self.tmp, ignore_errors=True)
        super().tearDown()

    def test_starts_empty_without_building(self):
        with TestClient(app) as client:  # `with` runs the lifespan
            self.assertEqual(config.installed_titles(), [])
            res = client.get("/api/titles")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json(), [])
            self.assertEqual(client.get("/api/29/meta").status_code, 404)
            self.assertEqual(client.get("/api/meta").status_code, 404)
            self.assertEqual(client.get("/api/tree").status_code, 404)
            self.assertEqual(client.get("/api/models").status_code, 404)
            self.assertEqual(
                client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}], "model": "x"}).status_code,
                404,
            )
            self.assertEqual(client.get("/api/search", params={"q": "safety"}).status_code, 404)
            everywhere = client.get("/api/search", params={"q": "safety", "title": "all"}).json()
            self.assertEqual(everywhere["results"], [])
            # The picker's data needs no title and no network.
            self.assertTrue(client.get("/api/profiles").json()["profiles"])
        build.build.assert_not_called()
        self.assertEqual(list(self.tmp.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
