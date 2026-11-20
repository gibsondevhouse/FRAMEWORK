"""The /api/fr router: the Federal Register corpus (`data/fr.sqlite3`).

Registered in main.py BEFORE the /api/{title} routers, like the news router, or
`/api/fr/...` would be captured as a (non-integer) title and 422.

Every response is `Cache-Control: no-store`. GETs read the local corpus only: a missing
corpus returns empty, well-formed results (never a 500, never a new file) and no GET
makes a network request. Writes are explicit POSTs: queue a build/update on the library
queue, or fetch one document's full text.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import BaseModel, Field

from .. import config, fr_build, fr_client, fr_store

_DOC_NUM = r"^[A-Za-z0-9._-]{1,40}$"
_DATE = r"^\d{4}-\d{2}-\d{2}$"
_PART = r"^[0-9A-Za-z.-]{1,20}$"


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


fr_router = APIRouter(prefix="/api/fr", dependencies=[Depends(_no_store)])


@fr_router.get("/status")
def get_status() -> dict:
    st = fr_store.status()
    meta = st.get("meta") or {}
    st["due"] = fr_build.is_due(meta=meta) if st["installed"] else False
    st["default_titles"] = fr_build.default_titles()
    st["default_years"] = config.fr_corpus_years()
    return st


@fr_router.get("/search")
def search(
    q: str | None = Query(None, max_length=200),
    type: str | None = Query(None, max_length=40),
    agency: str | None = Query(None, max_length=120, pattern=r"^[a-z0-9-]+$"),
    title: int | None = Query(None, ge=1, le=50),
    part: str | None = Query(None, pattern=_PART),
    since: str | None = Query(None, pattern=_DATE),
    until: str | None = Query(None, pattern=_DATE),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10_000),
) -> dict:
    with fr_store.read_con() as con:
        if con is None:
            return {"installed": False, "total": 0, "results": []}
        res = fr_store.search(con, q, type_=type, agency=agency, title=title, part=part,
                              since=since, until=until, limit=limit, offset=offset)
    return {"installed": True, **res}


@fr_router.get("/document/{document_number}")
def get_document(
    document_number: str = Path(..., pattern=_DOC_NUM),
    body: bool = False,
) -> dict:
    with fr_store.read_con() as con:
        doc = fr_store.get_document(con, document_number, include_body=body) if con is not None else None
    if doc is None:
        raise HTTPException(404, f"Federal Register document {document_number} is not in the local corpus.")
    return doc


@fr_router.post("/document/{document_number}/body")
def fetch_document_body(document_number: str = Path(..., pattern=_DOC_NUM)) -> dict:
    """Download one document's full text from federalregister.gov and store it with its hash."""
    try:
        return fr_build.fetch_body(document_number)
    except LookupError:
        raise HTTPException(404, f"Federal Register document {document_number} is not in the local corpus.")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except fr_client.SourceUnavailable as exc:
        raise HTTPException(503, f"The Federal Register didn't answer: {exc}")


def _by_cfr(title: int, part: str, section: str | None, limit: int, offset: int) -> dict:
    with fr_store.read_con() as con:
        if con is None:
            return {"installed": False, "total": 0, "results": []}
        res = fr_store.by_cfr(con, title, part, section, limit=limit, offset=offset)
    return {"installed": True, "title": title, "part": part, "section": section, **res}


@fr_router.get("/by-cfr/{title}/{part}")
def by_cfr_part(
    title: int = Path(..., ge=1, le=50),
    part: str = Path(..., pattern=_PART),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    return _by_cfr(title, part, None, limit, offset)


@fr_router.get("/by-cfr/{title}/{part}/{section}")
def by_cfr_section(
    title: int = Path(..., ge=1, le=50),
    part: str = Path(..., pattern=_PART),
    section: str = Path(..., pattern=r"^[0-9A-Za-z.-]{1,30}$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    if section.split(".", 1)[0] != part:
        raise HTTPException(422, f"Section {section} is not in part {part}.")
    return _by_cfr(title, part, section, limit, offset)


class BuildRequest(BaseModel):
    titles: list[int] | None = Field(default=None, max_length=50)
    years: int | None = Field(default=None, ge=1, le=30)


@fr_router.post("/build")
def queue_build(req: BuildRequest | None = None) -> dict:
    """Queue a full (atomic) corpus build on the library queue."""
    req = req or BuildRequest()
    titles = sorted(set(req.titles or fr_build.default_titles()))
    if not titles or any(not 1 <= t <= 50 for t in titles):
        raise HTTPException(422, "Give CFR titles 1-50, or install a title first.")
    return {"job": fr_build.submit("fr-build", {"titles": titles, "years": req.years})}


@fr_router.post("/update")
def queue_update() -> dict:
    """Queue an incremental refresh (or a first build if the corpus doesn't exist yet)."""
    return {"job": fr_build.submit("fr-update")}
