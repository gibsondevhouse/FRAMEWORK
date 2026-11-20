# FRAMEWORK — Federal Codes & Laws Platform

Welcome to **FRAMEWORK**, a calm, local-first, **federal-only** platform for reading, tracking, and staying up to date on codes and laws across federal frameworks — including the **Code of Federal Regulations (CFR)**, the **Federal Register**, and the **United States Code (U.S.C.)**.

Working with federal law shouldn't feel like wrestling with clunky government websites or waiting on slow page loads. FRAMEWORK puts federal texts right on your own machine in fast, offline SQLite databases—so searching across thousands of pages takes milliseconds, citations link straight to where they belong, and your notes and workspaces stay with you.

The only times FRAMEWORK reaches out to the internet are when you choose to download or update titles from eCFR, sync filings from the Federal Register API (or optional DOL API), or optionally hook up an Anthropic API key to chat with Claude about the text you have open. Everything else—reading, searching, organizing workspaces—works completely offline.

*(Scope note: FRAMEWORK focuses exclusively on federal codes and laws. State-law coverage and HSE-specific suites are out of scope.)*

---

## What you can do with it

- **Read regulations the way they're meant to be read.** Long sections open one clause or appendix chapter at a time (with a clean navigation rail in the margin), or you can switch to the full section or an entire part on one page. Indentation `(a) → (1) → (i) → (A)`, tables, figures, and footnotes all render cleanly, and citations like `§ 541.100` or `40 CFR 261.3` become clickable links.
- **Read the Constitution.** Download it from the Library's **Constitution** tab and read each article section and amendment with a plain-English heading, numbered clauses that copy their citation (`U.S. Const. amend. XIV, § 1`), **Pin**, and the House Parliamentarian's annotations kept below the text.
- **Read statutes the same way.** Installed U.S. Code titles open in the same reader as the CFR — same layout, numbered paragraphs indented by level, hover **Cite** (`29 U.S.C. § 655(b)(1)`) and **Clip**, and **Pin** to a workspace — with the statutory and editorial notes kept below the text.
- **Follow citations without losing your place.** Hover a citation, footnote, table or figure reference to peek at it; Alt/⌥-click a section to open it side-by-side; and when a citation points to a title you haven't installed, click it to download just that section or part without leaving the page. Every section shows who cites it, consensus standards (ANSI, NFPA, ASTM, …) resolve to the title's incorporation-by-reference catalog, and each title's start page carries a References & Authorities directory of the standards bodies, portals and agencies it relies on. Hover any clause to copy a formal citation or clip it into a workspace.
- **Search everything in an instant.** Full-text search (powered by SQLite FTS5) runs locally across one title or every title you have installed. Type a section number like `1910.1200` to jump straight there.
- **Organize your work into Workspaces.** Pin sections you're actively working on into named workspaces, clip individual clauses with their citation, jot down notes, add tags, and export or import your workspaces as JSON whenever you need to share or back them up. Everything stays in your browser's local storage.
- **Keep your library tidy with the Newsroom & Transfer Dock.** Browse all 54 U.S. Code titles and all 50 CFR titles in a tabbed Library grouped by topic desk, install whole titles, individual parts, or single sections, or grab a curated title bundle in one batch. A quiet **Regulatory Wire** shows which titles were amended most recently, and a floating transfer dock keeps track of downloads in the corner while you keep reading.
- **Follow Federal Register rulemaking without leaving the app.** The **News** page gathers Federal Register final rules, proposed rules, notices, and pre-publication filings from the official Federal Register API (no key needed) across your configured agencies and every installed CFR title. Every card states the facts in three fixed bullets built from the records themselves, with citation chips that jump straight into the reader; every installed title's section and part pages show related rulemaking in return, and published Federal Register documents open in an in-app preamble reader. *(An optional free DOL API key also unlocks historical OSHA enforcement records and case files.)*
- **Choose exactly what data you keep, with checkboxes.** **Settings → Data sources** lets you switch each federal source on or off, pick how often it updates, and tick the titles, agencies or document types you want. Start from a template, save your own, and share it as a file; nothing downloads until you review and apply.
- **Navigate across federal frameworks cleanly.** A two-layer sidebar separates app-level navigation (Home, Workspaces, Newsroom, Library, Settings, API & Sources) from the contextual framework drawer that opens while you are inside a legal framework.
- **Ask Claude when you want a second pair of eyes (optional).** Highlight any passage to ask about it, or open the assistant drawer. Claude reads directly from your local regulatory databases so its answers stay grounded in the actual text.

---

## Getting started

You'll need **Python 3.10 or newer** — and nothing else at runtime. The web frontend ships pre-built (committed in `reader/static/dist/`, fonts self-hosted), so **no Node.js is required** to run FRAMEWORK.

### The easy way on macOS
Double-click **`Start FRAMEWORK.command`** in the repository root. On the first run, it creates a `.venv` for you, installs the dependencies, starts the server, and opens your browser.

### Manual setup (macOS / Linux)

```bash
python3 -m venv .venv
.venv/bin/pip install -r reader/requirements.txt
cd reader
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Manual setup (Windows / PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r reader\requirements.txt
cd reader
..\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Once the server is running, open **http://127.0.0.1:8000** in your browser.

On first start nothing is installed yet: FRAMEWORK asks what you work in (Safety / OSHA, Environmental, Transportation, Employment & benefits, Elections & government, Food & drugs, Finance) and downloads that profile's titles and parts from eCFR—or you can choose your own in the **Library**. The reader opens as soon as the first title lands. You can also install titles from the CLI:

```bash
cd reader
../.venv/bin/python -m app.build --title 40
```

### Setting up the Claude assistant (optional)

Reading, searching, and project dossiers all work without an API key. If you'd like to use the built-in Claude assistant, copy `reader/.env.example` to `reader/.env` and add your `ANTHROPIC_API_KEY`.

### Setting up OSHA enforcement news (optional)

The **News** page works out of the box for Federal Register rulemaking. To also see OSHA inspections and penalties on the Enforcement tab, register for a free key at [dataportal.dol.gov/registration](https://dataportal.dol.gov/registration) and add `DOL_API_KEY=…` to `reader/.env`.

---

## Where everything lives

- **`reader/`** — The workstation itself: a FastAPI + SQLite FTS5 backend and a vanilla-JS/TypeScript frontend (sources in `reader/frontend/`, built by Vite into the committed `reader/static/dist/`). See [`reader/README.md`](reader/README.md) for the full user guide and [`reader/API.md`](reader/API.md) if you want to use the HTTP API directly.

  Contributing to the frontend (only then do you need Node 20+): `cd reader/frontend && npm install && npm run watch` beside the uvicorn dev server, then commit the rebuilt `reader/static/dist/` (`.nvmrc` pins the Node version; `tests/test_build_stamp.py` fails if sources and the committed build drift apart).
- **`docs/plans/`** — Historical archive of earlier 10-series design plans (`11`–`51`). **Active planning and roadmap tracking live in Linear (`FRAMEWORK`)**.
- **`docs/notes/`** — Lightweight dev notes for ongoing cleanup and follow-ups.
- **`docs/bugs,quirks/`** — Register of federal ingest quirks (duplicate appendix identifiers in Titles 14 and 47, reserved Title 35, loose subpart nesting, and U.S.C. notes).
- **`CLAUDE.md`** — Detailed technical notes for anyone working on the code; **`AGENTS.md`** is the short entry point for coding agents and points back to it.

*(Generated GovInfo/eCFR URL inventories like `docs/dev/`, `docs/title-29/`, and `docs/title-29-api/` are gitignored and not part of the repository; FRAMEWORK doesn't use them at runtime.)*
