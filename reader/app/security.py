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

**Browser security headers (register item SEC-003).** `SecurityHeadersMiddleware` puts four
headers on every response: a content security policy, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` and `Referrer-Policy: same-origin`. The frontend builds most of its
markup as strings and relies on escaping; the policy is the backstop if one of those places is
ever wrong, because an injected `<script>`, inline handler or `javascript:` link then does not
run and nothing can be loaded from, or sent to, another host. See `build_policy` for what is
allowed and why.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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
                response = JSONResponse({"detail": detail}, status_code=status,
                                        headers={"Cache-Control": "no-store", **response_headers(scope["path"])})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


# --- Browser security headers (SEC-003) ---------------------------------------------------

# The one outside host a page of this app loads anything from: eCFR's figures are served by
# the Federal Register's image host (see render/html.py `image_urls`).
FIGURE_HOST = "https://img.federalregister.gov"

# FastAPI's built-in interactive API pages load Swagger UI and ReDoc from a CDN and run an
# inline script, so the app's policy would blank them. They get only the directives that do
# not govern loading (`DOCS_POLICY`) and are otherwise as open as they were before SEC-003.
INTERACTIVE_DOCS_PATHS = frozenset({"/docs", "/redoc"})
DOCS_POLICY = "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

# `same-origin` rather than `no-referrer`: both tell other sites nothing, but `no-referrer`
# also turns `Origin` into `null` on a same-origin form POST, which the guard above refuses.
STATIC_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "same-origin"),
)

_INLINE_SCRIPT_RE = re.compile(rb"<script\b([^>]*)>(.*?)</script\s*>", re.IGNORECASE | re.DOTALL)
_SRC_ATTR_RE = re.compile(rb"\bsrc\s*=", re.IGNORECASE)

# `'sha256-…'` sources for inline `<style>` blocks in pages the server renders itself
# (`allow_inline_style`). The built frontend has none.
_inline_style_hashes: set[str] = set()
_policy_cache: tuple[tuple, str] | None = None


def csp_hash(text: str | bytes) -> str:
    """The `'sha256-…'` source that allows one inline script or style. Hashed as the browser
    hashes it: the element's text as UTF-8, after the HTML parser has turned CRLF and lone CR
    into LF (so a Windows checkout with CRLF line endings yields the same hash)."""
    data = text.encode("utf-8") if isinstance(text, str) else text
    data = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return "'sha256-" + base64.b64encode(hashlib.sha256(data).digest()).decode("ascii") + "'"


def inline_script_hashes(html: bytes) -> list[str]:
    """Hashes of every inline `<script>` in a page, in order; scripts with `src` are skipped."""
    return [csp_hash(body) for attrs, body in _INLINE_SCRIPT_RE.findall(html) if not _SRC_ATTR_RE.search(attrs)]


def allow_inline_style(css: str) -> None:
    """Allow one exact inline `<style>` block (by hash) in server-rendered pages."""
    _inline_style_hashes.add(csp_hash(css))


def build_policy(script_hashes: list[str], style_hashes: list[str]) -> str:
    """The app's content security policy. Everything is refused unless listed:

    * scripts: the app's own files and the inline pre-paint script in `index.html`, by hash.
      No `'unsafe-inline'` and no `'unsafe-eval'`, so injected markup cannot run code.
    * styles: the app's own stylesheet, plus by hash any `<style>` the server itself renders.
      `style-src-attr 'unsafe-inline'` allows `style="…"` attributes only: the frontend writes
      about 25 of them into its markup (skeleton and progress-bar widths, `--hue`, `--rows`).
      A style attribute cannot run script or load anything `img-src` does not allow.
    * images: the app, `data:` (the favicon and the SVG masks in the stylesheet) and the
      figure host.
    * fonts and `fetch`: the app only. Nothing may frame the app, set `<base>`, or post a
      form elsewhere.
    """
    directives = (
        ("default-src", ["'none'"]),
        ("script-src", ["'self'", *script_hashes]),
        ("style-src", ["'self'", *style_hashes]),
        ("style-src-attr", ["'unsafe-inline'"]),
        ("img-src", ["'self'", "data:", FIGURE_HOST]),
        ("font-src", ["'self'"]),
        ("connect-src", ["'self'"]),
        ("base-uri", ["'none'"]),
        ("form-action", ["'self'"]),
        ("frame-ancestors", ["'none'"]),
    )
    return "; ".join(f"{name} {' '.join(sources)}" for name, sources in directives)


def content_security_policy() -> str:
    """The policy for the app as built right now. The inline script's hash is read from
    `static/dist/index.html` and re-read whenever that file changes, so a frontend rebuild
    (even under a running server) can never leave the policy refusing the page's own script."""
    global _policy_cache
    index = config.STATIC_DIR / "dist" / "index.html"
    try:
        st = index.stat()
        stamp: tuple = (str(index), st.st_mtime_ns, st.st_size)
    except OSError:
        stamp = (str(index), None, None)
    key = (stamp, frozenset(_inline_style_hashes))
    cached = _policy_cache
    if cached is not None and cached[0] == key:
        return cached[1]
    try:
        scripts = inline_script_hashes(index.read_bytes())
    except OSError:
        scripts = []  # no built frontend: nothing inline to allow
    policy = build_policy(scripts, sorted(_inline_style_hashes))
    _policy_cache = (key, policy)
    return policy


def response_headers(path: str) -> dict[str, str]:
    """The security headers for a response to `path`."""
    policy = DOCS_POLICY if path in INTERACTIVE_DOCS_PATHS else content_security_policy()
    return {"Content-Security-Policy": policy, **dict(STATIC_HEADERS)}


class SecurityHeadersMiddleware:
    """Pure ASGI middleware: adds the security headers to the start of every response and
    passes bodies through untouched (streaming is not buffered). An unhandled error is
    answered here, as the same plain 500 Starlette would send, so that it carries the headers
    too; the error is then re-raised for the server to log, as before."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        extra = response_headers(scope["path"])
        started = False

        async def send_with_headers(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                message.setdefault("headers", [])
                headers = MutableHeaders(scope=message)
                for name, value in extra.items():
                    headers[name] = value
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            if not started:
                await PlainTextResponse("Internal Server Error", status_code=500)(scope, receive, send_with_headers)
            raise
