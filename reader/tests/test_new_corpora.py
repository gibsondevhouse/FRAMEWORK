"""The Constitution, Public Laws and Unified Agenda corpora, their shared HTTP client, the
source registry wiring (plan / apply / schedules) and integrity.

Hermetic: `config.DATA_DIR` is a temp dir, `gov_http.client` is an `httpx.MockTransport`
(`FakeGov`) serving GovInfo bulk-data listings and zips and reginfo.gov pages shaped like
the live ones (verified 2026-11-20), and `gov_http._sleep` records instead of sleeping.
"""
from __future__ import annotations

import io
import json
import shutil
import sqlite3
import tempfile
import threading
import zipfile
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import httpx
from fastapi.testclient import TestClient

from app import agenda, config, constitution, fr_store, gov_http, integrity, library, plaw
from app.main import app
from app.sources import plan, schedule, selection
from tests.base import HermeticTestCase
from tests.test_fr_corpus import HAZCOM

U = "http://xml.house.gov/schemas/uslm/1.0"
CONSTITUTION_XML = f"""<?xml version="1.0" encoding="UTF-8"?><document xmlns="{U}">
<meta xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Constitution of the United States</dc:title></meta>
<main>
<preamble id="preamble"><recital>We the People of the United States, in Order to form a more perfect Union,
do ordain and establish this Constitution.</recital><note><p>The First Continental Congress met in 1774.</p></note></preamble>
<article id="article-I"><num>ARTICLE I.</num>
<section id="article-I-1"><num>Section 1.</num><text>All legislative Powers herein granted shall be vested in a Congress.</text>
<note><p>The power to legislate includes the power to conduct inquiries.</p></note></section>
<section id="article-I-2"><num>Section 2.</num>
<clause id="article-I-2-1"><num>1 </num><text>The House of Representatives shall be composed of Members chosen every second Year.</text>
<note><p>This clause requires election by the people.</p></note></clause>
<clause id="article-I-2-2"><num>2 </num><text>No Person shall be a Representative who shall not have attained to the Age of twenty five Years.</text></clause>
</section></article>
<article id="article-V"><num>ARTICLE V.</num><text>The Congress, whenever two thirds of both Houses shall deem it necessary, shall propose Amendments.</text></article>
<level><heading>Articles in addition to, and amendment of, the Constitution</heading>
<level><num>AMENDMENT I.</num><text>Congress shall make no law respecting an establishment of religion.</text></level>
<level><num>AMENDMENT XIV.</num>
<section><num>Section 1.</num><text>No State shall deprive any person of life, liberty, or property, without due process of law.</text></section>
<section><num>Section 5.</num><text>The Congress shall have power to enforce this article.</text></section>
</level></level>
</main></document>"""

PLAW_NS = "http://schemas.gpo.gov/xml/uslm"


def plaw_xml(congress: int, num: int, title: str, refs: str = "", side: str = "") -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?><pLaw xmlns="{PLAW_NS}" xmlns:dc="http://purl.org/dc/elements/1.1/">
<meta><dc:title>Public Law {congress}–{num}: {title}</dc:title><dc:type>Public Law</dc:type><docNumber>{num}</docNumber>
<citableAs>Public Law {congress}–{num}</citableAs><citableAs>137 Stat. {num * 10}</citableAs>
<approvedDate>2023-03-{num:02d}</approvedDate><congress>{congress}</congress><publicPrivate>public</publicPrivate></meta>
<main><longTitle><officialTitle>{title}<sidenote><p>[<ref href="/us/bill/{congress}/s/{600 + num}">S. {600 + num}</ref>]</p></sidenote></officialTitle></longTitle>
<section><num>SEC. 1.</num><content>Section 101 of title 10 is amended {refs}.<sidenote><p>{side}</p></sidenote></content></section>
</main></pLaw>""".encode()


def zip_of(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def agenda_xml(edition: str, entries: list[dict]) -> bytes:
    rows = []
    for e in entries:
        tt = "".join(f"<TIMETABLE><TTBL_ACTION>{a}</TTBL_ACTION><TTBL_DATE>{d}</TTBL_DATE>"
                     + (f"<FR_CITATION>{c}</FR_CITATION>" if c else "") + "</TIMETABLE>" for a, d, c in e["timetable"])
        rows.append(f"""<RIN_INFO><RIN>{e['rin']}</RIN>
<PUBLICATION><PUBLICATION_ID>{edition}</PUBLICATION_ID><PUBLICATION_TITLE>The Regulatory Plan and the Unified Agenda</PUBLICATION_TITLE></PUBLICATION>
<AGENCY><CODE>{e['agency']}</CODE><NAME>Some Office</NAME><ACRONYM>SO</ACRONYM></AGENCY>
<PARENT_AGENCY><CODE>{e['parent']}</CODE><NAME>Department of Labor</NAME><ACRONYM>DOL</ACRONYM></PARENT_AGENCY>
<RULE_TITLE>{e['title']}</RULE_TITLE><ABSTRACT><![CDATA[<html><body><p>{e['abstract']}</p></body></html>]]></ABSTRACT>
<PRIORITY_CATEGORY>Other Significant</PRIORITY_CATEGORY><RIN_STATUS>Previously published</RIN_STATUS>
<RULE_STAGE>{e['stage']}</RULE_STAGE><MAJOR>No</MAJOR><CFR_LIST><CFR>29 CFR 1910</CFR></CFR_LIST>
<LEGAL_AUTHORITY_LIST><LEGAL_AUTHORITY>29 U.S.C. 655</LEGAL_AUTHORITY></LEGAL_AUTHORITY_LIST>
<TIMETABLE_LIST>{tt}</TIMETABLE_LIST><RPLAN_ENTRY>No</RPLAN_ENTRY>
<AGENCY_CONTACT_LIST><CONTACT><FIRST_NAME>Pat</FIRST_NAME><LAST_NAME>Example</LAST_NAME>
<EMAIL>pat@example.gov</EMAIL><PHONE>202 555-0100</PHONE></CONTACT></AGENCY_CONTACT_LIST></RIN_INFO>""")
    return (f'<?xml version="1.0" encoding="UTF-8"?><REGINFO_RIN_DATA RUN_DATE="2026-07-03">{"".join(rows)}'
            "</REGINFO_RIN_DATA>").encode()


SILICA = {"rin": "1218-AD00", "agency": "1218", "parent": "1200", "title": "Respirable Crystalline Silica",
          "abstract": "OSHA proposes to revise the silica standard.", "stage": "Proposed Rule Stage",
          "timetable": [("NPRM", "11/00/2026", None)]}
HEAT = {"rin": "1218-AD39", "agency": "1218", "parent": "1200", "title": "Heat Injury and Illness Prevention",
        "abstract": "Heat stress in outdoor and indoor work settings.", "stage": "Final Rule Stage",
        "timetable": [("NPRM", "08/30/2024", "89 FR 70698"), ("Final Rule", "12/00/2026", None)]}
EPA = {"rin": "2060-AV00", "agency": "2060", "parent": "2000", "title": "Clean Air Act Plan",
       "abstract": "EPA plans an air quality rule.", "stage": "Long-Term Actions", "timetable": []}


class FakeGov:
    """GovInfo bulk data (HMAN, PLAW) and reginfo.gov, routed on path."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.hman = {117: zip_of({"HMAN-117-constitution.xml": CONSTITUTION_XML.encode(),
                                  "HMAN-117-houserules.xml": b"<x/>"})}
        self.plaw = {
            (113, "public"): zip_of({"PLAW-113publ1.xml": plaw_xml(113, 1, "First law", '<ref href="/us/usc/t10/s101">10 U.S.C. 101</ref>', "10 USC 101 note.")}),
            (114, "public"): zip_of({"PLAW-114publ1.xml": plaw_xml(114, 1, "Second law", '<ref href="/us/usc/t42/s6921">42 U.S.C. 6921</ref>', "42 USC 6921a."),
                                     "PLAW-114publ2.xml": plaw_xml(114, 2, "Third law about silica")}),
        }
        self.plaw_latest = 114
        self.agenda = {"202504": agenda_xml("202504", [SILICA]), "202510": agenda_xml("202510", [SILICA, HEAT, EPA])}
        self.fail_paths: set[str] = set()

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path, host = request.url.path, request.url.host
        if path in self.fail_paths:
            return httpx.Response(503, request=request)
        js = lambda files: httpx.Response(200, json={"files": files}, request=request)  # noqa: E731
        if host == "www.govinfo.gov":
            if path == "/bulkdata/json/HMAN":
                return js([{"name": str(c), "folder": True} for c in self.hman] + [{"name": "resources"}])
            if path.startswith("/bulkdata/json/HMAN/"):
                c = int(path.rsplit("/", 1)[1])
                return js([{"name": f"HMAN-{c}.zip", "link": f"https://www.govinfo.gov/bulkdata/json/HMAN/{c}/HMAN-{c}.zip"}])
            if path.startswith("/bulkdata/HMAN/"):
                return httpx.Response(200, content=self.hman[int(path.split("/")[3])], request=request)
            if path == "/bulkdata/json/PLAW":
                return js([{"name": str(c)} for c in range(113, self.plaw_latest + 1)] + [{"name": "resources"}])
            parts = path.split("/")
            if path.startswith("/bulkdata/json/PLAW/") and len(parts) == 6:
                c, t = int(parts[4]), parts[5]
                if (c, t) not in self.plaw:
                    return httpx.Response(404, request=request)
                return js([{"name": f"PLAW-{c}-{t}.zip", "size": 1,
                            "link": f"https://www.govinfo.gov/bulkdata/json/PLAW/{c}/{t}/PLAW-{c}-{t}.zip"}])
            if path.startswith("/bulkdata/PLAW/"):
                return httpx.Response(200, content=self.plaw[(int(parts[3]), parts[4])], request=request)
        if host == "www.reginfo.gov":
            if path == "/public/do/eAgendaXmlReport":
                links = "".join(f'<a href="/public/do/XMLViewFileAction?f=REGINFO_RIN_DATA_{e}.xml">x</a>'
                                for e in self.agenda)
                return httpx.Response(200, text=f"<html>{links}<a href='?f=REGINFO_RIN_DATA_2012.xml'>y</a></html>",
                                      request=request)
            if path == "/public/do/XMLViewFileAction":
                ed = request.url.params["f"][len("REGINFO_RIN_DATA_"):-4]
                return httpx.Response(200, content=self.agenda[ed], request=request)
        raise AssertionError(f"unexpected request {request.url}")

    def patch(self):
        fake = self
        return mock.patch.object(gov_http, "client",
                                 lambda: httpx.Client(transport=httpx.MockTransport(fake.handler), follow_redirects=True))


class CorpusTestCase(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="corpora-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for target, attr, value in ((config, "DATA_DIR", self.tmp), (gov_http, "_sleep", lambda s: self.sleeps.append(s))):
            p = mock.patch.object(target, attr, value)
            p.start()
            self.addCleanup(p.stop)
        for mod in (constitution, plaw, agenda):
            p = mock.patch.object(mod, "log", lambda msg: None)
            p.start()
            self.addCleanup(p.stop)
        self.sleeps: list[float] = []
        gov_http.reset_pacing()
        self.fake = FakeGov()


class GovHttpTests(CorpusTestCase):
    def test_refuses_other_hosts_and_paces_and_retries(self):
        with self.assertRaises(ValueError):
            gov_http.check_url("https://example.com/x")
        with self.assertRaises(ValueError):
            gov_http.check_url("http://www.govinfo.gov/x")
        calls = []

        def handler(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(429, headers={"Retry-After": "7"}, request=request)
            return httpx.Response(200, json={"ok": True}, request=request)
        with httpx.Client(transport=httpx.MockTransport(handler)) as c:
            self.assertEqual(gov_http.get_json(c, "https://www.govinfo.gov/bulkdata/json/PLAW"), {"ok": True})
        self.assertIn(7.0, self.sleeps)
        self.assertEqual(calls[0].headers["user-agent"].split("/")[0], "python-httpx")  # test client; real one sets UA
        self.assertIn("FRAMEWORK", gov_http.client().headers["user-agent"])
        with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404, request=r))) as c, \
                self.assertRaises(gov_http.SourceUnavailable):
            gov_http.request(c, "https://www.reginfo.gov/x")


class ConstitutionTests(CorpusTestCase):
    def test_build_reads_and_search(self):
        with self.fake.patch():
            res = constitution.build()
        self.assertEqual([u["id"] for u in constitution.outline()],
                         ["preamble", "art1-s1", "art1-s2", "art5", "amdt1", "amdt14-s1", "amdt14-s5"])
        u = constitution.get_unit("art1-s2")
        self.assertEqual(u["label"], "Art. I, § 2")
        self.assertTrue(u["text"].startswith("1 The House of Representatives"))
        self.assertNotIn("requires election", u["text"])                   # annotations stay out of the text
        self.assertEqual(u["notes"], ["This clause requires election by the people."])
        self.assertEqual((u["prev"], u["next"]), ("art1-s1", "art5"))
        self.assertEqual(constitution.get_unit("amdt14-s1")["text"][:8], "No State")
        self.assertEqual(res["meta"]["edition"], "HMAN-117")
        self.assertEqual(len(res["meta"]["xml_sha256"]), 64)
        hits = constitution.search("due process")["results"]
        self.assertEqual(hits[0]["id"], "amdt14-s1")
        self.assertEqual(constitution.search("inquiries", include_notes=True)["results"][0]["kind"], "annotation")
        # Already current: an update checks GovInfo and doesn't rebuild.
        with self.fake.patch():
            self.assertFalse(constitution.update()["updated"])
        self.assertIn("checked_at", constitution.status()["meta"])

    def test_integrity_flags_an_incomplete_text(self):
        with self.fake.patch():
            constitution.build()
        items = {i["check"]: i for i in integrity.check_constitution(online=False)}
        self.assertEqual(items["database"]["status"], "OK")
        self.assertEqual(items["counts"]["status"], "OK")
        self.assertEqual(items["completeness"]["status"], "FAIL")          # the fixture has 3 articles, 2 amendments

    def test_api(self):
        c = TestClient(app)
        self.assertFalse(c.get("/api/constitution").json()["installed"])
        self.assertEqual(c.get("/api/constitution/unit/art1-s1").status_code, 404)
        with self.fake.patch():
            constitution.build()
        d = c.get("/api/constitution").json()
        self.assertTrue(d["installed"])
        self.assertEqual(d["outline"][0]["id"], "preamble")
        self.assertEqual(c.get("/api/constitution/unit/amdt1").json()["label"], "Amdt. I")
        self.assertEqual(c.get("/api/constitution/search", params={"q": "religion"}).json()["results"][0]["id"], "amdt1")
        # Global search carries the Constitution (and any other requested corpus) as its own block.
        g = c.get("/api/search", params={"q": "religion", "title": "all",
                                         "include": "fr,usc,constitution,plaw,agenda"}).json()
        self.assertEqual(g["constitution"]["results"][0]["id"], "amdt1")
        self.assertEqual(g["constitution"]["total"], len(g["constitution"]["results"]))
        self.assertEqual((g["plaw"]["installed"], g["agenda"]["installed"]), (False, False))
        self.assertEqual(c.get("/api/search", params={"q": "x", "include": "constitution,cfr"}).status_code, 422)
        # The Library tab's Remove: refused while a job for the Constitution is queued, then removes it.
        with mock.patch.object(library.queue, "busy_with", lambda key: key == constitution.JOB_KEY):
            self.assertEqual(c.delete("/api/constitution").status_code, 409)
        self.assertEqual(c.delete("/api/constitution").json(), {"removed": "constitution"})
        self.assertFalse(c.get("/api/constitution").json()["installed"])
        self.assertEqual(c.delete("/api/constitution").status_code, 404)

    def test_update_endpoint_queues_an_update_job(self):
        c = TestClient(app)
        with mock.patch.object(library.queue, "submit", lambda key, kind, target, label: {"id": 7, "title": key, "kind": kind}):
            self.assertEqual(c.post("/api/constitution/update").json()["job"],
                             {"id": 7, "title": constitution.JOB_KEY, "kind": "constitution-update"})


class PublicLawTests(CorpusTestCase):
    def test_build_links_usc_and_updates(self):
        with self.fake.patch():
            res = plaw.build(types=["public", "private"])
        self.assertEqual(res["law_count"], 3)
        self.assertEqual({(r["congress"], r["law_type"]) for r in res["congresses"]}, {(113, "public"), (114, "public")})
        law = plaw.get_law("114-1")
        self.assertEqual(law["citation"], "Public Law 114–1")
        self.assertEqual(law["statute"], "137 Stat. 10")
        self.assertEqual(law["title"], "Second law")
        self.assertEqual(law["bill"], "S. 601")
        self.assertEqual(sorted((u["title"], u["section"], u["kind"]) for u in law["usc"]),
                         [(42, "6921", "reference"), (42, "6921a", "codified")])
        self.assertEqual(len(law["provenance"]["sha256"]), 64)
        self.assertEqual([r["id"] for r in plaw.laws_for_usc(10, "101")], ["113-1"])
        self.assertEqual(plaw.search("Pub. L. 114-2")["results"][0]["exact"], True)
        self.assertEqual(plaw.search("silica")["results"][0]["id"], "114-2")
        self.assertGreater(plaw.search("law", limit=1)["total"], 1)      # total counts matches, not the page
        # A new congress appears: an "all congresses" scope follows it.
        self.fake.plaw[(115, "public")] = zip_of({"PLAW-115publ1.xml": plaw_xml(115, 1, "Newest law")})
        self.fake.plaw_latest = 115
        with self.fake.patch():
            up = plaw.update()
        self.assertEqual(up["law_count"], 4)
        self.assertEqual(json.loads(plaw.status()["meta"]["scope"])["congresses"], [113, 114, 115])
        items = {i["check"]: i["status"] for i in integrity.check_plaw(online=False)}
        self.assertEqual(items["sha256"], "OK")
        self.assertEqual(items["coverage"], "OK")

    def test_interrupted_build_resumes(self):
        self.fake.fail_paths.add("/bulkdata/PLAW/114/public/PLAW-114-public.zip")
        with self.fake.patch(), self.assertRaises(gov_http.SourceUnavailable):
            plaw.build([113, 114])
        self.assertFalse(plaw.db_path().exists())
        self.assertEqual(plaw.pending_build()["scope"]["congresses"], [113, 114])
        self.fake.fail_paths.clear()
        self.fake.requests.clear()
        with self.fake.patch():
            res = plaw.build([113, 114])
        self.assertTrue(res["resumed"])
        self.assertFalse(any("PLAW-113" in str(r.url) for r in self.fake.requests))   # 113 was finished
        self.assertEqual(res["law_count"], 3)

    def test_scope_and_estimate(self):
        self.assertEqual(plaw.resolve_scope("all", None, 119)["congresses"][0], 113)
        self.assertEqual(plaw.resolve_scope([118, 90], ["private", "x"], 119),
                         {"congresses": [118], "follow": False, "types": ["private"]})
        with self.assertRaises(ValueError):
            plaw.resolve_scope([90], None, 119)
        self.assertEqual(plaw.current_congress(date(2026, 11, 20)), 119)
        self.assertEqual(plaw.current_congress(date(2027, 1, 5)), 120)
        self.assertGreater(plaw.estimate([118], ["public"])["bytes"], 10 * 1024 * 1024)


    def test_law_reader_units_and_api(self):
        from app.render import plaw_html
        # A long law with a division reads a section at a time; margin notes are their own lines.
        filler = "Lorem ipsum dolor sit amet. " * 600
        xml = f"""<pLaw xmlns="{PLAW_NS}"><main><longTitle><docTitle>An Act</docTitle><officialTitle>To do things.</officialTitle></longTitle>
<enactingFormula>Be it enacted.</enactingFormula>
<division><num>DIVISION A</num><heading>FIRST PART</heading>
<section><num>SEC. 101.</num><heading>Short title.</heading><content>{filler}<sidenote><p>42 USC 6901 note.</p></sidenote></content></section>
<section><num>SEC. 102.</num><heading>Amendments.</heading><content>{filler}</content></section></division>
<section><num>SEC. 2.</num><heading>Last.</heading><content>{filler}</content></section></main></pLaw>""".encode()
        units = plaw_html.law_units(xml)
        self.assertEqual([u["key"] for u in units], ["preamble", "s1", "s2", "s3"])
        self.assertEqual((units[1]["label"], units[1]["title"], units[1]["group_label"]), ("SEC. 101", "Short title", "DIVISION A FIRST PART"))
        self.assertIsNone(units[3]["group_label"])
        self.assertIn("Be it enacted.", units[0]["html"])
        self.assertIn('<p class="plaw-sidenote">42 USC 6901 note.</p>', units[1]["html"])
        self.assertNotIn("<script", "".join(u["html"] for u in units))

        c = TestClient(app)
        self.assertEqual(c.get("/api/plaw/law/114-1/text").status_code, 404)
        with self.fake.patch():
            plaw.build([113, 114])
        st = c.get("/api/plaw?limit=1").json()["status"]
        self.assertEqual((st["first_congress"], st["current_congress"]), (113, plaw.current_congress()))
        # A short law is one page: every unit in one html, preamble first, sections headed.
        d = c.get("/api/plaw/law/114-1/text").json()
        self.assertEqual(d["mode"], "page")
        self.assertEqual([u["key"] for u in d["outline"]], ["preamble", "s1"])
        self.assertIn('<h2 class="plaw-sec-head">SEC. 1</h2>', d["html"])
        self.assertIn("42 USC 6921a.", d["html"])
        self.assertNotIn("text", c.get("/api/plaw/law/114-1", params={"text": "false"}).json())
        self.assertIn("text", c.get("/api/plaw/law/114-1").json())
        # A long law: one unit per request, with its neighbours; an unknown unit is a 404.
        with mock.patch.object(plaw_html, "law_units", lambda x: units):
            u = c.get("/api/plaw/law/114-1/text", params={"unit": ""}).json()
            self.assertEqual((u["mode"], u["unit"], u["unit_prev"], u["unit_next"]["key"]), ("units", "preamble", None, "s1"))
            u = c.get("/api/plaw/law/114-1/text", params={"unit": "s3"}).json()
            self.assertEqual((u["unit_prev"]["key"], u["unit_next"]), ("s2", None))
            self.assertEqual(c.get("/api/plaw/law/114-1/text", params={"unit": "s9"}).status_code, 404)
        # Remove: refused while a Public Laws job is queued, then deletes; 404 once gone.
        with mock.patch.object(library.queue, "busy_with", lambda key: key == plaw.JOB_KEY):
            self.assertEqual(c.delete("/api/plaw").status_code, 409)
        self.assertEqual(c.delete("/api/plaw").json(), {"removed": "plaw"})
        self.assertFalse(plaw.exists())
        self.assertEqual(c.delete("/api/plaw").status_code, 404)


class AgendaTests(CorpusTestCase):
    def test_editions_window(self):
        eds = agenda.parse_edition_list('f=REGINFO_RIN_DATA_202510.xml f=REGINFO_RIN_DATA_202404.xml '
                                        'f=REGINFO_RIN_DATA_2012.xml f=REGINFO_RIN_DATA_202510.xml')
        self.assertEqual([e["edition"] for e in eds], ["202510", "202404", "201200"])
        self.assertEqual([e["edition"] for e in agenda.editions_in_window(eds, 1, date(2026, 11, 20))], ["202510"])
        self.assertEqual(len(agenda.editions_in_window(eds, 3, date(2026, 11, 20))), 2)
        self.assertEqual([e["edition"] for e in agenda.editions_in_window(eds, 1, date(2030, 1, 1))], ["202510"])

    def test_build_filters_links_fr_and_drops_contacts(self):
        with closing(fr_store.connect()) as con:                  # an FR corpus with the heat NPRM in it
            heat = {**HAZCOM, "document_number": "2024-17000", "citation": "89 FR 70698", "regulation_id_numbers": []}
            fr_store.upsert_documents(con, [HAZCOM, heat], "https://www.federalregister.gov/api/v1/documents.json")
            con.commit()
        with self.fake.patch():
            res = agenda.build(years=2, agencies=["1200"], today=date(2026, 11, 20))
        self.assertEqual(res["edition_count"], 2)
        self.assertEqual(res["entry_count"], 3)                    # EPA filtered out; silica in both editions
        e = agenda.get_entry("1218-AD00")
        self.assertEqual(e["edition"], "202510")
        self.assertEqual([h["edition"] for h in e["history"]], ["202510", "202504"])
        self.assertEqual(e["abstract"], "OSHA proposes to revise the silica standard.")
        self.assertEqual(e["cfr"], ["29 CFR 1910"])
        self.assertEqual([d["document_number"] for d in e["fr_documents"]], ["2026-20001"])     # by RIN
        h = agenda.get_entry("1218-AD39")
        self.assertEqual([d["document_number"] for d in h["fr_documents"]], ["2024-17000"])     # by FR citation
        raw = agenda.db_path().read_bytes()
        self.assertNotIn(b"pat@example.gov", raw)
        self.assertNotIn(b"555-0100", raw)
        self.assertEqual(agenda.list_entries(stage="final")["results"][0]["rin"], "1218-AD39")
        self.assertEqual(agenda.search("1218-ad39")["results"][0]["exact"], True)
        self.assertEqual(agenda.search("heat stress")["results"][0]["rin"], "1218-AD39")
        items = {i["check"]: i["status"] for i in integrity.check_agenda(online=False)}
        self.assertEqual((items["entries"], items["editions"], items["sha256"]), ("OK", "OK", "OK"))
        # A newer edition is added by update().
        self.fake.agenda["202604"] = agenda_xml("202604", [HEAT])
        with self.fake.patch():
            up = agenda.update()
        self.assertEqual(up["new_editions"], ["202604"])
        # Search lists a rule once (its newest matching edition) and counts rules, not editions.
        hits = agenda.search("heat stress")
        self.assertEqual([(r["rin"], r["edition"]) for r in hits["results"]], [("1218-AD39", "202604")])
        self.assertEqual(hits["total"], 1)
        self.assertIn("\x02", hits["results"][0]["snippet"])

    def test_api(self):
        c = TestClient(app)
        self.assertFalse(c.get("/api/agenda").json()["installed"])
        with self.fake.patch():
            agenda.build(years=1, stages=["final"], today=date(2026, 11, 20))
        d = c.get("/api/agenda").json()
        self.assertEqual([r["rin"] for r in d["results"]], ["1218-AD39"])
        self.assertEqual(c.get("/api/agenda/rin/1218-ad39").json()["title"], "Heat Injury and Illness Prevention")
        self.assertEqual(c.get("/api/agenda/rin/9999-ZZ99").status_code, 404)

    def test_newsroom_filters_facets_and_remove(self):
        c = TestClient(app)
        self.assertEqual(c.get("/api/agenda/facets").json()["agencies"], [])
        with self.fake.patch():
            agenda.build(years=2, today=date(2026, 11, 20))
        f = c.get("/api/agenda/facets").json()
        self.assertEqual(f["edition"], "202510")
        self.assertEqual([(a["code"], a["acronym"], a["entries"]) for a in f["agencies"]], [("1200", "DOL", 2), ("2000", "DOL", 1)])
        self.assertEqual([(s["key"], s["entries"]) for s in f["stages"]], [("proposed", 1), ("final", 1), ("long_term", 1)])
        self.assertEqual(c.get("/api/agenda/facets", params={"edition": "202504"}).json()["stages"], [
            {"key": "proposed", "label": "Proposed Rule Stage", "entries": 1}])
        # The list filters by agency, stage and words (or a RIN), and names each row's agencies.
        rows = c.get("/api/agenda", params={"agency": "1200"}).json()["results"]
        self.assertEqual([r["rin"] for r in rows], ["1218-AD00", "1218-AD39"])
        self.assertEqual((rows[0]["parent_code"], rows[0]["agency_code"]), ("1200", "1218"))
        self.assertEqual(c.get("/api/agenda", params={"agency": "1200", "stage": "final"}).json()["total"], 1)
        self.assertEqual([r["rin"] for r in c.get("/api/agenda", params={"q": "heat stress"}).json()["results"]], ["1218-AD39"])
        self.assertEqual([r["rin"] for r in c.get("/api/agenda", params={"q": "2060-av00"}).json()["results"]], ["2060-AV00"])
        self.assertEqual(c.get("/api/agenda", params={"q": "silica", "stage": "final"}).json()["total"], 0)
        with mock.patch.object(library.queue, "busy_with", lambda key: key == agenda.JOB_KEY):
            self.assertEqual(c.delete("/api/agenda").status_code, 409)
        self.assertEqual(c.delete("/api/agenda").json(), {"removed": "agenda"})
        self.assertFalse(c.get("/api/agenda").json()["installed"])
        self.assertEqual(c.delete("/api/agenda").status_code, 404)


class RegistryWiringTests(CorpusTestCase):
    def setUp(self):
        super().setUp()
        self.queue = mock.Mock()
        self.queue.busy_with.return_value = False
        self.queue.operation_lock.return_value = threading.Lock()
        self.queue.submit.side_effect = lambda t, k, tg, label: {"id": 1, "title": t, "kind": k, "target": tg}
        self.queue.snapshot.return_value = {"current": None, "queued": [], "recent": []}
        p = mock.patch.object(library, "queue", self.queue)
        p.start()
        self.addCleanup(p.stop)

    def submitted(self):
        return [c.args[:3] for c in self.queue.submit.call_args_list]

    def test_plan_and_apply_queue_the_new_corpora(self):
        sel = {"sources": {"cfr": {"enabled": False}, "usc": {"enabled": False}, "fr": {"enabled": False},
                           "constitution": {"enabled": True},
                           "public_laws": {"enabled": True, "scope": {"congresses": [118], "law_types": ["public"]}},
                           "unified_agenda": {"enabled": True, "scope": {"agencies": ["2000"], "stages": "all", "years": 1}}}}
        p = plan.preview(sel)
        self.assertEqual([(a["source"], a["action"]) for a in p["actions"]],
                         [("constitution", "install"), ("public_laws", "install"), ("unified_agenda", "install")])
        self.assertTrue(p["summary"].startswith("Builds the Constitution; builds Public Laws; builds the Unified Agenda (~"), p["summary"])
        r = plan.apply(sel, confirm=True)
        self.assertTrue(r["applied"])
        self.assertEqual(self.submitted(), [
            (2000, "constitution-build", None),
            (3000, "plaw-build", {"congresses": [118], "types": ["public"]}),
            (4000, "agenda-build", {"years": 1, "agencies": ["2000"]}),
        ])

    def test_installed_corpus_is_on_in_the_current_setup_and_unchecking_keeps_it(self):
        with self.fake.patch():
            constitution.build()
        cur, saved = selection.current()
        self.assertFalse(saved)
        self.assertTrue(cur["sources"]["constitution"]["enabled"])
        self.assertFalse(cur["sources"]["public_laws"]["enabled"])
        p = plan.preview({"sources": {"constitution": {"enabled": False}}})
        self.assertEqual(p["keeps"], ["the Constitution"])
        self.assertTrue(constitution.exists())
        p = plan.apply({"sources": {"constitution": {"enabled": False}}}, remove_unselected=True, confirm=True)
        self.assertEqual([a["source"] for a in p["removed"]], ["constitution"])
        self.assertFalse(constitution.exists())

    def test_scheduled_refreshes(self):
        now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
        meta = {"last_ok_at": (now - timedelta(days=8)).isoformat()}
        self.assertTrue(schedule.is_due("weekly", meta, now))
        self.assertFalse(schedule.is_due("weekly", {"last_ok_at": (now - timedelta(days=2)).isoformat()}, now))
        self.assertTrue(schedule.is_due("daily", {"last_ok_at": (now - timedelta(days=2)).isoformat()}, now))
        self.assertFalse(schedule.is_due("manual", meta, now))
        self.assertFalse(schedule.is_due("weekly", {**meta, "last_error": "x",
                                                    "last_error_at": (now - timedelta(hours=1)).isoformat()}, now))
        self.assertEqual(schedule.maybe_queue_corpus_updates(now), [])      # nothing installed
        with self.fake.patch():
            constitution.build()
        later = datetime.now(timezone.utc) + timedelta(days=8)
        selection.save({"sources": {"constitution": {"enabled": True, "schedule": "manual"}}})
        self.assertEqual(schedule.maybe_queue_corpus_updates(later), [])
        selection.save({"sources": {"constitution": {"schedule": "weekly"}}})
        self.assertEqual(len(schedule.maybe_queue_corpus_updates(later)), 1)
        self.assertEqual(self.submitted(), [(2000, "constitution-update", None)])
        selection.save({"sources": {"constitution": {"enabled": False}}})
        self.assertEqual(len(schedule.maybe_queue_corpus_updates(later)), 0)

    def test_queue_dispatches_the_new_kinds(self):
        with mock.patch.object(constitution, "run_job") as rc, mock.patch.object(plaw, "run_job") as rp, \
                mock.patch.object(agenda, "run_job") as ra:
            for kind in ("constitution-update", "plaw-update", "agenda-build"):
                library.run_job({"kind": kind, "title": 0, "target": None}, lambda *a, **k: None)
        self.assertEqual((rc.call_count, rp.call_count, ra.call_count), (1, 1, 1))
