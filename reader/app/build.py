"""Download any CFR Title from the eCFR API and build the local reading database.

Usage:
    python -m app.build                # build Title 29 only if missing
    python -m app.build --force        # re-download Title 29
    python -m app.build --title 40     # build Title 40 (EPA)
    python -m app.build --title 49     # build Title 49 (DOT)
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sqlite3
import sys
import time
import tracemalloc
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote

import httpx

from . import config
from .render import element_to_text

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

LEAF_TYPES = {"section", "appendix"}


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
    reports wire bytes against Content-Length (eCFR sends the compressed length), or
    total=None when the server doesn't say."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest_path.with_suffix(dest_path.suffix + ".download")
    for attempt in range(4):
        try:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                length = response.headers.get("content-length")
                total = int(length) if length and length.isdigit() else None
                with open(tmp_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=1024 * 1024):  # 1MB chunks
                        f.write(chunk)
                        if on_bytes:
                            on_bytes(response.num_bytes_downloaded, total)
            tmp_path.replace(dest_path)
            return
        except (httpx.HTTPError, OSError) as exc:
            tmp_path.unlink(missing_ok=True)
            if attempt == 3:
                raise
            log(f"download retry ({attempt + 1}/3) after error: {exc}")
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def trim_tree(node: dict) -> dict:
    out = {
        "t": node["type"],
        "id": node.get("identifier"),
        "l": node.get("label_level") or node.get("label") or "",
        "d": (node.get("label_description") or "").strip(),
    }
    if node.get("reserved"):
        out["r"] = 1
    if node.get("descendant_range"):
        out["range"] = node["descendant_range"]
    kids = [trim_tree(c) for c in node.get("children") or []]
    if kids:
        out["c"] = kids
    return out


def nest_loose_sections(node: dict) -> dict:
    """eCFR's structure sometimes lists a subpart as an empty heading followed by its sections
    as siblings (29 CFR 1910 Subpart Z, Part 2520 Subparts D-F, 49 CFR 1201 Subpart B).
    Move those sections inside the subpart. An appendix is adopted only when its title names
    that subpart ("Appendix A to Subpart F of Part 2520"); "Appendix I to Part 1201" belongs
    to the part. Mutates and returns `node`."""
    kids = node.get("c")
    if not kids:
        return node
    out: list[dict] = []
    holder: dict | None = None   # the subpart just passed
    holder_was_empty = False     # only an empty heading adopts the plain sections after it
    for c in kids:
        if holder is not None and ((holder_was_empty and c["t"] == "section") or _appendix_of(c, holder)):
            holder.setdefault("c", []).append(c)
            continue
        if c["t"] == "subpart" and not c.get("r"):
            holder, holder_was_empty = c, not c.get("c")
        else:
            holder = None
        out.append(nest_loose_sections(c))
    node["c"] = out
    return node


def _appendix_of(node: dict, subpart: dict) -> bool:
    if node["t"] != "appendix":
        return False
    m = re.search(r"\bto Subpart\s+([A-Z0-9-]+)\b", f'{node.get("id") or ""} {node.get("l") or ""}')
    return bool(m) and m.group(1) == str(subpart.get("id"))


def normalize_scope(scope: dict | None) -> dict | None:
    """A partial install is {"parts": [ids], "sections": [{"t", "id", "part"}]}; None is the
    whole title. Sections inside a selected part are dropped (the part already holds them),
    duplicates collapse, and the lists are sorted so equal scopes compare equal."""
    if scope is None:
        return None
    parts = sorted({str(p) for p in scope.get("parts") or []})
    seen: dict[tuple[str, str], dict] = {}
    for s in scope.get("sections") or []:
        t, sid, part = s.get("t", "section"), str(s["id"]), str(s.get("part") or "")
        if t not in LEAF_TYPES or part in parts:
            continue
        seen[(t, sid)] = {"t": t, "id": sid, "part": part}
    return {"parts": parts, "sections": [seen[k] for k in sorted(seen)]}


def merge_scope(current: dict | None, add: dict | None) -> dict | None:
    """Union of two scopes; either being the whole title (None) makes the whole title."""
    if current is None or add is None:
        return None
    return normalize_scope({
        "parts": [*current.get("parts", []), *add.get("parts", [])],
        "sections": [*current.get("sections", []), *add.get("sections", [])],
    })


def prune_tree(tree: dict, scope: dict) -> dict:
    """Keep only the selected parts (whole) and sections (with their ancestors)."""
    parts = set(scope.get("parts") or [])
    leaves = {(s["t"], s["id"]) for s in scope.get("sections") or []}

    def keep(node: dict) -> dict | None:
        if node["t"] == "part" and str(node["id"]) in parts:
            return node
        if node["t"] in LEAF_TYPES:
            return node if (node["t"], str(node["id"])) in leaves else None
        kids = [k for k in (keep(c) for c in node.get("c", [])) if k is not None]
        if not kids:
            return None
        out = {k: v for k, v in node.items() if k != "c"}
        out["c"] = kids
        return out

    return keep(tree) or {k: v for k, v in tree.items() if k != "c"}


def count_leaves(node: dict) -> int:
    if node["t"] in LEAF_TYPES:
        return 1
    return sum(count_leaves(c) for c in node.get("c", []))


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


def _crumb(node: dict) -> dict:
    return {"t": node["t"], "id": node["id"], "l": node["l"], "d": node["d"]}


def leaf_paths(tree: dict) -> list[tuple[str, str]]:
    """(path JSON, id) for every leaf: the breadcrumb stored in sections.path."""
    out: list[tuple[str, str]] = []

    def walk(node: dict, ancestors: list[dict]) -> None:
        if node["t"] in LEAF_TYPES:
            out.append((json.dumps(ancestors), node["id"]))
            return
        nxt = ancestors + [_crumb(node)] if node["t"] != "title" else ancestors
        for child in node.get("c", []):
            walk(child, nxt)

    walk(tree, [])
    return out


def renest(title: int) -> int:
    """Apply `nest_loose_sections` to an installed title without downloading: rewrite its
    tree JSON and the breadcrumbs in its database. Returns the number of breadcrumbs changed."""
    tree_file = config.tree_path(title)
    db_file = config.db_path(title)
    if not tree_file.exists() or not db_file.exists():
        raise ValueError(f"Title {title} is not installed")
    tree = nest_loose_sections(json.loads(tree_file.read_text(encoding="utf-8")))
    con = sqlite3.connect(db_file)
    current = dict(con.execute("SELECT id, path FROM sections"))
    changed = [(p, i) for p, i in leaf_paths(tree) if current.get(i) not in (None, p)]
    con.executemany("UPDATE sections SET path = ? WHERE id = ?", changed)
    con.commit()
    con.close()
    payload = json.dumps(tree, separators=(",", ":"))
    tree_file.write_text(payload, encoding="utf-8")
    legacy = config.DATA_DIR / "tree.json"
    if title == 29 and legacy.exists() and legacy != tree_file:
        legacy.write_text(payload, encoding="utf-8")
    log(f"Title {title}: re-nested contents, {len(changed)} section breadcrumbs updated")
    return len(changed)


def ecfr_path(el: ET.Element) -> str | None:
    meta = el.get("hierarchy_metadata")
    if not meta:
        return None
    try:
        data = json.loads(html.unescape(html.unescape(meta)))
        return data.get("path", "").replace("/on/_SUBSTITUTE_DATE_", "/current") or None
    except (ValueError, AttributeError):
        return None


def front_matter_xml(el: ET.Element) -> str:
    """Authority, source, and notes that sit directly under a part or subpart."""
    keep = [c for c in el if not c.tag.startswith("DIV") and c.tag != "HEAD"]
    wrapper = ET.Element("FRONT")
    for c in keep:
        wrapper.append(c)
    return ET.tostring(wrapper, encoding="unicode") if keep else ""


def stream_parse_xml(xml_path: Path, con: sqlite3.Connection, on_leaf=None) -> dict[str, str]:
    """Parse XML with iterparse, streaming sections to staging SQLite table and flatlining RAM.
    Can be called once per downloaded piece; leaves accumulate in the same staging table.
    `on_leaf()` is called after each section or appendix (for progress)."""
    front: dict[str, str] = {}
    stack: list[ET.Element] = []
    batch: list[tuple] = []

    con.execute(
        "CREATE TEMP TABLE IF NOT EXISTS staging_leaves (kind TEXT, id TEXT, ecfr_path TEXT, xml TEXT, text TEXT, PRIMARY KEY(kind, id))"
    )

    with open(xml_path, "rb") as xml_file:
        context = ET.iterparse(xml_file, events=("start", "end"))
        for event, elem in context:
            if event == "start":
                stack.append(elem)
            elif event == "end":
                stack.pop()
                parent = stack[-1] if stack else None

                if elem.tag in ("DIV8", "DIV9"):
                    kind = "section" if elem.tag == "DIV8" else "appendix"
                    ident = elem.get("N")
                    elem.tail = None
                    p = ecfr_path(elem)
                    x = ET.tostring(elem, encoding="unicode")
                    t = element_to_text(elem)
                    batch.append((kind, ident, p, x, t))
                    if on_leaf:
                        on_leaf()
                    if len(batch) >= 500:
                        con.executemany("INSERT OR REPLACE INTO staging_leaves VALUES (?,?,?,?,?)", batch)
                        batch.clear()
                    elem.clear()
                    if parent is not None:
                        parent.remove(elem)
                elif elem.tag == "DIV6":
                    subpart = elem.get("N")
                    part = next((e.get("N") for e in reversed(stack) if e.tag == "DIV5"), None)
                    if part:
                        front[f"part/{part}/subpart/{subpart}"] = front_matter_xml(elem)
                    elem.clear()
                    if parent is not None:
                        parent.remove(elem)
                elif elem.tag == "DIV5":
                    part = elem.get("N")
                    front[f"part/{part}"] = front_matter_xml(elem)
                    elem.clear()
                    if parent is not None:
                        parent.remove(elem)

        del context

    if batch:
        con.executemany("INSERT OR REPLACE INTO staging_leaves VALUES (?,?,?,?,?)", batch)
        batch.clear()

    return front


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
                on_bytes = lambda got, total: report("Downloading text", got, total)
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
