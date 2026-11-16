"""FastAPI app: serves the federated CFR reader UI and mounts the domain routers.

Router registration order is a contract (pinned by the route_inventory snapshot
and the precedence tests): fixed-prefix routers (/api/titles, /api/settings,
/api/library, /api/search, /api/news) come before the parametrized
/api/{title} routers, or their paths would be captured as a title number and
422; the legacy un-prefixed Title 29 aliases come last.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import build, config, news_store, news_worker, store
from .routers import chat as chat_routes
from .routers import library as library_routes
from .routers import news as news_routes
from .routers import reader as reader_routes
from .routers import settings as settings_routes
from .routers.deps import NO_STORE
from .routers.news import news_router


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


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(config.STATIC_DIR / "index.html", headers=NO_STORE)


app.include_router(reader_routes.titles_router)
app.include_router(settings_routes.router)
app.include_router(library_routes.router)
app.include_router(reader_routes.search_router)
# /api/news/... MUST be registered before the /api/{title} routers, or
# /api/news/section/… would be captured by /api/{title}/section/… as a 422.
app.include_router(news_router)
app.include_router(reader_routes.title_router)
app.include_router(chat_routes.title_router)
app.include_router(reader_routes.legacy_router)
app.include_router(chat_routes.legacy_router)
