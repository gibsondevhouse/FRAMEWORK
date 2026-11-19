"""The /api/news endpoints over a seeded store. TestClient(app) without a `with` block
never runs lifespan, so the worker thread never starts here; a guard test asserts it."""
import tempfile
import threading
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app import config, news, news_store, news_worker
from app.main import app
from tests.news_fixtures import (DOL_INSPECTIONS, DOL_VIOLATIONS, FR_DOC_NOTICE,
                                 FR_DOC_PROPOSED, FR_DOC_RULE, FakeAPI,
                                 NetworkGuardTestCase, PI_DOC_ONLY)

AGENCY = "occupational-safety-and-health-administration"


def seed():
    items = [
        news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY)),
        news.enrich_item(news.fr_document_item(FR_DOC_PROPOSED, AGENCY)),
        news.enrich_item(news.fr_document_item(FR_DOC_NOTICE, AGENCY)),
        news.enrich_item(news.pi_item(PI_DOC_ONLY, AGENCY)),
    ]
    groups = news.group_violations(DOL_VIOLATIONS, 50)
    for insp in DOL_INSPECTIONS:
        items.append(news.enrich_item(
            news.build_enforcement_article(insp, groups[insp["activity_nr"]])))
    with closing(news_store.connect()) as con:
        for item in items:
            news_store.upsert_article(con, item)
        con.commit()


class ApiTestCase(NetworkGuardTestCase):
    seed_data = True

    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="news-api-"))
        p = mock.patch.object(config, "DATA_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(news_worker._wake.clear)
        self.addCleanup(news_worker._forced.clear)
        if self.seed_data:
            seed()
        self.client = TestClient(app)


class RouteOrderingTests(ApiTestCase):
    def test_news_routes_not_captured_by_title_router(self):
        self.assertEqual(self.client.get("/api/news/section/1910.1030").status_code, 200)
        self.assertEqual(self.client.get("/api/news/part/1910").status_code, 200)

    def test_news_router_registered_before_title_router(self):
        paths = []
        for r in app.routes:
            nested = getattr(getattr(r, "original_router", None), "routes", None)
            if nested is not None:            # this FastAPI wraps include_router entries
                paths += [getattr(x, "path", "") for x in nested]
            else:
                paths.append(getattr(r, "path", ""))
        self.assertLess(paths.index("/api/news/section/{section_id:path}"),
                        paths.index("/api/{title}/section/{section_id:path}"))

    def test_no_store_headers(self):
        for url in ("/api/news", "/api/news/status", "/api/news/facets"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).headers["Cache-Control"], "no-store")


class FeedTests(ApiTestCase):
    def test_categories_and_total(self):
        r = self.client.get("/api/news").json()
        self.assertEqual(r["total"], 6)
        self.assertEqual(len(r["articles"]), 6)
        for cat, n in (("rules", 1), ("rulemaking", 1), ("notices", 1),
                       ("public_inspection", 1), ("enforcement", 2)):
            with self.subTest(cat=cat):
                rr = self.client.get(f"/api/news?category={cat}").json()
                self.assertEqual(rr["total"], n)
                self.assertTrue(all(a["category"] == cat for a in rr["articles"]))

    def test_newest_first_and_json_columns_are_arrays(self):
        arts = self.client.get("/api/news").json()["articles"]
        dates = [a["published_at"] for a in arts]
        self.assertEqual(dates, sorted(dates, reverse=True))
        a = next(x for x in arts if x["guid"] == "fr:2026-17726")
        self.assertEqual(a["cfr_parts"], [{"title": 29, "part": "42"}])
        self.assertIsInstance(a["docket_ids"], list)
        self.assertIsInstance(a["takeaways"], list)
        self.assertEqual(len(a["takeaways"]), 3)

    def test_limit_offset(self):
        r = self.client.get("/api/news?limit=2&offset=2").json()
        self.assertEqual((len(r["articles"]), r["total"], r["offset"]), (2, 6, 2))

    def test_section_and_part_filters(self):
        # Exact-section citation plus the proposed rule's part-level reference to Part 1910.
        r = self.client.get("/api/news?section=1910.1030").json()
        self.assertEqual({a["guid"] for a in r["articles"]},
                         {"dol-insp:306953084", "fr:2026-20001"})
        # Part-level FR reference: § 1910.1200's part matches the proposed rule's Part 1910.
        r = self.client.get("/api/news?section=1910.1200").json()
        self.assertEqual({a["guid"] for a in r["articles"]}, {"fr:2026-20001"})
        r = self.client.get("/api/news?part=1910").json()
        self.assertEqual({a["guid"] for a in r["articles"]},
                         {"fr:2026-20001", "fr:2026-22222", "dol-insp:306953084",
                          "dol-insp:307000001"})

    def test_enforcement_facet_filters(self):
        r = self.client.get("/api/news?state=tx").json()
        self.assertEqual({a["guid"] for a in r["articles"]}, {"dol-insp:307000001"})
        r = self.client.get("/api/news?min_penalty=26000").json()
        self.assertEqual({a["guid"] for a in r["articles"]}, {"dol-insp:306953084"})
        r = self.client.get("/api/news?gravity=W").json()
        self.assertEqual({a["guid"] for a in r["articles"]}, {"dol-insp:306953084"})
        r = self.client.get("/api/news?gravity=R&state=TX").json()
        self.assertEqual({a["guid"] for a in r["articles"]}, {"dol-insp:307000001"})
        r = self.client.get("/api/news?gravity=W&state=TX").json()
        self.assertEqual(r["total"], 0)

    def test_bad_values_give_422(self):
        for url in ("/api/news?category=bogus", "/api/news?state=Texas",
                    "/api/news?gravity=X", "/api/news?limit=0", "/api/news?limit=101"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 422)


class SearchTests(ApiTestCase):
    def test_fts_search_with_snippet(self):
        r = self.client.get("/api/news?q=coordinated enforcement").json()
        self.assertEqual(r["articles"][0]["guid"], "fr:2026-17726")
        self.assertIn("\x02", r["articles"][0]["snippet"])
        self.assertIn("\x03", r["articles"][0]["snippet"])

    def test_company_search(self):
        r = self.client.get("/api/news?q=acme foundry").json()
        self.assertEqual({a["guid"] for a in r["articles"]}, {"dol-insp:307000001"})

    def test_section_number_fast_path(self):
        for q in ("1910.1030", "§ 1910.1030", "29 CFR 1910.1030(g)"):
            with self.subTest(q=q):
                r = self.client.get("/api/news", params={"q": q}).json()
                self.assertEqual({a["guid"] for a in r["articles"]},
                                 {"dol-insp:306953084", "fr:2026-20001"})

    def test_fr_citation_fast_path(self):
        r = self.client.get("/api/news", params={"q": "91 FR 55744"}).json()
        self.assertEqual({a["guid"] for a in r["articles"]}, {"fr:2026-17726"})

    def test_search_combines_with_category(self):
        r = self.client.get("/api/news?category=notices&q=coordinated enforcement").json()
        self.assertEqual(r["total"], 0)

    def test_fts_syntax_never_raises(self):
        for q in ('"unclosed', "foo*bar", "NEAR(a b)", "-lockout", "col:value", "AND OR"):
            with self.subTest(q=q):
                self.assertEqual(self.client.get("/api/news", params={"q": q}).status_code, 200)


class StatusTests(ApiTestCase):
    def test_counts_and_flags(self):
        s = self.client.get("/api/news/status").json()
        self.assertFalse(s["dol_configured"])
        self.assertTrue(s["sync_enabled"])
        self.assertFalse(s["syncing"])
        self.assertEqual(s["agencies"], [AGENCY])
        self.assertEqual(s["counts"],
                         {"all": 6, "rules": 1, "rulemaking": 1, "notices": 1,
                          "public_inspection": 1, "enforcement": 2})
        self.assertFalse(s["sources"]["dol_osha"]["enabled"])
        self.assertIsNone(s["sources"]["dol_osha"]["next_due_at"])

    def test_dol_configured_follows_environment(self):
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "k"}):
            s = self.client.get("/api/news/status").json()
        self.assertTrue(s["dol_configured"])
        self.assertTrue(s["sources"]["dol_osha"]["enabled"])
        self.assertTrue(s["sources"]["dol_osha"]["stale"])   # never synced

    def test_source_rows_from_seeded_sync_status(self):
        now = datetime(2026, 11, 16, 17, 0, tzinfo=timezone.utc)
        with closing(news_store.connect()) as con:
            news_store.record_ok(con, "federal_register", 3, now)             # fresh
            news_store.record_ok(con, "federal_register_pi", 2, now - timedelta(days=8))
            news_store.record_error(con, "federal_register_pi", "Public inspection unavailable", now)
            con.commit()
        with mock.patch("app.routers.news.datetime") as dt_mock:
            dt_mock.now.return_value = now
            s = self.client.get("/api/news/status").json()
        fr = s["sources"]["federal_register"]
        self.assertFalse(fr["stale"])
        self.assertIsNone(fr["retry_after"])
        self.assertIsNotNone(fr["next_due_at"])
        pi = s["sources"]["federal_register_pi"]
        self.assertTrue(pi["stale"])                        # 8 days old: a window passed
        self.assertEqual(pi["fail_count"], 1)
        self.assertEqual(pi["last_error"], "Public inspection unavailable")
        self.assertIsNotNone(pi["retry_after"])             # 5-minute backoff is running
        self.assertEqual(pi["next_due_at"], pi["retry_after"])
        self.assertFalse(s["due"])                          # stale but inside backoff

    def test_status_never_wakes_the_worker(self):
        self.client.get("/api/news/status")
        self.client.get("/api/news")
        self.assertFalse(news_worker._wake.is_set())


class FacetsTests(ApiTestCase):
    def test_states_with_counts(self):
        r = self.client.get("/api/news/facets").json()
        self.assertEqual(r["states"], [{"code": "NH", "count": 1}, {"code": "TX", "count": 1}])


class RefreshTests(ApiTestCase):
    def test_force_true_queues_every_enabled_source(self):
        r = self.client.post("/api/news/refresh", json={"force": True})
        self.assertEqual(r.status_code, 202)
        self.assertEqual(r.json()["queued"], ["federal_register", "federal_register_pi"])

    def test_force_false_with_fresh_sources_queues_nothing(self):
        now = datetime(2026, 11, 16, 17, 0, tzinfo=timezone.utc)
        with closing(news_store.connect()) as con:
            news_store.record_ok(con, "federal_register", 3, now)
            news_store.record_ok(con, "federal_register_pi", 2, now)
            con.commit()
        orig_due = news_worker.due_sources
        with mock.patch.object(news_worker, "due_sources", lambda n=None: orig_due(n or now)):
            r = self.client.post("/api/news/refresh", json={"force": False})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["queued"], [])

    def test_force_false_queues_only_due_sources(self):
        now = datetime(2026, 11, 16, 17, 0, tzinfo=timezone.utc)
        with closing(news_store.connect()) as con:
            news_store.record_ok(con, "federal_register", 3, now)
            con.commit()
        orig_due = news_worker.due_sources
        with mock.patch.object(news_worker, "due_sources", lambda n=None: orig_due(n or now)):
            r = self.client.post("/api/news/refresh", json={"force": False})
        self.assertEqual(r.status_code, 202)
        self.assertEqual(r.json()["queued"], ["federal_register_pi"])

    def test_gravity_accepts_other_and_unclassified(self):
        for g in ("O", "U"):
            res = self.client.get("/api/news", params={"gravity": g})
            self.assertEqual(res.status_code, 200, g)

    def test_409_while_syncing(self):
        with news_worker._running:
            r = self.client.post("/api/news/refresh", json={"force": True})
        self.assertEqual(r.status_code, 409)

    def test_503_when_sync_disabled(self):
        with mock.patch.dict("os.environ", {"NEWS_SYNC": "0"}):
            r = self.client.post("/api/news/refresh", json={"force": True})
        self.assertEqual(r.status_code, 503)


class RelatedTests(ApiTestCase):
    def test_section_matches_exact_and_part_level(self):
        r = self.client.get("/api/news/section/1910.1200").json()
        self.assertEqual(r["section_id"], "1910.1200")
        self.assertEqual(r["count"], 1)
        r = self.client.get("/api/news/section/§ 1910.1030").json()
        self.assertEqual(r["section_id"], "1910.1030")
        self.assertEqual({a["guid"] for a in r["articles"]},
                         {"dol-insp:306953084", "fr:2026-20001"})
        self.assertEqual(r["stats"]["case_count"], 1)
        self.assertEqual(r["stats"]["top_paragraphs"][0]["para"], "(g)(2)(ii)(A)")
        self.assertIsNone(r["stats"]["top_paragraphs"][0]["share_pct"])

    def test_part_matches_everything_inside(self):
        r = self.client.get("/api/news/part/1910").json()
        self.assertEqual(r["count"], 4)

    def test_other_titles_are_empty(self):
        r = self.client.get("/api/news/section/1910.1030?title=40").json()
        self.assertEqual((r["count"], r["articles"]), (0, []))


class FreshInstallTests(ApiTestCase):
    seed_data = False

    def test_every_endpoint_is_empty_and_well_formed(self):
        self.assertEqual(self.client.get("/api/news").json(),
                         {"articles": [], "total": 0, "offset": 0})
        s = self.client.get("/api/news/status").json()
        self.assertEqual(s["counts"]["all"], 0)
        self.assertTrue(s["due"])                          # never synced: everything due
        self.assertEqual(self.client.get("/api/news/facets").json(),
                         {"states": [], "top_naics": [], "emphasis_codes": []})
        self.assertEqual(self.client.get("/api/news/section/1910.1030").json()["count"], 0)
        self.assertEqual(self.client.get("/api/news/part/1910").json()["count"], 0)
        self.assertEqual(self.client.get("/api/news/enforcement/summary").json()["total_cases"], 0)
        self.assertEqual(self.client.get("/api/news/inspection/306953084").status_code, 404)
        self.assertFalse(news_store.db_path().exists())


class InspectionCaseTests(ApiTestCase):
    def test_summary_and_cached_case_file(self):
        s = self.client.get("/api/news/enforcement/summary").json()
        self.assertEqual(s["total_cases"], 2)
        self.assertEqual(s["total_penalty_usd"], 55000.0)
        self.assertEqual(s["largest_case"]["activity_nr"], 306953084)
        res = self.client.get("/api/news/inspection/306953084")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["cached"])
        self.assertEqual(len(data["violations"]), 4)
        self.assertEqual(data["violations"][0]["para"], "(g)(2)(ii)(A)")

    def test_enrich_fetches_events_and_gdc_with_key(self):
        fake = FakeAPI()
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "secret-key"}), fake.patch_client():
            res = self.client.post("/api/news/inspection/306953084/enrich")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["needs_enrichment"])
        self.assertEqual(len(data["events"]), 2)
        self.assertEqual(len(data["gdc"]), 1)
        self.assertIn("recognized hazards", data["gdc"][0]["text"])
        self.assertEqual(len(data["related"]), 1)
        self.assertEqual(data["related"][0]["rel_act_nr"], 307000001)
        self.assertTrue(data["related"][0]["cached"])
        self.assertEqual(data["related"][0]["estab_name"], "Acme Foundry Llc")

        # Repeat non-forced enrich skips upstream DOL calls when case_mod_date is unchanged.
        before = len(fake.requests)
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "secret-key"}), fake.patch_client():
            res2 = self.client.post("/api/news/inspection/306953084/enrich")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(len(fake.requests), before)

        # Explicit force=true bypasses the delta guard.
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "secret-key"}), fake.patch_client():
            res3 = self.client.post("/api/news/inspection/306953084/enrich?force=true")
        self.assertEqual(res3.status_code, 200)
        self.assertGreater(len(fake.requests), before)

        res = self.client.get("/api/news/enforcement/naics/4552")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["case_count"], 1)
        self.assertEqual(res.json()["top_sections"][0]["section_id"], "1910.1030")

        # Stage 3: GDC narrative & NAICS filters + facets.
        r_naics = self.client.get("/api/news?naics=4552").json()
        self.assertEqual({a["guid"] for a in r_naics["articles"]}, {"dol-insp:306953084"})
        r_gdc = self.client.get("/api/news?gdc=1").json()
        self.assertEqual({a["guid"] for a in r_gdc["articles"]}, {"dol-insp:306953084"})
        r_state_plan = self.client.get("/api/news?jurisdiction=state_plan").json()
        self.assertEqual({a["guid"] for a in r_state_plan["articles"]}, {"dol-insp:306953084"})
        r_fts_gdc = self.client.get("/api/news?q=recognized hazards").json()
        self.assertEqual(r_fts_gdc["articles"][0]["guid"], "dol-insp:306953084")
        self.assertIn("\x02", r_fts_gdc["articles"][0]["snippet"])

    def test_enrich_requires_key(self):
        res = self.client.post("/api/news/inspection/306953084/enrich")
        self.assertEqual(res.status_code, 400)

    def test_no_worker_thread_is_alive(self):
        self.assertNotIn("news-worker", [t.name for t in threading.enumerate()])

    def test_stage4_live_dol_search_cache_and_local_claude_tool(self):
        from app import chat

        # Missing DOL_API_KEY -> 503 cleanly.
        self.assertEqual(self.client.get("/api/news/dol/search?q=acme").status_code, 503)

        fake = FakeAPI()
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "secret-key"}), fake.patch_client():
            r1 = self.client.get("/api/news/dol/search?q=acme&mode=employer")
            self.assertEqual(r1.status_code, 200)
            d1 = r1.json()
            self.assertFalse(d1["cached"])
            self.assertEqual(d1["results"][0]["activity_nr"], 307000001)
            before = len(fake.requests)
            # Second identical call hits TTL cache with 0 upstream requests.
            r2 = self.client.get("/api/news/dol/search?q=acme&mode=employer")
            self.assertEqual(r2.status_code, 200)
            self.assertTrue(r2.json()["cached"])
            self.assertEqual(len(fake.requests), before)

            # Standard search maps 1910.1030 -> IMIS prefix 19101030% and joins inspection.
            r_std = self.client.get("/api/news/dol/search?q=1910.1030&mode=standard")
            self.assertEqual(r_std.status_code, 200)
            self.assertEqual(r_std.json()["results"][0]["activity_nr"], 306953084)

        # Claude local-only search_enforcement reads SQLite only (network guard proves 0 HTTP).
        out, summary = chat.run_tool("search_enforcement", {"section_id": "1910.1030", "naics": "4552"})
        self.assertIn("Local cached OSHA inspection sample", out)
        self.assertIn("1910.1030", out)
        self.assertIn("Christmas Tree Shops", out)
        self.assertIn("cases", summary)

    def test_multi_title_news_and_fr_body_endpoint(self):
        epa = news.enrich_item({
            **news.empty_item(),
            "guid": "fr:2026-30001", "source": "federal_register",
            "agency": "environmental-protection-agency", "category": "rules",
            "doc_type": "Rule", "title": "Hazardous Waste Update under 40 CFR 261.3",
            "link": "https://www.federalregister.gov/documents/2026-30001",
            "published_at": "2026-11-12",
            "cfr_parts": [{"title": 40, "part": "261"}],
        })
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, epa)
            con.commit()

        sec40 = self.client.get("/api/news/section/261.3?title=40").json()
        self.assertEqual(sec40["count"], 1)
        self.assertEqual(sec40["articles"][0]["guid"], "fr:2026-30001")
        feed40 = self.client.get("/api/news?cfr_title=40").json()
        self.assertEqual([a["guid"] for a in feed40["articles"]], ["fr:2026-30001"])

        import httpx
        fake = FakeAPI(extra_routes={
            "/api/v1/documents/2026-17726.json": FR_DOC_RULE,
            "/documents/full_text/html/2026/08/31/2026-17726.html": lambda req: httpx.Response(
                200,
                text='<div class="preamble"><script>bad()</script><p>Amends 29 CFR 1910.120.</p></div>',
                request=req,
            ),
        })
        with fake.patch_client():
            r1 = self.client.get("/api/news/fr/2026-17726")
            self.assertEqual(r1.status_code, 200)
            d1 = r1.json()
            self.assertFalse(d1["cached"])
            self.assertNotIn("<script", d1["body_html"])
            self.assertIn("29 CFR 1910.120", d1["body_html"])
            before = len(fake.requests)
            r2 = self.client.get("/api/news/fr/2026-17726")
            self.assertEqual(r2.status_code, 200)
            self.assertTrue(r2.json()["cached"])
            self.assertEqual(len(fake.requests), before)


if __name__ == "__main__":
    unittest.main()
