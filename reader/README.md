# FRAMEWORK — Federal Codes & Laws Platform

**FRAMEWORK** is a calm, local-first, **federal-only** platform for reading, searching, and staying up to date on federal codes and laws across federal frameworks — including the **U.S. Constitution**, the **United States Code (U.S.C.)**, **Public Laws**, the **Code of Federal Regulations (CFR)**, the **Federal Register**, and the **Unified Agenda**. Everything runs locally on your computer—fast, private, and free of clutter. *(State-law coverage and HSE-specific suites are out of scope.)*

Under the hood, it pairs a **FastAPI** and **SQLite FTS5** backend with a strict TypeScript frontend bundled via Vite. Official federal XML and JSON feeds render into clean, readable legal typography with zero heavy runtime frameworks getting in the way.

---

## What's inside

### Comfortable reading
- **Three ways to view a regulation.** Long sections open **clause by clause** (one lettered paragraph or appendix chapter at a time, with a quiet navigation rail in the margin so you don't lose your place). Need the whole picture? Switch to **See full section** or **See full part** to view everything on one page. Short sections open as a single page automatically.
- **True-to-life legal structure.** Paragraph levels `(a)` → `(1)` → `(i)` → `(A)` are properly nested and indented. Tables, footnotes, figures, and embedded appendices render right where they belong.
- **Automatic citation links.** References like `§ 541.100`, `§§ 1910.120 through 1910.126`, `541.100(a)(1)`, and cross-title citations like `40 CFR 261.3` turn into clickable links—jumping straight to the section if you have that title installed, or opening eCFR if you don't.
- **Obsidian dark typography & comfort.** Locked to a high-contrast obsidian dark editorial palette with adjustable text size and No/Less/Full motion preferences (while `@media print` renders clean black-on-white paper output). Figures open in a lightbox with an invert-contrast toggle for white Federal Register drawings in dark mode.

### Citations that do the legwork
- **Peek before you jump.** Hover a cross-reference, footnote number, table or figure mention and the cited text appears in a small preview card. Nothing navigates until you ask it to.
- **Read side-by-side.** Alt/⌥-click any section link (or press **Open side-by-side** in a peek) to open it in a second pane next to what you're reading. Step through its clauses there, or promote it to the main view.
- **Download what you're missing.** A citation into a title you haven't installed opens a small card offering to fetch just that section, the whole part, or the whole title; the link turns local the moment the download lands.
- **See who cites a section.** Every section header shows **Cited by N** with a searchable list of the sections that reference it, and consensus standards mentioned in the text (ANSI, NFPA, ASTM, …) resolve to the title's incorporation-by-reference catalog.
- **References & Authorities.** Each title's start page is a broadsheet front page with a resume bar, key parts, and an almanac of every standards body, federal portal and agency the title cites — with the sections that cite them and a flag on retired URLs that points to the modern replacement.
- **Copy cite / Clip.** Hover a clause to copy a formal citation (`29 C.F.R. § 1910.134(c)(1)(ii)`) or clip the clause into a workspace. The reader also remembers, per part, whether you prefer clause-by-clause or full-section reading.

### Instant local search
- **Milliseconds, not seconds.** Local SQLite FTS5 full-text search with BM25 ranking lets you search across one title or all of your installed titles at once.
- **Direct section jump.** Type a section number like `1910.134` into the search bar to hop straight to it.
- **Command mode.** Type `>` in the search box to quickly jump between views, open panels, switch themes, or open a workspace.

### Two-layer sidebar & navigation
- **Primary app sidebar + contextual framework drawer.** On main pages (**Home**, **Workspaces**, **Newsroom**, **Library**, **Settings**, **API & Sources**), the primary sidebar gives direct labeled navigation and quick jumps to frameworks. Inside any legal framework, it compacts into an icon rail and opens the contextual secondary framework drawer beside your reading.
- **Pinned or flyout drawer.** Keep the secondary framework drawer pinned beside your reading, or switch it to flyout mode so it slides over the page only when you need it.
- **Drill-down Table of Contents.** Browse by agency → part → section (with foldable subparts) or switch to a flat list of every part, with an instant filter box at the top.
- **Home & Updates Radar.** Home shows your federal framework overview, edition staleness and Federal Register sync radar, continue reading with recent history, and active workspaces. Usage stats stay strictly in your browser.

### Workspaces
- **Collect what matters.** Pin any section to a **Workspace** using the **Pin** button or `Ctrl/Cmd+D`, or clip a single clause from its hover pill or from selected text.
- **Add your own context.** Give workspaces a name, description, and color-coded tags, and attach personal notes to each pinned section.
- **Portable by default.** Workspaces live in your browser's `localStorage` and can be exported or imported as JSON files anytime for backups or sharing.

### The Library & Transfer Dock
- **The Constitution, the laws and two codes, one library.** The Library has five tabs: **Overview** (what's installed, what needs updating, and the bundles), **Constitution** (one Download button, then every article section and amendment), **U.S. Code** (all 54 titles by topic, with the CFR titles each one authorizes, plus the four appendix titles 5a, 11a, 18a and 28a in their own **Appendices** group), **Public Laws** (one tile per Congress since 2013, then that Congress's laws) and **CFR**. The Federal Register stays in the Newsroom.
- **Read the Constitution.** Each section of an article and each amendment opens in the reader with a plain-English heading ("Powers of Congress"), its numbered clauses split out (click a clause number to copy `U.S. Const. art. I, § 8, cl. 3`), **Cite**, **Pin** to a workspace, and the House Parliamentarian's annotations below the text. Home shows it beside the U.S. Code, CFR and Federal Register.
- **Read Public Laws.** Download the current Congress or every Congress since 2013 (about 32 MB each), or add one Congress at a time from its tile. A law opens a section at a time (SEC. 1, SEC. 2 …, with **See full law**), with **Cite**, its Statutes at Large page and bill, GPO's margin notes, and **Where it went in the U.S. Code**: the sections it was placed at, added as notes to, or amends. Each U.S. Code section has an **Enacted by N** button listing those laws.
- **The Unified Agenda.** The Newsroom's last tab is what agencies plan to do: one Download button (the last two years of editions from reginfo.gov, about 22 MB), then the newest edition's planned rules with an edition picker, an agency picker, stage buttons (Prerule, Proposed rule, Final rule, Long-term, Completed) and a filter box that also takes a RIN. A rule's page (`#/news/agenda/1218-AD39`) shows its stage, priority and status, the abstract, the CFR parts and legal authority as links into the readers, its timetable (Federal Register citations link to the document when it's in your archive), the Federal Register documents it became, and the editions it appeared in.
- **Newsroom-style catalog.** Browse all 50 CFR titles organized by topic desk, see what's installed or outdated at a glance, and check the **Regulatory Wire** to see which titles were amended most recently.
- **Read the U.S. Code like the CFR.** An installed U.S. Code title opens in the same reader as the regulations: the same layout and text size, numbered paragraphs indented by level, hover **Cite** (copies `29 U.S.C. § 655(b)(1)`) and **Clip**, **Pin** to a workspace, and the statutory and editorial notes kept below the text.
- **Curated bundles.** Install related titles together in one click, statutes included—such as *Environment, Health & Safety* (CFR Titles 29, 40, 49 plus 29, 42 and 49 U.S.C.), *Trade & Commerce*, or *Government Contracting*.
- **Granular installs.** Download an entire title, a single part, or just one section or appendix. You can always expand a partial install later, or hit **Update all** to bring everything up to the latest eCFR edition.
- **Floating Transfer Dock.** Downloads run in a background queue with a compact floating progress card in the corner—showing pipeline stages, download speed, and time remaining—so you can keep reading while titles install.
- **Data sources checklist.** **Settings → Data sources** lists every federal source (Constitution, U.S. Code, Public Laws, CFR, Federal Register archive, Unified Agenda, Newsroom, and optional DOL enforcement) as plain checkboxes: switch each on or off, choose how often it updates, and tick exactly which titles, Congresses, agencies, stages, or document types to collect. Start from a template (Recommended, Everything, Minimal, or a desk/bundle), save your own, and share templates as a file. Nothing downloads until you review and apply the exact plan on screen, and unticking keeps your data unless you choose to remove it.
- **Storage cleanup.** Check how much disk space each title uses and clear out leftover temporary files right from **Settings**.

### Federal Register Newsroom (sanctioned APIs only)
- **A newsroom for federal rulemaking.** The **News** view (`#/news`, `G N`) tracks Federal Register **Final Rules**, **Proposed Rules**, **Notices**, and **Public Inspection** filings from the official **Federal Register API** — no credentials needed — plus optional OSHA **Enforcement & Penalties** from the **DOL Open Data API** when a free `DOL_API_KEY` is configured.
- **Facts, not summaries.** Every card carries three fixed bullets (*Action*, *CFR*, *Dates* — or *Incident*, *Standards*, *Penalty* for enforcement) built directly from the record's own fields. No language model writes or summarises anything.
- **Linked into the reader.** CFR citations on cards are chips straight into your installed titles, and section and part pages of every installed title grow an activity button ("3 rules & citations") with a timeline of related rulemaking and enforcement.
- **Every title you install, every agency you follow.** The Federal Register sync covers each agency in `NEWS_AGENCIES` (OSHA by default) plus the CFR titles you have installed, so installing Title 40 or 49 brings in the rules and notices that amend them.
- **Read Federal Register documents in the app.** Opening a final rule, proposed rule or notice (from a News card or the activity timeline) shows its full preamble at `#/news/fr/{document_number}` with the dates, docket and CFR chips up top, and its citations link into your installed titles. The text is fetched only when you open the document, cleaned up, and kept locally; if the Federal Register offers no inline text you get a link to it instead.
- **Inspection case files.** Each enforcement item opens an in-app case file instead of a CAPTCHA-guarded osha.gov page: establishment facts, every violation with its standard decoded to the exact CFR paragraph, the citation history (contested, modified, final order), General Duty Clause narratives and accident abstracts, with a one-click **Enrich from DOL** when the local cache is thin. The Enforcement tab opens with a four-card briefing of totals, gravity mix, most-cited sections and states.
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
| `Ctrl/Cmd+D` | Pin the current section to a workspace |
| `Ctrl/Cmd+J` or `Ctrl/Cmd+Shift+K` | Open or close the Claude assistant |
| `G` then `H` / `T` / `C` / `P` / `N` / `L` / `S` | Jump to Home, Title start, Contents, Workspaces, News, Library, or Settings (`G O` also goes Home) |
| `Alt+1` through `Alt+7` | Same quick jump to each rail item |
| `Alt/⌥ + click` a section link | Open it side-by-side instead of navigating |
| `Esc` | Close a floating drawer, popover, or the split pane |

---

## Getting started

### 1. What you'll need
- **Python 3.10 or newer** (the code uses `X | None` type annotations). No Node.js is needed to run the app: the frontend ships pre-built in `reader/static/dist/` with self-hosted fonts.
- **Optional:** An Anthropic API key from [console.anthropic.com](https://console.anthropic.com) if you want to use the Claude assistant.

### 2. Install dependencies

From the repository root:

```bash
# macOS / Linux
python3 -m venv .venv
.venv/bin/pip install -r reader/requirements.txt
```

```powershell
# Windows / PowerShell
python -m venv .venv
.\.venv\Scripts\pip install -r reader\requirements.txt
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

The same `.env` also configures OSHA News — all optional: `DOL_API_KEY` (free, from [dataportal.dol.gov/registration](https://dataportal.dol.gov/registration)) switches on the Enforcement tab; `NEWS_AGENCIES` (comma-separated Federal Register agency slugs, OSHA by default) chooses which agencies News follows; `NEWS_SYNC=0` turns the background news sync off; `NEWS_RETENTION_DAYS` (default 365) sets how much history is kept. The server only answers under this computer's own name (`localhost`, `127.0.0.1`); to reach it under another name, list that name in `SERVER_ALLOWED_HOSTS` (comma-separated). There is no login, so only do that on a network you trust.

### 4. Start the workstation

Run commands from inside `reader/` (since the backend package is `app`). On Windows, use `..\.venv\Scripts\python` instead of `../.venv/bin/python`.

```bash
cd reader
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open **http://127.0.0.1:8000** in your browser. On first start nothing is installed yet: the workstation asks what you work in and downloads that profile's titles and parts from eCFR, or you can choose your own in the **Library**. The reader opens as soon as the first title lands.

- Interactive API docs: http://127.0.0.1:8000/docs
- Full HTTP & streaming reference: [`API.md`](API.md)
- Every local database, table and column: [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md) (generated by `python -m app.schema_doc`)

### 5. Managing corpora from the CLI (optional)

You can install or refresh federal corpora from the terminal if you prefer:

```bash
cd reader
../.venv/bin/python -m app.build                    # Download CFR Title 29 if missing
../.venv/bin/python -m app.build --title 40         # Install another CFR title
../.venv/bin/python -m app.build --force            # Re-download the latest CFR edition
../.venv/bin/python -m app.build --title 29 --renest  # Fix subpart nesting in place (no download)
../.venv/bin/python -m app.usc_build --title 4      # Install a U.S. Code title from OLRC
../.venv/bin/python -m app.fr_build                 # Build/update the Federal Register archive
../.venv/bin/python -m app.constitution             # Build the U.S. Constitution (GovInfo bulk data)
../.venv/bin/python -m app.plaw                     # Build Public Laws (GovInfo bulk data)
../.venv/bin/python -m app.agenda                   # Build the Unified Agenda (reginfo.gov)
../.venv/bin/python -m app.integrity --offline      # Check local database integrity across all corpora
../.venv/bin/python -m app.migrate --status         # Show each local database's schema version (omit --status to migrate)
../.venv/bin/python -m app.reindex --offline        # Rebuild derived data (the CFR citation graph) from local data, no download
../.venv/bin/python -m app.schema_doc               # Regenerate DATA_DICTIONARY.md after a schema change
```

Note that a CLI build isn't picked up by an already-running server until you restart it or call `POST /api/library/reload`. Downloads started inside the app's **Library** take effect right away.

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
├── AGENTS.md                  # Short entry point for coding agents (defers to CLAUDE.md)
├── README.md                  # Top-level overview
├── Start FRAMEWORK.command    # One-click macOS launcher
├── docs/
│   ├── plans/                 # Historical archive of earlier design plans (active plans live in Linear)
│   ├── notes/                 # Lightweight dev logs for cleanup and follow-ups
│   └── bugs,quirks/           # Federal ingest quirks register (duplicate appendix ids, reserved titles, U.S.C. notes)
└── reader/
    ├── app/
    │   ├── config.py          # Paths, .env loading, installed-title discovery
    │   ├── profiles.py        # First-run profiles + static names for all 50 CFR titles
    │   ├── build.py           # eCFR download, streaming XML ingest, SQLite FTS5 indexer
    │   ├── store.py           # Per-title SQLite connections, caches, federated search
    │   ├── citations/         # One citation grammar (parser.py) + per-title references / cited-by / IBR graph (graph.py)
    │   ├── render/            # XML → HTML: text, hierarchy, linkifier, units, html, uslm_html, plaw_html
    │   ├── ingest/            # Structure-tree utilities + streaming eCFR XML & USLM parsers
    │   ├── library/           # eCFR client, suites, disk, job queue, views
    │   ├── fr_client.py       # Shared Federal Register API v1 client (pacing, retries, sanitization)
    │   ├── fr_store.py        # fr.sqlite3 corpus schema, FTS5, provenance, CFR links
    │   ├── fr_build.py        # Resumable Federal Register corpus builder & incremental updater
    │   ├── usc_client.py      # OLRC U.S. Code release discovery & zip downloader (incl. appendix titles)
    │   ├── usc_store.py       # Per-title usc-{N}.sqlite3 store & FTS5 search
    │   ├── usc_build.py       # U.S. Code builder, updater & catalog
    │   ├── usc_citations.py   # Reverse U.S.C. / CFR / authority citations for U.S.C. sections
    │   ├── gov_http.py        # Polite keyless client for GovInfo bulk data & reginfo.gov
    │   ├── constitution.py    # U.S. Constitution ingest & store (GovInfo HMAN USLM)
    │   ├── plaw.py            # Public Laws ingest & store (GovInfo PLAW USLM)
    │   ├── agenda.py          # Unified Agenda ingest & store (reginfo.gov XML)
    │   ├── sources/           # Federal source registry, selection, presets, plans, schedules & status
    │   ├── integrity.py       # Cross-corpus integrity checks (SQLite, SHA-256, coverage, freshness)
    │   ├── govinfo.py         # Optional GovInfo FR cross-check helper
    │   ├── news.py            # Federal Register + DOL fetchers, DOL standard decoder, inspection case files, takeaway bullets
    │   ├── news_store.py      # osha_news.sqlite3: articles, citations, FTS5, sync status, enforcement_cases
    │   ├── news_schedule.py   # Publication windows, staleness, backoff (pure functions)
    │   ├── news_worker.py     # Schedule-gated background sync thread
    │   ├── routers/           # Domain routers: settings, library, news, fr, usc, integrity, sources, corpora, reader, chat (+deps)
    │   ├── chat.py            # Claude streaming tool-use loop
    │   ├── main.py            # App init + router mounting (order is a contract)
    │   ├── title_blurbs.json  # Editorial summaries, desks, agencies, and size estimates for CFR titles
    │   └── usc_titles.json    # Static catalog, desks, and CFR mappings for U.S. Code titles
    ├── data/                  # SQLite DBs + tree JSON per corpus/title (gitignored)
    ├── frontend/              # Frontend sources (Node 20+ only for contributors)
    │   ├── index.html         # App shell, activity rail, drawer, and transfer dock
    │   └── src/               # ES modules + TypeScript: state.ts, views/, components/, panels/, styles/
    ├── static/
    │   ├── dist/              # Committed Vite build: index.html, app.js, app.css, build-stamp.json
    │   └── fonts/             # Self-hosted variable Geist + Inter (.woff2, OFL licenses)
    ├── tests/                 # Self-contained unit & integration tests
    ├── .env.example
    ├── API.md
    ├── DATA_DICTIONARY.md     # Generated: every store, table, column and meta key
    └── README.md
```
