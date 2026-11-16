"""Section units (clauses, embedded appendices), paragraph levels for (i)/(v)/(x), and figure URLs."""
import unittest
import xml.etree.ElementTree as ET

from app.render import compute_levels, image_urls, marker_tokens, section_doc
from tests.base import HermeticTestCase


def doc(body: str):
    xml = f'<DIV8 N="1.1" TYPE="SECTION"><HEAD>§ 1.1 Test.</HEAD>{body}<CITA>[1 FR 1]</CITA></DIV8>'
    return section_doc(xml, known=lambda s: False, title=29)


def levels_by_text(body: str) -> dict[str, int]:
    root = ET.fromstring(f"<DIV8>{body}</DIV8>")
    levels = compute_levels(root)
    return {(e.text or "").strip()[:12]: levels[id(e)] for e in root.iter() if marker_tokens(e)}


class LevelTests(HermeticTestCase):
    def test_letter_i_after_h_is_a_clause(self):
        lv = levels_by_text(
            "<P>(h) <I>Training.</I></P><P>(1) One.</P><P>(2) Two.</P><P>(3) Three.</P>"
            "<P>(i) <I>Trade secrets.</I> (1) Text.</P><P>(2) More.</P><P>(j) <I>Dates.</I></P>"
        )
        self.assertEqual(lv["(i)"], 1)
        self.assertEqual(lv["(j)"], 1)

    def test_roman_i_followed_by_ii_is_nested(self):
        lv = levels_by_text("<P>(c) <I>Definitions.</I></P><P>(i) Which is formed</P><P>(ii) Which has</P>")
        self.assertEqual(lv["(i) Which is"], 3)
        self.assertEqual(lv["(ii) Which h"], 3)

    def test_roman_v_ending_a_list_stays_nested(self):
        lv = levels_by_text(
            "<P>(u) <I>U.</I></P><P>(1) One.</P><P>(i) a</P><P>(ii) b</P><P>(iii) c</P>"
            "<P>(iv) d</P><P>(v) e</P><P>(2) Two.</P>"
        )
        self.assertEqual(lv["(v) e"], 3)


class UnitTests(HermeticTestCase):
    BODY = (
        "<P>Applies to everyone.</P>"
        "<P>(a) <I>Purpose.</I> Why.</P><P>(1) Detail.</P>"
        "<P>(b) <I>Scope.</I> Who.</P>"
        "<NOTE><HED>Note:</HED><P>A note in (b).</P></NOTE>"
        "<EXTRACT><HD1>Appendix A to § 1.1—Small Appendix (Mandatory)</HD1><P>Short.</P></EXTRACT>"
    )

    def test_clauses_and_appendix(self):
        d = doc(self.BODY)
        keys = [u["key"] for u in d.units]
        self.assertEqual(keys, ["a", "b", "appendix-a"])
        a, b, app = d.units
        self.assertEqual(a["title"], "Purpose")
        self.assertEqual(b["title"], "Scope")
        self.assertEqual(app["group_label"], "Appendix A")
        self.assertEqual(app["group_title"], "Small Appendix (Mandatory)")
        # Text before (a) joins (a); the note stays with (b).
        self.assertIn("Applies to everyone", d.unit_html("a"))
        self.assertIn("A note in (b)", d.unit_html("b"))
        self.assertEqual(d.mode, "units")  # an embedded appendix is enough

    def test_appendix_renders_without_extract_box(self):
        d = doc(self.BODY)
        self.assertNotIn("reg-extract", d.unit_html("appendix-a"))
        self.assertNotIn("reg-extract", d.full_html())

    def test_long_appendix_splits_at_its_headings(self):
        filler = "<P>" + ("word " * 2000) + "</P>"
        d = doc(
            "<P>(a) <I>Purpose.</I> Why.</P>"
            "<EXTRACT><HD1>Appendix A to § 1.1—Criteria</HD1>"
            f"<HD1>A.1 Acute Toxicity</HD1>{filler}"
            "<HD1>Figure A.1.1: Not a chapter</HD1>"
            f"<HD1>A.2—Skin Corrosion</HD1>{filler}</EXTRACT>"
        )
        chapters = [u for u in d.units if u["kind"] == "chapter"]
        self.assertEqual([(u["label"], u["title"]) for u in chapters],
                         [("A.1", "Acute Toxicity"), ("A.2", "Skin Corrosion")])
        self.assertEqual(d.find("appendix-a")["key"], chapters[0]["key"])  # group key opens its first chapter
        self.assertIn("Figure A.1.1", d.unit_html(chapters[0]["key"]))

    def test_short_section_is_one_page(self):
        d = doc("<P>(a) <I>One.</I> x</P><P>(b) <I>Two.</I> y</P>")
        self.assertEqual(d.mode, "page")
        self.assertEqual(d.full_html().count('class="reg-unit"'), 2)
        self.assertIn("reg-history", d.full_html())

    def test_unknown_unit_falls_back_to_first(self):
        d = doc(self.BODY)
        self.assertEqual(d.find("zz")["key"], "a")


class ImageTests(HermeticTestCase):
    def test_federal_register_figures(self):
        show, full = image_urls("/graphics/er08ja26.000.gif")
        self.assertEqual(show, "https://img.federalregister.gov/ER08JA26.000/ER08JA26.000_large.png")
        self.assertTrue(full.endswith("_original_size.png"))

    def test_legacy_and_unsafe(self):
        self.assertTrue(image_urls("/graphics/53-49a.eps.gif")[0].startswith("https://www.ecfr.gov/"))
        self.assertIsNone(image_urls("javascript:alert(1)"))


if __name__ == "__main__":
    unittest.main()
