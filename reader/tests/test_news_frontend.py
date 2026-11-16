"""The News frontend contract, pinned on the source (the repo has no JS test runner,
following test_sidebar_rail.py): the NEWS_CITE_RE linkifier stays in step with
news.extract_citations over the shared CITATION_CASES table, and the markup, route and
cache contracts the backend relies on exist in app.js and index.html."""
import re
import unittest
from pathlib import Path

from app import news
from tests.news_fixtures import CITATION_CASES

STATIC = Path(__file__).resolve().parent.parent / "static"


class NewsCiteRegexParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = (STATIC / "app.js").read_text(encoding="utf-8")
        m = re.search(r"const NEWS_CITE_RE = /(.+)/gi;", cls.js)
        assert m, "NEWS_CITE_RE not found in app.js"
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


class NewsMarkupContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = (STATIC / "app.js").read_text(encoding="utf-8")
        cls.html = (STATIC / "index.html").read_text(encoding="utf-8")
        cls.css = (STATIC / "styles.css").read_text(encoding="utf-8")

    def test_route_and_loader_exist(self):
        self.assertIn("checkPath === '/news'", self.js)
        self.assertIn("async function loadNews(", self.js)
        self.assertIn("'News · FRAMEWORK'", self.js)

    def test_tabs_match_the_plan(self):
        for key, label in (("all", "All"), ("rules", "Final Rules"), ("rulemaking", "Proposed Rules"),
                           ("enforcement", "Enforcement & Penalties"),
                           ("public_inspection", "Public Inspection"), ("notices", "Notices")):
            with self.subTest(key=key):
                self.assertRegex(self.js, rf"key: '{key}', label: '{re.escape(label)}'")

    def test_card_helpers_exist(self):
        for name in ("newsCardHtml", "fmtMoney", "safeHttpUrl", "extLink", "linkifyNewsText",
                     "newsSectionHref", "newsPartHref", "newsChipsHtml",
                     "newsBylineHtml", "fillNewsActivity", "watchNewsSync",
                     "lsGetJSON", "lsSetJSON"):
            with self.subTest(fn=name):
                self.assertIn(f"function {name}(", self.js)

    def test_uninstalled_titles_fall_back_to_the_library(self):
        self.assertIn("`#/library/${t}`", self.js)

    def test_cache_keys_and_refresh_contract(self):
        self.assertIn("newsCache:v1:", self.js)
        self.assertIn("'/api/news/status'", self.js)
        self.assertIn("'/api/news/refresh'", self.js)
        self.assertIn('{ force: false }', self.js.replace('"', "'"))
        # Only POST /api/news/refresh may start a sync; the feed and status GETs carry
        # no side-effect parameters.
        self.assertNotIn("/api/news?sync", self.js)

    def test_activity_button_and_popover(self):
        self.assertIn('id="btn-news-activity"', self.js)
        self.assertIn('id="news-pop"', self.html)
        self.assertIn("rules & citations", self.js)
        self.assertIn("newsActivityCache", self.js)
        # No interpretation nodes in code or markup (decision 4; the one comment that
        # explains the absence is allowed).
        code = "\n".join(l for l in self.js.splitlines() if not l.strip().startswith("//"))
        self.assertNotIn("interpretation", code.lower())

    def test_news_styles_use_tokens_not_colours(self):
        block = self.css.split("/* ---------- News (#/news) ----------", 1)[1]
        self.assertNotRegex(block, r"#[0-9a-fA-F]{3,6}\b")
        for cls in (".news-breaking", ".news-hero", ".news-grid", ".news-card",
                    ".news-takeaways", ".citation-chip", ".reg-timeline", ".tl-node",
                    ".news-setup", ".news-pop"):
            with self.subTest(cls=cls):
                self.assertIn(cls + " ", block)

    def test_no_emoji_or_unicode_arrows_in_news_js(self):
        start = self.js.index("const NEWS_CATEGORIES")
        end = self.js.index("// --- Pin popover")
        block = self.js[start:end]
        for glyph in ("↗", "›", "→", "🔴", "📰"):
            self.assertNotIn(glyph, block)

    def test_dol_setup_card_links_registration(self):
        self.assertIn("dataportal.dol.gov/registration", self.js)


if __name__ == "__main__":
    unittest.main()
