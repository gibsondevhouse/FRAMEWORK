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

# Titles 1-54 (53 is reserved), plus the appendix titles ("5a", "11a", "18a", "28a", "50a"),
# which are keyed internally as 100 + N (105, 111, 118, 128, 150) so every store, file name
# (`usc-111.sqlite3`) and queue key stays an int; `title_label(111)` is "11a". Title 50a was
# eliminated (its zip is an empty shell), so it counts as reserved.
TITLE_RANGE = range(1, 55)
APPENDIX_BASE = 100
APPENDIX = {105: "5a", 111: "11a", 118: "18a", 128: "28a", 150: "50a"}
ALL_TITLES = list(TITLE_RANGE) + sorted(APPENDIX)
RESERVED = {53, 150}


def title_label(title: int) -> str:
    """'5', or '5a' for an appendix title (105)."""
    return APPENDIX.get(int(title), str(int(title)))


def title_code(label: str | int) -> int:
    """'11a' / '11A' → 111; '11' → 11. Raises ValueError for anything else."""
    s = str(label).strip().lower().lstrip("0")
    if s.endswith("a") and s[:-1].isdigit() and APPENDIX_BASE + int(s[:-1]) in APPENDIX:
        return APPENDIX_BASE + int(s[:-1])
    if s.isdigit():
        return int(s)
    raise ValueError(f"not a U.S. Code title: {label!r}")


def title_name_prefix(title: int) -> str:
    n = int(title)
    return f"Title {n - APPENDIX_BASE} Appendix" if n in APPENDIX else f"Title {n}"

_XML_LINK_RE = re.compile(
    r'download/releasepoints/us/pl/(\d+)/([0-9A-Za-z]+)/xml_usc(\d{2})([aA]?)@(\d+-[0-9A-Za-z]+)\.zip'
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
        code = APPENDIX_BASE + int(num) if appx else int(num)
        if appx and code not in APPENDIX:
            continue
        if not appx:
            release, congress, law = rp, int(cong), lw
        titles[code] = f"{BASE}/{m.group(0)}"
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


def cached_release() -> dict | None:
    """The last release point fetched in this process, however old, or None. Never touches the
    network (the Library's catalog uses it to mark stale titles while staying offline)."""
    with _cache_lock:
        return dict(_release_cache[1]) if _release_cache else None


def clear_cache() -> None:
    global _release_cache
    with _cache_lock:
        _release_cache = None


def zip_url(release: dict, title: int) -> str:
    known = release.get("titles", {}).get(str(title))
    if known:
        return known
    t = int(title)
    stem = f"{t - APPENDIX_BASE:02d}a" if t in APPENDIX else f"{t:02d}"
    return (f"{BASE}/download/releasepoints/us/pl/{release['congress']}/{release['law']}/"
            f"xml_usc{stem}@{release['release_point']}.zip")


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
