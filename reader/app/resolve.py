"""`python -m app.resolve "<citation or id>"`: citation → canonical id → store row → route (TL-23).

A debugging tool over `app.ids`. It prints the canonical id, the citation, where the unit
lives, whether that row is in this install, the app route and the official source address.

    python -m app.resolve "29 CFR 1910.134(a)(1)"
    python -m app.resolve "reg://federal/usc/42/2000e-2"
    python -m app.resolve --title 29 "§ 1910.134"      # a bare section needs its CFR title
    python -m app.resolve --json "91 FR 60123"

A string holding several citations ("29 U.S.C. 653, 655, and 657") prints each one. The
lookup is local and read-only: no network, and a store that isn't installed is reported,
never created. Exit status: 0 when the text resolved, 2 when it is not a citation or id.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

from . import config, ids

_ROW_LABELS = {
    "cfr": ("label", "title"), "usc": ("label", "heading"), "fr": ("citation", "title"),
    "constitution": ("label",), "plaw": ("citation", "title"), "agenda": ("rin", "edition", "title"),
}


def database_path(key: ids.StoreKey) -> Path:
    if key.corpus == "cfr":
        return config.db_path(key.title)          # honours the legacy Title 29 file name
    return config.DATA_DIR / key.database


def lookup(ref: ids.Ref) -> dict:
    """{installed, rows, error?}: the row or rows a ref points at in this install."""
    key = ids.to_store_key(ref)
    path = database_path(key)
    if not path.exists():
        return {"installed": False, "rows": []}
    sql, params = key.select()
    try:
        with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)) as con:
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA query_only=ON")
            return {"installed": True, "rows": [dict(r) for r in con.execute(sql, params)]}
    except sqlite3.Error as exc:
        return {"installed": True, "rows": [], "error": type(exc).__name__}


def report(ref: ids.Ref) -> dict:
    """`ids.describe` plus what this install holds. A Federal Register page citation that
    falls inside a stored document also gets that document's id and route."""
    out = ids.describe(ref)
    found = lookup(ref)
    out.update(installed=found["installed"], rows=found["rows"])
    if "error" in found:
        out["error"] = found["error"]
    if ref.kind == "page" and found["rows"]:
        doc = ids.fr_document(found["rows"][0]["document_number"])
        out["document"] = {"id": doc.id, "route": ids.to_route(doc), "url": ids.to_url(doc)}
    return out


def resolve_text(text: str, default_title: int | None = None) -> list[ids.Ref]:
    """One ref for an id or a single citation; otherwise every citation found in the text."""
    try:
        return [ids.resolve(text, default_title)]
    except ids.IdError:
        found = ids.find_citations(text, default_title) if isinstance(text, str) else []
        if not found:
            raise
        return found


def _row_text(corpus: str, row: dict) -> str:
    return " ".join(str(row[c]) for c in _ROW_LABELS[corpus] if row.get(c))[:160]


def format_report(r: dict) -> str:
    store = r["store"]
    where = " and ".join(f"{col} = {val!r}" for col, val in store["where"].items())
    if "page_within" in store:
        low, high, page = store["page_within"]
        where += f" and {low} <= {page} <= {high}"
    if not r["installed"]:
        row = "not installed"
    elif r.get("error"):
        row = f"unreadable ({r['error']})"
    elif not r["rows"]:
        row = "no such row in the installed copy"
    elif len(r["rows"]) == 1:
        row = _row_text(r["corpus"], r["rows"][0])
    else:
        row = f"{len(r['rows'])} rows, first: {_row_text(r['corpus'], r['rows'][0])}"
    lines = [
        ("id", r["address"]),
        ("kind", f"{r['corpus']} {r['kind']}"),
        ("citation", r["citation"]),
        ("store", f"{store['database']} · {store['table']} · {where}"),
        ("row", row),
        ("route", r["route"] or "none (a page citation; see document)"),
        ("source", r["url"] or "none"),
    ]
    if "document" in r:
        lines.insert(5, ("document", f"{r['document']['id']} → {r['document']['route']}"))
    return "\n".join(f"{name:<9} {value}" for name, value in lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.resolve",
                                description="Resolve a citation or canonical id to its id, store row and route.")
    p.add_argument("text", help='a citation ("29 CFR 1910.134(a)") or an id ("reg://federal/…")')
    p.add_argument("--title", type=int, default=None, help='the CFR title a bare "§ 1910.134" belongs to')
    p.add_argument("--json", action="store_true", help="print JSON")
    a = p.parse_args(argv)
    try:
        refs = resolve_text(a.text, a.title)
    except ids.IdError as exc:
        print(f"not resolved: {exc}", file=sys.stderr)
        return 2
    reports = [report(r) for r in refs]
    if a.json:
        print(json.dumps({"query": a.text, "matches": reports}, indent=2, ensure_ascii=False))
    else:
        print("\n\n".join(format_report(r) for r in reports))
    return 0


if __name__ == "__main__":
    sys.exit(main())
