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
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], 2)
            self.assertEqual(con.execute("PRAGMA foreign_keys").fetchone()[0], 1)

    def test_version_mismatch_recreates(self):
        news_store.init_db()
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY)))
            con.execute("PRAGMA user_version = 99")
            con.commit()
        with closing(news_store.connect()) as con:
            self.assertEqual(self.counts(con), (0, 0, 0))
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], 2)

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
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], 2)
            self.assertEqual(self.counts(con), (1, 1, 1))
            res = news_store.query_articles(con, q="Rescission")
            self.assertEqual(res["total"], 1)


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
