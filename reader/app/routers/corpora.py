"""/api/constitution, /api/plaw and /api/agenda: the U.S. Constitution, Public Laws and the
Unified Agenda corpora. Registered before the /api/{title} routers (fixed prefixes).

GETs never touch the network and answer `installed: false` (or 404 for one item) before a
corpus is built. Builds go through the library queue (POST …/build, …/update) or through
the source registry's apply.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from .. import agenda, constitution, library, plaw


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


corpora_router = APIRouter(dependencies=[Depends(_no_store)])


# --- Constitution ------------------------------------------------------------

@corpora_router.get("/api/constitution")
def constitution_status() -> dict:
    return {**constitution.status(), "outline": constitution.outline()}


@corpora_router.get("/api/constitution/search")
def constitution_search(q: str = Query(..., min_length=1, max_length=200), notes: bool = False,
                        limit: int = Query(20, ge=1, le=100)) -> dict:
    return constitution.search(q, limit=limit, include_notes=notes)


@corpora_router.get("/api/constitution/unit/{unit_id}")
def constitution_unit(unit_id: str) -> dict:
    u = constitution.get_unit(unit_id)
    if u is None:
        raise HTTPException(404, "No such part of the Constitution (or it isn't installed).")
    return u


@corpora_router.post("/api/constitution/build")
def constitution_build() -> dict:
    return {"job": constitution.submit()}


@corpora_router.post("/api/constitution/update")
def constitution_update() -> dict:
    """Rebuild only if GovInfo lists a newer House Manual (a download when nothing is installed)."""
    return {"job": constitution.submit("constitution-update")}


@corpora_router.delete("/api/constitution")
def constitution_remove() -> dict:
    if library.queue.busy_with(constitution.JOB_KEY):
        raise HTTPException(409, "The Constitution has a download in progress.")
    if not constitution.remove():
        raise HTTPException(404, "The Constitution isn't installed.")
    return {"removed": "constitution"}


# --- Public Laws ----------------------------------------------------------------

class PlawBuild(BaseModel):
    congresses: list[int] | None = Field(default=None, max_length=50)
    types: list[str] | None = Field(default=None, max_length=2)


@corpora_router.get("/api/plaw")
def plaw_list(congress: int | None = Query(None, ge=1, le=200), type: str | None = Query(None, pattern="^(public|private)$"),
              limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)) -> dict:
    return {**plaw.list_laws(congress, type, limit, offset), "status": plaw.status()}


@corpora_router.get("/api/plaw/search")
def plaw_search(q: str = Query(..., min_length=1, max_length=200), limit: int = Query(20, ge=1, le=100)) -> dict:
    return plaw.search(q, limit)


@corpora_router.get("/api/plaw/law/{law_id}")
def plaw_law(law_id: str, xml: bool = False, text: bool = True) -> dict:
    """One law's metadata, U.S. Code links and provenance (`text=false` leaves out the plain
    text, which the reader gets as HTML units from …/text instead)."""
    law = plaw.get_law(law_id, include_xml=xml)
    if law is None:
        raise HTTPException(404, "No such law in the local copy.")
    if not text:
        law.pop("text", None)
    return law


@corpora_router.get("/api/plaw/law/{law_id}/text")
def plaw_law_text(law_id: str, unit: str | None = Query(None, max_length=40)) -> dict:
    """The law as reading units: `mode`, `outline`, and `html` for one unit (`?unit=`, '' = first)
    of a long law, or for the whole law."""
    try:
        d = plaw.law_text(law_id, unit)
    except KeyError:
        raise HTTPException(404, "No such section in this law.")
    if d is None:
        raise HTTPException(404, "No such law in the local copy.")
    return d


@corpora_router.get("/api/plaw/usc/{title}/{section}")
def plaw_for_usc(title: int, section: str, limit: int = Query(50, ge=1, le=200)) -> dict:
    """Public Laws that cite, amend or place provisions at a U.S. Code section."""
    return {"installed": plaw.exists(), "results": plaw.laws_for_usc(title, section, limit)}


@corpora_router.post("/api/plaw/build")
def plaw_build(req: PlawBuild | None = None) -> dict:
    req = req or PlawBuild()
    return {"job": plaw.submit("plaw-build", {"congresses": req.congresses or "all", "types": req.types or ["public"]})}


@corpora_router.post("/api/plaw/update")
def plaw_update() -> dict:
    return {"job": plaw.submit("plaw-update")}


@corpora_router.delete("/api/plaw")
def plaw_remove() -> dict:
    if library.queue.busy_with(plaw.JOB_KEY):
        raise HTTPException(409, "Public Laws have a download in progress.")
    if not plaw.remove():
        raise HTTPException(404, "Public Laws aren't installed.")
    return {"removed": "plaw"}


# --- Unified Agenda ---------------------------------------------------------------

class AgendaBuild(BaseModel):
    years: int = Field(default=2, ge=1, le=30)
    agencies: list[str] | None = Field(default=None, max_length=200)
    stages: list[str] | None = Field(default=None, max_length=5)


@corpora_router.get("/api/agenda")
def agenda_list(edition: str | None = Query(None, pattern=r"^\d{6}$"), agency: str | None = Query(None, pattern=r"^\d{4}$"),
                stage: str | None = Query(None, max_length=40), limit: int = Query(50, ge=1, le=200),
                offset: int = Query(0, ge=0), q: str | None = Query(None, max_length=200)) -> dict:
    return {**agenda.list_entries(edition, agency, stage, limit, offset, q), "status": agenda.status()}


@corpora_router.get("/api/agenda/facets")
def agenda_facets(edition: str | None = Query(None, pattern=r"^\d{6}$")) -> dict:
    """Entries per parent agency and per stage in one edition (the Newsroom's filters)."""
    return agenda.facets(edition)


@corpora_router.get("/api/agenda/search")
def agenda_search(q: str = Query(..., min_length=1, max_length=200), limit: int = Query(20, ge=1, le=100)) -> dict:
    return agenda.search(q, limit)


@corpora_router.get("/api/agenda/rin/{rin}")
def agenda_rin(rin: str, edition: str | None = Query(None, pattern=r"^\d{6}$")) -> dict:
    e = agenda.get_entry(rin.upper(), edition)
    if e is None:
        raise HTTPException(404, "No such RIN in the local Unified Agenda.")
    return e


@corpora_router.post("/api/agenda/build")
def agenda_build(req: AgendaBuild | None = None) -> dict:
    req = req or AgendaBuild()
    return {"job": agenda.submit("agenda-build", {"years": req.years, **agenda.clean_filters(req.agencies, req.stages)})}


@corpora_router.post("/api/agenda/update")
def agenda_update() -> dict:
    return {"job": agenda.submit("agenda-update")}


@corpora_router.delete("/api/agenda")
def agenda_remove() -> dict:
    if library.queue.busy_with(agenda.JOB_KEY):
        raise HTTPException(409, "The Unified Agenda has a download in progress.")
    if not agenda.remove():
        raise HTTPException(404, "The Unified Agenda isn't installed.")
    return {"removed": "agenda"}
