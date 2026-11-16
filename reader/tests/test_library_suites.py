"""Compliance suites, batch downloads, "update all", job cancellation and the amendment wire.

No network and nothing from reader/data: eCFR's title list, install state and the version
history are patched, and every queue here is a fresh `library.Queue` whose jobs are faked.
"""
import threading
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app import build, config, library
from app.main import app

FAKE_ECFR = [
    {"number": 12, "name": "Banks and Banking", "up_to_date_as_of": "2026-11-12", "latest_amended_on": "2026-11-09", "reserved": False},
    {"number": 29, "name": "Labor", "up_to_date_as_of": "2026-11-12", "latest_amended_on": "2026-11-10", "reserved": False},
    {"number": 35, "name": "Reserved", "up_to_date_as_of": None, "latest_amended_on": None, "reserved": True},
    {"number": 40, "name": "Protection of Environment", "up_to_date_as_of": "2026-11-12", "latest_amended_on": "2026-11-12", "reserved": False},
    {"number": 49, "name": "Transportation", "up_to_date_as_of": "2026-11-12", "latest_amended_on": "2026-11-11", "reserved": False},
]


def inst(edition, scope=None):
    return {"edition": edition, "section_count": 10, "scope": scope}


class SuiteCatalogTests(unittest.TestCase):
    def test_suites_are_well_formed(self):
        suites = library.suites()
        self.assertEqual(suites["ehs"]["titles"], [29, 40, 49])
        self.assertTrue(suites["ehs"]["featured"])
        for sid, s in suites.items():
            with self.subTest(suite=sid):
                self.assertEqual(s["id"], sid)
                self.assertTrue(s["name"] and s["summary"] and s["titles"])
                self.assertTrue(all(1 <= t <= 50 for t in s["titles"]))
                self.assertGreater(s["size_mb"], 0)
                self.assertGreater(s["sections"], 0)

    def test_suite_totals_are_summed_from_the_titles(self):
        blurbs = library._BLURBS["titles"]
        ehs = library.suites()["ehs"]
        self.assertEqual(ehs["sections"], sum(blurbs[str(n)]["sections"] for n in (29, 40, 49)))

    def test_catalog_endpoint_returns_suites_and_enrichment(self):
        client = TestClient(app)
        with mock.patch.object(library, "ecfr_titles", lambda refresh=False: FAKE_ECFR), \
                mock.patch.object(library, "installed", lambda n: None):
            data = client.get("/api/library").json()
        self.assertEqual(data["suites"]["ehs"]["titles"], [29, 40, 49])
        row = next(t for t in data["titles"] if t["title"] == 29)
        self.assertIn("OSHA", row["agencies"])
        self.assertGreater(row["size_mb"], 1)
        self.assertGreater(row["sections"], 1000)

    def test_every_live_title_has_agencies_and_a_size(self):
        for n, b in library._BLURBS["titles"].items():
            if n == "35":
                continue
            with self.subTest(title=n):
                self.assertTrue(b["agencies"])
                self.assertTrue(all(a == a.strip() and a for a in b["agencies"]))
                self.assertGreater(b["size_mb"], 0)
                self.assertGreater(b["sections"], 0)


class BatchTests(unittest.TestCase):
    """queue_titles / update_all decide what to queue; the queue itself never runs a job."""

    def setUp(self):
        self.q = library.Queue()
        self.q._ensure_worker = lambda: None  # keep jobs pending
        self.patches = [
            mock.patch.object(library, "queue", self.q),
            mock.patch.object(library, "ecfr_titles", lambda refresh=False: FAKE_ECFR),
        ]
        for p in self.patches:
            p.start()
        self.client = TestClient(app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def kinds(self):
        return [(j["title"], j["kind"]) for j in self.q.snapshot()["queued"]]

    def test_suite_queues_every_title_not_installed(self):
        with mock.patch.object(library, "installed", lambda n: None):
            res = self.client.post("/api/library/batch-download", json={"suite": "ehs"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["count"], 3)
        self.assertEqual(self.kinds(), [(29, "title"), (40, "title"), (49, "title")])

    def test_suite_skips_current_updates_stale_and_completes_partial(self):
        state = {29: inst("2026-11-12"), 40: inst("2026-10-01"), 49: inst("2026-11-12", {"parts": ["172"], "sections": []})}
        with mock.patch.object(library, "installed", state.get):
            res = self.client.post("/api/library/batch-download", json={"suite": "ehs"}).json()
        self.assertEqual(self.kinds(), [(40, "update"), (49, "title")])
        self.assertEqual(res["skipped"], [{"title": 29, "reason": "current"}])

    def test_titles_list_skips_reserved_and_duplicates(self):
        with mock.patch.object(library, "installed", lambda n: None):
            res = self.client.post("/api/library/batch-download", json={"titles": [35, 12, 12]}).json()
        self.assertEqual(self.kinds(), [(12, "title")])
        self.assertEqual(res["skipped"], [{"title": 35, "reason": "reserved"}])

    def test_bad_requests(self):
        self.assertEqual(self.client.post("/api/library/batch-download", json={"suite": "nope"}).status_code, 404)
        self.assertEqual(self.client.post("/api/library/batch-download", json={}).status_code, 400)
        self.assertEqual(self.client.post("/api/library/batch-download", json={"titles": [51]}).status_code, 400)

    def test_update_all_queues_only_outdated_titles(self):
        state = {29: inst("2026-11-12"), 40: inst("2026-10-01"), 12: inst("2026-11-01", {"parts": ["1"], "sections": []})}
        with mock.patch.object(config, "installed_titles", lambda: [12, 29, 40]), \
                mock.patch.object(library, "installed", state.get):
            res = self.client.post("/api/library/update-all").json()
        self.assertEqual(res["count"], 2)
        self.assertEqual(self.kinds(), [(12, "update"), (40, "update")])

    def test_update_all_with_nothing_outdated(self):
        with mock.patch.object(config, "installed_titles", lambda: [29]), \
                mock.patch.object(library, "installed", lambda n: inst("2026-11-12")):
            self.assertEqual(self.client.post("/api/library/update-all").json()["count"], 0)

    def test_cancel_and_clear_queued_jobs(self):
        a = self.q.submit(29, "title", None, "Title 29")
        self.q.submit(40, "title", None, "Title 40")
        self.q.submit(49, "title", None, "Title 49")
        res = self.client.post(f"/api/library/jobs/{a['id']}/cancel")
        self.assertEqual(res.json()["state"], "cancelled")
        self.assertEqual(self.kinds(), [(40, "title"), (49, "title")])
        self.assertEqual(self.client.post("/api/library/jobs/clear").json()["count"], 2)
        snap = self.q.snapshot()
        self.assertEqual(snap["queued"], [])
        self.assertEqual([j["state"] for j in snap["recent"]], ["cancelled"] * 3)
        self.assertEqual(self.client.post(f"/api/library/jobs/{a['id']}/cancel").status_code, 404)


class RunningCancelTests(unittest.TestCase):
    """A running job stops at its next progress report, except while installing."""

    def run_queue(self, fake_run_job, cancel_at_phase):
        q = library.Queue()
        reached = threading.Event()
        release = threading.Event()

        def run_job(job, report):
            fake_run_job(report, reached, release)

        with mock.patch.object(library, "run_job", run_job), \
                mock.patch.object(library, "_remove_partial_files") as cleanup:
            job = q.submit(29, "title", None, "Title 29")
            self.assertTrue(reached.wait(2))
            self.assertEqual(q.snapshot()["current"]["phase"], cancel_at_phase)
            q.cancel(job["id"])
            release.set()
            for _ in range(200):
                if q.snapshot()["recent"]:
                    break
                threading.Event().wait(0.01)
        return q.snapshot()["recent"][0], cleanup

    def test_cancel_while_downloading(self):
        def fake(report, reached, release):
            report("Downloading text", 1, 10)
            reached.set()
            release.wait(2)
            report("Downloading text", 2, 10)  # raises JobCancelled
            raise AssertionError("should have stopped")

        job, cleanup = self.run_queue(fake, "Downloading text")
        self.assertEqual(job["state"], "cancelled")
        self.assertNotIn("cancelling", job)
        cleanup.assert_called_once_with(29)

    def test_installing_is_not_interrupted(self):
        def fake(report, reached, release):
            report("Installing")
            reached.set()
            release.wait(2)
            report("Installing")

        job, cleanup = self.run_queue(fake, "Installing")
        self.assertEqual(job["state"], "done")
        cleanup.assert_not_called()


class WireTests(unittest.TestCase):
    VERSIONS = {"content_versions": [
        {"identifier": "141.2", "name": "§ 141.2   Definitions.", "part": "141", "amendment_date": "2026-11-12", "substantive": True, "removed": False},
        {"identifier": "141.80", "name": "§ 141.80 General.", "part": "141", "amendment_date": "2026-11-12", "substantive": True, "removed": False},
        {"identifier": "147.1", "name": "§ 147.1 Purpose.", "part": "147", "amendment_date": "2026-11-12", "substantive": True, "removed": True},
        {"identifier": "136.3", "name": "§ 136.3 Test procedures.", "part": "136", "amendment_date": "2024-06-17", "substantive": False, "removed": False},
    ]}

    def setUp(self):
        library._changes.clear()

    def test_changes_counts_the_days_amendments(self):
        with mock.patch.object(build, "fetch_json", lambda c, url: self.VERSIONS):
            c = library.changes(40, "2026-11-12")
        self.assertEqual(c["count"], 3)
        self.assertEqual(c["removed"], 1)
        self.assertEqual(c["parts"], ["141", "147"])
        self.assertEqual(c["first"], {"id": "141.2", "name": "§ 141.2 Definitions."})
        self.assertEqual(c["kind"], "amended")

    def test_editorial_only_issue_counts_as_revised(self):
        editorial = {"content_versions": [v for v in self.VERSIONS["content_versions"] if not v["substantive"]]}
        with mock.patch.object(build, "fetch_json", lambda c, url: editorial):
            c = library.changes(12, "2026-11-12")
        self.assertEqual((c["count"], c["kind"], c["parts"]), (1, "revised", ["136"]))

    def test_wire_orders_newest_first_and_survives_failures(self):
        def fetch(c, url):
            if "title-49" in url:
                raise ValueError("bad JSON")
            return self.VERSIONS

        with mock.patch.object(library, "ecfr_titles", lambda refresh=False: FAKE_ECFR), \
                mock.patch.object(build, "fetch_json", fetch):
            w = library.wire(limit=3)
        self.assertEqual([e["title"] for e in w], [40, 49, 29])
        self.assertIsNone(w[1]["count"])
        self.assertEqual(w[0]["count"], 3)


if __name__ == "__main__":
    unittest.main()
