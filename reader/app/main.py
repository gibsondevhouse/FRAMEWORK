"""FastAPI app: serves the federated CFR reader UI and mounts the domain routers.

Router registration order is a contract (pinned by the route_inventory snapshot
and the precedence tests): fixed-prefix routers (/api/titles, /api/settings,
/api/library, /api/search, /api/news) come before the parametrized
/api/{title} routers, or their paths would be captured as a title number and
422; the legacy un-prefixed Title 29 aliases come last.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from . import config, library, news_store, news_worker, security, store
from .routers import chat as chat_routes
from .routers import corpora as corpora_routes
from .routers import fr as fr_routes
from .routers import integrity as integrity_routes
from .routers import library as library_routes
from .routers import news as news_routes
from .routers import reader as reader_routes
from .routers import settings as settings_routes
from .routers import sources as sources_routes
from .routers import usc as usc_routes
from .routers.deps import NO_STORE
from .routers.news import news_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Starts empty on a fresh install: the frontend shows the first-run profile picker when
    # `/api/titles` is empty, and downloads queue through `/api/library/download`.
    # (`python -m app.build` still builds a title from the CLI.)
    store.reset_connections()
    try:
        library.prune_temp()
    except RuntimeError:
        pass
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

    def file_response(self, full_path, stat_result, scope, status_code=200):
        if str(full_path).lower().endswith(".html") and status_code == 200:
            # A page: its bytes and its content security policy come from one read.
            response = security.page_response(scope, Path(full_path))
        else:
            response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers["Cache-Control"] = "no-cache"
        return response


app = FastAPI(title="FRAMEWORK: CFR Reader & Assistant", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)
# Every response carries the browser security headers (content security policy, nosniff, no
# framing, referrer policy); the guard below adds them to its own refusals.
app.add_middleware(security.SecurityHeadersMiddleware)
# The standalone U.S.C. page (/usc/{t}/{s}) is the one server-rendered page with a <style>
# block of its own; the policy allows exactly that block, by hash.
security.allow_inline_style(usc_routes._PAGE_CSS)
# Added last so it runs first: a foreign Host or a cross-origin call is refused before any
# route, the static mount or compression sees it (see app/security.py).
app.add_middleware(security.LocalTrustMiddleware)
app.mount("/static", RevalidatedStaticFiles(directory=config.STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index(request: Request) -> Response:
    # One read gives both the page and the policy that allows its inline script.
    return security.page_response(request.scope, config.STATIC_DIR / "dist" / "index.html", NO_STORE)


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    return {"status": "ok", "installed_titles": config.installed_titles()}


app.include_router(reader_routes.titles_router)
app.include_router(settings_routes.router)
app.include_router(library_routes.router)
app.include_router(reader_routes.search_router)
# /api/news/... MUST be registered before the /api/{title} routers, or
# /api/news/section/… would be captured by /api/{title}/section/… as a 422.
app.include_router(news_router)
# Same reason: /api/fr/... before /api/{title}.
app.include_router(fr_routes.fr_router)
app.include_router(usc_routes.usc_router)
app.include_router(usc_routes.usc_page_router)
app.include_router(integrity_routes.integrity_router)
app.include_router(sources_routes.sources_router)
app.include_router(corpora_routes.corpora_router)
app.include_router(reader_routes.title_router)
app.include_router(chat_routes.title_router)
app.include_router(reader_routes.legacy_router)
app.include_router(chat_routes.legacy_router)
