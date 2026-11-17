"""SQLite store for OSHA news: Federal Register and DOL records in one table, with FTS5,
per-source sync status, and retention pruning.

The file name (`osha_news.sqlite3`) deliberately doesn't match `title-*.sqlite3`, so
`config.installed_titles()` and the library ignore it. Connections are short-lived:
`connect()` opens, sets the pragmas and ensures the schema, callers close with
`closing(...)` and commit explicitly. The worker writes rarely and requests are cheap
reads, so per-use connections leave no handles open (Windows can then delete the file).
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

from . import config, store

SCHEMA_VERSION = 1

SOURCES = ("federal_register", "federal_register_pi", "dol_osha")
CATEGORIES = ("rules", "rulemaking", "notices", "public_inspection", "enforcement")

SCHEMA = """
CREATE TABLE IF NOT EXISTS articles (
    guid TEXT PRIMARY KEY,           -- "fr:2026-17726" (published or PI), "dol-insp:306953084"
    source TEXT NOT NULL,            -- federal_register | federal_register_pi | dol_osha
    agency TEXT NOT NULL,
    category TEXT NOT NULL,          -- rules | rulemaking | notices | public_inspection | enforcement
    doc_type TEXT,
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    pdf_url TEXT,
    citation TEXT,                   -- "91 FR 55744"
    action TEXT,                     -- "Final rule."
    effective_on TEXT,               -- YYYY-MM-DD
    comments_close_on TEXT,          -- YYYY-MM-DD (proposed rules)
    scheduled_on TEXT,               -- YYYY-MM-DD (PI: when it will publish)
    published_at TEXT NOT NULL,      -- YYYY-MM-DD, always (sort key)
    description TEXT NOT NULL DEFAULT '',
    docket_ids TEXT NOT NULL DEFAULT '[]',
    company TEXT, city TEXT, state TEXT, naics TEXT,
    penalty_usd REAL,
    violation_types TEXT NOT NULL DEFAULT '[]',   -- JSON array, e.g. ["S","W"]
    general_duty INTEGER NOT NULL DEFAULT 0,      -- count of 5(a)(1) citations
    unmapped_standards INTEGER NOT NULL DEFAULT 0,-- cited standards with no CFR mapping (state plans)
    cfr_parts TEXT NOT NULL DEFAULT '[]',         -- JSON [{"title":29,"part":"42"}]
    sections TEXT NOT NULL DEFAULT '[]',          -- JSON ["1910.1030"]
    takeaways TEXT NOT NULL DEFAULT '[]',         -- JSON [{"key","label","text"}]
    fetched_at TEXT NOT NULL                      -- ISO timestamp of the last upsert
);
CREATE INDEX IF NOT EXISTS idx_articles_pub   ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat   ON articles(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_state ON articles(state);

CREATE TABLE IF NOT EXISTS article_citations (
    article_guid TEXT NOT NULL REFERENCES articles(guid) ON DELETE CASCADE,
    title_num INTEGER NOT NULL,
    part_id TEXT NOT NULL,
    section_id TEXT NOT NULL DEFAULT '',          -- '' = part-level reference
    PRIMARY KEY (article_guid, title_num, part_id, section_id)
);
CREATE INDEX IF NOT EXISTS idx_citations_sec  ON article_citations(title_num, section_id);
CREATE INDEX IF NOT EXISTS idx_citations_part ON article_citations(title_num, part_id);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
    guid UNINDEXED, title, description, company,
    tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS sync_status (
    source TEXT PRIMARY KEY,         -- federal_register | federal_register_pi | dol_osha
    last_ok_at TEXT,
    last_count INTEGER,
    last_error TEXT,                 -- short, user-facing; NULL after a success
    last_error_at TEXT,
    fail_count INTEGER NOT NULL DEFAULT 0   -- consecutive failures; drives backoff; 0 after a success
);
"""


def db_path() -> Path:
    """Read `config.DATA_DIR` at call time: tests patch it."""
    return config.DATA_DIR / "osha_news.sqlite3"


def retention_days() -> int:
    """How many days of news to keep; also the first FR sync's backfill window."""
    try:
        return max(1, int(os.getenv("NEWS_RETENTION_DAYS", "365").strip() or 365))
    except ValueError:
        return 365


def connect(readonly: bool = False) -> sqlite3.Connection | None:
    path = db_path()
    if readonly:
        if not path.exists():
            return None
        con: sqlite3.Connection | None = None
        try:
            con = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA busy_timeout=5000")
            con.execute("PRAGMA query_only=ON")
            version = con.execute("PRAGMA user_version").fetchone()[0]
            if version != SCHEMA_VERSION:
                con.close()
                return None
            return con
        except sqlite3.Error:
            if con is not None:
                try:
                    con.close()
                except Exception:
                    pass
            return None

    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=5.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=5000")
    version = con.execute("PRAGMA user_version").fetchone()[0]
    if version != SCHEMA_VERSION:
        if version:
            # The store is a cache of public data: on a schema mismatch, drop and let the
            # next sync refill it.
            con.executescript("DROP TABLE IF EXISTS article_citations;"
                              "DROP TABLE IF EXISTS articles_fts;"
                              "DROP TABLE IF EXISTS articles;"
                              "DROP TABLE IF EXISTS sync_status;")
        con.executescript(SCHEMA)
        con.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        con.commit()
    return con


@contextmanager
def read_con() -> Iterator[sqlite3.Connection | None]:
    """Short-lived read-only connection that yields None if the news DB is absent."""
    con = connect(readonly=True)
    try:
        yield con
    finally:
        if con is not None:
            con.close()


def init_db() -> None:
    with closing(connect()):
        pass


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

COLUMNS = ("guid source agency category doc_type title link pdf_url citation action effective_on "
           "comments_close_on scheduled_on published_at description docket_ids company city state "
           "naics penalty_usd violation_types general_duty unmapped_standards cfr_parts sections "
           "takeaways fetched_at").split()
JSON_COLUMNS = {"docket_ids", "violation_types", "cfr_parts", "sections", "takeaways"}

# A Public Inspection fetch must never overwrite the published record it became.
UPSERT = f"""
INSERT INTO articles ({", ".join(COLUMNS)}) VALUES ({", ".join("?" * len(COLUMNS))})
ON CONFLICT(guid) DO UPDATE SET
  {", ".join(f"{c} = excluded.{c}" for c in COLUMNS if c != "guid")}
WHERE NOT (excluded.source = 'federal_register_pi' AND articles.source = 'federal_register')
"""


def upsert_article(con: sqlite3.Connection, item: dict, now: datetime | None = None) -> bool:
    """Insert or replace one item. Returns False when skipped (PI over a published doc)."""
    item = {**item, "fetched_at": (now or datetime.now(timezone.utc)).isoformat()}
    row = [json.dumps(item.get(c) or []) if c in JSON_COLUMNS else item.get(c) for c in COLUMNS]
    cur = con.execute(UPSERT, row)
    if cur.rowcount == 0:
        return False
    guid = item["guid"]
    con.execute("DELETE FROM article_citations WHERE article_guid = ?", (guid,))
    con.executemany(
        "INSERT OR IGNORE INTO article_citations VALUES (?, ?, ?, '')",
        [(guid, int(r["title"]), str(r["part"])) for r in item.get("cfr_parts") or []],
    )
    # Section-level citations are Title 29 by construction while OSHA is the only agency.
    con.executemany(
        "INSERT OR IGNORE INTO article_citations VALUES (?, 29, ?, ?)",
        [(guid, s.split(".", 1)[0], s) for s in item.get("sections") or []],
    )
    con.execute("DELETE FROM articles_fts WHERE guid = ?", (guid,))
    con.execute("INSERT INTO articles_fts (guid, title, description, company) VALUES (?, ?, ?, ?)",
                (guid, item["title"], item.get("description") or "", item.get("company") or ""))
    return True


# ---------------------------------------------------------------------------
# Sync status & retention
# ---------------------------------------------------------------------------

def record_ok(con: sqlite3.Connection, source: str, count: int, now: datetime | None = None) -> None:
    iso = (now or datetime.now(timezone.utc)).isoformat()
    con.execute(
        """INSERT INTO sync_status (source, last_ok_at, last_count, last_error, last_error_at, fail_count)
           VALUES (?, ?, ?, NULL, NULL, 0)
           ON CONFLICT(source) DO UPDATE SET last_ok_at = excluded.last_ok_at,
             last_count = excluded.last_count, last_error = NULL, last_error_at = NULL, fail_count = 0""",
        (source, iso, count))


def record_error(con: sqlite3.Connection, source: str, message: str, now: datetime | None = None) -> None:
    """Leaves last_ok_at alone (the source stays stale) and increments fail_count, so the
    backoff survives a restart. `message` is short and safe to show the user."""
    iso = (now or datetime.now(timezone.utc)).isoformat()
    con.execute(
        """INSERT INTO sync_status (source, last_error, last_error_at, fail_count) VALUES (?, ?, ?, 1)
           ON CONFLICT(source) DO UPDATE SET last_error = excluded.last_error,
             last_error_at = excluded.last_error_at, fail_count = sync_status.fail_count + 1""",
        (source, message, iso))


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def sync_rows() -> dict[str, dict]:
    """{source: row} with timestamps parsed to aware UTC datetimes. Used by the worker and
    by /api/news/status with news_schedule."""
    with read_con() as con:
        if con is None:
            return {}
        try:
            rows = con.execute("SELECT * FROM sync_status").fetchall()
        except sqlite3.Error:
            return {}
    out: dict[str, dict] = {}
    for r in rows:
        d = dict(r)
        d["last_ok_at"] = _parse_dt(d.get("last_ok_at"))
        d["last_error_at"] = _parse_dt(d.get("last_error_at"))
        out[r["source"]] = d
    return out


def summary_for_title(title: int = 29) -> dict:
    """Lightweight read-only news summary for the Home snapshot (no DB creation or writes)."""
    empty = {"count": 0, "latest_title": None, "latest_date": None}
    if title != 29:
        return empty
    with read_con() as con:
        if con is None:
            return empty
        try:
            count = int(con.execute("SELECT count(*) FROM articles").fetchone()[0])
            row = con.execute(
                "SELECT title, published_at FROM articles ORDER BY published_at DESC, guid LIMIT 1"
            ).fetchone()
            return {
                "count": count,
                "latest_title": row["title"] if row else None,
                "latest_date": row["published_at"] if row else None,
            }
        except sqlite3.Error:
            return empty


def prune(con: sqlite3.Connection, today: date | None = None) -> None:
    """365-day retention, plus a 7-day cleanup of Public Inspection filings that were
    withdrawn or never matched a published document."""
    today = today or date.today()
    con.execute("DELETE FROM articles WHERE published_at < ?",
                ((today - timedelta(days=retention_days())).isoformat(),))
    con.execute(
        "DELETE FROM articles WHERE category = 'public_inspection' "
        "AND COALESCE(scheduled_on, published_at) < ?",
        ((today - timedelta(days=7)).isoformat(),))
    # FTS5 has no foreign keys; article_citations goes by cascade.
    con.execute("DELETE FROM articles_fts WHERE guid NOT IN (SELECT guid FROM articles)")


# ---------------------------------------------------------------------------
# Queries (the /api/news read side)
# ---------------------------------------------------------------------------

SNIPPET_OPEN, SNIPPET_CLOSE = "\x02", "\x03"   # the app's existing highlight sentinels
_SECTION_ID = re.compile(r"\d{1,4}\.\d+(?:-\d+)?[a-z]?")
_FR_CITATION = re.compile(r"(\d{1,3})\s*FR\s*([0-9]+)", re.IGNORECASE)


def _article(row: sqlite3.Row) -> dict:
    d = {k: row[k] for k in row.keys()}
    for c in JSON_COLUMNS:
        try:
            d[c] = json.loads(d.get(c) or "[]")
        except (TypeError, ValueError):
            d[c] = []
    d.pop("fetched_at", None)
    d.setdefault("snippet", None)
    return d


def _citation_filter(section: str | None, part: str | None, title: int) -> tuple[str, list]:
    if section:
        return ("EXISTS (SELECT 1 FROM article_citations c WHERE c.article_guid = a.guid "
                "AND c.title_num = ? AND (c.section_id = ? OR (c.section_id = '' AND c.part_id = ?)))",
                [title, section, section.split(".", 1)[0]])
    return ("EXISTS (SELECT 1 FROM article_citations c WHERE c.article_guid = a.guid "
            "AND c.title_num = ? AND c.part_id = ?)", [title, str(part)])


def query_articles(con: sqlite3.Connection, *, category: str = "all", q: str | None = None,
                   section: str | None = None, part: str | None = None, title: int = 29,
                   state: str | None = None, min_penalty: float | None = None,
                   gravity: str | None = None, limit: int = 30, offset: int = 0) -> dict:
    filters: list[str] = []
    params: list = []
    if category and category != "all":
        filters.append("a.category = ?")
        params.append(category)
    if state:
        filters.append("a.state = ?")
        params.append(state.upper())
    if min_penalty is not None:
        filters.append("a.penalty_usd >= ?")
        params.append(float(min_penalty))
    if gravity:
        filters.append("EXISTS (SELECT 1 FROM json_each(a.violation_types) WHERE value = ?)")
        params.append(gravity)
    if state or min_penalty is not None or gravity:
        filters.append("a.category = 'enforcement'")
    if section or part:
        sql, p = _citation_filter(section, part, title)
        filters.append(sql)
        params += p

    fts = None
    if q and q.strip():
        raw = q.strip()
        # Section-number and FR-citation queries match by id, not FTS (users type these,
        # and FTS tokenises "1910.1030" badly).
        sec_id = store.normalize_id(raw)
        fr_m = _FR_CITATION.fullmatch(raw)
        if _SECTION_ID.fullmatch(sec_id):
            sql, p = _citation_filter(sec_id, None, 29)
            filters.append(sql)
            params += p
        elif fr_m:
            filters.append("a.citation = ?")
            params.append(f"{int(fr_m.group(1))} FR {fr_m.group(2)}")
        else:
            fts = store.fts_query(raw)
            if fts is None:
                return {"articles": [], "total": 0, "offset": offset}

    where = (" WHERE " + " AND ".join(filters)) if filters else ""
    if fts:
        base = ("FROM articles_fts JOIN articles a ON a.guid = articles_fts.guid "
                f"WHERE articles_fts MATCH ?{' AND ' + ' AND '.join(filters) if filters else ''}")
        try:
            total = con.execute(f"SELECT count(*) {base}", [fts, *params]).fetchone()[0]
            rows = con.execute(
                f"SELECT a.*, snippet(articles_fts, 2, ?, ?, '…', 24) AS snippet {base} "
                "ORDER BY bm25(articles_fts, 0.0, 2.0, 1.0, 1.5), a.published_at DESC LIMIT ? OFFSET ?",
                [SNIPPET_OPEN, SNIPPET_CLOSE, fts, *params, limit, offset]).fetchall()
        except sqlite3.OperationalError:
            total, rows = 0, []
    else:
        total = con.execute(f"SELECT count(*) FROM articles a{where}", params).fetchone()[0]
        rows = con.execute(
            f"SELECT a.*, NULL AS snippet FROM articles a{where} "
            "ORDER BY a.published_at DESC, a.guid LIMIT ? OFFSET ?",
            [*params, limit, offset]).fetchall()
    return {"articles": [_article(r) for r in rows], "total": total, "offset": offset}


def category_counts(con: sqlite3.Connection) -> dict[str, int]:
    counts = {c: 0 for c in CATEGORIES}
    for cat, n in con.execute("SELECT category, count(*) FROM articles GROUP BY category"):
        if cat in counts:
            counts[cat] = n
    return {"all": sum(counts.values()), **counts}


def state_facets(con: sqlite3.Connection) -> list[dict]:
    rows = con.execute(
        "SELECT state, count(*) AS n FROM articles WHERE category = 'enforcement' "
        "AND state IS NOT NULL AND state != '' GROUP BY state ORDER BY state").fetchall()
    return [{"code": r["state"], "count": r["n"]} for r in rows]
