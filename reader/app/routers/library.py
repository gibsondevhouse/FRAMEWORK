"""The /api/library router: browse eCFR and download titles, parts or sections.

Internal route order matters: the fixed paths (/jobs, /storage, /wire,
/batch-download, /update-all, /download) are declared before the parametrized
/{title} routes so they are never captured as a title number.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field

from .. import config, library

router = APIRouter(prefix="/api/library")


class DownloadRequest(BaseModel):
    title: int = Field(ge=1, le=50)
    part: str | None = Field(default=None, max_length=40)
    section: str | None = Field(default=None, max_length=200)
    kind: str = Field(default="section", pattern="^(section|appendix)$")  # what `section` names


class BatchDownloadRequest(BaseModel):
    titles: list[int] | None = Field(default=None, max_length=50)
    suite: str | None = Field(default=None, max_length=40)


def _library_call(fn, *args):
    try:
        return fn(*args)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach eCFR. Check the connection and try again.")


@router.get("")
def library_catalog() -> dict:
    return {
        "titles": _library_call(library.catalog),
        "desks": library.DESKS,
        "suites": library.suites(),
        "checked_at": library.catalog_checked_at(),
        "jobs": library.queue.snapshot(),
    }


@router.get("/jobs")
def library_jobs() -> dict:
    return library.queue.snapshot()


@router.post("/jobs/{job_id}/cancel")
def library_cancel(job_id: int) -> dict:
    job = library.queue.cancel(job_id)
    if job is None:
        raise HTTPException(404, "That download has already finished.")
    return job


@router.post("/jobs/clear")
def library_clear_queue() -> dict:
    gone = library.queue.clear()
    return {"cancelled": gone, "count": len(gone)}


@router.get("/storage")
def library_storage() -> dict:
    """Disk use per installed title, plus leftover temporary files from unfinished builds."""
    return library.storage()


@router.post("/storage/prune")
def library_prune() -> dict:
    try:
        return library.prune_temp()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.get("/wire")
def library_wire() -> list[dict]:
    """The most recently amended titles and what eCFR changed in each."""
    return _library_call(library.wire)


@router.post("/batch-download")
def library_batch_download(req: BatchDownloadRequest) -> dict:
    if req.suite:
        suite = library.COMPLIANCE_SUITES.get(req.suite)
        if not suite:
            raise HTTPException(404, f"No suite {req.suite!r}.")
        titles = suite["titles"]
    elif req.titles:
        if any(not 1 <= t <= 50 for t in req.titles):
            raise HTTPException(400, "CFR titles are numbered 1 to 50.")
        titles = req.titles
    else:
        raise HTTPException(400, "Give a suite or a list of titles.")
    return _library_call(library.queue_titles, titles)


@router.post("/update-all")
def library_update_all() -> dict:
    return _library_call(library.update_all)


@router.get("/{title}")
def library_title(title: int = Path(ge=1, le=50)) -> dict:
    return _library_call(library.title_view, title)


@router.get("/{title}/part/{part}")
def library_part(part: str, title: int = Path(ge=1, le=50)) -> dict:
    return _library_call(library.part_view, title, part)


@router.post("/download")
def library_download(req: DownloadRequest) -> dict:
    info = _library_call(library.ecfr_title, req.title)
    if info.get("reserved"):
        raise HTTPException(400, f"Title {req.title} is reserved and has no text.")
    if req.section:
        if req.kind == "appendix" and not req.part:
            raise HTTPException(400, "An appendix download needs its part.")
        target = {"t": req.kind, "id": req.section, "part": req.part or req.section.split(".")[0]}
        label = (req.section if req.kind == "appendix" else f"§ {req.section}") + f" · Title {req.title}"
        return library.queue.submit(req.title, "section", target, label)
    if req.part:
        return library.queue.submit(req.title, "part", {"part": req.part}, f"Part {req.part} · Title {req.title}")
    return library.queue.submit(req.title, "title", None, f"Title {req.title}")


@router.post("/{title}/update")
def library_update(title: int = Path(ge=1, le=50)) -> dict:
    if title not in config.installed_titles():
        raise HTTPException(404, f"Title {title} is not installed.")
    return library.queue.submit(title, "update", None, f"Update Title {title}")


@router.delete("/{title}")
def library_remove(title: int = Path(ge=1, le=50)) -> dict:
    installed = config.installed_titles()
    if title not in installed:
        raise HTTPException(404, f"Title {title} is not installed.")
    if len(installed) == 1:
        raise HTTPException(409, "This is the only title in the reader. Download another before removing it.")
    if library.queue.busy_with(title):
        raise HTTPException(409, f"Title {title} has a download in progress.")
    library.remove(title)
    return {"removed": title, "installed": config.installed_titles()}
