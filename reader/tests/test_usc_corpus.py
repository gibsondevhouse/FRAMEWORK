"""U.S. Code ingestion: usc_client / ingest.uslm / usc_store / usc_build / /api/usc.

Hermetic: `config.DATA_DIR` is a temp dir and `usc_client.client` is patched to an
`httpx.MockTransport` (`FakeOLRC`) serving a download page and a small USLM zip shaped like
the OLRC's (namespaces, meta, chapters, notes with crossHeadings, quotedContent, xhtml
tables), verified against Titles 1 and 4 at release point 119-142 on 2026-11-19.
"""
from __future__ import annotations

import io
import json
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import httpx
from fastapi.testclient import TestClient

from app import config, library, store, usc_build, usc_client, usc_store
from app.ingest import uslm
from app.render import uslm_html
from app import usc_citations
from app.routers import usc as usc_router_mod
from app.render.linkifier import make_linkifier
from tests.base import HermeticTestCase

USLM_T4 = """<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:html="http://www.w3.org/1999/xhtml"
        identifier="/us/usc/t4">
<meta><dc:title>Title 4</dc:title><docNumber>4</docNumber>
<docPublicationName>Online@{rp}</docPublicationName><property role="is-positive-law">yes</property></meta>
<main>
<title identifier="/us/usc/t4"><num value="4">Title 4—</num><heading>FLAG AND SEAL, SEAT OF GOVERNMENT, AND THE STATES</heading>
<note topic="enacting"><p>This title was enacted by act July 30, 1947.</p></note>
<toc><tocItem><ref href="/us/usc/t4/ch1">1.</ref></tocItem></toc>
<chapter identifier="/us/usc/t4/ch1"><num value="1">CHAPTER 1—</num><heading>THE FLAG</heading>
<section identifier="/us/usc/t4/s1"><num value="1">§ 1.</num><heading> Flag; stripes and stars on</heading>
<content><p>The flag of the United States shall be thirteen horizontal stripes, alternate red and white.</p></content>
<sourceCredit>(<ref href="/us/act/1947-07-30/ch389">July 30, 1947, ch. 389</ref>, <ref href="/us/stat/61/642">61 Stat. 642</ref>.)</sourceCredit>
<notes type="uscNote">
<note role="crossHeading" topic="editorialNotes"><heading><b>Editorial Notes</b></heading></note>
<note topic="amendments"><heading>Amendments</heading><p>2018—Pub. L. 115–123 amended <ref href="/us/usc/t4/s7">section 7 of this title</ref>.</p></note>
<note role="crossHeading" topic="statutoryNotes"><heading><b>Statutory Notes and Related Subsidiaries</b></heading></note>
<note topic="shortTitleOfAmendment"><heading>Short Title of 2018 Amendment</heading>
<p>Pub. L. 115–123 provided that: <quotedContent origin="/us/pl/115/123">
<section identifier="/us/pl/115/123/s99"><num value="99">SEC. 99.</num><heading>Quoted section</heading><content><p>This Act may be cited as the Hometown Heroes Act.</p></content></section>
</quotedContent></p></note>
</notes>
</section>
<section identifier="/us/usc/t4/s2" status="repealed"><num value="2">[§ 2.</num><heading> Repealed. Pub. L. 98-1]</heading>
<sourceCredit>(July 30, 1947.)</sourceCredit></section>
<section identifier="/us/usc/t4/s7"><num value="7">§ 7.</num><heading> Position and manner of display</heading>
<chapeau>The flag, when carried in a procession—</chapeau>
<subsection identifier="/us/usc/t4/s7/a"><num value="a">(a)</num><content>should not be displayed on a float, except from a staff; and</content></subsection>
<subsection identifier="/us/usc/t4/s7/b"><num value="b">(b)</num><heading>Wind</heading><content>should be hoisted briskly, as provided in <ref href="/us/usc/t4/s1">section 1 of this title</ref> and <ref href="/us/usc/t36/s301">section 301 of title 36</ref>.</content></subsection>
<html:table><html:tr><html:th colspan="2">Hours</html:th></html:tr><html:tr><html:td>Sunrise</html:td><html:td onclick="x()">Sunset</html:td></html:tr></html:table>
</section>
<notes type="uscNote"><note topic="miscellaneous"><heading>Chapter note</heading><p>Zebra crossing provisions.</p></note></notes>
</chapter>
<chapter identifier="/us/usc/t4/ch2"><num value="2">CHAPTER 2—</num><heading>THE SEAL</heading>
<section identifier="/us/usc/t4/s41"><num value="41">§ 41.</num><heading> Omitted</heading><content><p>Section omitted as obsolete.</p></content></section>
</chapter>
</title>
</main>
</uscDoc>
"""

DOWNLOAD_HTML = """<html><body><h2>Current Release Point</h2>
<p>The United States Code Online is current through Public Law {rp} (November 10, 2026).</p>
<a href="download/releasepoints/us/pl/{c}/{l}/xml_usc01@{rp}.zip">Title 1</a>
<a href="download/releasepoints/us/pl/{c}/{l}/xml_usc04@{rp}.zip">Title 4</a>
<a href="download/releasepoints/us/pl/{c}/{l}/xml_usc05a@{rp}.zip">Title 5 Appendix</a>
<a href="download/releasepoints/us/pl/{c}/{l}/htm_usc04@{rp}.zip">htm</a>
<a href="download/releasepoints/us/pl/{c}/{l}/xml_uscAll@{rp}.zip">All</a>
</body></html>"""


def make_zip(xml: str, name: str = "usc04.xml", extra: dict[str, bytes] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(name, xml.encode("utf-8"))
        for k, v in (extra or {}).items():
            zf.writestr(k, v)
    return buf.getvalue()


class FakeOLRC:
    def __init__(self, rp: str = "119-142", zips: dict[str, bytes] | None = None, page_status: int = 200):
        self.rp = rp
        c, l = rp.split("-")
        self.page = DOWNLOAD_HTML.format(rp=rp, c=c, l=l)
        self.zips = zips if zips is not None else {"04": make_zip(USLM_T4.replace("{rp}", rp))}
        self.page_status = page_status
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path in ("/download.html", "/download/download.shtml"):
            if path == "/download/download.shtml" or self.page_status != 200:
                return httpx.Response(404, text="gone", request=request)
            return httpx.Response(200, text=self.page, request=request)
        if path.endswith(".zip") and "/xml_usc" in path:
            num = path.rsplit("xml_usc", 1)[1][:2]
            if num in self.zips:
                return httpx.Response(200, content=self.zips[num], request=request)
            return httpx.Response(404, request=request)
        raise AssertionError(f"unexpected request {request.url}")

    def patch(self):
        fake = self

        def fake_client():
            return httpx.Client(headers={"User-Agent": usc_client.USER_AGENT}, follow_redirects=True,
                                transport=httpx.MockTransport(fake.handler))

        return mock.patch.object(usc_client, "client", fake_client)


class UscTestCase(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="usc-corpus-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        p = mock.patch.object(config, "DATA_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)
        q = mock.patch.object(usc_build, "log", lambda msg: None)
        q.start()
        self.addCleanup(q.stop)
        usc_client.clear_cache()
        usc_build.reset_schedule()
        usc_store.clear_caches()
        self.addCleanup(usc_client.clear_cache)
        self.addCleanup(usc_build.reset_schedule)
        self.addCleanup(usc_store.clear_caches)
        self.addCleanup(store.clear_caches)

    def install(self, fake: FakeOLRC | None = None) -> dict:
        fake = fake or FakeOLRC()
        with fake.patch():
            return usc_build.build(4, force=True)


class ReleaseDiscoveryTests(UscTestCase):
    def test_parse_release_page(self):
        info = usc_client.parse_release_page(FakeOLRC().page, "https://uscode.house.gov/download.html")
        self.assertEqual(info["release_point"], "119-142")
        self.assertEqual((info["congress"], info["law"]), (119, "142"))
        self.assertEqual(info["current_through"], "November 10, 2026")
        self.assertEqual(sorted(info["titles"], key=int), ["1", "4", "105"])   # 5a = 105; htm + All ignored
        self.assertTrue(info["titles"]["105"].endswith("/xml_usc05a@119-142.zip"))
        self.assertEqual(info["titles"]["4"],
                         "https://uscode.house.gov/download/releasepoints/us/pl/119/142/xml_usc04@119-142.zip")
        self.assertIsNone(usc_client.parse_release_page("<html>nothing</html>", "x"))

    def test_suffixed_release_ids_are_kept_verbatim(self):
        info = usc_client.parse_release_page(FakeOLRC(rp="118-200not159").page, "x")
        self.assertEqual(info["release_point"], "118-200not159")

    def test_current_release_is_cached_and_reports_failures(self):
        fake = FakeOLRC()
        with fake.patch():
            usc_client.current_release()
            usc_client.current_release()
        self.assertEqual(len([r for r in fake.requests if r.url.path == "/download.html"]), 1)
        self.assertEqual(fake.requests[0].headers["User-Agent"], "FRAMEWORK-ComplianceReader/1.0 (local-reader)")
        usc_client.clear_cache()
        with FakeOLRC(page_status=500).patch(), self.assertRaises(usc_client.SourceUnavailable):
            usc_client.current_release()

    def test_download_refuses_other_hosts(self):
        with httpx.Client() as c, self.assertRaises(ValueError):
            usc_client.download(c, "https://evil.example/x.zip", self.tmp / "x.zip")


class ParserTests(UscTestCase):
    def parse(self):
        p = self.tmp / "usc04.xml"
        p.write_text(USLM_T4.replace("{rp}", "119-142"), encoding="utf-8")
        secs: list[dict] = []
        cont: list[tuple] = []
        info, tree = uslm.parse_title(p, secs.append, lambda o, k, n: cont.append((o, k, n)))
        return info, tree, secs, cont

    def test_sections_status_and_quoted_content(self):
        info, tree, secs, _ = self.parse()
        self.assertEqual(info, {"number": "4", "name": "FLAG AND SEAL, SEAT OF GOVERNMENT, AND THE STATES",
                                "publication": "Online@119-142", "positive_law": True})
        self.assertEqual([s["id"] for s in secs], ["1", "2", "7", "41"])   # quoted § 99 is not a section
        by = {s["id"]: s for s in secs}
        self.assertEqual(by["2"]["status"], "repealed")
        self.assertEqual(by["41"]["status"], "omitted")                  # from the heading
        self.assertIsNone(by["1"]["status"])
        self.assertEqual(by["7"]["chapter"], "ch1")
        self.assertEqual(by["41"]["path"], [{"t": "chapter", "id": "ch2", "l": "CHAPTER 2", "d": "THE SEAL"}])
        self.assertEqual(by["1"]["source_credit"], "( July 30, 1947, ch. 389 , 61 Stat. 642 .)")
        self.assertNotIn("Stat.", by["1"]["text"])
        self.assertNotIn("xmlns", by["1"]["xml"])
        self.assertTrue(by["1"]["xml"].startswith("<section"))

    def test_notes_are_split_from_text_by_crossheading(self):
        _, _, secs, cont = self.parse()
        s1 = secs[0]
        self.assertNotIn("Hometown Heroes", s1["text"])
        self.assertNotIn("<notes", s1["xml"])
        self.assertEqual([(n["category"], n["topic"]) for n in s1["notes"]],
                         [("editorial", "amendments"), ("statutory", "shortTitleOfAmendment")])
        self.assertIn("Hometown Heroes Act", s1["notes"][1]["text"])
        owners = [(o, k, [n["topic"] for n in notes]) for o, k, notes in cont]
        self.assertIn(("/us/usc/t4/ch1", "chapter", ["miscellaneous"]), owners)
        self.assertIn(("/us/usc/t4", "title", ["enacting"]), owners)

    def test_tree(self):
        _, tree, _, _ = self.parse()
        self.assertEqual((tree["t"], tree["id"], tree["l"]), ("title", "t4", "Title 4"))
        self.assertEqual([c["id"] for c in tree["c"]], ["ch1", "ch2"])
        self.assertEqual(tree["c"][0]["c"][1], {"t": "section", "id": "2", "l": "§ 2",
                                                "d": "Repealed. Pub. L. 98-1]", "s": "repealed"})

    def test_short_id(self):
        self.assertEqual(uslm.short_id("/us/usc/t42/s2000e-2"), "2000e-2")
        self.assertEqual(uslm.short_id("/us/usc/t4/ch1"), "ch1")
        self.assertEqual(uslm.short_id("/us/usc/t4/subtitleA"), "subtitleA")


class BuildTests(UscTestCase):
    def test_build_installs_atomically_with_provenance(self):
        zip_bytes = make_zip(USLM_T4.replace("{rp}", "119-142"))
        res = self.install(FakeOLRC(zips={"04": zip_bytes}))
        self.assertEqual((res["section_count"], res["note_count"]), (4, 4))
        names = sorted(p.name for p in self.tmp.iterdir())
        self.assertEqual(names, ["usc-4.sqlite3", "usc-tree-4.json"])
        con = sqlite3.connect(usc_store.db_path(4))
        self.addCleanup(con.close)
        meta = dict(con.execute("SELECT key, value FROM meta"))
        import hashlib
        self.assertEqual(meta["zip_sha256"], hashlib.sha256(zip_bytes).hexdigest())
        self.assertEqual(meta["xml_sha256"], hashlib.sha256(USLM_T4.replace("{rp}", "119-142").encode()).hexdigest())
        self.assertEqual(meta["release_point"], "119-142")
        self.assertEqual(meta["source_url"],
                         "https://uscode.house.gov/download/releasepoints/us/pl/119/142/xml_usc04@119-142.zip")
        self.assertEqual(meta["section_count"], "4")
        self.assertEqual(meta["positive_law"], "1")
        self.assertEqual(con.execute("SELECT count(*) FROM notes WHERE owner_kind = 'section'").fetchone()[0], 2)
        self.assertEqual(json.loads(usc_store.tree_path(4).read_text())["c"][0]["id"], "ch1")

    def test_failed_build_keeps_live_copy_and_cleans_up(self):
        self.install()
        before = usc_store.db_path(4).read_bytes()
        bad = FakeOLRC(zips={"04": make_zip("<uscDoc xmlns='http://xml.house.gov/schemas/uslm/1.0'><main/></uscDoc>")})
        with bad.patch(), self.assertRaises(ValueError):
            usc_build.build(4, force=True)
        self.assertEqual(usc_store.db_path(4).read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.tmp.iterdir()), ["usc-4.sqlite3", "usc-tree-4.json"])

    def test_zip_checks(self):
        with FakeOLRC(zips={"04": make_zip(USLM_T4, extra={"usc04b.xml": b"<x/>"})}).patch(), \
                self.assertRaises(ValueError):
            usc_build.build(4, force=True)
        wrong = make_zip(USLM_T4.replace("{rp}", "119-142").replace("<docNumber>4", "<docNumber>1"))
        usc_client.clear_cache()
        with FakeOLRC(zips={"04": wrong}).patch(), self.assertRaises(ValueError):
            usc_build.build(4, force=True)
        self.assertFalse(usc_store.db_path(4).exists())
        with self.assertRaises(ValueError):
            usc_build.valid_title(53)

    def test_existing_title_is_not_rebuilt_without_force(self):
        self.install()
        with FakeOLRC().patch():
            self.assertTrue(usc_build.build(4)["cached"])

    def test_install_clears_render_caches(self):
        with mock.patch.object(store, "clear_caches") as cc:
            self.install()
        cc.assert_called()


class StalenessAndQueueTests(UscTestCase):
    def test_status_and_outdated(self):
        self.install(FakeOLRC(rp="119-140"))
        rel = usc_client.parse_release_page(FakeOLRC(rp="119-142").page, "x")
        st = usc_build.status(rel)
        self.assertEqual([(t["title"], t["release_point"], t["stale"]) for t in st["titles"]], [(4, "119-140", True)])
        self.assertEqual(usc_build.outdated(rel), [4])
        self.assertEqual(usc_build.outdated(usc_client.parse_release_page(FakeOLRC(rp="119-140").page, "x")), [])

    def test_run_job_skips_current_and_rebuilds_stale(self):
        self.install(FakeOLRC(rp="119-140"))
        steps = []
        with FakeOLRC(rp="119-140").patch():
            usc_client.clear_cache()
            usc_build.run_job({"kind": "usc-update", "title": 1004, "target": {"usc_title": 4}},
                              lambda *a, **k: steps.append(a))
        self.assertEqual(steps[-1][0], "Already installed")
        with FakeOLRC(rp="119-142").patch():
            usc_client.clear_cache()
            usc_build.run_job({"kind": "usc-update", "title": 1004, "target": {"usc_title": 4}}, lambda *a, **k: None)
        self.assertEqual(usc_store.title_summary(4)["release_point"], "119-142")

    def test_update_job_requires_installed_title(self):
        with FakeOLRC().patch(), self.assertRaises(ValueError):
            usc_build.run_job({"kind": "usc-update", "title": 1004, "target": {"usc_title": 4}}, lambda *a, **k: None)

    def test_library_run_job_dispatches_usc_kinds(self):
        with mock.patch.object(usc_build, "run_job") as run:
            library.run_job({"kind": "usc-title", "title": 1004, "target": {"usc_title": 4}}, None)
        run.assert_called_once()

    def test_daily_check_never_first_installs_and_runs_once_a_day(self):
        q = mock.Mock()
        q.submit.side_effect = lambda *a: {"args": a}
        now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
        fake = FakeOLRC(rp="119-142")
        with mock.patch.object(library, "queue", q), fake.patch():
            self.assertIsNone(usc_build.maybe_queue_updates(now))     # nothing installed
            self.assertEqual(fake.requests, [])
        self.install(FakeOLRC(rp="119-140"))
        with mock.patch.object(library, "queue", q), fake.patch():
            res = usc_build.maybe_queue_updates(now)
            self.assertEqual(res["count"], 1)
            q.submit.assert_called_with(1004, "usc-update", {"usc_title": 4}, "Update U.S. Code Title 4")
            self.assertIsNone(usc_build.maybe_queue_updates(now + timedelta(hours=23)))
            self.assertIsNotNone(usc_build.maybe_queue_updates(now + timedelta(hours=25)))

    def test_daily_check_backs_off_after_failure(self):
        self.install()
        now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
        with FakeOLRC(page_status=500).patch():
            self.assertIsNone(usc_build.maybe_queue_updates(now))
        q = mock.Mock()
        with mock.patch.object(library, "queue", q), FakeOLRC().patch():
            self.assertIsNone(usc_build.maybe_queue_updates(now + timedelta(hours=5)))
            self.assertEqual(usc_build.maybe_queue_updates(now + timedelta(hours=7))["count"], 0)


class CitationParsingTests(UscTestCase):
    def test_cites_matches_title_and_section_exactly(self):
        text = "Authority: 16 U.S.C. 1532(5)(A), 1533; 16 U.S.C. 15320; 42 U.S.C. 1532."
        self.assertEqual(usc_citations._cites(text, 16, "1532"), ["(5)(A)"])
        self.assertEqual(usc_citations._cites(text, 16, "1533"), [""])
        self.assertEqual(usc_citations._cites(text, 16, "1534"), [])


class RenderAndLinkTests(UscTestCase):
    def test_renderer_is_allowlisted(self):
        self.install()
        d = usc_store.get_section(4, "7")
        html = uslm_html.render_body(d["xml"])
        # Levels render as the CFR reader's flat paragraphs (marker, run-in heading, deterministic id).
        self.assertIn('<p class="reg-p" id="p1">The flag, when carried in a procession—</p>', html)
        self.assertIn('<p class="reg-p lvl-1" id="p2"><span class="pmark">(a)</span> should not be displayed', html)
        self.assertIn('<p class="reg-p lvl-1" id="p3"><span class="pmark">(b)</span> <strong class="runin">Wind</strong> should be hoisted', html)
        self.assertNotIn("usc-level", html)
        self.assertIn('<div class="table-wrap"><table class="reg-table">', html)
        self.assertIn('<th colspan="2">Hours</th>', html)
        self.assertNotIn("onclick", html)
        self.assertNotIn("§ 7.", html)                                 # num/heading come from the payload
        self.assertIn('href="/usc/4/1"', html)                         # installed → local
        self.assertIn('href="https://www.law.cornell.edu/uscode/text/36/301"', html)   # not installed → Cornell

    def test_nested_levels_flatten_to_cfr_paragraphs(self):
        xml = ('<section><num>§ 9.</num><heading>H</heading><subsection><num>(a)</num><heading>In general.—</heading>'
               '<chapeau>lead</chapeau><paragraph><num>(1)</num><content><p>one</p><p>more</p></content></paragraph>'
               '<paragraph><num>(2)</num><subparagraph><num>(A)</num><content>deep</content></subparagraph></paragraph>'
               '<continuation>after</continuation></subsection><subsection><num>(b)</num><content>bee'
               '<quotedContent><subsection><num>(z)</num><content>quoted</content></subsection></quotedContent>'
               '</content></subsection><sourceCredit>(Pub. L. 1.)</sourceCredit></section>')
        html = uslm_html.render_body(xml)
        self.assertIn('<p class="reg-p lvl-1" id="p1"><span class="pmark">(a)</span> <strong class="runin">In general.—</strong> lead</p>', html)
        self.assertIn('<p class="reg-p lvl-2" id="p2"><span class="pmark">(1)</span> one</p>', html)
        self.assertIn('<p class="reg-p lvl-2" id="p3">more</p>', html)
        # A number with no text of its own folds into its first child, as eCFR writes "(5)(A)".
        self.assertIn('<p class="reg-p lvl-2" id="p4"><span class="pmark">(2)(A)</span> deep</p>', html)
        self.assertIn('<p class="reg-p lvl-1 reg-continuation" id="p5">after</p>', html)
        # Quoted (amending) text is not flattened into this section's own paragraphs.
        self.assertIn('<blockquote class="usc-quotedContent"><div class="usc-level usc-subsection">', html)
        self.assertIn('<p class="usc-sourceCredit">(Pub. L. 1.)</p>', html)

    def test_units_follow_top_level_numbers(self):
        xml = ('<section><num>§ 9.</num><heading>H</heading><chapeau>For this section—</chapeau>'
               '<paragraph><num>(1)</num><content>one</content></paragraph>'
               '<paragraph><num>(2)</num><heading>Two.—</heading><subparagraph><num>(A)</num><content>deep</content></subparagraph></paragraph>'
               '<paragraph><num>(1)</num><content>misnumbered duplicate</content></paragraph></section>')
        units = uslm_html.render_units(xml)
        self.assertEqual([u["key"] for u in units], ["1", "2", "1-2"])
        self.assertEqual([u["label"] for u in units], ["(1)", "(2)", "(1)"])
        self.assertEqual(units[0]["title"], "one")                     # not the lead-in sentence
        self.assertEqual(units[1]["title"], "Two")                     # the run-in heading
        self.assertIn("For this section—", units[0]["html"])           # lead-in joins the first unit
        self.assertTrue(uslm_html.render_body(xml).startswith('<section class="reg-unit" id="u-1" data-unit="1">'))
        # A section with no numbers is one unit.
        self.assertEqual([u["key"] for u in uslm_html.render_units('<section><content><p>x</p></content></section>')], ["text"])

    def test_cfr_linkifier_points_to_local_copy_when_installed(self):
        lk = make_linkifier(lambda x: False, 29, installed_titles=lambda: [])
        before = lk("See 4 U.S.C. 1 and 4 U.S.C. 999.")
        self.assertNotIn("/usc/4/1", before)
        self.install()
        after = lk("See 4 U.S.C. 1 and 4 U.S.C. 999.")
        self.assertIn('class="xref xref-usc xref-usc-local"', after)
        self.assertIn('href="/usc/4/1"', after)
        self.assertIn('href="https://www.law.cornell.edu/uscode/text/4/999"', after)
        usc_build.remove(4)
        self.assertNotIn("/usc/4/1", lk("See 4 U.S.C. 1."))


class ApiTests(UscTestCase):
    def setUp(self):
        super().setUp()
        from app.main import app
        self.client = TestClient(app)

    def test_empty_install(self):
        r = self.client.get("/api/usc/titles")
        self.assertEqual(r.json(), {"titles": []})
        self.assertEqual(r.headers["cache-control"], "no-store")
        self.assertEqual(self.client.get("/api/usc/4/section/1").status_code, 404)
        self.assertEqual(self.client.get("/api/usc/search", params={"q": "flag"}).json()["results"], [])
        self.assertEqual(self.client.get("/usc/4/1").status_code, 404)
        self.assertEqual(list(self.tmp.iterdir()), [])

    def test_reads(self):
        self.install()
        t = self.client.get("/api/usc/titles").json()["titles"]
        self.assertEqual([(x["title"], x["release_point"], x["section_count"]) for x in t], [(4, "119-142", 4)])
        # FT-26: notes on the title itself and on a chapter, by the chapter's tree path
        title_notes = self.client.get("/api/usc/4/notes").json()["notes"]
        self.assertEqual([n["topic"] for n in title_notes], ["enacting"])
        ch = self.client.get("/api/usc/4/notes", params={"node": "ch1"}).json()
        self.assertEqual([n["topic"] for n in ch["notes"]], ["miscellaneous"])
        self.assertIn("Zebra crossing", ch["notes"][0]["html"])
        self.assertEqual(self.client.get("/api/usc/4/notes", params={"node": "ch2"}).json()["notes"], [])
        self.assertEqual(self.client.get("/api/usc/4/notes", params={"node": "1"}).json()["notes"], [])   # a section's notes stay on the section
        self.assertEqual(self.client.get("/api/usc/4/notes", params={"node": "<x>"}).status_code, 422)
        self.assertEqual(self.client.get("/api/usc/5/notes").status_code, 404)
        self.assertEqual(self.client.get("/api/usc/4/tree").json()["c"][1]["d"], "THE SEAL")
        s = self.client.get("/api/usc/4/section/§ 1").json()
        self.assertEqual((s["label"], s["heading"], s["citation"]), ("§ 1", "Flag; stripes and stars on", "4 U.S.C. 1"))
        self.assertEqual(s["next"]["id"], "2")
        self.assertIsNone(s["prev"])
        self.assertEqual([n["category"] for n in s["notes"]], ["editorial", "statutory"])
        self.assertIn("<blockquote", s["notes"][1]["html"])
        self.assertEqual(self.client.get("/api/usc/4/section/2").json()["status"], "repealed")
        self.assertEqual(self.client.get("/api/usc/4/section/999").status_code, 404)
        self.assertEqual(self.client.get("/api/usc/53/meta").status_code, 404)
        self.assertEqual(self.client.get("/api/usc/55/meta").status_code, 404)    # not a title, not installed
        self.assertEqual(self.client.get("/api/usc/151/meta").status_code, 422)

        r = self.client.get("/api/usc/search", params={"q": "stripes"}).json()
        self.assertEqual(r["results"][0]["id"], "1")
        r = self.client.get("/api/usc/search", params={"q": "4 U.S.C. 7", "title": 4}).json()
        self.assertTrue(r["results"][0]["exact"])
        r = self.client.get("/api/usc/search", params={"q": "hometown", "title": 4, "notes": "true"}).json()
        self.assertEqual(r["results"][0]["id"], "1")
        self.assertEqual(self.client.get("/api/usc/search", params={"q": "hometown"}).json()["results"], [])

        page = self.client.get("/usc/4/7")
        self.assertEqual(page.status_code, 200)
        self.assertIn("<title>4 U.S.C. 7</title>", page.text)
        self.assertIn('href="/usc/4/1"', page.text)
        # Same stylesheet and markup as the in-app reader, not a design of its own.
        self.assertIn('<link rel="stylesheet" href="/static/dist/app.css">', page.text)
        self.assertIn('<h1 class="doc-title">§ 7 Position and manner of display</h1>', page.text)
        self.assertIn('<article class="reg-body usc-body"><section class="reg-unit" id="u-a" data-unit="a"><p class="reg-p"', page.text)
        self.assertIn('href="/#/usc/4/section/7"', page.text)
        self.assertNotIn("Georgia", page.text)
        self.assertIn('This section is repealed.', self.client.get("/usc/4/2").text)

    def test_units_mode_and_cited_by(self):
        self.install()
        s = self.client.get("/api/usc/4/section/7").json()
        self.assertEqual(s["mode"], "page")                            # short: one page
        self.assertEqual([u["key"] for u in s["outline"]], ["a", "b"])
        with mock.patch.object(usc_router_mod, "UNIT_MODE_MIN_CHARS", 10):
            s = self.client.get("/api/usc/4/section/7", params={"unit": ""}).json()
            self.assertEqual((s["mode"], s["unit"], s["unit_prev"], s["unit_next"]["key"]), ("units", "a", None, "b"))
            self.assertIn('id="u-a"', s["html"])
            self.assertNotIn('id="u-b"', s["html"])
            s = self.client.get("/api/usc/4/section/7", params={"unit": "b"}).json()
            self.assertEqual((s["unit"], s["unit_prev"]["key"], s["unit_next"]), ("b", "a", None))
            self.assertEqual(self.client.get("/api/usc/4/section/7", params={"unit": "z"}).status_code, 404)
            self.assertIn('id="u-b"', self.client.get("/api/usc/4/section/7").json()["html"])   # no unit → whole
        c = self.client.get("/api/usc/4/citations/1").json()           # § 7 links to § 1
        self.assertEqual([(x["title"], x["id"]) for x in c["usc"]], [(4, "7")])
        self.assertEqual((c["cfr"], c["authority"], c["count"]), ([], [], 1))
        self.assertEqual(self.client.get("/api/usc/4/citations/7").json()["count"], 0)   # no self-citation
        self.assertEqual(self.client.get("/api/usc/4/citations/999").status_code, 404)

    def test_catalog_is_offline_and_marks_stale_from_the_cached_release(self):
        with mock.patch.object(usc_client, "client", side_effect=AssertionError("network")):
            c = self.client.get("/api/usc/catalog").json()
        self.assertIsNone(c["release"])
        self.assertEqual(len(c["titles"]), 54)
        appx = self.client.get("/api/usc/catalog", params={"appendix": "true"}).json()["titles"]
        self.assertEqual(len(appx), 59)                         # + 5a, 11a, 18a, 28a, 50a
        self.assertEqual(appx[-1]["label"], "50a")
        self.assertIn("Labor, Health & Safety", c["desks"])
        t29 = c["titles"][28]
        self.assertEqual((t29["title"], t29["name"], t29["desk"], t29["cfr"], t29["installed"]),
                         (29, "Labor", "Labor, Health & Safety", [29], None))
        self.assertTrue(c["titles"][52]["reserved"])
        self.assertTrue(c["titles"][48]["positive_law"])

        self.install(FakeOLRC(rp="119-140"))
        c = self.client.get("/api/usc/catalog").json()
        inst = c["titles"][3]["installed"]
        self.assertEqual((inst["release_point"], inst["section_count"], inst["stale"]), ("119-140", 4, False))
        self.assertGreater(inst["bytes"], 0)
        usc_client.clear_cache()
        with FakeOLRC(rp="119-142").patch():
            self.client.get("/api/usc/release")
        c = self.client.get("/api/usc/catalog").json()
        self.assertEqual(c["release"]["release_point"], "119-142")
        self.assertTrue(c["titles"][3]["installed"]["stale"])
        storage = self.client.get("/api/library/storage").json()
        self.assertEqual([u["title"] for u in storage["usc"]], [4])

    def test_federated_search_include_usc(self):
        self.install()
        with mock.patch.object(config, "installed_titles", return_value=[]):
            r = self.client.get("/api/search", params={"q": "stripes", "title": "all", "include": "fr,usc"}).json()
        self.assertEqual(r["usc"]["results"][0]["usc_title"], 4)
        self.assertFalse(r["fr"]["installed"])

    def test_release_and_writes(self):
        self.install(FakeOLRC(rp="119-140"))
        usc_client.clear_cache()
        with FakeOLRC(rp="119-142").patch():
            r = self.client.get("/api/usc/release").json()
        self.assertEqual(r["release_point"], "119-142")
        self.assertEqual(r["available_titles"], [1, 4])
        self.assertEqual(r["available_appendix_titles"], [105])
        self.assertTrue(r["titles"][0]["stale"])
        usc_client.clear_cache()
        with FakeOLRC(page_status=500).patch():
            self.assertEqual(self.client.get("/api/usc/release").status_code, 503)
        q = mock.Mock()
        q.submit.return_value = {"id": 3}
        q.busy_with.return_value = False
        with mock.patch.object(library, "queue", q):
            self.assertEqual(self.client.post("/api/usc/download", json={"title": 1}).json(), {"job": {"id": 3}})
            q.submit.assert_called_with(1001, "usc-title", {"usc_title": 1}, "U.S. Code Title 1")
            self.assertEqual(self.client.post("/api/usc/download", json={"title": 53}).status_code, 422)
            q.busy_with.return_value = True
            self.assertEqual(self.client.delete("/api/usc/4").status_code, 409)
            q.busy_with.return_value = False
            self.assertEqual(self.client.delete("/api/usc/4").json(), {"removed": 4})
        self.assertEqual(usc_store.installed_titles(), [])


if __name__ == "__main__":
    import unittest
    unittest.main()


APPENDIX_XML = """<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" identifier="/us/usc/t28a">
<meta><dc:title>Title 28 Appendix</dc:title><docNumber>28a</docNumber><docPublicationName>Online@119-142</docPublicationName>
<property role="is-positive-law">no</property></meta>
<appendix identifier="/us/usc/t28a"><num value="28a">Title 28—APPENDIX</num><heading>JUDICIAL PERSONNEL FINANCIAL DISCLOSURE</heading>
<courtRules identifier="/us/usc/t28a/courtRules/App"><heading>FEDERAL RULES OF APPELLATE PROCEDURE</heading>
<title identifier="/us/usc/t28a/courtRules/App/tI"><num value="I">TITLE I.</num><heading>APPLICABILITY OF RULES</heading>
<courtRule identifier="/us/usc/t28a/courtRules/App/rule1"><num value="1">Rule 1.</num><heading>Scope of Rules</heading>
<content><p>These rules govern procedure in the United States courts of appeals.</p></content></courtRule>
</title></courtRules>
<courtRules identifier="/us/usc/t28a/courtRules/Evid"><heading>FEDERAL RULES OF EVIDENCE</heading>
<courtRule identifier="/us/usc/t28a/courtRules/Evid/rule1"><num value="1">Rule 1.</num><heading>Scope</heading>
<content><p>These rules apply to proceedings in United States courts.</p></content></courtRule>
</courtRules>
<compiledAct identifier="/us/usc/t28a/pl/95/521"><heading>ETHICS IN GOVERNMENT ACT</heading>
<section identifier="/us/usc/t28a/pl/95/521/s1"><num value="1">§ 1.</num><heading>Short title</heading><content>Short title.</content></section>
</compiledAct>
</appendix></uscDoc>"""


class AppendixTitleTests(HermeticTestCase):
    def test_codes_and_labels(self):
        self.assertEqual(usc_client.title_code("11a"), 111)
        self.assertEqual(usc_client.title_code("05A"), 105)
        self.assertEqual(usc_client.title_code("42"), 42)
        self.assertEqual(usc_client.title_label(128), "28a")
        self.assertIn(150, usc_client.RESERVED)                 # 50a was eliminated
        with self.assertRaises(ValueError):
            usc_build.valid_title(150)
        self.assertEqual(usc_build.valid_title(128), 128)
        self.assertTrue(usc_client.zip_url({"congress": 119, "law": "142", "release_point": "119-142",
                                            "titles": {}}, 111).endswith("/xml_usc11a@119-142.zip"))

    def test_parses_court_rules_and_compiled_acts(self):
        tmp = Path(tempfile.mkdtemp(prefix="usc-appx-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        p = tmp / "usc28a.xml"
        p.write_text(APPENDIX_XML, encoding="utf-8")
        recs = []
        info, tree = uslm.parse_title(p, recs.append, lambda *a: None)
        self.assertEqual(info["number"], "28a")
        self.assertEqual(tree["t"], "appendix")
        self.assertEqual([r["id"] for r in recs], ["App-rule1", "Evid-rule1", "pl95-521-s1"])
        self.assertEqual([r["label"] for r in recs], ["Rule 1", "Rule 1", "§ 1"])
        self.assertEqual(recs[0]["path"][0]["d"], "FEDERAL RULES OF APPELLATE PROCEDURE")
        self.assertEqual([c["t"] for c in tree["c"]], ["courtRules", "courtRules", "compiledAct"])
