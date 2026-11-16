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
    theme = "dark"
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
            "theme": self.theme,
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
        page = self.open_page("/", ".metric, .ov-card, #view h1, .overview")
        self.assertIn("FRAMEWORK", page.title())
        page.goto(f"{ENV.base_url}/#/section/1910.135")
        page.wait_for_selector("text=protective helmet", timeout=15000)
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
        # The news page focuses its search box; blur so the next chord isn't typed into it.
        page.evaluate("document.activeElement && document.activeElement.blur()")
        # G,L targets the Library rail item: a button that opens the drawer's
        # Library panel (only Overview/Home/News are links).
        page.keyboard.press("g")
        page.keyboard.press("l")
        page.wait_for_function(
            "document.querySelector('#activity-rail [data-target=\"library\"]')?.getAttribute('aria-expanded') === 'true'",
            timeout=15000)
        self.assert_no_external_requests()

    def test_alt_digit_navigation(self):
        page = self.open_page("/", "#activity-rail")
        page.keyboard.press("Alt+Digit5")
        page.wait_for_selector("#news-q", timeout=15000)
        self.assertTrue(page.evaluate("location.hash").startswith("#/news"))
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

    def test_first_run_profile_picker_when_empty(self):
        import json as _json
        page = self.context.new_page()
        page.clock.set_fixed_time(FROZEN)
        page.route("**/api/titles", lambda route: route.fulfill(
            status=200, content_type="application/json", body=_json.dumps([])))
        page.goto(f"{ENV.base_url}/#/")
        page.wait_for_selector(".welcome-card[data-profile='safety']", timeout=15000)
        self.assertIn("What do you work in?", page.inner_text("#view"))
        self.assertEqual(page.inner_text("#title-select-num"), "No titles")
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
        bad = sum(1 for px in mask.getdata() if px)
        frac = bad / (actual.size[0] * actual.size[1])
        if frac > MAX_DIFF_FRACTION:
            debug = platform_dir / f"{name}.actual.png"
            debug.write_bytes(shot)
            self.fail(f"{name}: {frac:.4%} of pixels differ (> {MAX_DIFF_FRACTION:.2%}); "
                      f"actual saved to {debug}")


class DarkDesktopScreens(ScreenshotCase):
    def test_overview(self):
        page = self.open_page("/", "#view")
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


class LightDesktopScreens(ScreenshotCase):
    theme = "light"

    def test_overview_light(self):
        page = self.open_page("/", "#view")
        self.assert_baseline(page, "overview-light-desktop")
        self.assert_no_external_requests()


class MobileScreens(ScreenshotCase):
    viewport = MOBILE

    def test_section_units_mobile(self):
        page = self.open_page("/section/1910.1200", "#view-head")
        self.assert_baseline(page, "section-units-dark-mobile")
        self.assert_no_external_requests()


if __name__ == "__main__":
    unittest.main()
