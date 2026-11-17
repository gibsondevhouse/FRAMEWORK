"""Playwright behavioral tests for Milestone 3 (Phases 5, 6, 7 & Cross-Cutting):
- Title Start Page: dynamic fallback for uncurated titles, Continue bar, categorized References & Authorities hub, retired URL banner, zero "Getting around"
- Reverse "Cited by N" header button, searchable popover, and Split trigger
- Statutory IBR standard wrapping (.xref-ibr) and hover/click peek to § 1910.6
- Clause-level Cite / Clip hover pill & #ask-float Clip -> Workspace persistence
- Per-part reading mode persistence (units vs full)
- Search (#sf-text) and Library (#lib-filter) partial DOM updates preserving focus & identity
"""
from __future__ import annotations

import copy
import os
import threading
import time
import unittest
from unittest import mock

import uvicorn

try:
    from playwright.sync_api import sync_playwright
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False

from app import news_store, news_worker, store
from app.library import client as lib_client
from app.main import app
import fake_titles
from tests.base import HermeticTestCase, TRACKED_KEYS

REQUIRE_BROWSER = os.environ.get("REQUIRE_BROWSER") == "1"

M3_29_XML = fake_titles.XML[29].replace(
    '<DIV6 N="Subpart H" TYPE="SUBPART">',
    '<DIV6 N="Subpart A" TYPE="SUBPART"><HEAD>Subpart A—General</HEAD>'
    + fake_titles._section(
        "1910.6",
        "Incorporation by reference.",
        "<P>(e) <I>ANSI.</I> (73) American National Standards Institute (ANSI) Z89.1-2009, "
        "Industrial Head Protection; IBR approved for § 1910.135. "
        "Web site: www.safetyequipment.org. Legacy portal: https://www.wdol.gov/sca.aspx.</P>",
    )
    + "</DIV6>"
    + '<DIV6 N="Subpart H" TYPE="SUBPART">',
)

M3_29_STRUCT = copy.deepcopy(fake_titles.STRUCTURE[29])
M3_29_STRUCT["children"][0]["children"][0]["children"][0]["children"].insert(
    0,
    {
        "type": "subpart",
        "identifier": "A",
        "label": "Subpart A",
        "label_description": "General",
        "children": [fake_titles._sec("1910.6", "Incorporation by reference.")],
    },
)


@unittest.skipUnless(HAVE_PLAYWRIGHT, "playwright is required")
class Milestone3BrowserTests(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.saved_env = {k: os.environ.get(k) for k in TRACKED_KEYS}
        for k in TRACKED_KEYS:
            os.environ.pop(k, None)

        cls.fake = fake_titles.FakeTitles(titles=(29, 40))
        with mock.patch.dict(fake_titles.XML, {29: M3_29_XML}), \
             mock.patch.dict(fake_titles.STRUCTURE, {29: M3_29_STRUCT}):
            cls.fake.install()

        with lib_client._cache_lock:
            lib_client._catalog = None
            lib_client._structures.clear()

        cls.patches = [
            mock.patch.object(news_worker, "start", lambda: None),
            mock.patch.object(news_worker, "request_sync", lambda force=False: []),
        ]
        for p in cls.patches:
            p.start()

        news_store.connect().close()

        uv_cfg = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="on")
        cls.server = uvicorn.Server(uv_cfg)
        cls.thread = threading.Thread(target=cls.server.run, name="m3-uvicorn", daemon=True)
        cls.thread.start()
        deadline = time.time() + 15
        while not cls.server.started:
            if time.time() > deadline:
                raise RuntimeError("uvicorn did not start")
            time.sleep(0.05)
        cls.port = cls.server.servers[0].sockets[0].getsockname()[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"

        cls.playwright = sync_playwright().start()
        try:
            cls.browser = cls.playwright.chromium.launch(args=["--hide-scrollbars"])
        except Exception:
            cls.playwright.stop()
            cls.server.should_exit = True
            cls.thread.join(timeout=5)
            for p in cls.patches:
                p.stop()
            cls.fake.remove()
            if REQUIRE_BROWSER:
                raise
            raise unittest.SkipTest("Chromium not installed")

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "browser", None):
            cls.browser.close()
        if getattr(cls, "playwright", None):
            cls.playwright.stop()
        if getattr(cls, "server", None):
            cls.server.should_exit = True
            cls.thread.join(timeout=10)
        for p in getattr(cls, "patches", []):
            p.stop()
        if getattr(cls, "fake", None):
            cls.fake.remove()
        store.reset_connections()
        for k, v in getattr(cls, "saved_env", {}).items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 800})
        self.addCleanup(self.context.close)
        self.external: list[str] = []

        def router(route):
            url = route.request.url
            if url.startswith(self.base_url) or url.startswith("data:"):
                route.continue_()
            else:
                self.external.append(url)
                route.abort()

        self.context.route("**/*", router)

    def _new_page(self):
        page = self.context.new_page()
        page_errors = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page._page_errors = page_errors
        return page

    def test_title_start_references_resume_and_dynamic_fallback(self):
        page = self._new_page()

        # Record real reading activity in Title 29 so the Continue bar appears.
        page.goto(f"{self.base_url}/#/title/29/section/1910.1200", wait_until="networkidle")
        page.wait_for_selector(".doc-title:has-text('1910.1200')", timeout=10000)

        # Title 29 Start Page: broadsheet lead, editorial rail resume & most-cited, categorized Almanac
        page.goto(f"{self.base_url}/#/title/29/", wait_until="networkidle")
        page.wait_for_selector(".home-hero", timeout=10000)
        page.wait_for_selector(".ts-lead:has-text('Part 1910')", timeout=5000)
        page.wait_for_selector(".title-resume:has-text('Continue in Title 29')", timeout=5000)
        page.wait_for_selector("#ts-cited-slot .ts-cited-row", timeout=10000)
        page.wait_for_selector(".ref-hub .ref-item", timeout=10000)

        view_text = page.locator("#view").inner_text()
        self.assertNotIn("Getting around", view_text)
        self.assertIn("REFERENCES & AUTHORITIES", view_text.upper())
        self.assertIn("MOST-CITED IN TITLE 29", view_text.upper())
        self.assertIn("safetyequipment.org", view_text)
        self.assertIn("wdol.gov", view_text)
        self.assertIn("Retired URL", view_text)
        self.assertIn("SAM.gov", view_text)

        # IBR Standards tab surfaces incorporated standards
        page.locator(".ref-hub [data-ref-cat='ibr']").click()
        hub_text = page.locator("#ref-list-slot").inner_text()
        self.assertIn("Z89.1", hub_text)

        # Category filter pill narrows down to Standards Bodies only
        page.locator(".ref-hub [data-ref-cat='standards']").click()
        hub_text = page.locator("#ref-list-slot").inner_text()
        self.assertIn("safetyequipment.org", hub_text)
        self.assertNotIn("wdol.gov", hub_text)

        # Reset to All & filter via search input
        page.locator(".ref-hub [data-ref-cat='all']").click()
        page.fill("#ref-filter", "wdol")
        hub_text = page.locator("#ref-list-slot").inner_text()
        self.assertIn("wdol.gov", hub_text)
        self.assertNotIn("safetyequipment.org", hub_text)

        # Uncurated Title 40 dynamically generates lead/briefs from TOC without hand-authored prose
        page.goto(f"{self.base_url}/#/title/40/", wait_until="networkidle")
        page.wait_for_selector(".ts-lead:has-text('Part 261')", timeout=10000)
        self.assertIn("Identification and Listing of Hazardous Waste", page.locator(".ts-main-col").inner_text())
        self.assertEqual(page._page_errors, [])
        self.assertEqual(self.external, [])

    def test_cited_by_and_ibr_peek_and_split(self):
        page = self._new_page()

        # 1. Reverse citation index on § 1910.1200 ("Cited by 1") -> popover + Split into § 1910.120
        page.goto(f"{self.base_url}/#/title/29/section/1910.1200", wait_until="networkidle")
        page.wait_for_selector("#btn-cited-by:not([hidden])", timeout=10000)
        self.assertIn("Cited by 1", page.locator("#btn-cited-by").inner_text())

        page.locator("#btn-cited-by").click()
        page.wait_for_selector("#cite-pop:not([hidden]):has-text('1910.120')", timeout=5000)
        page.locator("#cite-pop [data-cited-split='1910.120']").click()
        page.wait_for_selector("#split-pane:not([hidden]) .split-body:has-text('hazardous waste')", timeout=5000)

        # Close split pane cleanly before next check
        page.locator("#split-pane [data-split-act='close']").click()
        page.wait_for_selector("#split-pane", state="hidden", timeout=5000)

        # 2. Inline statutory IBR standard wrapping on § 1910.135 -> resolves ANSI Z89.1 to § 1910.6(e)(73)
        page.goto(f"{self.base_url}/#/title/29/section/1910.135", wait_until="networkidle")
        page.wait_for_selector("button.xref-ibr[data-ibr-code*='Z89.1']", timeout=10000)
        page.locator("button.xref-ibr[data-ibr-code*='Z89.1']").first.click()
        page.wait_for_selector("#cite-pop:not([hidden]):has-text('1910.6')", timeout=5000)
        pop_text = page.locator("#cite-pop").inner_text()
        self.assertIn("ANSI", pop_text)
        self.assertIn("Open § 1910.6", pop_text)
        self.assertIn("Open side-by-side", pop_text)
        self.assertEqual(page._page_errors, [])
        self.assertEqual(self.external, [])

    def test_clause_clip_and_reading_mode_persistence(self):
        page = self._new_page()

        # 1. Clause-level Clip from .para-tools hover pill on § 1910.135(a)
        page.goto(f"{self.base_url}/#/title/29/section/1910.135", wait_until="networkidle")
        page.wait_for_selector(".reg-body .reg-p[id]", timeout=10000)
        page.locator(".reg-body .reg-p[id]").first.hover()
        page.wait_for_selector(".para-tools:not([hidden]) .para-tool-btn[data-para-act='clip']", timeout=5000)
        page.locator(".para-tool-btn[data-para-act='clip']").click()

        # 1b. Hierarchical clause path (.lvl-2 paragraph (1) inside (a) of § 1910.1200) -> resolves (a)(1)
        page.goto(f"{self.base_url}/#/title/29/section/1910.1200", wait_until="networkidle")
        page.wait_for_selector(".reg-body .reg-p.lvl-2[id]", timeout=10000)
        page.locator(".reg-body .reg-p.lvl-2[id]").first.hover()
        page.wait_for_selector(".para-tools:not([hidden]) .para-tool-btn[data-para-act='clip']", timeout=5000)
        page.locator(".para-tool-btn[data-para-act='clip']").click()

        page.goto(f"{self.base_url}/#/projects", wait_until="networkidle")
        page.wait_for_selector(".proj-card", timeout=5000)
        page.locator(".proj-card a").first.click()
        page.wait_for_selector("textarea.proj-note", timeout=5000)
        notes = "\n".join(el.input_value() for el in page.locator("textarea.proj-note").all())
        self.assertIn("29 C.F.R. § 1910.135(a)", notes)
        self.assertIn("protective helmet", notes)
        self.assertIn("29 C.F.R. § 1910.1200(a)(1)", notes)

        # 2. Per-part reading mode persistence on Part 1910 (§ 1910.1200)
        page.goto(f"{self.base_url}/#/title/29/section/1910.1200", wait_until="networkidle")
        page.wait_for_selector("a[data-mode-pref='full']", timeout=10000)
        page.locator("a[data-mode-pref='full']").click()
        page.wait_for_selector("a[data-mode-pref='units']", timeout=10000)

        # Navigate away and return to bare section URL -> remembers 'full' mode for Title 29 Part 1910
        page.goto(f"{self.base_url}/#/title/29/", wait_until="networkidle")
        page.wait_for_selector(".home-hero", timeout=5000)
        page.goto(f"{self.base_url}/#/title/29/section/1910.1200", wait_until="networkidle")
        page.wait_for_selector("a[data-mode-pref='units']", timeout=10000)
        self.assertEqual(page.locator(".unit-context").count(), 0)
        self.assertEqual(page._page_errors, [])
        unexpected_ext = [u for u in self.external if "img.federalregister.gov/" not in u]
        self.assertEqual(unexpected_ext, [])

    def test_search_and_library_filter_focus_preserved(self):
        page = self._new_page()

        # 1. Search page (#sf-text) preserves exact DOM element and focus across keystrokes
        page.goto(f"{self.base_url}/#/search?q=hazardous", wait_until="networkidle")
        page.wait_for_selector("[data-sview='grouped']", timeout=10000)
        page.locator("[data-sview='grouped']").click()
        page.wait_for_selector("#sf-text", timeout=10000)
        page.evaluate("() => { window.__sfBefore = document.getElementById('sf-text'); }")
        page.locator("#sf-text").focus()
        page.keyboard.type("waste", delay=15)
        sf_ok = page.evaluate("""() => {
            const el = document.getElementById('sf-text');
            return el === window.__sfBefore && document.activeElement === el && el.value === 'waste';
        }""")
        self.assertTrue(sf_ok)
        self.assertIn("1910.120", page.locator("#view").inner_text())

        # 2. Library page (#lib-filter) preserves exact DOM element and focus across keystrokes
        page.goto(f"{self.base_url}/#/library", wait_until="networkidle")
        page.wait_for_selector("#lib-filter", timeout=10000)
        page.evaluate("() => { window.__libBefore = document.getElementById('lib-filter'); }")
        page.locator("#lib-filter").focus()
        page.keyboard.type("env", delay=15)
        lib_ok = page.evaluate("""() => {
            const el = document.getElementById('lib-filter');
            return el === window.__libBefore && document.activeElement === el && el.value === 'env';
        }""")
        self.assertTrue(lib_ok)
        self.assertEqual(page._page_errors, [])
        self.assertEqual(self.external, [])


if __name__ == "__main__":
    unittest.main()
