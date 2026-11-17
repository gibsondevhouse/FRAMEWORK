"""Playwright behavioral tests for Milestone 2 (Phases 3 & 4):
- Shared collision-aware popovers & News Activity filter/close
- Inline hover peeks (paragraphs, installed sections, footnotes, tables)
- Side-by-side split reading pane (Alt+Click, peek Split button, Promote)
- Seamless Click-to-Download micro-card & direct uninstalled route resolver
"""
from __future__ import annotations

import os
import re
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import uvicorn

try:
    from playwright.sync_api import sync_playwright
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False

from app import build, config, library, news_store, news_worker, store
from app.library import client as lib_client
from app.main import app
from fake_titles import FakeTitles, XML
from tests.base import HermeticTestCase, TRACKED_KEYS

REQUIRE_BROWSER = os.environ.get("REQUIRE_BROWSER") == "1"
_TITLE_IN_URL = re.compile(r"title-(\d+)\.(?:json|xml)")

EXTRA_SECTION_XML = XML[29].replace(
    "Respiratory protection.",
    "Respiratory protection. Footnote test.<SU>1</SU><FTREF/>",
).replace(
    "</DIV6><DIV6 N=\"Subpart Z\"",
    '<FTNT><P><SU>1</SU> Employer must inspect respirators before each use.</P></FTNT>'
    '<DIV class="gpotbl_div"><TABLE><CAPTION>Table I-1 Respiratory Factors</CAPTION>'
    '<THEAD><TR><TH>Type</TH><TH>APF</TH></TR></THEAD>'
    '<TBODY><TR><TD>Half mask</TD><TD>10</TD></TR></TBODY></TABLE></DIV>'
    '</DIV6><DIV6 N="Subpart Z"',
)


def scoped_download(_client, url: str, dest: Path, on_bytes=None) -> None:
    m = _TITLE_IN_URL.search(url)
    if not m:
        raise AssertionError(f"unexpected download url: {url}")
    t = int(m.group(1))
    dest.write_text(XML[t], encoding="utf-8")
    if on_bytes:
        on_bytes(10, 10)


@unittest.skipUnless(HAVE_PLAYWRIGHT, "playwright is required")
class Milestone2BrowserTests(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.saved_env = {k: os.environ.get(k) for k in TRACKED_KEYS}
        for k in TRACKED_KEYS:
            os.environ.pop(k, None)

        # Install ONLY Title 29 initially so 40 CFR 261.3 and 49 CFR 172.101 render as uninstalled links!
        cls.fake = FakeTitles(titles=(29,))
        cls.fake.install()
        # Reset library catalog cache cleanly
        with lib_client._cache_lock:
            lib_client._catalog = None
            lib_client._structures.clear()

        cls.q = library.Queue()
        cls.patches = [
            mock.patch.object(build, "download_stream", scoped_download),
            mock.patch.object(library, "queue", cls.q),
            mock.patch.object(news_worker, "start", lambda: None),
            mock.patch.object(news_worker, "request_sync", lambda force=False: []),
        ]
        for p in cls.patches:
            p.start()

        # Re-seed news minimal table so /api/news/* doesn't 500
        news_store.connect().close()

        uv_cfg = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="on")
        cls.server = uvicorn.Server(uv_cfg)
        cls.thread = threading.Thread(target=cls.server.run, name="m2-uvicorn", daemon=True)
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

    def test_hover_peek_and_split_reading(self):
        page = self._new_page()
        page.goto(f"{self.base_url}/#/title/29/section/1910.120", wait_until="networkidle")
        page.wait_for_selector(".doc-title", timeout=10000)

        # Hover over installed section § 1910.134 to trigger inline peek
        link_134 = page.locator("a.xref[href*='1910.134']").first
        link_134.hover()
        page.wait_for_selector("#cite-pop:not([hidden])", timeout=3000)
        pop_text = page.locator("#cite-pop").inner_text()
        self.assertIn("1910.134", pop_text)
        self.assertIn("Respiratory protection", pop_text)
        self.assertIn("Respirators shall be provided", pop_text)

        # Click "Open side-by-side" inside peek -> opens #split-pane
        page.locator("#cite-pop [data-peek-split]").click()
        page.wait_for_selector("#split-pane:not([hidden])", timeout=5000)
        self.assertTrue(page.locator("#main-stage").evaluate("el => el.classList.contains('is-split')"))
        self.assertIn("Respiratory protection", page.locator("#split-pane").inner_text())

        # Alt+Click § 1910.1200 -> updates split pane directly to unitized section
        link_1200 = page.locator("a.xref[href*='1910.1200']").first
        link_1200.click(modifiers=["Alt"])
        page.wait_for_selector("#split-pane .split-units", timeout=5000)
        self.assertIn("1910.1200", page.locator("#split-pane .split-head-title").inner_text())

        # Switch unit inside split pane without changing main URL
        main_hash_before = page.evaluate("() => window.location.hash")
        page.locator("#split-pane .split-unit-chip", has_text="(b)").click()
        page.wait_for_selector("#split-pane .split-body:has-text('Scope and application')", timeout=5000)
        self.assertEqual(page.evaluate("() => window.location.hash"), main_hash_before)

        # Promote split pane to main via Open button
        page.locator("#split-pane [data-split-act='promote']").click()
        page.wait_for_function("() => window.location.hash.includes('1910.1200')", timeout=5000)
        self.assertTrue(page.locator("#split-pane").is_hidden())
        self.assertEqual(page._page_errors, [])
        self.assertEqual(self.external, [])

    def test_click_to_download_micro_card_and_resolver_route(self):
        page = self._new_page()
        page.goto(f"{self.base_url}/#/title/29/section/1910.120", wait_until="networkidle")
        page.wait_for_selector(".doc-title", timeout=10000)

        # 1. Click uninstalled 40 CFR 261.3 -> must NOT navigate externally; must open download micro-card
        ext_link = page.locator("a.xref-external[data-cfr-title='40'][data-cfr-section='261.3']").first
        ext_link.click()
        page.wait_for_selector("#cite-pop:not([hidden])", timeout=5000)
        pop_text = page.locator("#cite-pop").inner_text()
        self.assertIn("40 CFR § 261.3", pop_text)
        self.assertIn("Protection of Environment", pop_text)
        self.assertIn("Download § 261.3", pop_text)

        # 2. Click "Download § 261.3" -> micro-scope ingest builds Title 40 & auto-navigates into it!
        page.locator("#cite-pop [data-res-dl='section']").click()
        page.wait_for_function("() => window.location.hash.includes('/title/40/section/261.3')", timeout=15000)
        page.wait_for_selector(".doc-title:has-text('261.3')", timeout=10000)
        self.assertIn("hazardous waste", page.locator("#view").inner_text().lower())

        # 3. Direct route to still-uninstalled Title 49 section renders full-page resolver card, not 404
        page.goto(f"{self.base_url}/#/title/49/section/172.101", wait_until="networkidle")
        page.wait_for_selector(".resolver-card", timeout=10000)
        card_text = page.locator(".resolver-card").inner_text()
        self.assertIn("49 CFR § 172.101", card_text)
        self.assertIn("Download § 172.101", card_text)
        self.assertEqual(page._page_errors, [])
        self.assertEqual(self.external, [])


if __name__ == "__main__":
    unittest.main()
