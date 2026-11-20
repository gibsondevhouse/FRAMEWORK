"""SQLite store for the Federal Register corpus (`data/fr.sqlite3`).

The CFR keeps one database per title; the Federal Register is one corpus, so it gets one
database. The file name deliberately doesn't match `title-*.sqlite3`, so
`config.installed_titles()` and the library's title scan ignore it.

Tables (schema below, `PRAGMA user_version = SCHEMA_VERSION`):

- `meta`            key/value: source, schema, built_at, updated_at, window_start,
                    window_end, titles (JSON), doc_count, last_ok_at, fail_count,
                    last_error_at, last_error.
- `documents`       one row per FR document, keyed by `document_number`, with the API
                    record verbatim in `raw_json` plus its provenance: `raw_sha256`
                    (SHA-256 of the canonical JSON), `source_url` (the documents.json page
                    it came from) and `fetched_at`. `content_changed_at` moves only when
                    the hash changes, so a re-sync can tell real amendments from no-ops.
- `document_bodies` the full text, fetched lazily (`fr_build.fetch_body`): the raw
                    payload as served, its format (`xml` | `html`), extracted plain text,
                    `sha256` of the served bytes, `byte_len`, `source_url`, `fetched_at`.
- `document_cfr`    document → CFR (title, part, section) links. `section` is '' for a
                    part-level link. `source` says where the link came from: `reference`
                    (the API's cfr_references), `text` (citations in title/abstract/action),
                    `body` (citations in the fetched full text).
- `coverage`        which (title, start, end) date ranges were fetched, with counts.
- `build_chunks`    the (title, month) chunks a full build has completed, committed with
                    their documents, so an interrupted build resumes where it stopped.
- `documents_fts`   FTS5 over title / abstract / action / body (porter unicode61),
                    keyed by the documents rowid.

Connections are short-lived, like `news_store`: `connect()` opens and ensures the schema
(writers), `read_con()` yields a read-only connection or None when the corpus isn't
built, so GET endpoints never create an empty file.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from . import config, fr_client, store
from .citations.parser import FR_RE as _FR_CITATION

SCHEMA_VERSION = 1
SOURCE = "federalregister.gov/api/v1"

# Builds swap the database file and body fetches write into it; both hold this lock so a
# body write never lands in a file that is about to be replaced.
WRITE_LOCK = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS documents (
    document_number TEXT PRIMARY KEY,
    type TEXT,
    title TEXT NOT NULL,
    abstract TEXT,
    action TEXT,
    dates TEXT,
    agencies_json TEXT NOT NULL DEFAULT '[]',
    agency_slugs TEXT NOT NULL DEFAULT '',      -- ' slug-a slug-b ' for exact-word filtering
    publication_date TEXT,
    effective_on TEXT,
    comments_close_on TEXT,
    signing_date TEXT,
    cfr_references_json TEXT NOT NULL DEFAULT '[]',
    docket_ids_json TEXT NOT NULL DEFAULT '[]',
    rins_json TEXT NOT NULL DEFAULT '[]',
    citation TEXT,                              -- '91 FR 69092'
    volume INTEGER,
    start_page INTEGER,
    end_page INTEGER,
    page_length INTEGER,
    html_url TEXT,
    pdf_url TEXT,
    full_text_xml_url TEXT,
    body_html_url TEXT,
    raw_text_url TEXT,
    raw_json TEXT NOT NULL,
    raw_sha256 TEXT NOT NULL,
    source_url TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    content_changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_pub ON documents(publication_date);
CREATE INDEX IF NOT EXISTS documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS documents_page ON documents(volume, start_page);
CREATE TABLE IF NOT EXISTS document_bodies (
    document_number TEXT PRIMARY KEY REFERENCES documents(document_number) ON DELETE CASCADE,
    format TEXT NOT NULL,                       -- 'xml' | 'html'
    content TEXT NOT NULL,                      -- as served (xml) or sanitized (html)
    text TEXT NOT NULL,
    sha256 TEXT NOT NULL,                       -- of the bytes as served
    byte_len INTEGER NOT NULL,
    source_url TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_cfr (
    document_number TEXT NOT NULL REFERENCES documents(document_number) ON DELETE CASCADE,
    title INTEGER NOT NULL,
    part TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,                       -- 'reference' | 'text' | 'body'
    PRIMARY KEY (document_number, title, part, section, source)
);
CREATE INDEX IF NOT EXISTS document_cfr_lookup ON document_cfr(title, part, section);
CREATE TABLE IF NOT EXISTS coverage (
    title INTEGER NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    doc_count INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (title, start, end)
);
CREATE TABLE IF NOT EXISTS build_chunks (    -- (title, month) chunks a build has finished
    title INTEGER NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    docs INTEGER NOT NULL,
    done_at TEXT NOT NULL,
    PRIMARY KEY (title, start, end)
);
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title, abstract, action, body, tokenize = 'porter unicode61'
);
"""

_DOC_NUM_QUERY = re.compile(r"^\s*(?:FR\s+Doc\.?\s*)?(\d{4}-\d{3,6})\s*$", re.IGNORECASE)


def db_path() -> Path:
    return config.DATA_DIR / "fr.sqlite3"


def tmp_path() -> Path:
    return config.DATA_DIR / "fr.sqlite3.tmp"


def exists() -> bool:
    return db_path().exists()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def init_schema(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)
    con.execute(f"PRAGMA user_version={SCHEMA_VERSION}")


def connect(readonly: bool = False, path: Path | None = None) -> sqlite3.Connection | None:
    """Writers get a connection with the schema ensured. `readonly=True` returns None when
    the corpus is absent or on another schema version (GETs stay empty, never 500)."""
    p = path or db_path()
    if readonly:
        if not p.exists():
            return None
        con: sqlite3.Connection | None = None
        try:
            con = sqlite3.connect(f"{p.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA busy_timeout=5000")
            con.execute("PRAGMA query_only=ON")
            if con.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
                con.close()
                return None
            return con
        except sqlite3.Error:
            if con is not None:
                con.close()
            return None
    p.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(p, timeout=10.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=10000")
    con.execute("PRAGMA foreign_keys=ON")
    init_schema(con)
    return con


@contextmanager
def read_con() -> Iterator[sqlite3.Connection | None]:
    con = connect(readonly=True)
    try:
        yield con
    finally:
        if con is not None:
            con.close()


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

def get_meta(con: sqlite3.Connection) -> dict[str, str]:
    return {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}


def set_meta(con: sqlite3.Connection, values: dict[str, object]) -> None:
    con.executemany(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [(k, None if v is None else (v if isinstance(v, str) else json.dumps(v))) for k, v in values.items()],
    )


def read_meta() -> dict[str, str]:
    with read_con() as con:
        return get_meta(con) if con is not None else {}


# ---------------------------------------------------------------------------
# Mapping and upsert
# ---------------------------------------------------------------------------

def canonical_json(doc: dict) -> str:
    """Stable serialization of an API record, so equal content hashes equally."""
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _opt_int(v) -> int | None:
    try:
        return int(v) if v is not None and str(v).strip() != "" else None
    except (TypeError, ValueError):
        return None


def _list(v) -> list:
    return v if isinstance(v, list) else []


def document_row(doc: dict) -> dict:
    """API record → `documents` column values (provenance columns are added by upsert)."""
    agencies = [
        {k: a.get(k) for k in ("name", "raw_name", "slug", "id", "parent_id") if a.get(k) is not None}
        for a in _list(doc.get("agencies")) if isinstance(a, dict)
    ]
    slugs = [a["slug"] for a in agencies if a.get("slug")]
    refs = [
        {"title": _opt_int(r.get("title")), "part": str(r.get("part")).strip()}
        for r in _list(doc.get("cfr_references"))
        if isinstance(r, dict) and _opt_int(r.get("title")) and str(r.get("part") or "").strip()
    ]
    return {
        "document_number": str(doc["document_number"]).strip(),
        "type": doc.get("type"),
        "title": (doc.get("title") or "").strip(),
        "abstract": (doc.get("abstract") or "").strip() or None,
        "action": (doc.get("action") or "").strip() or None,
        "dates": (doc.get("dates") or "").strip() or None,
        "agencies_json": json.dumps(agencies),
        "agency_slugs": (" " + " ".join(slugs) + " ") if slugs else "",
        "publication_date": (doc.get("publication_date") or "")[:10] or None,
        "effective_on": doc.get("effective_on"),
        "comments_close_on": doc.get("comments_close_on"),
        "signing_date": doc.get("signing_date"),
        "cfr_references_json": json.dumps(refs),
        "docket_ids_json": json.dumps([str(x) for x in _list(doc.get("docket_ids"))]),
        "rins_json": json.dumps([str(x) for x in _list(doc.get("regulation_id_numbers"))]),
        "citation": doc.get("citation"),
        "volume": _opt_int(doc.get("volume")),
        "start_page": _opt_int(doc.get("start_page")),
        "end_page": _opt_int(doc.get("end_page")),
        "page_length": _opt_int(doc.get("page_length")),
        "html_url": doc.get("html_url"),
        "pdf_url": doc.get("pdf_url"),
        "full_text_xml_url": doc.get("full_text_xml_url"),
        "body_html_url": doc.get("body_html_url"),
        "raw_text_url": doc.get("raw_text_url"),
    }


_DOC_COLS = list(document_row({"document_number": "x"}).keys())
_ALL_COLS = _DOC_COLS + ["raw_json", "raw_sha256", "source_url", "fetched_at",
                         "first_seen_at", "content_changed_at"]


def _cfr_links(row: dict, text: str, source: str) -> set[tuple[int, str, str, str]]:
    from . import news  # the shared all-title citation extractor
    links: set[tuple[int, str, str, str]] = set()
    if source == "reference":
        for r in json.loads(row["cfr_references_json"]):
            links.add((int(r["title"]), str(r["part"]), "", "reference"))
        return links
    secs, parts = news.extract_all_citations(text)
    for s in secs:
        links.add((int(s["title"]), s["id"].split(".", 1)[0], s["id"], source))
    for p in parts:
        links.add((int(p["title"]), str(p["part"]), "", source))
    return links


def _write_cfr_links(con: sqlite3.Connection, doc_num: str, links: set, sources: tuple[str, ...]) -> None:
    con.execute(
        f"DELETE FROM document_cfr WHERE document_number = ? AND source IN ({','.join('?' * len(sources))})",
        (doc_num, *sources),
    )
    con.executemany(
        "INSERT OR IGNORE INTO document_cfr (document_number, title, part, section, source) VALUES (?,?,?,?,?)",
        [(doc_num, t, p, s, src) for (t, p, s, src) in links],
    )


def _write_fts(con: sqlite3.Connection, doc_num: str) -> None:
    row = con.execute(
        "SELECT d.rowid AS rid, d.title, d.abstract, d.action, b.text AS body "
        "FROM documents d LEFT JOIN document_bodies b USING (document_number) "
        "WHERE d.document_number = ?",
        (doc_num,),
    ).fetchone()
    if row is None:
        return
    con.execute("DELETE FROM documents_fts WHERE rowid = ?", (row["rid"],))
    con.execute(
        "INSERT INTO documents_fts (rowid, title, abstract, action, body) VALUES (?,?,?,?,?)",
        (row["rid"], row["title"] or "", row["abstract"] or "", row["action"] or "", row["body"] or ""),
    )


def upsert_documents(
    con: sqlite3.Connection,
    docs: list[dict],
    source_url: str,
    fetched_at: str | None = None,
) -> dict[str, int]:
    """Insert or update API records. A record whose canonical-JSON SHA-256 is unchanged
    only has its `fetched_at`/`source_url` refreshed. Returns
    {"inserted", "changed", "unchanged", "skipped"}."""
    fetched_at = fetched_at or now_iso()
    counts = {"inserted": 0, "changed": 0, "unchanged": 0, "skipped": 0}
    for doc in docs:
        if not isinstance(doc, dict) or not str(doc.get("document_number") or "").strip():
            counts["skipped"] += 1
            continue
        if not fr_client.DOC_NUM_RE.fullmatch(str(doc["document_number"]).strip()):
            counts["skipped"] += 1
            continue
        raw = canonical_json(doc)
        digest = fr_client.sha256_hex(raw)
        row = document_row(doc)
        num = row["document_number"]
        prev = con.execute(
            "SELECT raw_sha256, first_seen_at FROM documents WHERE document_number = ?", (num,)
        ).fetchone()
        if prev is not None and prev["raw_sha256"] == digest:
            con.execute(
                "UPDATE documents SET fetched_at = ?, source_url = ? WHERE document_number = ?",
                (fetched_at, source_url, num),
            )
            counts["unchanged"] += 1
            continue
        values = {**row, "raw_json": raw, "raw_sha256": digest, "source_url": source_url,
                  "fetched_at": fetched_at,
                  "first_seen_at": prev["first_seen_at"] if prev is not None else fetched_at,
                  "content_changed_at": fetched_at}
        updates = ", ".join(f"{c} = excluded.{c}" for c in _ALL_COLS if c not in ("document_number", "first_seen_at"))
        con.execute(
            f"INSERT INTO documents ({', '.join(_ALL_COLS)}) VALUES ({', '.join('?' * len(_ALL_COLS))}) "
            f"ON CONFLICT(document_number) DO UPDATE SET {updates}",
            [values[c] for c in _ALL_COLS],
        )
        text = " ".join(x for x in (row["title"], row["abstract"], row["action"]) if x)
        links = _cfr_links(row, "", "reference") | _cfr_links(row, text, "text")
        _write_cfr_links(con, num, links, ("reference", "text"))
        _write_fts(con, num)
        counts["changed" if prev is not None else "inserted"] += 1
    return counts


def record_coverage(con: sqlite3.Connection, title: int, start: str, end: str, doc_count: int,
                    fetched_at: str | None = None) -> None:
    con.execute(
        "INSERT INTO coverage (title, start, end, doc_count, fetched_at) VALUES (?,?,?,?,?) "
        "ON CONFLICT(title, start, end) DO UPDATE SET doc_count = excluded.doc_count, fetched_at = excluded.fetched_at",
        (int(title), start, end, int(doc_count), fetched_at or now_iso()),
    )


def save_body(con: sqlite3.Connection, doc_num: str, fmt: str, content: str, text: str,
              sha256: str, byte_len: int, source_url: str, fetched_at: str | None = None) -> None:
    con.execute(
        "INSERT INTO document_bodies (document_number, format, content, text, sha256, byte_len, source_url, fetched_at) "
        "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(document_number) DO UPDATE SET format = excluded.format, "
        "content = excluded.content, text = excluded.text, sha256 = excluded.sha256, "
        "byte_len = excluded.byte_len, source_url = excluded.source_url, fetched_at = excluded.fetched_at",
        (doc_num, fmt, content, text, sha256, int(byte_len), source_url, fetched_at or now_iso()),
    )
    row = {"cfr_references_json": "[]"}
    _write_cfr_links(con, doc_num, _cfr_links(row, text, "body"), ("body",))
    _write_fts(con, doc_num)


def refresh_counts(con: sqlite3.Connection) -> None:
    n = con.execute("SELECT count(*) FROM documents").fetchone()[0]
    last = con.execute("SELECT max(publication_date) FROM documents").fetchone()[0]
    set_meta(con, {"doc_count": str(n), "last_publication_date": last or ""})


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

_LIST_COLS = ("document_number, type, title, abstract, action, publication_date, effective_on, "
              "comments_close_on, citation, html_url, agencies_json, cfr_references_json")


def _summary(r: sqlite3.Row, snippet: str | None = None) -> dict:
    return {
        "document_number": r["document_number"],
        "type": r["type"],
        "title": r["title"],
        "abstract": r["abstract"],
        "action": r["action"],
        "publication_date": r["publication_date"],
        "effective_on": r["effective_on"],
        "comments_close_on": r["comments_close_on"],
        "citation": r["citation"],
        "html_url": r["html_url"],
        "agencies": [a.get("name") or a.get("raw_name") for a in json.loads(r["agencies_json"] or "[]")],
        "cfr_references": json.loads(r["cfr_references_json"] or "[]"),
        "snippet": snippet or "",
    }


def _filters(type_: str | None, agency: str | None, title: int | None, part: str | None,
             since: str | None, until: str | None, alias: str = "d") -> tuple[list[str], list]:
    where: list[str] = []
    params: list = []
    if type_:
        where.append(f"{alias}.type = ?")
        params.append(type_)
    if agency:
        where.append(f"{alias}.agency_slugs LIKE ?")
        params.append(f"% {agency.strip()} %")
    if since:
        where.append(f"{alias}.publication_date >= ?")
        params.append(since)
    if until:
        where.append(f"{alias}.publication_date <= ?")
        params.append(until)
    if title is not None:
        clause = f"EXISTS (SELECT 1 FROM document_cfr c WHERE c.document_number = {alias}.document_number AND c.title = ?"
        params.append(int(title))
        if part:
            clause += " AND c.part = ?"
            params.append(str(part))
        where.append(clause + ")")
    return where, params


def search(
    con: sqlite3.Connection,
    q: str | None = None,
    type_: str | None = None,
    agency: str | None = None,
    title: int | None = None,
    part: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """Search the corpus. Fast paths: a document number (`2026-22306`) and an FR citation
    (`91 FR 69092`, matched against each document's page range). Otherwise FTS5 with
    bm25 weighted title 3 / abstract 1.5 / action 1 / body 1; no `q` lists newest first."""
    where, params = _filters(type_, agency, title, part, since, until)
    q = (q or "").strip()
    exact: list[dict] = []
    if q:
        m = _DOC_NUM_QUERY.match(q)
        if m:
            r = con.execute(f"SELECT {_LIST_COLS} FROM documents WHERE document_number = ?", (m.group(1),)).fetchone()
            if r is not None:
                exact.append({**_summary(r), "exact": True})
        cm = _FR_CITATION.search(q)
        if cm and not exact:
            vol, page = int(cm.group(1)), int(cm.group(2))
            rows = con.execute(
                f"SELECT {_LIST_COLS} FROM documents WHERE volume = ? AND start_page <= ? "
                "AND coalesce(end_page, start_page) >= ? ORDER BY start_page DESC LIMIT 5",
                (vol, page, page),
            ).fetchall()
            exact += [{**_summary(r), "exact": True} for r in rows]
    match = store.fts_query(q) if q else None
    if q and not match:
        return {"total": len(exact), "results": exact}
    clause = (" AND " + " AND ".join(where)) if where else ""
    try:
        if match:
            total = con.execute(
                "SELECT count(*) FROM documents_fts f JOIN documents d ON d.rowid = f.rowid "
                f"WHERE documents_fts MATCH ?{clause}", [match, *params],
            ).fetchone()[0]
            rows = con.execute(
                f"SELECT {', '.join('d.' + c.strip() for c in _LIST_COLS.split(','))}, "
                "snippet(documents_fts, -1, char(2), char(3), ' … ', 24) AS snip, "
                "bm25(documents_fts, 3.0, 1.5, 1.0, 1.0) AS score "
                "FROM documents_fts f JOIN documents d ON d.rowid = f.rowid "
                f"WHERE documents_fts MATCH ?{clause} ORDER BY score, d.publication_date DESC LIMIT ? OFFSET ?",
                [match, *params, limit, offset],
            ).fetchall()
            results = [_summary(r, r["snip"]) for r in rows]
        else:
            w = (" WHERE " + " AND ".join(where)) if where else ""
            total = con.execute(f"SELECT count(*) FROM documents d{w}", params).fetchone()[0]
            rows = con.execute(
                f"SELECT {', '.join('d.' + c.strip() for c in _LIST_COLS.split(','))} FROM documents d{w} "
                "ORDER BY d.publication_date DESC, d.document_number DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
            results = [_summary(r) for r in rows]
    except sqlite3.OperationalError:
        return {"total": len(exact), "results": exact}
    seen = {e["document_number"] for e in exact}
    return {"total": total + len(exact), "results": exact + [r for r in results if r["document_number"] not in seen]}


def get_document(con: sqlite3.Connection, doc_num: str, include_body: bool = False) -> dict | None:
    r = con.execute("SELECT * FROM documents WHERE document_number = ?", (doc_num,)).fetchone()
    if r is None:
        return None
    d = dict(r)
    for key, out in (("agencies_json", "agencies"), ("cfr_references_json", "cfr_references"),
                     ("docket_ids_json", "docket_ids"), ("rins_json", "regulation_id_numbers")):
        d[out] = json.loads(d.pop(key) or "[]")
    d.pop("agency_slugs", None)
    d.pop("raw_json", None)
    d["provenance"] = {
        "source": SOURCE,
        "source_url": d.pop("source_url"),
        "raw_sha256": d.pop("raw_sha256"),
        "fetched_at": d.pop("fetched_at"),
        "first_seen_at": d.pop("first_seen_at"),
        "content_changed_at": d.pop("content_changed_at"),
    }
    d["cfr_links"] = [
        dict(x) for x in con.execute(
            "SELECT title, part, section, group_concat(source) AS sources FROM document_cfr "
            "WHERE document_number = ? GROUP BY title, part, section ORDER BY title, part, section",
            (doc_num,),
        )
    ]
    b = con.execute(
        "SELECT format, sha256, byte_len, source_url, fetched_at"
        + (", content, text" if include_body else "")
        + " FROM document_bodies WHERE document_number = ?",
        (doc_num,),
    ).fetchone()
    d["body"] = dict(b) if b is not None else None
    return d


def by_cfr(con: sqlite3.Connection, title: int, part: str, section: str | None = None,
           limit: int = 50, offset: int = 0) -> dict:
    """Documents linked to a CFR part, or to a section (exact section links plus the
    part-level links of its part, which is how the API's cfr_references are expressed)."""
    if section:
        cond = "c.title = ? AND c.part = ? AND (c.section = ? OR c.section = '')"
        params: list = [int(title), str(part), section]
    else:
        cond = "c.title = ? AND c.part = ?"
        params = [int(title), str(part)]
    sub = f"SELECT DISTINCT c.document_number FROM document_cfr c WHERE {cond}"
    total = con.execute(f"SELECT count(*) FROM ({sub})", params).fetchone()[0]
    rows = con.execute(
        f"SELECT {_LIST_COLS} FROM documents WHERE document_number IN ({sub}) "
        "ORDER BY publication_date DESC, document_number DESC LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    return {"total": total, "results": [_summary(r) for r in rows]}


def status() -> dict:
    """Corpus state for /api/fr/status; `installed: False` on a fresh install."""
    with read_con() as con:
        if con is None:
            return {"installed": False, "doc_count": 0, "body_count": 0, "titles": [], "meta": {}}
        meta = get_meta(con)
        docs = con.execute("SELECT count(*) FROM documents").fetchone()[0]
        bodies = con.execute("SELECT count(*) FROM document_bodies").fetchone()[0]
        cov = [dict(r) for r in con.execute(
            "SELECT title, min(start) AS start, max(end) AS end, sum(doc_count) AS fetched, count(*) AS chunks "
            "FROM coverage GROUP BY title ORDER BY title")]
    try:
        titles = json.loads(meta.get("titles") or "[]")
    except ValueError:
        titles = []
    return {"installed": True, "doc_count": docs, "body_count": bodies, "titles": titles,
            "coverage": cov, "meta": meta}
