"""A small, polite HTTP client for the official bulk sources without an API of their own:
GovInfo bulk data (Public Laws, the House Manual's Constitution) and reginfo.gov (Unified
Agenda XML).

Every request carries the FRAMEWORK User-Agent, goes only to an allowed host, is paced
(`GOV_MIN_INTERVAL` seconds apart per host, default 1) and is retried on 429/5xx/transport
errors with exponential backoff (Retry-After honoured, capped at 120 s). Downloads stream to
disk with a SHA-256 of the bytes as served. Tests patch `gov_http.client` with an
`httpx.MockTransport` and `gov_http._sleep` with a recorder.
"""
from __future__ import annotations

import hashlib
import os
import random
import threading
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .fr_client import USER_AGENT, SourceUnavailable  # noqa: F401  (shared error type)

ALLOWED_HOSTS = {"www.govinfo.gov", "govinfo.gov", "www.reginfo.gov", "reginfo.gov"}
MAX_RETRIES = 5
MAX_BACKOFF = 120.0
RETRY_STATUS = {429, 500, 502, 503, 504}

_pace_lock = threading.Lock()
_last: dict[str, float] = {}


def _sleep(sec: float) -> None:  # patched in tests
    time.sleep(sec)


def min_interval() -> float:
    try:
        return max(0.0, float(os.getenv("GOV_MIN_INTERVAL", "1").strip() or 1))
    except ValueError:
        return 1.0


def reset_pacing() -> None:
    with _pace_lock:
        _last.clear()


def client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(30.0, read=300.0),
                        follow_redirects=True)


def check_url(url: str) -> str:
    host = urlparse(url).hostname or ""
    if urlparse(url).scheme != "https" or host not in ALLOWED_HOSTS:
        raise ValueError(f"Refusing request to {host or url}")
    return host


def pace(host: str) -> None:
    gap = min_interval()
    with _pace_lock:
        wait = _last.get(host, 0.0) + gap - time.monotonic()
        _last[host] = time.monotonic() + max(0.0, wait)
    if wait > 0:
        _sleep(wait)


def _retry_after(r: httpx.Response) -> float | None:
    v = r.headers.get("retry-after")
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        try:
            return max(0.0, parsedate_to_datetime(v).timestamp() - time.time())
        except (TypeError, ValueError):
            return None


def _backoff(attempt: int, r: httpx.Response | None) -> float:
    ra = _retry_after(r) if r is not None else None
    if ra is not None:
        return min(MAX_BACKOFF, ra)
    return min(MAX_BACKOFF, (2 ** attempt) + random.uniform(0, 1))


def request(c: httpx.Client, url: str, accept: str | None = None, retries: int = MAX_RETRIES) -> httpx.Response:
    """GET with pacing and retries. Raises SourceUnavailable with a short reason."""
    host = check_url(url)
    headers = {"Accept": accept} if accept else None
    last = ""
    for attempt in range(retries + 1):
        pace(host)
        try:
            r = c.get(url, headers=headers)
        except httpx.HTTPError as e:
            last, r = type(e).__name__, None
        else:
            if r.status_code == 200:
                return r
            last = f"HTTP {r.status_code}"
            if r.status_code not in RETRY_STATUS:
                break
        if attempt < retries:
            _sleep(_backoff(attempt, r))
    raise SourceUnavailable(f"{host}: {last}")


def get_json(c: httpx.Client, url: str) -> dict:
    r = request(c, url, accept="application/json")
    try:
        return r.json()
    except ValueError:
        raise SourceUnavailable(f"{urlparse(url).hostname}: not JSON") from None


def download(c: httpx.Client, url: str, dest: Path, on_bytes=None, retries: int = MAX_RETRIES) -> str:
    """Stream `url` to `dest` (via `dest.download`); returns the SHA-256 of the bytes."""
    host = check_url(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".download")
    last = ""
    for attempt in range(retries + 1):
        pace(host)
        h = hashlib.sha256()
        r_status = None
        try:
            with c.stream("GET", url) as r:
                r_status = r
                if r.status_code == 200:
                    got = 0
                    length = r.headers.get("content-length")
                    total = int(length) if length and length.isdigit() else None
                    with open(part, "wb") as f:
                        for chunk in r.iter_bytes(1024 * 1024):
                            f.write(chunk)
                            h.update(chunk)
                            got += len(chunk)
                            if on_bytes:
                                on_bytes(got, total)
                    part.replace(dest)
                    return h.hexdigest()
                last = f"HTTP {r.status_code}"
                if r.status_code not in RETRY_STATUS:
                    break
        except httpx.HTTPError as e:
            last, r_status = type(e).__name__, None
        except BaseException:
            part.unlink(missing_ok=True)
            raise
        part.unlink(missing_ok=True)
        if attempt < retries:
            _sleep(_backoff(attempt, r_status))
    part.unlink(missing_ok=True)
    raise SourceUnavailable(f"{host}: {last}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
