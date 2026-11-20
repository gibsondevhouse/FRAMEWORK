"""Office of the Law Revision Counsel (uscode.house.gov) client for the U.S. Code.

The OLRC publishes the Code as USLM XML, one zip per title per *release point* (the
public law the Code is current through, e.g. "119-142"). There is no JSON API, so the
current release point is discovered from the download page's own links:

    download/releasepoints/us/pl/{congress}/{law}/xml_usc{NN}@{congress}-{law}.zip

(verified live 2026-11-19: `download.html` lists them; the older
`download/download.shtml` now 404s, so it is only tried as a fallback). The release id
can carry a suffix such as "118-200not159" when a title is held back; it is recorded
verbatim.

Every request carries the FRAMEWORK User-Agent. Tests patch `usc_client.client`.
"""
from __future__ import annotations

import hashlib
import re
import threading
import time
from pathlib import Path

import httpx

from .fr_client import USER_AGENT, SourceUnavailable  # noqa: F401  (shared error type)

BASE = "https://uscode.house.gov"
DOWNLOAD_PAGES = (f"{BASE}/download.html", f"{BASE}/download/download.shtml")
RELEASE_TTL_SEC = 30 * 60
MAX_XML_BYTES = 1_500_000_000          # Title 42 is ~200 MB of XML; guard against zip bombs

# Positive titles 1-54 (53 is reserved). Appendix titles ("5a", "11a", …) are not ingested yet.
TITLE_RANGE = range(1, 55)
RESERVED = {53}

_XML_LINK_RE = re.compile(
    r'download/releasepoints/us/pl/(\d+)/([0-9A-Za-z]+)/xml_usc(\d{2})(a?)@(\d+-[0-9A-Za-z]+)\.zip'
)
_CURRENT_THROUGH_RE = re.compile(r"current through Public Law\s+([0-9]+-[0-9A-Za-z]+)\s*\(([^)]+)\)", re.I)

_cache_lock = threading.Lock()
_release_cache: tuple[float, dict] | None = None


def client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=httpx.Timeout(30.0, read=300.0),
        follow_redirects=True,
    )


def parse_release_page(html: str, page_url: str) -> dict | None:
    """Release point + per-title zip URLs from the download page HTML, or None."""
    titles: dict[int, str] = {}
    release = congress = law = None
    for m in _XML_LINK_RE.finditer(html):
        cong, lw, num, appx, rp = m.groups()
        if appx:
            continue
        release, congress, law = rp, int(cong), lw
        titles[int(num)] = f"{BASE}/{m.group(0)}"
    if not titles or release is None:
        return None
    through = _CURRENT_THROUGH_RE.search(re.sub(r"<[^>]+>", " ", html))
    return {
        "release_point": release,
        "congress": congress,
        "law": law,
        "current_through": through.group(2).strip() if through else None,
        "titles": {str(k): v for k, v in sorted(titles.items())},
        "source_url": page_url,
    }


def current_release(c: httpx.Client | None = None, force: bool = False) -> dict:
    """The current release point, cached for 30 minutes. Raises SourceUnavailable."""
    global _release_cache
    with _cache_lock:
        if not force and _release_cache and time.monotonic() - _release_cache[0] < RELEASE_TTL_SEC:
            return dict(_release_cache[1])
    own = c is None
    c = c or client()
    try:
        last_error = "no release point links found"
        for url in DOWNLOAD_PAGES:
            try:
                r = c.get(url)
            except httpx.HTTPError as e:
                last_error = f"{url}: {type(e).__name__}"
                continue
            if r.status_code != 200:
                last_error = f"{url}: HTTP {r.status_code}"
                continue
            info = parse_release_page(r.text, url)
            if info:
                with _cache_lock:
                    _release_cache = (time.monotonic(), info)
                return dict(info)
        raise SourceUnavailable(f"OLRC release point: {last_error}")
    finally:
        if own:
            c.close()


def clear_cache() -> None:
    global _release_cache
    with _cache_lock:
        _release_cache = None


def zip_url(release: dict, title: int) -> str:
    known = release.get("titles", {}).get(str(title))
    if known:
        return known
    return (f"{BASE}/download/releasepoints/us/pl/{release['congress']}/{release['law']}/"
            f"xml_usc{int(title):02d}@{release['release_point']}.zip")


def download(c: httpx.Client, url: str, dest: Path, on_bytes=None) -> str:
    """Stream `url` to `dest` (via `dest.download`), returning the SHA-256 of the bytes."""
    if not url.startswith(BASE + "/"):
        raise ValueError(f"Refusing non-OLRC URL: {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".download")
    h = hashlib.sha256()
    try:
        with c.stream("GET", url) as r:
            if r.status_code != 200:
                raise SourceUnavailable(f"{url.split('?')[0]}: HTTP {r.status_code}")
            length = r.headers.get("content-length")
            total = int(length) if length and length.isdigit() else None
            got = 0
            with open(part, "wb") as f:
                for chunk in r.iter_bytes(1024 * 1024):
                    f.write(chunk)
                    h.update(chunk)
                    got += len(chunk)
                    if on_bytes:
                        on_bytes(got, total)
        part.replace(dest)
    except httpx.HTTPError as e:
        part.unlink(missing_ok=True)
        raise SourceUnavailable(f"{url.split('?')[0]}: {type(e).__name__}") from None
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    return h.hexdigest()
