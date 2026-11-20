"""The local trust boundary (app/security.py, register item SEC-001): the server answers
only under a loopback name, and state-changing or API requests only from its own origin.
Then the access token (SEC-002): a request from another computer needs it, a local one does
not. Then the browser security headers (SEC-003): every response carries a content security
policy, nosniff, a no-framing rule and a referrer policy."""
import base64
import contextlib
import hashlib
import io
import os
import shutil
import stat
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from app import config, security, store
from app.main import app
from tests.base import HermeticTestCase
from tests.test_usc_corpus import UscTestCase

HOST = "localhost:8000"
OWN = f"http://{HOST}"
LAN_HOST = "reader.lan:8000"                 # a name the owner listed in SERVER_ALLOWED_HOSTS
LAN = f"http://{LAN_HOST}"
LAN_PEER = ("192.168.1.50", 50000)           # another computer on the network
THIS_PEER = ("127.0.0.1", 50000)
REAL_TOKEN_PATH = security.token_path        # before HermeticTestCase points it at a temp directory


def basic(password: str, user: str = "reader") -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


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

    def test_an_extra_host_must_be_listed_and_then_needs_the_token(self):
        self.assertEqual(self.mini.get("/api/thing", headers={"host": "reader.lan"}).status_code, 400)
        os.environ["SERVER_ALLOWED_HOSTS"] = "reader.lan"
        self.assertEqual(self.mini.get("/api/thing", headers={"host": "reader.lan"}).status_code, 401)
        ok = self.mini.get("/api/thing", headers={"host": "reader.lan", "authorization": f"Bearer {security.access_token()}"})
        self.assertEqual(ok.json(), {"secret": 1})

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


# --- The access token (SEC-002) --------------------------------------------------------------

def lan_check(method="GET", path="/api/titles", client=LAN_PEER, host=LAN_HOST, **headers):
    return security.check_request(
        method, path, Headers({"host": host, **{k.replace("_", "-"): v for k, v in headers.items()}}), "http", client)


class LocalRequestTests(HermeticTestCase):
    def test_only_a_loopback_address_is_this_computer(self):
        for peer in (None, ("127.0.0.1", 5), ("127.8.9.1", 5), ("::1", 5), ("::ffff:127.0.0.1", 5), ("testclient", 5)):
            self.assertTrue(security.is_local_peer(peer), peer)
        for peer in (("192.168.1.50", 5), ("10.0.0.5", 5), ("8.8.8.8", 5), ("fe80::1%en0", 5), ("::ffff:10.0.0.5", 5),
                     ("localhost", 5), ("evil.example", 5), ("", 5)):
            self.assertFalse(security.is_local_peer(peer), peer)

    def test_local_means_loopback_name_and_loopback_peer_and_no_proxy(self):
        local = Headers({"host": HOST})
        self.assertTrue(security.is_local_request(local, THIS_PEER))
        self.assertTrue(security.is_local_request(Headers({"host": "[::1]:8000"}), ("::1", 5)))
        # Anyone can send `Host: localhost` to a server bound to the network.
        self.assertFalse(security.is_local_request(local, LAN_PEER))
        # A listed name is another computer's way in, even over loopback (a local reverse proxy).
        self.assertFalse(security.is_local_request(Headers({"host": LAN_HOST}), THIS_PEER))
        for name in security.FORWARDING_HEADERS:
            self.assertFalse(security.is_local_request(Headers({"host": HOST, name: "203.0.113.9"}), THIS_PEER), name)


class TokenStoreTests(HermeticTestCase):
    def test_it_is_created_on_first_use_and_then_kept(self):
        path = security.token_path()
        self.assertFalse(path.exists())
        token = security.access_token()
        self.assertGreaterEqual(len(token), 43)                                   # 256 bits, URL-safe
        self.assertRegex(token, r"^[A-Za-z0-9_-]+$")
        self.assertEqual(path.read_text(encoding="utf-8"), token + "\n")
        self.assertEqual(security.access_token(), token)
        self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["access-token"])   # no temp file left

    def test_two_installs_never_share_a_token(self):
        first = security.access_token()
        self.assertNotEqual(security.access_token(rotate=True), first)

    def test_it_lives_in_the_data_directory(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        with mock.patch.object(config, "DATA_DIR", tmp / "data"):
            self.assertEqual(REAL_TOKEN_PATH(), tmp / "data" / "access-token")
            with mock.patch.object(security, "token_path", REAL_TOKEN_PATH):
                token = security.access_token()                                    # creates data/ too
            self.assertEqual((tmp / "data" / "access-token").read_text(encoding="utf-8").strip(), token)

    @unittest.skipUnless(os.name == "posix", "POSIX file modes")
    def test_only_its_owner_can_read_it(self):
        old_umask = os.umask(0)                      # the most permissive process: the file must still be private
        self.addCleanup(os.umask, old_umask)
        security.access_token()
        path = security.token_path()
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        security.access_token(rotate=True)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        os.chmod(path, 0o644)                        # loosened by hand: tightened again on the next read
        security._token_cache = None
        security.access_token()
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_a_rotation_from_the_command_line_takes_effect_without_a_restart(self):
        old = security.access_token()
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(security.main(["--rotate"]), 0)
        new = out.getvalue().strip()
        self.assertNotEqual(new, old)
        self.assertNotIn(new, err.getvalue())                                      # the token only on stdout
        self.assertEqual(security.access_token(), new)
        # Another process rewrote the file (what `--rotate` is to a running server).
        other = "x" * 50
        security.token_path().write_text(other + "\n", encoding="utf-8")
        self.assertEqual(security.access_token(), other)
        self.assertFalse(security.token_matches(f"Bearer {new}"))
        with contextlib.redirect_stdout(io.StringIO()) as shown, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(security.main([]), 0)
        self.assertEqual(shown.getvalue().strip(), other)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(security.main(["--help"]), 2)

    def test_a_token_that_was_not_generated_here_is_replaced(self):
        path = security.token_path()
        for weak in ("", "hunter2\n", "   \n"):
            path.write_text(weak, encoding="utf-8")
            security._token_cache = None
            token = security.access_token()
            self.assertGreaterEqual(len(token), 43)
            self.assertFalse(security.token_matches(f"Bearer {weak.strip()}"))

    def test_the_header_forms(self):
        self.assertEqual(security.presented_token("Bearer abc"), "abc")
        self.assertEqual(security.presented_token("bearer   abc "), "abc")
        self.assertEqual(security.presented_token(basic("abc")), "abc")
        self.assertEqual(security.presented_token(basic("abc", user="")), "abc")          # any user name, or none
        self.assertEqual(security.presented_token(basic("a:b:c")), "a:b:c")
        for bad in (None, "", "Bearer", "Bearer ", "Basic", "Basic !!!not-base64!!!", "Digest abc",
                    "Basic " + base64.b64encode(b"no-colon").decode(), "Basic " + base64.b64encode(b"\xff\xfe:x").decode()):
            self.assertIsNone(security.presented_token(bad), bad)

    def test_matching_is_exact(self):
        token = security.access_token()
        self.assertTrue(security.token_matches(f"Bearer {token}"))
        self.assertTrue(security.token_matches(basic(token)))
        for wrong in (None, "", "Bearer ", f"Bearer {token[:-1]}", f"Bearer {token}x", f"Bearer {token.swapcase()}",
                      basic(""), basic("wrong"), basic(token[:10]), f"Token {token}", "Bearer caf\u00e9"):
            self.assertFalse(security.token_matches(wrong), wrong)


class TokenRuleTests(HermeticTestCase):
    def setUp(self):
        super().setUp()
        os.environ["SERVER_ALLOWED_HOSTS"] = "reader.lan"

    def test_local_use_is_unchanged_and_creates_no_token(self):
        for method, path in (("GET", "/"), ("GET", "/api/titles"), ("POST", "/api/library/update-all"), ("DELETE", "/api/plaw")):
            for host, peer in ((HOST, THIS_PEER), ("127.0.0.1:8000", THIS_PEER), ("[::1]:8000", ("::1", 5)), (HOST, None)):
                self.assertIsNone(lan_check(method, path, client=peer, host=host), (method, path, host))
        self.assertFalse(security.token_path().exists())

    def test_a_listed_name_is_refused_without_the_token(self):
        for method, path in (("GET", "/"), ("GET", "/static/dist/app.js"), ("GET", "/healthz"), ("GET", "/api/titles"),
                             ("POST", "/api/settings/env"), ("DELETE", "/api/library/29")):
            self.assertEqual(lan_check(method, path), (401, security.NEED_TOKEN), (method, path))
            self.assertEqual(lan_check(method, path, authorization="Bearer wrong")[0], 401, (method, path))
            self.assertEqual(lan_check(method, path, authorization=basic("wrong"))[0], 401, (method, path))

    def test_a_listed_name_is_accepted_with_the_token(self):
        token = security.access_token()
        for method, path in (("GET", "/"), ("GET", "/api/titles"), ("POST", "/api/settings/env"), ("DELETE", "/api/library/29")):
            self.assertIsNone(lan_check(method, path, authorization=f"Bearer {token}"), (method, path))
            self.assertIsNone(lan_check(method, path, authorization=basic(token), origin=LAN), (method, path))
        # The same over a reverse proxy on this computer that passes the name through.
        self.assertEqual(lan_check(client=THIS_PEER)[0], 401)
        self.assertIsNone(lan_check(client=THIS_PEER, authorization=f"Bearer {token}"))

    def test_claiming_to_be_local_is_not_enough(self):
        token = security.access_token()
        # `Host: localhost` sent from another computer to a server bound to the network.
        self.assertEqual(lan_check(host=HOST)[0], 401)
        self.assertIsNone(lan_check(host=HOST, authorization=f"Bearer {token}"))
        # A request a proxy relayed, arriving over loopback under a loopback name.
        self.assertEqual(lan_check(host=HOST, client=THIS_PEER, x_forwarded_for="203.0.113.9")[0], 401)

    def test_the_token_does_not_replace_the_other_rules(self):
        token = f"Bearer {security.access_token()}"
        self.assertEqual(lan_check(host="other.lan:8000", authorization=token), (400, security.BAD_HOST))
        self.assertEqual(lan_check("POST", "/api/settings/env", authorization=token, origin="http://evil.example"),
                         (403, security.CROSS_ORIGIN))
        self.assertEqual(lan_check("GET", "/api/titles", authorization=token, sec_fetch_site="cross-site")[0], 403)

    def test_no_token_file_means_no_way_in(self):
        blocker = security.token_path().parent / "not-a-directory"
        blocker.write_text("", encoding="utf-8")
        with mock.patch.object(security, "token_path", lambda: blocker / "access-token"):
            security._token_cache = None
            self.assertEqual(lan_check(authorization="Bearer anything"), (503, security.TOKEN_UNAVAILABLE))
            self.assertIsNone(lan_check(client=THIS_PEER, host=HOST))             # local use still works

    def test_only_the_readers_own_browser_is_asked_to_sign_in(self):
        for site in (None, "none", "same-origin"):
            h = Headers({"host": LAN_HOST, **({"sec-fetch-site": site} if site else {})})
            self.assertTrue(security.challenge(h).startswith("Basic "), site)
        for site in ("cross-site", "same-site"):
            self.assertEqual(security.challenge(Headers({"host": LAN_HOST, "sec-fetch-site": site})), "Bearer", site)


class TokenOnTheRealAppTests(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        patches = (mock.patch.object(config, "DATA_DIR", self.tmp),
                   mock.patch.object(config, "write_env_updates", side_effect=AssertionError("the key file must not be touched")))
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        store.reset_connections()
        self.addCleanup(store.reset_connections)
        os.environ["SERVER_ALLOWED_HOSTS"] = "reader.lan"
        self.lan = TestClient(app, base_url=LAN, client=LAN_PEER)

    def test_another_computer_is_refused_without_the_token(self):
        with self.assertLogs(level="DEBUG") as logs:                 # everything any logger says meanwhile
            for method, path in (("GET", "/"), ("GET", "/static/dist/app.js"), ("GET", "/api/titles"), ("GET", "/healthz"),
                                 ("GET", "/docs"), ("POST", "/api/settings/env"), ("POST", "/api/library/update-all"),
                                 ("DELETE", "/api/plaw")):
                for headers in ({}, {"authorization": "Bearer nope"}, {"authorization": basic("nope")}):
                    r = self.lan.request(method, path, headers=headers, json={"anthropic_api_key": "x"} if method == "POST" else None)
                    self.assertEqual((r.status_code, r.json()), (401, {"detail": security.NEED_TOKEN}), (method, path))
                    self.assertTrue(r.headers["www-authenticate"].startswith('Basic realm="FRAMEWORK'))
                    self.assertEqual(r.headers["cache-control"], "no-store")
                    self.assertEqual(r.headers["x-frame-options"], "DENY")
                    self.assertNotIn(security.access_token(), r.text + str(r.headers))
        self.assertNotIn(security.access_token(), "\n".join(logs.output))
        # A page on another site that embeds one of our files makes nobody's browser prompt.
        r = self.lan.get("/static/dist/app.js", headers={"sec-fetch-site": "cross-site"})
        self.assertEqual((r.status_code, r.headers["www-authenticate"]), (401, "Bearer"))

    def test_another_computer_is_let_in_with_the_token(self):
        token = security.access_token()
        with self.assertLogs(level="DEBUG") as logs:
            for auth in ({"authorization": f"Bearer {token}"}, {"authorization": basic(token)}):
                self.assertEqual(self.lan.get("/", headers=auth).status_code, 200)
                self.assertEqual(self.lan.get("/static/dist/app.js", headers=auth).status_code, 200)
                self.assertEqual(self.lan.get("/api/titles", headers=auth).json(), [])
                # The app's own page, as a browser calls it: same origin, credentials attached.
                r = self.lan.post("/api/library/jobs/clear", headers={**auth, "origin": LAN})
                self.assertEqual(r.status_code, 200)
                self.assertNotIn("www-authenticate", r.headers)
            # httpx's own Basic support, as `curl -u :TOKEN` would send it.
            self.assertEqual(self.lan.get("/api/titles", auth=("", token)).json(), [])
        said = "\n".join(logs.output)
        self.assertIn("/api/titles", said)                          # the requests were logged ...
        self.assertNotIn(token, said)                               # ... and the token was not
        self.assertNotIn(basic(token).split(" ")[1], said)
        # Still not a pass for another site's page.
        r = self.lan.post("/api/library/jobs/clear", headers={"authorization": f"Bearer {token}", "origin": "http://evil.example"})
        self.assertEqual(r.status_code, 403)

    def test_this_computer_is_never_asked(self):
        for client in (TestClient(app, base_url=OWN, client=THIS_PEER), TestClient(app, base_url="http://127.0.0.1:8000", client=THIS_PEER),
                       TestClient(app)):
            page = client.get("/")
            self.assertEqual(page.status_code, 200)
            self.assertNotIn("www-authenticate", page.headers)
            self.assertEqual(client.get("/api/titles").json(), [])
            self.assertEqual(client.post("/api/library/jobs/clear").status_code, 200)
        self.assertFalse((self.tmp / "access-token").exists())
        self.assertFalse(security.token_path().exists())

    def test_a_spoofed_local_name_from_the_network_is_refused(self):
        spoof = TestClient(app, base_url=OWN, client=LAN_PEER)
        self.assertEqual(spoof.get("/api/titles").status_code, 401)
        self.assertEqual(spoof.post("/api/settings/env", json={"anthropic_api_key": "x"}).status_code, 401)


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
    """As a browser reads them: its HTML parser turns CRLF and lone CR into LF first, which
    matters on a Windows checkout, where the built page has CRLF line endings."""
    parser = _InlineBlocks()
    parser.feed(html.replace("\r\n", "\n").replace("\r", "\n"))
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

    def test_a_read_that_fails_once_is_tried_again(self):
        """A failed read must not pin the hashless policy to the file's unchanged timestamp."""
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / "dist").mkdir()
        index = tmp / "dist" / "index.html"
        index.write_bytes(b"<script>boot()</script>")
        real_read = Path.read_bytes
        failures = [OSError("the file is being replaced")]

        def flaky(path):
            if path == index and failures:
                raise failures.pop()
            return real_read(path)

        with mock.patch.object(config, "STATIC_DIR", tmp), mock.patch.object(Path, "read_bytes", flaky):
            self.assertEqual(directives(security.content_security_policy())["script-src"], ["'self'"])
            self.assertEqual(failures, [])
            self.assertEqual(directives(security.content_security_policy())["script-src"],     # same file, same stat
                             ["'self'", sha256_source("boot()")])

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
            blocks = inline_blocks(page.content.decode("utf-8"))
            allowed = directives(page.headers["content-security-policy"])["script-src"]
            self.assertEqual([sha256_source(b) for b in blocks["script"]], allowed[1:])
            self.assertEqual(page.headers["content-type"], "text/html; charset=utf-8")
            self.assertEqual(page.headers["cache-control"], "no-store")
            # The same page reached through the static mount.
            static_page = client.get("/static/dist/index.html")
            self.assertEqual(static_page.content, page.content)
            self.assertEqual(static_page.headers["content-security-policy"], page.headers["content-security-policy"])
            self.assertEqual(static_page.headers["cache-control"], "no-cache")
            assert_security_headers(self, static_page)
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


class PageSnapshotTests(HermeticTestCase):
    """A rebuild of the frontend while a request is in flight: the page that is sent and the
    policy sent with it must still come from the same bytes."""

    V1, V2 = b"<html><script>first_build()</script></html>", b"<html><script>second_build_longer()</script></html>"

    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / "dist").mkdir()
        self.index = self.tmp / "dist" / "index.html"
        self.index.write_bytes(self.V1)
        patch = mock.patch.object(config, "STATIC_DIR", self.tmp)
        patch.start()
        self.addCleanup(patch.stop)
        self.before_route: list = []          # things that happen after the middleware is entered

        outer = self

        class Meanwhile:
            def __init__(self, app):
                self.app = app

            async def __call__(self, scope, receive, send):
                if scope["type"] == "http":
                    for act in outer.before_route:
                        act()
                await self.app(scope, receive, send)

        mini = FastAPI()
        mini.add_middleware(Meanwhile)
        mini.add_middleware(security.SecurityHeadersMiddleware)          # outermost, as in the app

        @mini.get("/")
        def page(request: Request):
            return security.page_response(request.scope, self.index)

        @mini.get("/api/thing")
        def thing() -> dict:
            return {}

        self.client = TestClient(mini)

    def script_sources(self, response) -> list[str]:
        return directives(response.headers["content-security-policy"])["script-src"]

    def test_a_rebuild_between_the_start_of_a_request_and_the_read(self):
        self.assertIn(sha256_source("first_build()"), security.content_security_policy())     # an earlier request
        self.before_route.append(lambda: self.index.write_bytes(self.V2))
        r = self.client.get("/")
        self.assertEqual(r.content, self.V2)
        self.assertEqual(self.script_sources(r), ["'self'", sha256_source("second_build_longer()")])

    def test_a_rebuild_right_after_the_read(self):
        real_read = Path.read_bytes

        def read_then_rebuild(path):
            data = real_read(path)
            if path == self.index:
                self.index.write_bytes(self.V2)
            return data

        with mock.patch.object(Path, "read_bytes", read_then_rebuild):
            r = self.client.get("/")
        self.assertEqual(r.content, self.V1)
        self.assertEqual(self.script_sources(r), ["'self'", sha256_source("first_build()")])
        # The next request gets the new page with the new hash.
        r = self.client.get("/")
        self.assertEqual((r.content, self.script_sources(r)), (self.V2, ["'self'", sha256_source("second_build_longer()")]))

    def test_a_windows_checkout_of_the_page(self):
        """Git on Windows checks the built page out with CRLF line endings. The bytes go out as
        they are; the browser hashes the script with LF, and so must the policy."""
        self.index.write_bytes(b"<html><script>\r\n  boot();\r\n</script></html>")
        r = self.client.get("/")
        self.assertIn(b"\r\n  boot();\r\n", r.content)
        self.assertEqual(self.script_sources(r), ["'self'", sha256_source("\n  boot();\n")])
        blocks = inline_blocks(r.content.decode("utf-8"))
        self.assertEqual([sha256_source(b) for b in blocks["script"]], self.script_sources(r)[1:])

    def test_one_pages_policy_does_not_leak_into_other_responses(self):
        self.client.get("/")
        self.index.write_bytes(self.V2)
        r = self.client.get("/api/thing")
        self.assertEqual(self.script_sources(r), ["'self'", sha256_source("second_build_longer()")])
        assert_security_headers(self, r)


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
