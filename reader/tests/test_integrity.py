"""Integrity layer: CFR provenance in meta, `app.integrity` across cfr/fr/usc, GovInfo
cross-check (fixtures only, never live), and GET /api/integrity."""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import sqlite3
import tempfile
from contextlib import closing, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import httpx
from fastapi.testclient import TestClient

from app import build, config, fr_build, fr_store, govinfo, integrity, library, usc_build, usc_client, usc_store
from tests import fake_titles
from tests.base import HermeticTestCase
from tests.test_fr_corpus import HAZCOM, JOINT, RCRA, FakeFR
from tests.test_usc_corpus import FakeOLRC

NOW = datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc)


def by_check(report: dict, corpus: str, check: str, target: str | None = None) -> dict:
    hits = [i for i in report["items"] if i["corpus"] == corpus and i["check"] == check
            and (target is None or i["target"] == target)]
    assert len(hits) == 1, (corpus, check, target, report["items"])
    return hits[0]


class IntegrityCase(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.fake = fake_titles.FakeTitles(titles=(29,))
        self.tmp = self.fake.install()
        self.addCleanup(self.fake.remove)
        for p in (mock.patch.object(fr_build, "log", lambda m: None),
                  mock.patch.object(usc_build, "log", lambda m: None)):
            p.start()
            self.addCleanup(p.stop)
        usc_client.clear_cache()
        usc_store.clear_caches()
        self.addCleanup(usc_client.clear_cache)
        self.addCleanup(usc_store.clear_caches)
        usc_build.reset_schedule()

    def run_report(self, **kw) -> dict:
        kw.setdefault("now", NOW)
        return integrity.run(**kw)

    def cfr_meta(self, t: int = 29) -> dict:
        with closing(sqlite3.connect(config.db_path(t))) as con:
            return dict(con.execute("SELECT key, value FROM meta"))

    def set_cfr_meta(self, t: int, sql: str, params=()) -> None:
        from app import store
        store.reset_connections()
        with closing(sqlite3.connect(config.db_path(t))) as con:
            con.execute(sql, params)
            con.commit()


class CfrProvenanceTests(IntegrityCase):
    def test_build_records_source_hashes_and_fetch_time(self):
        meta = self.cfr_meta()
        xml = fake_titles.XML[29].encode("utf-8")
        self.assertEqual(meta["xml_sha256"], hashlib.sha256(xml).hexdigest())
        self.assertEqual(meta["xml_sha256_kind"], "file")
        self.assertEqual(meta["source_url"], f"{config.ECFR_API}/full/{fake_titles.EDITION}/title-29.xml")
        self.assertEqual(meta["structure_url"], f"{config.ECFR_API}/structure/{fake_titles.EDITION}/title-29.json")
        canon = json.dumps(fake_titles.STRUCTURE[29], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        self.assertEqual(meta["structure_sha256"], hashlib.sha256(canon.encode()).hexdigest())
        self.assertRegex(meta["fetched_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

    def test_multi_piece_builds_hash_a_manifest(self):
        rows = dict(build.provenance_rows("base", "s", {"a": 1}, [("u1", "h1"), ("u2", "h2")], "t"))
        self.assertEqual(rows["xml_sha256_kind"], "manifest")
        self.assertEqual(rows["xml_sha256"], hashlib.sha256(b"u1\th1\nu2\th2\n").hexdigest())
        self.assertEqual(json.loads(rows["xml_pieces"]), [{"url": "u1", "sha256": "h1"}, {"url": "u2", "sha256": "h2"}])


class CfrIntegrityTests(IntegrityCase):
    def test_healthy_title(self):
        r = self.run_report(corpus="cfr")
        self.assertEqual(by_check(r, "cfr", "database")["status"], "OK")
        self.assertEqual(by_check(r, "cfr", "sections")["status"], "OK")
        self.assertEqual(by_check(r, "cfr", "missing_leaves")["status"], "OK")
        prov = by_check(r, "cfr", "provenance")
        self.assertEqual(prov["status"], "INFO")
        self.assertNotIn("unknown", prov["detail"])
        self.assertEqual(by_check(r, "cfr", "source_xml")["status"], "INFO")      # not cached
        self.assertEqual(by_check(r, "cfr", "upstream")["status"], "OK")
        self.assertEqual(r["status"], "OK")

    def test_old_builds_report_unknown_provenance(self):
        self.set_cfr_meta(29, "DELETE FROM meta WHERE key IN ('xml_sha256','structure_sha256','source_url',"
                              "'fetched_at','xml_sha256_kind','missing_leaves')")
        r = self.run_report(corpus="cfr", online=False)
        prov = by_check(r, "cfr", "provenance")
        self.assertEqual(prov["provenance"]["xml_sha256"], "unknown")
        self.assertIn("rebuild to record", prov["detail"])
        self.assertEqual(by_check(r, "cfr", "missing_leaves")["status"], "INFO")
        self.assertEqual(r["status"], "OK")
        # the reader keeps working on an old DB
        client = TestClient(__import__("app.main", fromlist=["app"]).app)
        self.assertEqual(client.get("/api/29/meta").status_code, 200)

    def test_missing_leaves_and_stale_edition_warn(self):
        self.set_cfr_meta(29, "UPDATE meta SET value = '3' WHERE key = 'missing_leaves'")
        newer = [{**t, "up_to_date_as_of": "2026-11-01"} for t in fake_titles.fake_fetch_json(None, "/titles.json")["titles"]]
        with mock.patch.object(library, "ecfr_titles", lambda refresh=False: newer):
            r = self.run_report(corpus="cfr", title=29)
        self.assertEqual(by_check(r, "cfr", "missing_leaves")["status"], "WARN")
        up = by_check(r, "cfr", "upstream")
        self.assertEqual(up["status"], "WARN")
        self.assertIn("eCFR has 2026-11-01", up["detail"])
        self.assertEqual(r["status"], "WARN")

    def test_cached_xml_is_rehashed(self):
        cached = config.DATA_DIR / "title-29.xml.tmp"
        cached.write_text(fake_titles.XML[29], encoding="utf-8")
        self.assertEqual(by_check(self.run_report(corpus="cfr", online=False), "cfr", "source_xml")["status"], "OK")
        cached.write_text(fake_titles.XML[29] + "<!-- tampered -->", encoding="utf-8")
        r = self.run_report(corpus="cfr", online=False)
        self.assertEqual(by_check(r, "cfr", "source_xml")["status"], "FAIL")
        self.assertEqual(r["status"], "FAIL")

    def test_unreachable_ecfr_warns(self):
        def boom(refresh=False):
            raise httpx.ConnectError("down")
        with mock.patch.object(library, "ecfr_titles", boom):
            r = self.run_report(corpus="cfr")
        self.assertIn("couldn't reach eCFR", by_check(r, "cfr", "upstream")["detail"])

    def test_not_installed_title_fails(self):
        r = self.run_report(corpus="cfr", title=40, online=False)
        self.assertEqual(by_check(r, "cfr", "installed")["status"], "FAIL")


class FrIntegrityTests(IntegrityCase):
    def build_fr(self, docs=(HAZCOM, RCRA, JOINT)):
        with FakeFR(list(docs)).patch():
            fr_build.build(titles=[29, 40], since="2026-06-01", until="2026-11-18", force=True)
        with closing(fr_store.connect()) as con:
            fr_store.set_meta(con, {"last_ok_at": "2026-11-19T12:00:00+00:00"})
            con.commit()

    def test_not_built(self):
        r = self.run_report(corpus="fr")
        self.assertEqual(by_check(r, "fr", "installed")["status"], "INFO")

    def test_healthy_corpus_and_govinfo_skipped_without_key(self):
        self.build_fr()
        r = self.run_report(corpus="fr")
        for check in ("database", "documents", "raw_sha256", "coverage", "freshness"):
            self.assertEqual(by_check(r, "fr", check)["status"], "OK", check)
        self.assertEqual(by_check(r, "fr", "body_sha256")["status"], "INFO")
        gov = by_check(r, "fr", "govinfo")
        self.assertEqual(gov["status"], "INFO")
        self.assertIn("GOVINFO_API_KEY not set", gov["detail"])
        self.assertEqual(r["status"], "OK")

    def test_tampered_record_and_coverage_gap_and_staleness(self):
        self.build_fr()
        with closing(fr_store.connect()) as con:
            con.execute("UPDATE documents SET raw_json = replace(raw_json, 'Hazard', 'Hazzard') "
                        "WHERE document_number = '2026-20001'")
            con.execute("DELETE FROM coverage WHERE title = 40 AND start LIKE '2026-08%'")
            con.commit()
        r = self.run_report(corpus="fr", online=False, now=datetime(2026, 11, 30, 15, tzinfo=timezone.utc))
        raw = by_check(r, "fr", "raw_sha256")
        self.assertEqual(raw["status"], "FAIL")
        self.assertIn("2026-20001", raw["detail"])
        cov = by_check(r, "fr", "coverage")
        self.assertEqual(cov["status"], "WARN")
        self.assertEqual(cov["gaps"], {"40": ["2026-08"]} if isinstance(next(iter(cov["gaps"])), str) else {40: ["2026-08"]})
        fresh = by_check(r, "fr", "freshness")
        self.assertEqual(fresh["status"], "WARN")            # Thu 11-19 → Mon 11-30 = 7 business days
        self.assertEqual(r["status"], "FAIL")

    def test_body_hashes_are_checked(self):
        body = b"<RULE><P>Body text.</P></RULE>"
        fake = FakeFR([HAZCOM], bodies={"2026-20001": body})
        with fake.patch():
            fr_build.build(titles=[29], since="2026-11-01", until="2026-11-18", force=True)
            fr_build.fetch_body("2026-20001")
        self.assertEqual(by_check(self.run_report(corpus="fr", online=False), "fr", "body_sha256")["status"], "OK")
        with closing(fr_store.connect()) as con:
            con.execute("UPDATE document_bodies SET content = content || ' '")
            con.commit()
        self.assertEqual(by_check(self.run_report(corpus="fr", online=False), "fr", "body_sha256")["status"], "FAIL")

    def test_business_days(self):
        from datetime import date
        self.assertEqual(integrity.business_days_between(date(2026, 11, 20), date(2026, 11, 23)), 1)  # Fri → Mon
        self.assertEqual(integrity.business_days_between(date(2026, 11, 19), date(2026, 11, 19)), 0)

    def test_staged_build_is_reported(self):
        with FakeFR([HAZCOM], fail_months=("2026-09",)).patch(), self.assertRaises(Exception):
            fr_build.build(titles=[29], since="2026-06-01", until="2026-11-18")
        r = self.run_report(corpus="fr", online=False)
        self.assertEqual(by_check(r, "fr", "staged_build")["status"], "INFO")


class GovInfoTests(IntegrityCase):
    GRANULES = {
        "count": 3,
        "granules": [{"granuleId": "2026-20001", "title": "Hazard Communication"},
                     {"granuleId": "2026-20002", "title": "Unrelated notice"}],
        "nextPage": "https://api.govinfo.gov/packages/FR-2026-11-02/granules?offsetMark=AAA&pageSize=1000",
    }
    PAGE2 = {"count": 3, "granules": [{"granuleId": "FR-2026-11-02-2026-20003"}], "nextPage": None}

    def transport(self, seen: list):
        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            assert request.url.host == "api.govinfo.gov"
            if request.url.params.get("offsetMark") == "AAA":
                return httpx.Response(200, json=self.PAGE2, request=request)
            if "FR-2026-11-03" in request.url.path:
                return httpx.Response(404, json={"message": "not found"}, request=request)
            return httpx.Response(200, json=self.GRANULES, request=request)
        return httpx.MockTransport(handler)

    def patch_client(self, seen):
        return mock.patch.object(govinfo, "client", lambda: httpx.Client(transport=self.transport(seen)))

    def test_no_key_returns_none(self):
        self.assertIsNone(govinfo.fr_package_documents("2026-11-02"))
        self.assertIsNone(govinfo.cross_check_fr("2026-11-02", {"2026-20001"}))

    def test_package_documents_follow_pages_and_send_key(self):
        seen: list = []
        with mock.patch.dict("os.environ", {"GOVINFO_API_KEY": "test-key"}), self.patch_client(seen):
            docs = govinfo.fr_package_documents("2026-11-02")
            empty = govinfo.fr_package_documents("2026-11-03")       # no issue that day → 404 → empty
        self.assertEqual(docs, {"2026-20001", "2026-20002", "2026-20003"})
        self.assertEqual(empty, set())
        self.assertEqual(seen[0].url.path, "/packages/FR-2026-11-02/granules")
        self.assertEqual(seen[0].url.params["api_key"], "test-key")
        self.assertEqual(seen[1].url.params["api_key"], "test-key")

    def test_cross_check_in_integrity_report(self):
        hazcom = {**HAZCOM, "publication_date": "2026-11-02"}
        stray = {**RCRA, "document_number": "2026-29999", "publication_date": "2026-11-02",
                 "cfr_references": [{"chapter": None, "citation_url": None, "part": "1910", "title": 29}]}
        with FakeFR([hazcom, stray]).patch():
            fr_build.build(titles=[29], since="2026-11-01", until="2026-11-18", force=True)
        seen: list = []
        with mock.patch.dict("os.environ", {"GOVINFO_API_KEY": "test-key"}), self.patch_client(seen):
            r = self.run_report(corpus="fr", govinfo_date="2026-11-02")
        gov = by_check(r, "fr", "govinfo")
        self.assertEqual(gov["status"], "WARN")
        self.assertEqual(gov["govinfo"]["both"], ["2026-20001"])
        self.assertEqual(gov["govinfo"]["missing_from_govinfo"], ["2026-29999"])
        self.assertEqual(gov["govinfo"]["not_in_corpus"], 2)
        self.assertNotIn("test-key", json.dumps(r))

    def test_errors_never_leak_the_key(self):
        def handler(request):
            return httpx.Response(500, request=request)
        with mock.patch.dict("os.environ", {"GOVINFO_API_KEY": "secret-key"}), \
                mock.patch.object(govinfo, "client", lambda: httpx.Client(transport=httpx.MockTransport(handler))):
            with self.assertRaises(Exception) as ctx:
                govinfo.fr_package_documents("2026-11-02")
        self.assertNotIn("secret-key", str(ctx.exception))


class UscIntegrityTests(IntegrityCase):
    def test_usc_checks_and_cached_source_rehash(self):
        with FakeOLRC(rp="119-140").patch():
            usc_build.build(4, force=True, keep_source=True)
        usc_client.clear_cache()
        with FakeOLRC(rp="119-142").patch():
            r = self.run_report(corpus="usc", title=4)
        self.assertEqual(by_check(r, "usc", "sections")["status"], "OK")
        self.assertEqual(by_check(r, "usc", "source_zip")["status"], "OK")
        self.assertEqual(by_check(r, "usc", "source_xml")["status"], "OK")
        self.assertEqual(by_check(r, "usc", "provenance")["provenance"]["release_point"], "119-140")
        up = by_check(r, "usc", "upstream")
        self.assertEqual(up["status"], "WARN")
        self.assertIn("OLRC is at 119-142", up["detail"])
        _, xml_cache = usc_build.source_cache(4)
        xml_cache.write_bytes(xml_cache.read_bytes() + b" ")
        r = self.run_report(corpus="usc", online=False)
        self.assertEqual(by_check(r, "usc", "source_xml")["status"], "FAIL")

    def test_without_cache_rehash_is_info_and_rebuild_clears_stale_cache(self):
        with FakeOLRC().patch():
            usc_build.build(4, force=True, keep_source=True)
            usc_build.build(4, force=True)                   # no keep_source: old cache removed
        self.assertFalse(usc_build.source_cache(4)[0].exists())
        r = self.run_report(corpus="usc", online=False)
        self.assertEqual(by_check(r, "usc", "source_zip")["status"], "INFO")

    def test_nothing_installed(self):
        r = self.run_report(corpus="usc", online=False)
        self.assertEqual(by_check(r, "usc", "installed")["status"], "INFO")


class CliAndApiTests(IntegrityCase):
    def test_cli_table_json_and_exit_codes(self):
        out = io.StringIO()
        with redirect_stdout(out), self.assertRaises(SystemExit) as ctx:
            integrity.main(["--corpus", "cfr", "--offline"])
        self.assertEqual(ctx.exception.code, 0)
        self.assertIn("OK    cfr  title 29  database", out.getvalue())
        self.assertIn("(offline: upstream checks skipped)", out.getvalue())
        (config.DATA_DIR / "title-29.xml.tmp").write_text("tampered", encoding="utf-8")
        out = io.StringIO()
        with redirect_stdout(out), self.assertRaises(SystemExit) as ctx:
            integrity.main(["--corpus", "cfr", "--offline", "--json"])
        self.assertEqual(ctx.exception.code, 1)
        self.assertEqual(json.loads(out.getvalue())["status"], "FAIL")
        with self.assertRaises(ValueError):
            integrity.run("fr", 29)

    def test_api(self):
        from app.main import app
        client = TestClient(app)
        r = client.get("/api/integrity", params={"offline": "true"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["cache-control"], "no-store")
        body = r.json()
        self.assertEqual({i["corpus"] for i in body["items"]}, {"cfr", "fr", "usc"})
        self.assertFalse(body["online"])
        self.assertEqual(client.get("/api/integrity", params={"corpus": "x"}).status_code, 422)
        self.assertEqual(client.get("/api/integrity", params={"corpus": "fr", "title": 29}).status_code, 422)
