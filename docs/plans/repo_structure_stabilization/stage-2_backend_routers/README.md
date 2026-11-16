# Stage 2: FastAPI Route Decoupling (`main.py`)

## Goal
Split `reader/app/main.py` (453 lines) into domain `APIRouter` modules following the `news_api.py` precedent, isolating shared dependencies while preserving module-level monkeypatch compatibility and exact route precedence.

## Branch & Tag Discipline
- Branch `stage-2-backend-routers` from `stage-1-passed`; merge via PR after gate passes and tag `stage-2-passed`.

## Target Layout
```
reader/app/
├── main.py                  # App init, GZipMiddleware, RevalidatedStaticFiles, lifespan, router mounting
└── routers/
    ├── __init__.py
    ├── deps.py              # Shared valid_installed_title, require_key, NO_STORE, STREAM_HEADERS, Chat models
    ├── settings.py          # /api/settings/env
    ├── library.py           # /api/library/...
    ├── news.py              # Relocated from news_api.py
    ├── reader.py            # /api/titles, title_router (/api/{title}/...), legacy /api/... aliases, /api/search
    └── chat.py              # Global /api/models, /api/chat + title-scoped /api/{title}/models, /api/{title}/chat
```

## Critical Implementation Constraints
1. **Module-Only Import Rule (Test Patch Safety)**:
   - Tests patch `config.installed_titles`, `library.queue`, `library.installed`, `chat.list_models`, etc. directly on the imported modules.
   - Every router and `routers/deps.py` **MUST** import whole modules (`from .. import build, chat, config, library, news_store, news_worker, store`), **NEVER** individual symbols (`from ..config import installed_titles`), so test patches remain active across all route handlers.
2. **Shared Dependencies (`routers/deps.py`)**:
   - Place `valid_installed_title`, `require_key`, `NO_STORE`, `STREAM_HEADERS`, `ChatMessage`, and `ChatRequest` in `routers/deps.py` so routers never cross-import each other or `main.py`.
3. **Global Router Registration Order**:
   - Fixed-prefix routers (`settings`, `library`, `news`) **MUST** be mounted before `title_router` (`prefix="/api/{title}"`), otherwise FastAPI captures fixed prefixes as `{title}` and returns HTTP 422.
4. **Internal Route Order in `routers/library.py`**:
   - Fixed paths (`/jobs`, `/jobs/clear`, `/storage`, `/storage/prune`, `/wire`, `/batch-download`, `/update-all`, `/download`) **MUST** precede `/{title}` and `/{title}/part/{part}`.
5. **Title-Scoped Chat Endpoints**:
   - Preserve both global `/api/models`, `/api/chat` and title-scoped `/api/{title}/models`, `/api/{title}/chat`.
6. **Route-Precedence & Snapshot Verification**:
   - Add precedence tests in `test_api_endpoints.py` for `/api/settings/env`, `/api/library/jobs`, `/api/library/storage`, and `/api/news/status`.
   - Update `CLAUDE.md` backend layout at stage completion.

## Exit Gate
- All Python tests (under `pytest` and `unittest discover`), Stage 1 API/SSE snapshots, and CI (`REQUIRE_BROWSER=1`) pass.
