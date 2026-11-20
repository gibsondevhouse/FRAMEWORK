"""Shared Federal Register API v1 client.

One place for everything that talks to federalregister.gov: the honest FRAMEWORK
User-Agent, the JSON getter that turns every failure into `SourceUnavailable`, the
`next_page_url` paginator, the full-text fetcher (host-locked to federalregister.gov)
and the body-HTML allowlist sanitizer.

Two callers share it:

- `news.py` (the OSHA newsroom feed): small windows, `NEWS_FIELDS`, 10-page cap.
- `fr_build.py` (the Federal Register corpus): date-chunked windows, `CORPUS_FIELDS`,
  `per_page=1000`, and the API's 10,000-result ceiling handled by splitting ranges.

Tests patch `fr_client.client` (corpus) or `news.client` (news) with an
`httpx.MockTransport`; every fetcher takes the client as an argument, so no fetch
opens its own connection.
"""
from __future__ import annotations

import hashlib
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

USER_AGENT = "FRAMEWORK-ComplianceReader/1.0 (local-reader)"
FR_BASE = "https://www.federalregister.gov/api/v1"
FR_HOSTS = ("www.federalregister.gov", "federalregister.gov")

# The newsroom's field set (kept exactly as it was in news.py; tests assert on it).
NEWS_FIELDS = [
    "title", "document_number", "publication_date", "type", "abstract", "action", "dates",
    "effective_on", "comments_close_on", "cfr_references", "citation", "html_url", "pdf_url",
    "body_html_url", "agencies", "docket_ids",
]

# The corpus field set. Every name verified against a live documents.json call on
# 2026-11-19 (volume/start_page/end_page are ints; regulation_id_numbers is a list).
CORPUS_FIELDS = [
    "document_number", "type", "title", "abstract", "action", "dates", "agencies",
    "publication_date", "effective_on", "comments_close_on", "signing_date",
    "cfr_references", "docket_ids", "regulation_id_numbers", "citation", "volume",
    "start_page", "end_page", "page_length", "html_url", "pdf_url", "full_text_xml_url",
    "body_html_url", "raw_text_url",
]

# The search API reports `count` capped at this value and refuses to page past it, so a
# query whose count reaches it must be split into narrower date ranges.
RESULT_CAP = 10_000
MAX_PER_PAGE = 1000

DOC_NUM_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class SourceUnavailable(Exception):
    """A source failed (network, HTTP status, bad payload). The caller records it and moves on."""


def client(extra: dict[str, str] | None = None) -> httpx.Client:
    """One client per sync or build run, passed to every fetcher."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    headers.update(extra or {})
    return httpx.Client(headers=headers, timeout=20.0, follow_redirects=True)


def get_json(c: httpx.Client, url: str, params) -> dict:
    try:
        r = c.get(url, params=params)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: HTTP {e.response.status_code}") from None
    except (httpx.HTTPError, ValueError) as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: {type(e).__name__}") from None


def documents_url() -> str:
    return f"{FR_BASE}/documents.json"


def paginate(
    c: httpx.Client,
    base_params: list[tuple[str, str]],
    fields: list[str],
    max_pages: int,
) -> tuple[list[dict], int, list[str]]:
    """Follow `next_page_url` from documents.json for up to `max_pages` pages.

    Returns (results, reported count, the URL of every page fetched). `next_page_url`
    carries the whole query, so params are only sent with the first request."""
    params: list[tuple[str, str]] | None = list(base_params) + [("fields[]", f) for f in fields]
    url: str | None = documents_url()
    results: list[dict] = []
    count = 0
    urls: list[str] = []
    for i in range(max_pages):
        page = get_json(c, url, params)
        if i == 0:
            try:
                count = int(page.get("count") or 0)
            except (TypeError, ValueError):
                count = 0
        urls.append(str(httpx.URL(url, params=params)) if params else url)
        results += page.get("results") or []
        url, params = page.get("next_page_url"), None
        if not url:
            break
    return results, count, urls


def is_fr_host(url: str) -> bool:
    p = urlparse(url or "")
    return p.scheme == "https" and (p.hostname or "").lower() in FR_HOSTS


def fetch_bytes(c: httpx.Client, url: str) -> bytes:
    """GET a federalregister.gov full-text file (XML, HTML or text). Refuses any other host."""
    if not is_fr_host(url):
        raise ValueError(f"Refusing non-Federal Register URL: {url.split('?')[0]}")
    try:
        r = c.get(url)
        r.raise_for_status()
        return r.content
    except httpx.HTTPStatusError as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: HTTP {e.response.status_code}") from None
    except httpx.HTTPError as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: {type(e).__name__}") from None


def sha256_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Body HTML sanitizer (moved from news.py; news re-exports it)
# ---------------------------------------------------------------------------

_ALLOWED_TAGS = frozenset({
    "div", "section", "article", "header", "footer", "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "span", "a", "em", "strong", "b", "i", "u", "sup", "sub", "small", "ul", "ol", "li",
    "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "colgroup", "col", "blockquote", "pre", "code", "hr", "br",
})
_DROP_CONTENT_TAGS = frozenset({"script", "style", "iframe", "object", "embed", "svg", "math", "noscript"})
_VOID_TAGS = frozenset({"br", "hr", "col"})
_SAFE_ATTRS = frozenset({"class", "id", "colspan", "rowspan", "scope", "headers"})


class FrSanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self._drop_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t in _DROP_CONTENT_TAGS:
            self._drop_depth += 1
            return
        if self._drop_depth or t not in _ALLOWED_TAGS:
            return
        kept: list[str] = []
        is_ext_link = False
        for k, v in attrs:
            ak = (k or "").lower()
            if v is None:
                continue
            if ak == "href" and t == "a":
                val = v.strip()
                if val.startswith("/"):
                    val = "https://www.federalregister.gov" + val
                parsed = urlparse(val)
                if parsed.scheme in ("http", "https"):
                    kept.append(f'href="{escape(val, quote=True)}"')
                    is_ext_link = True
                elif val.startswith("#") and len(val) > 1:
                    kept.append(f'href="{escape(val, quote=True)}"')
            elif ak in _SAFE_ATTRS:
                kept.append(f'{ak}="{escape(v, quote=True)}"')
        if is_ext_link:
            kept.append('target="_blank" rel="noopener noreferrer"')
        attr_str = (" " + " ".join(kept)) if kept else ""
        self.out.append(f"<{t}{attr_str}>")

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in _DROP_CONTENT_TAGS:
            if self._drop_depth:
                self._drop_depth -= 1
            return
        if self._drop_depth or t not in _ALLOWED_TAGS or t in _VOID_TAGS:
            return
        self.out.append(f"</{t}>")

    def handle_data(self, data: str) -> None:
        if not self._drop_depth:
            self.out.append(escape(data, quote=False))

    def handle_entityref(self, name: str) -> None:
        if not self._drop_depth:
            self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if not self._drop_depth:
            self.out.append(f"&#{name};")


def sanitize_fr_html(raw_html: str) -> str:
    """Allowlist-sanitize Federal Register body HTML so scripts, forms, and inline handlers are removed."""
    parser = FrSanitizer()
    parser.feed(raw_html or "")
    parser.close()
    return "".join(parser.out).strip()


def fetch_fr_body(c: httpx.Client, document_number: str, body_html_url: str | None = None) -> dict | None:
    """Fetch FR document metadata + sanitized body HTML on demand for `document_number`."""
    doc_num = (document_number or "").strip()
    if not doc_num or not DOC_NUM_RE.fullmatch(doc_num):
        raise ValueError("Invalid Federal Register document number")
    meta: dict | None = None
    url = (body_html_url or "").strip() or None
    if not url:
        meta = get_json(
            c,
            f"{FR_BASE}/documents/{doc_num}.json",
            [("fields[]", f) for f in NEWS_FIELDS],
        )
        url = (meta.get("body_html_url") or "").strip() or None
    if not url or not is_fr_host(url):
        return None
    try:
        r = c.get(url)
        r.raise_for_status()
        body_html = sanitize_fr_html(r.text)
    except httpx.HTTPStatusError as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: HTTP {e.response.status_code}") from None
    except httpx.HTTPError as e:
        raise SourceUnavailable(f"{url.split('?')[0]}: {type(e).__name__}") from None
    return {"doc": meta, "body_html": body_html}
