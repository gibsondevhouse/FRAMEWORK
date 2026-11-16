# FRAMEWORK — CFR Reader & Claude Assistant

A fast, distraction-free reader and AI research assistant for the **Code of Federal Regulations**. Install any CFR title (29 Labor, 40 Environment, 49 Transportation, …), or just the parts and sections you need, and read, search and ask questions across all of them.

Built with **FastAPI**, **SQLite FTS5** and a single-file vanilla JS frontend. Regulation text is parsed from the official eCFR XML into clean, indented legal typography.

---

## Features

### Reading
- **Three ways to read a section.** Long sections open **clause by clause** (one lettered paragraph or appendix chapter at a time, with a navigation rail in the margin); **See full section** shows all of it; **See full part** renders every section of a part on one page. Short sections are a single page.
- **Proper CFR hierarchy.** Paragraph levels `(a)` → `(1)` → `(i)` → `(A)` are inferred and indented; tables, footnotes, figures and embedded appendices render in place.
- **Cross-references become links.** `§ 541.100`, `§§ 1910.120 through 1910.126`, `541.100(a)(1)` and cross-title citations like `40 CFR 261.3` link within the reader when the target is installed, or to eCFR when it isn't.
- **Drill-down sidebar.** Agencies → parts → sections (grouped by subpart), or a flat list of every part, with a filter box.
- **Overview page.** Most visited titles, parts and sections, recently read, and the installed-titles table with download controls. Usage is stored in the browser only.
- Dark (default) and light themes, adjustable reading size.

### Search
- **Local SQLite FTS5** full-text search with BM25 ranking across one title or all installed titles; typing a section number jumps straight to it.
- **Keyboard:** `/` or `Ctrl/Cmd+K` focuses search.

### Claude assistant (optional)
- **Grounded research.** Claude answers through local tools (`search_regulations`, `read_section`, `list_part`) and cites what it read; it sees the section you have open.
- **Select to ask.** Highlight text in a regulation for a one-click "Ask about this" prompt.
- **Keyboard:** `Ctrl/Cmd+J` (or `Ctrl/Cmd+Shift+K`) toggles the assistant drawer. The model is chosen in the drawer from the models your key can access.

### Library
- Download whole titles, single parts, or single sections/appendices from eCFR inside the app (Overview → Installed titles → Download). Partial installs can be extended later; downloads run in a background queue with progress.

---

## Quick start

### 1. Requirements
- **Python 3.10+** (the code uses `X | None` annotations).
- Optional: an Anthropic API key from [console.anthropic.com](https://console.anthropic.com) for the assistant. The reader and search work fully offline without one.

### 2. Install

From the repository root:

```bash
# macOS / Linux
python3 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" httpx anthropic python-dotenv pytest
```

```powershell
# Windows / PowerShell
python -m venv .venv
.\.venv\Scripts\pip install fastapi "uvicorn[standard]" httpx anthropic python-dotenv pytest
```

### 3. Configure the assistant (optional)

```bash
cp reader/.env.example reader/.env
```

Edit `reader/.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
# Optional preferred model. If unset or unavailable to your key, the first
# sonnet/opus/haiku model your key can see is used.
ANTHROPIC_MODEL=
```

API usage is billed through the Anthropic Console and is separate from a Claude consumer subscription.

### 4. Run

All commands run from `reader/` (the backend is the package `app`). Use `..\.venv\Scripts\python` on Windows in place of `../.venv/bin/python`.

```bash
cd reader
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open **http://127.0.0.1:8000**. If no title is installed, the server downloads and indexes Title 29 on first start (~28 MB of XML, under a minute).

- Interactive API explorer: http://127.0.0.1:8000/docs
- REST and streaming API reference: [`API.md`](API.md)

### 5. Build titles from the CLI

```bash
../.venv/bin/python -m app.build                    # Title 29, only if missing
../.venv/bin/python -m app.build --title 40         # install another title
../.venv/bin/python -m app.build --force            # re-download the latest edition
../.venv/bin/python -m app.build --title 29 --renest  # fix subpart nesting in place, no download
```

A CLI build is not seen by a running server until it restarts. Downloads made inside the app take effect immediately.

### 6. Tests

```bash
../.venv/bin/python -m pytest tests -q
```

The suite is self-contained: it builds tiny fake titles into a temporary directory with the eCFR network mocked, so it runs on a fresh clone with nothing downloaded.

---

## Project structure

```
FRAMEWORK/
├── CLAUDE.md                  # Architecture notes (the detailed description of the code)
├── README.md
├── docs/plans/roadmap/        # Strategy document, not implemented
└── reader/
    ├── app/
    │   ├── config.py          # Paths, .env, installed-title discovery
    │   ├── build.py           # eCFR download, iterparse XML ingest, SQLite FTS5 indexer
    │   ├── library.py         # Browse eCFR; download titles/parts/sections; job queue
    │   ├── store.py           # Per-title SQLite connections, caches, search
    │   ├── render.py          # XML → HTML, paragraph levels, linkifier, reading units
    │   ├── chat.py            # Claude streaming tool-use loop
    │   └── main.py            # FastAPI routes (title-scoped + legacy Title 29 aliases)
    ├── data/                  # title-{N}.sqlite3 + tree-{N}.json per title (gitignored)
    ├── static/
    │   ├── index.html
    │   ├── styles.css         # Design tokens, dark/light themes
    │   ├── app.js             # Router, sidebar, reader, search, library, chat UI
    │   └── vendor/            # marked, DOMPurify (offline)
    ├── tests/
    ├── .env.example
    ├── API.md
    └── README.md
```
