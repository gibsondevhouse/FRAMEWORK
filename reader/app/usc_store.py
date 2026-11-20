"""SQLite store for installed U.S. Code titles: `data/usc-{N}.sqlite3` + `data/usc-tree-{N}.json`.

One database per title, like the CFR (`title-{N}.sqlite3`); the `usc-` prefix keeps them
out of `config.installed_titles()` (which scans `title-*`). Tables:

- `meta`      release_point, built_at, section_count, note_count, source_url (the zip),
              release_page (where the release point was discovered), zip_sha256,
              xml_sha256, title, title_name, positive_law, publication, duplicate_ids.
- `sections`  id, identifier (USLM), kind, ord (reading order), chapter, label ('§ 1'),
              heading, path (JSON ancestors), status (repealed / omitted / transferred /
              renumbered / reserved / …, NULL when in force), xml (namespace-free USLM, notes
              removed), text (operative text only), source_credit.
- `notes`     QUIRK-006: editorial / statutory / executive notes kept apart from the section
              text. owner = section id (owner_kind 'section') or a level identifier
              ('/us/usc/t4/ch1', owner_kind 'chapter' / 'title' / …).
- `sections_fts` (label, heading, text) and `notes_fts` (heading, text), porter unicode61.

Reads use short-lived read-only connections (like `fr_store`), so a build can replace a
file without first asking a connection registry to let go.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from . import config, store

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE sections (
    id TEXT PRIMARY KEY,
    identifier TEXT,
    kind TEXT NOT NULL,
    ord INTEGER NOT NULL,
    chapter TEXT,
    label TEXT NOT NULL,
    heading TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT,
    xml TEXT NOT NULL,
    text TEXT NOT NULL,
    source_credit TEXT
);
CREATE INDEX sections_ord ON sections(ord);
CREATE INDEX sections_chapter ON sections(chapter);
CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    ord INTEGER NOT NULL,
    category TEXT NOT NULL,
    topic TEXT,
    heading TEXT,
    xml TEXT NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX notes_owner ON notes(owner, ord);
CREATE VIRTUAL TABLE sections_fts USING fts5(
    id UNINDEXED, label, heading, text, tokenize = 'porter unicode61'
);
CREATE VIRTUAL TABLE notes_fts USING fts5(
    owner UNINDEXED, heading, text, tokenize = 'porter unicode61'
);
"""

_FILE_RE = re.compile(r"^usc-(\d+)\.sqlite3$")
_cache_lock = threading.Lock()
# Keyed by DATA_DIR as well, so a test (or a reconfigured server) never sees another
# directory's titles.
_known_ids: dict[tuple[str, int], frozenset[str]] = {}
_installed: tuple[str, list[int]] | None = None


def db_path(title: int) -> Path:
    return config.DATA_DIR / f"usc-{int(title)}.sqlite3"


def tree_path(title: int) -> Path:
    return config.DATA_DIR / f"usc-tree-{int(title)}.json"


def installed_titles() -> list[int]:
    global _installed
    key = str(config.DATA_DIR)
    with _cache_lock:
        if _installed is not None and _installed[0] == key:
            return list(_installed[1])
    found: list[int] = []
    if config.DATA_DIR.exists():
        for f in config.DATA_DIR.iterdir():
            m = _FILE_RE.match(f.name)
            if m:
                found.append(int(m.group(1)))
    found.sort()
    with _cache_lock:
        _installed = (key, found)
    return list(found)


def clear_caches(title: int | None = None) -> None:
    """Forget cached title lists and section ids (after an install, removal or reload)."""
    global _installed
    with _cache_lock:
        _installed = None
        if title is None:
            _known_ids.clear()
        else:
            for k in [k for k in _known_ids if k[1] == int(title)]:
                _known_ids.pop(k, None)


@contextmanager
def read_con(title: int) -> Iterator[sqlite3.Connection | None]:
    p = db_path(title)
    if not p.exists():
        yield None
        return
    con = None
    try:
        con = sqlite3.connect(f"{p.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA busy_timeout=5000")
        con.execute("PRAGMA query_only=ON")
    except sqlite3.Error:
        if con is not None:
            con.close()
        con = None
    try:
        yield con
    finally:
        if con is not None:
            con.close()


def meta(title: int) -> dict[str, str]:
    with read_con(title) as con:
        if con is None:
            return {}
        return {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}


def known_ids(title: int) -> frozenset[str]:
    t = int(title)
    key = (str(config.DATA_DIR), t)
    with _cache_lock:
        if key in _known_ids:
            return _known_ids[key]
    ids: frozenset[str] = frozenset()
    with read_con(t) as con:
        if con is not None:
            try:
                ids = frozenset(r[0] for r in con.execute("SELECT id FROM sections"))
            except sqlite3.Error:
                return frozenset()          # transient: don't cache
    with _cache_lock:
        _known_ids[key] = ids
    return ids


def has_section(title: int, section: str) -> bool:
    """Cheap check used by the citation linkifier on every U.S.C. reference."""
    try:
        t = int(title)
    except (TypeError, ValueError):
        return False
    if t not in installed_titles():
        return False
    return section in known_ids(t)


def normalize_section_id(raw: str) -> str:
    """'§ 655', '29 U.S.C. 655(b)', '655' → '655'."""
    s = (raw or "").strip()
    s = re.sub(r"^\d+\s*U\.?\s*S\.?\s*C\.?\s*", "", s, flags=re.I)
    s = s.lstrip("§ ").strip()
    s = re.sub(r"\(.*$", "", s)
    return s.rstrip(".")


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def title_summary(title: int) -> dict | None:
    m = meta(title)
    if not m:
        return None
    return {
        "title": int(title),
        "name": m.get("title_name", ""),
        "release_point": m.get("release_point"),
        "built_at": m.get("built_at"),
        "section_count": int(m.get("section_count") or 0),
        "note_count": int(m.get("note_count") or 0),
        "positive_law": m.get("positive_law") == "1",
        "xml_sha256": m.get("xml_sha256"),
        "zip_sha256": m.get("zip_sha256"),
        "source_url": m.get("source_url"),
    }


def get_section(title: int, section_id: str) -> dict | None:
    with read_con(title) as con:
        if con is None:
            return None
        r = con.execute("SELECT * FROM sections WHERE id = ?", (section_id,)).fetchone()
        if r is None:
            return None
        d = dict(r)
        d["path"] = json.loads(d["path"] or "[]")
        prev = con.execute("SELECT id, label, heading FROM sections WHERE ord < ? ORDER BY ord DESC LIMIT 1",
                           (d["ord"],)).fetchone()
        nxt = con.execute("SELECT id, label, heading FROM sections WHERE ord > ? ORDER BY ord LIMIT 1",
                          (d["ord"],)).fetchone()
        d["prev"] = dict(prev) if prev else None
        d["next"] = dict(nxt) if nxt else None
        d["notes"] = [dict(n) for n in con.execute(
            "SELECT category, topic, heading, xml, text FROM notes WHERE owner = ? AND owner_kind = 'section' ORDER BY ord",
            (section_id,))]
        return d


def level_notes(title: int, path: list[str]) -> list[dict] | None:
    """Notes attached to the title itself (`path` empty) or to one chapter, subchapter, part …
    (`path` = the tree ids from the title down, e.g. ["ch21", "schI"]; DM-113 / FT-26).
    A level's notes are stored under its full USLM identifier ('/us/usc/t42/ch21/schI'), and a
    level's tree id is that identifier's last segment, so the path matches the segments after
    the title's. None when the title is not installed."""
    with read_con(title) as con:
        if con is None:
            return None
        pattern = "%/" + path[-1] if path else "%"
        rows = con.execute(
            "SELECT owner, category, topic, heading, xml, text FROM notes "
            "WHERE owner_kind != 'section' AND owner LIKE ? ORDER BY ord", (pattern,)).fetchall()
    want = [p for p in path if p]
    out = []
    for r in rows:
        segs = [x for x in r["owner"].split("/") if x]
        if len(segs) >= 3 and segs[:2] == ["us", "usc"] and segs[3:] == want:
            out.append({k: r[k] for k in ("category", "topic", "heading", "xml", "text")})
    return out


def search_title(title: int, q: str, limit: int = 30, include_notes: bool = False) -> tuple[int, list[dict]]:
    """Exact section number first, then FTS5 over sections (bm25 label 8 / heading 6 / text 1);
    `include_notes` also searches the notes and returns their owner sections."""
    results: list[dict] = []
    with read_con(title) as con:
        if con is None:
            return 0, []
        sid = normalize_section_id(q)
        if sid:
            r = con.execute("SELECT id, label, heading, status FROM sections WHERE id = ?", (sid,)).fetchone()
            if r is not None:
                results.append({**dict(r), "usc_title": int(title), "snippet": "", "exact": True})
        match = store.fts_query(q)
        total = 0
        if match:
            try:
                total = con.execute("SELECT count(*) FROM sections_fts WHERE sections_fts MATCH ?", (match,)).fetchone()[0]
                rows = con.execute(
                    "SELECT s.id, s.label, s.heading, s.status, "
                    "snippet(sections_fts, 3, char(2), char(3), ' … ', 28) AS snippet, "
                    "bm25(sections_fts, 0.0, 8.0, 6.0, 1.0) AS score "
                    "FROM sections_fts JOIN sections s ON s.id = sections_fts.id "
                    "WHERE sections_fts MATCH ? ORDER BY score, (s.status IS NOT NULL) LIMIT ?",
                    (match, limit),
                ).fetchall()
                if include_notes:
                    nrows = con.execute(
                        "SELECT s.id, s.label, s.heading, s.status, "
                        "snippet(notes_fts, 2, char(2), char(3), ' … ', 28) AS snippet, "
                        "bm25(notes_fts, 0.0, 4.0, 1.0) + 5.0 AS score "
                        "FROM notes_fts JOIN sections s ON s.id = notes_fts.owner "
                        "WHERE notes_fts MATCH ? ORDER BY score LIMIT ?",
                        (match, limit),
                    ).fetchall()
                    rows = sorted([*rows, *nrows], key=lambda r: r["score"])
            except sqlite3.OperationalError:
                rows = []
            seen = {r["id"] for r in results}
            for r in rows:
                if r["id"] not in seen:
                    seen.add(r["id"])
                    results.append({"id": r["id"], "label": r["label"], "heading": r["heading"],
                                    "status": r["status"], "usc_title": int(title), "snippet": r["snippet"],
                                    "exact": False, "score": r["score"]})
    return total, results[:limit]


def search(q: str, title: int | None = None, limit: int = 20) -> dict:
    titles = [int(title)] if title else installed_titles()
    out: list[dict] = []
    total = 0
    for t in titles:
        n, res = search_title(t, q, limit=limit)
        total += n
        out += res
    out.sort(key=lambda r: (not r.get("exact"), r.get("score", 0.0)))
    return {"installed": bool(installed_titles()), "total": total, "results": out[:limit]}
