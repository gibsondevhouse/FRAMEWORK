"""Playwright behavioral tests for Milestone 2 (Phases 3 & 4):
- Shared collision-aware popovers & mutual exclusion / close button
- Inline hover peeks (local paragraphs, installed sections, footnotes, tables)
- Side-by-side split reading pane (Alt+Click, peek Split button, unit switch, Promote, mobile stack)
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
import fake_titles
from tests.base import HermeticTestCase, TRACKED_KEYS, watch_policy_violations

REQUIRE_BROWSER = os.environ.get("REQUIRE_BROWSER") == "1"
_TITLE_IN_URL = re.compile(r"title-(\d+)\.(?:json|xml)")

RICH_29_XML = fake_titles.XML[29].replace(
    "<P>(a) <I>Permissible practice.</I> Respirators shall be provided.</P>",
    "<P>(a) <I>Permissible practice.</I> Respirators shall be provided under "
    "paragraph (b) of this section.<SU>1</SU><FTREF/> See Table I-1.</P>"
    "<P>(b) <I>Inspection rule.</I> Facepieces must seal tightly.</P>"
    "<FTNT><P><SU>1</SU> Employer must inspect respirators before each use.</P></FTNT>"
    '<DIV class="gpotbl_div"><TABLE><CAPTION>Table I-1 Respiratory Factors</CAPTION>'
    "<THEAD><TR><TH>Respirator Type</TH><TH>APF</TH></TR></THEAD>"
    "<TBODY><TR><TD>Half mask</TD><TD>10</TD></TR></TBODY></TABLE></DIV>",
)
TEST_XML = {**fake_titles.XML, 29: RICH_29_XML}


def scoped_download(_client, url: str, dest: Path, on_bytes=None) -> None:
    m = _TITLE_IN_URL.search(url)
    if not m:
        raise AssertionError(f"unexpected download url: {url}")
    t = int(m.group(1))
    dest.write_text(TEST_XML[t], encoding="utf-8")
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
        cls.fake = fake_titles.FakeTitles(titles=(29,))
        with mock.patch.dict(fake_titles.XML, {29: RICH_29_XML}):
            cls.fake.install()

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
        watch_policy_violations(self, self.context)
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

    def test_peeks_split_and_popover_close(self):
        page = self._new_page()

        # 1. Local paragraph, footnote, and table peeks in § 1910.134
        page.goto(f"{self.base_url}/#/title/29/section/1910.134", wait_until="networkidle")
        page.wait_for_selector(".doc-title:has-text('1910.134')", timeout=10000)

        # Hover local para "(b)"
        page.locator("a.xref-local[data-local-para='(b)']").first.hover()
        page.wait_for_selector("#cite-pop:not([hidden]):has-text('Facepieces must seal tightly')", timeout=3000)

        # Move pointer away to close, then hover footnote "1"
        page.locator(".doc-title").hover()
        page.wait_for_selector("#cite-pop", state="hidden", timeout=3000)
        page.locator(".ftref").first.hover()
        page.wait_for_selector("#cite-pop:not([hidden]):has-text('Employer must inspect respirators')", timeout=3000)

        # Move away, then hover auto-linked "Table I-1"
        page.locator(".doc-title").hover()
        page.wait_for_selector("#cite-pop", state="hidden", timeout=3000)
        page.locator("button.xref-anchor[data-anchor^='table-']").first.hover()
        page.wait_for_selector("#cite-pop:not([hidden]) .peek-table:has-text('Half mask')", timeout=3000)

        # Close via Pin menu mutual exclusion + close button [data-pop-close]
        page.locator("#btn-pin").click()
        page.wait_for_selector("#pin-pop:not([hidden])", timeout=3000)
        self.assertTrue(page.locator("#cite-pop").is_hidden())
        page.locator("#pin-pop [data-pop-close]").click()
        page.wait_for_selector("#pin-pop", state="hidden", timeout=3000)

        # 2. Installed section peek & Split Pane from § 1910.120
        page.goto(f"{self.base_url}/#/title/29/section/1910.120", wait_until="networkidle")
        page.wait_for_selector(".doc-title:has-text('1910.120')", timeout=10000)

        page.locator("a.xref[href*='1910.134']").first.hover()
        page.wait_for_selector("#cite-pop:not([hidden]):has-text('Respirators shall be provided')", timeout=3000)

        page.locator("#cite-pop [data-peek-split]").click()
        page.wait_for_selector("#split-pane:not([hidden]) .split-body:has-text('Respirators shall be provided')", timeout=5000)
        self.assertTrue(page.locator("#main-stage").evaluate("el => el.classList.contains('is-split')"))

        # Alt+Click § 1910.1200 -> switches split pane to unitized section
        page.locator("a.xref[href*='1910.1200']").first.click(modifiers=["Alt"])
        page.wait_for_selector("#split-pane .split-units", timeout=5000)
        self.assertIn("1910.1200", page.locator("#split-pane .split-head-title").inner_text())

        # Switch unit inside split pane without changing main URL
        main_hash_before = page.evaluate("() => window.location.hash")
        page.locator("#split-pane .split-unit-chip", has_text="(b)").click()
        page.wait_for_selector("#split-pane .split-body:has-text('Scope and application')", timeout=5000)
        self.assertEqual(page.evaluate("() => window.location.hash"), main_hash_before)

        # Narrow mobile viewport: split pane stacks vertically with zero horizontal overflow
        page.set_viewport_size({"width": 390, "height": 844})
        overflow = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
        self.assertFalse(overflow)

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

        # 1. Click uninstalled 40 CFR 261.3 -> must NOT navigate externally; opens Download Micro-Card
        ext_link = page.locator("a.xref-external[data-cfr-title='40'][data-cfr-section='261.3']").first
        ext_link.click()
        page.wait_for_selector("#cite-pop:not([hidden]):has-text('Protection of Environment')", timeout=5000)
        pop_text = page.locator("#cite-pop").inner_text()
        self.assertIn("40 CFR § 261.3", pop_text)
        self.assertIn("Download § 261.3", pop_text)

        # 2. Click "Download § 261.3" -> builds Title 40 & auto-navigates into § 261.3
        page.locator("#cite-pop [data-res-dl='section']").click()
        page.wait_for_function("() => window.location.hash.includes('/title/40/section/261.3')", timeout=15000)
        page.wait_for_selector(".doc-title:has-text('261.3')", timeout=10000)
        self.assertIn("hazardous waste", page.locator("#view").inner_text().lower())

        # 3. Direct route to still-uninstalled Title 49 section renders full-page resolver card, not 404
        page.goto(f"{self.base_url}/#/title/49/section/172.101", wait_until="networkidle")
        page.wait_for_selector(".resolver-card:has-text('Transportation')", timeout=10000)
        card_text = page.locator(".resolver-card").inner_text()
        self.assertIn("49 CFR § 172.101", card_text)
        self.assertIn("Download § 172.101", card_text)
        self.assertEqual(page._page_errors, [])
        self.assertEqual(self.external, [])


if __name__ == "__main__":
    unittest.main()
