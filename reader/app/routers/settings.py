"""The /api/settings router: inspect and edit reader/.env from the UI."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from .. import chat, config, news_store, news_worker

router = APIRouter(prefix="/api/settings")


class EnvUpdateRequest(BaseModel):
    dol_api_key: str | None = Field(default=None, max_length=500)
    clear_dol_api_key: bool = False
    anthropic_api_key: str | None = Field(default=None, max_length=500)
    clear_anthropic_api_key: bool = False
    anthropic_model: str | None = Field(default=None, max_length=120)
    news_sync: bool | None = None
    news_retention_days: int | None = Field(default=None, ge=1, le=3650)


@router.get("/env")
def get_settings_env(response: Response) -> dict:
    """Return reader/.env status and masked key previews (never raw secret values)."""
    response.headers["Cache-Control"] = "no-store"
    return config.env_status()


@router.post("/env")
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

    if "ANTHROPIC_API_KEY" in updates:
        chat.clear_models_cache()

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
