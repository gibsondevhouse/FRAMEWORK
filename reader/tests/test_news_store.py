"""news_store against a temporary DATA_DIR (the fake_titles pattern): schema, upserts,
the PI-vs-published guard, pruning, cascade and sync status."""
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import date, datetime, timezone
from pathlib import Path
from unittest import mock

from app import config, news, news_store
from tests.news_fixtures import (DOL_INSPECTIONS, DOL_VIOLATIONS, FR_DOC_NOTICE,
                                 FR_DOC_RULE, PI_DOC_SHARED, NetworkGuardTestCase)

AGENCY = "occupational-safety-and-health-administration"


class StoreTestCase(NetworkGuardTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="news-store-"))
        patcher = mock.patch.object(config, "DATA_DIR", self.tmp)
        patcher.start()
        self.addCleanup(patcher.stop)

    def counts(self, con):
        return tuple(con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
                     for t in ("articles", "article_citations", "articles_fts"))


class InitTests(StoreTestCase):
    def test_init_db_twice_is_harmless(self):
        news_store.init_db()
        news_store.init_db()
        self.assertTrue((self.tmp / "osha_news.sqlite3").exists())
        with closing(news_store.connect()) as con:
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], news_store.SCHEMA_VERSION)
            self.assertEqual(con.execute("PRAGMA foreign_keys").fetchone()[0], 1)

    def test_version_mismatch_recreates(self):
        news_store.init_db()
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY)))
            con.execute("PRAGMA user_version = 99")
            con.commit()
        with closing(news_store.connect()) as con:
            self.assertEqual(self.counts(con), (0, 0, 0))
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], news_store.SCHEMA_VERSION)

    def test_v1_migrates_fts_without_losing_articles(self):
        news_store.init_db()
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY)))
            con.executescript(
                "DROP TABLE articles_fts;"
                "CREATE VIRTUAL TABLE articles_fts USING fts5(guid UNINDEXED, title, description, company);"
                "PRAGMA user_version = 1;"
            )
            con.commit()
        with closing(news_store.connect()) as con:
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], news_store.SCHEMA_VERSION)
            self.assertEqual(self.counts(con), (1, 1, 1))
            res = news_store.query_articles(con, q="Rescission")
            self.assertEqual(res["total"], 1)

    def test_v2_migrates_related_json_without_losing_cases(self):
        news_store.init_db()
        art = news.enrich_item(news.build_enforcement_article(
            DOL_INSPECTIONS[0], news.group_violations(DOL_VIOLATIONS, 50)[306953084]))
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, art)
            con.executescript(
                "DROP TABLE enforcement_cases;"
                "CREATE TABLE enforcement_cases ("
                "  activity_nr INTEGER PRIMARY KEY, details_json TEXT NOT NULL DEFAULT '{}',"
                "  violations_json TEXT NOT NULL DEFAULT '[]', events_json TEXT NOT NULL DEFAULT '[]',"
                "  gdc_json TEXT NOT NULL DEFAULT '[]', accidents_json TEXT NOT NULL DEFAULT '[]',"
                "  enriched_at TEXT, fetched_at TEXT NOT NULL);"
                "INSERT INTO enforcement_cases (activity_nr, details_json, violations_json, enriched_at, fetched_at)"
                "  VALUES (306953084, '{\"estab_name\":\"X\"}', '[]', '2026-11-17', '2026-11-17');"
                "PRAGMA user_version = 2;"
            )
            con.commit()
        with closing(news_store.connect()) as con:
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], news_store.SCHEMA_VERSION)
            case = news_store.get_enforcement_case(con, 306953084)
            self.assertIsNotNone(case)
            self.assertEqual(case["related"], [])
            self.assertEqual(case["enrich_ver"], 0)

    def test_v3_migrates_fr_bodies_and_supports_non_29_summary(self):
        news_store.init_db()
        with closing(news_store.connect()) as con:
            con.executescript("DROP TABLE IF EXISTS fr_bodies; PRAGMA user_version = 3;")
            con.commit()
        with closing(news_store.connect()) as con:
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], news_store.SCHEMA_VERSION)
            epa = news.enrich_item({
                **news.empty_item(),
                "guid": "fr:2026-30001", "source": "federal_register",
                "agency": "environmental-protection-agency", "category": "rules",
                "doc_type": "Rule", "title": "Hazardous Waste Update under 40 CFR 261.3",
                "link": "https://www.federalregister.gov/documents/2026-30001",
                "published_at": "2026-11-12",
                "cfr_parts": [{"title": 40, "part": "261"}],
            })
            news_store.upsert_article(con, epa)
            news_store.save_fr_body(con, "2026-30001", "<p>Body text</p>")
            con.commit()
            self.assertEqual(news_store.get_fr_body(con, "2026-30001")["body_html"], "<p>Body text</p>")
        self.assertEqual(news_store.summary_for_title(40)["count"], 1)
        self.assertEqual(news_store.summary_for_title(29)["count"], 0)


class UpsertTests(StoreTestCase):
    def test_upsert_is_idempotent(self):
        item = news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY))
        with closing(news_store.connect()) as con:
            self.assertTrue(news_store.upsert_article(con, item))
            self.assertTrue(news_store.upsert_article(con, item))
            con.commit()
            self.assertEqual(self.counts(con), (1, 1, 1))

    def test_pi_then_published_leaves_published(self):
        pi = news.enrich_item(news.pi_item(PI_DOC_SHARED, AGENCY))
        pub = news.enrich_item(news.fr_document_item(FR_DOC_NOTICE, AGENCY))
        with closing(news_store.connect()) as con:
            self.assertTrue(news_store.upsert_article(con, pi))
            self.assertTrue(news_store.upsert_article(con, pub))
            con.commit()
            rows = con.execute("SELECT source, category FROM articles").fetchall()
            self.assertEqual([(r["source"], r["category"]) for r in rows],
                             [("federal_register", "notices")])

    def test_published_then_pi_keeps_published(self):
        pi = news.enrich_item(news.pi_item(PI_DOC_SHARED, AGENCY))
        pub = news.enrich_item(news.fr_document_item(FR_DOC_NOTICE, AGENCY))
        with closing(news_store.connect()) as con:
            self.assertTrue(news_store.upsert_article(con, pub))
            self.assertFalse(news_store.upsert_article(con, pi))   # skipped
            con.commit()
            rows = con.execute("SELECT source FROM articles").fetchall()
            self.assertEqual([r["source"] for r in rows], ["federal_register"])

    def test_citations_written_for_parts_and_sections(self):
        art = news.enrich_item(news.build_enforcement_article(
            DOL_INSPECTIONS[0], news.group_violations(DOL_VIOLATIONS, 50)[306953084]))
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, art)
            rows = con.execute(
                "SELECT part_id, section_id FROM article_citations ORDER BY section_id").fetchall()
            self.assertEqual([(r["part_id"], r["section_id"]) for r in rows],
                             [("1910", "1910.1030"), ("1926", "1926.501")])

    def test_enforcement_case_and_summary_stored(self):
        art = news.enrich_item(news.build_enforcement_article(
            DOL_INSPECTIONS[0], news.group_violations(DOL_VIOLATIONS, 50)[306953084]))
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, art)
            con.commit()
            case = news_store.get_enforcement_case(con, 306953084)
            self.assertIsNotNone(case)
            self.assertEqual(len(case["violations"]), 4)
            self.assertEqual(case["violations"][0]["section_id"], "1910.1030")
            self.assertEqual(case["violations"][0]["para"], "(g)(2)(ii)(A)")
            summary = news_store.enforcement_summary(con)
            self.assertEqual(summary["total_cases"], 1)
            self.assertEqual(summary["total_penalty_usd"], 30000.0)
            self.assertEqual(summary["gravity_counts"]["W"], 1)
            self.assertEqual(summary["largest_case"]["activity_nr"], 306953084)

    def test_stage2_reduction_fta_and_paragraph_hotspot_threshold(self):
        # Verify $0 initial penalty safety, contested/FTA counts, and >=10 para % gating.
        insp = {**DOL_INSPECTIONS[0], "activity_nr": 9001, "state_flag": None}
        viols = [
            {"activity_nr": 9001, "citation_id": "01001", "standard": "19101030 G02   IIA",
             "viol_type": "S", "initial_penalty": "0", "current_penalty": "0",
             "contest_date": "2026-11-11", "abate_date": "2026-11-01"},
            {"activity_nr": 9001, "citation_id": "01002", "standard": "19101030 C01",
             "viol_type": "W", "initial_penalty": "10000", "current_penalty": "7000",
             "fta_insp_nr": 9002, "fta_penalty": "5000", "abate_complete": "X"},
        ]
        art = news.enrich_item(news.build_enforcement_article(insp, viols))
        self.assertEqual(art["inspection_detail"]["reduction_usd"], 3000.0)
        self.assertEqual(art["inspection_detail"]["reduction_pct"], 30.0)
        self.assertEqual(art["inspection_detail"]["contested_count"], 1)
        self.assertEqual(art["inspection_detail"]["fta_count"], 1)
        self.assertEqual(art["inspection_detail"]["fta_total_usd"], 5000.0)
        self.assertEqual(art["inspection_detail"]["open_abate_count"], 1)

        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, art)
            stats = news_store.section_enforcement_stats(con, "1910.1030")
            self.assertEqual(stats["case_count"], 1)
            self.assertEqual(stats["citation_count"], 2)
            self.assertEqual(stats["fta_count"], 1)
            # < 10 paragraph hits -> share_pct stays None to avoid small-sample false precision.
            self.assertTrue(all(p["share_pct"] is None for p in stats["top_paragraphs"]))

            # 10+ paragraph hits -> share_pct is populated.
            many_viols = [
                {"activity_nr": 9002, "citation_id": f"01{i:03d}", "standard": "19101030 C01",
                 "viol_type": "S", "initial_penalty": "1000", "current_penalty": "1000"}
                for i in range(10)
            ]
            art2 = news.enrich_item(news.build_enforcement_article({**insp, "activity_nr": 9002}, many_viols))
            news_store.upsert_article(con, art2)
            stats2 = news_store.section_enforcement_stats(con, "1910.1030")
            c1 = next(p for p in stats2["top_paragraphs"] if p["para"] == "(c)(1)")
            self.assertEqual(c1["count"], 11)
            self.assertIsNotNone(c1["share_pct"])

    def test_delete_cascades_citations(self):
        item = news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY))
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, item)
            con.execute("DELETE FROM articles WHERE guid = ?", (item["guid"],))
            self.assertEqual(con.execute("SELECT count(*) FROM article_citations").fetchone()[0], 0)


class PruneTests(StoreTestCase):
    def test_prune_removes_old_rows_everywhere(self):
        old = news.enrich_item(news.fr_document_item(
            {**FR_DOC_RULE, "document_number": "2020-1", "publication_date": "2020-01-01"}, AGENCY))
        new = news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY))
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, old)
            news_store.upsert_article(con, new)
            news_store.prune(con, today=date(2026, 11, 16))
            con.commit()
            self.assertEqual(self.counts(con), (1, 1, 1))
            self.assertEqual(con.execute("SELECT guid FROM articles").fetchone()[0], "fr:2026-17726")

    def test_prune_removes_stale_pi(self):
        pi = news.enrich_item(news.pi_item(PI_DOC_SHARED, AGENCY))   # scheduled 2026-11-10
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, pi)
            news_store.prune(con, today=date(2026, 11, 16))
            self.assertEqual(self.counts(con)[0], 1)                 # 6 days past: kept
            news_store.prune(con, today=date(2026, 11, 18))
            self.assertEqual(self.counts(con), (0, 0, 0))            # 8 days past: gone

    def test_prune_preserves_enriched_historical_cases(self):
        art = news.enrich_item(news.build_enforcement_article(
            DOL_INSPECTIONS[0], news.group_violations(DOL_VIOLATIONS, 50)[306953084]))
        art["published_at"] = "2020-01-01"
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, art)
            news_store.save_enforcement_case(
                con, 306953084, details=art["inspection_detail"],
                violations=art["violations_list"], events=[], enriched_at="2026-11-18T00:00:00+00:00",
            )
            news_store.prune(con, today=date(2026, 11, 18))
            con.commit()
            self.assertIsNotNone(news_store.get_enforcement_case(con, 306953084))

    def test_narratives_fts_and_prune_sync(self):
        insp = {**DOL_INSPECTIONS[1], "activity_nr": 8801, "insp_type": "M", "state_flag": None}
        viols = [{"activity_nr": 8801, "citation_id": "01001", "standard": "5A0001",
                  "viol_type": "S", "initial_penalty": "5000", "current_penalty": "5000"}]
        art = news.enrich_item(news.build_enforcement_article(insp, viols))
        art["published_at"] = "2026-11-15"
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, art)
            news_store.save_enforcement_case(
                con, 8801, details=art["inspection_detail"], violations=art["violations_list"],
                gdc=[{"citation_id": "01001", "text": "Combustible aluminum dust explosion hazard."}],
                accidents=[{"summary_nr": 77, "event_desc": "Trench wall collapse",
                            "keywords": "trench,cave-in", "fatality": "X",
                            "abstract": "Worker buried during excavation."}],
                related=[], enrich_ver=1, enriched_at="2026-11-16T00:00:00+00:00",
            )
            con.commit()
            res_gdc = news_store.query_articles(con, q="aluminum dust")
            self.assertEqual(res_gdc["total"], 1)
            res_acc = news_store.query_articles(con, q="excavation")
            self.assertEqual(res_acc["total"], 1)
            res_fat = news_store.query_articles(con, fatality=True)
            self.assertEqual(res_fat["total"], 1)
            # Deleting article + calling prune cleans enforcement_narratives_fts.
            con.execute("DELETE FROM articles WHERE guid = 'dol-insp:8801'")
            news_store.prune(con, today=date(2026, 11, 18))
            self.assertEqual(con.execute("SELECT count(*) FROM enforcement_narratives_fts").fetchone()[0], 0)


class SyncStatusTests(StoreTestCase):
    def test_error_then_ok(self):
        now = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)
        with closing(news_store.connect()) as con:
            news_store.record_error(con, "federal_register", "Federal Register unavailable", now)
            news_store.record_error(con, "federal_register", "Federal Register unavailable", now)
            con.commit()
        rows = news_store.sync_rows()
        fr = rows["federal_register"]
        self.assertEqual(fr["fail_count"], 2)
        self.assertIsNone(fr["last_ok_at"])
        self.assertEqual(fr["last_error_at"], now)
        self.assertEqual(fr["last_error_at"].tzinfo, timezone.utc)
        with closing(news_store.connect()) as con:
            news_store.record_ok(con, "federal_register", 4, now)
            con.commit()
        fr = news_store.sync_rows()["federal_register"]
        self.assertEqual((fr["fail_count"], fr["last_count"]), (0, 4))
        self.assertIsNone(fr["last_error"])
        self.assertEqual(fr["last_ok_at"], now)

    def test_error_leaves_last_ok_alone(self):
        ok_at = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)
        with closing(news_store.connect()) as con:
            news_store.record_ok(con, "dol_osha", 10, ok_at)
            news_store.record_error(con, "dol_osha", "DOL enforcement data unavailable")
            con.commit()
        row = news_store.sync_rows()["dol_osha"]
        self.assertEqual(row["last_ok_at"], ok_at)
        self.assertEqual(row["fail_count"], 1)


class QueryBasicsTests(StoreTestCase):
    def test_empty_database_queries(self):
        with closing(news_store.connect()) as con:
            res = news_store.query_articles(con)
            self.assertEqual(res, {"articles": [], "total": 0, "offset": 0})
            self.assertEqual(news_store.category_counts(con)["all"], 0)
            self.assertEqual(news_store.state_facets(con), [])

    def test_connections_leave_no_handles(self):
        news_store.init_db()
        # Windows can't delete an open file; make sure nothing lingers after use.
        with closing(news_store.connect()) as con:
            news_store.query_articles(con)
        (self.tmp / "osha_news.sqlite3").rename(self.tmp / "moved.sqlite3")


if __name__ == "__main__":
    unittest.main()
