# Title 29 (Labor) CFR Reader & Claude AI Assistant

A fast, distraction-free web reader and AI research assistant for **Title 29 of the Code of Federal Regulations (Labor)**, covering OSHA safety standards, FLSA wage & hour rules, FMLA leave, ERISA pensions, and NLRB regulations.

Built locally with **FastAPI**, **SQLite FTS5**, clean responsive HTML/CSS/JS, and grounded **Claude API** streaming.

---

## Features

### 📖 Human-Readable Regulation Viewer
- **Proper CFR Hierarchy:** Automatically parses and cleanly indents legal structure: `(a)` &rarr; `(1)` &rarr; `(i)` &rarr; `(A)` with colored paragraph badges.
- **Smart Cross-References:** Internal CFR citations (e.g., `§ 541.100`, `§§ 1910.120 through 1910.126`) become instant, clickable links.
- **Responsive Layout:** Dark and Light mode (`◐`), adjustable font sizing (`A-` / `A+`), collapsible multi-level sidebar tree, and mobile navigation support.
- **Tables & Figures:** Clean formatting for government tables, footnotes, and diagrams.

### 🔍 Instant Full-Text Search
- **Local SQLite FTS5:** High-speed indexed search across all **7,374 sections and appendices** with zero latency.
- **Keyboard Shortcut:** Hit `/` anywhere in the app to search.
- **Direct Section Jump:** Type any section number (e.g., `1910.120` or `541.100`) to navigate straight to it.

### ✦ Claude AI Assistant (Anthropic API)
- **Context-Aware:** Automatically references whichever section is active on your screen.
- **Tool-Grounded Research:** Claude can invoke built-in tools (`search_regulations`, `read_section`, `list_part`) to verify citations and read related sections directly from the local database before answering.
- **Select-to-Ask:** Highlight any sentence or paragraph in a regulation to trigger a 1-click **"Explain"** or **"Ask about this"** prompt in the drawer.
- **Keyboard Shortcut:** Hit `Ctrl+K` or `Cmd+K` to toggle the assistant drawer.

---

## Quick Start

### 1. Requirements
- Python 3.10+
- (Optional) Anthropic API Key from [console.anthropic.com](https://console.anthropic.com) for Claude features. The reader and local search work fully offline without an API key.

### 2. Setup & Installation

If not already installed, activate the virtual environment and install dependencies:

```powershell
# From the project root
python -m venv .venv
.\.venv\Scripts\pip install fastapi "uvicorn[standard]" httpx anthropic python-dotenv
```

### 3. Configure Anthropic API (Optional)

Create a `.env` file in the `reader/` directory:

```powershell
cp reader/.env.example reader/.env
```

Edit `reader/.env`:
```env
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

*(Note: API usage is billed through Anthropic Console and requires API credits, separate from a Claude Pro/Max consumer subscription).*

### 4. Build or Update Database

To build or refresh the local SQLite database from the official eCFR API:

```powershell
cd reader
..\.venv\Scripts\python -m app.build
```
*Downloads the latest Title 29 release (~28 MB XML) and indexes all 7,300+ sections in ~5–10 seconds.*

### 5. Launch the Server

```powershell
cd reader
..\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open your browser to:
👉 **[http://127.0.0.1:8000](http://127.0.0.1:8000)**

- Interactive Swagger API Explorer: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Complete REST & Streaming API Reference: [`API.md`](API.md)

---

## Project Structure

```
FRAMEWORK/
├── docs/                      # Original GovInfo & eCFR metadata indexes
├── reader/                    # Title 29 Web Application
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py          # Environment, paths, and model defaults
│   │   ├── build.py           # eCFR API ingestion & SQLite FTS5 indexer
│   │   ├── render.py          # CFR XML-to-HTML parser with indentation & xrefs
│   │   ├── store.py           # SQLite query layer, FTS5 search
│   │   ├── chat.py            # Claude streaming, tool calling, system prompt
│   │   └── main.py            # FastAPI REST & SSE endpoints
│   ├── data/
│   │   ├── title29.sqlite3    # Local regulations database & full-text search
│   │   └── tree.json          # Navigation hierarchy tree
│   ├── static/
│   │   ├── index.html         # Application shell
│   │   ├── styles.css         # Typography, dark/light themes, layout
│   │   ├── app.js             # Client router, search, TOC, and chat UI
│   │   └── vendor/            # Offline vendor JS (marked, DOMPurify)
│   ├── .env.example           # Example configuration
│   └── README.md              # Reader documentation
└── README.md                  # Project root README
```

---

## Notable Parts in Title 29

- **Part 541:** Overtime exemptions (FLSA executive, administrative, professional).
- **Part 825:** Family and Medical Leave Act (FMLA).
- **Part 1904:** OSHA injury & illness recording and reporting.
- **Part 1910:** OSHA General Industry safety standards (PPE, HazCom, machinery).
- **Part 1926:** OSHA Construction safety standards (scaffolding, fall protection).
- **Part 2560:** ERISA rules governing employee benefit and retirement plans.

