"""Federal Register corpus: fr_client / fr_store / fr_build / the /api/fr router.

Hermetic: `config.DATA_DIR` is a temp dir and `fr_client.client` is patched to an
`httpx.MockTransport` (`FakeFR`) that answers documents.json by CFR title and date window,
the way the live API does. Field names match a live documents.json call (2026-11-19).
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import httpx
from fastapi.testclient import TestClient

from app import config, fr_build, fr_client, fr_store, library, news
from tests.base import HermeticTestCase


def _doc(num: str, pub: str, title: int, part: str, *, typ: str = "Rule", heading: str = "",
         abstract: str = "", vol: int = 91, start: int = 1000, end: int | None = None,
         extra_refs: list[dict] | None = None) -> dict:
    y, m, d = pub.split("-")
    return {
        "document_number": num, "type": typ, "title": heading or f"Document {num}",
        "abstract": abstract or None, "action": "Final rule." if typ == "Rule" else None,
        "dates": None,
        "agencies": [{"raw_name": "DEPARTMENT OF LABOR", "name": "Labor Department", "id": 271,
                      "url": "https://www.federalregister.gov/agencies/labor-department",
                      "json_url": "https://www.federalregister.gov/api/v1/agencies/271",
                      "parent_id": None, "slug": "labor-department"}],
        "publication_date": pub, "effective_on": None, "comments_close_on": None, "signing_date": None,
        "cfr_references": [{"chapter": None, "citation_url": None, "part": part, "title": title}] + (extra_refs or []),
        "docket_ids": ["OSHA-2026-0001"], "regulation_id_numbers": ["1218-AD00"],
        "citation": f"{vol} FR {start}", "volume": vol, "start_page": start, "end_page": end or start + 9,
        "page_length": (end or start + 9) - start + 1,
        "html_url": f"https://www.federalregister.gov/documents/{y}/{m}/{d}/{num}/x",
        "pdf_url": f"https://www.govinfo.gov/content/pkg/FR-{pub}/pdf/{num}.pdf",
        "full_text_xml_url": f"https://www.federalregister.gov/documents/full_text/xml/{y}/{m}/{d}/{num}.xml",
        "body_html_url": f"https://www.federalregister.gov/documents/full_text/html/{y}/{m}/{d}/{num}.html",
        "raw_text_url": f"https://www.federalregister.gov/documents/full_text/text/{y}/{m}/{d}/{num}.txt",
    }


HAZCOM = _doc("2026-20001", "2026-11-02", 29, "1910", heading="Hazard Communication: Label Elements",
              abstract="OSHA amends 29 CFR 1910.1200(f) label elements for respirable silica.",
              start=60123, end=60150)
RCRA = _doc("2026-18000", "2026-09-15", 40, "261", heading="Hazardous Waste Identification",
            abstract="EPA revises the definition of solid waste.", start=50010, end=50030)
# Cited by both titles: must be stored once, linked twice.
JOINT = _doc("2026-15000", "2026-07-01", 29, "1910", heading="Joint Hazmat Transport Notice", typ="Notice",
             start=40000, extra_refs=[{"chapter": None, "citation_url": None, "part": "261", "title": 40}])

BODY_XML = (b"<RULE><PREAMB><AGENCY>DEPARTMENT OF LABOR</AGENCY><SUBJECT>Hazard Communication</SUBJECT>"
            b"</PREAMB><SUPLINF><P>Employers must update pictograms under 29 CFR 1910.1200(f)(1) and "
            b"retrain workers on zirconium handling.</P></SUPLINF></RULE>")


class FakeFR:
    """documents.json filtered on conditions[cfr][title] + publication_date window, paged."""

    def __init__(self, docs: list[dict], per_page_override: int | None = None, cap_ranges_wider_than: int | None = None,
                 fail: bool = False, bodies: dict[str, bytes] | None = None,
                 fail_months: tuple[str, ...] = (), throttle: list[httpx.Response] | None = None):
        self.docs = list(docs)
        self.per_page_override = per_page_override
        self.cap_days = cap_ranges_wider_than
        self.fail = fail
        self.bodies = bodies or {}
        self.fail_months = fail_months          # e.g. ("2026-09",): 503 for queries starting that month
        self.throttle = list(throttle or [])    # responses served (in order) before real answers
        self.requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def doc_requests(self) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path == "/api/v1/documents.json"]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            return httpx.Response(500, json={"error": "down"}, request=request)
        if self.throttle:
            r = self.throttle.pop(0)
            return httpx.Response(r.status_code, headers=r.headers, json={"error": "slow down"}, request=request)
        gte = request.url.params.get("conditions[publication_date][gte]", "")
        if any(gte.startswith(m) for m in self.fail_months):
            return httpx.Response(503, json={"error": "unavailable"}, request=request)
        if request.url.path.startswith("/documents/full_text/"):
            num = request.url.path.rsplit("/", 1)[-1].split(".")[0]
            if num in self.bodies:
                return httpx.Response(200, content=self.bodies[num], headers={"content-type": "text/xml"}, request=request)
            return httpx.Response(404, request=request)
        if request.url.path != "/api/v1/documents.json":
            raise AssertionError(f"unexpected request {request.url}")
        p = request.url.params
        title = int(p["conditions[cfr][title]"])
        gte, lte = p["conditions[publication_date][gte]"], p["conditions[publication_date][lte]"]
        rows = [d for d in self.docs
                if gte <= d["publication_date"] <= lte
                and any(int(r["title"]) == title for r in d["cfr_references"])]
        rows.sort(key=lambda d: d["publication_date"])
        count = len(rows)
        if self.cap_days is not None:
            from datetime import date
            span = (date.fromisoformat(lte) - date.fromisoformat(gte)).days
            if span > self.cap_days:
                count = fr_client.RESULT_CAP      # what the API reports for an over-wide query
        per = self.per_page_override or int(p.get("per_page", "20"))
        page = int(p.get("page", "1"))
        chunk = rows[(page - 1) * per: page * per]
        nxt = None
        if page * per < len(rows):
            nxt = str(request.url.copy_set_param("page", str(page + 1)))
        return httpx.Response(200, json={"count": count, "results": chunk, "next_page_url": nxt}, request=request)

    def patch(self):
        fake = self

        def fake_client(extra=None):
            headers = {"User-Agent": fr_client.USER_AGENT, "Accept": "application/json"}
            headers.update(extra or {})
            return httpx.Client(headers=headers, timeout=20.0, follow_redirects=True, transport=fake.transport())

        return mock.patch.object(fr_client, "client", fake_client)


class FrTestCase(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="fr-corpus-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        p = mock.patch.object(config, "DATA_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)
        q = mock.patch.object(fr_build, "log", lambda msg: None)
        q.start()
        self.addCleanup(q.stop)

    def build(self, fake: FakeFR, **kw) -> dict:
        kw.setdefault("titles", [29, 40])
        kw.setdefault("since", "2026-06-01")
        kw.setdefault("until", "2026-11-18")
        kw.setdefault("force", True)
        with fake.patch():
            return fr_build.build(**kw)

    def con(self) -> sqlite3.Connection:
        c = sqlite3.connect(fr_store.db_path())
        c.row_factory = sqlite3.Row
        self.addCleanup(c.close)
        return c


class PureHelperTests(HermeticTestCase):
    def test_month_chunks_cover_window_exactly(self):
        chunks = fr_build.month_chunks("2026-01-15", "2026-03-02")
        self.assertEqual(chunks, [("2026-01-15", "2026-01-31"), ("2026-02-01", "2026-02-28"),
                                  ("2026-03-01", "2026-03-02")])
        self.assertEqual(fr_build.month_chunks("2026-03-03", "2026-03-02"), [])

    def test_split_range(self):
        self.assertEqual(fr_build.split_range("2026-01-01", "2026-01-04"),
                         (("2026-01-01", "2026-01-02"), ("2026-01-03", "2026-01-04")))
        self.assertIsNone(fr_build.split_range("2026-01-01", "2026-01-01"))

    def test_default_window_is_five_years_and_configurable(self):
        from datetime import date
        self.assertEqual(fr_build.default_window(today=date(2026, 11, 19)), ("2021-11-19", "2026-11-19"))
        with mock.patch.dict("os.environ", {"FR_CORPUS_YEARS": "2"}):
            self.assertEqual(fr_build.default_window(today=date(2026, 11, 19))[0], "2024-11-19")
        self.assertEqual(fr_build.default_window(1, today=date(2028, 2, 29))[0], "2027-02-28")

    def test_title_config(self):
        with mock.patch.dict("os.environ", {"FR_CORPUS_TITLES": "40, 29,x,99,40"}):
            self.assertEqual(config.fr_corpus_titles(), [40, 29])
        with mock.patch.object(config, "installed_titles", return_value=[29, 49]):
            self.assertEqual(fr_build.default_titles(), [29, 49])

    def test_news_shares_the_fr_client(self):
        self.assertIs(news.client, fr_client.client)
        self.assertIs(news.SourceUnavailable, fr_client.SourceUnavailable)
        self.assertIs(news.sanitize_fr_html, fr_client.sanitize_fr_html)
        self.assertEqual(news.FR_FIELDS, fr_client.NEWS_FIELDS)

    def test_canonical_hash_is_order_independent(self):
        a = fr_client.sha256_hex(fr_store.canonical_json({"b": 1, "a": [1, 2]}))
        b = fr_client.sha256_hex(fr_store.canonical_json({"a": [1, 2], "b": 1}))
        self.assertEqual(a, b)
        self.assertEqual(len(a), 64)


class BuildTests(FrTestCase):
    def test_build_installs_atomically_with_meta_and_provenance(self):
        fake = FakeFR([HAZCOM, RCRA, JOINT])
        res = self.build(fake)
        self.assertEqual(res["doc_count"], 3)
        self.assertEqual(res["inserted"], 3)
        self.assertTrue(fr_store.db_path().exists())
        self.assertFalse(fr_store.tmp_path().exists())
        self.assertEqual(sorted(p.name for p in self.tmp.iterdir()), ["fr.sqlite3"])
        con = self.con()
        self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], fr_store.SCHEMA_VERSION)
        meta = {r["key"]: r["value"] for r in con.execute("SELECT * FROM meta")}
        self.assertEqual(meta["window_start"], "2026-06-01")
        self.assertEqual(meta["window_end"], "2026-11-18")
        self.assertEqual(json.loads(meta["titles"]), [29, 40])
        self.assertEqual(meta["doc_count"], "3")
        self.assertEqual(meta["source"], "federalregister.gov/api/v1")
        row = con.execute("SELECT * FROM documents WHERE document_number = '2026-20001'").fetchone()
        self.assertEqual(row["raw_sha256"], fr_client.sha256_hex(fr_store.canonical_json(json.loads(row["raw_json"]))))
        self.assertIn("conditions%5Bcfr%5D%5Btitle%5D=29", row["source_url"])
        self.assertEqual((row["volume"], row["start_page"], row["end_page"]), (91, 60123, 60150))
        self.assertEqual(row["agency_slugs"], " labor-department ")
        self.assertEqual(json.loads(row["rins_json"]), ["1218-AD00"])
        self.assertTrue(row["fetched_at"])
        self.assertEqual(row["first_seen_at"], row["content_changed_at"])

    def test_requests_follow_the_corpus_contract(self):
        fake = FakeFR([HAZCOM, RCRA, JOINT])
        self.build(fake)
        reqs = fake.doc_requests()
        # 6 calendar months (Jun-Nov) x 2 titles, one page each
        self.assertEqual(len(reqs), 12)
        first = reqs[0].url.params
        self.assertEqual(first["per_page"], "1000")
        self.assertEqual(first["order"], "oldest")
        self.assertEqual(first.get_list("fields[]"), fr_client.CORPUS_FIELDS)
        self.assertEqual(reqs[0].headers["User-Agent"], "FRAMEWORK-ComplianceReader/1.0 (local-reader)")
        self.assertEqual({r.url.params["conditions[cfr][title]"] for r in reqs}, {"29", "40"})

    def test_cfr_links_dedupe_and_coverage(self):
        self.build(FakeFR([HAZCOM, RCRA, JOINT]))
        con = self.con()
        self.assertEqual(con.execute("SELECT count(*) FROM documents WHERE document_number = '2026-15000'").fetchone()[0], 1)
        joint = {(r["title"], r["part"], r["section"], r["source"]) for r in con.execute(
            "SELECT * FROM document_cfr WHERE document_number = '2026-15000'")}
        self.assertEqual(joint, {(29, "1910", "", "reference"), (40, "261", "", "reference")})
        hazcom = {(r["title"], r["part"], r["section"], r["source"]) for r in con.execute(
            "SELECT * FROM document_cfr WHERE document_number = '2026-20001'")}
        self.assertIn((29, "1910", "1910.1200", "text"), hazcom)
        cov = con.execute("SELECT title, count(*) n, sum(doc_count) s FROM coverage GROUP BY title").fetchall()
        self.assertEqual([(r["title"], r["n"], r["s"]) for r in cov], [(29, 6, 2), (40, 6, 2)])

    def test_paging_follows_next_page_url(self):
        docs = [_doc(f"2026-1{i:04d}", "2026-07-0%d" % (1 + i % 9), 29, "1910", start=100 + i * 10) for i in range(5)]
        fake = FakeFR(docs, per_page_override=2)
        self.build(fake, titles=[29], since="2026-07-01", until="2026-07-31")
        self.assertEqual(len(fake.doc_requests()), 3)
        self.assertEqual(self.con().execute("SELECT count(*) FROM documents").fetchone()[0], 5)

    def test_result_cap_splits_date_ranges(self):
        fake = FakeFR([HAZCOM, JOINT], cap_ranges_wider_than=7)
        self.build(fake, titles=[29], since="2026-07-01", until="2026-07-31")
        windows = [(r.url.params["conditions[publication_date][gte]"], r.url.params["conditions[publication_date][lte]"])
                   for r in fake.doc_requests()]
        self.assertGreater(len(windows), 1)
        from datetime import date
        leaves = [w for w in windows if (date.fromisoformat(w[1]) - date.fromisoformat(w[0])).days <= 7]
        days = set()
        for s, e in leaves:
            d = date.fromisoformat(s)
            while d <= date.fromisoformat(e):
                self.assertNotIn(d, days, "split ranges overlap")
                days.add(d)
                d = d.fromordinal(d.toordinal() + 1)
        self.assertEqual(len(days), 31, "split ranges must cover the month exactly")
        self.assertEqual(self.con().execute("SELECT count(*) FROM documents").fetchone()[0], 1)

    def test_failed_build_keeps_live_corpus_and_staging_for_resume(self):
        self.build(FakeFR([HAZCOM]))
        before = fr_store.db_path().read_bytes()
        with self.assertRaises(fr_client.SourceUnavailable):
            self.build(FakeFR([], fail=True))
        self.assertEqual(fr_store.db_path().read_bytes(), before)
        self.assertTrue(fr_store.tmp_path().exists())       # kept for the next run to resume

    def test_build_without_titles_refuses(self):
        with mock.patch.object(config, "installed_titles", return_value=[]):
            with self.assertRaises(ValueError):
                fr_build.build(force=True)
        self.assertFalse(fr_store.db_path().exists())

    def test_build_without_force_on_existing_corpus_updates(self):
        self.build(FakeFR([HAZCOM]), titles=[29])
        with FakeFR([HAZCOM]).patch():
            res = fr_build.build(titles=[29])
        self.assertEqual(res["mode"], "update")


class RateLimitTests(FrTestCase):
    def test_429_is_retried_honouring_retry_after(self):
        fake = FakeFR([HAZCOM], throttle=[httpx.Response(429, headers={"Retry-After": "30"}),
                                          httpx.Response(429, headers={"Retry-After": "7"})])
        res = self.build(fake, titles=[29], since="2026-11-01", until="2026-11-18")
        self.assertEqual(res["doc_count"], 1)
        self.assertEqual(len(fake.doc_requests()), 3)
        self.assertIn(30.0, self.fr_sleeps)
        self.assertIn(7.0, self.fr_sleeps)

    def test_5xx_backs_off_exponentially_then_gives_up(self):
        fake = FakeFR([], fail=True)
        with fake.patch(), mock.patch("random.uniform", return_value=1.0), \
                self.assertRaises(fr_client.SourceUnavailable) as ctx:
            fr_build.build(titles=[29], since="2026-11-01", until="2026-11-18", force=True)
        self.assertIn("HTTP 500", str(ctx.exception))
        self.assertEqual(len(fake.doc_requests()), fr_client.MAX_RETRIES + 1)
        backoff = [x for x in self.fr_sleeps if x >= 2.0]
        self.assertEqual(backoff, [2.0, 4.0, 8.0, 16.0, 32.0, 64.0])

    def test_backoff_is_capped_and_jittered(self):
        self.assertEqual(fr_client.backoff_delay(10), fr_client.MAX_BACKOFF_SEC)
        self.assertEqual(fr_client.backoff_delay(0, retry_after=900), fr_client.MAX_BACKOFF_SEC)
        for _ in range(20):
            self.assertTrue(1.5 <= fr_client.backoff_delay(0) <= 2.5)

    def test_retry_after_parsing(self):
        now = datetime(2026, 11, 20, 0, 0, 0, tzinfo=timezone.utc)
        self.assertEqual(fr_client.retry_after_seconds("12", now), 12.0)
        self.assertEqual(fr_client.retry_after_seconds("Fri, 20 Nov 2026 00:01:30 GMT", now), 90.0)
        self.assertEqual(fr_client.retry_after_seconds("Thu, 19 Nov 2026 23:00:00 GMT", now), 0.0)
        self.assertIsNone(fr_client.retry_after_seconds("soon", now))
        self.assertIsNone(fr_client.retry_after_seconds(None, now))

    def test_requests_are_paced(self):
        with mock.patch.dict("os.environ", {"FR_MIN_INTERVAL": "1.5"}):
            fr_client.pace()
            fr_client.pace()
        self.assertEqual(len(self.fr_sleeps), 1)
        self.assertTrue(1.4 < self.fr_sleeps[0] <= 1.5)
        with mock.patch.dict("os.environ", {"FR_MIN_INTERVAL": "nonsense"}):
            self.assertEqual(fr_client.min_interval(), fr_client.DEFAULT_MIN_INTERVAL)

    def test_one_request_at_a_time(self):
        fake = FakeFR([HAZCOM, RCRA])
        self.build(fake)
        # sequential: one client, requests in chunk order, never interleaved
        months = [r.url.params["conditions[publication_date][gte]"][:7] for r in fake.doc_requests()]
        self.assertEqual(months[:6], ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"])

    def test_newsroom_keeps_single_attempt(self):
        from tests.news_fixtures import FakeAPI
        fake = FakeAPI(rate_limit_paths=("/api/v1/documents.json",))
        with fake.patch_client(), news.client() as c, self.assertRaises(news.SourceUnavailable):
            news.fetch_federal_register_documents(c, "osha", "2026-11-01")
        self.assertEqual(len(fake.requests_for("/api/v1/documents.json")), 1)


class ResumeTests(FrTestCase):
    def test_interrupted_build_resumes_and_skips_finished_chunks(self):
        docs = [HAZCOM, RCRA, JOINT]
        flaky = FakeFR(docs, fail_months=("2026-09",))
        with flaky.patch(), self.assertRaises(fr_client.SourceUnavailable):
            fr_build.build(titles=[29, 40], since="2026-06-01", until="2026-11-18")
        self.assertFalse(fr_store.db_path().exists())
        self.assertTrue(fr_store.tmp_path().exists())
        self.assertEqual(fr_build.pending_build(), {"titles": [29, 40], "since": "2026-06-01", "until": "2026-11-18"})
        done_before = self.chunk_count()
        self.assertEqual(done_before, 3)                   # Jun-Aug of title 29 finished

        healthy = FakeFR(docs)
        with healthy.patch():
            res = fr_build.build(titles=[29, 40])           # same command, no window: resumes
        self.assertEqual(res["resumed_chunks"], 3)
        months = {(r.url.params["conditions[cfr][title]"], r.url.params["conditions[publication_date][gte]"][:7])
                  for r in healthy.doc_requests()}
        self.assertNotIn(("29", "2026-06"), months)
        self.assertIn(("29", "2026-09"), months)
        self.assertEqual(len(healthy.doc_requests()), 12 - 3)
        self.assertTrue(fr_store.db_path().exists())
        self.assertFalse(fr_store.tmp_path().exists())
        meta = fr_store.read_meta()
        self.assertNotIn("pending_build", meta)
        self.assertEqual((meta["window_start"], meta["window_end"]), ("2026-06-01", "2026-11-18"))
        self.assertEqual(meta["doc_count"], "3")

    def test_force_starts_clean(self):
        with FakeFR([HAZCOM], fail_months=("2026-09",)).patch(), self.assertRaises(fr_client.SourceUnavailable):
            fr_build.build(titles=[29], since="2026-06-01", until="2026-11-18")
        fake = FakeFR([HAZCOM])
        with fake.patch():
            res = fr_build.build(titles=[29], since="2026-06-01", until="2026-11-18", force=True)
        self.assertEqual(res["resumed_chunks"], 0)
        self.assertEqual(len(fake.doc_requests()), 6)

    def test_different_titles_discard_the_pending_build(self):
        with FakeFR([HAZCOM], fail_months=("2026-09",)).patch(), self.assertRaises(fr_client.SourceUnavailable):
            fr_build.build(titles=[29], since="2026-06-01", until="2026-11-18")
        fake = FakeFR([RCRA])
        with fake.patch():
            res = fr_build.build(titles=[40], since="2026-06-01", until="2026-11-18")
        self.assertEqual(res["resumed_chunks"], 0)
        self.assertEqual(fr_store.read_meta()["titles"], "[40]")

    def test_progress_lines_per_chunk(self):
        lines: list[str] = []
        with mock.patch.object(fr_build, "log", lines.append):
            self.build(FakeFR([HAZCOM]), titles=[29], since="2026-10-01", until="2026-11-18")
        self.assertIn("title 29 2026-10: 0 docs (1/2)", lines)
        self.assertIn("title 29 2026-11: 1 docs (2/2)", lines)

    def chunk_count(self) -> int:
        c = sqlite3.connect(fr_store.tmp_path())
        try:
            return c.execute("SELECT count(*) FROM build_chunks").fetchone()[0]
        finally:
            c.close()


class UpdateTests(FrTestCase):
    def test_update_detects_changes_by_hash_and_keeps_first_seen(self):
        late29 = _doc("2026-20900", "2026-11-16", 29, "1910", heading="Silica Notice", start=60900)
        late40 = _doc("2026-20950", "2026-11-17", 40, "261", heading="Waste Notice", start=60950)
        self.build(FakeFR([HAZCOM, late29, late40]), titles=[29, 40])
        con = self.con()
        first = con.execute("SELECT first_seen_at, raw_sha256 FROM documents WHERE document_number='2026-20900'").fetchone()
        con.close()
        amended = {**late29, "abstract": "OSHA corrects the effective date."}
        new = _doc("2026-21000", "2026-11-18", 29, "1910", heading="Silica Correction", start=61000)
        fake = FakeFR([HAZCOM, amended, late40, new])
        now = datetime(2026, 11, 19, 15, 0, tzinfo=timezone.utc)
        with fake.patch(), mock.patch.object(fr_store, "now_iso", return_value="2026-11-19T15:00:00+00:00"):
            res = fr_build.update(now=now)
        self.assertEqual((res["inserted"], res["changed"]), (1, 1))
        self.assertEqual(res["unchanged"], 1)
        # each title re-reads from its last covered day minus the overlap, not the whole window
        gtes = {r.url.params["conditions[publication_date][gte]"] for r in fake.doc_requests()}
        self.assertEqual(min(gtes), "2026-11-15")
        con = self.con()
        row = con.execute("SELECT * FROM documents WHERE document_number='2026-20900'").fetchone()
        self.assertEqual(row["first_seen_at"], first["first_seen_at"])
        self.assertNotEqual(row["raw_sha256"], first["raw_sha256"])
        self.assertEqual(row["content_changed_at"], "2026-11-19T15:00:00+00:00")
        meta = {r["key"]: r["value"] for r in con.execute("SELECT * FROM meta")}
        self.assertEqual(meta["window_end"], "2026-11-19")
        self.assertEqual(meta["doc_count"], "4")
        # HAZCOM (2026-11-02) is outside the overlap window: not re-read, not touched
        self.assertNotIn("2026-11-02", {r.url.params["conditions[publication_date][lte]"] for r in fake.doc_requests()})

    def test_update_backfills_a_newly_added_title(self):
        self.build(FakeFR([HAZCOM]), titles=[29], since="2026-06-01", until="2026-11-18")
        fake = FakeFR([HAZCOM, RCRA])
        with fake.patch():
            fr_build.update(titles=[29, 40], now=datetime(2026, 11, 19, 15, tzinfo=timezone.utc))
        t40 = [r for r in fake.doc_requests() if r.url.params["conditions[cfr][title]"] == "40"]
        self.assertEqual(t40[0].url.params["conditions[publication_date][gte]"], "2026-06-01")
        meta = fr_store.read_meta()
        self.assertEqual(json.loads(meta["titles"]), [29, 40])

    def test_update_requires_a_corpus(self):
        with self.assertRaises(ValueError):
            fr_build.update()

    def test_failure_is_recorded_for_backoff(self):
        self.build(FakeFR([HAZCOM]), titles=[29])
        job = {"kind": "fr-update", "target": None}
        with FakeFR([], fail=True).patch(), self.assertRaises(fr_client.SourceUnavailable):
            fr_build.run_job(job, lambda *a, **k: None)
        meta = fr_store.read_meta()
        self.assertEqual(meta["fail_count"], "1")
        self.assertIn("HTTP 500", meta["last_error"])


class ScheduleTests(FrTestCase):
    def test_never_due_without_a_corpus(self):
        self.assertFalse(fr_build.is_due(datetime(2026, 11, 19, 15, tzinfo=timezone.utc)))
        self.assertIsNone(fr_build.maybe_queue_update(datetime(2026, 11, 19, 15, tzinfo=timezone.utc)))

    def test_due_after_the_morning_issue_with_backoff(self):
        # Thursday 2026-11-19: last ok at 05:00 ET (10:00Z), the 06:15 ET window passes at 11:15Z
        meta = {"last_ok_at": "2026-11-19T10:00:00+00:00", "fail_count": "0"}
        self.assertFalse(fr_build.is_due(datetime(2026, 11, 19, 11, 0, tzinfo=timezone.utc), meta=meta))
        self.assertTrue(fr_build.is_due(datetime(2026, 11, 19, 11, 30, tzinfo=timezone.utc), meta=meta))
        failing = {**meta, "fail_count": "2", "last_error_at": "2026-11-19T11:20:00+00:00"}
        self.assertFalse(fr_build.is_due(datetime(2026, 11, 19, 11, 30, tzinfo=timezone.utc), meta=failing))
        self.assertTrue(fr_build.is_due(datetime(2026, 11, 19, 11, 40, tzinfo=timezone.utc), meta=failing))

    def test_maybe_queue_update_submits_once(self):
        self.build(FakeFR([HAZCOM]), titles=[29])
        with closing(fr_store.connect()) as con:
            fr_store.set_meta(con, {"last_ok_at": "2026-11-19T10:00:00+00:00"})
            con.commit()
        q = mock.Mock()
        q.busy_with.return_value = False
        q.submit.return_value = {"id": 1}
        with mock.patch.object(library, "queue", q):
            self.assertEqual(fr_build.maybe_queue_update(datetime(2026, 11, 19, 12, tzinfo=timezone.utc)), {"id": 1})
            q.submit.assert_called_once_with(fr_build.FR_JOB_TITLE, "fr-update", None, "Update Federal Register corpus")
            q.busy_with.return_value = True
            self.assertIsNone(fr_build.maybe_queue_update(datetime(2026, 11, 19, 12, tzinfo=timezone.utc)))

    def test_library_run_job_dispatches_fr_kinds(self):
        with mock.patch.object(fr_build, "run_job") as run:
            library.run_job({"kind": "fr-update", "title": 0, "target": None}, None)
        run.assert_called_once()


class BodyTests(FrTestCase):
    def test_fetch_body_stores_hash_text_links_and_indexes(self):
        fake = FakeFR([HAZCOM], bodies={"2026-20001": BODY_XML})
        self.build(fake, titles=[29])
        with fake.patch():
            res = fr_build.fetch_body("2026-20001")
        self.assertEqual(res["format"], "xml")
        self.assertEqual(res["sha256"], fr_client.sha256_hex(BODY_XML))
        self.assertEqual(res["byte_len"], len(BODY_XML))
        con = self.con()
        body = con.execute("SELECT * FROM document_bodies").fetchone()
        self.assertIn("retrain workers on zirconium handling", body["text"])
        self.assertTrue(body["source_url"].startswith("https://www.federalregister.gov/documents/full_text/xml/"))
        self.assertIn((29, "1910", "1910.1200", "body"), {
            (r["title"], r["part"], r["section"], r["source"]) for r in con.execute("SELECT * FROM document_cfr")})
        con.close()
        with fr_store.read_con() as rc:
            hits = fr_store.search(rc, "zirconium")
        self.assertEqual([h["document_number"] for h in hits["results"]], ["2026-20001"])

    def test_fetch_body_guards(self):
        self.build(FakeFR([HAZCOM]), titles=[29])
        with self.assertRaises(ValueError):
            fr_build.fetch_body("../etc/passwd")
        with self.assertRaises(LookupError):
            fr_build.fetch_body("2099-00001")
        with closing(fr_store.connect()) as con:
            con.execute("UPDATE documents SET full_text_xml_url = 'https://evil.example/x.xml'")
            con.commit()
        with FakeFR([]).patch(), self.assertRaises(ValueError):
            fr_build.fetch_body("2026-20001")


class ApiTests(FrTestCase):
    def setUp(self):
        super().setUp()
        from app.main import app
        self.client = TestClient(app)

    def test_empty_install_is_empty_safe_and_creates_nothing(self):
        st = self.client.get("/api/fr/status")
        self.assertEqual(st.status_code, 200)
        self.assertEqual(st.headers["cache-control"], "no-store")
        self.assertFalse(st.json()["installed"])
        self.assertEqual(self.client.get("/api/fr/search", params={"q": "silica"}).json(),
                         {"installed": False, "total": 0, "results": []})
        self.assertEqual(self.client.get("/api/fr/by-cfr/29/1910").json()["total"], 0)
        self.assertEqual(self.client.get("/api/fr/document/2026-20001").status_code, 404)
        self.assertFalse(fr_store.db_path().exists())

    def test_reads_after_build(self):
        self.build(FakeFR([HAZCOM, RCRA, JOINT]))
        r = self.client.get("/api/fr/search", params={"q": "label elements"}).json()
        self.assertEqual(r["results"][0]["document_number"], "2026-20001")
        self.assertIn("\x02", r["results"][0]["snippet"])
        r = self.client.get("/api/fr/search", params={"q": "2026-18000"}).json()
        self.assertTrue(r["results"][0]["exact"])
        r = self.client.get("/api/fr/search", params={"q": "91 FR 60130"}).json()
        self.assertEqual(r["results"][0]["document_number"], "2026-20001")
        r = self.client.get("/api/fr/search", params={"type": "Notice"}).json()
        self.assertEqual([x["document_number"] for x in r["results"]], ["2026-15000"])
        r = self.client.get("/api/fr/search", params={"title": 40}).json()
        self.assertEqual({x["document_number"] for x in r["results"]}, {"2026-18000", "2026-15000"})
        r = self.client.get("/api/fr/search", params={"agency": "labor-department", "since": "2026-10-01"}).json()
        self.assertEqual([x["document_number"] for x in r["results"]], ["2026-20001"])

        doc = self.client.get("/api/fr/document/2026-20001").json()
        self.assertEqual(doc["citation"], "91 FR 60123")
        self.assertEqual(doc["regulation_id_numbers"], ["1218-AD00"])
        self.assertEqual(len(doc["provenance"]["raw_sha256"]), 64)
        self.assertIsNone(doc["body"])
        self.assertIn({"title": 29, "part": "1910", "section": "1910.1200", "sources": "text"}, doc["cfr_links"])

        part = self.client.get("/api/fr/by-cfr/29/1910").json()
        self.assertEqual([x["document_number"] for x in part["results"]], ["2026-20001", "2026-15000"])
        sec = self.client.get("/api/fr/by-cfr/29/1910/1910.1200").json()
        self.assertEqual(sec["total"], 2)  # exact section link + part-level reference
        self.assertEqual(self.client.get("/api/fr/by-cfr/29/1910/1926.50").status_code, 422)
        self.assertEqual(self.client.get("/api/fr/by-cfr/51/1").status_code, 422)

    def test_federated_search_include_fr(self):
        self.build(FakeFR([HAZCOM]), titles=[29])
        with mock.patch.object(config, "installed_titles", return_value=[]):
            plain = self.client.get("/api/search", params={"q": "silica", "title": "all"}).json()
            self.assertNotIn("fr", plain)
            both = self.client.get("/api/search", params={"q": "silica", "title": "all", "include": "fr"}).json()
        self.assertEqual(both["fr"]["results"][0]["document_number"], "2026-20001")
        self.assertEqual(self.client.get("/api/search", params={"q": "x", "include": "cfr"}).status_code, 422)

    def test_writes_queue_on_the_library_queue(self):
        q = mock.Mock()
        q.submit.return_value = {"id": 7, "kind": "fr-build"}
        with mock.patch.object(library, "queue", q), \
                mock.patch.object(config, "installed_titles", return_value=[29, 40]):
            r = self.client.post("/api/fr/build", json={"years": 2})
            self.assertEqual(r.status_code, 200)
            q.submit.assert_called_with(0, "fr-build", {"titles": [29, 40], "years": 2}, "Build Federal Register corpus")
            self.client.post("/api/fr/update")
            q.submit.assert_called_with(0, "fr-update", None, "Update Federal Register corpus")
        with mock.patch.object(config, "installed_titles", return_value=[]):
            self.assertEqual(self.client.post("/api/fr/build", json={}).status_code, 422)

    def test_body_endpoint_maps_errors(self):
        self.build(FakeFR([HAZCOM]), titles=[29])
        self.assertEqual(self.client.post("/api/fr/document/2099-00001/body").status_code, 404)
        with FakeFR([], fail=True).patch():
            self.assertEqual(self.client.post("/api/fr/document/2026-20001/body").status_code, 503)
        fake = FakeFR([], bodies={"2026-20001": BODY_XML})
        with fake.patch():
            r = self.client.post("/api/fr/document/2026-20001/body")
        self.assertEqual(r.status_code, 200)
        doc = self.client.get("/api/fr/document/2026-20001", params={"body": "true"}).json()
        self.assertEqual(doc["body"]["sha256"], fr_client.sha256_hex(BODY_XML))
        self.assertIn("zirconium", doc["body"]["text"])


if __name__ == "__main__":
    import unittest
    unittest.main()
