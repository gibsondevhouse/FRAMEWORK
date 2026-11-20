"""The local trust boundary (app/security.py, register item SEC-001): the server answers
only under a loopback name, and state-changing or API requests only from its own origin."""
import os
import shutil
import tempfile
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from app import config, security, store
from app.main import app
from tests.base import HermeticTestCase

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
