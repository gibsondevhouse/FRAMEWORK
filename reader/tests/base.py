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
   (sync) and `httpx.AsyncHTTPTransport.handle_async_request` (async, covering
   `AsyncAnthropic` in `chat.py`) raise on any real network access. Tests that
   need HTTP use `httpx.MockTransport` / ASGI transports, which are untouched.
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
)


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

        from app import news
        news.reset_dol_rate_state()
        self.addCleanup(news.reset_dol_rate_state)

        sync_guard = mock.patch.object(
            httpx.HTTPTransport, "handle_request",
            side_effect=AssertionError("a test attempted real network access (sync)"))
        async_guard = mock.patch.object(
            httpx.AsyncHTTPTransport, "handle_async_request",
            side_effect=AssertionError("a test attempted real network access (async)"))
        sync_guard.start()
        self.addCleanup(sync_guard.stop)
        async_guard.start()
        self.addCleanup(async_guard.stop)
