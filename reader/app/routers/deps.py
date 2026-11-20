"""Shared router dependencies and request models.

Import rule for this package: routers import whole modules
(`from .. import config, library, store, chat`), never individual functions,
so test patches on module attributes (`config.installed_titles`,
`library.queue`, `chat.list_models`, …) stay effective in every handler.
"""
from __future__ import annotations

from fastapi import HTTPException, Path
from pydantic import BaseModel, Field

from .. import config

NO_STORE = {"Cache-Control": "no-store"}
STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=100_000)


class OpenItem(BaseModel):
    """The non-CFR unit on screen (a U.S.C. section, a Constitution unit, a Public Law, a
    Federal Register document or an Agenda rule), as the store keys it. `chat.open_ref`
    turns it into a canonical id and ignores anything that is not one."""
    corpus: str = Field(pattern="^(usc|constitution|plaw|fr|agenda)$")
    key: str = Field(min_length=1, max_length=240)
    collection: str | None = Field(default=None, max_length=16)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(max_length=100)
    section_id: str | None = Field(default=None, max_length=200)
    open: OpenItem | None = None
    model: str = Field(min_length=1, max_length=120)


def require_key() -> None:
    if not config.anthropic_key():
        raise HTTPException(400, "No ANTHROPIC_API_KEY configured. Add it to reader/.env and restart.")


def valid_installed_title(title: int = Path(ge=1, le=50)) -> int:
    if title not in config.installed_titles():
        raise HTTPException(404, f"CFR Title {title} is not installed on this server.")
    return title
