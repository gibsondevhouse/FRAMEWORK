"""Shared hermetic base class for every test suite.

`HermeticTestCase` gives each test two guarantees, under both `pytest` and
`python -m unittest discover tests`:

1. **Env hygiene** — the tracked `.env` keys are saved and *removed*
   (`os.environ.pop`) before each test, then restored afterwards, so a
   populated `reader/.env` (real `DOL_API_KEY`, `ANTHROPIC_API_KEY`, …) can
   never leak into assertions. The keys are popped, never set to `""`:
   `config.news_agencies()` falls back to the OSHA slug only when
   `NEWS_AGENCIES` is *absent*, so `NEWS_AGENCIES=""` would break it.

2. **Dual-transport network guard** — both `httpx.HTTPTransport.handle_request`
   (sync) and `httpx.AsyncHTTPTransport.handle_async_request` (async) raise on
   any real network access, and so do the same two in `httpx2` when it is
   installed (newer `AsyncAnthropic` clients, used by `chat.py`, are built on
   it). Tests that need HTTP use `MockTransport` / ASGI transports, which are
   untouched.

Importing this module also registers Starlette's `testserver` host with the local trust
guard (`app/security.py`), which otherwise answers only loopback names; `SERVER_ALLOWED_HOSTS`
is a tracked key, so a developer's own value never reaches a test.
"""
import os
import unittest
from unittest import mock

import httpx

TRACKED_KEYS = (
    "DOL_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "NEWS_AGENCIES",
    "NEWS_SYNC",
    "NEWS_RETENTION_DAYS",
    "FR_CORPUS_TITLES",
    "FR_CORPUS_YEARS",
    "FR_MIN_INTERVAL",
    "GOVINFO_API_KEY",
    "GOV_MIN_INTERVAL",
    "SERVER_ALLOWED_HOSTS",
)

# Starlette's TestClient sends `Host: testserver`. The local trust guard (app/security.py)
# only answers loopback names, so the suites register that one name here, in-process.
from app import security  # noqa: E402

security.EXTRA_ALLOWED_HOSTS.add("testserver")


def watch_policy_violations(case: unittest.TestCase, context) -> list[str]:
    """Browser suites: fail `case` at teardown if any page in the Playwright `context` logged a
    content-security-policy violation (app/security.py, SEC-003). Returns the live list."""
    seen: list[str] = []
    context.on("console", lambda msg: seen.append(msg.text) if "Content Security Policy" in msg.text else None)
    case.addCleanup(lambda: case.assertEqual(seen, [], "a page broke the content security policy"))
    return seen


class HermeticTestCase(unittest.TestCase):
    """Base class for all suites: env pop-and-restore + no real network."""

    def setUp(self):
        super().setUp()

        saved = {k: os.environ.get(k) for k in TRACKED_KEYS}
        for k in TRACKED_KEYS:
            os.environ.pop(k, None)

        def restore():
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

        self.addCleanup(restore)

        from app import fr_client, news
        news.reset_dol_rate_state()
        self.addCleanup(news.reset_dol_rate_state)
        # Federal Register pacing/backoff never really sleeps under test; tests that care
        # read `self.fr_sleeps`.
        self.fr_sleeps: list[float] = []
        fr_sleep = mock.patch.object(fr_client, "_sleep", self.fr_sleeps.append)
        fr_sleep.start()
        self.addCleanup(fr_sleep.stop)
        fr_client.reset_pacing()
        from app import gov_http           # GovInfo bulk data / reginfo.gov pacing never sleeps either
        gov_sleep = mock.patch.object(gov_http, "_sleep", lambda sec: None)
        gov_sleep.start()
        self.addCleanup(gov_sleep.stop)
        gov_http.reset_pacing()

        for lib in _http_libraries():
            sync_guard = mock.patch.object(
                lib.HTTPTransport, "handle_request",
                side_effect=AssertionError("a test attempted real network access (sync)"))
            async_guard = mock.patch.object(
                lib.AsyncHTTPTransport, "handle_async_request",
                side_effect=AssertionError("a test attempted real network access (async)"))
            sync_guard.start()
            self.addCleanup(sync_guard.stop)
            async_guard.start()
            self.addCleanup(async_guard.stop)


def _http_libraries() -> list:
    """`httpx` (the app's own clients) and, when installed, `httpx2`: newer releases of the
    Anthropic client are built on it, and a guard on `httpx` alone would let `chat.py` through."""
    libs = [httpx]
    try:
        import httpx2
        libs.append(httpx2)
    except ImportError:
        pass
    return libs
