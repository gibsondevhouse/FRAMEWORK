"""Download any CFR Title from the eCFR API and build the local reading database.

Usage:
    python -m app.build                # build Title 29 only if missing
    python -m app.build --force        # re-download Title 29
    python -m app.build --title 40     # build Title 40 (EPA)
    python -m app.build --title 49     # build Title 49 (DOT)
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
import tracemalloc
from pathlib import Path
from urllib.parse import quote

import httpx

from . import config
from .ingest import (LEAF_TYPES, count_leaves, ecfr_path, front_matter_xml,  # noqa: F401
                     leaf_paths, merge_scope, nest_loose_sections,
                     normalize_scope, prune_tree, stream_parse_xml, trim_tree)
from .ingest import tree as _tree
from .ingest.tree import _crumb  # noqa: F401  (used by build()'s walk)

# The eCFR API rejects requests that don't accept compressed responses (HTTP 406).
HEADERS = {"Accept-Encoding": "gzip, deflate", "User-Agent": "cfr-reader/2.0"}

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE sections (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,           -- 'section' or 'appendix'
    ord INTEGER NOT NULL,         -- reading order across the whole title
    part TEXT,
    label TEXT NOT NULL,          -- e.g. '§ 541.100'
    title TEXT NOT NULL,          -- e.g. 'General rule for executive employees.'
    reserved INTEGER NOT NULL,
    path TEXT NOT NULL,           -- JSON breadcrumb of ancestors
    ecfr_path TEXT,
    xml TEXT NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX sections_ord ON sections(ord);
CREATE INDEX sections_part ON sections(part);
CREATE TABLE front_matter (key TEXT PRIMARY KEY, xml TEXT NOT NULL);
CREATE VIRTUAL TABLE sections_fts USING fts5(
    id UNINDEXED, label, title, text, tokenize = 'porter unicode61'
);
"""

def log(msg: str) -> None:
    print(f"[build] {msg}", flush=True)


def fetch_json(client: httpx.Client, url: str) -> dict:
    for attempt in range(4):
        try:
            r = client.get(url)
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            if attempt == 3:
                raise
            log(f"retrying JSON after error ({attempt + 1}/3): {exc}")
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def download_stream(client: httpx.Client, url: str, dest_path: Path, on_bytes=None) -> None:
    """Stream a large file directly to disk to keep RAM flat. `on_bytes(received, total)`
    reports wire bytes against Content-Length (eCFR sends the compressed length) or, when the
    server doesn't say (eCFR's full-text XML is gzip-streamed without a length), the decoded
    bytes written so far with total=None."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest_path.with_suffix(dest_path.suffix + ".download")
    for attempt in range(4):
        try:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                length = response.headers.get("content-length")
                total = int(length) if length and length.isdigit() else None
                written = 0
                with open(tmp_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=1024 * 1024):  # 1MB chunks
                        f.write(chunk)
                        written += len(chunk)
                        if on_bytes:
                            on_bytes(response.num_bytes_downloaded if total else written, total)
            tmp_path.replace(dest_path)
            return
        except (httpx.HTTPError, OSError) as exc:
            tmp_path.unlink(missing_ok=True)
            if attempt == 3:
                raise
            log(f"download retry ({attempt + 1}/3) after error: {exc}")
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def _replace_with_retry(src: Path, dest: Path, before=None, attempts: int = 40) -> None:
    """Windows won't replace a file another handle has open (the server's SQLite connections
    and tree responses). `before()` asks those holders to let go; retry briefly until they do."""
    for i in range(attempts):
        if before:
            before()
        try:
            src.replace(dest)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.25)


def renest(title: int) -> int:
    """In-place re-nest of an installed title (see ingest.tree.renest); passes the
    patchable `log` so fake-title tests stay silent."""
    return _tree.renest(title, log=log)


def build(
    title: int = config.DEFAULT_TITLE,
    force: bool = False,
    keep_xml: bool = False,
    scope: dict | None = None,
    progress=None,
    before_install=None,
    measure_memory: bool = False,
) -> dict:
    """Build a local SQLite database and tree for any CFR title.

    `scope` limits the build to some parts and sections (see `normalize_scope`); None builds
    the whole title. `progress(phase, done, total)` reports each step (`done`/`total` may be
    None when a step can't be measured). `before_install()` runs right before the finished
    files replace the live ones, so a running server can close its handles on them.

    Returns summary metrics: {title, name, edition, section_count, elapsed_sec, db_size_mb, scope}.
    """
    report = progress or (lambda phase, done=None, total=None: None)
    start_time = time.perf_counter()
    if measure_memory:
        tracemalloc.start()
    scope = normalize_scope(scope)

    target_db = config.DATA_DIR / f"title-{title}.sqlite3"
    target_tree = config.DATA_DIR / f"tree-{title}.json"

    if target_db.exists() and not force:
        log(f"database already exists at {target_db} (use --force to rebuild)")
        if measure_memory:
            tracemalloc.stop()
        return {"title": title, "cached": True, "db_path": str(target_db)}

    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    xml_paths: list[Path] = []

    report("Checking eCFR")
    log(f"checking eCFR API for Title {title}...")
    timeout_cfg = httpx.Timeout(30.0, read=300.0, connect=30.0)
    with httpx.Client(headers=HEADERS, timeout=timeout_cfg, follow_redirects=True) as client:
        titles_resp = fetch_json(client, f"{config.ECFR_API}/titles.json")
        info = next((t for t in titles_resp.get("titles", []) if t["number"] == title), None)
        if not info:
            raise ValueError(f"Title {title} not found in official eCFR titles list")
        if info.get("reserved"):
            raise ValueError(f"Title {title} is reserved and has no text")

        edition = info["up_to_date_as_of"]
        title_name = info.get("name", f"Title {title}")
        log(f"latest Title {title} ({title_name}) edition: {edition}")

        report("Downloading contents")
        log("downloading structure JSON...")
        structure = fetch_json(client, f"{config.ECFR_API}/structure/{edition}/title-{title}.json")
        tree = nest_loose_sections(trim_tree(structure))
        if scope is not None:
            tree = prune_tree(tree, scope)
        leaf_total = count_leaves(tree)
        if scope is not None and not leaf_total:
            raise ValueError("None of the selected parts or sections exist in the current edition")

        base = f"{config.ECFR_API}/full/{edition}/title-{title}.xml"
        if scope is None:
            pieces = [(base, config.DATA_DIR / f"title-{title}.xml.tmp")]
        else:
            # One request per selected part, section or appendix. Appendix ids repeat across
            # parts ("Appendix A to Subpart B"), so they're asked for within their part.
            pieces = []
            for p in scope["parts"]:
                pieces.append((f"{base}?part={quote(p)}", None))
            for s in scope["sections"]:
                if s["t"] == "appendix":
                    q = f"part={quote(s['part'])}&appendix={quote(s['id'])}" if s["part"] else f"appendix={quote(s['id'])}"
                else:
                    q = f"section={quote(s['id'])}"
                pieces.append((f"{base}?{q}", None))
            pieces = [(u, config.DATA_DIR / f"title-{title}.piece{i}.xml.tmp") for i, (u, _) in enumerate(pieces)]

        log(f"downloading full text XML via streaming ({len(pieces)} request{'s' if len(pieces) != 1 else ''})...")
        for i, (url, path) in enumerate(pieces):
            if len(pieces) == 1:
                # Without a Content-Length, measure the XML written against the structure's own
                # size of the title's text (eCFR's `size`), so progress, speed and ETA are real.
                expected = structure.get("size") if scope is None else None
                on_bytes = lambda got, total: report("Downloading text", got, total or expected)
            else:
                on_bytes = None
                report("Downloading text", i, len(pieces))
            download_stream(client, url, path, on_bytes=on_bytes)
            xml_paths.append(path)
        report("Downloading text", 1, 1)

    log(f"parsing XML for Title {title} using iterparse (flat memory)...")
    tmp_db = target_db.with_suffix(".tmp")
    tmp_db.unlink(missing_ok=True)
    con = sqlite3.connect(tmp_db)
    con.executescript(SCHEMA)

    parsed = 0

    def on_leaf() -> None:
        nonlocal parsed
        parsed += 1
        if parsed % 200 == 0:
            report("Reading text", min(parsed, leaf_total), leaf_total)

    front: dict[str, str] = {}
    for path in xml_paths:
        front.update(stream_parse_xml(path, con, on_leaf=on_leaf))

    report("Indexing", 0, leaf_total)
    log("walking structure and ordering sections...")
    missing: list[str] = []
    rows: list[tuple] = []
    total_sections = 0

    def flush() -> None:
        nonlocal total_sections
        con.executemany("INSERT INTO sections VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
        con.executemany(
            "INSERT INTO sections_fts (id, label, title, text) VALUES (?,?,?,?)",
            [(x[0], x[4], x[5], x[10]) for x in rows],
        )
        total_sections += len(rows)
        rows.clear()
        report("Indexing", total_sections, leaf_total)

    def walk(node: dict, ancestors: list[dict]) -> None:
        if node["t"] in LEAF_TYPES:
            r = con.execute(
                "SELECT ecfr_path, xml, text FROM staging_leaves WHERE kind = ? AND id = ?",
                (node["t"], node["id"]),
            ).fetchone()
            if r is None:
                missing.append(node["id"])
                return
            part = next((a["id"] for a in reversed(ancestors) if a["t"] == "part"), None)
            ecfr_p, xml_s, text_s = r
            ord_num = total_sections + len(rows)
            rows.append((
                node["id"], node["t"], ord_num, part, node["l"], node["d"],
                1 if node.get("r") else 0, json.dumps(ancestors), ecfr_p,
                xml_s, text_s,
            ))
            if len(rows) >= 500:
                flush()
            return
        next_ancestors = ancestors + [_crumb(node)] if node["t"] != "title" else ancestors
        for child in node.get("c", []):
            walk(child, next_ancestors)

    walk(tree, [])
    if rows:
        flush()

    if missing:
        log(f"warning: {len(missing)} structure nodes had no XML text, e.g. {missing[:5]}")

    con.execute("DROP TABLE staging_leaves")
    con.executemany("INSERT INTO front_matter VALUES (?,?)", front.items())
    meta_rows = [
        ("edition", edition),
        ("built_at", time.strftime("%Y-%m-%dT%H:%M:%S")),
        ("section_count", str(total_sections)),
        ("title", str(title)),
        ("title_name", title_name),
    ]
    if scope is not None:
        meta_rows.append(("scope", json.dumps(scope)))
    con.executemany("INSERT INTO meta VALUES (?,?)", meta_rows)
    con.commit()
    con.close()

    report("Installing")
    tmp_tree = target_tree.with_suffix(".json.tmp")
    tmp_tree.write_text(json.dumps(tree, separators=(",", ":")), encoding="utf-8")
    _replace_with_retry(tmp_db, target_db, before_install)
    _replace_with_retry(tmp_tree, target_tree, before_install)

    # Title 29 also keeps the legacy file names some older code paths look for.
    if title == 29:
        import shutil
        for src, legacy in ((target_db, config.DATA_DIR / "title29.sqlite3"), (target_tree, config.DATA_DIR / "tree.json")):
            try:
                if legacy.exists():
                    shutil.copy2(src, legacy)
            except OSError:
                pass

    if not keep_xml:
        for path in xml_paths:
            path.unlink(missing_ok=True)

    elapsed = round(time.perf_counter() - start_time, 2)
    peak_mb = None
    if measure_memory:
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        peak_mb = round(peak / (1024 * 1024), 2)
    db_size_mb = round(target_db.stat().st_size / (1024 * 1024), 2)

    log(
        f"completed Title {title} ({title_name}) in {elapsed}s: "
        f"{total_sections} sections indexed, DB {db_size_mb} MB"
        + (f", peak RAM {peak_mb} MB" if peak_mb is not None else "")
    )

    return {
        "title": title,
        "name": title_name,
        "edition": edition,
        "section_count": total_sections,
        "elapsed_sec": elapsed,
        "peak_mb": peak_mb,
        "db_size_mb": db_size_mb,
        "scope": scope,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--title", type=int, default=config.DEFAULT_TITLE, help="CFR title number (1-50, default 29)")
    parser.add_argument("--force", action="store_true", help="re-download even if database exists")
    parser.add_argument("--keep-xml", action="store_true", help="keep temporary raw XML on disk")
    parser.add_argument("--renest", action="store_true",
                        help="fix subpart nesting in an installed title's contents, without downloading")
    args = parser.parse_args()

    if args.title < 1 or args.title > 50:
        parser.error("Title must be between 1 and 50")

    if args.renest:
        try:
            renest(args.title)
        except ValueError as exc:
            log(f"renest failed: {exc}")
            sys.exit(1)
        return

    try:
        build(title=args.title, force=args.force, keep_xml=args.keep_xml, measure_memory=True)
    except (httpx.HTTPError, ValueError) as exc:
        log(f"build failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
