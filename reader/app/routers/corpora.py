"""/api/constitution, /api/plaw and /api/agenda: the U.S. Constitution, Public Laws and the
Unified Agenda corpora. Registered before the /api/{title} routers (fixed prefixes).

GETs never touch the network and answer `installed: false` (or 404 for one item) before a
corpus is built. Builds go through the library queue (POST …/build, …/update) or through
the source registry's apply.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from .. import agenda, constitution, plaw


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
def plaw_law(law_id: str, xml: bool = False) -> dict:
    law = plaw.get_law(law_id, include_xml=xml)
    if law is None:
        raise HTTPException(404, "No such law in the local copy.")
    return law


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


# --- Unified Agenda ---------------------------------------------------------------

class AgendaBuild(BaseModel):
    years: int = Field(default=2, ge=1, le=30)
    agencies: list[str] | None = Field(default=None, max_length=200)
    stages: list[str] | None = Field(default=None, max_length=5)


@corpora_router.get("/api/agenda")
def agenda_list(edition: str | None = Query(None, pattern=r"^\d{6}$"), agency: str | None = Query(None, pattern=r"^\d{4}$"),
                stage: str | None = Query(None, max_length=40), limit: int = Query(50, ge=1, le=200),
                offset: int = Query(0, ge=0)) -> dict:
    return {**agenda.list_entries(edition, agency, stage, limit, offset), "status": agenda.status()}


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
