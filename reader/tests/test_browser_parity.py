"""In-process Playwright parity suite: behavioral assertions plus strict per-platform
Pillow screenshot baselines, against a real uvicorn serving the fake titles and the
seeded news fixtures.

- Runs under both pytest and `unittest discover` (ImportError guard + skipUnless,
  never pytest.importorskip). With REQUIRE_BROWSER=1 a missing Playwright, Pillow
  or Chromium FAILS instead of skipping, so CI can never silently skip the gate.
- Determinism: frozen browser Date (`page.clock.set_fixed_time`) and frozen server
  "now" (news_api.datetime), fixed fixture timestamps, seeded localStorage,
  `device_scale_factor=1`, `reduced_motion="reduce"`, hidden scrollbars, local
  fonts only, and every non-local request aborted (and asserted on).
- Baselines live in tests/baselines/{darwin,win32}/. Missing baselines FAIL unless
  UPDATE_BASELINES=1 records them.
"""
from __future__ import annotations

import io
import os
import socket
import sys
import threading
import time
import unittest
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

REQUIRE_BROWSER = os.environ.get("REQUIRE_BROWSER") == "1"
UPDATE_BASELINES = os.environ.get("UPDATE_BASELINES") == "1"

try:
    from playwright.sync_api import sync_playwright
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False
try:
    from PIL import Image, ImageChops
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

import uvicorn

from app import config, news_store, news_worker
from app.routers import news as news_api
from app.main import app
from fake_titles import FakeTitles
from tests.base import TRACKED_KEYS
from tests.test_api_snapshots import seed_news

BASELINE_ROOT = Path(__file__).resolve().parent / "baselines"
PLATFORM = sys.platform  # darwin / win32 / linux
FROZEN = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)  # a Tuesday
FROZEN_MS = int(FROZEN.timestamp() * 1000)

DESKTOP = {"width": 1280, "height": 800}
MOBILE = {"width": 390, "height": 844}

# Pixel-diff tolerance: antialiasing may wobble a little between runs on one
# platform; structural drift may not.
PIXEL_DELTA = 24          # per-pixel luma delta that counts as "different"
MAX_DIFF_FRACTION = 0.002  # fraction of pixels allowed to differ

_missing = []
if not HAVE_PLAYWRIGHT:
    _missing.append("playwright")
if not HAVE_PIL:
    _missing.append("Pillow")
if REQUIRE_BROWSER and _missing:
    raise RuntimeError(f"REQUIRE_BROWSER=1 but missing: {', '.join(_missing)}. "
                       f"pip install -r reader/requirements-dev.txt && python -m playwright install chromium")


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return FROZEN.astimezone(tz) if tz else FROZEN.replace(tzinfo=None)


class _Env:
    """Module-wide singleton: fake titles + seeded news + uvicorn + one browser."""

    def __init__(self):
        self.external_requests: list[str] = []

    def start(self):
        self.saved_env = {k: os.environ.get(k) for k in TRACKED_KEYS}
        for k in TRACKED_KEYS:
            os.environ.pop(k, None)

        self.fake = FakeTitles()
        self.fake.install()
        seed_news()
        with closing(news_store.connect()) as con:
            # Fixed last-sync times so the News masthead is deterministic and the
            # page's refresh-on-open finds nothing due at the frozen "now".
            ok_at = FROZEN.replace(hour=11, minute=30)
            news_store.record_ok(con, "federal_register", 4, now=ok_at)
            news_store.record_ok(con, "federal_register_pi", 1, now=ok_at)
            con.commit()

        self.patches = [
            mock.patch.object(news_worker, "start", lambda: None),
            mock.patch.object(news_worker, "request_sync", lambda force=False: []),
            mock.patch.object(news_api, "datetime", _FrozenDatetime),
        ]
        for p in self.patches:
            p.start()

        uv_config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="on")
        self.server = uvicorn.Server(uv_config)
        self.thread = threading.Thread(target=self.server.run, name="parity-uvicorn", daemon=True)
        self.thread.start()
        deadline = time.time() + 15
        while not self.server.started:
            if time.time() > deadline:
                raise RuntimeError("uvicorn did not start within 15s")
            time.sleep(0.05)
        self.port = self.server.servers[0].sockets[0].getsockname()[1]
        self.base_url = f"http://127.0.0.1:{self.port}"

        self.playwright = sync_playwright().start()
        try:
            self.browser = self.playwright.chromium.launch(args=["--hide-scrollbars"])
        except Exception:
            self.playwright.stop()
            if REQUIRE_BROWSER:
                raise RuntimeError("REQUIRE_BROWSER=1 but Chromium failed to launch. "
                                   "Run: python -m playwright install chromium")
            raise unittest.SkipTest("Chromium is not installed (python -m playwright install chromium)")

    def stop(self):
        if getattr(self, "browser", None):
            self.browser.close()
        if getattr(self, "playwright", None):
            self.playwright.stop()
        if getattr(self, "server", None):
            self.server.should_exit = True
            self.thread.join(timeout=10)
        for p in getattr(self, "patches", []):
            p.stop()
        if getattr(self, "fake", None):
            self.fake.remove()
        for k, v in getattr(self, "saved_env", {}).items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


ENV: _Env | None = None


def setUpModule():
    global ENV
    if not (HAVE_PLAYWRIGHT and HAVE_PIL):
        raise unittest.SkipTest(f"browser parity needs: {', '.join(_missing)}")
    ENV = _Env()
    try:
        ENV.start()
    except unittest.SkipTest:
        ENV = None
        raise


def tearDownModule():
    if ENV is not None:
        ENV.stop()


SEED_USAGE = {
    "v": 1, "since": FROZEN_MS - 30 * 86400_000,
    "s": {
        "29|1910.1200": {"n": 14, "t": FROZEN_MS - 3_600_000, "l": "§ 1910.1200", "h": "Hazard communication.", "p": "1910"},
        "29|1910.120": {"n": 6, "t": FROZEN_MS - 7_200_000, "l": "§ 1910.120", "h": "Hazardous waste operations and emergency response.", "p": "1910"},
        "40|261.3": {"n": 3, "t": FROZEN_MS - 86_400_000, "l": "§ 261.3", "h": "Definition of hazardous waste.", "p": "261"},
    },
    "p": {
        "29|1910": {"n": 20, "t": FROZEN_MS - 3_600_000, "h": "Occupational Safety and Health Standards"},
        "40|261": {"n": 3, "t": FROZEN_MS - 86_400_000, "h": "Identification and Listing of Hazardous Waste"},
    },
}


@unittest.skipUnless(HAVE_PLAYWRIGHT and HAVE_PIL, "playwright and Pillow are required")
class BrowserCase(unittest.TestCase):
    viewport = DESKTOP

    def setUp(self):
        super().setUp()
        import json as _json
        self.context = ENV.browser.new_context(
            viewport=self.viewport, device_scale_factor=1, reduced_motion="reduce")
        self.addCleanup(self.context.close)
        self.external: list[str] = []

        def router(route):
            url = route.request.url
            if url.startswith(ENV.base_url) or url.startswith("data:"):
                route.continue_()
            else:
                self.external.append(url)
                route.abort()

        self.context.route("**/*", router)
        seed = {
            "fontSize": "16",
            "railState": _json.dumps({"panel": None, "collapsed": False, "mode": "pinned", "width": 280}),
            "usage": _json.dumps(SEED_USAGE),
        }
        pairs = ";".join(
            f"localStorage.setItem({_json.dumps(k)}, {_json.dumps(v)})" for k, v in seed.items())
        self.context.add_init_script(f"try{{{pairs}}}catch(e){{}}")

    def open_page(self, hash_route: str, ready_selector: str, state: str = "visible"):
        page = self.context.new_page()
        page.clock.set_fixed_time(FROZEN)
        page.goto(f"{ENV.base_url}/#{hash_route}")
        page.wait_for_selector(ready_selector, timeout=15000, state=state)
        page.evaluate("document.fonts.ready")
        return page

    def assert_no_external_requests(self):
        self.assertEqual(self.external, [], "the page tried to reach the network")


class BehaviorTests(BrowserCase):
    def test_overview_and_section_routing(self):
        page = self.open_page("/", ".hm-titles[data-snapshot-loaded='1']")
        page.wait_for_selector(".hm-news[data-news-loaded='1']", timeout=15000)
        self.assertIn("FRAMEWORK", page.title())
        self.assertIn("Home", page.inner_text("#view h1"))
        # Federal update cards cover the 3 peer federal frameworks (U.S.C., CFR, FR) with recent changes (not download counts)
        systems_text = page.inner_text(".hm-systems")
        for sys_lbl in ("U.S.C.", "CFR", "FR"):
            self.assertIn(sys_lbl, systems_text)
        for inv_count in ("3 statutes", "3 titles", "6 notices"):
            self.assertNotIn(inv_count, systems_text)
        self.assertEqual(page.locator(".hm-sys-card[data-hm-tier='state']").count(), 0)
        # Topbar framework switcher stays federal-neutral on Home (not locked to 29 CFR)
        self.assertEqual(page.inner_text("#title-select-num").strip(), "Federal")
        # Update status radar & work footprint are surfaced directly on Home
        self.assertGreaterEqual(page.locator("#hm-updates").count(), 1)
        self.assertGreaterEqual(page.locator(".hm-footprint").count(), 1)
        self.assertIn("Continue reading", page.text_content(".hm-resume"))
        self.assertIn("workspaces", page.inner_text(".hm-ws").lower())
        self.assertIn("federal register pulse", page.inner_text(".hm-news").lower())
        titles_text = page.inner_text(".hm-titles")
        self.assertIn("federal frameworks", titles_text.lower())
        self.assertIn("OSHA", titles_text)
        # Filtering by federal framework (U.S.C., CFR, FR) works directly from Home
        page.click(".hm-sys-card[data-hm-tier='federal-statute']")
        self.assertGreaterEqual(page.locator(".hm-title-card[data-ref-tier='usc']").count(), 1)
        page.click(".hm-sys-card[data-hm-tier='federal-reg']")
        self.assertGreaterEqual(page.locator(".hm-title-card[data-ref-tier='cfr']").count(), 1)
        page.click(".hm-sys-card[data-hm-tier='federal-register']")
        self.assertGreaterEqual(page.locator(".hm-title-card[data-ref-tier='fr']").count(), 1)
        page.click("[data-hm-tier='all']")
        # Primary Home tabs: Overview, USC, CFR, Federal Register
        self.assertEqual(page.locator("#hm-tabs [data-hm-tab]").count(), 4)
        page.click("#hm-tabs [data-hm-tab='usc']")
        usc_text = page.inner_text("#hm-tab-body")
        self.assertIn("United States Code", usc_text)
        self.assertIn("29 U.S.C. § 655", usc_text)
        self.assertIn("Administrative Procedure Act", usc_text)
        self.assertGreaterEqual(page.locator(".hm-usc-card .hm-chain-bar").count(), 1)
        page.click("#hm-tabs [data-hm-tab='cfr']")
        cfr_text = page.inner_text("#hm-tab-body")
        self.assertIn("Code of Federal Regulations", cfr_text)
        self.assertIn("High-Frequency Regulatory Parts", cfr_text)
        self.assertIn("Available in eCFR Catalog", cfr_text)
        page.click("#hm-tabs [data-hm-tab='fr']")
        fr_text = page.inner_text("#hm-tab-body")
        self.assertIn("Federal Register", fr_text)
        self.assertIn("Effective Dates & Comment Deadlines", fr_text)
        self.assertEqual(page.locator(".hm-fr-cats [data-hm-fr-cat]").count(), 5)
        page.click(".hm-fr-cats [data-hm-fr-cat='rulemaking']")
        self.assertIn("Proposed Rules Dispatches", page.inner_text("#hm-tab-body"))
        page.click(".hm-fr-cats [data-hm-fr-cat='all']")
        # Keyboard WAI-ARIA tab navigation on #hm-tabs
        page.locator("#hm-tabs [data-hm-tab='fr']").focus()
        page.keyboard.press("ArrowRight")
        self.assertGreaterEqual(page.locator("#hm-systems").count(), 1)
        # Secondary framework drawer is strictly closed on Home (main page)
        self.assertTrue(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"))
        self.assertFalse(page.evaluate("document.documentElement.classList.contains('in-framework')"))
        self.assertEqual(page.locator("#hm-jump-input").count(), 0)
        view_text = page.inner_text("#view").lower()
        for clutter in ("import json", "commands", "connections", "dol inspection sync"):
            self.assertNotIn(clutter, view_text)
        # Entering a section reader opens the secondary framework drawer, compacts the rail, and scopes topbar to 29 CFR
        page.goto(f"{ENV.base_url}/#/section/1910.135")
        page.wait_for_selector("text=protective helmet", timeout=15000)
        self.assertTrue(page.evaluate("document.documentElement.classList.contains('in-framework')"))
        self.assertFalse(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"))
        self.assertEqual(page.inner_text("#title-select-num").strip(), "29 CFR")
        self.assert_no_external_requests()

    def test_home_quick_jump_and_chords(self):
        page = self.open_page("/", ".hm-titles[data-snapshot-loaded='1']")
        page.wait_for_selector(".hm-news[data-news-loaded='1']", timeout=15000)
        page.locator(".hm-title-card[data-ref-tier='cfr'] a.hm-part-chip").first.click()
        page.wait_for_function(
            "() => /^#\\/title\\/\\d+\\/part\\//.test(location.hash)",
            timeout=15000,
        )
        self.assertRegex(page.evaluate("location.hash"), r"^#/title/\d+/part/")
        page.keyboard.press("g")
        page.keyboard.press("t")
        page.wait_for_selector(".home-hero", timeout=15000)
        self.assertRegex(page.evaluate("location.hash"), r"^#/title/\d+/?$")
        page.keyboard.press("g")
        page.keyboard.press("h")
        page.wait_for_selector(".hm-resume", timeout=15000)
        self.assertEqual(page.evaluate("location.hash"), "#/")
        self.assert_no_external_requests()

    def test_home_workspace_and_unit_resume(self):
        # Step into a units-mode clause, pin it to a workspace, then verify Home surfaces both.
        page = self.open_page("/section/1910.1200/b", "#btn-pin")
        page.click("#btn-pin")
        page.wait_for_selector("#pin-pop:not([hidden]) input", timeout=15000)
        page.fill("#pin-pop input", "HazCom Program")
        page.keyboard.press("Enter")
        page.goto(f"{ENV.base_url}/#/")
        page.wait_for_selector(".hm-ws-item", timeout=15000)
        self.assertIn("HazCom Program", page.inner_text(".hm-ws"))
        self.assertIn("1910.1200", page.inner_text(".hm-ws"))
        resume_href = page.locator(".hm-resume-acts a.btn-accent").get_attribute("href")
        self.assertIn("1910.1200/b", resume_href)
        self.assert_no_external_requests()

    def test_units_mode_and_rail(self):
        page = self.open_page("/section/1910.1200", "#view-head")
        page.wait_for_selector(".rail", timeout=15000)
        bars = page.locator(".rail a, .rail button, .rail [data-unit], .rail > *")
        self.assertGreater(bars.count(), 1)
        self.assert_no_external_requests()

    def test_drawer_shortcut(self):
        page = self.open_page("/section/1910.135", "#activity-rail")
        collapsed = "document.documentElement.classList.contains('drawer-collapsed')"
        before = page.evaluate(collapsed)
        page.keyboard.press("ControlOrMeta+b")
        page.wait_for_function(f"{collapsed} !== {str(before).lower()}", timeout=15000)
        page.keyboard.press("ControlOrMeta+b")
        page.wait_for_function(f"{collapsed} === {str(before).lower()}", timeout=15000)
        self.assert_no_external_requests()

    def test_g_chord_navigation(self):
        # On a fresh page so no earlier keyboard interaction has moved focus into
        # an input (the typing guard swallows the chord there).
        page = self.open_page("/section/1910.135", "#activity-rail")
        page.keyboard.press("g")
        page.keyboard.press("n")
        page.wait_for_selector("#news-q", timeout=15000)
        self.assertTrue(page.evaluate("location.hash").startswith("#/news"))
        # Leaving a legal framework retracts the secondary drawer automatically
        self.assertTrue(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"))
        # The news page focuses its search box; blur so the next chord isn't typed into it.
        page.evaluate("document.activeElement && document.activeElement.blur()")
        # G,L navigates directly to the Library main page (secondary drawer stays retracted).
        page.keyboard.press("g")
        page.keyboard.press("l")
        page.wait_for_selector(".lib-front", timeout=15000)
        self.assertTrue(page.evaluate("location.hash").startswith("#/library"))
        self.assertTrue(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"))
        self.assert_no_external_requests()

    def test_alt_digit_navigation(self):
        page = self.open_page("/", "#activity-rail")
        page.keyboard.press("Alt+Digit3")
        page.wait_for_selector("#news-q", timeout=15000)
        self.assertTrue(page.evaluate("location.hash").startswith("#/news"))
        self.assert_no_external_requests()

    def test_secondary_drawer_scoped_to_legal_frameworks_and_home_updates(self):
        import json as _json
        page = self.context.new_page()
        page.clock.set_fixed_time(FROZEN)
        # Simulate an outdated Title 29 edition in /api/library so Home surfaces the Updates Radar
        def _stale_library(route):
            resp = route.fetch()
            data = _json.loads(resp.text())
            for row in data.get("titles", []):
                if row.get("title") == 29:
                    row["latest"] = "2026-09-14"
            route.fulfill(status=200, content_type="application/json", body=_json.dumps(data))
        page.route("**/api/library", _stale_library)
        page.goto(f"{ENV.base_url}/#/")
        page.wait_for_selector(".hm-updates.is-attention", timeout=15000)
        self.assertIn("29 CFR", page.inner_text(".hm-updates.is-attention"))
        self.assertIn("Update", page.inner_text(".hm-updates.is-attention"))
        # Main pages keep the secondary framework drawer closed
        for route_hash, ready in [("#/", ".hm"), ("#/projects", ".proj-page"), ("#/news", "#news-q"), ("#/library", ".lib-front"), ("#/settings", ".settings-front")]:
            page.goto(f"{ENV.base_url}/{route_hash}")
            page.wait_for_selector(ready, timeout=15000)
            self.assertTrue(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"), f"drawer should be closed on {route_hash}")
        # Federal framework views (Start page, Part TOC, Section Reader, and FR/U.S.C. Corpus) open the secondary drawer
        for route_hash, ready in [("#/title/29/", ".ts-front"), ("#/title/29/part/1910", ".toc-atlas"), ("#/title/29/section/1910.135", ".reg-body"), ("#/corpus/federal-register/US/FR/", ".resolver-card")]:
            page.goto(f"{ENV.base_url}/{route_hash}")
            page.wait_for_selector(ready, timeout=15000)
            self.assertTrue(page.evaluate("document.documentElement.classList.contains('in-framework')"), f"in-framework missing on {route_hash}")
            self.assertFalse(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"), f"drawer should be open on {route_hash}")
        self.assert_no_external_requests()

    def test_command_palette(self):
        page = self.open_page("/", "#search")
        page.click("#search")
        page.keyboard.type(">")
        page.wait_for_selector("#search-dropdown:not([hidden])", timeout=15000)
        self.assertIn("Go to", page.inner_text("#search-dropdown"))
        self.assert_no_external_requests()

    def test_env_modal_from_settings(self):
        page = self.open_page("/settings", "[data-open-env]")
        self.assertTrue(page.locator("#env-modal").get_attribute("hidden") is not None)
        page.click("[data-open-env]")
        page.wait_for_selector("#env-modal:not([hidden])", timeout=15000)
        page.keyboard.press("Escape")
        page.wait_for_selector("#env-modal[hidden]", timeout=15000, state="attached")
        self.assert_no_external_requests()

    def test_pin_popover(self):
        page = self.open_page("/section/1910.135", "#btn-pin")
        page.click("#btn-pin")
        page.wait_for_selector("#pin-pop:not([hidden])", timeout=15000)
        self.assertGreater(page.locator("#pin-pop input").count(), 0)
        self.assert_no_external_requests()

    def test_transfer_dock_hidden_without_jobs(self):
        page = self.open_page("/", "#transfer-dock", state="attached")
        self.assertIsNotNone(page.locator("#transfer-dock").get_attribute("hidden"))
        self.assert_no_external_requests()

    def test_chat_panel_toggle(self):
        page = self.open_page("/section/1910.135", "#chat-toggle")
        page.click("#chat-toggle")
        page.wait_for_selector("#chat:not([hidden])", timeout=15000)
        page.click("#chat-close")
        page.wait_for_selector("#chat[hidden]", timeout=15000, state="attached")
        self.assert_no_external_requests()

    def test_projects_page_and_pin_roundtrip(self):
        page = self.open_page("/section/1910.135", "#btn-pin")
        page.click("#btn-pin")
        page.wait_for_selector("#pin-pop:not([hidden]) input", timeout=15000)
        page.fill("#pin-pop input", "Helmet audit")
        page.keyboard.press("Enter")
        page.goto(f"{ENV.base_url}/#/projects")
        page.wait_for_selector("text=Helmet audit", timeout=15000)
        self.assert_no_external_requests()

    def test_news_page_masthead_and_tabs(self):
        page = self.open_page("/news", "#news-q")
        text = page.inner_text("#view")
        self.assertIn("Final Rules", text)
        self.assertIn("Enforcement", text)
        self.assert_no_external_requests()

    def test_news_inspection_case_file_and_popover_link(self):
        # 1. Reader activity popover on § 1910.134 routes enforcement links in-app (#/news/inspection/{id})
        # and displays Stage 2 enforcement citation stats + top paragraph cues.
        page = self.open_page("/title/29/section/1910.134", "#btn-news-activity:not([hidden])")
        page.click("#btn-news-activity")
        page.wait_for_selector("#news-pop:not([hidden]) a[href='#/news/inspection/307000001']", timeout=15000)
        self.assertIn("1 citation", page.inner_text("#news-pop").lower())
        page.click("#news-pop a[href='#/news/inspection/307000001']")
        page.wait_for_selector(".ins-front .ins-table", timeout=15000)
        text = page.inner_text("#view")
        self.assertIn("Acme Foundry", text)
        self.assertIn("1910.134(a)(1)", text)
        self.assertIn("$25,000", text)
        # 2. Direct inspection route for multi-citation case (306953084) shows paragraph-parsed standards
        # and Stage 4 Case File Clip to Workspace persists into framework_projects_v1.
        page.goto(f"{ENV.base_url}/#/news/inspection/306953084")
        page.wait_for_selector(".ins-front .ins-table", timeout=15000)
        case_text = page.inner_text("#view")
        self.assertIn("1910.1030(g)(2)(ii)(A)", case_text)
        self.assertIn("1926.501(b)(13)", case_text)
        page.click("[data-ins-act='clip']")
        clipped = page.evaluate("""() => {
          const list = JSON.parse(localStorage.getItem('framework_projects_v1') || '[]');
          return list.some(p => (p.cases || []).some(c => c.activity_nr === 306953084));
        }""")
        self.assertTrue(clipped)
        # 3. Typing `dol: amazon` in Cmd-K search fires zero /api/news/dol/search requests while typing.
        dol_reqs = []
        page.route("**/api/news/dol/search*", lambda route: (dol_reqs.append(route.request.url), route.fulfill(
            status=200, content_type="application/json",
            body='{"mode":"employer","query":"amazon","results":[],"count":0,"offset":0,"limit":25,"has_more":false,"cached":false}'
        )))
        page.fill("#search", "dol: amazon")
        page.wait_for_selector("#search-dropdown .sd-dol-hint", timeout=5000)
        self.assertEqual(dol_reqs, [])
        page.press("#search", "Enter")
        page.wait_for_function("() => location.hash.includes('dol_q=amazon')", timeout=5000)
        self.assert_no_external_requests()

    def test_first_run_profile_picker_when_empty(self):
        import json as _json
        page = self.context.new_page()
        page.clock.set_fixed_time(FROZEN)
        page.route("**/api/titles", lambda route: route.fulfill(
            status=200, content_type="application/json", body=_json.dumps([])))
        page.goto(f"{ENV.base_url}/#/")
        page.wait_for_selector(".welcome-card[data-profile='safety']", timeout=15000)
        self.assertIn("What do you work in?", page.inner_text("#view"))
        self.assertEqual(page.inner_text("#title-select-num"), "Federal")
        self.assertTrue(page.locator("#search").is_disabled())
        self.assertTrue(page.locator("#chat-toggle").is_disabled())
        # Cross-title verticals like News remain reachable before any title is installed.
        page.goto(f"{ENV.base_url}/#/news")
        page.wait_for_selector("#news-q", timeout=15000)
        # Returning to `/` shows the picker again, and picking a profile queues its download.
        page.route("**/api/library/download", lambda route: route.fulfill(
            status=200, content_type="application/json",
            body=_json.dumps({"id": 1, "title": 21, "kind": "title", "target": None,
                              "label": "Title 21", "state": "queued", "phase": "Waiting",
                              "done": None, "total": None, "error": None})))
        page.route("**/api/library/jobs", lambda route: route.fulfill(
            status=200, content_type="application/json",
            body=_json.dumps({"current": {"id": 1, "title": 21, "kind": "title",
                                          "label": "Title 21", "state": "running",
                                          "phase": "Downloading text", "done": 1000, "total": 2000},
                              "queued": [], "recent": []})))
        page.goto(f"{ENV.base_url}/#/")
        page.wait_for_selector(".welcome-card[data-profile='food-drugs']", timeout=15000)
        page.click(".welcome-card[data-profile='food-drugs']")
        page.wait_for_selector("#welcome-job-slot .welcome-progress", timeout=15000)
        self.assertIn("Title 21", page.inner_text("#welcome-job-slot"))
        self.assert_no_external_requests()

    def test_ui_standardization_regressions(self):
        # 1. Search segmented controls use reset styles (no native button border/fill).
        page = self.open_page("/search?q=hazard&scope=all", ".search-view-toggle button")
        btn_style = page.evaluate("""() => {
          const btns = [...document.querySelectorAll('.search-view-toggle button')];
          return btns.map(b => {
            const cs = getComputedStyle(b);
            return { text: b.textContent.trim(), border: cs.borderTopWidth, bg: cs.backgroundColor };
          });
        }""")
        self.assertEqual(len(btn_style), 2)
        for b in btn_style:
            self.assertEqual(b["border"], "0px", f"unexpected native border on {b}")
        self.assertNotEqual(btn_style[0]["bg"], btn_style[1]["bg"])

        # 2. News category tabs do not clip horizontally on desktop.
        page.goto(f"{ENV.base_url}/#/news")
        page.wait_for_selector(".news-tabs button", timeout=15000)
        news_overflow = page.evaluate("""() => {
          const seg = document.querySelector('.news-tabs');
          return { sw: seg.scrollWidth, cw: seg.clientWidth, count: seg.querySelectorAll('button').length };
        }""")
        self.assertEqual(news_overflow["count"], 6)
        self.assertLessEqual(news_overflow["sw"], news_overflow["cw"] + 1)

        # 3. Workspaces label consistency in primary sidebar and page heading (drawer stays retracted on main pages).
        page.goto(f"{ENV.base_url}/#/projects")
        page.wait_for_selector(".proj-page h1", timeout=15000)
        self.assertEqual(page.inner_text(".proj-page h1"), "Workspaces")
        self.assertEqual(page.locator('#activity-rail [data-target="projects"]').get_attribute("data-tip"), "Workspaces")
        self.assertTrue(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"))

        # 4. Library page keeps secondary drawer retracted and displays suite status cleanly.
        page.goto(f"{ENV.base_url}/#/library")
        page.wait_for_selector(".lib-front .suite-card", timeout=15000)
        self.assertTrue(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"))
        self.assert_no_external_requests()

    def test_dark_newsroom_and_multijurisdiction_ui(self):
        # 1. Dark-mode-only obsidian lock: no theme toggle and #070708 canvas void.
        page = self.open_page("/", ".hm-titles[data-snapshot-loaded='1']")
        self.assertEqual(page.locator("#theme-toggle").count(), 0)
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        self.assertEqual(bg, "rgb(7, 7, 8)")

        # 2. Desk ribbon filters home frameworks and tier bar appears.
        self.assertGreaterEqual(page.locator(".hm-title-card.has-tier-bar[data-ref-tier='cfr']").count(), 1)

        # 3. Searchable Federal Framework Switcher + #/corpus/ routing (CFR, FR, U.S.C. — no State).
        page.locator("#title-select").click()
        page.wait_for_selector("#title-pop:not([hidden])", timeout=5000)
        self.assertGreaterEqual(page.locator(".tm-group[data-ref-tier='cfr']").count(), 1)
        self.assertGreaterEqual(page.locator(".tm-group[data-ref-tier='fr']").count(), 1)
        self.assertGreaterEqual(page.locator(".tm-group[data-ref-tier='usc']").count(), 1)
        self.assertEqual(page.locator(".tm-group[data-ref-tier='state']").count(), 0)
        page.goto(f"{ENV.base_url}/#/corpus/federal-register/US/FR/")
        page.wait_for_selector(".resolver-card[data-ref-tier='fr']", timeout=5000)
        self.assertIn("Federal Register", page.inner_text(".resolver-card"))
        self.assertEqual(page.inner_text("#title-select-num").strip(), "FR")

        # 4. Reference Ledger popover (#btn-refs-ledger) and 9-tier colors on a section with xrefs.
        page.goto(f"{ENV.base_url}/#/title/29/section/1910.120")
        page.wait_for_selector("#btn-refs-ledger:not([hidden])", timeout=10000)
        page.locator("#btn-refs-ledger").click()
        page.wait_for_selector("#cite-pop[data-ref-tier]:not([hidden])", timeout=5000)
        self.assertGreaterEqual(page.locator("#cite-pop .refs-ledger-group").count(), 1)

        # 5. Subject Workspaces housing nested Action Projects.
        page.goto(f"{ENV.base_url}/#/projects")
        page.wait_for_selector(".proj-page [data-proj-act='new']", timeout=5000)
        page.locator(".proj-page [data-proj-act='new']").first.click()
        page.wait_for_selector("#proj-task-input", timeout=5000)
        page.fill("#proj-task-input", "Verify GHS SDS binders")
        page.locator("[data-proj-act='task-add']").click()
        page.wait_for_selector(".proj-task-row", timeout=5000)
        self.assertIn("Verify GHS SDS binders", page.inner_text(".proj-task-list"))
        self.assertEqual(page.inner_text(".proj-task-status"), "OPEN")
        page.locator(".proj-task-status").click()
        self.assertEqual(page.inner_text(".proj-task-status"), "IN PROGRESS")

        # 6. Visual Part TOC Atlas (Vertical-oriented thumbnails, >3 carousel initiation), See Full Part, and Title Start.
        page.goto(f"{ENV.base_url}/#/title/29/part/1910")
        page.wait_for_selector(".toc-atlas .toc-map-bar", timeout=5000)
        page.wait_for_selector(".toc-carousel.is-static .toc-card", timeout=5000)
        self.assertEqual(page.inner_text(".doc-kicker .ref-badge"), "FEDERAL REG")
        self.assertGreaterEqual(page.locator(".toc-group-count").count(), 1)
        self.assertGreaterEqual(page.locator(".toc-card").count(), 4)
        self.assertGreaterEqual(page.locator(".toc-sub-chip").count(), 2)
        # All subparts in fake Part 1910 have <= 3 sections, so no carousel is initiated yet.
        self.assertEqual(page.locator(".toc-carousel.is-carousel").count(), 0)
        # Cards must be vertically oriented (portrait: height > width) and display hydrated section info.
        page.wait_for_function(
            "() => [...document.querySelectorAll('.toc-card-excerpt')].every(el => el.textContent.trim().length > 0)",
            timeout=5000,
        )
        card_box = page.locator(".toc-card").first.bounding_box()
        self.assertIsNotNone(card_box)
        self.assertGreater(card_box["height"], card_box["width"])
        # Toggle between Thumbnails and Compact Index modes cleanly.
        page.locator("[data-toc-view='compact']").click()
        self.assertTrue(page.evaluate(
            "document.querySelector('.toc-groups-wrap').classList.contains('is-compact')"
        ))
        page.locator("[data-toc-view='cards']").click()
        page.locator("[data-toc-split='1910.120']").click()
        page.wait_for_selector(".main-stage.is-split #split-pane .split-body", timeout=5000)
        page.locator("[data-split-act='close']").click()

        # Verify >3 cards initiates the carousel while 3 cards stays static.
        import json as _json
        def _expand_tree(route):
            resp = route.fetch()
            tree = _json.loads(resp.text())
            subparts = tree["c"][0]["c"][0]["c"][0]["c"]
            # Subpart H -> 3 sections (must NOT initiate carousel); Subpart I -> 5 sections (MUST initiate carousel).
            subparts[0]["c"] = [
                {"t": "section", "id": "1910.120", "l": "§ 1910.120", "d": "HAZWOPER"},
                {"t": "section", "id": "1910.134", "l": "§ 1910.134", "d": "Respiratory protection."},
                {"t": "section", "id": "1910.135", "l": "§ 1910.135", "d": "Head protection."},
            ]
            subparts[1]["c"] = [
                {"t": "section", "id": "1910.134", "l": "§ 1910.134", "d": "Respiratory protection."},
                {"t": "section", "id": "1910.135", "l": "§ 1910.135", "d": "Head protection."},
                {"t": "section", "id": "1910.120", "l": "§ 1910.120", "d": "HAZWOPER"},
                {"t": "section", "id": "1910.1200", "l": "§ 1910.1200", "d": "Hazard communication."},
                {"t": "section", "id": "1910.134", "l": "§ 1910.134", "d": "Respiratory follow-up."},
            ]
            route.fulfill(status=200, content_type="application/json", body=_json.dumps(tree))

        car_page = self.context.new_page()
        car_page.clock.set_fixed_time(FROZEN)
        car_page.route("**/api/29/tree", _expand_tree)
        car_page.goto(f"{ENV.base_url}/#/title/29/part/1910")
        car_page.wait_for_selector(".toc-carousel.is-carousel .toc-slide", timeout=5000)
        # Only the 5-card subpart initiates a carousel; the 3-card and 1-card subparts remain static.
        self.assertEqual(car_page.locator(".toc-carousel.is-carousel").count(), 1)
        self.assertEqual(car_page.locator(".toc-carousel.is-static").count(), 2)
        grp = car_page.locator(".toc-group").nth(1)
        car = grp.locator(".toc-carousel.is-carousel")
        self.assertIn("01–03 / 05", grp.locator(".toc-ccnt").inner_text())
        grp.locator("[data-car-dir='1']").click()
        self.assertEqual(car.get_attribute("data-active-idx"), "2")
        self.assertIn("03–05 / 05", grp.locator(".toc-ccnt").inner_text())
        grp.locator("[data-car-dir='-1']").click()
        self.assertEqual(car.get_attribute("data-active-idx"), "0")
        car_box = car.locator(".toc-card").first.bounding_box()
        self.assertIsNotNone(car_box)
        self.assertGreater(car_box["height"], car_box["width"])
        car_page.close()

        page.goto(f"{ENV.base_url}/#/title/40/part/261/full")
        page.wait_for_selector("#btn-part-refs-ledger:not([hidden])", timeout=10000)
        self.assertEqual(page.inner_text(".doc-kicker .ref-badge"), "FULL PART")
        self.assertGreaterEqual(page.locator(".full-section-head.has-tier-bar[data-ref-tier='cfr']").count(), 1)
        page.locator("#btn-part-refs-ledger").click()
        page.wait_for_selector("#cite-pop[data-ref-tier]:not([hidden])", timeout=5000)

        page.goto(f"{ENV.base_url}/#/title/29/")
        page.wait_for_selector(".ts-auth-stack", timeout=5000)
        self.assertGreaterEqual(page.locator(".ts-lead.has-tier-bar[data-ref-tier='cfr']").count(), 1)
        self.assertGreaterEqual(page.locator(".ts-rail[data-ref-tier='cfr']").count(), 1)
        self.assertEqual(page.inner_text(".ts-folio .ref-badge"), "FEDERAL CFR")
        self.assert_no_external_requests()

    def test_secondary_reader_and_ref_launch(self):
        page = self.open_page("/title/29/section/1910.120", ".reg-body a.xref[href*='1910.134']")

        # 1. Plain-clicking a referenced CFR link keeps the main reader in place
        #    and prompts to open side-by-side or in an in-app reader tab.
        page.locator(".reg-body a.xref[href*='1910.134']").first.click()
        page.wait_for_selector("#cite-pop:not([hidden])", timeout=5000)
        self.assertIn("#/title/29/section/1910.120", page.url)
        split_btn = page.locator("#cite-pop [data-peek-split]")
        tab_btn = page.locator("#cite-pop [data-peek-tab]")
        self.assertEqual(split_btn.count(), 1)
        self.assertEqual(tab_btn.count(), 1)

        # Open in an in-app main reader tab (#main-tabs shows both tabs).
        tab_btn.click()
        page.wait_for_function("() => location.hash.includes('/title/29/section/1910.134')", timeout=5000)
        page.wait_for_selector("#main-tabs:not([hidden]) .reader-tab", timeout=5000)
        self.assertEqual(page.locator("#main-tabs .reader-tab").count(), 2)
        # Switch back to tab 1 (§ 1910.120).
        page.locator("#main-tabs [data-tab-switch]").first.click()
        page.wait_for_function("() => location.hash.includes('/title/29/section/1910.120')", timeout=5000)

        # 2. Clicking a reference -> "Open side-by-side" opens tabbed secondary reader (#split-tabs).
        page.locator(".reg-body a.xref[href*='1910.134']").first.click()
        page.wait_for_selector("#cite-pop [data-peek-split]", timeout=5000)
        page.locator("#cite-pop [data-peek-split]").click()
        page.wait_for_selector(".main-stage.is-split #split-pane .reg-body", timeout=5000)
        self.assertIn("1910.134", page.inner_text("#split-pane .split-head-title"))
        self.assertEqual(page.locator("#split-tabs .reader-tab").count(), 1)

        # Pin & Cited-by from secondary reader (offering in-app Tab + Split).
        page.locator("#split-btn-pin").click()
        page.wait_for_selector("#pin-pop:not([hidden]) .pin-new input", timeout=5000)
        page.fill("#pin-pop .pin-new input", "Split Pin Workspace")
        page.press("#pin-pop .pin-new input", "Enter")
        self.assertIn("Pinned", page.inner_text("#split-btn-pin"))
        page.keyboard.press("Escape")

        page.locator("#split-btn-cited").click()
        page.wait_for_selector("#cite-pop .cited-row", timeout=5000)
        self.assertEqual(page.locator("#cite-pop [data-cited-tab]").count(), 1)
        page.keyboard.press("Escape")

        # Wide (52%) toggle and hover .para-tools on secondary reader.
        page.locator("[data-split-act='wide']").click()
        self.assertTrue(page.evaluate(
            "document.querySelector('.main-stage').classList.contains('is-split-wide')"
        ))
        split_para = page.locator("#split-pane .split-body .reg-p[id]").first
        split_para.hover()
        self.assertEqual(split_para.locator(".para-tools").count(), 1)

        # 3. Going a second & third step out: open 40 CFR 261.3 as Split Tab 2,
        #    then from inside 261.3 click "40 CFR part 262" -> Open side-by-side tab -> Split Tab 3!
        page.locator(".reg-body a.xref[href*='/title/40/section/261.3']").first.click()
        page.wait_for_selector("#cite-pop [data-peek-split]", timeout=5000)
        page.locator("#cite-pop [data-peek-split]").click()
        page.wait_for_selector("#split-pane .split-head-title:has-text('261.3')", timeout=5000)
        self.assertEqual(page.locator("#split-tabs .reader-tab").count(), 2)

        page.locator("#split-pane .reg-body a.xref[href*='/title/40/part/262']").first.click()
        page.wait_for_selector("#cite-pop [data-peek-split]", timeout=5000)
        self.assertEqual(page.locator("#cite-pop [data-peek-tab]").count(), 1)
        self.assertEqual(page.locator("#cite-pop [data-peek-replace-split]").count(), 1)
        page.locator("#cite-pop [data-peek-split]").click()
        page.wait_for_selector("#split-pane .split-head-title:has-text('Part 262')", timeout=5000)
        self.assertEqual(page.locator("#split-tabs .reader-tab").count(), 3)

        # 4. Save the entire main + side-by-side research tab group to a Workspace, close split,
        #    and restore it from the Workspace detail page.
        page.locator("[data-split-tabs-act='save-group']").click()
        page.wait_for_selector("#pin-pop:not([hidden]) #pin-group-name", timeout=5000)
        page.fill("#pin-pop #pin-group-name", "HAZMAT + RCRA Multi-Step")
        page.fill("#pin-pop .pin-new input", "Research Path Workspace")
        page.press("#pin-pop .pin-new input", "Enter")

        # Close split pane cleanly before restoring from Workspace.
        page.locator("[data-split-act='close']").click()
        self.assertTrue(page.locator("#split-pane").is_hidden())

        page.goto(f"{ENV.base_url}/#/projects")
        page.wait_for_selector(".proj-card a:has-text('Research Path Workspace')", timeout=5000)
        self.assertIn("tab group", page.inner_text(".proj-card:has-text('Research Path Workspace')"))
        page.locator(".proj-card a:has-text('Research Path Workspace')").click()
        page.wait_for_selector(".proj-tabgroup", timeout=5000)
        self.assertIn("HAZMAT + RCRA Multi-Step", page.inner_text(".proj-tabgroup-name"))
        page.locator("[data-proj-act='tabgroup-restore']").first.click()

        page.wait_for_selector("#main-tabs:not([hidden]) .reader-tab", timeout=5000)
        page.wait_for_selector(".main-stage.is-split #split-tabs .reader-tab", timeout=5000)
        self.assertEqual(page.locator("#main-tabs .reader-tab").count(), 2)
        self.assertEqual(page.locator("#split-tabs .reader-tab").count(), 3)

        # Switch split back to 261.3, swap with main, open Full Part in split cleanly.
        page.locator("#split-tabs [data-split-tab]", has_text="261.3").click()
        page.wait_for_selector("#split-pane .split-head-title:has-text('261.3')", timeout=5000)
        page.locator("#split-pane .split-kicker-link").click()
        page.wait_for_selector("#split-pane [data-split-part][data-split-full='1']", timeout=5000)
        page.locator("#split-pane [data-split-part][data-split-full='1']").click()
        page.wait_for_selector("#split-pane .full-section", timeout=5000)
        self.assertGreaterEqual(page.locator("#split-pane .full-section").count(), 1)

        # 5. Motion setting ("No" / "Less" / "Full") persists to html[data-motion] & localStorage.
        page.goto(f"{ENV.base_url}/#/settings")
        page.wait_for_selector("[data-set='motion'][data-value='less']", timeout=5000)
        page.locator("[data-set='motion'][data-value='less']").click()
        self.assertEqual(page.evaluate("document.documentElement.dataset.motion"), "less")
        self.assertEqual(page.evaluate("localStorage.getItem('motionLevel')"), "less")
        page.locator("[data-set='motion'][data-value='none']").click()
        self.assertEqual(page.evaluate("document.documentElement.dataset.motion"), "none")
        page.locator("[data-set='motion'][data-value='full']").click()
        self.assertEqual(page.evaluate("document.documentElement.dataset.motion"), "full")

        self.assert_no_external_requests()

    def test_help_settings_drawer_and_env_modal_behavior(self):
        # 1. Clicking Settings in the primary sidebar navigates directly to #/settings (closing the framework drawer).
        page = self.open_page("/section/1910.135", "#activity-rail")
        page.click('#activity-rail a[data-target="settings"]')
        page.wait_for_selector('#view [data-set], #view [data-open-env]', timeout=5000)
        self.assertTrue(page.evaluate("document.documentElement.classList.contains('drawer-retracted')"))
        set_text = page.inner_text('#view').lower()
        for section in ("appearance", "claude", "news", "storage", "keyboard"):
            self.assertIn(section, set_text)

        # 2. #/help renders outcome-framed cards, RSS links, and collapsible .env footnote.
        page.goto(f"{ENV.base_url}/#/help")
        page.wait_for_selector('.help-card .help-logo', timeout=5000)
        help_text = page.inner_text('#view')
        self.assertIn("Connections & API Keys", help_text)
        self.assertIn("What is a .env file?", help_text)
        self.assertEqual(page.locator(".help-card.is-left, .help-card.is-right").count(), 0)
        page.click('[data-open-env="dol_api_key"]')
        page.wait_for_selector('#env-modal:not([hidden])', timeout=5000)
        page.keyboard.press("Escape")
        page.wait_for_selector('#env-modal[hidden]', timeout=5000, state="attached")
        self.assert_no_external_requests()

    def test_newsroom_filters_setup_notice_and_activity_popover(self):
        import json as _json
        page = self.open_page("/news", "#news-q")
        # 6 tabs rendered
        self.assertEqual(page.locator('.news-tabs [role="tab"]').count(), 6)
        # Filter input debounces into hash query
        page.fill('#news-q', 'helmet')
        page.wait_for_function("() => location.hash.includes('q=helmet')", timeout=5000)
        page.fill('#news-q', '')
        page.wait_for_function("() => !location.hash.includes('q=')", timeout=5000)
        # Empty Enforcement state without DOL key links to #/help and opens #env-modal
        page.route("**/api/news?category=enforcement*", lambda route: route.fulfill(
            status=200, content_type="application/json", body=_json.dumps({"articles": [], "total": 0, "offset": 0})))
        page.click('.news-tabs [data-news-cat="enforcement"]')
        page.wait_for_selector('.news-setup [data-open-env="dol_api_key"]', timeout=5000)
        self.assertEqual(page.locator('.news-setup a[href="#/help"]').count(), 1)
        # Activity button on § 1910.134 opens #news-pop with seeded activity and "See all in News" link
        page.goto(f"{ENV.base_url}/#/title/29/section/1910.134")
        page.wait_for_selector('#btn-news-activity:not([hidden])', timeout=10000)
        self.assertIn("rules & citations", (page.locator('#btn-news-activity').get_attribute('aria-label') or page.inner_text('#btn-news-activity')).lower())
        page.click('#btn-news-activity')
        page.wait_for_selector('#news-pop:not([hidden])', timeout=5000)
        pop_text = page.inner_text('#news-pop').lower()
        self.assertIn("federal register & osha activity", pop_text)
        self.assertIn("see all in news", pop_text)
        self.assert_no_external_requests()

    def test_library_front_filter_sort_and_two_click_remove_arming(self):
        page = self.open_page("/library", ".lib-front .lib-story")
        # Sort toggle
        page.click('.lib-seg [data-sort="number"]')
        self.assertEqual(page.locator('.lib-seg [data-sort="number"]').get_attribute("aria-pressed"), "true")
        # Live filter
        page.fill('#lib-filter', 'zzznomatch')
        page.wait_for_selector('#lib-none:not([hidden])', timeout=5000)
        page.fill('#lib-filter', 'Labor')
        self.assertGreaterEqual(page.locator('.lib-story:not([hidden])').count(), 1)
        # Hover the story card so actions reveal, then first click on Remove arms the button + announces via #nav-live
        story = page.locator('.lib-story:not([hidden])').first
        story.hover()
        rm_btn = story.locator('button[data-act="remove"]')
        rm_btn.click()
        self.assertIn("Confirm remove", rm_btn.inner_text())
        self.assertIn("Press again", page.inner_text('#nav-live'))
        self.assert_no_external_requests()


class ScreenshotCase(BrowserCase):
    def assert_baseline(self, page, name: str):
        page.wait_for_timeout(250)  # let fonts/layout fully settle
        shot = page.screenshot(animations="disabled")
        platform_dir = BASELINE_ROOT / PLATFORM
        path = platform_dir / f"{name}.png"
        if UPDATE_BASELINES:
            platform_dir.mkdir(parents=True, exist_ok=True)
            path.write_bytes(shot)
            return
        if not path.exists():
            self.fail(f"Missing visual baseline {path}; record with UPDATE_BASELINES=1")
        actual = Image.open(io.BytesIO(shot)).convert("RGB")
        expected = Image.open(path).convert("RGB")
        if actual.size != expected.size:
            self.fail(f"{name}: size {actual.size} != baseline {expected.size}")
        mask = ImageChops.difference(actual, expected).convert("L").point(
            lambda v: 255 if v > PIXEL_DELTA else 0)
        bad = sum(1 for px in mask.get_flattened_data() if px)
        frac = bad / (actual.size[0] * actual.size[1])
        if frac > MAX_DIFF_FRACTION:
            debug = platform_dir / f"{name}.actual.png"
            debug.write_bytes(shot)
            self.fail(f"{name}: {frac:.4%} of pixels differ (> {MAX_DIFF_FRACTION:.2%}); "
                      f"actual saved to {debug}")


class DarkDesktopScreens(ScreenshotCase):
    def test_overview(self):
        page = self.open_page("/", ".hm-titles[data-snapshot-loaded='1']")
        page.wait_for_selector(".hm-news[data-news-loaded='1']", timeout=15000)
        self.assert_baseline(page, "overview-dark-desktop")
        self.assert_no_external_requests()

    def test_section_units(self):
        page = self.open_page("/section/1910.1200", "#view-head")
        self.assert_baseline(page, "section-units-dark-desktop")
        self.assert_no_external_requests()

    def test_news(self):
        page = self.open_page("/news", "#news-q")
        self.assert_baseline(page, "news-dark-desktop")
        self.assert_no_external_requests()

    def test_library(self):
        page = self.open_page("/library", "#view")
        page.wait_for_selector(".lib-front, .lib-story, .lib-metrics", timeout=15000)
        self.assert_baseline(page, "library-dark-desktop")
        self.assert_no_external_requests()


class MobileScreens(ScreenshotCase):
    viewport = MOBILE

    def test_section_units_mobile(self):
        page = self.open_page("/section/1910.1200", "#view-head")
        self.assert_baseline(page, "section-units-dark-mobile")
        self.assert_no_external_requests()


if __name__ == "__main__":
    unittest.main()
