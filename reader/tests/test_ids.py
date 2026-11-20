"""Canonical ids (`app.ids`) and `python -m app.resolve` (DM-101, TL-08, TL-23, SEC-101).

Two halves:

* `tests/shared/id_cases.json` is the table of valid, edge and hostile cases. It is data so
  that a TypeScript twin of `app.ids` can run the very same cases later.
* Every unit of every framework, built into one temp `DATA_DIR` from the existing fakes
  (`fake_titles`, `FakeOLRC`, `FakeFR`, `FakeGov`), gets an id, and that id leads back to
  exactly its own row, to a route that names it and to a citation that resolves to it.

Hermetic: no network, nothing read from `reader/data/`.
"""
from __future__ import annotations

import contextlib
import io
import json
import random
import re
import runpy
import sqlite3
import sys
import time
from contextlib import closing
from datetime import date
from pathlib import Path
from unittest import mock
from urllib.parse import unquote

from app import (agenda, build, config, constitution, fr_build, fr_client, fr_store, gov_http, ids, library, plaw,
                 resolve, store, usc_build, usc_client, usc_store)
from app.citations import parser
from tests import fake_titles
from tests.base import HermeticTestCase
from tests.test_fr_corpus import HAZCOM, JOINT, RCRA, FakeFR
from tests.test_new_corpora import FakeGov, plaw_xml, zip_of
from tests.test_usc_corpus import APPENDIX_XML, USLM_T4, FakeOLRC, make_zip

CASES = json.loads((Path(__file__).parent / "shared" / "id_cases.json").read_text(encoding="utf-8"))
BUDGET_SEC = 1.0          # per hostile input; real times are well under a millisecond
EN_DASH = "\u2013"


def back_from_store(ref: ids.Ref) -> ids.Ref:
    """Rebuild a ref from nothing but its store key, the way an indexer would."""
    key = ids.to_store_key(ref)
    where = dict(key.where)
    if ref.corpus == "cfr":
        return ids.from_store_key("cfr", where.get("id", where.get("part")), collection=key.title, kind=ref.kind,
                                  paragraph=ref.paragraph)
    if ref.corpus == "usc":
        return ids.from_store_key("usc", where["id"], collection=key.title, paragraph=ref.paragraph)
    if ref.corpus == "fr":
        if ref.kind == "page":
            return ids.from_store_key("fr", str(key.span[2]), collection=where["volume"], kind="page")
        return ids.from_store_key("fr", where["document_number"])
    if ref.corpus == "constitution":
        if ref.kind == "group":
            return ids.constitution_unit(("art" if "article" in where else "amdt") + str(next(iter(where.values()))))
        return ids.from_store_key("constitution", where["id"], paragraph=ref.paragraph)
    if ref.corpus == "plaw":
        return ids.from_store_key("plaw", where["id"])
    return ids.from_store_key("agenda", where["rin"], collection=where.get("edition"))


class SafeOutputs:
    """Mixin: everything a ref turns into is an app route or an allow-listed address."""

    def assert_safe(self, ref: ids.Ref) -> None:
        self.assertEqual(ids.parse_id(str(ref)), ref)
        self.assertTrue(str(ref).isascii() and len(str(ref)) <= ids.MAX_ID_LEN)
        route, url = ids.to_route(ref), ids.to_url(ref)
        if route is not None:
            self.assertTrue(route.startswith("#/") and ids.is_safe_destination(route), route)
        if url is not None:
            self.assertTrue(ids.is_safe_destination(url), url)
            self.assertIn(url.split("/")[2], ids.ALLOWED_HOSTS)
        self.assertIsInstance(ids.to_citation(ref), str)
        sql, params = ids.to_store_key(ref).select()
        self.assertNotIn(ref.key, sql if len(ref.key) > 3 else "")     # values are bound, never in the SQL text
        self.assertEqual(sql.count("?"), len(params))


class CaseTableTests(SafeOutputs, HermeticTestCase):
    def test_valid_addresses_and_everything_derived_from_them(self):
        for case in CASES["valid"]:
            with self.subTest(case["address"]):
                ref = ids.parse_id(case["address"])
                self.assertEqual((ref.corpus, ref.collection, ref.kind, ref.key, ref.paragraph),
                                 (case["corpus"], case["collection"], case["kind"], case["key"], case["paragraph"]))
                self.assertEqual((str(ref), ref.id), (case["address"], case["id"]))
                d = ids.describe(ref)
                self.assertEqual(d["store"], case["store"])
                self.assertEqual((d["route"], d["citation"], d["url"]), (case["route"], case["citation"], case["url"]))
                self.assertEqual(ids.resolve(case["address"]), ref)
                self.assertEqual(back_from_store(ref), ref)
                if case.get("citation_round_trip", True):
                    self.assertEqual(ids.parse_citation(case["citation"]), ref)
                self.assert_safe(ref)

    def test_citation_strings_resolve(self):
        for case in CASES["citations"]:
            with self.subTest(case["text"]):
                ref = ids.resolve(case["text"], case.get("default_title"))
                self.assertEqual(str(ref), case["address"])
                self.assert_safe(ref)

    def test_store_keys_become_addresses(self):
        for case in CASES["store_keys"]:
            with self.subTest(case["address"]):
                ref = ids.from_store_key(case["corpus"], case["key"], collection=case["collection"], kind=case["kind"],
                                         paragraph=case["paragraph"])
                self.assertEqual(str(ref), case["address"])
                self.assertEqual(back_from_store(ref), ref)
                self.assert_safe(ref)

    def test_invalid_ids_are_refused(self):
        for case in CASES["invalid_ids"]:
            with self.subTest(case["input"], why=case["why"]):
                self.assertFalse(ids.is_valid_id(case["input"]))
                with self.assertRaises(ids.IdError):
                    ids.parse_id(case["input"])

    def test_hostile_inputs_are_refused(self):
        for case in CASES["hostile"]:
            with self.subTest(repr(case["input"])[:60], why=case["why"]):
                for fn in (ids.resolve, ids.parse_id, ids.parse_citation):
                    with self.assertRaises(ids.IdError):
                        fn(case["input"])
                self.assertFalse(ids.is_valid_id(case["input"]))
                if isinstance(case["input"], str):          # running text may hold a real citation: still safe
                    for ref in ids.find_citations(case["input"], 29):
                        self.assert_safe(ref)
                else:
                    with self.assertRaises(ids.IdError):
                        ids.find_citations(case["input"])

    def test_oversized_inputs_are_refused_quickly(self):
        for case in CASES["generated"]:
            text = case["prefix"] + case["fill"] * case["count"] + case["suffix"]
            with self.subTest(case["why"]):
                for fn in (ids.resolve, ids.parse_id, ids.parse_citation):
                    start = time.perf_counter()
                    with self.assertRaises(ids.IdError):
                        fn(text)
                    self.assertLess(time.perf_counter() - start, BUDGET_SEC)
                start = time.perf_counter()
                for ref in ids.find_citations(text, 29):
                    self.assert_safe(ref)
                self.assertLess(time.perf_counter() - start, 5 * BUDGET_SEC)

    def test_safe_destination_rule(self):
        for dest in CASES["destinations"]["safe"]:
            self.assertTrue(ids.is_safe_destination(dest), dest)
        for dest in CASES["destinations"]["unsafe"]:
            self.assertFalse(ids.is_safe_destination(dest), dest)

    def test_the_table_covers_every_framework_and_unit_kind(self):
        seen = {(c["corpus"], c["kind"]) for c in CASES["valid"]}
        self.assertEqual({c for c, _ in seen}, set(ids.CORPORA))
        self.assertLessEqual({("cfr", "section"), ("cfr", "appendix"), ("cfr", "part"), ("usc", "section"),
                              ("fr", "document"), ("fr", "page"), ("constitution", "unit"), ("constitution", "group"),
                              ("plaw", "law"), ("agenda", "rule")}, seen)
        self.assertTrue(any(c["collection"].endswith("a") for c in CASES["valid"] if c["corpus"] == "usc"))


class GrammarTests(SafeOutputs, HermeticTestCase):
    def test_mutated_inputs_never_escape_the_grammar(self):
        """Whatever a damaged id or citation turns into, it is refused or it is a canonical
        id with safe destinations: never another exception, never another kind of output."""
        rng = random.Random(101)
        alphabet = list("/:#%?&=.-_~()<>\"'\\ \t\n\0;,@[]{}|^`$!*+aA1§\u2013\u00a0\u202e\u200bé")
        seeds = [c["address"] for c in CASES["valid"]] + [c["text"] for c in CASES["citations"]]
        accepted = 0
        for _ in range(6000):
            s = list(rng.choice(seeds))
            for _ in range(rng.randint(1, 3)):
                op, i = rng.randint(0, 3), rng.randint(0, len(s))
                if op == 0:
                    s.insert(i, rng.choice(alphabet))
                elif op == 1 and s:
                    del s[min(i, len(s) - 1)]
                elif op == 2 and s:
                    s[min(i, len(s) - 1)] = rng.choice(alphabet)
                else:
                    s[i:i] = list(rng.choice(seeds))[: rng.randint(1, 12)]
            text = "".join(s)
            for default_title in (None, 29):
                try:
                    ref = ids.resolve(text, default_title)
                except ids.IdError:
                    continue
                accepted += 1
                self.assert_safe(ref)
                self.assertEqual(back_from_store(ref), ref)
        self.assertGreater(accepted, 200)            # the loop really exercises the accepting paths too

    def test_one_address_per_unit(self):
        # The same unit reached four ways is the same string.
        want = "reg://federal/usc/42/2000e-2"
        self.assertEqual(str(ids.usc_section(42, "2000e-2")), want)
        self.assertEqual(str(ids.usc_section("42", f"2000e{EN_DASH}2")), want)
        self.assertEqual(str(ids.from_store_key("usc", f"2000e{EN_DASH}2", collection=42)), want)
        self.assertEqual(str(ids.parse_citation(f"42 U.S.C. § 2000e{EN_DASH}2")), want)
        # Appendix titles: 105 and "5a" are one collection, and their ids are kept as stored.
        self.assertEqual(ids.from_store_key("usc", "pl95-521-s1", collection=128),
                         ids.from_store_key("usc", "pl95-521-s1", collection="28a"))
        self.assertEqual(ids.usc_title_code("28a"), 128)
        self.assertEqual((ids.usc_collection(150), ids.usc_collection("11A")), ("50a", "11a"))

    def test_constitution_table_matches_the_document(self):
        self.assertEqual(sum(ids.CONSTITUTION_SECTIONS[f"art{n}"] for n in range(1, 5)), 21)
        for head, count in ids.CONSTITUTION_SECTIONS.items():
            self.assertEqual(ids.constitution_unit(head).kind, "group")
            self.assertEqual(ids.constitution_unit(f"{head}-s{count}").kind, "unit")
            with self.assertRaises(ids.IdError):
                ids.constitution_unit(f"{head}-s{count + 1}")
        self.assertEqual(ids.roman("XXVII"), 27)
        for bad in ("IIII", "VX", "IC", "", "ABC"):
            with self.assertRaises(ids.IdError):
                ids.roman(bad)

    def test_spans_from_the_one_parser_become_addresses(self):
        text = ("Waste defined under 40 CFR 261.3 and materials in 49 CFR part 172; see 29 U.S.C. 653, 655, and 657; "
                "39 FR 23502, § 1910.134(a)(1) and https://www.osha.gov/x.")
        self.assertEqual([str(r) for r in ids.find_citations(text, 29)], [
            "reg://federal/usc/29/653", "reg://federal/usc/29/655", "reg://federal/usc/29/657",
            "reg://federal/fr/39/23502", "reg://federal/cfr/49/part:172", "reg://federal/cfr/40/261.3",
            "reg://federal/cfr/29/1910.134#(a)(1)"])
        # Without a title, a bare section is not guessed at.
        self.assertNotIn("reg://federal/cfr/29/1910.134#(a)(1)", [str(r) for r in ids.find_citations(text)])
        self.assertIsNone(ids.from_span(parser.CitationSpan(kind="web", raw="x", url="https://evil.example/")))
        self.assertIsNone(ids.from_span(parser.CitationSpan(kind="cfr_part", raw="x", title=99, target="1")))

    def test_new_whole_citation_patterns_cannot_be_made_to_hang(self):
        patterns = (parser.CFR_SECTION_ID_RE, parser.USC_APPENDIX_RE, parser.FR_CITE_RE, parser.FR_DOC_RE,
                    parser.PUBLIC_LAW_RE, parser.CONST_RE, parser.RIN_RE, parser.SECTION_MARK_RE, parser.CFR_CITE_RE,
                    parser.CFR_PART_CITE_RE, parser.CFR_APPENDIX_NAME_RE, parser.USC_CITE_RE, parser.USC_RANGE_CITE_RE,
                    parser.FR_DOC_NUMBER_RE, parser.RIN_CITE_RE, parser.CONST_BARE_RE)
        n = 50_000
        attacks = ["1.1" + "(a)" * n + "-", "1." + "1-" * n, "1" * n + ".1", "5 U.S.C. App. " + "a." * n,
                   "FR Doc. " + "a." * n + "!", "Pub. L. " + "1-" * n, "Pub" + ". " * n + "L. 1-1", "P. L. " + " " * n + "1-1",
                   "U.S. Const. art. " + "I" * n, "U.S. Const." + " " * n + "art. I", "U.S. Const. art. I" + ", § 1" * n,
                   "1218-" + "A" * n, "1218" + "-" * n + "AD39", "9" * n + " FR " + "9" * n, " " * n, "(" * n, "§" * n,
                   "29 CFR " + "a " * n, "29 CFR part 1, " + "x" * n, "part " * n, "29 U.S.C. " + "9" * n + "(",
                   "29 U.S.C. 1" + "(a)" * n, "2 U.S.C. §§ " + "1-" * n + " to 2", "RIN " * n, "Appendix " * n + "<"]
        for attack in attacks:
            for pattern in patterns:
                start = time.perf_counter()
                pattern.search(attack)
                pattern.fullmatch(attack)
                self.assertLess(time.perf_counter() - start, BUDGET_SEC, (pattern.pattern[:40], attack[:20]))


# --- A small Title 14: two parts with the same appendix name (so the build part-qualifies
# them), a plainly named appendix, a section id with parentheses and a reserved range. ---
T14_SECTIONS = {"91.1": "Applicability.", "91.1(a)-1": "Special rule.", "91.5 - 91.7": "[Reserved]"}
T14_STRUCTURE = {"type": "title", "identifier": "14", "label": "Title 14", "label_description": "Aeronautics and Space", "children": [
    {"type": "chapter", "identifier": "I", "label": "Chapter I", "label_description": "Federal Aviation Administration", "children": [
        {"type": "part", "identifier": "71", "label": "Part 71", "label_description": "Airspace", "children": [
            {"type": "appendix", "identifier": "SFAR No. 97", "label": "SFAR No. 97", "label_description": "Ops A"}]},
        {"type": "part", "identifier": "91", "label": "Part 91", "label_description": "General Operating Rules", "children": [
            *({"type": "section", "identifier": n, "label": f"§ {n}", "label_description": d} for n, d in T14_SECTIONS.items()),
            {"type": "appendix", "identifier": "SFAR No. 97", "label": "SFAR No. 97", "label_description": "Ops B"},
            {"type": "appendix", "identifier": "Appendix A to Part 91", "label": "Appendix A to Part 91",
             "label_description": "Category II Operations"}]},
    ]},
]}
T14_XML = (
    '<DIV1 N="14" TYPE="TITLE"><DIV5 N="71" TYPE="PART"><HEAD>PART 71</HEAD>'
    '<DIV9 N="SFAR No. 97" TYPE="APPENDIX"><HEAD>SFAR 97</HEAD><P>Part 71 rules.</P></DIV9></DIV5>'
    '<DIV5 N="91" TYPE="PART"><HEAD>PART 91</HEAD>'
    + "".join(f'<DIV8 N="{n}" TYPE="SECTION"><HEAD>§ {n} {d}</HEAD><P>(a) Text of {n}.</P></DIV8>' for n, d in T14_SECTIONS.items())
    + '<DIV9 N="SFAR No. 97" TYPE="APPENDIX"><HEAD>SFAR 97</HEAD><P>Part 91 rules.</P></DIV9>'
    '<DIV9 N="Appendix A to Part 91" TYPE="APPENDIX"><HEAD>Appendix A to Part 91</HEAD><P>Manual.</P></DIV9></DIV5></DIV1>'
)
# Title 4 with the id shapes the real Code has: an en-dash section number, a run of omitted
# sections stored as one row, and a second section under an already used number.
T4_EXTRA = (
    f'<section identifier="/us/usc/t4/s8{EN_DASH}1"><num value="8{EN_DASH}1">§ 8{EN_DASH}1.</num><heading> Respect for flag</heading>'
    '<content><p>No disrespect should be shown to the flag.</p></content></section>'
    '<section identifier="/us/usc/t4/s50...52"><num value="50...52">§§ 50 to 52.</num><heading> Omitted</heading>'
    '<content><p>Sections omitted.</p></content></section>'
    '<section identifier="/us/usc/t4/s7"><num value="7">§ 7.</num><heading> Another section 7</heading>'
    '<content><p>A second section published under the same number.</p></content></section>'
)
PRIVATE_LAW = (plaw_xml(114, 3, "For the relief of an example").replace(b"<publicPrivate>public", b"<publicPrivate>private")
               .replace(b"Public Law", b"Private Law"))


class FixtureRoundTripTests(SafeOutputs, HermeticTestCase):
    """All six frameworks in one temp DATA_DIR, built by the real pipelines from the fakes."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.titles = fake_titles.FakeTitles()
        cls.data = cls.titles.install()                      # CFR 29, 40, 49; patches config.DATA_DIR
        cls.stack = contextlib.ExitStack()
        for module, attr in ((fr_client, "_sleep"), (gov_http, "_sleep")):
            cls.stack.enter_context(mock.patch.object(module, attr, lambda sec: None))
        for module in (usc_build, fr_build, constitution, plaw, agenda):
            cls.stack.enter_context(mock.patch.object(module, "log", lambda msg: None))
        fr_client.reset_pacing()
        gov_http.reset_pacing()
        usc_client.clear_cache()
        usc_store.clear_caches()

        def fetch14(_client, url):
            if url.endswith("/titles.json"):
                return {"titles": [{"number": 14, "name": "Aeronautics and Space", "up_to_date_as_of": "2026-01-02", "reserved": False}]}
            return T14_STRUCTURE

        def download14(_client, url, dest, on_bytes=None):
            dest.write_text(T14_XML, encoding="utf-8")

        with mock.patch.object(build, "fetch_json", fetch14), mock.patch.object(build, "download_stream", download14), \
                mock.patch.object(library, "ecfr_titles", lambda refresh=False: fetch14(None, "/titles.json")["titles"]):
            library._structures.clear()
            build.build(14, force=True)
        t4 = USLM_T4.replace("{rp}", "119-142").replace('<section identifier="/us/usc/t4/s41">',
                                                         T4_EXTRA + '<section identifier="/us/usc/t4/s41">')
        with FakeOLRC(zips={"04": make_zip(t4), "28": make_zip(APPENDIX_XML, name="usc28a.xml")}).patch():
            usc_build.build(4, force=True)
            usc_build.build(128, force=True)
        with FakeFR([HAZCOM, RCRA, JOINT]).patch():
            fr_build.build(titles=[29, 40], since="2026-06-01", until="2026-11-18", force=True)
        gov = FakeGov()
        gov.plaw[(114, "private")] = zip_of({"PLAW-114pvtl3.xml": PRIVATE_LAW})
        with gov.patch():
            constitution.build()
            plaw.build(types=["public", "private"])
            agenda.build(years=2, today=date(2026, 11, 20))

    @classmethod
    def tearDownClass(cls):
        cls.stack.close()
        cls.titles.remove()
        library._structures.clear()
        usc_client.clear_cache()
        usc_build.reset_schedule()
        usc_store.clear_caches()
        store.clear_caches()
        fr_client.reset_pacing()
        gov_http.reset_pacing()
        super().tearDownClass()

    def query(self, database: str, sql: str) -> list[sqlite3.Row]:
        with closing(sqlite3.connect(config.DATA_DIR / database)) as con:
            con.row_factory = sqlite3.Row
            return con.execute(sql).fetchall()

    def check(self, ref: ids.Ref, column: str, value: str) -> dict:
        """The id leads to exactly one row, the right one, and back."""
        self.assert_safe(ref)
        found = resolve.lookup(ref)
        self.assertTrue(found["installed"], ref)
        self.assertEqual([r[column] for r in found["rows"]], [value], ref)
        self.assertEqual(back_from_store(ref), ref)
        self.assertEqual(ids.resolve(str(ref)), ref)
        self.assertEqual(ids.parse_citation(ids.to_citation(ref)), ref, ids.to_citation(ref))
        return found["rows"][0]

    def test_cfr_sections_appendices_and_parts(self):
        seen = set()
        for title in (14, 29, 40, 49):
            rows = self.query(f"title-{title}.sqlite3", "SELECT id, kind, part FROM sections")
            self.assertTrue(rows)
            for r in rows:
                ref = ids.from_store_key("cfr", r["id"], collection=title, kind=r["kind"])
                if r["id"] != "91.5 - 91.7":                 # a reserved range's citation names two sections
                    self.check(ref, "id", r["id"])
                self.assertEqual(ids.from_store_key("cfr", r["id"], collection=title), ref)      # kind is inferred the same
                route = ids.to_route(ref)
                self.assertEqual(unquote(route.rsplit("/", 1)[1]), r["id"])
                self.assertEqual(route.rsplit("/", 1)[0], f"#/title/{title}/section")
                self.assertEqual(store.get_section(dict(ids.to_store_key(ref).where)["id"], title=title)["id"], r["id"])
                seen.add(r["kind"])
            for part in {r["part"] for r in rows}:
                ref = ids.cfr_part(title, part)
                self.assert_safe(ref)
                found = resolve.lookup(ref)["rows"]
                self.assertEqual(sorted(x["id"] for x in found), sorted(r["id"] for r in rows if r["part"] == part))
                self.assertEqual(ids.to_route(ref), f"#/title/{title}/part/{part}")
                self.assertEqual(ids.parse_citation(ids.to_citation(ref)), ref)
        self.assertEqual(seen, {"section", "appendix"})
        ids14 = {r["id"] for r in self.query("title-14.sqlite3", "SELECT id FROM sections")}
        self.assertLessEqual({"71:SFAR No. 97", "91:SFAR No. 97", "Appendix A to Part 91", "91.1(a)-1", "91.5 - 91.7"}, ids14)
        ranged = ids.from_store_key("cfr", "91.5 - 91.7", collection=14, kind="section")
        self.assertEqual([r["id"] for r in resolve.lookup(ranged)["rows"]], ["91.5 - 91.7"])
        self.assertEqual(str(ids.parse_citation("29 CFR 1910.1200(f)(1)")), "reg://federal/cfr/29/1910.1200#(f)(1)")

    def test_usc_sections_including_an_appendix_title(self):
        for title in (4, 128):
            rows = self.query(f"usc-{title}.sqlite3", "SELECT id FROM sections")
            for r in rows:
                ref = ids.from_store_key("usc", r["id"], collection=title)
                self.assertEqual(ids.to_store_key(ref).title, title)
                self.assertEqual(self.check(ref, "id", r["id"])["id"], r["id"])
                route = ids.to_route(ref)
                self.assertEqual((route.rsplit("/", 1)[0], unquote(route.rsplit("/", 1)[1])), (f"#/usc/{title}/section", r["id"]))
                self.assertIsNotNone(usc_store.get_section(title, dict(ids.to_store_key(ref).where)["id"]))
        t4 = {r["id"] for r in self.query("usc-4.sqlite3", "SELECT id FROM sections")}
        self.assertLessEqual({f"8{EN_DASH}1", "50...52", "7", "7~2", "41"}, t4)
        self.assertEqual(str(ids.from_store_key("usc", f"8{EN_DASH}1", collection=4)), "reg://federal/usc/4/8-1")
        self.assertEqual(ids.to_citation("reg://federal/usc/4/8-1"), "4 U.S.C. § 8-1")
        self.assertEqual({r["id"] for r in self.query("usc-128.sqlite3", "SELECT id FROM sections")},
                         {"App-rule1", "Evid-rule1", "pl95-521-s1"})
        self.assertEqual(str(ids.from_store_key("usc", "App-rule1", collection=128)), "reg://federal/usc/28a/App-rule1")

    def test_federal_register_documents_and_page_citations(self):
        rows = self.query("fr.sqlite3", "SELECT document_number, volume, start_page, end_page, citation FROM documents")
        self.assertEqual(len(rows), 3)
        for r in rows:
            ref = ids.from_store_key("fr", r["document_number"])
            self.check(ref, "document_number", r["document_number"])
            self.assertEqual(ids.to_route(ref), f"#/news/fr/{r['document_number']}")
            with fr_store.read_con() as con:
                self.assertIsNotNone(fr_store.get_document(con, dict(ids.to_store_key(ref).where)["document_number"]))
            # Its citation, and any page inside it, lead to the same document.
            for text in (r["citation"], f"{r['volume']} FR {r['end_page']}"):
                page = ids.parse_citation(text)
                self.assertEqual(page.kind, "page")
                self.assert_safe(page)
                self.assertEqual([x["document_number"] for x in resolve.lookup(page)["rows"]], [r["document_number"]])
                self.assertEqual(resolve.report(page)["document"]["id"], ref.id)
        self.assertEqual(resolve.lookup(ids.fr_page(91, 1))["rows"], [])

    def test_constitution_units_and_whole_articles(self):
        rows = self.query("constitution.sqlite3", "SELECT id, label FROM units ORDER BY ord")
        self.assertEqual(len(rows), 7)
        for r in rows:
            ref = ids.from_store_key("constitution", r["id"])
            self.check(ref, "id", r["id"])
            self.assertEqual(ids.to_route(ref), f"#/constitution/{r['id']}")
            self.assertIsNotNone(constitution.get_unit(r["id"]))
            # The store's own label and the citation agree on article, amendment and section.
            self.assertEqual(ids.to_citation(ref).replace("U.S. Const. ", "").replace("art.", "Art.")
                             .replace("amend.", "Amdt.").replace("pmbl.", "Preamble"), r["label"])
        clause = ids.parse_citation("U.S. Const. art. I, § 2, cl. 2")
        self.assertEqual((clause.id, clause.paragraph), ("reg://federal/constitution/us/art1-s2", "cl2"))
        for group, units in (("art1", ["art1-s1", "art1-s2"]), ("amdt14", ["amdt14-s1", "amdt14-s5"])):
            ref = ids.constitution_unit(group)
            self.assertEqual(sorted(r["id"] for r in resolve.lookup(ref)["rows"]), units)
            self.assertEqual(ids.to_route(ref), f"#/constitution/{group}-s1")
            self.assert_safe(ref)

    def test_public_laws_public_and_private(self):
        rows = self.query("plaw.sqlite3", "SELECT id, congress, law_type, number FROM laws")
        self.assertEqual({r["id"] for r in rows}, {"113-1", "114-1", "114-2", "114-pvt-3"})
        for r in rows:
            ref = ids.from_store_key("plaw", r["id"])
            self.check(ref, "id", r["id"])
            self.assertEqual(ref, ids.public_law(r["congress"], r["number"], private=r["law_type"] == "private"))
            self.assertEqual(ids.to_route(ref), f"#/law/{r['id']}")
            self.assertIsNotNone(plaw.get_law(r["id"]))
        self.assertEqual(ids.to_citation("reg://federal/plaw/114/pvt-3"), "Priv. L. 114-3")
        self.assertEqual(str(ids.parse_citation(plaw.get_law("114-1")["citation"])), "reg://federal/plaw/114/1")   # "Public Law 114–1"

    def test_unified_agenda_rules_by_edition_and_by_rin(self):
        rows = self.query("agenda.sqlite3", "SELECT rin, edition FROM entries")
        self.assertEqual(len(rows), 4)
        for r in rows:
            ref = ids.from_store_key("agenda", r["rin"], collection=r["edition"])
            row = self.check(ref, "rin", r["rin"])
            self.assertEqual(row["edition"], r["edition"])
            self.assertEqual(ids.to_route(ref), f"#/news/agenda/{r['rin']}?edition={r['edition']}")
            self.assertIsNotNone(agenda.get_entry(r["rin"], r["edition"]))
            newest = ids.agenda_rule(r["rin"])
            self.assertEqual(self.check(newest, "rin", r["rin"])["edition"], agenda.get_entry(r["rin"])["edition"])
        self.assertEqual(resolve.lookup(ids.agenda_rule("1218-AD00"))["rows"][0]["edition"], "202510")

    def test_cli_prints_id_row_and_route(self):
        def run(*argv: str) -> tuple[int, str, str]:
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = resolve.main(list(argv))
            return code, out.getvalue(), err.getvalue()

        before = sorted(p.name for p in config.DATA_DIR.iterdir())
        code, out, _ = run("29 CFR 1910.134(a)(1)")
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(), [
            "id        reg://federal/cfr/29/1910.134#(a)(1)",
            "kind      cfr section",
            "citation  29 CFR 1910.134(a)(1)",
            "store     title-29.sqlite3 · sections · id = '1910.134'",
            "row       § 1910.134 Respiratory protection.",
            "route     #/title/29/section/1910.134?p=(a)(1)",
            "source    https://www.ecfr.gov/current/title-29/section-1910.134",
        ])
        for text, id_, row, route in (
            ("reg://federal/usc/4/8-1", "reg://federal/usc/4/8-1", f"§ 8{EN_DASH}1 Respect for flag", "#/usc/4/section/8%E2%80%931"),
            ("FR Doc. 2026-20001", "reg://federal/fr/doc/2026-20001", "91 FR 60123 Hazard Communication: Label Elements", "#/news/fr/2026-20001"),
            ("U.S. Const. amend. XIV, § 1", "reg://federal/constitution/us/amdt14-s1", "Amdt. XIV, § 1", "#/constitution/amdt14-s1"),
            ("Pub. L. 114-2", "reg://federal/plaw/114/2", f"Public Law 114{EN_DASH}2 Third law about silica", "#/law/114-2"),
            ("RIN 1218-AD39", "reg://federal/agenda/rin/1218-AD39", "1218-AD39 202510 Heat Injury and Illness Prevention", "#/news/agenda/1218-AD39"),
        ):
            code, out, _ = run(text)
            lines = dict(line.split(None, 1) for line in out.splitlines())
            self.assertEqual((code, lines["id"], lines["row"], lines["route"]), (0, id_, row, route), text)
        # A page citation names the document that holds the page.
        code, out, _ = run("--json", "91 FR 60130")
        match = json.loads(out)["matches"][0]
        self.assertEqual((match["id"], match["route"], match["document"]["id"], match["document"]["route"]),
                         ("reg://federal/fr/91/60130", None, "reg://federal/fr/doc/2026-20001", "#/news/fr/2026-20001"))
        # A bare section needs --title; several citations print one block each.
        self.assertEqual(run("§ 1910.134")[0], 2)
        self.assertIn("reg://federal/cfr/29/1910.134", run("--title", "29", "§ 1910.134")[1])
        code, out, _ = run("29 U.S.C. 653, 655, and 657")
        self.assertEqual((code, re.findall(r"^id +(\S+)$", out, re.M)),
                         (0, ["reg://federal/usc/29/653", "reg://federal/usc/29/655", "reg://federal/usc/29/657"]))
        self.assertIn("row       not installed", out)
        self.assertIn("no such row in the installed copy", run("29 CFR 1910.999")[1])
        # Not a citation: exit 2, a message on stderr, nothing on stdout.
        code, out, err = run("javascript:alert(1)")
        self.assertEqual((code, out), (2, ""))
        self.assertTrue(err.startswith("not resolved: "))
        # `python -m app.resolve` is the same entry point.
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["app.resolve", "--json", "40 CFR 261.3"]), mock.patch.dict(sys.modules), \
                contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as exit_:
            sys.modules.pop("app.resolve", None)             # run it fresh, as `python -m` would
            runpy.run_module("app.resolve", run_name="__main__")
        self.assertEqual(exit_.exception.code, 0)
        self.assertEqual(json.loads(out.getvalue())["matches"][0]["rows"][0]["id"], "261.3")
        # The lookup is read-only: no store was created for the titles that are not installed.
        self.assertEqual(sorted(p.name for p in config.DATA_DIR.iterdir()), before)


if __name__ == "__main__":
    import unittest
    unittest.main()
