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

**Access token beyond this computer (register item SEC-002).** A name listed in
`SERVER_ALLOWED_HOSTS` used to be open to anyone who could reach the machine. Now every
request that is not *local* must carry the access token or is answered 401. Local means all
three of: a loopback name in `Host`, a loopback address on the other end of the connection,
and no proxy forwarding header. The `Host` header alone proves nothing (any client can send
`Host: localhost` to a server bound to the network), which is why the connection's own
address is checked. Local use is unchanged: no token, no prompt, and no token file is created.

The token is 256 random bits, generated on this computer the first time it is needed and kept
in `data/access-token`, readable by its owner only. It is never logged and never put in a URL.
A browser presents it through its built-in sign-in prompt (HTTP Basic: any user name, the
token as the password) and then sends it by itself on every request, including the page's own
`fetch` calls, so the single-page app needs no change. Scripts send
`Authorization: Bearer <token>`. `python -m app.security` shows the token; `--rotate` replaces
it. Over plain `http://` the token crosses the network unencrypted, like everything else:
put TLS in front of the server on a network you do not trust.

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
import binascii
import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import stat
import sys
import threading
from pathlib import Path
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import config  # noqa: F401  (importing it loads reader/.env into os.environ)

LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Fetch Metadata values that mean "this app's own page, or the reader typing the address".
SAME_SITE_VALUES = frozenset({"same-origin", "none"})
API_PREFIX = "/api/"

# Hosts added in-process rather than through the environment, and treated as this computer's
# own names. The test base adds Starlette's `testserver`; nothing in the app itself writes to it.
EXTRA_ALLOWED_HOSTS: set[str] = set()
# The same for the address on the other end of the connection (the test client's `testclient`).
EXTRA_LOCAL_PEERS: set[str] = set()

# Headers a reverse proxy adds when it relays a request for someone else.
FORWARDING_HEADERS = ("forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip")

TOKEN_FILE = "access-token"
TOKEN_BYTES = 32            # 256 bits; `secrets.token_urlsafe` writes them as 43 characters
MIN_TOKEN_CHARS = 32        # anything shorter in the file was not generated here: replace it

BAD_HOST = ("Invalid Host header. FRAMEWORK only answers under this computer's own name; "
            "list another name in SERVER_ALLOWED_HOSTS (reader/.env) to serve it there.")
CROSS_ORIGIN = "Cross-origin request refused. FRAMEWORK's API only answers its own pages."
NEED_TOKEN = ("Access token required. This copy of FRAMEWORK is being reached from another computer. "
              "On the computer that runs it, show the token with `python -m app.security` (from reader/), "
              "then sign in here with any user name and the token as the password. "
              "Scripts send it as `Authorization: Bearer <token>`.")
TOKEN_UNAVAILABLE = ("The access token could not be read or created on the server (reader/data/access-token), "
                     "so requests from other computers are refused.")


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


def is_local_peer(client: tuple | list | None) -> bool:
    """True when the other end of the connection is this computer: a loopback address, or no
    network address at all (a Unix socket)."""
    if not client:
        return True
    host = str(client[0]).strip().lower()
    if host in EXTRA_LOCAL_PEERS:
        return True
    try:
        ip = ipaddress.ip_address(host.partition("%")[0])
    except ValueError:
        return False
    return (getattr(ip, "ipv4_mapped", None) or ip).is_loopback


def is_local_request(headers: Headers, client: tuple | list | None = None) -> bool:
    """True for a request made on this computer, which needs no token: a loopback `Host`, a
    loopback peer, and nothing saying a proxy relayed it for someone else."""
    if host_name(headers.get("host", "")) not in (LOOPBACK_HOSTS | EXTRA_ALLOWED_HOSTS):
        return False
    return is_local_peer(client) and not any(h in headers for h in FORWARDING_HEADERS)


# --- The access token (SEC-002) -------------------------------------------------------------

_token_lock = threading.Lock()
_token_cache: tuple[tuple, str] | None = None


def token_path() -> Path:
    return config.DATA_DIR / TOKEN_FILE


def _write_private(path: Path, text: str) -> None:
    """Write `text` to `path` so that it is never readable by anyone but its owner, not even
    briefly: the temporary file is created with mode 0600, then moved into place."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".new")
    tmp.unlink(missing_ok=True)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def access_token(rotate: bool = False) -> str:
    """The access token, created on first use (or replaced, with `rotate`). Re-read when the
    file changes, so a token rotated from the command line takes effect without a restart.
    Raises `OSError` when the file can be neither read nor written."""
    global _token_cache
    path = token_path()
    with _token_lock:
        if not rotate:
            try:
                st = path.stat()
            except OSError:
                st = None
            if st is not None:
                key = (str(path), st.st_mtime_ns, st.st_size)
                if _token_cache is not None and _token_cache[0] == key:
                    return _token_cache[1]
                token = path.read_text(encoding="utf-8").strip()
                if len(token) >= MIN_TOKEN_CHARS:
                    if os.name == "posix" and stat.S_IMODE(st.st_mode) & 0o077:
                        os.chmod(path, 0o600)       # someone loosened it: owner-only again
                    _token_cache = (key, token)
                    return token
        token = secrets.token_urlsafe(TOKEN_BYTES)
        _write_private(path, token + "\n")
        st = path.stat()
        _token_cache = ((str(path), st.st_mtime_ns, st.st_size), token)
        return token


def presented_token(authorization: str | None) -> str | None:
    """The token in an `Authorization` header: `Bearer <token>`, or the password of
    `Basic <base64(user:password)>` (the user name is ignored)."""
    scheme, _, value = (authorization or "").strip().partition(" ")
    value = value.strip()
    if not value:
        return None
    if scheme.lower() == "bearer":
        return value
    if scheme.lower() == "basic":
        try:
            decoded = base64.b64decode(value, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            return None
        _user, sep, password = decoded.partition(":")
        return password if sep else None
    return None


def token_matches(authorization: str | None) -> bool:
    """True when the header carries the access token. Compared in constant time."""
    given = presented_token(authorization)
    expected = access_token()
    return given is not None and hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8"))


def check_request(method: str, path: str, headers: Headers, scheme: str = "http",
                  client: tuple | list | None = None) -> tuple[int, str] | None:
    """None when the request may proceed, else `(status, detail)` for the refusal."""
    host = headers.get("host", "")
    if host_name(host) not in allowed_hosts():
        return 400, BAD_HOST
    guarded = method.upper() in UNSAFE_METHODS or path.startswith(API_PREFIX)
    if guarded:  # pages and static assets may be linked from elsewhere; these may not
        origin = headers.get("origin")
        if origin is not None:
            if not same_origin(origin, host, scheme):
                return 403, CROSS_ORIGIN
        else:
            site = headers.get("sec-fetch-site")
            if site is not None and site.strip().lower() not in SAME_SITE_VALUES:
                return 403, CROSS_ORIGIN
    if not is_local_request(headers, client):
        try:
            if not token_matches(headers.get("authorization")):
                return 401, NEED_TOKEN
        except OSError:
            return 503, TOKEN_UNAVAILABLE
    return None


def challenge(headers: Headers) -> str:
    """The `WWW-Authenticate` value for a 401. `Basic` makes a browser show its sign-in prompt,
    so it is offered only to the app's own pages and to an address typed by the reader; a
    request another site's page caused gets `Bearer`, which prompts nobody."""
    site = (headers.get("sec-fetch-site") or "none").strip().lower()
    return 'Basic realm="FRAMEWORK access token", charset="UTF-8"' if site in SAME_SITE_VALUES else "Bearer"


class LocalTrustMiddleware:
    """Pure ASGI middleware: answers 400/401/403 itself, otherwise passes the request through
    untouched (so streaming responses such as the chat SSE are not buffered)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            refusal = check_request(scope["method"], scope["path"], headers, scope.get("scheme", "http"),
                                    scope.get("client"))
            if refusal is not None:
                status, detail = refusal
                extra = {"Cache-Control": "no-store", **response_headers(scope["path"])}
                if status == 401:
                    extra["WWW-Authenticate"] = challenge(headers)
                response = JSONResponse({"detail": detail}, status_code=status, headers=extra)
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
    """The policy for the app as built right now: what every response that is not itself a
    page carries. The inline script's hash is read from `static/dist/index.html` and re-read
    whenever that file changes. The page itself is served by `page_response`, which takes the
    hash from the very bytes it sends."""
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
        # No built frontend, or a read that failed this once. Nothing inline can be allowed
        # now, and nothing is cached, so the next response reads the file again.
        return build_policy([], sorted(_inline_style_hashes))
    policy = build_policy(scripts, sorted(_inline_style_hashes))
    _policy_cache = (key, policy)
    return policy


# Where `page_response` leaves the policy for the page it is sending, for the middleware.
PAGE_POLICY_KEY = "framework.page_policy"


def page_response(scope: Scope, path: Path, headers: dict[str, str] | None = None) -> Response:
    """A page of the built frontend, with the policy for exactly the bytes being sent.

    The file is read once. Its inline-script hashes go into the policy for this one response
    (left in `scope` for `SecurityHeadersMiddleware`), and the same bytes are the body. So a
    rebuild that lands while a request is in flight cannot pair new HTML with an old hash, or
    old HTML with a new one, and block the page's own script."""
    body = path.read_bytes()
    scope[PAGE_POLICY_KEY] = build_policy(inline_script_hashes(body), sorted(_inline_style_hashes))
    return Response(body, media_type="text/html", headers=headers)


def response_headers(path: str, page_policy: str | None = None) -> dict[str, str]:
    """The security headers for a response to `path`. `page_policy` is the policy
    `page_response` computed for the page being sent, when there is one."""
    policy = DOCS_POLICY if path in INTERACTIVE_DOCS_PATHS else (page_policy or content_security_policy())
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
        started = False

        async def send_with_headers(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                message.setdefault("headers", [])
                headers = MutableHeaders(scope=message)
                # Worked out now, not when the request arrived: by now the route has run, and a
                # page has left the policy for its own bytes in the scope.
                for name, value in response_headers(scope["path"], scope.get(PAGE_POLICY_KEY)).items():
                    headers[name] = value
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            if not started:
                await PlainTextResponse("Internal Server Error", status_code=500)(scope, receive, send_with_headers)
            raise


def main(argv: list[str] | None = None) -> int:
    """`python -m app.security [--rotate]`: print the access token (creating it if needed)."""
    args = sys.argv[1:] if argv is None else argv
    if any(a not in ("--rotate",) for a in args):
        print("usage: python -m app.security [--rotate]", file=sys.stderr)
        return 2
    token = access_token(rotate="--rotate" in args)
    print(f"Access token for reaching FRAMEWORK from another computer ({token_path()}):", file=sys.stderr)
    print(token)
    print("In a browser: any user name, this token as the password. "
          "In a script: Authorization: Bearer <token>.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
