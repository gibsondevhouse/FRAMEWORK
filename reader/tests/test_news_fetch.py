"""Fetchers and the worker's sync plumbing over httpx.MockTransport. The base class
patches the real HTTP transport to raise, so nothing here can reach the network, and no
test starts the worker thread (request_sync only reads state and sets the wake event)."""
import tempfile
import threading
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from app import config, news, news_store, news_worker
from tests.news_fixtures import (DOL_VIOLATIONS, FR_DOCS_JSON, FakeAPI,
                                 NetworkGuardTestCase, PI_JSON)

AGENCY = "occupational-safety-and-health-administration"
FR_PATH = "/api/v1/documents.json"
PI_PATH = "/api/v1/public-inspection-documents.json"
VIOL_PATH = "/v4/get/OSHA/violation/json"
INSP_PATH = "/v4/get/OSHA/inspection/json"


class FetchTestCase(NetworkGuardTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="news-fetch-"))
        p = mock.patch.object(config, "DATA_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(news_worker._wake.clear)
        self.addCleanup(news_worker._forced.clear)

    def client_for(self, fake):
        return fake.patch_client()


class FederalRegisterFetchTests(FetchTestCase):
    def test_request_shape(self):
        fake = FakeAPI()
        with fake.patch_client(), news.client() as c:
            items = news.fetch_federal_register_documents(c, AGENCY, since="2025-11-16")
        req = fake.requests_for(FR_PATH)[0]
        self.assertEqual(req.headers["User-Agent"], "FRAMEWORK-ComplianceReader/1.0 (local-reader)")
        params = req.url.params
        fields = params.get_list("fields[]")
        for f in ("cfr_references", "action", "effective_on", "comments_close_on", "citation"):
            self.assertIn(f, fields)
        self.assertEqual(params.get("conditions[publication_date][gte]"), "2025-11-16")
        self.assertEqual(params.get("conditions[agencies][]"), AGENCY)
        self.assertEqual(len(items), 3)
        for item in items:
            self.assertEqual(item["source"], "federal_register")

    def test_follows_next_page_url(self):
        page1 = {"results": [dict(FR_DOCS_JSON["results"][0])],
                 "next_page_url": "https://www.federalregister.gov/api/v1/documents.json?page=2"}
        page2 = {"results": [dict(FR_DOCS_JSON["results"][1])], "next_page_url": None}
        fake = FakeAPI(fr_pages=[page1, page2])
        with fake.patch_client(), news.client() as c:
            items = news.fetch_federal_register_documents(c, AGENCY, since="2026-01-01")
        self.assertEqual(len(fake.requests_for(FR_PATH)), 2)
        self.assertEqual(len(items), 2)

    def test_page_chain_caps_at_ten(self):
        endless = {"results": [dict(FR_DOCS_JSON["results"][0])],
                   "next_page_url": "https://www.federalregister.gov/api/v1/documents.json?page=next"}
        fake = FakeAPI(fr_pages=[endless] * 20)
        with fake.patch_client(), news.client() as c:
            news.fetch_federal_register_documents(c, AGENCY, since="2026-01-01")
        self.assertEqual(len(fake.requests_for(FR_PATH)), 10)

    def test_errors_raise_source_unavailable(self):
        for kw in ({"fail_paths": (FR_PATH,)}, {"timeout_paths": (FR_PATH,)},
                   {"malformed_paths": (FR_PATH,)}):
            fake = FakeAPI(**kw)
            with self.subTest(kw=kw), fake.patch_client(), news.client() as c:
                with self.assertRaises(news.SourceUnavailable):
                    news.fetch_federal_register_documents(c, AGENCY, since="2026-01-01")


class DolFetchTests(FetchTestCase):
    def test_two_requests_key_in_header_and_in_filter(self):
        fake = FakeAPI()
        with fake.patch_client(), news.client() as c:
            items = news.fetch_enforcement(c, "secret-key", days=30, limit=1000, max_inspections=50)
        dol_reqs = fake.requests_for("/v4/")
        self.assertEqual(len(dol_reqs), 2)                        # one violations, one inspections
        for req in dol_reqs:
            self.assertEqual(req.headers["X-API-KEY"], "secret-key")
            self.assertNotIn("secret-key", str(req.url))
        viol = fake.requests_for(VIOL_PATH)[0]
        self.assertEqual(viol.url.params.get("limit"), "1000")
        self.assertIn('"operator": "gt"', viol.url.params.get("filter_object"))
        insp = fake.requests_for(INSP_PATH)[0]
        self.assertIn('"operator": "in"', insp.url.params.get("filter_object"))
        self.assertEqual({i["guid"] for i in items}, {"dol-insp:306953084", "dol-insp:307000001"})

    def test_window_arguments_are_used(self):
        fake = FakeAPI()
        with fake.patch_client(), news.client() as c:
            news.fetch_enforcement(c, "k", days=90, limit=5000, max_inspections=1)
        viol = fake.requests_for(VIOL_PATH)[0]
        self.assertEqual(viol.url.params.get("limit"), "5000")
        insp = fake.requests_for(INSP_PATH)[0]
        filt = insp.url.params.get("filter_object")
        self.assertIn("306953084", filt)                          # newest inspection kept
        self.assertNotIn("307000001", filt)                       # capped out

    def test_no_inspection_request_without_violations(self):
        fake = FakeAPI(violations=[])
        with fake.patch_client(), news.client() as c:
            items = news.fetch_enforcement(c, "k", days=30, limit=1000, max_inspections=50)
        self.assertEqual(items, [])
        self.assertEqual(fake.requests_for(INSP_PATH), [])

    def test_errors_raise_source_unavailable(self):
        fake = FakeAPI(fail_paths=(VIOL_PATH,))
        with fake.patch_client(), news.client() as c:
            with self.assertRaises(news.SourceUnavailable):
                news.fetch_enforcement(c, "k", days=30, limit=1000, max_inspections=50)


class WorkerSyncTests(FetchTestCase):
    def test_pi_only_sync_touches_only_pi(self):
        fake = FakeAPI()
        with fake.patch_client():
            results = news_worker.sync_sources(["federal_register_pi"])
        self.assertEqual([r.url.path for r in fake.requests], [PI_PATH])
        self.assertEqual(results, {"federal_register_pi": 2})
        rows = news_store.sync_rows()
        self.assertEqual(rows["federal_register_pi"]["last_count"], 2)

    def test_failing_source_never_blocks_others(self):
        fake = FakeAPI(fail_paths=(FR_PATH,))
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "k"}), fake.patch_client():
            results = news_worker.sync_sources(
                ["federal_register", "federal_register_pi", "dol_osha"])
        self.assertEqual(results["federal_register_pi"], 2)
        self.assertEqual(results["dol_osha"], 2)
        self.assertIsInstance(results["federal_register"], str)
        rows = news_store.sync_rows()
        self.assertEqual(rows["federal_register"]["fail_count"], 1)
        self.assertIsNone(rows["federal_register"]["last_ok_at"])
        self.assertEqual(rows["dol_osha"]["fail_count"], 0)
        with closing(news_store.connect()) as con:
            counts = news_store.category_counts(con)
        self.assertEqual(counts["enforcement"], 2)
        self.assertEqual(counts["public_inspection"], 2)

    def test_without_key_no_dol_requests_and_not_enabled(self):
        self.assertEqual(news_worker.enabled_sources(),
                         ["federal_register", "federal_register_pi"])
        fake = FakeAPI()
        with fake.patch_client():
            news_worker.sync_sources(news_worker.enabled_sources())
        self.assertEqual(fake.requests_for("/v4/"), [])

    def test_due_sources_respects_staleness_backoff_and_key(self):
        now = datetime(2026, 11, 16, 17, 0, tzinfo=timezone.utc)   # Monday noon ET
        with closing(news_store.connect()) as con:
            news_store.record_ok(con, "federal_register", 3, now - timedelta(minutes=10))
            news_store.record_error(con, "federal_register_pi", "down", now - timedelta(minutes=1))
            con.commit()
        self.assertEqual(news_worker.due_sources(now), [])         # FR fresh, PI backing off
        self.assertEqual(news_worker.due_sources(now + timedelta(minutes=10)),
                         ["federal_register_pi"])                  # backoff over, still stale
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "k"}):
            self.assertIn("dol_osha", news_worker.due_sources(now))  # never synced -> due

    def test_request_sync_force_semantics(self):
        now = datetime.now(timezone.utc)
        with closing(news_store.connect()) as con:
            news_store.record_ok(con, "federal_register", 3, now)
            news_store.record_ok(con, "federal_register_pi", 2, now)
            con.commit()
        self.assertEqual(news_worker.request_sync(force=False), [])
        self.assertFalse(news_worker._wake.is_set())
        queued = news_worker.request_sync(force=True)
        self.assertEqual(queued, ["federal_register", "federal_register_pi"])
        self.assertTrue(news_worker._wake.is_set())

    def test_request_sync_force_bypasses_backoff(self):
        now = datetime.now(timezone.utc)
        with closing(news_store.connect()) as con:
            news_store.record_error(con, "federal_register", "down", now)
            news_store.record_ok(con, "federal_register_pi", 2, now)
            con.commit()
        self.assertEqual(news_worker.request_sync(force=False), [])   # backoff + fresh
        self.assertEqual(news_worker.request_sync(force=True),
                         ["federal_register", "federal_register_pi"])

    def test_no_worker_thread_in_tests(self):
        self.assertNotIn("news-worker", [t.name for t in threading.enumerate()])


if __name__ == "__main__":
    unittest.main()
