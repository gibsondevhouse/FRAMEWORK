# Stage 2: FastAPI Route Decoupling (`main.py`)

## Goal
Split `reader/app/main.py` (453 lines) into domain `APIRouter` modules following the `news_api.py` precedent, isolating shared FastAPI dependencies and locking route precedence.

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
1. **Shared Dependencies (`routers/deps.py`)**:
   - Place `valid_installed_title`, `require_key`, `NO_STORE`, `STREAM_HEADERS`, `ChatMessage`, and `ChatRequest` in `routers/deps.py` so routers never import from each other or from `main.py`.
2. **Global Router Registration Order**:
   - Fixed-prefix routers (`settings`, `library`, `news`) **MUST** be mounted before `title_router` (`prefix="/api/{title}"`), otherwise FastAPI captures `/api/news/...` or `/api/library/...` as `{title}` and returns HTTP 422.
3. **Internal Route Order in `routers/library.py`**:
   - Fixed paths (`/jobs`, `/jobs/clear`, `/storage`, `/storage/prune`, `/wire`, `/batch-download`, `/update-all`, `/download`) **MUST** be registered before `/{title}` and `/{title}/part/{part}`.
4. **Title-Scoped Chat Endpoints**:
   - Preserve both global `/api/models`, `/api/chat` and title-scoped `/api/{title}/models`, `/api/{title}/chat` (via `title_router` or a dedicated `chat.title_router`).
5. **Route-Precedence Tests**:
   - Extend `test_api_endpoints.py` to test precedence for `/api/settings/env`, `/api/library/jobs`, `/api/library/storage`, and `/api/news/status`.
6. **Docs Sync**:
   - Update `CLAUDE.md` backend file layout immediately upon stage completion.

## Exit Gate
- All Python tests pass.
- Stage 1 API JSON snapshots (including POST/DELETE and error responses) match 100%.
