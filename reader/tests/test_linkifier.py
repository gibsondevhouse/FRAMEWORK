"""Test cross-title and internal citation linkifier regex and rules."""
import unittest

from app.render import clean_label, make_linkifier
from app.render.linkifier import SEMANTIC_XREF_CLASSES
from tests.base import HermeticTestCase
from tests.frontend_sources import combined_css


class TestLinkifier(HermeticTestCase):
    def setUp(self):
        super().setUp()
        # Known IDs fixture
        known_sections = {
            29: {"1910.120", "1910.134", "1910.401", "541.100", "4.6", "4.7", "4.9", "0.735-1"},
            40: {"261.2", "261.3", "261.4"},
            49: {"172.101"},
        }
        installed = [29, 40, 49]

        self.linkifier = make_linkifier(
            known=lambda s: s in known_sections[29],
            title=29,
            known_by_title=lambda t, s: s in known_sections.get(t, set()),
            installed_titles=lambda: installed,
            known_parts=lambda p: p in {"1910", "1926", "1912a", "4022B"},
            section_id="1910.120",
        )

    def test_bare_internal_citation(self):
        text = "Complies with § 1910.120."
        out = self.linkifier(text)
        self.assertIn('href="#/title/29/section/1910.120"', out)
        self.assertIn('class="xref"', out)

    def test_cross_title_section_installed(self):
        text = "Hazardous waste pursuant to 40 CFR § 261.3 and toxic rules."
        out = self.linkifier(text)
        self.assertIn('href="#/title/40/section/261.3"', out)
        self.assertIn('class="xref xref-cross"', out)

    def test_cross_title_bare_section(self):
        text = "Under 49 CFR 172.101 shipping regulations."
        out = self.linkifier(text)
        self.assertIn('href="#/title/49/section/172.101"', out)
        self.assertIn('class="xref xref-cross"', out)

    def test_cross_title_part_installed(self):
        text = "Follow 40 CFR Part 261 procedures."
        out = self.linkifier(text)
        self.assertIn('href="#/title/40/part/261"', out)
        self.assertIn('class="xref xref-cross"', out)

    def test_cross_title_part_is_one_link(self):
        out = self.linkifier("Generators follow 40 CFR part 262 and § 1910.120.")
        self.assertEqual(out.count("<a "), 2)
        self.assertNotRegex(out, r"<a [^>]*>[^<]*<a ")   # no anchor nested in another
        self.assertIn('href="#/title/40/part/262">40 CFR part 262</a>', out)

    def test_cross_title_uninstalled_fallback(self):
        # Title 21 is not installed
        text = "Food safety under 21 CFR § 101.9(c)(1) rules."
        out = self.linkifier(text)
        self.assertIn('href="https://www.ecfr.gov/current/title-21/section-101.9"', out)
        self.assertIn('class="xref xref-external"', out)
        self.assertIn('data-cfr-title="21"', out)
        self.assertIn('data-cfr-section="101.9"', out)
        self.assertIn('data-cfr-part="101"', out)
        self.assertIn('data-cfr-para="(c)(1)"', out)
        self.assertIn('target="_blank"', out)

    def test_paragraph_suffix(self):
        text = "See 40 CFR 261.3(a)(1) for exemptions."
        out = self.linkifier(text)
        self.assertIn('href="#/title/40/section/261.3?p=%28a%29%281%29"', out)

    def test_web_url_linking(self):
        text = "Forms available at https://www.osha.gov/forms and www.dol.gov/whd."
        out = self.linkifier(text)
        self.assertIn('href="https://www.osha.gov/forms"', out)
        self.assertIn('class="xref xref-web"', out)
        self.assertIn('href="https://www.dol.gov/whd"', out)

    def test_usc_linking(self):
        text = "Enforced under 29 U.S.C. 653 and 42 U.S.C. 7401."
        out = self.linkifier(text)
        self.assertIn('href="https://www.law.cornell.edu/uscode/text/29/653"', out)
        self.assertIn('class="xref xref-usc"', out)

    def test_federal_register_linking(self):
        text = "Published at 39 FR 23502 in the Federal Register."
        out = self.linkifier(text)
        self.assertIn('href="https://www.federalregister.gov/citation/39-FR-23502"', out)
        self.assertIn('class="xref xref-fr"', out)

    def test_word_based_section_linking(self):
        text = "Detailed requirements in section 1910.120 of this part."
        out = self.linkifier(text)
        self.assertIn('href="#/title/29/section/1910.120"', out)

    def test_cross_title_plural_and_chained_parts_not_stolen(self):
        out = self.linkifier("Regulated by 40 CFR parts 264 and 265 and 5 CFR part 2634, part 2635, part 2640.")
        self.assertIn('href="#/title/40/part/264">264</a>', out)
        self.assertIn('href="#/title/40/part/265">265</a>', out)
        self.assertNotIn('#/title/29/part/264', out)
        self.assertNotIn('#/title/29/part/2635', out)
        self.assertIn('data-cfr-title="5" data-cfr-part="2635"', out)
        self.assertIn('data-cfr-title="5" data-cfr-part="2640"', out)

    def test_hyphenated_and_range_parts(self):
        out = self.linkifier("Under 41 CFR part 50-201 and 40 CFR parts 1500-1508 and Part 1912a.")
        self.assertIn('part-50-201', out)
        self.assertIn('href="#/title/40/part/1500">1500</a>', out)
        self.assertIn('href="#/title/40/part/1508">1508</a>', out)
        self.assertIn('href="#/title/29/part/1912a"', out)

    def test_unknown_local_part_is_not_linked(self):
        out = self.linkifier("Historical part 1500 is repealed; part 1910 remains active.")
        self.assertNotIn('#/title/29/part/1500', out)
        self.assertIn('#/title/29/part/1910', out)

    def test_web_url_trailing_punctuation_stripped(self):
        out = self.linkifier("Visit (https://www.osha.gov/forms) or www.ansi.org: or https://example.com/a_(b)).")
        self.assertIn('href="https://www.osha.gov/forms">https://www.osha.gov/forms</a>)', out)
        self.assertIn('href="https://www.ansi.org">www.ansi.org</a>:', out)
        self.assertIn('href="https://example.com/a_(b)">https://example.com/a_(b)</a>).', out)

    def test_usc_multiletter_lists_and_ranges(self):
        out = self.linkifier("Under 42 U.S.C. 2000ff(4), 42 U.S.C. 2000gg-2(f), and 29 U.S.C. 651-678.")
        self.assertIn('https://www.law.cornell.edu/uscode/text/42/2000ff', out)
        self.assertIn('https://www.law.cornell.edu/uscode/text/42/2000gg-2', out)
        self.assertIn('https://www.law.cornell.edu/uscode/text/29/651', out)
        self.assertIn('https://www.law.cornell.edu/uscode/text/29/678', out)

    def test_bare_list_ranges_and_contextual_section(self):
        out = self.linkifier("See 40 CFR 261.2 and 261.3, §§ 4.7-4.9, § 4.6 (o), and comply with 1910.134.")
        self.assertIn('#/title/40/section/261.2', out)
        self.assertIn('#/title/40/section/261.3', out)
        self.assertIn('#/title/29/section/4.7', out)
        self.assertIn('#/title/29/section/4.9', out)
        self.assertIn('#/title/29/section/4.6?p=%28o%29', out)
        self.assertIn('#/title/29/section/1910.134', out)

    def test_paragraph_of_section_and_self_paragraph(self):
        out = self.linkifier(
            "See paragraph (a)(3) of § 1910.401 and paragraphs (h)(3)(i) and (ii) of this section."
        )
        self.assertIn('#/title/29/section/1910.401?p=%28a%29%283%29', out)
        self.assertIn('data-local-para="(h)(3)(i)"', out)
        self.assertIn('data-local-para="(h)(3)(ii)"', out)

    def test_clean_label_strips_inline_markup_preserves_math(self):
        self.assertEqual(
            clean_label('Alternative Conditions Under § 1910.401(<span class="standard">a</span>)(3) &amp; x &lt; 5'),
            'Alternative Conditions Under § 1910.401(a)(3) & x < 5',
        )

    def test_semantic_xref_classes_styled_in_reader_css(self):
        css = combined_css()
        for cls in SEMANTIC_XREF_CLASSES:
            if cls == "xref-part":
                continue
            self.assertIn(f".{cls}", css)


if __name__ == "__main__":
    unittest.main()
