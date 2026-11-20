"""GovInfo (api.govinfo.gov) cross-check for the Federal Register corpus.

GovInfo publishes each daily FR issue as package `FR-{YYYY-MM-DD}` whose granules are the
issue's documents. Comparing a day's granules with the corpus's documents for that day
is an independent check that the federalregister.gov API didn't drop or invent
documents. The corpus only keeps documents citing its CFR titles, so documents GovInfo
has and the corpus lacks are expected (reported, not failed); documents the corpus has
that GovInfo lacks are the signal.

Needs an api.data.gov key in `GOVINFO_API_KEY`. Without one, callers get `None` and
report an INFO line. The key travels as the `api_key` query parameter (what api.data.gov
expects) and is never logged or put in an error message.

Assumption to verify on first live use: an FR granule's `granuleId` is the document
number ("2026-22306"); `granule_document_number` also accepts a `FR-YYYY-MM-DD-` prefix
or a `/`-separated path ending in the number.
"""
from __future__ import annotations

import os
import re

import httpx

from . import fr_client

BASE = "https://api.govinfo.gov"
PAGE_SIZE = 1000
MAX_PAGES = 20
_DOC_NUM = re.compile(r"(\d{4}-\d{3,6})$")


def api_key() -> str | None:
    key = os.getenv("GOVINFO_API_KEY", "").strip()
    return key or None


def client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": fr_client.USER_AGENT, "Accept": "application/json"},
                        timeout=30.0, follow_redirects=True)


def granule_document_number(granule: dict) -> str | None:
    for key in ("granuleId", "title"):
        m = _DOC_NUM.search(str(granule.get(key) or "").strip().rstrip("/"))
        if m:
            return m.group(1)
    return None


def _get(c: httpx.Client, url: str, key: str, params: dict | None = None) -> dict:
    # httpx replaces a URL's query string when `params` is given, so merge explicitly
    # (GovInfo's `nextPage` carries offsetMark/pageSize in its query).
    full = httpx.URL(url).copy_merge_params({**(params or {}), "api_key": key})
    try:
        r = c.get(full)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        raise fr_client.SourceUnavailable(f"GovInfo: HTTP {e.response.status_code}") from None
    except (httpx.HTTPError, ValueError) as e:
        raise fr_client.SourceUnavailable(f"GovInfo: {type(e).__name__}") from None


def fr_package_documents(day: str, c: httpx.Client | None = None, key: str | None = None) -> set[str] | None:
    """Document numbers in GovInfo's FR package for `day` (ISO date), or None without a key.
    A day with no issue (weekend, holiday) is GovInfo 404 → empty set."""
    key = key or api_key()
    if not key:
        return None
    own = c is None
    c = c or client()
    try:
        url: str | None = f"{BASE}/packages/FR-{day}/granules"
        params: dict | None = {"offsetMark": "*", "pageSize": str(PAGE_SIZE)}
        out: set[str] = set()
        for _ in range(MAX_PAGES):
            try:
                page = _get(c, url, key, params)
            except fr_client.SourceUnavailable as exc:
                if "HTTP 404" in str(exc):
                    return out
                raise
            for g in page.get("granules") or []:
                num = granule_document_number(g)
                if num:
                    out.add(num)
            url, params = page.get("nextPage"), None
            if not url:
                break
        return out
    finally:
        if own:
            c.close()


def cross_check_fr(day: str, corpus_numbers: set[str], c: httpx.Client | None = None) -> dict | None:
    """Compare the corpus's documents published on `day` with GovInfo's package.
    None when no key is configured."""
    gov = fr_package_documents(day, c=c)
    if gov is None:
        return None
    return {
        "date": day,
        "corpus": len(corpus_numbers),
        "govinfo": len(gov),
        "both": sorted(corpus_numbers & gov),
        "missing_from_govinfo": sorted(corpus_numbers - gov),
        "not_in_corpus": len(gov - corpus_numbers),
    }
