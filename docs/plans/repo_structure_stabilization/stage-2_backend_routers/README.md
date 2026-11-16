# Stage 2: FastAPI Route Decoupling (`main.py`)

## Goal
Break `reader/app/main.py` (453 lines) into domain-focused `APIRouter` modules matching the existing `news_api.py` precedent, leaving `main.py` strictly for FastAPI app configuration, lifespan management, and router mounting.

## Target Layout
```
reader/app/
├── main.py                  # App init, GZip, StaticFiles, lifespan, include_router calls
└── routers/
    ├── __init__.py
    ├── settings.py          # /api/settings/env
    ├── library.py           # /api/library/...
    ├── news.py              # Relocated from news_api.py
    ├── reader.py            # /api/titles, /api/{title}/..., legacy /api/... aliases, /api/search
    └── chat.py              # /api/models, /api/chat + title-scoped /api/{title}/models, /api/{title}/chat
```

## Critical Implementation Constraints
1. **Global Router Registration Order**:
   - Fixed-prefix routers (`settings`, `library`, `news`) **MUST** be included before `title_router` (`prefix="/api/{title}"`). Otherwise FastAPI captures `/api/news/...` or `/api/library/...` as an invalid integer `{title}` and returns HTTP 422.
2. **Internal Ordering in `routers/library.py`**:
   - Fixed paths (`/jobs`, `/jobs/clear`, `/storage`, `/storage/prune`, `/wire`, `/batch-download`, `/update-all`, `/download`) **MUST** be registered before `/{title}` and `/{title}/part/{part}` to avoid 422 path-parsing errors.
3. **Title-Scoped Chat Routes**:
   - Explicitly preserve both global `/api/models`, `/api/chat` and title-scoped `/api/{title}/models`, `/api/{title}/chat` (via `title_router` or `chat.title_router`).
4. **Route Precedence Tests**:
   - Extend `test_api_endpoints.py` to verify route precedence for `/api/settings/env`, `/api/library/jobs`, `/api/library/storage`, and `/api/news/status` so fixed prefixes never collide with `/{title}`.

## Exit Gate
- Full pytest suite passes with zero regressions.
- Stage 1 API JSON snapshots match 100%.
