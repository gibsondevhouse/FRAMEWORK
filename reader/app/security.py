"""The local trust boundary (register item SEC-001).

FRAMEWORK is a one-person app served on loopback with no login, so the browser is the only
thing between its API and every web page the reader has open. Two attacks follow from that,
and `LocalTrustMiddleware` refuses both before any route runs:

* **DNS rebinding.** A hostile site re-points its own name at 127.0.0.1, and the browser
  then treats this app as that site's origin: it can read every response and call every
  route, including the one that rewrites `reader/.env`. The request still carries the
  attacker's name in `Host`, so anything but a loopback name (or one listed in
  `SERVER_ALLOWED_HOSTS`) is answered 400.
* **Cross-site requests.** A page on another origin fires a form POST, a fetch or an
  `<img>` at the app. Browsers label those with `Origin` and `Sec-Fetch-Site`; every
  state-changing method and every `/api/` path must come from the app's own origin, or it
  is answered 403.

Clients that are not browsers (curl, scripts, the CLI, the test client) send neither header
and are not affected: this is a guard against the browser being used as a proxy, not a login.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from . import config  # noqa: F401  (importing it loads reader/.env into os.environ)

LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Fetch Metadata values that mean "this app's own page, or the reader typing the address".
SAME_SITE_VALUES = frozenset({"same-origin", "none"})
API_PREFIX = "/api/"

# Hosts added in-process rather than through the environment. The test base adds Starlette's
# `testserver`; nothing in the app itself writes to it.
EXTRA_ALLOWED_HOSTS: set[str] = set()

BAD_HOST = ("Invalid Host header. FRAMEWORK only answers under this computer's own name; "
            "list another name in SERVER_ALLOWED_HOSTS (reader/.env) to serve it there.")
CROSS_ORIGIN = "Cross-origin request refused. FRAMEWORK's API only answers its own pages."


def allowed_hosts() -> frozenset[str]:
    """Loopback names plus `SERVER_ALLOWED_HOSTS` (comma-separated, read at call time)."""
    extra = {h.strip().lower().rstrip(".") for h in os.environ.get("SERVER_ALLOWED_HOSTS", "").split(",")}
    return LOOPBACK_HOSTS | (extra - {""}) | EXTRA_ALLOWED_HOSTS


def host_name(value: str | None) -> str:
    """The name in a `Host` header without its port: `LocalHost:8000` -> `localhost`,
    `[::1]:8000` -> `::1`. Empty when there is none or it cannot be read."""
    v = (value or "").strip().lower()
    if not v or any(c in v for c in "/@?# \t"):
        return ""
    if v.startswith("["):
        end = v.find("]")
        return v[1:end] if end > 1 and v[end + 1:end + 2] in ("", ":") else ""
    name, _, port = v.partition(":")
    if port and not port.isdigit():
        return ""
    return name.rstrip(".")


def _authority(netloc: str, scheme: str) -> str:
    """`host:port` lower-cased, with the scheme's default port dropped, for comparison."""
    v = netloc.strip().lower()
    default = {"http": ":80", "https": ":443"}.get(scheme, "")
    if default and v.endswith(default):
        v = v[: -len(default)]
    return v


def same_origin(origin: str, host: str, scheme: str = "http") -> bool:
    """True when an `Origin` header names the same host and port as the request's `Host`.
    `null` (sandboxed frames, `data:` pages) is never the same origin."""
    try:
        parts = urlsplit(origin.strip())
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return False
    return _authority(parts.netloc, parts.scheme) == _authority(host, scheme)


def check_request(method: str, path: str, headers: Headers, scheme: str = "http") -> tuple[int, str] | None:
    """None when the request may proceed, else `(status, detail)` for the refusal."""
    host = headers.get("host", "")
    if host_name(host) not in allowed_hosts():
        return 400, BAD_HOST
    if method.upper() not in UNSAFE_METHODS and not path.startswith(API_PREFIX):
        return None  # pages and static assets: nothing private, nothing changed
    origin = headers.get("origin")
    if origin is not None:
        return None if same_origin(origin, host, scheme) else (403, CROSS_ORIGIN)
    site = headers.get("sec-fetch-site")
    if site is not None and site.strip().lower() not in SAME_SITE_VALUES:
        return 403, CROSS_ORIGIN
    return None


class LocalTrustMiddleware:
    """Pure ASGI middleware: answers 400/403 itself, otherwise passes the request through
    untouched (so streaming responses such as the chat SSE are not buffered)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            refusal = check_request(scope["method"], scope["path"], Headers(scope=scope), scope.get("scheme", "http"))
            if refusal is not None:
                status, detail = refusal
                response = JSONResponse({"detail": detail}, status_code=status, headers={"Cache-Control": "no-store"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
