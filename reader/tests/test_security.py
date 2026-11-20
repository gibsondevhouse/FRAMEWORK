"""The local trust boundary (app/security.py, register item SEC-001): the server answers
only under a loopback name, and state-changing or API requests only from its own origin.
Then the browser security headers (SEC-003): every response carries a content security
policy, nosniff, a no-framing rule and a referrer policy."""
import base64
import hashlib
import os
import shutil
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from app import config, security, store
from app.main import app
from tests.base import HermeticTestCase
from tests.test_usc_corpus import UscTestCase

HOST = "localhost:8000"
OWN = f"http://{HOST}"


def check(method, path, **headers):
    return security.check_request(method, path, Headers({"host": HOST, **{k.replace("_", "-"): v for k, v in headers.items()}}))


class HostNameTests(HermeticTestCase):
    def test_host_name_strips_port_case_and_brackets(self):
        cases = {
            "localhost": "localhost", "LocalHost:8000": "localhost", "127.0.0.1:8000": "127.0.0.1",
            "[::1]:8000": "::1", "[::1]": "::1", "localhost.:8000": "localhost",
            "": "", None: "", "evil.example:8000": "evil.example",
            # Not a host at all: these must never be read as a loopback name.
            "localhost:8000@evil.example": "", "localhost/..": "", "localhost:80abc": "", "[::1]evil": "",
            "local host": "",
        }
        for raw, want in cases.items():
            self.assertEqual(security.host_name(raw), want, raw)

    def test_allowed_hosts_are_loopback_plus_the_env_list(self):
        self.assertEqual(security.allowed_hosts() - {"testserver"}, {"localhost", "127.0.0.1", "::1"})
        os.environ["SERVER_ALLOWED_HOSTS"] = " Reader.Lan , 10.0.0.5,, "
        self.assertLessEqual({"reader.lan", "10.0.0.5", "localhost"}, security.allowed_hosts())
        self.assertNotIn("", security.allowed_hosts())

    def test_same_origin_compares_host_and_port(self):
        self.assertTrue(security.same_origin(OWN, HOST))
        self.assertTrue(security.same_origin("http://LOCALHOST:8000", HOST))
        self.assertTrue(security.same_origin("http://localhost", "localhost:80"))       # default port either way
        self.assertTrue(security.same_origin("https://reader.lan", "reader.lan:443", "https"))
        for other in ("http://localhost:3000", "http://127.0.0.1:8000", "http://evil.example", "null", "",
                      "localhost:8000", "file:///x", "http://localhost:8000.evil.example"):
            self.assertFalse(security.same_origin(other, HOST), other)


class CheckRequestTests(HermeticTestCase):
    def test_a_foreign_host_is_refused_for_every_kind_of_request(self):
        for method, path in (("GET", "/"), ("GET", "/static/dist/app.js"), ("GET", "/api/titles"), ("POST", "/api/library/update-all")):
            got = security.check_request(method, path, Headers({"host": "evil.example:8000"}))
            self.assertEqual(got, (400, security.BAD_HOST), (method, path))
        self.assertEqual(security.check_request("GET", "/", Headers({}))[0], 400)        # no Host at all

    def test_loopback_hosts_pass(self):
        for host in ("localhost:8000", "127.0.0.1:8000", "[::1]:8000", "localhost"):
            self.assertIsNone(security.check_request("GET", "/api/titles", Headers({"host": host})), host)

    def test_clients_that_are_not_browsers_pass(self):
        # curl, scripts and the test client send neither Origin nor Sec-Fetch-Site.
        for method in ("GET", "POST", "DELETE"):
            self.assertIsNone(check(method, "/api/library/29"))

    def test_the_apps_own_pages_pass(self):
        self.assertIsNone(check("POST", "/api/settings/env", origin=OWN, sec_fetch_site="same-origin"))
        self.assertIsNone(check("GET", "/api/titles", sec_fetch_site="same-origin"))
        self.assertIsNone(check("GET", "/api/titles", sec_fetch_site="none"))            # typed into the address bar

    def test_another_origin_cannot_change_anything(self):
        for origin in ("http://evil.example", "http://localhost:3000", "http://127.0.0.1:8000", "null"):
            for method in ("POST", "PUT", "PATCH", "DELETE"):
                self.assertEqual(check(method, "/api/library/update-all", origin=origin), (403, security.CROSS_ORIGIN))
        # A form POST from a browser that omits Origin still says where it came from.
        for site in ("cross-site", "same-site"):
            self.assertEqual(check("POST", "/api/library/update-all", sec_fetch_site=site), (403, security.CROSS_ORIGIN))
        # An unsafe method is guarded on any path, not just /api/.
        self.assertEqual(check("POST", "/", origin="http://evil.example"), (403, security.CROSS_ORIGIN))
        # A same-origin claim in Sec-Fetch-Site does not outrank a foreign Origin.
        self.assertEqual(check("POST", "/api/chat", origin="http://evil.example", sec_fetch_site="same-origin")[0], 403)

    def test_another_origin_cannot_reach_the_api_at_all(self):
        self.assertEqual(check("GET", "/api/news/fr/2026-00001", sec_fetch_site="cross-site")[0], 403)   # <img src>, link click
        self.assertEqual(check("GET", "/api/titles", origin="http://evil.example")[0], 403)             # fetch()
        self.assertEqual(check("OPTIONS", "/api/titles", origin="http://evil.example")[0], 403)         # CORS preflight

    def test_pages_and_assets_may_be_linked_from_elsewhere(self):
        for path in ("/", "/static/dist/app.css", "/usc/29/655", "/healthz"):
            self.assertIsNone(check("GET", path, sec_fetch_site="cross-site"), path)


class MiddlewareTests(HermeticTestCase):
    """The guard as mounted: on a tiny app, then on the real one."""

    def setUp(self):
        super().setUp()
        self.calls: list[str] = []
        mini = FastAPI()
        mini.add_middleware(security.LocalTrustMiddleware)

        @mini.post("/api/thing")
        def change() -> dict:
            self.calls.append("changed")
            return {"ok": True}

        @mini.get("/api/thing")
        def read() -> dict:
            return {"secret": 1}

        self.mini = TestClient(mini, base_url=OWN)

    def test_refusals_never_reach_the_route(self):
        r = self.mini.post("/api/thing", headers={"host": "evil.example:8000"})
        self.assertEqual((r.status_code, r.json()), (400, {"detail": security.BAD_HOST}))
        r = self.mini.post("/api/thing", headers={"origin": "http://evil.example"})
        self.assertEqual((r.status_code, r.json()), (403, {"detail": security.CROSS_ORIGIN}))
        self.assertEqual(r.headers["cache-control"], "no-store")
        self.assertEqual(self.mini.get("/api/thing", headers={"host": "evil.example"}).status_code, 400)
        self.assertEqual(self.calls, [])

    def test_allowed_requests_reach_the_route(self):
        self.assertEqual(self.mini.post("/api/thing").json(), {"ok": True})                                # a script
        self.assertEqual(self.mini.post("/api/thing", headers={"origin": OWN}).json(), {"ok": True})       # the app
        self.assertEqual(self.mini.get("/api/thing", headers={"sec-fetch-site": "same-origin"}).json(), {"secret": 1})
        self.assertEqual(self.calls, ["changed", "changed"])

    def test_an_extra_host_must_be_listed(self):
        self.assertEqual(self.mini.get("/api/thing", headers={"host": "reader.lan"}).status_code, 400)
        os.environ["SERVER_ALLOWED_HOSTS"] = "reader.lan"
        self.assertEqual(self.mini.get("/api/thing", headers={"host": "reader.lan"}).status_code, 200)

    def test_the_real_app_is_guarded(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        with mock.patch.object(config, "DATA_DIR", tmp), \
                mock.patch.object(config, "write_env_updates", side_effect=AssertionError("the key file must not be touched")):
            store.reset_connections()
            self.addCleanup(store.reset_connections)
            client = TestClient(app, base_url=OWN)
            # A re-pointed hostname: refused on a page, on the API, and on the route that writes keys.
            rebound = {"host": "evil.example:8000"}
            self.assertEqual(client.get("/", headers=rebound).status_code, 400)
            self.assertEqual(client.get("/api/titles", headers=rebound).status_code, 400)
            self.assertEqual(client.post("/api/settings/env", json={"anthropic_api_key": "x"}, headers=rebound).status_code, 400)
            # Another site's page: refused on the body-less POST routes and on DELETE.
            foreign = {"origin": "http://evil.example", "sec-fetch-site": "cross-site"}
            for method, path in (("POST", "/api/library/update-all"), ("POST", "/api/library/jobs/clear"),
                                 ("POST", "/api/constitution/build"), ("DELETE", "/api/plaw"),
                                 ("POST", "/api/settings/env")):
                self.assertEqual(client.request(method, path, headers=foreign).status_code, 403, path)
            # The app itself still works.
            self.assertEqual(client.get("/api/titles", headers={"sec-fetch-site": "same-origin"}).json(), [])
            self.assertEqual(client.get("/").status_code, 200)


# --- Browser security headers (SEC-003) -----------------------------------------------------

def sha256_source(text: str) -> str:
    """A CSP hash source computed the long way, independently of app/security.py."""
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode() + "'"


class _InlineBlocks(HTMLParser):
    """The text of every inline <script> and <style> in a page, read with a real HTML parser
    (app/security.py uses a regular expression; the two must agree)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.blocks: dict[str, list[str]] = {"script": [], "style": []}
        self._open: str | None = None

    def handle_starttag(self, tag, attrs):
        if tag in self.blocks and not any(k == "src" for k, _ in attrs):
            self._open = tag
            self.blocks[tag].append("")

    def handle_endtag(self, tag):
        if tag == self._open:
            self._open = None

    def handle_data(self, data):
        if self._open:
            self.blocks[self._open][-1] += data


def inline_blocks(html: str) -> dict[str, list[str]]:
    parser = _InlineBlocks()
    parser.feed(html)
    parser.close()
    return parser.blocks


def directives(policy: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in policy.split(";"):
        name, *sources = part.split()
        out[name] = sources
    return out


def assert_security_headers(case, response, policy: str | None = None) -> None:
    h = response.headers
    case.assertEqual(h["content-security-policy"], policy or security.content_security_policy())
    case.assertEqual(h["x-content-type-options"], "nosniff")
    case.assertEqual(h["x-frame-options"], "DENY")
    case.assertEqual(h["referrer-policy"], "same-origin")
    for name in ("content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"):
        case.assertEqual(len(h.get_list(name)), 1, name)                # set once, never doubled


class PolicyTests(HermeticTestCase):
    def test_a_hash_is_taken_over_what_the_browser_sees(self):
        self.assertEqual(security.csp_hash("go()"), sha256_source("go()"))
        self.assertEqual(security.csp_hash("caf\u00e9"), sha256_source("caf\u00e9"))             # UTF-8
        self.assertEqual(security.csp_hash(b"a\r\nb\rc"), sha256_source("a\nb\nc"))              # CRLF checkout
        self.assertNotEqual(security.csp_hash("go()"), security.csp_hash("go() "))               # exact text only

    def test_inline_scripts_are_found_and_external_ones_skipped(self):
        html = (b'<head><script>one()</script>'
                b'<script type="module" crossorigin src="/static/dist/app.js"></script>'
                b'<SCRIPT type="text/javascript">\r\n  two()\r\n</SCRIPT></head><body><p>no script here</p></body>')
        self.assertEqual(security.inline_script_hashes(html), [sha256_source("one()"), sha256_source("\n  two()\n")])
        self.assertEqual(security.inline_script_hashes(b"<p>nothing</p>"), [])

    def test_the_policy_allows_only_what_the_app_needs(self):
        got = directives(security.content_security_policy())
        script_hashes = security.inline_script_hashes((config.STATIC_DIR / "dist" / "index.html").read_bytes())
        style_hashes = [h for h in got["style-src"] if h.startswith("'sha256-")]
        self.assertEqual(got, {
            "default-src": ["'none'"],
            "script-src": ["'self'", *script_hashes],
            "style-src": ["'self'", *style_hashes],
            "style-src-attr": ["'unsafe-inline'"],
            "img-src": ["'self'", "data:", "https://img.federalregister.gov"],
            "font-src": ["'self'"],
            "connect-src": ["'self'"],
            "base-uri": ["'none'"],
            "form-action": ["'self'"],
            "frame-ancestors": ["'none'"],
        })
        # Script can only come from the app's own files or an exact inline block.
        for name, sources in got.items():
            self.assertNotIn("'unsafe-eval'", sources, name)
            self.assertNotIn("*", sources, name)
            if name != "style-src-attr":
                self.assertNotIn("'unsafe-inline'", sources, name)

    def test_the_built_page_has_exactly_one_inline_script_and_it_is_allowed(self):
        index = config.STATIC_DIR / "dist" / "index.html"
        blocks = inline_blocks(index.read_text(encoding="utf-8"))
        self.assertEqual(len(blocks["script"]), 1)
        self.assertEqual(blocks["style"], [])
        self.assertIn("localStorage", blocks["script"][0])                         # the pre-paint script
        self.assertEqual(security.inline_script_hashes(index.read_bytes()), [sha256_source(blocks["script"][0])])
        self.assertIn(sha256_source(blocks["script"][0]), directives(security.content_security_policy())["script-src"])

    def test_the_policy_follows_a_rebuild_of_the_page(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / "dist").mkdir()
        index = tmp / "dist" / "index.html"
        with mock.patch.object(config, "STATIC_DIR", tmp):
            self.assertEqual(directives(security.content_security_policy())["script-src"], ["'self'"])   # no build yet
            index.write_bytes(b"<script>first()</script>")
            self.assertEqual(directives(security.content_security_policy())["script-src"], ["'self'", sha256_source("first()")])
            index.write_bytes(b"<script>second_build()</script>")                  # rebuilt under a running server
            self.assertEqual(directives(security.content_security_policy())["script-src"],
                             ["'self'", sha256_source("second_build()")])
        # Back on the real build, the real hash.
        self.assertNotIn(sha256_source("second_build()"), security.content_security_policy())

    def test_the_interactive_api_pages_are_the_only_exception(self):
        self.assertEqual({app.docs_url, app.redoc_url}, set(security.INTERACTIVE_DOCS_PATHS))
        for path in security.INTERACTIVE_DOCS_PATHS:
            self.assertEqual(security.response_headers(path)["Content-Security-Policy"], security.DOCS_POLICY)
        for path in ("/", "/docs/", "/docs/oauth2-redirect", "/openapi.json", "/api/titles", "/static/dist/app.js"):
            self.assertEqual(security.response_headers(path)["Content-Security-Policy"],
                             security.content_security_policy(), path)
        self.assertIn("frame-ancestors 'none'", security.DOCS_POLICY)


class SecurityHeadersMiddlewareTests(HermeticTestCase):
    def setUp(self):
        super().setUp()
        mini = FastAPI()
        mini.add_middleware(security.SecurityHeadersMiddleware)

        @mini.get("/stream")
        def stream() -> StreamingResponse:
            return StreamingResponse(iter([b"data: one\n\n", b"data: two\n\n"]), media_type="text/event-stream",
                                     headers={"X-Frame-Options": "SAMEORIGIN"})      # a route cannot loosen it

        @mini.get("/boom")
        def boom() -> dict:
            raise RuntimeError("unhandled")

        self.mini = mini

    def test_a_stream_passes_through_with_the_headers(self):
        r = TestClient(self.mini).get("/stream")
        self.assertEqual(r.text, "data: one\n\ndata: two\n\n")
        self.assertTrue(r.headers["content-type"].startswith("text/event-stream"))
        assert_security_headers(self, r)

    def test_an_unhandled_error_still_carries_the_headers_and_is_still_raised(self):
        r = TestClient(self.mini, raise_server_exceptions=False).get("/boom")
        self.assertEqual((r.status_code, r.text), (500, "Internal Server Error"))
        assert_security_headers(self, r)
        with self.assertRaises(RuntimeError):                                       # the server still gets to log it
            TestClient(self.mini).get("/boom")

    def test_every_kind_of_response_from_the_real_app(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        with mock.patch.object(config, "DATA_DIR", tmp):
            store.reset_connections()
            self.addCleanup(store.reset_connections)
            client = TestClient(app, base_url=OWN)
            page = client.get("/")
            self.assertEqual(page.status_code, 200)
            assert_security_headers(self, page)
            # End to end: every inline block in the page that was served is allowed by the
            # policy that was served with it.
            blocks = inline_blocks(page.text)
            allowed = directives(page.headers["content-security-policy"])["script-src"]
            self.assertEqual([sha256_source(b) for b in blocks["script"]], allowed[1:])
            etag = client.get("/static/dist/app.css").headers["etag"]
            expected = (
                ("GET", "/api/titles", {}, 200),                                      # JSON
                ("GET", "/static/dist/app.js", {}, 200),                              # a static file
                ("GET", "/static/dist/app.css", {"if-none-match": etag}, 304),        # revalidated
                ("HEAD", "/", {}, 405),                                               # method not allowed
                ("GET", "/healthz", {}, 200),
                ("GET", "/openapi.json", {}, 200),
                ("GET", "/static/nope.js", {}, 404),
                ("GET", "/api/29/section/1910.134", {}, 404),                         # nothing installed
                ("POST", "/api/library/download", {}, 422),                           # a validation error
                ("GET", "/", {"host": "evil.example:8000"}, 400),                     # the guard's refusals
                ("POST", "/api/library/update-all", {"origin": "http://evil.example"}, 403),
            )
            for method, path, headers, status in expected:
                r = client.request(method, path, headers=headers)
                self.assertEqual(r.status_code, status, (method, path))
                assert_security_headers(self, r)
            for path in ("/docs", "/redoc"):
                r = client.get(path)
                self.assertEqual(r.status_code, 200, path)
                assert_security_headers(self, r, security.DOCS_POLICY)


class ServerRenderedPageTests(UscTestCase):
    def test_the_standalone_usc_page_keeps_its_style_block(self):
        self.install()
        r = TestClient(app, base_url=OWN).get("/usc/4/1")
        self.assertEqual(r.status_code, 200)
        assert_security_headers(self, r)
        blocks = inline_blocks(r.text)
        self.assertEqual(blocks["script"], [])
        self.assertEqual(len(blocks["style"]), 1)
        allowed = directives(r.headers["content-security-policy"])["style-src"]
        self.assertEqual(allowed, ["'self'", sha256_source(blocks["style"][0])])
