"""Test cross-title and internal citation linkifier regex and rules."""
import unittest

from app.render import make_linkifier


class TestLinkifier(unittest.TestCase):
    def setUp(self):
        # Known IDs fixture
        known_sections = {
            29: {"1910.120", "1910.134", "541.100"},
            40: {"261.3", "261.4"},
            49: {"172.101"},
        }
        installed = [29, 40, 49]

        self.linkifier = make_linkifier(
            known=lambda s: s in known_sections[29],
            title=29,
            known_by_title=lambda t, s: s in known_sections.get(t, set()),
            installed_titles=lambda: installed,
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

    def test_cross_title_uninstalled_fallback(self):
        # Title 21 is not installed
        text = "Food safety under 21 CFR § 101.9 rules."
        out = self.linkifier(text)
        self.assertIn('href="https://www.ecfr.gov/current/title-21/section-101.9"', out)
        self.assertIn('class="xref xref-external"', out)
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


if __name__ == "__main__":
    unittest.main()
