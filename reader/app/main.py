"""FastAPI app: serves the federated CFR reader UI and its JSON / streaming APIs."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import httpx

from . import build, chat, config, library, news_store, news_worker, store
from .news_api import news_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not config.installed_titles():
        build.build(title=config.DEFAULT_TITLE, force=True)
    store.reset_connections()
    # The news worker only runs in a real server (tests never run lifespan).
    if config.news_sync_enabled():
        news_store.init_db()
        news_worker.start()
    yield
    news_worker.stop()
    store.reset_connections()


class RevalidatedStaticFiles(StaticFiles):
    """Static assets revalidate on every load (a cheap 304 via ETag). Without a Cache-Control
    header browsers guess a freshness lifetime and keep serving an old app.js/styles.css after
    an update, which pairs new markup with stale code."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


app = FastAPI(title="FRAMEWORK: CFR Reader & Assistant", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.mount("/static", RevalidatedStaticFiles(directory=config.STATIC_DIR), name="static")

NO_STORE = {"Cache-Control": "no-store"}
STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    section_id: str | None = None
    model: str


class EnvUpdateRequest(BaseModel):
    dol_api_key: str | None = Field(default=None, max_length=500)
    clear_dol_api_key: bool = False
    anthropic_api_key: str | None = Field(default=None, max_length=500)
    clear_anthropic_api_key: bool = False
    anthropic_model: str | None = Field(default=None, max_length=120)
    news_sync: bool | None = None
    news_retention_days: int | None = Field(default=None, ge=1, le=3650)


def require_key() -> None:
    if not config.anthropic_key():
        raise HTTPException(400, "No ANTHROPIC_API_KEY configured. Add it to reader/.env and restart.")


def valid_installed_title(title: int = Path(ge=1, le=50)) -> int:
    if title not in config.installed_titles():
        raise HTTPException(404, f"CFR Title {title} is not installed on this server.")
    return title


# ---------------------------------------------------------------------------
# Global & Metadata Endpoints
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(config.STATIC_DIR / "index.html", headers=NO_STORE)


@app.get("/api/titles")
def list_titles() -> list[dict]:
    """List all installed CFR titles and their metadata."""
    installed = config.installed_titles()
    results = []
    for t in installed:
        m = store.meta(t)
        results.append({
            "title": t,
            "name": m.get("title_name") or f"Title {t}",
            "edition": m.get("edition"),
            "built_at": m.get("built_at"),
            "section_count": int(m.get("section_count", 0)),
            "partial": bool(m.get("scope")),
            "ai_configured": config.anthropic_key() is not None,
        })
    return results


@app.get("/api/settings/env")
def get_settings_env(response: Response) -> dict:
    """Return reader/.env status and masked key previews (never raw secret values)."""
    response.headers["Cache-Control"] = "no-store"
    return config.env_status()


@app.post("/api/settings/env")
def update_settings_env(req: EnvUpdateRequest, response: Response) -> dict:
    """Create or update reader/.env and apply changes live without requiring a restart."""
    response.headers["Cache-Control"] = "no-store"
    prev_sync = config.news_sync_enabled()
    updates: dict[str, str | None] = {}

    if req.clear_dol_api_key:
        updates["DOL_API_KEY"] = None
    elif req.dol_api_key is not None and req.dol_api_key.strip():
        updates["DOL_API_KEY"] = req.dol_api_key.strip()

    if req.clear_anthropic_api_key:
        updates["ANTHROPIC_API_KEY"] = None
    elif req.anthropic_api_key is not None and req.anthropic_api_key.strip():
        updates["ANTHROPIC_API_KEY"] = req.anthropic_api_key.strip()

    if req.anthropic_model is not None:
        updates["ANTHROPIC_MODEL"] = req.anthropic_model.strip() or None
    if req.news_sync is not None:
        updates["NEWS_SYNC"] = "1" if req.news_sync else "0"
    if req.news_retention_days is not None:
        updates["NEWS_RETENTION_DAYS"] = str(req.news_retention_days)

    try:
        status = config.write_env_updates(updates)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    now_sync = config.news_sync_enabled()
    if req.news_sync is not None and now_sync != prev_sync:
        if now_sync:
            news_store.init_db()
            news_worker.start()
        else:
            news_worker.stop()

    queued: list[str] = []
    if updates.get("DOL_API_KEY") and now_sync and not news_worker.is_syncing():
        queued = news_worker.request_sync(force=False)

    return {"status": status, "news_sync_queued": queued}


# ---------------------------------------------------------------------------
# Library: browse eCFR and download titles, parts or sections
# ---------------------------------------------------------------------------

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


@app.get("/api/library")
def library_catalog() -> dict:
    return {
        "titles": _library_call(library.catalog),
        "desks": library.DESKS,
        "suites": library.suites(),
        "checked_at": library.catalog_checked_at(),
        "jobs": library.queue.snapshot(),
    }


@app.get("/api/library/jobs")
def library_jobs() -> dict:
    return library.queue.snapshot()


@app.post("/api/library/jobs/{job_id}/cancel")
def library_cancel(job_id: int) -> dict:
    job = library.queue.cancel(job_id)
    if job is None:
        raise HTTPException(404, "That download has already finished.")
    return job


@app.post("/api/library/jobs/clear")
def library_clear_queue() -> dict:
    gone = library.queue.clear()
    return {"cancelled": gone, "count": len(gone)}


@app.get("/api/library/storage")
def library_storage() -> dict:
    """Disk use per installed title, plus leftover temporary files from unfinished builds."""
    return library.storage()


@app.post("/api/library/storage/prune")
def library_prune() -> dict:
    try:
        return library.prune_temp()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@app.get("/api/library/wire")
def library_wire() -> list[dict]:
    """The most recently amended titles and what eCFR changed in each."""
    return _library_call(library.wire)


@app.post("/api/library/batch-download")
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


@app.post("/api/library/update-all")
def library_update_all() -> dict:
    return _library_call(library.update_all)


@app.get("/api/library/{title}")
def library_title(title: int = Path(ge=1, le=50)) -> dict:
    return _library_call(library.title_view, title)


@app.get("/api/library/{title}/part/{part}")
def library_part(part: str, title: int = Path(ge=1, le=50)) -> dict:
    return _library_call(library.part_view, title, part)


@app.post("/api/library/download")
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


@app.post("/api/library/{title}/update")
def library_update(title: int = Path(ge=1, le=50)) -> dict:
    if title not in config.installed_titles():
        raise HTTPException(404, f"Title {title} is not installed.")
    return library.queue.submit(title, "update", None, f"Update Title {title}")


@app.delete("/api/library/{title}")
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


@app.get("/api/search")
async def search_global(
    q: str,
    title: str | None = None,
    part: str | None = None,
    limit: int = 30,
) -> dict:
    """Search within a specific title, or across all installed titles if title='all' or omitted."""
    target_title = title if title else config.DEFAULT_TITLE
    return await asyncio.to_thread(store.search, q, part=part, limit=limit, title=target_title)


# ---------------------------------------------------------------------------
# News: /api/news/... — MUST be registered before the title router below, or
# /api/news/section/{id} would be captured by /api/{title}/section/... as a 422.
# ---------------------------------------------------------------------------

app.include_router(news_router)


# ---------------------------------------------------------------------------
# Title-scoped Router: /api/{title}/...
# ---------------------------------------------------------------------------

title_router = APIRouter(prefix="/api/{title}")


@title_router.get("/meta")
def get_title_meta(title: int = Depends(valid_installed_title)) -> dict:
    m = store.meta(title)
    return {
        "title": title,
        "name": m.get("title_name") or f"Title {title}",
        "edition": m.get("edition"),
        "built_at": m.get("built_at"),
        "section_count": int(m.get("section_count", 0)),
        "ai_configured": config.anthropic_key() is not None,
    }


@title_router.get("/tree")
def get_title_tree(title: int = Depends(valid_installed_title)) -> FileResponse:
    path = config.tree_path(title)
    if not path.exists():
        raise HTTPException(404, f"Tree not found for Title {title}")
    return FileResponse(path, media_type="application/json")


@title_router.get("/section/{section_id:path}")
def get_title_section(
    section_id: str,
    title: int = Depends(valid_installed_title),
    unit: str | None = None,
) -> dict:
    """`?unit=KEY` (or `?unit=` for the first) returns just that unit of a long section."""
    sec = store.get_section(section_id, title=title, unit=unit)
    if not sec:
        raise HTTPException(404, f"No section {section_id!r} in Title {title}")
    return sec


@title_router.get("/part/{part}")
def get_title_part(part: str, title: int = Depends(valid_installed_title)) -> dict:
    return store.get_part_front_matter(part, title=title)


@title_router.get("/part/{part}/full")
def get_title_part_full(part: str, title: int = Depends(valid_installed_title)) -> dict:
    sections = store.part_full(part, title=title)
    if not sections:
        raise HTTPException(404, f"No sections in Part {part} of Title {title}")
    return {"title": title, "part": part, "sections": sections}


@title_router.get("/search")
async def search_title(
    q: str,
    part: str | None = None,
    limit: int = 30,
    title: int = Depends(valid_installed_title),
) -> dict:
    return await asyncio.to_thread(store.search, q, part=part, limit=limit, title=title)


@title_router.get("/models")
async def title_models(_: int = Depends(valid_installed_title)) -> dict:
    if not config.anthropic_key():
        return {"configured": False, "models": [], "default": None}
    try:
        available = await chat.list_models()
    except Exception as exc:
        return {"configured": True, "models": [], "default": config.preferred_model(), "error": chat.friendly_error(exc)}
    return {"configured": True, "models": available, "default": chat.pick_default_model(available)}


@title_router.post("/chat")
async def post_title_chat(req: ChatRequest, title: int = Depends(valid_installed_title)) -> StreamingResponse:
    require_key()
    if not req.messages or req.messages[-1].role != "user":
        raise HTTPException(400, "The last message must be from the user.")
    stream = chat.stream_chat(
        [m.model_dump() for m in req.messages],
        req.section_id,
        req.model,
        title=title,
    )
    return StreamingResponse(stream, media_type="text/event-stream", headers=STREAM_HEADERS)


app.include_router(title_router)


# ---------------------------------------------------------------------------
# Legacy un-prefixed aliases for Title 29 (backward compatibility)
# ---------------------------------------------------------------------------

@app.get("/api/meta")
def get_meta() -> dict:
    return get_title_meta(title=config.DEFAULT_TITLE)


@app.get("/api/tree")
def get_tree() -> FileResponse:
    return get_title_tree(title=config.DEFAULT_TITLE)


@app.get("/api/section/{section_id:path}")
def get_section(section_id: str, unit: str | None = None) -> dict:
    return get_title_section(section_id, title=config.DEFAULT_TITLE, unit=unit)


@app.get("/api/part/{part}")
def get_part(part: str) -> dict:
    return get_title_part(part, title=config.DEFAULT_TITLE)


@app.get("/api/part/{part}/full")
def get_part_full(part: str) -> dict:
    return get_title_part_full(part, title=config.DEFAULT_TITLE)


@app.get("/api/models")
async def models() -> dict:
    return await title_models(title=config.DEFAULT_TITLE)


@app.post("/api/chat")
async def post_chat(req: ChatRequest) -> StreamingResponse:
    return await post_title_chat(req, title=config.DEFAULT_TITLE)
