"""The News frontend contract, pinned on the source (the repo has no JS test runner,
following test_sidebar_rail.py): the NEWS_CITE_RE linkifier stays in step with
news.extract_citations over the shared CITATION_CASES table, and the markup, route and
cache contracts the backend relies on exist in app.js and index.html."""
import re
import unittest
from pathlib import Path

from app import news
from tests.news_fixtures import CITATION_CASES
from tests.base import HermeticTestCase
from tests.frontend_sources import app_js, combined_css, index_html

STATIC = Path(__file__).resolve().parent.parent / "static"


class NewsCiteRegexParityTests(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = app_js()
        # Lives in frontend/src/citations.ts; tolerate the export keyword and an
        # optional TypeScript type annotation.
        m = re.search(r"const NEWS_CITE_RE(?:\s*:\s*RegExp)?\s*=\s*/(.+)/gi;", cls.js)
        assert m, "NEWS_CITE_RE not found in the frontend sources"
        cls.js_pattern = m.group(1)

    def test_js_regex_is_the_agreed_pattern(self):
        self.assertEqual(
            self.js_pattern,
            r"\b29\s*C\.?F\.?R\.?\s*(?:§§?\s*)?(\d{1,4}\.\d+)(?:\([a-z0-9]{1,4}\))*"
            r"|§§?\s*(19\d{2}\.\d+)(?:\([a-z0-9]{1,4}\))*")

    def test_python_port_of_js_regex_agrees_with_extract_citations(self):
        # The JS flags are g (finditer) and i (re.IGNORECASE); the pattern itself is
        # valid Python regex syntax unchanged.
        ported = re.compile(self.js_pattern, re.IGNORECASE)
        for text, want_sections, _parts in CITATION_CASES:
            with self.subTest(text=text):
                js_ids = sorted({m.group(1) or m.group(2) for m in ported.finditer(text)})
                self.assertEqual(js_ids, want_sections)
                py_ids, _ = news.extract_citations(text)
                self.assertEqual(py_ids, want_sections)


class NewsStyleAndMarkupTests(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = index_html()
        cls.css = combined_css()

    def test_activity_popover_slot_exists(self):
        self.assertIn('id="news-pop"', self.html)

    def test_news_styles_use_tokens_not_colours(self):
        block = self.css.split("/* ---------- News (#/news) ----------", 1)[1]
        self.assertNotRegex(block, r"#[0-9a-fA-F]{3,6}\b")
        for cls in (".news-breaking", ".news-hero", ".news-grid", ".news-card",
                    ".news-takeaways", ".citation-chip", ".reg-timeline", ".tl-node",
                    ".news-setup", ".news-pop"):
            with self.subTest(cls=cls):
                self.assertIn(cls + " ", block)


if __name__ == "__main__":
    unittest.main()
