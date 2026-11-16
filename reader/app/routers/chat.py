"""Chat routers: model listing and the streaming Claude chat, both title-scoped
(/api/{title}/models, /api/{title}/chat) and legacy (/api/models, /api/chat)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from .. import chat, config
from . import deps

title_router = APIRouter(prefix="/api/{title}")
legacy_router = APIRouter()


@title_router.get("/models")
async def title_models(_: int = Depends(deps.valid_installed_title)) -> dict:
    if not config.anthropic_key():
        return {"configured": False, "models": [], "default": None}
    try:
        available = await chat.list_models()
    except Exception as exc:
        return {"configured": True, "models": [], "default": config.preferred_model(), "error": chat.friendly_error(exc)}
    return {"configured": True, "models": available, "default": chat.pick_default_model(available)}


@title_router.post("/chat")
async def post_title_chat(req: deps.ChatRequest, title: int = Depends(deps.valid_installed_title)) -> StreamingResponse:
    deps.require_key()
    if not req.messages or req.messages[-1].role != "user":
        raise HTTPException(400, "The last message must be from the user.")
    stream = chat.stream_chat(
        [m.model_dump() for m in req.messages],
        req.section_id,
        req.model,
        title=title,
    )
    return StreamingResponse(stream, media_type="text/event-stream", headers=deps.STREAM_HEADERS)


@legacy_router.get("/api/models")
async def models() -> dict:
    return await title_models(_=deps.valid_installed_title(config.DEFAULT_TITLE))


@legacy_router.post("/api/chat")
async def post_chat(req: deps.ChatRequest) -> StreamingResponse:
    return await post_title_chat(req, title=deps.valid_installed_title(config.DEFAULT_TITLE))
