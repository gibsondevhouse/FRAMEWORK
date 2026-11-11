# Coding Agent Prompt — Phase 1: Multi-Title Engine & Parameterized Pipeline

## Role
You are a senior Python/FastAPI engineer working in the `title-reader` repository (a local CFR reader for Title 29 with a Claude research assistant). Execute **Phase 1** of `HSE_PLATFORM_ROADMAP.md` (§6). Read `CLAUDE.md`, `README.md`, and `HSE_PLATFORM_ROADMAP.md` (§4.1–4.5, §6) before changing anything.

## Environment (from CLAUDE.md)
- Windows / PowerShell. venv at repo root `.venv` (Python 3.10). Run commands from `reader/` (backend is the package `app`).
- Run server: `..\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`
- Build: `..\.venv\Scripts\python -m app.build [--force]`
- Deps installed by hand: `fastapi "uvicorn[standard]" httpx anthropic python-dotenv`. No test suite, linter, or requirements.txt exists. Do not add heavy new dependencies; standard library only for XML parsing.
- Do **not** edit anything under `docs/`.
- The eCFR API returns 406 unless `Accept-Encoding` is sent. Keep that header.
- `main.py` caches (`known_ids`, `section_html`, `meta`) are only cleared at startup. Restart the server after rebuilding any DB.

## Goal
Turn the Title 29–only reader into a **federated multi-title** reader, without breaking existing Title 29 behavior.

## Tasks

### 1. Parameterize the build pipeline (`app/build.py`)
- Add a `--title <N>` CLI argument (int 1–50, default `29` so existing commands behave exactly as before). Keep `--force`.
- Replace every hardcoded `title-29` / `29` (URLs, filenames, DB path, tree path) with the title number.
- Output per title, in `reader/data/`: `title-{N}.sqlite3` and `tree-{N}.json`. Migrate/keep compatibility with the current Title 29 file names (either rename to the new scheme with a one-time migration, or add a fallback). Pick one and document it in your summary.
- Keep the existing flow: `titles.json` → latest `up_to_date_as_of` → `structure/{edition}/title-{N}.json` + `full/{edition}/title-{N}.xml`. The structure JSON still drives ordering and hierarchy; the XML supplies text. Leaves still match on `(kind, N)` where `DIV8` = section and `DIV9` = appendix; `DIV5`/`DIV6` supply front matter (`part/{N}`, `part/{N}/subpart/{N}`).
- Keep: write to `.tmp` then atomic replace; carry over cached AI `summaries` keyed `(id, edition)`; store `ord` and breadcrumb `path`.
- **Download the XML by streaming to disk** (`httpx` streaming response, chunked write to a temp file) — do not hold the whole body in memory. Add sensible timeouts and a clear error if a title does not exist.

### 2. Streaming XML parse (iterparse)
- Replace `ET.fromstring()` / whole-tree parsing with `xml.etree.ElementTree.iterparse` reading from the file on disk.
- Process each `DIV8`/`DIV9` on its `end` event (fully populated), flatten text + keep raw XML for rendering, then free memory. Note the docs: iterparse builds the tree incrementally and **does not free it incrementally** — `elem.clear()` empties the element but leaves it attached, so also detach processed leaves from their parent (track the parent via `start` events and call `parent.remove(elem)`, or clear the root periodically) so memory stays flat on Title 40 (>300 MB XML).
- Front matter (`DIV5`/`DIV6`: authority, source notes) must still be captured. Because those containers hold the sections, capture the needed child elements (e.g., authority/source) before the leaves are cleared, and do not clear `DIV5`/`DIV6` themselves until their front matter is stored.
- Close the iterator explicitly (it has a `close()` method; unclosed files can emit `ResourceWarning`).
- Verify with a memory check: build Title 29 and Title 40 and report peak RSS (e.g., `tracemalloc` or `psutil` if already present, otherwise Windows Task Manager/`Get-Process`). Title 29 output must be **identical** (same section count, same text) to the pre-change build; compare before/after.

### 3. Ingest Title 40 (EPA) and Title 49 (DOT)
- Run `python -m app.build --title 40` and `--title 49`. Each into its own SQLite file + tree JSON. Titles are independent; a failure in one must not corrupt another.
- Report for each: edition date, section count, DB size, build time, peak memory.

### 4. Federated API routing (`app/main.py`)
- Add title-aware routes: `/api/{title}/meta`, `/api/{title}/tree`, `/api/{title}/search`, `/api/{title}/section/{id}`, `/api/{title}/part/{part}`, and the summary/chat equivalents. Use FastAPI path parameters with validation (e.g., `Path(ge=1, le=50)`) and a 404 for titles that are not installed. Prefer an `APIRouter` with a `/api/{title}` prefix.
- Keep the **existing un-prefixed routes** (`/api/search`, `/api/section/{id}`, etc.) working as aliases to Title 29 so the current frontend does not break.
- Replace the single global DB handle with a per-title registry: discover `data/title-*.sqlite3` at startup, open thread-local connections per title, and scope the `lru_cache`s by title (cache key must include the title; section IDs like `1910.134` are only unique within a title).
- Add `/api/titles` returning installed titles (number, name if available, edition date, section count).
- Add `/api/search` global/cross-title search: dispatch the FTS5 query to each installed title (`asyncio.gather` with threads for the blocking sqlite calls), then merge by BM25 `rank` (lower is better in FTS5) and return results tagged with `title`. Keep per-title limits so the merged list is bounded.
- Sanitize user FTS queries (quote/escape per FTS5 string rules) so punctuation such as `§` or `.` in `1910.134` does not cause syntax errors.
- Minimal frontend change: a title selector populated from `/api/titles` that switches the sidebar tree and search scope, defaulting to Title 29. Keep it vanilla JS and keep the diff small.

### 5. Cross-title citation linking (`app/render.py`)
- Extend `make_linkifier` to recognize `NN CFR § X.Y`, `NN CFR part X`, and `NN CFR X.Y` using the regex in roadmap §4.5 as a starting point, then harden it (handle `§§`, ranges like `1910.1000 through 1910.1099`, trailing paragraph references like `(a)(1)(i)`, and ensure it does not double-link text already inside an anchor).
- Link to the right title: if the target title is installed, produce an in-app link (`/{title}/section/{id}` or whatever the SPA uses); if not installed, render plain text or a subtle "title not installed" state with an eCFR fallback link (`https://www.ecfr.gov/current/title-{N}/section-{id}`).
- Bare `§ 1910.134` citations with no title continue to resolve within the **current** title.
- Validate IDs against the target title's `known_ids` before linking.

### 6. AI assistant awareness (`app/chat.py`)
- Tool functions (`search_regulations`, `read_section`, `list_part`) gain an optional `title` argument (default 29; search may be "all"). Update tool schemas and the system prompt so the model cites with the title (e.g., `40 CFR § 261.3`).

## Acceptance criteria
1. `python -m app.build` with no arguments behaves exactly as before for Title 29.
2. `python -m app.build --title 40` and `--title 49` complete and produce separate DBs and trees; peak memory for Title 40 stays well below the ~2 GB the old approach would need (report the number).
3. Title 29 rebuilt via the new pipeline matches the old DB: same section/appendix count and identical flattened text (provide the comparison).
4. `/api/titles`, `/api/{title}/search`, `/api/{title}/section/{id}`, and global search return correct results; legacy un-prefixed routes still work.
5. A Title 29 section citing a Title 40 or 49 regulation (e.g., § 1910.120 text referencing EPA/DOT rules) renders a working cross-title link.
6. No regressions in the existing UI (sidebar, search, section view, prev/next, chat drawer).
7. Smoke tests: add a small `reader/tests/` with a few `pytest`-style or plain-script checks (iterparse yields the expected leaf count on a tiny fixture XML; linkifier regex cases; FTS query sanitizer). Keep them dependency-light.

## Working rules
- Work in small, reviewable steps; after each task, run the app and verify before moving on.
- Do not invent APIs: confirm endpoint shapes against the eCFR docs below and by calling them.
- Don't expose secrets; `ANTHROPIC_API_KEY` stays in `reader/.env`.
- Finish with a short summary: files changed, decisions made (esp. the DB filename migration), measured numbers, and anything deferred to Phase 2.

## Out of scope (Phase 2/3)
HSE tools (recordability engine, toolbox talks, JHA, chemical matrix), MCP server, hybrid vector search, change-radar alerts, and bots.

---

## References (official developer documentation)

**eCFR API**
- eCFR API documentation (interactive, endpoint list and parameters): https://www.ecfr.gov/developers/documentation/api/v1
- eCFR REST API & Interactive Documentation (Reader Aids; no API key required): https://www.ecfr.gov/reader-aids/ecfr-developer-resources/rest-api-interactive-documentation
- Versioner base URL: `https://www.ecfr.gov/api/versioner/v1` — endpoints used here: `/titles.json`, `/structure/{date}/title-{N}.json`, `/full/{date}/title-{N}.xml`, `/ancestry/{date}/title-{N}.json`
- Project inventory of Title 29 endpoint patterns: `title-29-all-api-urls.md` (in this repo's docs)

**Python standard library**
- `xml.etree.ElementTree` (`iterparse`, `Element.clear`, "keep memory usage low" guidance, `XMLParser`): https://docs.python.org/3/library/xml.etree.elementtree.html
- `sqlite3` (connections, thread-safety, transactions): https://docs.python.org/3/library/sqlite3.html
- `re` (regex syntax, verbose mode, lookarounds): https://docs.python.org/3/library/re.html
- `asyncio` (`gather`, `to_thread`): https://docs.python.org/3/library/asyncio-task.html
- `argparse`: https://docs.python.org/3/library/argparse.html
- `functools.lru_cache`: https://docs.python.org/3/library/functools.html#functools.lru_cache

**SQLite**
- FTS5 extension (query syntax, `bm25()`, `highlight()`, `snippet()`, external content tables, `rank`): https://sqlite.org/fts5.html

**FastAPI**
- Path parameters & validation: https://fastapi.tiangolo.com/tutorial/path-params/ and https://fastapi.tiangolo.com/tutorial/path-params-numeric-validations/
- Bigger applications / `APIRouter` with prefixes: https://fastapi.tiangolo.com/tutorial/bigger-applications/
- Lifespan events: https://fastapi.tiangolo.com/advanced/events/
- Concurrency and `async def` vs `def`: https://fastapi.tiangolo.com/async/

**HTTPX**
- Streaming responses (`client.stream`, `iter_bytes`) for large downloads: https://www.python-httpx.org/quickstart/#streaming-responses
- Async client: https://www.python-httpx.org/async/
- Timeouts: https://www.python-httpx.org/advanced/timeouts/

**Anthropic (for the chat tool-schema updates)**
- Tool use overview: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview
