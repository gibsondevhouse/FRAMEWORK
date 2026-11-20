"""The citation grammar's six new kinds (DM-108) and their time budget (SEC-102).

`citations.parser.extract_reference_spans` now also returns typed spans for Public Laws, the
Statutes at Large, the Constitution, executive orders, RINs and dockets. Four things are held
here:

* each kind is read from the forms that really occur: text taken from the test fixtures (the
  U.S.C., Public Law, Federal Register, Agenda and Constitution fakes) and excerpts copied
  verbatim from CFR Authority lines and U.S.C. source credits on the development install;
* near misses are not read (an FAA "Amdt. 25-72" is not the 25th Amendment);
* nothing that existed before changed: the earlier patterns are pinned by a hash of their
  source, the earlier spans by a digest recorded before this grammar was added, and the
  reader's linkifier still links none of the new kinds;
* no new pattern can be made to hang: each one, and the extractor as a whole, runs inside a
  time budget on adversarial strings and on a text longer than any stored section.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
import time
from pathlib import Path
from unittest import mock

from app import ids, plaw
from app.citations import parser
from app.ingest import uslm
from app.render.linkifier import make_linkifier
from tests import fake_titles, news_fixtures
from tests.base import HermeticTestCase
from tests.test_fr_corpus import HAZCOM
from tests.test_new_corpora import CONSTITUTION_XML, HEAT, plaw_xml
from tests.test_usc_corpus import USLM_T4

NEW_KINDS = ("public_law", "private_law", "stat", "constitution", "executive_order", "rin", "docket")
NEW_PATTERNS = ("PUBLIC_LAW_RE", "PUBLIC_LAW_MORE_RE", "STAT_RE", "STAT_MORE_RE", "CONST_RE", "CONST_AMENDMENT_RE",
                "EXEC_ORDER_RE", "EXEC_ORDER_MORE_RE", "RIN_RE", "RIN_LABELED_RE", "DOCKET_RE", "DOCKET_LABELED_RE")
PATTERN_BUDGET_SEC = 1.0      # one pattern over 200,000 adversarial characters; real times are milliseconds
TEXT_BUDGET_SEC = 5.0         # the whole extractor over a two-megabyte text


def new_spans(text: str, kind: str | None = None) -> list[tuple]:
    """(kind, target, paragraph) of the new-kind spans, in order."""
    return [(s.kind, s.target, s.paragraph) for s in parser.extract_reference_spans(text, 29)
            if s.kind in NEW_KINDS and (kind is None or s.kind == kind)]


def targets(text: str, kind: str) -> list[str]:
    return [t for _, t, _ in new_spans(text, kind)]


class NewKindTests(HermeticTestCase):
    def test_public_laws(self):
        for text, want in (
            ("Pub. L. 91-596", ["91-596"]),
            ("Public Law 91–596", ["91-596"]),
            ("Pub. L. No. 118-5, 137 Stat. 10 (2023)", ["118-5"]),
            ("the Unfunded Mandates Reform Act of 1995 (Pub. L. 104-4)", ["104-4"]),
            ("P.L. 104-4 and PL 104-13", ["104-4", "104-13"]),
            ("Public Laws 99-578 and 101-552, 31 U.S.C. 321", ["99-578", "101-552"]),
            ("Pub. L. 104-208, 110-175, and 114-185, 130 Stat. 538", ["104-208", "110-175", "114-185"]),
            ("Pub.L. 93–454, § 8", ["93-454"]),
        ):
            self.assertEqual(targets(text, "public_law"), want, text)
        self.assertEqual(new_spans("Priv. L. 113-1 and Private Law 113–2"),
                         [("private_law", "113-1", ""), ("private_law", "113-2", "")])
        # A date after a law is not a second law, and "PL" needs its numbers.
        self.assertEqual(targets("Pub. L. 93-454, 10-18-74, as amended", "public_law"), ["93-454"])
        self.assertEqual(new_spans("the PL spec, Publication L-5 and Pub. L. 0-0"), [])

    def test_statutes_at_large(self):
        self.assertEqual(new_spans("84 Stat. 1590"), [("stat", "84-Stat-1590", "")])
        self.assertEqual(new_spans("December 28, 2001, 115 Stat 272"), [("stat", "115-Stat-272", "")])
        # Later pages of the same law are pin cites of one citation, in rising order only.
        self.assertEqual(new_spans("Secs. 3, 208, 73 Stat. 520, 529, 530, 532, 534 (29 U.S.C. 402, 438)", "stat"),
                         [("stat", "73-Stat-520", "529, 530, 532, 534")])
        self.assertEqual(new_spans("118 Stat. 3807 , 3808; Pub. L. 116–2", "stat"), [("stat", "118-Stat-3807", "3808")])
        # The number after a page is not a pin when it opens another citation.
        for text, want in (("86 Stat. 789, 790, 41 U.S.C. 353", "790"), ("64 Stat. 1267, 5 U.S.C. App.", ""),
                           ("104 Stat. 890, 28 U.S.C. 2461", ""), ("86 Stat. 816, 91 Stat. 1567", ""),
                           ("118 Stat. 2809, 3 CFR part 100", ""), ("89 Stat. 1049, 40 FR 1234", ""),
                           ("72 Stat. 1141 , § 610", ""), ("84 Stat. 1590, 12", "")):
            self.assertEqual(new_spans(text, "stat")[0][2], want, text)
        self.assertEqual(new_spans("Rev. Stat. § 1979; 10 Stations; Stat. 5; 0 Stat. 1"), [])

    def test_constitution(self):
        for text, want in (
            ("U.S. Const. art. I, § 8, cl. 3", ("art1-s8", "cl3")),
            ("U.S. Const. amend. XIV, § 1", ("amdt14-s1", "")),
            ("U.S. Const. amend. XIV", ("amdt14", "")),
            ("US Constitution, Article II, Section 2, Clause 2", ("art2-s2", "cl2")),
            ("U.S. Const. art. 5", ("art5", "")),
            ("U.S. Const. pmbl.", ("preamble", "")),
            ("see amend. XIV, § 5", ("amdt14-s5", "")),
            ("Amdt. V rights", ("amdt5", "")),
        ):
            self.assertEqual(new_spans(text), [("constitution", *want)], text)
        both = "U.S. Const. amend. V and amend. XIV"            # the bare form is not read twice
        self.assertEqual(targets(both, "constitution"), ["amdt5", "amdt14"])
        # Not the Constitution: FAA amendment numbers, articles of anything else, numbers it lacks.
        for text in ("Amdt. 25-72, 55 FR 29785", "Amdt. 91-211", "art. III of the Convention", "amend. 5",
                     "U.S. Const. art. VIII", "U.S. Const. amend. XXVIII", "U.S. Const. amend. IIII",
                     "Amendment No. 1552-1", "Amdt. V-2", "the agency may amend it"):
            self.assertEqual(targets(text, "constitution"), [], text)
        # A known limit of the bare form: a sentence that ends in "amend." before the word "I".
        self.assertEqual(targets("which it shall amend. I concur.", "constitution"), ["amdt1"])

    def test_executive_orders(self):
        for text, want in (
            ("E.O. 12866", ["12866"]),
            ("Executive Order 12866", ["12866"]),
            ("Executive Order No. 14094 of April 6, 2023", ["14094"]),
            ("Executive Order (E.O.) 14247, Modernizing Payments", ["14247"]),
            ("EO 13563", ["13563"]),
            ("E.O. 9066", ["9066"]),
            ("Executive Orders 12866, 13563, and 14094", ["12866", "13563", "14094"]),
            ("E.O.s 12866 and 13563", ["12866", "13563"]),
            ("E.O. 12549 (3 CFR, 1986 Comp., p. 189); E.O. 12689 (3 CFR, 1989 Comp., p. 235)", ["12549", "12689"]),
        ):
            self.assertEqual(targets(text, "executive_order"), want, text)
        # What follows an order is its Federal Register citation or a year, not another order.
        for text in ("E.O. 12107, 44 FR 1055, 3 CFR, 1978 Comp., p. 264", "E.O. 12866, 1993", "E.O. 12866, 58 FR 51735",
                     "E.O. 10577, 3 CFR, 1954-1958 Comp., p. 218"):
            self.assertEqual(len(targets(text, "executive_order")), 1, text)
        self.assertEqual(new_spans("an Executive Order signed on January 20, 2021; GEO 12345; EOC 12345; E.O. 12"), [])

    def test_rins(self):
        for text, want in (
            ("RIN 1218-AD39", ["1218-AD39"]),
            ("by searching by the RIN: 1235-AA51. Proposed rule", ["1235-AA51"]),
            ("1218–AD39", ["1218-AD39"]),
            ("RIN 7100 AG79", ["7100-AG79"]),                       # the Federal Register sometimes prints a space
            ("RINs 1218-AD00 and 2060-AV00", ["1218-AD00", "2060-AV00"]),
        ):
            self.assertEqual(targets(text, "rin"), want, text)
        for text in ("7100 AG79", "RIN 3206-XXXX", "RIN 1210-ACO5", "11218-AD39", "1218-AD390", "1218-ad39", "x1218-AD39",
                     "renewable identification number (RIN) retirement"):
            self.assertEqual(targets(text, "rin"), [], text)

    def test_dockets(self):
        for text, want in (
            ("must be submitted in Docket No. OSHA-2020-0004 on or before", ["OSHA-2020-0004"]),
            ("EPA-HQ-OAR-2021-0317", ["EPA-HQ-OAR-2021-0317"]),
            ("EPA-R09-OAR-2022-0131, FRL-10180-02-R2", ["EPA-R09-OAR-2022-0131"]),
            ("FDA-2019-N-5959", ["FDA-2019-N-5959"]),
            ("comment EPA-HQ-OAR-2021-0317-0042", ["EPA-HQ-OAR-2021-0317"]),       # a document id names its docket
            ("Docket ID No. EPA-HQ-OW-2022-0114.", ["EPA-HQ-OW-2022-0114"]),
            ("Docket No. RM20-10-000", ["RM20-10-000"]),
            ("Docket Number USCG-2020-0278; Docket ID: 2020-0001.", ["USCG-2020-0278", "2020-0001"]),
        ):
            self.assertEqual(targets(text, "docket"), want, text)
        for text in ("FRL-13016-02-R1", "Amendment No. 1552-1", "Notice 2024-13", "Docket No. EP 711 (Sub-No. 1)",
                     "included in the docket for this action", "AB-CD-1850-0001", "osha-2020-0004"):
            self.assertEqual(targets(text, "docket"), [], text)

    def test_every_span_points_at_its_own_text(self):
        text = ("Authority: 33 U.S.C. 1251 et seq.; 86 Stat. 816, Pub. L. 92-500; E.O. 11738 (3 CFR, 1973 Comp., p. 799); "
                "U.S. Const. art. I, § 8, cl. 3; RIN 1218-AD39; Docket No. OSHA-2020-0004; Priv. L. 113-1.")
        spans = [s for s in parser.extract_reference_spans(text, 29) if s.kind in NEW_KINDS]
        self.assertEqual([s.kind for s in spans],
                         ["public_law", "private_law", "stat", "constitution", "executive_order", "rin", "docket"])
        for s in spans:
            piece = text[s.start:s.end]
            self.assertTrue(0 <= s.start < s.end <= len(text))
            self.assertIn(re.sub(r"\D", "", s.target.split("-")[-1]) or s.target, piece, (s.kind, piece))
            self.assertEqual((s.title, s.url), (None, ""))             # nothing here is a link

    def test_addresses_for_the_kinds_that_have_one(self):
        text = "Pub. L. 91-596, 84 Stat. 1590; U.S. Const. amend. XIV, § 1; E.O. 12866; RIN 1218-AD39; Docket No. OSHA-2020-0004"
        self.assertEqual([str(r) for r in ids.find_citations(text)],
                         ["reg://federal/plaw/91/596", "reg://federal/constitution/us/amdt14-s1", "reg://federal/agenda/rin/1218-AD39"])
        by_kind = {s.kind: ids.from_span(s) for s in parser.extract_reference_spans(text, 29)}
        self.assertEqual({k for k, v in by_kind.items() if v is None}, {"stat", "executive_order", "docket"})
        # A reading the Constitution cannot hold is a span but not an address.
        odd = parser.extract_reference_spans("U.S. Const. amend. XIV, § 9", 29)
        self.assertEqual([(s.target, ids.from_span(s)) for s in odd], [("amdt14-s9", None)])
        self.assertEqual((parser.roman_number("XXVII"), parser.roman_number("IIII"), parser.roman_number("")), (27, None, None))


class StoredTextTests(HermeticTestCase):
    """Real examples: text the fixtures store, and excerpts copied from the development install."""

    def test_usc_fixture_source_credit_notes_and_heading(self):
        tmp = Path(tempfile.mkdtemp(prefix="grammar-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        (tmp / "usc04.xml").write_text(USLM_T4.replace("{rp}", "119-142"), encoding="utf-8")
        recs = []
        uslm.parse_title(tmp / "usc04.xml", recs.append, lambda *a: None)
        by = {r["id"]: r for r in recs}
        self.assertEqual(new_spans(by["1"]["source_credit"]), [("stat", "61-Stat-642", "")])       # "61 Stat. 642"
        notes = " ".join(n["text"] for n in by["1"]["notes"])
        self.assertEqual(set(new_spans(notes)), {("public_law", "115-123", "")})                    # "Pub. L. 115–123", twice
        self.assertEqual(new_spans(by["2"]["heading"]), [("public_law", "98-1", "")])               # "Repealed. Pub. L. 98-1]"

    def test_public_law_fixture_citation_and_statute(self):
        law = plaw.parse_law(plaw_xml(114, 1, "Second law", '<ref href="/us/usc/t42/s6921">42 U.S.C. 6921</ref>', "42 USC 6921a."))
        self.assertEqual(new_spans(law["citation"]), [("public_law", "114-1", "")])                 # "Public Law 114–1"
        self.assertEqual(new_spans(law["statute"]), [("stat", "137-Stat-10", "")])
        self.assertEqual(new_spans(law["text"]), [])                                                # and nothing invented

    def test_federal_register_and_agenda_fixtures(self):
        self.assertEqual([targets(d, "docket") for d in HAZCOM["docket_ids"]], [["OSHA-2026-0001"]])
        self.assertEqual([targets(r, "rin") for r in HAZCOM["regulation_id_numbers"]], [["1218-AD00"]])
        self.assertEqual(targets(HEAT["rin"], "rin"), ["1218-AD39"])
        dockets = [d for a in news_fixtures.__dict__.values() if isinstance(a, dict) for d in a.get("docket_ids", [])]
        self.assertIn("Docket No. ETA-2025-0003", dockets)
        self.assertEqual(targets("Docket No. ETA-2025-0003", "docket"), ["ETA-2025-0003"])

    def test_constitution_citation_the_reader_copies(self):
        # The form the Constitution reader's Cite button writes, for a unit the fixture holds.
        self.assertIn('id="article-I-2-2"', CONSTITUTION_XML)
        span = parser.extract_reference_spans("U.S. Const. art. I, § 2, cl. 2", 29)[0]
        self.assertEqual((span.kind, span.target, span.paragraph), ("constitution", "art1-s2", "cl2"))
        self.assertEqual(str(ids.from_span(span)), "reg://federal/constitution/us/art1-s2#cl2")

    def test_fake_cfr_text_has_no_new_kinds(self):
        for xml in fake_titles.XML.values():
            self.assertEqual(new_spans(re.sub(r"<[^>]+>", " ", xml)), [])

    def test_authority_lines_copied_from_installed_titles(self):
        # Verbatim from eCFR Authority lines (Titles 29, 31, 40 and 5 on the development install, 2026-11-20).
        lines = (
            "Authority: 33 U.S.C. 1311(b) and (c), 1318 and 1361; 86 Stat. 816, Pub. L. 92-500; 91 Stat. 1567, Pub. L. 95-217; 101 Stat. 7, Pub. L. 100-4.",
            "Authority: 31 U.S.C. 3801-3812; 28 U.S.C. 2461 note (Pub. L. 101-410, 104 Stat. 890, as amended); E.O. 12107, 44 FR 1055, 3 CFR, 1978 Comp., p. 264.",
            "Authority: Secs. 3, 208, 301, 401, 402, 73 Stat. 520, 529, 530, 532, 534 (29 U.S.C. 402, 438, 461, 481, 482); Secretary's Order No. 03-2012, 77 FR 69376, November 16, 2012.",
            "Authority: 5 U.S.C. 3301, 3302; E.O. 10577, 3 CFR, 1954-1958 Comp., p. 218; sec. 511, Pub. L. 106-117, 113 Stat. 1575; E.O. 13668, 79 FR 31019, 3 CFR, 2014 Comp., p. 248.",
            "Authority: Sec. 7, 52 Stat. 1063, as amended; 29 U.S.C. 207, unless otherwise noted. Pub. L. 106-151, 113 Stat. 1731 (29 U.S.C. 203, 207).",
        )
        self.assertEqual([new_spans(line) for line in lines], [
            [("public_law", "92-500", ""), ("public_law", "95-217", ""), ("public_law", "100-4", ""),
             ("stat", "86-Stat-816", ""), ("stat", "91-Stat-1567", ""), ("stat", "101-Stat-7", "")],
            [("public_law", "101-410", ""), ("stat", "104-Stat-890", ""), ("executive_order", "12107", "")],
            [("stat", "73-Stat-520", "529, 530, 532, 534")],
            [("public_law", "106-117", ""), ("stat", "113-Stat-1575", ""), ("executive_order", "10577", ""), ("executive_order", "13668", "")],
            [("public_law", "106-151", ""), ("stat", "52-Stat-1063", ""), ("stat", "113-Stat-1731", "")],
        ])

    def test_source_credits_copied_from_installed_titles(self):
        # Verbatim from OLRC source credits (Titles 16 and 38), with the spaces the stored text has around references.
        credits = (
            "( Pub. L. 93–454, § 8 , Oct. 18, 1974 , 88 Stat. 1377 .)",
            "( June 19, 1948, ch. 546, § 1 , 62 Stat. 532 ; July 26, 1947, ch. 343 , title II, § 205(a), 61 Stat. 501 ; Pub. L. 95–616, § 8 , Nov. 8, 1978 , 92 Stat. 3115 .)",
            "(Added Pub. L. 105–368, title X, § 1001(a)(1) , Nov. 11, 1998 , 112 Stat. 3363 ; amended Pub. L. 117–137, § 1(a) , June 7, 2022 , 136 Stat. 1254 .)",
            "( Pub. L. 108–447, div. E, title I, § 144 , Dec. 8, 2004 , 118 Stat. 3807 , 3808; Pub. L. 116–260, div. FF, title XVIII, § 1801 , Dec. 27, 2020 , 134 Stat. 3299 .)",
        )
        self.assertEqual([new_spans(c) for c in credits], [
            [("public_law", "93-454", ""), ("stat", "88-Stat-1377", "")],
            [("public_law", "95-616", ""), ("stat", "62-Stat-532", ""), ("stat", "61-Stat-501", ""), ("stat", "92-Stat-3115", "")],
            [("public_law", "105-368", ""), ("public_law", "117-137", ""), ("stat", "112-Stat-3363", ""), ("stat", "136-Stat-1254", "")],
            [("public_law", "108-447", ""), ("public_law", "116-260", ""), ("stat", "118-Stat-3807", "3808"), ("stat", "134-Stat-3299", "")],
        ])


# sha256[:16] of each earlier pattern's source, with its group count: recorded on main before DM-108.
EARLIER_PATTERNS = {
    "XREF_RE": (2, "43165f81020a8b96"), "WORD_SEC_RE": (2, "824f12d5cf9e82fa"), "NUM_IN_LIST_RE": (2, "3d6611120a474b50"),
    "SECTION_ITEM_RE": (2, "cc1449a915d0dca5"), "CROSS_TITLE_RE": (5, "652b9234b5158da0"), "XREF_EXT_RE": (2, "760460b7c4913b1f"),
    "WORD_SEC_EXT_RE": (2, "b61566319d7c0f3b"), "CROSS_TITLE_PARTS_RE": (3, "18454751676dffc4"),
    "CROSS_TITLE_EXT_RE": (5, "dc30018f98c32f2b"), "WEB_URL_RE": (1, "a8a208ad6ae7f4c6"), "USC_RE": (3, "f4f23a8c2b85cf52"),
    "FR_RE": (2, "ad0676a1fa7f6539"), "WORD_PART_RE": (2, "e661134abf5e4953"), "CONTEXT_BARE_SEC_RE": (3, "9afb59a612452184"),
    "PARA_OF_SEC_RE": (4, "f75c6b9b6a13f12b"), "PARA_SELF_RE": (3, "3815038e38b22678"),
}
# (span count, sha256[:16]) of the earlier kinds' spans for five texts, recorded the same way.
EARLIER_SPANS = {
    "fake title 29": (12, "210ecefcf47aafc2"), "fake title 40": (3, "4696f946903d086b"), "fake title 49": (2, "67ff49c4c621eefe"),
    "news citation cases": (6, "8b77689c4b581a7f"), "authority line": (12, "6c45634e0c730126"),
}


class UnchangedTests(HermeticTestCase):
    def test_earlier_patterns_and_group_layouts_are_untouched(self):
        for name, (groups, digest) in EARLIER_PATTERNS.items():
            pattern = getattr(parser, name)
            self.assertEqual((pattern.groups, hashlib.sha256(pattern.pattern.encode()).hexdigest()[:16]), (groups, digest), name)

    def test_earlier_spans_are_byte_for_byte_the_same_and_come_first(self):
        texts = {f"fake title {t}": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", xml)) for t, xml in fake_titles.XML.items()}
        texts["news citation cases"] = " | ".join(c[0] for c in news_fixtures.CITATION_CASES)
        texts["authority line"] = (
            "Authority: 29 U.S.C. 653, 655, 657; Secretary of Labor's Order No. 12-71 (36 FR 8754), 8-76 (41 FR 25059), "
            "or 1-2012 (77 FR 3912), as applicable; and 29 CFR part 1911. Sections 1910.141 and 1910.142 also issued under "
            "5 U.S.C. 553; see 40 CFR parts 264 and 265, 49 CFR 172.101(a)(1), and https://www.osha.gov/laws-regs.")
        self.assertEqual(set(texts), set(EARLIER_SPANS))
        for name, text in texts.items():
            for extra in ("", " Pub. L. 91-596, 84 Stat. 1590; E.O. 12866; RIN 1218-AD39; Docket No. OSHA-2020-0004."):
                spans = parser.extract_reference_spans(text + extra, 29)
                earlier = [s for s in spans if s.kind not in NEW_KINDS]
                self.assertEqual(spans[:len(earlier)], earlier, name)                 # the new kinds only ever follow
                blob = json.dumps([[s.kind, s.raw, s.title, s.target, s.paragraph, s.url, s.start, s.end] for s in earlier],
                                  ensure_ascii=True)
                self.assertEqual((len(earlier), hashlib.sha256(blob.encode()).hexdigest()[:16]), EARLIER_SPANS[name], name)

    def test_the_reader_links_none_of_the_new_kinds(self):
        linkify = make_linkifier(lambda sid: True, title=29, installed_titles=lambda: [29])
        text = ("Pub. L. 91-596, 84 Stat. 1590; Public Law 91–596; U.S. Const. art. I, sec. 8, cl. 3; amend. XIV; "
                "E.O. 12866; Executive Order 12866; RIN 1218-AD39; Docket No. OSHA-2020-0004.")
        self.assertEqual(len(new_spans(text)), 9)
        self.assertEqual(linkify(text), text)                                          # not one anchor


def attacks(n: int) -> list[str]:
    """Strings built to make a careless pattern backtrack: long runs of each optional or
    repeated piece, cut off just before the piece that would let a match finish."""
    return [
        " " * n, "-" * n, "(" * n, "§" * n, "a" * n, "9" * n, ". " * n, "A-" * n, ", " * n, "9, " * n, "IVXLC" * (n // 5),
        "Pub. L. " * (n // 8), "Pub" + " " * n + "L. 1-1", "Pub. L. No. " + "1" * n, "P.L." * (n // 4), "Public Laws 1-1" + ", 11-1" * (n // 6),
        "Pub. L. 11-1" + " and 11-1" * (n // 9) + " and", "Priv" + "." * n,
        "1 Stat. " * (n // 8), "9" * n + " Stat. 1", "1 Stat. 1" + ", 1" * (n // 3), "1 Stat. 1, " + ", ".join(str(i) for i in range(2, n // 6)),
        "1 Stat" + " " * n, "1 Stat. 1" + ", 2 Stat" * (n // 8),
        "U.S. Const. " * (n // 12), "U.S. Const. art. I" + ", § 1" * (n // 5), "U.S. Const. art. " + "I" * n, "U" + "." * n,
        "U.S. Const." + " " * n + "art. I", "amend. " * (n // 7), "amend. " + "X" * n, "amend. X" + ", cl. 1" * (n // 7),
        "E.O. " * (n // 5), "Executive Orders 12866" + ", 12866" * (n // 7), "Executive" + " " * n + "Order 12866",
        "E.O. (E.O.) " * (n // 12), "E.O. No. " + "1" * n, "EO" * (n // 2),
        "RIN " * (n // 4), "1218-" * (n // 5), "RIN: 1218" + " " * n, "1" * n + "-AD39", "RIN 1218 " * (n // 9),
        "EPA-" * (n // 4), "A" * n + "-2020-0001", "EPA-HQ-OAR-" * (n // 11), "EPA-HQ-OAR-2020" + "-0001" * (n // 5),
        "Docket No. " * (n // 11), "Docket No. A" + "-a" * (n // 2), "Docket ID ID ID " * (n // 16), "Docket" + " " * n + "No. 1",
    ]


class TimeBudgetTests(HermeticTestCase):
    def test_no_new_pattern_can_be_made_to_hang(self):
        worst = (0.0, "", "")
        for attack in attacks(200_000):
            for name in NEW_PATTERNS:
                pattern = getattr(parser, name)
                start = time.perf_counter()
                for _ in pattern.finditer(attack):
                    pass
                pattern.match(attack, len(attack) // 2)                # the list patterns are used anchored
                took = time.perf_counter() - start
                worst = max(worst, (took, name, attack[:24]))
                self.assertLess(took, PATTERN_BUDGET_SEC, (name, attack[:24], len(attack)))
        self.assertLess(worst[0], PATTERN_BUDGET_SEC, worst)

    def test_new_kind_extraction_is_bounded_on_adversarial_text(self):
        for attack in attacks(200_000):
            start = time.perf_counter()
            spans = parser._new_kind_spans(attack)
            self.assertLess(time.perf_counter() - start, TEXT_BUDGET_SEC, attack[:24])
            for s in spans:                                             # and what it does read is well formed
                self.assertIn(s.kind, NEW_KINDS)
                self.assertTrue(0 <= s.start < s.end <= len(attack) and len(s.target) <= 64)

    def test_a_text_longer_than_any_stored_section_stays_inside_the_budget(self):
        # The largest section on the development install is 1.2 million characters (40 CFR
        # part 136, Appendix A) and the largest law 6.1 million. Here: the fixtures' longest
        # section and real Authority and source-credit lines, repeated past two million.
        section = re.sub(r"<[^>]+>", " ", fake_titles.XML[29])
        line = ("Authority: 33 U.S.C. 1311(b); 86 Stat. 816, Pub. L. 92-500; E.O. 12107, 44 FR 1055, 3 CFR, 1978 Comp., p. 264; "
                "( Pub. L. 108–447, div. E, § 144 , Dec. 8, 2004 , 118 Stat. 3807 , 3808.) RIN 1218-AD39, Docket No. OSHA-2020-0004, "
                "U.S. Const. amend. XIV, § 1. ")
        unit = section + " " + line
        text = unit * (2_000_000 // len(unit) + 1)
        self.assertGreater(len(text), 2_000_000)
        start = time.perf_counter()
        spans = parser.extract_reference_spans(text, 29)
        self.assertLess(time.perf_counter() - start, TEXT_BUDGET_SEC)
        repeats = len(text) // len(unit)
        counts = {k: sum(1 for s in spans if s.kind == k) for k in NEW_KINDS}
        self.assertEqual(counts, {"public_law": 2 * repeats, "private_law": 0, "stat": 2 * repeats, "constitution": repeats,
                                  "executive_order": repeats, "rin": repeats, "docket": repeats})

    def test_input_length_is_capped_for_the_new_kinds(self):
        text = "Pub. L. 91-596 " + "x" * 100 + " Pub. L. 92-1 and 29 U.S.C. 655"
        with mock.patch.object(parser, "NEW_KIND_SCAN_LIMIT", 50):
            spans = parser.extract_reference_spans(text, 29)
        self.assertEqual([(s.kind, s.target) for s in spans], [("usc", "655"), ("public_law", "91-596")])
        self.assertGreaterEqual(parser.NEW_KIND_SCAN_LIMIT, 6_200_000)        # above the largest stored text


if __name__ == "__main__":
    import unittest
    unittest.main()
