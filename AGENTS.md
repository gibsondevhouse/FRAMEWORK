# AGENTS.md

Entry point for any coding agent (Codex, Gemini CLI, Cursor, Claude Code, …) working in this repository.

**`CLAUDE.md` at the repo root is the maintained, detailed description of the code — read it first.** This file is deliberately short: it says where things are, how to run them, and which contracts a change must keep. When you change behaviour, update `CLAUDE.md` (and the user-facing docs listed at the end); keep this file consistent with it.

## Layout

- `reader/` is the only code: **FRAMEWORK**, a local-first Regulatory Workstation for the CFR (FastAPI + SQLite FTS5 backend in `reader/app/`, vanilla-JS/TypeScript frontend in `reader/frontend/` built by Vite into the **committed** `reader/static/dist/`). Tests live in `reader/tests/`.
- `docs/plans/` holds design plans in a 10-series by subject (`docs/plans/README.md` is the index). Plans `12`, `21`, `22`, `23`, `31`, `41` are implemented; `42_dol_api_expansion` is queued and **not** to be executed unless asked; `51_hse_platform_roadmap` is strategy, not a description of running code. `docs/notes/` is the cleanup dev log; `docs/bugs,quirks/` (quote the comma) is the eCFR ingest quirks register.
- `reader/data/` (SQLite DBs, tree JSON) and `.venv/` are gitignored; a fresh clone has neither and the app starts empty with a profile picker.

## Run

Python 3.10+ (this machine: Homebrew `python3.12`); the venv is at the repo root, commands run from `reader/` because the package is `app`.

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r reader/requirements-dev.txt   # once, from the repo root
cd reader
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
../.venv/bin/python -m pytest tests -q                                            # full suite (browser suites skip without Playwright)
../.venv/bin/python -m pytest tests -q --ignore=tests/test_browser_parity.py --ignore=tests/test_milestone2_browser.py --ignore=tests/test_milestone3_browser.py   # ~2 s
```

Frontend sources changed? `cd reader/frontend && npm install && npm run build` (Node 20+), then commit `reader/static/dist/`. Windows: `..\.venv\Scripts\python`.

## Contracts a change must keep

1. **Build stamp.** `tests/test_build_stamp.py` hashes `reader/frontend/src/**` + `index.html` and compares with `static/dist/build-stamp.json`. Editing frontend sources without `npm run build` fails CI.
2. **Goldens.** API payloads, the chat SSE stream and error shapes are pinned in `tests/snapshots/` (re-record only for an intended change: `UPDATE_SNAPSHOTS=1`); screenshots in `tests/baselines/{darwin,win32}/` (`UPDATE_BASELINES=1 REQUIRE_BROWSER=1`). `route_inventory.json` pins the mounted route paths.
3. **Router mounting order** in `app/main.py` is a contract: fixed-prefix routers first, `news_router` **before** the `/api/{title}` routers, legacy un-prefixed Title 29 aliases last. Routers import whole modules (`from .. import config, library`), never functions, so test patches stay effective; `app/library/` submodules call each other through the package for the same reason.
4. **Hermetic tests.** Every suite inherits `tests/base.py` `HermeticTestCase` (env pop-and-restore, sync and async httpx transports patched to raise). Tests build fake titles via `tests/fake_titles.py` into a temp `DATA_DIR`; never depend on `reader/data/`, never reach the network, never start the `news-worker` thread.
5. **SQLite discipline.** Reads go through `store`'s thread-local read-only connections and `lru_cache`s that cache only on success; call `store.release_title(n)` before replacing or deleting a title's files (Windows holds locks). A CLI `python -m app.build` is seen by a running server after `POST /api/library/reload` (or a restart).
6. **Citations.** All citation regexes live in `app/citations/parser.py`; `render/linkifier.py`, `news.py` and `frontend/src/citations.ts` consume them (parity tested). The link classes the frontend keys off (`xref`, `xref-local`, `xref-cross`, `xref-external[data-cfr-*]`, `xref-usc`, `xref-fr`, `xref-web`) and the deterministic anchor ids (`p{n}`, `table-*`, `fn-*`, `appendix-*`, `fig-*`) are shared contracts between `app/render/` and `frontend/src/components/peek.js` / `views/doc_utils.js`.
7. **Frontend rules.** Shared state is `state.x` from `state.ts` (typed `AppState`, no `any`), never module-level `let`s. Markup goes through `escapeHtml` / `safeHttpUrl`, icons through `icon()` (16px stroked SVGs, never emoji or Unicode glyphs), listeners are delegated (no inline handlers), colours come from the tokens in `styles/01_tokens.css`, popovers use `components/popover.js`'s `createPopover`, and pane breakpoints are `@container` rules. Every loader checks `state.routeSeq` after each `await` and passes `state.routeAbort.signal` to `fetch`.
8. **News sources.** Only the Federal Register API v1 and the DOL Open Data API v4 (`?X-API-KEY=` query param, batches ≤ 50 ids, `204` → `[]`, never on keystrokes), always with `User-Agent: FRAMEWORK-ComplianceReader/1.0 (local-reader)`. Never scrape osha.gov or dol.gov RSS/HTML, never spoof a browser. Takeaway bullets are built from record fields — no LLM.
9. **Decisions the user made — don't reopen them.** No collapsible sections, inline TOC box or per-paragraph ticks in the reader; no breadcrumb in the main panel and no prev/next cards at the bottom or in the sidebar (stepping lives in the pinned `#view-head`); no "Getting around" tips box on Title start; no badges/chips/per-row tags in the Contents sidebar; rail hover never scrolls; `statPill` is for sync state only (penalties and FR citations are plain text); the "three ways to read" (clause by clause, full section, full part) stay.
10. **Secrets.** `reader/.env` is gitignored and edited through the in-app `.env` modal / `POST /api/settings/env`; never log DOL or Anthropic keys or request URLs that carry them.

## Docs to update with a feature

`CLAUDE.md` (architecture), `README.md` and `reader/README.md` (user-facing), `reader/API.md` (every route), `docs/plans/README.md` + `docs/plans/MAPPED_PLAN_OVERVIEW.md` (plan status), `docs/bugs,quirks/README.md` (new ingest quirks). `tests/test_library_front_page.py` enforces the ≤140-character title summaries in `app/title_blurbs.json`.
