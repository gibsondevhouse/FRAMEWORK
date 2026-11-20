"""Secrets (register SEC-004): `reader/.env` is readable by its owner only, and no API key
(Anthropic, DOL, GovInfo) reaches a log line or an error message, including the request
addresses that carry a key as a query parameter."""
import contextlib
import importlib
import logging
import os
import shutil
import stat
import tempfile
import traceback
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import quote

import anthropic
import httpx
from fastapi.testclient import TestClient

from app import chat, config, dol_catalog, govinfo, news, news_store, store
from app.main import app
from fake_titles import FakeTitles
from tests.base import HermeticTestCase
from tests.news_fixtures import FakeAPI


def sdk_http():
    """The HTTP library the installed Anthropic client is built on: `httpx`, or `httpx2` in
    newer releases. A fake wire for the client has to be made of the same one."""
    probe = anthropic.AsyncAnthropic(api_key="probe")
    for cls in type(probe._client).__mro__:
        root = cls.__module__.split(".")[0]
        if root in ("httpx", "httpx2"):
            return importlib.import_module(root)
    raise AssertionError("the Anthropic client is built on an HTTP library this test does not know")

ANT = "sk-ant-api03-SENTINELanthropic000000000000"
DOL = "dolSENTINEL-1111-2222-3333"
GOV = "govSENTINEL+4444/5555=="                 # needs URL-encoding inside a query string
KEYS = (ANT, DOL, GOV, quote(GOV, safe=""))
ENV = {"ANTHROPIC_API_KEY": ANT, "DOL_API_KEY": DOL, "GOVINFO_API_KEY": GOV}


@contextlib.contextmanager
def everything_logged():
    """Every record from every logger, down to DEBUG, formatted the way a handler writes it
    (message plus traceback). Yields the list of lines."""
    lines: list[str] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            lines.append(self.format(record))

    handler = Capture(level=logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    level = root.level
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    try:
        yield lines
    finally:
        root.removeHandler(handler)
        root.setLevel(level)


def error_text(exc: BaseException) -> str:
    """Everything a caller could show or log about an exception."""
    return "\n".join((str(exc), repr(exc), "".join(traceback.format_exception(exc))))


class SecretsCase(HermeticTestCase):
    def assert_no_key(self, *texts: str) -> None:
        for text in texts:
            for key in KEYS:
                self.assertNotIn(key, text)


# --- reader/.env -------------------------------------------------------------------------------

class EnvFileTests(SecretsCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        p = mock.patch.object(config, "ROOT_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)
        self.env = self.tmp / ".env"
        if os.name == "posix":
            self.addCleanup(os.umask, os.umask(0))      # the most permissive process there is

    def mode(self, path: Path | None = None) -> int:
        return stat.S_IMODE((path or self.env).stat().st_mode)

    def leftovers(self) -> list[str]:
        return sorted(p.name for p in self.tmp.iterdir() if p.name != ".env")

    @unittest.skipUnless(os.name == "posix", "POSIX file modes")
    def test_a_new_key_file_is_readable_by_its_owner_only(self):
        config.write_env_updates({"DOL_API_KEY": DOL, "ANTHROPIC_API_KEY": ANT})
        self.assertEqual(self.mode(), 0o600)
        self.assertIn(f"DOL_API_KEY={DOL}", self.env.read_text(encoding="utf-8"))
        self.assertEqual(self.leftovers(), [])                           # no temporary copy of the keys

    @unittest.skipUnless(os.name == "posix", "POSIX file modes")
    def test_a_write_tightens_a_file_that_was_readable_by_everyone(self):
        self.env.write_text("# mine\nNEWS_SYNC=0\nDOL_API_KEY=old\n", encoding="utf-8")
        os.chmod(self.env, 0o644)
        config.write_env_updates({"DOL_API_KEY": DOL})
        self.assertEqual(self.mode(), 0o600)
        self.assertEqual(self.env.read_text(encoding="utf-8"), f"# mine\nNEWS_SYNC=0\nDOL_API_KEY={DOL}\n")

    @unittest.skipUnless(os.name == "posix", "POSIX file modes")
    def test_the_route_that_edits_keys_writes_it_the_same_way(self):
        from app import news_worker
        with mock.patch.object(news_worker, "request_sync", return_value=[]), \
                mock.patch.object(news_worker, "is_syncing", return_value=False):
            res = TestClient(app).post("/api/settings/env", json={"dol_api_key": DOL, "anthropic_api_key": ANT})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.mode(), 0o600)
        self.assert_no_key(res.text)

    @unittest.skipUnless(os.name == "posix", "POSIX file modes")
    def test_a_file_made_by_hand_is_tightened_when_the_app_loads(self):
        self.env.write_text(f"DOL_API_KEY={DOL}\n", encoding="utf-8")       # cp .env.example .env
        os.chmod(self.env, 0o664)
        config.secure_env_file()
        self.assertEqual(self.mode(), 0o600)
        os.chmod(self.env, 0o400)                                           # stricter than ours: left alone
        config.secure_env_file()
        self.assertEqual(self.mode(), 0o400)
        os.chmod(self.env, 0o600)
        self.env.unlink()
        config.secure_env_file()                                            # nothing to do, nothing raised
        self.assertFalse(self.env.exists())

    def test_a_failed_write_leaves_no_copy_of_the_keys_behind(self):
        self.env.write_text("DOL_API_KEY=old\n", encoding="utf-8")
        with mock.patch.object(config.os, "replace", side_effect=OSError("disk full")), self.assertRaises(OSError):
            config.write_env_updates({"DOL_API_KEY": DOL})
        self.assertEqual(self.leftovers(), [])
        self.assertEqual(self.env.read_text(encoding="utf-8"), "DOL_API_KEY=old\n")
        self.assertIsNone(config.dol_api_key())                             # and nothing applied in memory


# --- The redactor ------------------------------------------------------------------------------

class RedactionTests(SecretsCase):
    def setUp(self):
        super().setUp()
        os.environ.update(ENV)

    def test_key_carrying_query_parameters_lose_their_value(self):
        cases = {
            "GET https://apiprod.dol.gov/v4/get/OSHA/violation/json?limit=1&X-API-KEY=abc123&sort=desc":
                "GET https://apiprod.dol.gov/v4/get/OSHA/violation/json?limit=1&X-API-KEY=[redacted]&sort=desc",
            "url 'https://api.govinfo.gov/packages/FR-1/granules?api_key=zzz'":
                "url 'https://api.govinfo.gov/packages/FR-1/granules?api_key=[redacted]'",
            "x-api-key=a&API-KEY=b&apikey=c": "x-api-key=[redacted]&API-KEY=[redacted]&apikey=[redacted]",
        }
        for text, want in cases.items():
            self.assertEqual(config.redact_secrets(text), want)

    def test_a_configured_key_is_removed_wherever_it_appears(self):
        text = f"headers={{'x-api-key': '{ANT}'}} tried {DOL} then {GOV} then {quote(GOV, safe='')}"
        clean = config.redact_secrets(text)
        self.assert_no_key(clean)
        self.assertEqual(clean.count("[redacted]"), 4)

    def test_ordinary_text_is_left_alone(self):
        os.environ["DOL_API_KEY"] = "abc"                                   # too short to be a key
        for text in ("", "the keystone of 29 CFR 1910.134(abc)", "monkey=1&turkey=2", "GET /api/search?q=api+key"):
            self.assertEqual(config.redact_secrets(text), text)

    def test_every_log_record_in_the_process_is_cleaned(self):
        self.assertTrue(logging.getLogRecordFactory().redacts_secrets)
        factory = logging.getLogRecordFactory()
        config.install_log_redaction()                                      # idempotent
        self.assertIs(logging.getLogRecordFactory(), factory)

        url = httpx.URL("https://apiprod.dol.gov/v4/get/OSHA/violation/json", params={"X-API-KEY": DOL})
        log = logging.getLogger("some.library")
        with everything_logged() as lines:
            log.info('HTTP Request: %s %s "%s %d %s"', "GET", url, "HTTP/1.1", 200, "OK")     # the HTTP client's line
            log.warning(f"calling {url}")                                                      # pre-formatted
            log.error("with %(key)s", {"key": ANT})                                            # mapping arguments
            log.debug("govinfo %s", f"https://api.govinfo.gov/x?api_key={quote(GOV, safe='')}")
            log.info("%r", {"authorization": f"Bearer {ANT}"})                                 # only repr() shows it
            try:
                httpx.Response(403, request=httpx.Request("GET", url)).raise_for_status()
            except httpx.HTTPStatusError:
                log.exception("sync failed")                                                   # a traceback
        said = "\n".join(lines)
        self.assert_no_key(said)
        self.assertEqual(len(lines), 6)
        self.assertIn('HTTP Request: GET https://apiprod.dol.gov/v4/get/OSHA/violation/json?X-API-KEY=[redacted] "HTTP/1.1 200 OK"', said)
        self.assertIn("Traceback (most recent call last)", said)             # the traceback is still there
        self.assertIn("403 Forbidden", said)

    def test_a_cleaned_record_keeps_the_arguments_a_formatter_reads(self):
        """The server's access-log formatter unpacks five arguments from the record."""
        records: list[logging.LogRecord] = []
        handler = logging.Handler()
        handler.emit = records.append
        access = logging.getLogger("test.access")
        access.addHandler(handler)
        access.setLevel(logging.INFO)
        access.propagate = False
        self.addCleanup(access.removeHandler, handler)
        access.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5", "GET", f"/api/search?q={ANT}", "1.1", 200)
        access.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5", "GET", "/api/titles", "1.1", 200)
        self.assertEqual(records[0].args, ("127.0.0.1:5", "GET", "/api/search?q=[redacted]", "1.1", 200))
        self.assertEqual(records[1].args, ("127.0.0.1:5", "GET", "/api/titles", "1.1", 200))   # untouched

    def test_a_malformed_record_is_left_for_logging_to_report(self):
        record = logging.getLogRecordFactory()("x", logging.INFO, __file__, 1, "%d and %d", ("one",), None)
        self.assertEqual(record.args, ("one",))


# --- Real request paths ------------------------------------------------------------------------

def failing(status: int | None = None, exc: type[Exception] | None = None, text: str | None = None):
    """A transport that records requests and answers every one the same bad way."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if exc is not None:
            raise exc("simulated", request=request)
        if text is not None:
            return httpx.Response(200, text=text, request=request)
        # An upstream that echoes the request address back, key and all.
        return httpx.Response(status, json={"error": f"denied: {request.url}"}, request=request)

    return httpx.MockTransport(handler), seen


FAILURES = (
    {"status": 401}, {"status": 403}, {"status": 429}, {"status": 500},
    {"exc": httpx.ConnectError}, {"exc": httpx.ReadTimeout}, {"text": "<html>not json</html>"},
)


class NoKeyInLogsOrErrorsTests(SecretsCase):
    def setUp(self):
        super().setUp()
        os.environ.update(ENV)
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        p = mock.patch.object(config, "DATA_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)
        store.reset_connections()
        self.addCleanup(store.reset_connections)

    def test_dol_requests(self):
        """The DOL API takes the key in the query string, so the request address carries it."""
        calls = (
            lambda c: news._dol_get(c, DOL, "violation", {"limit": 5}),
            lambda c: dol_catalog._fetch_catalog_page(c, DOL, page=1, limit=20),
        )
        with everything_logged() as lines:
            for call in calls:
                worked: list[httpx.Request] = []
                ok = httpx.MockTransport(lambda req: (worked.append(req), httpx.Response(
                    200, json={"data": [], "datasets": [], "meta": {}}, request=req))[1])
                with httpx.Client(transport=ok) as c:
                    call(c)                                                 # a request that works
                self.assertEqual(worked[0].url.params["X-API-KEY"], DOL)    # the key really was sent
                for failure in FAILURES:
                    news.reset_dol_rate_state()
                    transport, seen = failing(**failure)
                    with httpx.Client(transport=transport) as c, self.assertRaises(news.SourceUnavailable) as raised:
                        call(c)
                    self.assertEqual(seen[0].url.params["X-API-KEY"], DOL)
                    self.assert_no_key(error_text(raised.exception))
        said = "\n".join(lines)
        self.assert_no_key(said)
        self.assertIn("apiprod.dol.gov", said)                              # the requests were logged ...
        self.assertIn("X-API-KEY=[redacted]", said)                         # ... without the key

    def test_govinfo_requests(self):
        with everything_logged() as lines:
            ok = httpx.MockTransport(lambda req: httpx.Response(200, json={"granules": [{"granuleId": "2026-20001"}]}, request=req))
            with httpx.Client(transport=ok) as c:
                self.assertEqual(govinfo.fr_package_documents("2026-11-02", c=c), {"2026-20001"})
            for failure in FAILURES:
                transport, seen = failing(**failure)
                with httpx.Client(transport=transport) as c, self.assertRaises(govinfo.fr_client.SourceUnavailable) as raised:
                    govinfo.fr_package_documents("2026-11-02", c=c)
                self.assertEqual(seen[0].url.params["api_key"], GOV)
                self.assert_no_key(error_text(raised.exception))
        said = "\n".join(lines)
        self.assert_no_key(said)
        self.assertIn("api.govinfo.gov", said)
        self.assertIn("api_key=[redacted]", said)

    def test_the_api_answers_and_the_logs_when_dol_fails(self):
        news_store.init_db()
        client = TestClient(app)
        with everything_logged() as lines:
            for fail in ({"fail_paths": ("/v4/get/OSHA/inspection/json",)},
                         {"rate_limit_paths": ("/v4/get/OSHA/inspection/json",)},
                         {"timeout_paths": ("/v4/get/OSHA/inspection/json",)},
                         {"malformed_paths": ("/v4/get/OSHA/inspection/json",)}):
                news.reset_dol_rate_state()
                fake = FakeAPI(**fail)
                with fake.patch_client():
                    for res in (client.get("/api/news/dol/search?q=acme&mode=employer"),
                                client.post("/api/news/inspection/306953084/enrich")):
                        self.assertGreaterEqual(res.status_code, 400, fail)
                        self.assert_no_key(res.text, str(res.headers))
                self.assertTrue(any(r.url.params.get("X-API-KEY") == DOL for r in fake.requests), fail)
            for res in (client.get("/api/settings/env"), client.get("/api/news/status"), client.get("/api/sources")):
                self.assertEqual(res.status_code, 200)
                self.assert_no_key(res.text)
        self.assert_no_key("\n".join(lines))

    def test_the_chat_stream_and_the_logs_when_anthropic_fails(self):
        """The real Anthropic client over a fake wire, with its own debug logging captured."""
        fake = FakeTitles()
        fake.install()
        self.addCleanup(fake.remove)
        wire = sdk_http()
        sent: list = []

        def api(status: int):
            def handler(request):
                sent.append(request)
                return wire.Response(status, request=request, json={
                    "type": "error", "error": {"type": "api_error", "message": "request refused"}})
            return anthropic.AsyncAnthropic(
                api_key=config.anthropic_key(), max_retries=0,
                http_client=wire.AsyncClient(transport=wire.MockTransport(handler)))

        client = TestClient(app)
        with everything_logged() as lines:
            for status in (400, 401, 403, 429, 500):
                with mock.patch.object(chat, "client", lambda status=status: api(status)):
                    res = client.post("/api/29/chat", json={
                        "messages": [{"role": "user", "content": "Do my workers need hard hats?"}],
                        "section_id": "1910.135", "model": "claude-sonnet-5-5"})
                self.assertEqual(res.status_code, 200)
                self.assertIn('"type": "error"', res.text)
                self.assert_no_key(res.text)
            with mock.patch.object(chat, "client", lambda: api(401)):
                chat.clear_models_cache()
                self.addCleanup(chat.clear_models_cache)
                self.assert_no_key(client.get("/api/29/models").text)
        # The key really was sent (as `x-api-key` or `Authorization`, depending on the client's version).
        self.assertTrue(sent and all(any(ANT in value for value in r.headers.values()) for r in sent))
        said = "\n".join(lines)
        self.assert_no_key(said)
        self.assertIn("api.anthropic.com", said)                            # the client did log its requests


if __name__ == "__main__":
    unittest.main()
