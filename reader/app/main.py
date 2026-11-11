"""FastAPI app: serves the federated CFR reader UI and its JSON / streaming APIs."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import httpx

from . import build, chat, config, library, store


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not config.installed_titles():
        build.build(title=config.DEFAULT_TITLE, force=True)
    store.reset_connections()
    yield
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


# ---------------------------------------------------------------------------
# Library: browse eCFR and download titles, parts or sections
# ---------------------------------------------------------------------------

class DownloadRequest(BaseModel):
    title: int = Field(ge=1, le=50)
    part: str | None = Field(default=None, max_length=40)
    section: str | None = Field(default=None, max_length=200)
    kind: str = Field(default="section", pattern="^(section|appendix)$")  # what `section` names


def _library_call(fn, *args):
    try:
        return fn(*args)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach eCFR. Check the connection and try again.")


@app.get("/api/library")
def library_catalog() -> dict:
    return {"titles": _library_call(library.catalog), "jobs": library.queue.snapshot()}


@app.get("/api/library/jobs")
def library_jobs() -> dict:
    return library.queue.snapshot()


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
