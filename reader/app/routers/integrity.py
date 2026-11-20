"""GET /api/integrity: the `python -m app.integrity` report as JSON.

Registered before the /api/{title} routers (fixed prefix). Upstream checks (eCFR,
OLRC, GovInfo when GOVINFO_API_KEY is set) run unless `offline=true`. Never writes.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query, Response

from .. import integrity

integrity_router = APIRouter()


@integrity_router.get("/api/integrity")
async def get_integrity(
    response: Response,
    corpus: str | None = Query(None, pattern="^(cfr|fr|usc|constitution|plaw|agenda)$"),
    title: int | None = Query(None, ge=1, le=150),
    offline: bool = False,
    govinfo_date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await asyncio.to_thread(integrity.run, corpus, title, not offline, govinfo_date)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
