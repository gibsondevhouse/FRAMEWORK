# FRAMEWORK — A Regulatory Workstation

**FRAMEWORK** is a calm, local-first workstation for reading, searching, and organizing the **Code of Federal Regulations**. Whether you're checking a single OSHA standard, cross-referencing environmental rules across Title 40 and Title 49, or putting together a compliance dossier for an audit, everything runs right on your own computer—fast, private, and free of clutter.

Under the hood, it pairs a **FastAPI** and **SQLite FTS5** backend with a lightweight vanilla JavaScript interface. Official eCFR XML is parsed into clean, readable legal typography with zero external frameworks getting in the way.

---

## What's inside

### Comfortable reading
- **Three ways to view a regulation.** Long sections open **clause by clause** (one lettered paragraph or appendix chapter at a time, with a quiet navigation rail in the margin so you don't lose your place). Need the whole picture? Switch to **See full section** or **See full part** to view everything on one page. Short sections open as a single page automatically.
- **True-to-life legal structure.** Paragraph levels `(a)` → `(1)` → `(i)` → `(A)` are properly nested and indented. Tables, footnotes, figures, and embedded appendices render right where they belong.
- **Automatic citation links.** References like `§ 541.100`, `§§ 1910.120 through 1910.126`, `541.100(a)(1)`, and cross-title citations like `40 CFR 261.3` turn into clickable links—jumping straight to the section if you have that title installed, or opening eCFR if you don't.
- **Themes & comfort.** Dark mode is the default for long reading sessions, with a light mode toggle and adjustable text size whenever you want it.

### Instant local search
- **Milliseconds, not seconds.** Local SQLite FTS5 full-text search with BM25 ranking lets you search across one title or all of your installed titles at once.
- **Direct section jump.** Type a section number like `1910.134` into the search bar to hop straight to it.
- **Command mode.** Type `>` in the search box to quickly jump between views, open panels, switch themes, or open a project dossier.

### Sliding rail & workspace
- **Dual-track navigation.** A slim 48px activity rail along the edge gives you one-click access to **Overview**, **Title Home**, **Contents**, **Projects**, **Library**, and **Settings**.
- **Pinned or flyout drawer.** Keep the secondary drawer pinned beside your reading, or switch it to flyout mode so it slides over the page only when you need it.
- **Drill-down Table of Contents.** Browse by agency → part → section (with foldable subparts) or switch to a flat list of every part, with an instant filter box at the top.
- **Overview & Recent history.** See your most-visited titles, parts, and sections, plus a timeline of what you've read recently. Usage stats stay strictly in your browser.

### Project Dossiers
- **Collect what matters.** Pin any section to a **Project Dossier** using the **Pin** button or `Ctrl/Cmd+D`.
- **Add your own context.** Give dossiers a name, description, and color-coded tags, and attach personal notes to each pinned section.
- **Portable by default.** Dossiers live in your browser's `localStorage` and can be exported or imported as JSON files anytime for backups or sharing.

### The Library & Transfer Dock
- **Newsroom-style catalog.** Browse all 50 CFR titles organized by topic desk, see what's installed or outdated at a glance, and check the **Regulatory Wire** to see which titles were amended most recently.
- **Curated Compliance Suites.** Install related titles together in one click—such as *Environment, Health & Safety* (Titles 29, 40, 49), *Trade & Commerce*, or *Government Contracting*.
- **Granular installs.** Download an entire title, a single part, or just one section or appendix. You can always expand a partial install later, or hit **Update all** to bring everything up to the latest eCFR edition.
- **Floating Transfer Dock.** Downloads run in a background queue with a compact floating progress card in the corner—showing pipeline stages, download speed, and time remaining—so you can keep reading while titles install.
- **Storage cleanup.** Check how much disk space each title uses and clear out leftover temporary files right from **Settings**.

### OSHA News (sanctioned APIs only)
- **A newsroom for Title 29.** The **News** rail item (`#/news`, `G N`) shows OSHA **Final Rules**, **Proposed Rules**, **Notices**, and **Public Inspection** filings from the official **Federal Register API** — no credentials needed — plus **Enforcement & Penalties** from the **DOL Open Data API** when you add a free `DOL_API_KEY`.
- **Facts, not summaries.** Every card carries three fixed bullets (*Action*, *CFR*, *Dates* — or *Incident*, *Standards*, *Penalty* for enforcement) built directly from the record's own fields. No language model writes or summarises anything.
- **Linked into the reader.** CFR citations on cards are chips straight into your installed titles, and Title 29 section and part pages grow an activity button ("3 rules & citations") with a timeline of related rulemaking and enforcement.
- **Search & facets inside News.** The filter box finds items by keyword, company, `§ 1910.1030` or `91 FR 55744`; the Enforcement tab can be narrowed by state, penalty and gravity.
- **Polite syncing.** A background worker fetches each source only after its publication window (FR by 06:15 ET, Public Inspection three times a day, DOL daily), identifies itself honestly, and never scrapes osha.gov. The page paints instantly from a local cache and quietly revalidates.

### Optional Claude assistant
- **Grounded in your local text.** When enabled, Claude uses local tools (`search_regulations`, `read_section`, `list_part`) to look up the actual regulations on your machine before answering—and it knows which section you currently have open.
- **Select to ask.** Highlight any text in a regulation to pop up a one-click **"Ask about this"** prompt.
- **Completely optional.** Everything else in FRAMEWORK works offline without an API key.

---

## Keyboard shortcuts

| Shortcut | What it does |
| :--- | :--- |
| `/` or `Ctrl/Cmd+K` | Focus the search bar (type `>` for commands) |
| `Ctrl/Cmd+B` | Show or hide the sliding drawer |
| `Ctrl/Cmd+D` | Pin the current section to a project dossier |
| `Ctrl/Cmd+J` or `Ctrl/Cmd+Shift+K` | Open or close the Claude assistant |
| `G` then `O` / `H` / `C` / `P` / `N` / `L` / `S` | Jump to Overview, Title Home, Contents, Projects, News, Library, or Settings |
| `Alt+1` through `Alt+7` | Same quick jump to each rail item |
| `Esc` | Close a floating drawer or popover |

---

## Getting started

### 1. What you'll need
- **Python 3.10 or newer** (the code uses `X | None` type annotations).
- **Optional:** An Anthropic API key from [console.anthropic.com](https://console.anthropic.com) if you want to use the Claude assistant.

### 2. Install dependencies

From the repository root:

```bash
# macOS / Linux
python3 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" httpx anthropic python-dotenv pytest tzdata
```

```powershell
# Windows / PowerShell
python -m venv .venv
.\.venv\Scripts\pip install fastapi "uvicorn[standard]" httpx anthropic python-dotenv pytest tzdata
```

*(On macOS, you can also just double-click `Start FRAMEWORK.command` in the repo root to handle setup and launch automatically.)*

### 3. Configure the assistant (optional)

```bash
cp reader/.env.example reader/.env
```

Open `reader/.env` and add your key:

```env
ANTHROPIC_API_KEY=sk-ant-...
# Optional preferred model. If unset or unavailable to your key, FRAMEWORK picks
# the first sonnet/opus/haiku model your key can access.
ANTHROPIC_MODEL=
```

*(Note: Anthropic API usage is billed through the Anthropic Console and is separate from a Claude consumer subscription.)*

The same `.env` also configures OSHA News — all optional: `DOL_API_KEY` (free, from [dataportal.dol.gov/registration](https://dataportal.dol.gov/registration)) switches on the Enforcement tab; `NEWS_SYNC=0` turns the background news sync off; `NEWS_RETENTION_DAYS` (default 365) sets how much history is kept.

### 4. Start the workstation

Run commands from inside `reader/` (since the backend package is `app`). On Windows, use `..\.venv\Scripts\python` instead of `../.venv/bin/python`.

```bash
cd reader
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open **http://127.0.0.1:8000** in your browser. If no titles are installed yet, the server will automatically download and index **Title 29 (Labor)** on first startup (~28 MB of XML, usually under a minute).

- Interactive API docs: http://127.0.0.1:8000/docs
- Full HTTP & streaming reference: [`API.md`](API.md)

### 5. Managing titles from the CLI (optional)

You can install or refresh titles from the terminal if you prefer:

```bash
cd reader
../.venv/bin/python -m app.build                    # Download Title 29 if missing
../.venv/bin/python -m app.build --title 40         # Install another title
../.venv/bin/python -m app.build --force            # Re-download the latest edition
../.venv/bin/python -m app.build --title 29 --renest  # Fix subpart nesting in place (no download)
```

Note that a CLI build isn't picked up by an already-running server until you restart it. Downloads started inside the app's **Library** take effect right away.

### 6. Running the tests

From `reader/` (or from the repo root with `PYTHONPATH=reader`):

```bash
cd reader
../.venv/bin/python -m pytest tests -q
```

The test suite is completely self-contained—it builds tiny offline fake titles in a temporary folder with network calls mocked, so it runs cleanly on a fresh clone with nothing downloaded.

---

## Project structure

```
FRAMEWORK/
├── CLAUDE.md                  # Detailed technical notes for working on the code
├── README.md                  # Top-level overview
├── Start FRAMEWORK.command    # One-click macOS launcher
├── docs/plans/                # Design plans and future roadmaps
└── reader/
    ├── app/
    │   ├── config.py          # Paths, .env loading, installed-title discovery
    │   ├── build.py           # eCFR download, streaming XML ingest, SQLite FTS5 indexer
    │   ├── library.py         # eCFR catalog, suites, wire feed, download queue, storage
    │   ├── store.py           # Per-title SQLite connections, caches, federated search
    │   ├── render.py          # XML → HTML, paragraph indentation, linkifier, reading units
    │   ├── news.py            # Federal Register + DOL fetchers, citations, takeaway bullets
    │   ├── news_store.py      # osha_news.sqlite3: articles, citations, FTS5, sync status
    │   ├── news_schedule.py   # Publication windows, staleness, backoff (pure functions)
    │   ├── news_worker.py     # Schedule-gated background sync thread
    │   ├── news_api.py        # /api/news… router (registered before /api/{title})
    │   ├── chat.py            # Claude streaming tool-use loop
    │   ├── main.py            # FastAPI routes (title-scoped + legacy Title 29 aliases)
    │   └── title_blurbs.json  # Editorial summaries, desks, agencies, and size estimates
    ├── data/                  # title-{N}.sqlite3 + tree-{N}.json per title (gitignored)
    ├── static/
    │   ├── index.html         # App shell, activity rail, drawer, and transfer dock
    │   ├── styles.css         # Design tokens, dark/light themes, layout & animations
    │   ├── app.js             # Router, rail/drawer, reader, projects, library, search, chat
    │   └── vendor/            # marked, DOMPurify (bundled for offline use)
    ├── tests/                 # Self-contained unit & integration tests
    ├── .env.example
    ├── API.md
    └── README.md
```
