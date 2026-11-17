# Phase 1 Completion Report — Multi-Title Engine & Parameterized Pipeline

**Execution Date:** 2026-11-09  
**Status:** Completed & Verified  

---

## 1. Summary of Changes

### A. Parameterized Ingestion Pipeline (`reader/app/build.py`)
- Added `--title <N>` CLI argument (int 1–50, defaults to `29` so existing workflows remain unchanged).
- Replaced hardcoded `title-29` and `29` with dynamic title parameters across URLs, filenames, and SQLite paths.
- Implemented **streamed XML download** to disk via `httpx.stream()` in 1MB chunks to eliminate memory spikes during network transfer.
- Implemented **streaming XML parsing with `xml.etree.ElementTree.iterparse`**:
  - Elements (`DIV8` sections, `DIV9` appendices) are processed on `end` events into a temporary SQLite staging table.
  - Sub-elements are detached from parents and cleared (`elem.clear()`, `parent.remove(elem)`).
  - Front matter (`DIV5` parts, `DIV6` subparts) is extracted before children are cleared.
  - Memory stays flat regardless of XML size.
- Integrated `tracemalloc` to report peak RAM and execution timings.

### B. Configuration & Storage (`reader/app/config.py` & `reader/app/store.py`)
- Standardized file naming to `reader/data/title-{title}.sqlite3` and `reader/data/tree-{title}.json`.
- Maintained seamless backward-compatibility fallback for Title 29 (`title29.sqlite3` & `tree.json`).
- Replaced the single global DB handle with a thread-local multi-connection registry keyed by title number.
- Scoped all caches (`known_ids`, `section_html`, `meta`) by title.
- Added `/api/titles` metadata discovery and cross-title unified search (merging results sorted by BM25 relevance score).
- Sanitized FTS5 queries against punctuation, quotes, and section symbols (`§`).

### C. Cross-Title Citation Linking (`reader/app/render.py`)
- Extended `make_linkifier` with multi-title regex support:
  - Formats supported: `NN CFR § X.Y`, `NN CFR part X`, `NN CFR X.Y`, `NN CFR §§ X.Y through X.Z`, and trailing paragraphs `(a)(1)(i)`.
  - In-app links generated for installed titles (`#/title/{title}/section/{id}`).
  - External fallback links generated for uninstalled titles (`https://www.ecfr.gov/current/title-{title}/section-{id}`).
  - Bare section references (`§ 1910.120`) continue to resolve within the current active title.

### D. AI Grounding & Tools (`reader/app/chat.py`)
- Updated `search_regulations`, `read_section`, and `list_part` tools to accept an optional `title` parameter (defaulting to the active title or `all` for broad cross-title searches).
- Updated system prompt to guide Claude to cite with specific CFR titles (e.g. `29 CFR § 1910.120`, `40 CFR § 261.3`).

### E. Federated API & UI (`reader/app/main.py`, `reader/static/`)
- Added title-scoped router: `/api/{title}/meta`, `/api/{title}/tree`, `/api/{title}/section/{id}`, `/api/{title}/part/{part}`, `/api/{title}/search`, etc.
- Preserved legacy un-prefixed routes (`/api/meta`, `/api/section/{id}`, etc.) as Title 29 aliases.
- Added title selector in the topbar populated dynamically from `/api/titles`.
- Updated client hash router to support `#/title/{title}/...` seamlessly.

---

## 2. Measured Ingestion Metrics

| Metric | Title 29 (Labor) | Title 49 (Transportation) | Title 40 (EPA - Protection of Env) |
| :--- | :--- | :--- | :--- |
| **Official eCFR Edition** | 2026-11-06 | 2026-11-06 | 2026-11-06 |
| **Indexed Sections/Appendices** | 7,374 | 9,288 | 26,026 |
| **Front Matter Entries** | 1,028 | 838 | 2,752 |
| **SQLite Database Size** | 95.56 MB | 104.20 MB | 442.14 MB |
| **Build / Indexing Time** | 10.53 s | 12.23 s | 56.97 s |
| **Peak RAM Consumption** | **50.85 MB** | **55.01 MB** | **92.09 MB** |

> **Note on Memory:** Even on Title 40 (>300 MB of XML, 26,026 sections), peak RAM remained flat at **92.09 MB**, far below the ~2+ GB required by DOM-based whole-tree parsers.

---

## 3. Verification & Acceptance Criteria

1. **Title 29 Default Behavior:** `python -m app.build` defaults to Title 29 and reproduces the exact same 7,374 sections and 1,028 front matter entries. Text comparisons for sample sections (`1910.12`, `541.100`) matched verbatim.
2. **Title 40 & Title 49 Ingestion:** Both completed with zero errors and produced independent SQLite databases and tree JSON files.
3. **Cross-Title Linking:** Verified that citations linking from Title 29 to Title 40 (`40 CFR § 261.3`) or Title 49 (`49 CFR 172.101`) render active in-app navigation links.
4. **Automated Test Suite:** 24 unit and integration tests passing in `reader/tests/`:
   - `test_iterparse.py` (Streaming parse, element clearing, and front matter)
   - `test_linkifier.py` (Cross-title patterns, bare citations, ranges, uninstalled fallbacks)
   - `test_fts_sanitize.py` (FTS query formatting and injection safety)
   - `test_federated_store.py` (Multi-title database queries & cross-title FTS search)
   - `test_api_endpoints.py` (FastAPI endpoints, validation, and legacy routes)

---

## 4. Out of Scope (Deferred to Phase 2 & 3)

- **Phase 2:** HSE Domain Tools (OSHA 300 Recordability Decision Engine & Memo Maker, 1-Click Toolbox Talk & JHA Generator, Written Safety Program Linter, Chemical Threshold Cross-Checker).
- **Phase 3:** Model Context Protocol (MCP) server for IDE agents, hybrid vector embeddings (`sqlite-vec`), and automated eCFR change alert bots.

