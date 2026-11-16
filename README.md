# FRAMEWORK — CFR Reader & Research Assistant

A local web reader for the Code of Federal Regulations (any of the 50 titles) with instant full-text search and a Claude research assistant grounded in the installed text. Everything runs on your machine: regulations live in SQLite databases under `reader/data/`. The only network calls are the eCFR download when you install a title and, optionally, the Anthropic API for the assistant.

## What's here

- **`reader/`** — the application. FastAPI + SQLite FTS5 backend, vanilla JS frontend. See [reader/README.md](reader/README.md) to run it and [reader/API.md](reader/API.md) for the HTTP API.
- **`docs/plans/roadmap/`** — the *HSE Platform Roadmap*, a strategy document for where this could go (MCP server, hybrid RAG, policy linter, enterprise bots). None of it is implemented; it is not a description of the code. `phase-1_multi-title/` keeps the agent prompt and completion report from the multi-title work as a historical record.
- **`CLAUDE.md`** — detailed architecture notes for working on the code.

The generated GovInfo/eCFR URL inventories (`docs/dev/`, `docs/title-29/`, `docs/title-29-api/`) are gitignored and not part of the repository; the reader never reads them.

## Quick start

Requires **Python 3.10 or newer**.

macOS / Linux:

```bash
python3 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" httpx anthropic python-dotenv pytest
cd reader
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Windows / PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\pip install fastapi "uvicorn[standard]" httpx anthropic python-dotenv pytest
cd reader
..\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open **http://127.0.0.1:8000**. On first start with no titles installed, the server downloads and indexes Title 29 (Labor) from eCFR (~28 MB of XML). Install more titles, parts or single sections from inside the app (Overview → Installed titles → Download) or from the CLI with `python -m app.build --title 40`.

The Claude assistant is optional. Copy `reader/.env.example` to `reader/.env` and add an `ANTHROPIC_API_KEY` to enable it; reading and search work without one.
