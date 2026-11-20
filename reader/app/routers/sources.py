"""/api/sources: the federal source registry, the active selection, presets and saved
templates (`app/sources/`). Registered before the /api/{title} routers (fixed prefix).

GETs never write and never touch the network. Applying a selection queues jobs through the
library queue; a large or destructive plan comes back with `needs_confirm: true` and does
nothing until it is resent with `"confirm": true`.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Body, HTTPException, Response
from pydantic import BaseModel, Field

from .. import sources

sources_router = APIRouter()


def _nostore(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


class SelectionBody(BaseModel):
    selection: dict
    confirm: bool = False
    remove_unselected: bool = False


class ApplyBody(BaseModel):
    confirm: bool = False
    remove_unselected: bool = False


class TemplateBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    selection: dict | None = None      # None = save the current selection


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    selection: dict | None = None


@sources_router.get("/api/sources")
async def get_sources(response: Response, check: bool = False) -> dict:
    _nostore(response)
    return await asyncio.to_thread(sources.catalog, check)


@sources_router.get("/api/sources/selection")
def get_selection(response: Response) -> dict:
    _nostore(response)
    sel, saved = sources.selection.current()
    return {"selection": sel, "saved": saved}


@sources_router.put("/api/sources/selection")
def put_selection(body: SelectionBody, response: Response) -> dict:
    """Save the selection (enabled flags, schedules, filters take effect at once) without
    downloading or deleting anything. Use /apply to also install what it adds."""
    _nostore(response)
    return {"selection": sources.selection.save(body.selection), "saved": True}


@sources_router.post("/api/sources/selection/preview")
def preview_selection(body: SelectionBody, response: Response) -> dict:
    _nostore(response)
    return sources.plan.preview(body.selection, remove_unselected=body.remove_unselected)


@sources_router.post("/api/sources/selection/apply")
def apply_selection(body: SelectionBody, response: Response) -> dict:
    _nostore(response)
    return sources.plan.apply(body.selection, confirm=body.confirm, remove_unselected=body.remove_unselected)


@sources_router.delete("/api/sources/selection")
def reset_selection(response: Response) -> dict:
    """Forget the saved selection: the reader goes back to its derived current setup."""
    _nostore(response)
    sources.selection.reset()
    sel, saved = sources.selection.current()
    return {"selection": sel, "saved": saved}


@sources_router.get("/api/sources/templates")
def list_templates(response: Response) -> dict:
    _nostore(response)
    return {"templates": sources.all_templates()}


@sources_router.get("/api/sources/templates/export")
def export_templates(response: Response) -> dict:
    _nostore(response)
    return sources.export_templates()


@sources_router.post("/api/sources/templates/import")
def import_templates(response: Response, payload: dict = Body(...)) -> dict:
    _nostore(response)
    try:
        return sources.import_templates(payload)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@sources_router.post("/api/sources/templates")
def create_template(body: TemplateBody, response: Response) -> dict:
    _nostore(response)
    try:
        return sources.create_template(body.name, body.description, body.selection)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@sources_router.get("/api/sources/templates/{tid}")
def get_template(tid: str, response: Response) -> dict:
    _nostore(response)
    t = sources.get_template(tid)
    if t is None:
        raise HTTPException(404, "No such template.")
    return t


@sources_router.put("/api/sources/templates/{tid}")
def update_template(tid: str, body: TemplatePatch, response: Response) -> dict:
    _nostore(response)
    if tid.startswith(sources.presets.PRESET_PREFIX):
        raise HTTPException(403, "Built-in presets can't be changed. Save a copy as your own template.")
    try:
        t = sources.update_template(tid, body.name, body.description, body.selection)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if t is None:
        raise HTTPException(404, "No such template.")
    return t


@sources_router.delete("/api/sources/templates/{tid}")
def delete_template(tid: str, response: Response) -> dict:
    _nostore(response)
    if tid.startswith(sources.presets.PRESET_PREFIX):
        raise HTTPException(403, "Built-in presets can't be deleted.")
    if not sources.db.delete_template(tid):
        raise HTTPException(404, "No such template.")
    return {"deleted": tid}


@sources_router.post("/api/sources/templates/{tid}/preview")
def preview_template(tid: str, response: Response, body: ApplyBody | None = None) -> dict:
    _nostore(response)
    t = sources.get_template(tid)
    if t is None:
        raise HTTPException(404, "No such template.")
    return sources.plan.preview(t["selection"], remove_unselected=bool(body and body.remove_unselected))


@sources_router.post("/api/sources/templates/{tid}/apply")
def apply_template(tid: str, response: Response, body: ApplyBody | None = None) -> dict:
    _nostore(response)
    t = sources.get_template(tid)
    if t is None:
        raise HTTPException(404, "No such template.")
    body = body or ApplyBody()
    return {"template": {"id": t["id"], "name": t["name"]},
            **sources.plan.apply(t["selection"], confirm=body.confirm, remove_unselected=body.remove_unselected)}
