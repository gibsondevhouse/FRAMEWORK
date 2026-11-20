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
import logging
import re
import sqlite3
import sys
import threading
import time
import tracemalloc
from contextlib import closing
from pathlib import Path
from urllib.parse import quote

import httpx

from . import config, migrate
from .ingest import (LEAF_TYPES, count_leaves, disambiguate_leaf_ids,  # noqa: F401
                     ecfr_path, front_matter_xml, leaf_paths, merge_scope,
                     nest_loose_sections, normalize_scope, prune_tree,
                     raw_leaf_id, stream_parse_xml, trim_tree)
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

logger = logging.getLogger("framework.build")


def log(msg: str) -> None:
    if not logger.handlers and not logging.getLogger().handlers:
        print(f"[build] {msg}", flush=True)
    else:
        logger.info("[build] %s", msg)


ECFR_MIN_INTERVAL_SEC = 0.15
_ecfr_pace_lock = threading.Lock()
_ecfr_last_call = 0.0


def _pace_ecfr() -> None:
    """Gentle inter-request pacer for real eCFR calls (keeps burst scope downloads polite)."""
    global _ecfr_last_call
    with _ecfr_pace_lock:
        now = time.monotonic()
        wait = ECFR_MIN_INTERVAL_SEC - (now - _ecfr_last_call)
        if wait > 0:
            time.sleep(wait)
        _ecfr_last_call = time.monotonic()


def _retry_delay(exc: Exception, attempt: int) -> float | None:
    """Return backoff seconds for transient errors, or None for non-retryable 4xx."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 429:
            ra = (exc.response.headers.get("retry-after") or "").strip()
            try:
                return max(1.0, min(60.0, float(ra)))
            except ValueError:
                return min(60.0, 5.0 * (attempt + 1))
        if 400 <= code < 500 and code != 408:
            return None
    return 2.0 * (attempt + 1)


def fetch_json(client: httpx.Client, url: str) -> dict:
    for attempt in range(4):
        try:
            _pace_ecfr()
            r = client.get(url)
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            delay = None if attempt == 3 else _retry_delay(exc, attempt)
            if delay is None:
                raise
            log(f"retrying JSON after error ({attempt + 1}/3): {exc}")
            time.sleep(delay)
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
            _pace_ecfr()
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
            delay = None if attempt == 3 else _retry_delay(exc, attempt)
            if delay is None:
                raise
            log(f"download retry ({attempt + 1}/3) after error: {exc}")
            time.sleep(delay)
    raise RuntimeError("unreachable")


def file_sha256(path: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def provenance_rows(base_url: str, structure_url: str, structure: dict,
                    piece_hashes: list[tuple[str, str]], fetched_at: str) -> list[tuple[str, str]]:
    """meta rows recording where a build's inputs came from and what they hashed to.

    - `source_url`: the full-text XML URL (`?part=`/`?section=` pieces share it as base).
    - `xml_sha256`: SHA-256 of the downloaded XML file (decoded bytes as written to disk);
      with several pieces, the SHA-256 of a manifest of `url<TAB>sha256` lines
      (`xml_sha256_kind` = `file` | `manifest`, pieces listed in `xml_pieces`).
    - `structure_sha256`: SHA-256 of the structure JSON in canonical form (sorted keys,
      compact separators), since `fetch_json` hands back parsed JSON, not bytes.
    - `fetched_at`: UTC time the structure (and then the XML) was fetched.
    Titles built before these rows existed simply lack them; readers report "unknown"."""
    import hashlib
    canon = json.dumps(structure, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    rows = [
        ("source_url", base_url),
        ("structure_url", structure_url),
        ("structure_sha256", hashlib.sha256(canon.encode("utf-8")).hexdigest()),
        ("fetched_at", fetched_at),
    ]
    if len(piece_hashes) == 1:
        rows += [("xml_sha256", piece_hashes[0][1]), ("xml_sha256_kind", "file")]
    else:
        manifest = "".join(f"{u}\t{h}\n" for u, h in piece_hashes)
        rows += [("xml_sha256", hashlib.sha256(manifest.encode("utf-8")).hexdigest()),
                 ("xml_sha256_kind", "manifest"),
                 ("xml_pieces", json.dumps([{"url": u, "sha256": h} for u, h in piece_hashes]))]
    return rows


_SQLITE_SIDECARS = ("-journal", "-wal", "-shm")


def _settle_interrupted_write(dest: Path) -> None:
    """A writer that died mid-transaction leaves `<store>-journal` behind, and SQLite applies
    a journal to whatever file carries the store's name: a new store renamed into place would
    get the old one's pages back. A read-write open of the old store rolls it back first."""
    if dest.suffix != ".sqlite3" or not any(dest.with_name(dest.name + s).exists() for s in _SQLITE_SIDECARS):
        return
    try:
        with closing(sqlite3.connect(dest, timeout=5.0)) as con:
            con.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except sqlite3.Error:
        pass                      # not a database, or held: what is left is removed after the swap


def _replace_with_retry(src: Path, dest: Path, before=None, attempts: int = 40) -> None:
    """Windows won't replace a file another handle has open (the server's SQLite connections
    and tree responses). `before()` asks those holders to let go; retry briefly until they do.

    When `dest` is a SQLite store, nothing the old file left beside it (a journal, a WAL)
    survives to be applied to the new one."""
    _settle_interrupted_write(dest)
    for i in range(attempts):
        if before:
            before()
        try:
            src.replace(dest)
            break
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.25)
    if dest.suffix == ".sqlite3":
        for s in _SQLITE_SIDECARS:
            try:
                dest.with_name(dest.name + s).unlink()
            except OSError:
                pass


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
    edition: str | None = None,
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

        edition = edition or info["up_to_date_as_of"]
        title_name = info.get("name", f"Title {title}")
        log(f"latest Title {title} ({title_name}) edition: {edition}")

        report("Downloading contents")
        log("downloading structure JSON...")
        structure_url = f"{config.ECFR_API}/structure/{edition}/title-{title}.json"
        structure = fetch_json(client, structure_url)
        fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        tree = disambiguate_leaf_ids(nest_loose_sections(trim_tree(structure)))
        if scope is not None:
            tree = prune_tree(tree, scope)
            # Keep only parts/sections that actually exist in the pruned tree so invalid
            # requests don't trigger 404 piece downloads or persist in meta.scope.
            present_parts: set[str] = set()
            present_leaves: set[tuple[str, str, str]] = set()

            def _collect_present(node: dict, cur_part: str = "") -> None:
                if node["t"] == "part":
                    cur_part = str(node["id"])
                    present_parts.add(cur_part)
                elif node["t"] in LEAF_TYPES:
                    nid = str(node["id"])
                    present_leaves.add((node["t"], cur_part, nid))
                    present_leaves.add((node["t"], cur_part, raw_leaf_id(nid, cur_part)))
                    return
                for c in node.get("c", []):
                    _collect_present(c, cur_part)

            _collect_present(tree)
            scope = normalize_scope({
                "parts": [p for p in scope["parts"] if p in present_parts],
                "sections": [
                    s for s in scope["sections"]
                    if (s["t"], s["part"], s["id"]) in present_leaves
                ],
            })
        leaf_total = count_leaves(tree)
        if scope is not None and not leaf_total:
            raise ValueError("None of the selected parts or sections exist in the current edition")

        base = f"{config.ECFR_API}/full/{edition}/title-{title}.xml"
        if scope is None:
            pieces = [(base, config.DATA_DIR / f"title-{title}.xml.tmp", "")]
        else:
            # One request per selected part, section or appendix. Appendix ids repeat across
            # parts ("Appendix A to Subpart B"), so they're asked for within their part.
            raw_pieces: list[tuple[str, str]] = []
            for p in scope["parts"]:
                raw_pieces.append((f"{base}?part={quote(p)}", p))
            for s in scope["sections"]:
                raw_sid = raw_leaf_id(s["id"], s["part"])
                if s["t"] == "appendix":
                    q = f"part={quote(s['part'])}&appendix={quote(raw_sid)}" if s["part"] else f"appendix={quote(raw_sid)}"
                else:
                    q = f"section={quote(raw_sid)}"
                raw_pieces.append((f"{base}?{q}", s["part"]))
            pieces = [
                (u, config.DATA_DIR / f"title-{title}.piece{i}.xml.tmp", p_hint)
                for i, (u, p_hint) in enumerate(raw_pieces)
            ]

        log(f"downloading full text XML via streaming ({len(pieces)} request{'s' if len(pieces) != 1 else ''})...")
        piece_parts: list[str] = []
        piece_hashes: list[tuple[str, str]] = []
        for i, (url, path, p_hint) in enumerate(pieces):
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
            piece_parts.append(p_hint)
            piece_hashes.append((url, file_sha256(path)))
        report("Downloading text", 1, 1)

    log(f"parsing XML for Title {title} using iterparse (flat memory)...")
    tmp_db = target_db.with_suffix(".tmp")
    tmp_db.unlink(missing_ok=True)
    try:
        with closing(sqlite3.connect(tmp_db)) as con:
            con.executescript(SCHEMA)

            parsed = 0

            def on_leaf() -> None:
                nonlocal parsed
                parsed += 1
                if parsed % 200 == 0:
                    report("Reading text", min(parsed, leaf_total), leaf_total)

            front: dict[str, str] = {}
            for path, p_hint in zip(xml_paths, piece_parts):
                front.update(stream_parse_xml(path, con, on_leaf=on_leaf, default_part=p_hint))

            report("Indexing", 0, leaf_total)
            log("walking structure and ordering sections...")
            missing: list[str] = []
            reserved_skipped = 0
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
                nonlocal reserved_skipped
                if node["t"] in LEAF_TYPES:
                    part = next((a["id"] for a in reversed(ancestors) if a["t"] == "part"), None)
                    raw_id = raw_leaf_id(str(node["id"]), part)
                    r = con.execute(
                        "SELECT ecfr_path, xml, text FROM staging_leaves WHERE kind = ? AND part = ? AND id = ?",
                        (node["t"], part or "", raw_id),
                    ).fetchone()
                    if r is None and part:
                        r = con.execute(
                            "SELECT ecfr_path, xml, text FROM staging_leaves WHERE kind = ? AND part = '' AND id = ?",
                            (node["t"], raw_id),
                        ).fetchone()
                    if r is None:
                        if node.get("r"):
                            reserved_skipped += 1
                        else:
                            missing.append(str(node["id"]))
                        return
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
                log(f"warning: {len(missing)} non-reserved structure nodes had no XML text, e.g. {missing[:5]}")
            if total_sections == 0:
                raise ValueError(f"No XML content matched Title {title} structure")

            con.execute("DROP TABLE staging_leaves")
            con.executemany("INSERT INTO front_matter VALUES (?,?)", front.items())
            meta_rows = [
                ("edition", edition),
                ("built_at", time.strftime("%Y-%m-%dT%H:%M:%S")),
                ("section_count", str(total_sections)),
                ("title", str(title)),
                ("title_name", title_name),
                ("missing_leaves", str(len(missing))),
            ]
            if missing:
                meta_rows.append(("missing_sample", json.dumps(missing[:10])))
            meta_rows += provenance_rows(base, structure_url, structure, piece_hashes, fetched_at)
            if scope is not None:
                meta_rows.append(("scope", json.dumps(scope)))
            con.executemany("INSERT INTO meta VALUES (?,?)", meta_rows)
            from .citations import graph
            graph.persist_title_index(con, title)
            migrate.stamp(con, "cfr")
            con.commit()
    except Exception:
        tmp_db.unlink(missing_ok=True)
        if not keep_xml:
            for path in xml_paths:
                path.unlink(missing_ok=True)
        raise

    report("Installing")
    tmp_tree = target_tree.with_suffix(".json.tmp")
    tmp_tree.write_text(json.dumps(tree, separators=(",", ":")), encoding="utf-8")
    release = before_install
    if release is None:
        # No server-side swap coordinator (CLI or tests): still close this process's cached
        # read handles first, because Windows refuses to replace a file that is open.
        from . import store

        def release() -> None:
            store.release_title(title)
    _replace_with_retry(tmp_db, target_db, release)
    _replace_with_retry(tmp_tree, target_tree, release)
    if before_install is None:
        store.release_title(title)

    # Title 29 also keeps the legacy file names some older code paths look for.
    if title == 29:
        import shutil
        for src, legacy in ((target_db, config.DATA_DIR / "title29.sqlite3"), (target_tree, config.DATA_DIR / "tree.json")):
            if legacy.exists():
                legacy_tmp = legacy.with_suffix(legacy.suffix + ".tmp")
                try:
                    shutil.copy2(src, legacy_tmp)
                    _replace_with_retry(legacy_tmp, legacy, before_install)
                except OSError:
                    legacy_tmp.unlink(missing_ok=True)

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
