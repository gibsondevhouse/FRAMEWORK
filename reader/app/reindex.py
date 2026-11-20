"""Rebuild derived data from what is already on disk (register DM-003, SEC-007).

    python -m app.reindex                          # every step, for everything installed
    python -m app.reindex --corpus cfr --title 29
    python -m app.reindex --step cfr.citation_graph
    python -m app.reindex --list                   # the registered steps
    python -m app.reindex --offline --json

Derived data is whatever is computed from a store's own rows. Today that is the CFR citation
graph (`title_graph`: web references, cited-by backlinks and the IBR catalog, computed from
`sections` by `citations.graph`). Rebuilding it used to mean rebuilding the title, which
downloads the title again; this command recomputes it from the stored sections.

It never uses the network. A step reads local stores only, and the command refuses every
HTTP request while it runs, so `--offline` is the default and only mode (the flag is
accepted so a script can say so, as with `python -m app.integrity --offline`).

Adding a step takes one function, in the module that owns the derived data:

    from . import reindex

    @reindex.step("links.index", corpus="links", summary="Cross-framework link index")
    def rebuild_links(target, report):
        with reindex.new_file(links_store.db_path()) as tmp:
            ...  # build the whole store at `tmp`
        return "12,340 links"

The command imports every module in `app` before it runs, so the decorator is all the wiring
there is: this file is not edited. `targets=` makes a step run once per item it returns (the
CFR step runs once per installed title, and `--title` picks one); without it the step runs
once, with `target` None. The return value is a short note for the report.

A step must leave a usable store whatever happens to it (SEC-007), so it writes the way the
store is normally written:

- a derived store that is its own file is built at a temporary path and renamed into place
  (`new_file`);
- derived rows inside a CFR or U.S.C. title go into a private copy that then replaces the
  live file under the swap rules (`staged_copy`), which also drops that title's caches;
- derived rows inside a living store (Federal Register, Public Laws, …) are replaced in one
  transaction, under that store's write lock where it has one.

One step failing never stops the others; the command exits 1 if any did. A server that is
already running keeps the files it has open: `POST /api/library/reload` (or a restart) shows
it the result, as after any command-line build.
"""
from __future__ import annotations

import argparse
import importlib
import json
import pkgutil
import sqlite3
import sys
import time
from contextlib import closing, contextmanager
from dataclasses import dataclass
from typing import Any, Callable, Iterator

from . import config, migrate

# What a step uses to write safely (see the module docstring).
new_file = migrate.staged_file
staged_copy = migrate.staged_copy

Report = Callable[[str], None]


@dataclass(frozen=True)
class Step:
    name: str                                   # "cfr.citation_graph"
    corpus: str                                 # what --corpus selects
    summary: str
    run: Callable[[Any, Report], Any]           # run(target, report) -> a short note, or None
    targets: Callable[[], list[int]] | None     # title numbers on disk; None = runs once


_STEPS: dict[str, Step] = {}


def step(name: str, *, corpus: str, summary: str, targets: Callable[[], list[int]] | None = None):
    """Register a rebuild step (see the module docstring). Use it as a decorator."""
    def register(fn: Callable[[Any, Report], Any]):
        old = _STEPS.get(name)
        if old is not None and (old.run.__module__, old.run.__qualname__) != (fn.__module__, fn.__qualname__):
            raise ValueError(f"reindex step {name!r} is already registered by {old.run.__module__}")
        _STEPS[name] = Step(name, corpus, summary, fn, targets)
        return fn
    return register


def discover() -> list[str]:
    """Import every module in `app`, so each one's `@step` has run. Returns the modules that
    failed to import (they are reported, and never stop the command)."""
    import app
    problems: list[str] = []
    for info in pkgutil.walk_packages(app.__path__, "app.", onerror=lambda name: problems.append(name)):
        if info.name in sys.modules:
            continue
        try:
            importlib.import_module(info.name)
        except Exception as exc:            # a broken module must not block the other steps
            problems.append(f"{info.name}: {exc or exc.__class__.__name__}")
    return problems


def steps() -> list[Step]:
    return [_STEPS[name] for name in sorted(_STEPS)]


def run(corpus: str | None = None, title: int | None = None, only: str | None = None,
        report: Report | None = None) -> list[dict]:
    """Run the registered steps and return one row per (step, target):
    `{step, corpus, target, status: "ok" | "failed", detail, seconds}`."""
    say = report or (lambda msg: None)
    discover()
    rows: list[dict] = []
    for s in steps():
        if (corpus and s.corpus != corpus) or (only and s.name != only):
            continue
        if s.targets is None:
            if title is not None:           # --title picks among per-title steps only
                continue
            targets: list = [None]
        else:
            targets = [t for t in s.targets() if title is None or t == int(title)]
        for target in targets:
            row = {"step": s.name, "corpus": s.corpus, "target": "-" if target is None else f"title {target}",
                   "status": "ok", "detail": "", "seconds": 0.0}
            started = time.perf_counter()
            try:
                note = s.run(target, say)
                row["detail"] = note if isinstance(note, str) else ""
            except Exception as exc:
                row.update(status="failed", detail=f"{exc or exc.__class__.__name__} (the store was left as it was)")
            row["seconds"] = round(time.perf_counter() - started, 2)
            say(f"{row['step']}  {row['target']}  {row['status']}  {row['detail']}".rstrip())
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# The first step: the CFR citation graph
# ---------------------------------------------------------------------------

@step("cfr.citation_graph", corpus="cfr",
      summary="CFR web references, cited-by backlinks and IBR catalog (title_graph), from the stored sections",
      targets=lambda: config.installed_titles())
def rebuild_cfr_graph(title: int, report: Report) -> str:
    from .citations import graph
    path = config.db_path(title)
    migrate.ensure("cfr", path)                     # this is a writer: the schema comes forward first
    with staged_copy("cfr", path) as work:
        with closing(sqlite3.connect(work)) as con:
            graph.persist_title_index(con, title)
            con.commit()
            sections = con.execute("SELECT count(*) FROM sections").fetchone()[0]
    return f"{sections} sections read"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

class NetworkRefused(RuntimeError):
    pass


@contextmanager
def no_network() -> Iterator[None]:
    """Refuse every httpx request in this process: reindex works from disk. Only the command
    uses it; a server calling `run()` must not lose its own network."""
    import httpx

    def refuse(*args, **kwargs):
        raise NetworkRefused("reindex is offline: a step tried to use the network")

    saved = (httpx.HTTPTransport.handle_request, httpx.AsyncHTTPTransport.handle_async_request)
    httpx.HTTPTransport.handle_request = refuse                       # type: ignore[method-assign]
    httpx.AsyncHTTPTransport.handle_async_request = refuse            # type: ignore[method-assign]
    try:
        yield
    finally:
        httpx.HTTPTransport.handle_request, httpx.AsyncHTTPTransport.handle_async_request = saved  # type: ignore[method-assign]


def format_rows(rows: list[dict]) -> str:
    if not rows:
        return "Nothing to reindex: no matching step, or nothing installed for it."
    return "\n".join(f"{r['step']:<24} {r['target']:<10} {r['status']:<7} {r['seconds']:>6.2f}s  {r['detail']}".rstrip()
                     for r in rows)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Rebuild derived data from the local stores, with no network.")
    parser.add_argument("--corpus", help="only steps for this corpus (see --list)")
    parser.add_argument("--title", type=int, help="only this title, for steps that run per title")
    parser.add_argument("--step", help="only the step with this name")
    parser.add_argument("--offline", action="store_true",
                        help="accepted for scripts: reindex never uses the network, with or without it")
    parser.add_argument("--list", action="store_true", help="list the registered steps and exit")
    parser.add_argument("--json", action="store_true", help="print the rows as JSON")
    args = parser.parse_args(argv)
    problems = discover()
    for p in problems:
        print(f"warning: could not import {p}", file=sys.stderr)
    if args.list:
        rows = [{"step": s.name, "corpus": s.corpus, "per_title": s.targets is not None, "summary": s.summary}
                for s in steps()]
        print(json.dumps(rows, indent=2) if args.json else
              "\n".join(f"{r['step']:<24} {r['corpus']:<8} {r['summary']}" for r in rows))
        return
    with no_network():
        rows = run(args.corpus, args.title, args.step)
    print(json.dumps(rows, indent=2) if args.json else format_rows(rows))
    if any(r["status"] == "failed" for r in rows):
        sys.exit(1)


if __name__ == "__main__":
    # Run the importable module, not this `__main__` copy: steps register against `app.reindex`.
    from app.reindex import main as _main
    _main()
