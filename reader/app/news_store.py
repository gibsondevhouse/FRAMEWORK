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
from .citations.parser import FR_RE as _FR_CITATION, SEC_NUM

SCHEMA_VERSION = 4

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
    title, description, company,
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

CREATE TABLE IF NOT EXISTS enforcement_cases (
    activity_nr INTEGER PRIMARY KEY,
    details_json TEXT NOT NULL DEFAULT '{}',
    violations_json TEXT NOT NULL DEFAULT '[]',
    events_json TEXT NOT NULL DEFAULT '[]',
    gdc_json TEXT NOT NULL DEFAULT '[]',
    accidents_json TEXT NOT NULL DEFAULT '[]',
    related_json TEXT NOT NULL DEFAULT '[]',
    enrich_ver INTEGER NOT NULL DEFAULT 0,
    enriched_mod_date TEXT,
    enriched_at TEXT,
    fetched_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS enforcement_narratives_fts USING fts5(
    activity_nr UNINDEXED,
    kind UNINDEXED,
    ref_id UNINDEXED,
    body_text,
    tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS dol_datasets (
    slug TEXT PRIMARY KEY,
    agency TEXT NOT NULL DEFAULT '',
    dataset TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    frequency TEXT,
    probe_status TEXT NOT NULL DEFAULT 'unprobed',
    fields_json TEXT NOT NULL DEFAULT '[]',
    cfr_title INTEGER,
    cfr_parts_json TEXT NOT NULL DEFAULT '[]',
    raw_json TEXT NOT NULL DEFAULT '{}',
    discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fr_bodies (
    document_number TEXT PRIMARY KEY,
    body_html TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
"""

_FR_BODIES_DDL = """
CREATE TABLE IF NOT EXISTS fr_bodies (
    document_number TEXT PRIMARY KEY,
    body_html TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
"""

_DOL_DATASETS_DDL = """
CREATE TABLE IF NOT EXISTS dol_datasets (
    slug TEXT PRIMARY KEY,
    agency TEXT NOT NULL DEFAULT '',
    dataset TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    frequency TEXT,
    probe_status TEXT NOT NULL DEFAULT 'unprobed',
    fields_json TEXT NOT NULL DEFAULT '[]',
    cfr_title INTEGER,
    cfr_parts_json TEXT NOT NULL DEFAULT '[]',
    raw_json TEXT NOT NULL DEFAULT '{}',
    discovered_at TEXT NOT NULL
);
"""

_FR_BODIES_DDL = """
CREATE TABLE IF NOT EXISTS fr_bodies (
    document_number TEXT PRIMARY KEY,
    body_html TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
"""

_ENFORCEMENT_CASE_DDL = """
CREATE TABLE IF NOT EXISTS enforcement_cases (
    activity_nr INTEGER PRIMARY KEY,
    details_json TEXT NOT NULL DEFAULT '{}',
    violations_json TEXT NOT NULL DEFAULT '[]',
    events_json TEXT NOT NULL DEFAULT '[]',
    gdc_json TEXT NOT NULL DEFAULT '[]',
    accidents_json TEXT NOT NULL DEFAULT '[]',
    related_json TEXT NOT NULL DEFAULT '[]',
    enrich_ver INTEGER NOT NULL DEFAULT 0,
    enriched_mod_date TEXT,
    enriched_at TEXT,
    fetched_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS enforcement_narratives_fts USING fts5(
    activity_nr UNINDEXED,
    kind UNINDEXED,
    ref_id UNINDEXED,
    body_text,
    tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS dol_datasets (
    slug TEXT PRIMARY KEY,
    agency TEXT NOT NULL DEFAULT '',
    dataset TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    frequency TEXT,
    probe_status TEXT NOT NULL DEFAULT 'unprobed',
    fields_json TEXT NOT NULL DEFAULT '[]',
    cfr_title INTEGER,
    cfr_parts_json TEXT NOT NULL DEFAULT '[]',
    raw_json TEXT NOT NULL DEFAULT '{}',
    discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fr_bodies (
    document_number TEXT PRIMARY KEY,
    body_html TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
"""

_FR_BODIES_DDL = """
CREATE TABLE IF NOT EXISTS fr_bodies (
    document_number TEXT PRIMARY KEY,
    body_html TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
"""


def db_path() -> Path:
    """Read `config.DATA_DIR` at call time: tests patch it."""
    return config.DATA_DIR / "osha_news.sqlite3"


def retention_days() -> int:
    """How many days of news to keep; also the first FR sync's backfill window. A saved
    source selection (`app/sources`, news → "Keep news for") wins over NEWS_RETENTION_DAYS."""
    from .sources import selection
    saved = selection.saved()
    if saved is not None:
        days = saved["sources"]["news"]["scope"].get("retention_days")
        if isinstance(days, int) and days > 0:
            return days
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
    if version in (1, 2, 3):
        if version == 1:
            con.executescript(_ENFORCEMENT_CASE_DDL)
            con.executescript(
                "DROP TABLE IF EXISTS articles_fts;"
                "CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5("
                "  title, description, company, tokenize = 'porter unicode61'"
                ");"
                "INSERT INTO articles_fts (rowid, title, description, company) "
                "SELECT rowid, title, description, company FROM articles;"
            )
        cols = {r[1] for r in con.execute("PRAGMA table_info(enforcement_cases)").fetchall()}
        if "related_json" not in cols:
            con.execute("ALTER TABLE enforcement_cases ADD COLUMN related_json TEXT NOT NULL DEFAULT '[]'")
        if "enrich_ver" not in cols:
            con.execute("ALTER TABLE enforcement_cases ADD COLUMN enrich_ver INTEGER NOT NULL DEFAULT 0")
        if "enriched_mod_date" not in cols:
            con.execute("ALTER TABLE enforcement_cases ADD COLUMN enriched_mod_date TEXT")
        con.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS enforcement_narratives_fts USING fts5("
            "  activity_nr UNINDEXED, kind UNINDEXED, ref_id UNINDEXED, body_text,"
            "  tokenize = 'porter unicode61'"
            ")"
        )
        con.execute(_DOL_DATASETS_DDL)
        con.execute(_FR_BODIES_DDL)
        con.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        con.commit()
    elif version != SCHEMA_VERSION:
        if version:
            # The store is a cache of public data: on a schema mismatch, drop and let the
            # next sync refill it.
            con.executescript("DROP TABLE IF EXISTS fr_bodies;"
                              "DROP TABLE IF EXISTS dol_datasets;"
                              "DROP TABLE IF EXISTS enforcement_narratives_fts;"
                              "DROP TABLE IF EXISTS enforcement_cases;"
                              "DROP TABLE IF EXISTS article_citations;"
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
    title_sections = item.get("_title_sections")
    if title_sections is not None:
        con.executemany(
            "INSERT OR IGNORE INTO article_citations VALUES (?, ?, ?, ?)",
            [(guid, int(ts["title"]), str(ts["id"]).split(".", 1)[0], str(ts["id"])) for ts in title_sections],
        )
        # Keep any Title 29 DOL/manual sections that didn't originate from multi-title prose extraction.
        known_secs = {str(ts["id"]) for ts in title_sections}
        extra_29 = [s for s in (item.get("sections") or []) if s not in known_secs]
        if extra_29:
            con.executemany(
                "INSERT OR IGNORE INTO article_citations VALUES (?, 29, ?, ?)",
                [(guid, s.split(".", 1)[0], s) for s in extra_29],
            )
    else:
        con.executemany(
            "INSERT OR IGNORE INTO article_citations VALUES (?, 29, ?, ?)",
            [(guid, s.split(".", 1)[0], s) for s in item.get("sections") or []],
        )
    rid = con.execute("SELECT rowid FROM articles WHERE guid = ?", (guid,)).fetchone()[0]
    con.execute("DELETE FROM articles_fts WHERE rowid = ?", (rid,))
    con.execute(
        "INSERT INTO articles_fts (rowid, title, description, company) VALUES (?, ?, ?, ?)",
        (rid, item["title"], item.get("description") or "", item.get("company") or ""),
    )
    if item.get("source") == "dol_osha" and item.get("inspection_detail") is not None:
        save_enforcement_case(
            con,
            int(item["inspection_detail"]["activity_nr"]),
            details=item["inspection_detail"],
            violations=item.get("violations_list") or [],
            now=now,
        )
    return True


def save_enforcement_case(
    con: sqlite3.Connection,
    activity_nr: int,
    *,
    details: dict,
    violations: list[dict],
    events: list[dict] | None = None,
    gdc: list[dict] | None = None,
    accidents: list[dict] | None = None,
    related: list[dict] | None = None,
    enrich_ver: int | None = None,
    enriched_mod_date: str | None = None,
    enriched_at: str | None = None,
    now: datetime | None = None,
) -> None:
    """Persist structured DOL inspection details and individual citation rows."""
    fetched_iso = (now or datetime.now(timezone.utc)).isoformat()
    if enriched_at is None and any(x is not None for x in (events, gdc, accidents, related)):
        enriched_at = fetched_iso
    if enrich_ver is None and related is not None:
        enrich_ver = 1
    if enriched_mod_date is None and enriched_at is not None:
        enriched_mod_date = (details or {}).get("case_mod_date")
    con.execute(
        """INSERT INTO enforcement_cases
             (activity_nr, details_json, violations_json, events_json, gdc_json, accidents_json,
              related_json, enrich_ver, enriched_mod_date, enriched_at, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(activity_nr) DO UPDATE SET
             details_json = excluded.details_json,
             violations_json = excluded.violations_json,
             events_json = CASE WHEN ? THEN excluded.events_json ELSE enforcement_cases.events_json END,
             gdc_json = CASE WHEN ? THEN excluded.gdc_json ELSE enforcement_cases.gdc_json END,
             accidents_json = CASE WHEN ? THEN excluded.accidents_json ELSE enforcement_cases.accidents_json END,
             related_json = CASE WHEN ? THEN excluded.related_json ELSE enforcement_cases.related_json END,
             enrich_ver = CASE WHEN ? THEN excluded.enrich_ver ELSE enforcement_cases.enrich_ver END,
             enriched_mod_date = CASE WHEN ? THEN excluded.enriched_mod_date ELSE enforcement_cases.enriched_mod_date END,
             enriched_at = COALESCE(excluded.enriched_at, enforcement_cases.enriched_at),
             fetched_at = excluded.fetched_at""",
        (
            int(activity_nr),
            json.dumps(details or {}),
            json.dumps(violations or []),
            json.dumps(events or []),
            json.dumps(gdc or []),
            json.dumps(accidents or []),
            json.dumps(related or []),
            int(enrich_ver or 0),
            enriched_mod_date,
            enriched_at,
            fetched_iso,
            1 if events is not None else 0,
            1 if gdc is not None else 0,
            1 if accidents is not None else 0,
            1 if related is not None else 0,
            1 if enrich_ver is not None else 0,
            1 if enriched_mod_date is not None else 0,
        ),
    )
    if gdc is not None or accidents is not None:
        con.execute("DELETE FROM enforcement_narratives_fts WHERE activity_nr = ?", (int(activity_nr),))
        row = con.execute(
            "SELECT gdc_json, accidents_json FROM enforcement_cases WHERE activity_nr = ?",
            (int(activity_nr),),
        ).fetchone()
        if row is not None:
            fts_rows: list[tuple[int, str, str, str]] = []
            for g in _json_load(row["gdc_json"], []):
                txt = str(g.get("text") or "").strip()
                if txt:
                    fts_rows.append((int(activity_nr), "gdc", str(g.get("citation_id") or ""), txt))
            for ac in _json_load(row["accidents_json"], []):
                parts = [
                    str(ac.get("event_desc") or "").strip(),
                    str(ac.get("keywords") or "").strip(),
                    "fatality" if ac.get("fatality") else "",
                    str(ac.get("abstract") or "").strip(),
                ]
                body = " ".join(p for p in parts if p)
                if body:
                    fts_rows.append((int(activity_nr), "accident", str(ac.get("summary_nr") or ""), body))
            if fts_rows:
                con.executemany(
                    "INSERT INTO enforcement_narratives_fts (activity_nr, kind, ref_id, body_text) VALUES (?, ?, ?, ?)",
                    fts_rows,
                )


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
    with read_con() as con:
        if con is None:
            return empty
        try:
            if title == 29:
                where = (
                    "WHERE source = 'dol_osha' OR agency = 'occupational-safety-and-health-administration' "
                    "OR EXISTS (SELECT 1 FROM article_citations c WHERE c.article_guid = articles.guid AND c.title_num = 29)"
                )
                params: tuple = ()
            else:
                where = "WHERE EXISTS (SELECT 1 FROM article_citations c WHERE c.article_guid = articles.guid AND c.title_num = ?)"
                params = (int(title),)
            count = int(con.execute(f"SELECT count(*) FROM articles {where}", params).fetchone()[0])
            row = con.execute(
                f"SELECT title, published_at FROM articles {where} ORDER BY published_at DESC, guid LIMIT 1",
                params,
            ).fetchone()
            return {
                "count": count,
                "latest_title": row["title"] if row else None,
                "latest_date": row["published_at"] if row else None,
            }
        except sqlite3.Error:
            return empty


def save_fr_body(con: sqlite3.Connection, document_number: str, body_html: str, now: datetime | None = None) -> None:
    iso = (now or datetime.now(timezone.utc)).isoformat()
    con.execute(
        """INSERT INTO fr_bodies (document_number, body_html, fetched_at) VALUES (?, ?, ?)
           ON CONFLICT(document_number) DO UPDATE SET body_html = excluded.body_html, fetched_at = excluded.fetched_at""",
        (document_number, body_html, iso),
    )


def get_fr_body(con: sqlite3.Connection, document_number: str) -> dict | None:
    row = con.execute(
        "SELECT document_number, body_html, fetched_at FROM fr_bodies WHERE document_number = ?",
        (document_number,),
    ).fetchone()
    return dict(row) if row is not None else None


def get_article_by_doc_num(con: sqlite3.Connection, document_number: str) -> dict | None:
    row = con.execute("SELECT * FROM articles WHERE guid = ?", (f"fr:{document_number}",)).fetchone()
    return _article(row) if row is not None else None


def prune(con: sqlite3.Connection, today: date | None = None) -> None:
    """365-day retention, plus a 7-day cleanup of Public Inspection filings that were
    withdrawn or never matched a published document. Enriched inspection case files are
    retained across retention sweeps."""
    today = today or date.today()
    con.execute(
        "DELETE FROM articles WHERE published_at < ? "
        "AND guid NOT IN (SELECT 'dol-insp:' || activity_nr FROM enforcement_cases WHERE enriched_at IS NOT NULL)",
        ((today - timedelta(days=retention_days())).isoformat(),),
    )
    con.execute(
        "DELETE FROM articles WHERE category = 'public_inspection' "
        "AND COALESCE(scheduled_on, published_at) < ?",
        ((today - timedelta(days=7)).isoformat(),))
    # FTS5 has no foreign keys; article_citations goes by cascade.
    con.execute("DELETE FROM articles_fts WHERE rowid NOT IN (SELECT rowid FROM articles)")
    con.execute("DELETE FROM enforcement_cases WHERE 'dol-insp:' || activity_nr NOT IN (SELECT guid FROM articles)")
    con.execute("DELETE FROM enforcement_narratives_fts WHERE activity_nr NOT IN (SELECT activity_nr FROM enforcement_cases)")
    con.execute("DELETE FROM fr_bodies WHERE 'fr:' || document_number NOT IN (SELECT guid FROM articles)")


# ---------------------------------------------------------------------------
# Queries (the /api/news read side)
# ---------------------------------------------------------------------------

SNIPPET_OPEN, SNIPPET_CLOSE = "\x02", "\x03"   # the app's existing highlight sentinels
_SECTION_ID = re.compile(SEC_NUM)


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
                   cfr_title: int | None = None,
                   state: str | None = None, min_penalty: float | None = None,
                   gravity: str | None = None, naics: str | None = None,
                   gdc: bool = False, fatality: bool = False,
                   jurisdiction: str | None = None, emphasis: str | None = None,
                   limit: int = 30, offset: int = 0) -> dict:
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
    if naics and naics.strip():
        filters.append("a.naics LIKE ? || '%'")
        params.append(naics.strip())
    if gdc:
        filters.append("a.general_duty > 0")
    if fatality:
        filters.append(
            "(EXISTS (SELECT 1 FROM enforcement_cases ec, json_each(ec.accidents_json) ac "
            "WHERE a.guid = 'dol-insp:' || ec.activity_nr AND COALESCE(json_extract(ac.value, '$.fatality'), '') != '') "
            "OR EXISTS (SELECT 1 FROM enforcement_cases ec WHERE a.guid = 'dol-insp:' || ec.activity_nr "
            "AND json_extract(ec.details_json, '$.insp_type') = 'M'))"
        )
    if jurisdiction == "federal":
        filters.append(
            "COALESCE((SELECT json_extract(ec.details_json, '$.state_flag') FROM enforcement_cases ec "
            "WHERE a.guid = 'dol-insp:' || ec.activity_nr), '') != 'S'"
        )
    elif jurisdiction == "state_plan":
        filters.append(
            "((SELECT json_extract(ec.details_json, '$.state_flag') FROM enforcement_cases ec "
            "WHERE a.guid = 'dol-insp:' || ec.activity_nr) = 'S' OR a.unmapped_standards > 0)"
        )
    if emphasis and emphasis.strip():
        filters.append(
            "EXISTS (SELECT 1 FROM enforcement_cases ec, json_each(ec.violations_json) vj "
            "WHERE a.guid = 'dol-insp:' || ec.activity_nr AND upper(COALESCE(json_extract(vj.value, '$.emphasis'), '')) = ?)"
        )
        params.append(emphasis.strip().upper())
    if state or min_penalty is not None or gravity or naics or gdc or fatality or jurisdiction in ("federal", "state_plan") or emphasis:
        filters.append("a.category = 'enforcement'")
    effective_title = cfr_title if cfr_title is not None else title
    if section or part:
        sql, p = _citation_filter(section, part, effective_title)
        filters.append(sql)
        params += p
    elif cfr_title is not None:
        filters.append("EXISTS (SELECT 1 FROM article_citations c WHERE c.article_guid = a.guid AND c.title_num = ?)")
        params.append(int(cfr_title))

    fts = None
    if q and q.strip():
        raw = q.strip()
        # Section-number and FR-citation queries match by id, not FTS (users type these,
        # and FTS tokenises "1910.1030" badly).
        sec_id = store.normalize_id(raw)
        fr_m = _FR_CITATION.fullmatch(raw)
        if _SECTION_ID.fullmatch(sec_id):
            sql, p = _citation_filter(sec_id, None, effective_title)
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
        extra_where = (" AND " + " AND ".join(filters)) if filters else ""
        has_narr_fts = False
        if category in ("all", "enforcement"):
            has_narr_fts = con.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='enforcement_narratives_fts'"
            ).fetchone() is not None
        try:
            if has_narr_fts:
                cte = (
                    "WITH hits AS ("
                    "  SELECT a.guid AS guid, bm25(articles_fts, 2.0, 1.0, 1.5) AS rank,"
                    "         snippet(articles_fts, 1, ?, ?, '…', 24) AS snippet"
                    "  FROM articles_fts JOIN articles a ON a.rowid = articles_fts.rowid"
                    f"  WHERE articles_fts MATCH ?{extra_where}"
                    "  UNION ALL"
                    "  SELECT a.guid AS guid, bm25(enforcement_narratives_fts) AS rank,"
                    "         snippet(enforcement_narratives_fts, 3, ?, ?, '…', 24) AS snippet"
                    "  FROM enforcement_narratives_fts"
                    "  JOIN articles a ON a.guid = 'dol-insp:' || enforcement_narratives_fts.activity_nr"
                    f"  WHERE enforcement_narratives_fts MATCH ?{extra_where}"
                    "), ranked AS ("
                    "  SELECT guid, min(rank) AS best_rank,"
                    "         max(CASE WHEN snippet IS NOT NULL AND snippet != '' THEN snippet ELSE NULL END) AS snippet"
                    "  FROM hits GROUP BY guid"
                    ")"
                )
                cte_params = [SNIPPET_OPEN, SNIPPET_CLOSE, fts, *params, SNIPPET_OPEN, SNIPPET_CLOSE, fts, *params]
                total = con.execute(f"{cte} SELECT count(*) FROM ranked", cte_params).fetchone()[0]
                rows = con.execute(
                    f"{cte} SELECT a.*, r.snippet AS snippet FROM ranked r JOIN articles a ON a.guid = r.guid "
                    "ORDER BY r.best_rank, a.published_at DESC LIMIT ? OFFSET ?",
                    [*cte_params, limit, offset],
                ).fetchall()
            else:
                base = ("FROM articles_fts JOIN articles a ON a.rowid = articles_fts.rowid "
                        f"WHERE articles_fts MATCH ?{extra_where}")
                total = con.execute(f"SELECT count(*) {base}", [fts, *params]).fetchone()[0]
                rows = con.execute(
                    f"SELECT a.*, snippet(articles_fts, 1, ?, ?, '…', 24) AS snippet {base} "
                    "ORDER BY bm25(articles_fts, 2.0, 1.0, 1.5), a.published_at DESC LIMIT ? OFFSET ?",
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


def _json_load(raw: str | None, fallback):
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return fallback


def get_enforcement_case(con: sqlite3.Connection, activity_nr: int) -> dict | None:
    """Return local article + detailed inspection/citation rows for `activity_nr`."""
    guid = f"dol-insp:{int(activity_nr)}"
    art_row = con.execute("SELECT *, NULL AS snippet FROM articles WHERE guid = ?", (guid,)).fetchone()
    case_row = None
    try:
        case_row = con.execute(
            "SELECT * FROM enforcement_cases WHERE activity_nr = ?",
            (int(activity_nr),),
        ).fetchone()
    except sqlite3.OperationalError:
        case_row = None
    if art_row is None and case_row is None:
        return None
    article = _article(art_row) if art_row is not None else None
    detail = _json_load(case_row["details_json"], {}) if case_row else None
    violations = _json_load(case_row["violations_json"], []) if case_row else []
    events = _json_load(case_row["events_json"], []) if case_row else []
    gdc = _json_load(case_row["gdc_json"], []) if case_row else []
    accidents = _json_load(case_row["accidents_json"], []) if case_row else []
    related_raw = _json_load(case_row["related_json"], []) if case_row and "related_json" in case_row.keys() else []
    related: list[dict] = []
    if related_raw:
        rel_nrs = [int(r["rel_act_nr"]) for r in related_raw if r.get("rel_act_nr") is not None]
        hints: dict[int, dict] = {}
        if rel_nrs:
            guids = [f"dol-insp:{n}" for n in set(rel_nrs)]
            ph = ",".join("?" * len(guids))
            for ar in con.execute(
                f"SELECT guid, company, state, penalty_usd, published_at FROM articles WHERE guid IN ({ph})",
                guids,
            ).fetchall():
                nr = int(str(ar["guid"]).split(":", 1)[1])
                hints[nr] = {
                    "cached": True,
                    "estab_name": ar["company"],
                    "site_state": ar["state"],
                    "penalty_usd": ar["penalty_usd"],
                    "open_date": ar["published_at"],
                }
        for r in related_raw:
            nr = r.get("rel_act_nr")
            hint = hints.get(int(nr), {}) if nr is not None else {}
            related.append({**r, "cached": bool(hint), **hint})
    enrich_ver = int(case_row["enrich_ver"] or 0) if case_row and "enrich_ver" in case_row.keys() else 0
    enriched_mod_date = case_row["enriched_mod_date"] if case_row and "enriched_mod_date" in case_row.keys() else None
    enriched_at = case_row["enriched_at"] if case_row else None
    return {
        "activity_nr": int(activity_nr),
        "article": article,
        "detail": detail,
        "violations": violations,
        "events": events,
        "gdc": gdc,
        "accidents": accidents,
        "related": related,
        "enrich_ver": enrich_ver,
        "enriched_mod_date": enriched_mod_date,
        "enriched_at": enriched_at,
    }


def enforcement_summary(con: sqlite3.Connection) -> dict:
    """Aggregate local enforcement telemetry over cached DOL OSHA inspections."""
    agg = con.execute(
        """SELECT count(*) AS total_cases,
                  COALESCE(sum(CASE WHEN penalty_usd > 0 THEN penalty_usd ELSE 0 END), 0.0) AS total_pen,
                  sum(CASE WHEN penalty_usd > 0 THEN 1 ELSE 0 END) AS penalized,
                  COALESCE(max(CASE WHEN penalty_usd > 0 THEN penalty_usd ELSE 0 END), 0.0) AS max_pen
           FROM articles WHERE category = 'enforcement'"""
    ).fetchone()
    total_cases = int(agg["total_cases"] or 0)
    if not total_cases:
        return {
            "total_cases": 0,
            "total_penalty_usd": 0.0,
            "avg_penalty_usd": 0.0,
            "max_penalty_usd": 0.0,
            "total_initial_usd": 0.0,
            "total_current_usd": 0.0,
            "avg_reduction_pct": 0.0,
            "contested_cases": 0,
            "fta_cases": 0,
            "fta_total_usd": 0.0,
            "open_abate_cases": 0,
            "gravity_counts": {"W": 0, "R": 0, "S": 0, "O": 0},
            "top_sections": [],
            "top_states": [],
            "largest_case": None,
        }

    total_penalty = float(agg["total_pen"] or 0.0)
    penalized = int(agg["penalized"] or 0)
    max_penalty = float(agg["max_pen"] or 0.0)

    gravity_counts = {"W": 0, "R": 0, "S": 0, "O": 0}
    for vt, cnt in con.execute(
        """SELECT j.value, count(*) FROM articles a, json_each(a.violation_types) j
           WHERE a.category = 'enforcement' AND j.value IN ('W', 'R', 'S', 'O')
           GROUP BY j.value"""
    ):
        gravity_counts[vt] = int(cnt)

    top_state_rows = con.execute(
        """SELECT upper(trim(state)) AS st, count(*) AS cnt,
                  COALESCE(sum(CASE WHEN penalty_usd > 0 THEN penalty_usd ELSE 0 END), 0.0) AS pen
           FROM articles
           WHERE category = 'enforcement' AND state IS NOT NULL AND trim(state) != ''
           GROUP BY upper(trim(state))
           ORDER BY pen DESC, cnt DESC, st
           LIMIT 6"""
    ).fetchall()
    top_states = [
        {"code": r["st"], "count": int(r["cnt"]), "total_penalty_usd": round(float(r["pen"]), 2)}
        for r in top_state_rows
    ]

    largest_row = con.execute(
        """SELECT guid, company, state, penalty_usd, published_at
           FROM articles
           WHERE category = 'enforcement' AND penalty_usd > 0
           ORDER BY penalty_usd DESC, rowid DESC
           LIMIT 1"""
    ).fetchone()

    sec_rows = con.execute(
        """SELECT c.section_id, count(*) AS cnt, COALESCE(sum(a.penalty_usd), 0) AS pen
           FROM article_citations c
           JOIN articles a ON a.guid = c.article_guid
           WHERE a.category = 'enforcement' AND c.title_num = 29 AND c.section_id != ''
           GROUP BY c.section_id
           ORDER BY cnt DESC, pen DESC, c.section_id
           LIMIT 8"""
    ).fetchall()

    top_sections = [
        {"section_id": r["section_id"], "count": int(r["cnt"]), "total_penalty_usd": round(float(r["pen"]), 2)}
        for r in sec_rows
    ]
    largest_case = None
    if largest_row is not None:
        guid = largest_row["guid"] or ""
        act_nr = int(guid.split(":", 1)[1]) if guid.startswith("dol-insp:") else None
        largest_case = {
            "activity_nr": act_nr,
            "company": largest_row["company"],
            "state": largest_row["state"],
            "penalty_usd": round(float(largest_row["penalty_usd"] or 0.0), 2),
            "published_at": largest_row["published_at"],
        }
    total_initial_usd = 0.0
    total_current_usd = 0.0
    contested_cases = 0
    fta_cases = 0
    fta_total_usd = 0.0
    open_abate_cases = 0
    red_pcts: list[float] = []
    try:
        case_rows = con.execute("SELECT details_json FROM enforcement_cases").fetchall()
    except sqlite3.OperationalError:
        case_rows = []
    for cr in case_rows:
        d = _json_load(cr["details_json"], {})
        init_p = float(d.get("initial_penalty_usd") or 0.0)
        cur_p = float(d.get("current_penalty_usd") or 0.0)
        total_initial_usd += init_p
        total_current_usd += cur_p
        if init_p > cur_p and init_p > 0:
            red_pcts.append((init_p - cur_p) / init_p * 100.0)
        if int(d.get("contested_count") or 0) > 0:
            contested_cases += 1
        if int(d.get("fta_count") or 0) > 0 or float(d.get("fta_total_usd") or 0.0) > 0:
            fta_cases += 1
            fta_total_usd += float(d.get("fta_total_usd") or 0.0)
        if int(d.get("open_abate_count") or 0) > 0:
            open_abate_cases += 1

    return {
        "total_cases": total_cases,
        "total_penalty_usd": round(total_penalty, 2),
        "avg_penalty_usd": round(total_penalty / penalized, 2) if penalized else 0.0,
        "max_penalty_usd": round(max_penalty, 2),
        "total_initial_usd": round(total_initial_usd, 2),
        "total_current_usd": round(total_current_usd, 2),
        "avg_reduction_pct": round(sum(red_pcts) / len(red_pcts), 1) if red_pcts else 0.0,
        "contested_cases": contested_cases,
        "fta_cases": fta_cases,
        "fta_total_usd": round(fta_total_usd, 2),
        "open_abate_cases": open_abate_cases,
        "gravity_counts": gravity_counts,
        "top_sections": top_sections,
        "top_states": top_states,
        "largest_case": largest_case,
    }


def _empty_scope_stats() -> dict:
    return {
        "case_count": 0,
        "citation_count": 0,
        "avg_penalty": 0.0,
        "fta_count": 0,
        "top_paragraphs": [],
    }


def _scope_enforcement_stats(
    con: sqlite3.Connection,
    *,
    section_id: str | None = None,
    part: str | None = None,
) -> dict:
    """Aggregate case count, average citation penalty, FTA count, and paragraph hotspots
    across cached enforcement cases for a Title 29 section or part."""
    try:
        rows = con.execute("SELECT activity_nr, details_json, violations_json FROM enforcement_cases").fetchall()
    except sqlite3.OperationalError:
        return _empty_scope_stats()

    cases: set[int] = set()
    penalties: list[float] = []
    fta_count = 0
    para_counts: dict[str, int] = {}
    prefix = f"{part}." if part else None

    for r in rows:
        det = _json_load(r["details_json"], {})
        # Keep Federal Title 29 hotspots cleanly separated from State Plan codes.
        if det.get("state_flag") == "S":
            continue
        viols = _json_load(r["violations_json"], [])
        for v in viols:
            if v.get("is_state_plan"):
                continue
            sid = v.get("section_id") or ""
            if section_id and sid != section_id:
                continue
            if prefix and not sid.startswith(prefix):
                continue
            cases.add(int(r["activity_nr"]))
            penalties.append(float(v.get("current_penalty") or 0.0))
            if v.get("fta_penalty") or v.get("fta_insp_nr"):
                fta_count += 1
            p = (v.get("para") or "").strip()
            if p:
                para_counts[p] = para_counts.get(p, 0) + 1

    if not penalties:
        return _empty_scope_stats()

    total_para_hits = sum(para_counts.values())
    top_paras = sorted(para_counts.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    return {
        "case_count": len(cases),
        "citation_count": len(penalties),
        "avg_penalty": round(sum(penalties) / len(penalties), 2),
        "fta_count": fta_count,
        "top_paragraphs": [
            {
                "para": p,
                "count": cnt,
                "share_pct": round(cnt / total_para_hits * 100) if total_para_hits >= 10 else None,
            }
            for p, cnt in top_paras
        ],
    }


def section_enforcement_stats(con: sqlite3.Connection, section_id: str) -> dict:
    return _scope_enforcement_stats(con, section_id=section_id)


def part_enforcement_stats(con: sqlite3.Connection, part: str) -> dict:
    return _scope_enforcement_stats(con, part=str(part))


def emphasis_facets(con: sqlite3.Connection) -> list[dict]:
    """Distinct OSHA NEP/LEP emphasis codes across cached violations."""
    try:
        rows = con.execute(
            """SELECT upper(trim(json_extract(j.value, '$.emphasis'))) AS code, count(DISTINCT ec.activity_nr) AS n
               FROM enforcement_cases ec, json_each(ec.violations_json) j
               WHERE COALESCE(trim(json_extract(j.value, '$.emphasis')), '') != ''
               GROUP BY code ORDER BY n DESC, code LIMIT 16"""
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    return [{"code": r["code"], "count": int(r["n"])} for r in rows]


def naics_summary(
    con: sqlite3.Connection,
    naics: str | None = None,
    *,
    federal_only: bool = False,
    limit: int = 12,
) -> dict | list[dict]:
    """Aggregate cached enforcement benchmarks by NAICS code or prefix."""
    fed_clause = (
        " AND COALESCE((SELECT json_extract(ec.details_json, '$.state_flag') FROM enforcement_cases ec "
        "WHERE a.guid = 'dol-insp:' || ec.activity_nr), '') != 'S'"
        if federal_only else ""
    )
    if naics is not None:
        prefix = naics.strip()
        agg = con.execute(
            f"""SELECT count(*) AS cnt,
                       COALESCE(sum(CASE WHEN a.penalty_usd > 0 THEN a.penalty_usd ELSE 0 END), 0.0) AS pen,
                       COALESCE(sum(a.general_duty), 0) AS gdc
                FROM articles a
                WHERE a.category = 'enforcement' AND a.naics LIKE ? || '%'{fed_clause}""",
            (prefix,),
        ).fetchone()
        fat = 0
        try:
            fat = int(con.execute(
                f"""SELECT count(*) FROM articles a
                    WHERE a.category = 'enforcement' AND a.naics LIKE ? || '%'{fed_clause}
                      AND (EXISTS (SELECT 1 FROM enforcement_cases ec, json_each(ec.accidents_json) ac
                                   WHERE a.guid = 'dol-insp:' || ec.activity_nr
                                     AND COALESCE(json_extract(ac.value, '$.fatality'), '') != '')
                           OR EXISTS (SELECT 1 FROM enforcement_cases ec
                                      WHERE a.guid = 'dol-insp:' || ec.activity_nr
                                        AND json_extract(ec.details_json, '$.insp_type') = 'M'))""",
                (prefix,),
            ).fetchone()[0] or 0)
        except sqlite3.OperationalError:
            fat = 0
        sec_rows = con.execute(
            f"""SELECT c.section_id, count(*) AS cnt, COALESCE(sum(a.penalty_usd), 0.0) AS pen
                FROM article_citations c
                JOIN articles a ON a.guid = c.article_guid
                WHERE a.category = 'enforcement' AND a.naics LIKE ? || '%'
                  AND c.title_num = 29 AND c.section_id != ''{fed_clause}
                GROUP BY c.section_id
                ORDER BY cnt DESC, pen DESC, c.section_id
                LIMIT ?""",
            (prefix, limit),
        ).fetchall()
        return {
            "naics": prefix,
            "case_count": int(agg["cnt"] or 0),
            "total_penalty_usd": round(float(agg["pen"] or 0.0), 2),
            "gdc_count": int(agg["gdc"] or 0),
            "fatality_count": fat,
            "top_sections": [
                {"section_id": r["section_id"], "count": int(r["cnt"]), "total_penalty_usd": round(float(r["pen"]), 2)}
                for r in sec_rows
            ],
        }

    rows = con.execute(
        f"""SELECT a.naics AS code, count(*) AS cnt,
                   COALESCE(sum(CASE WHEN a.penalty_usd > 0 THEN a.penalty_usd ELSE 0 END), 0.0) AS pen
            FROM articles a
            WHERE a.category = 'enforcement' AND a.naics IS NOT NULL AND trim(a.naics) != ''{fed_clause}
            GROUP BY a.naics
            ORDER BY cnt DESC, pen DESC, a.naics
            LIMIT ?""",
        (limit,),
    ).fetchall()
    return [
        {"code": r["code"], "count": int(r["cnt"]), "total_penalty_usd": round(float(r["pen"]), 2)}
        for r in rows
    ]


def save_dol_catalog(con: sqlite3.Connection, entries: list[dict], now: datetime | None = None) -> int:
    """Upsert discovered DOL Open Data API v4 datasets into `dol_datasets`."""
    if not entries:
        return 0
    con.execute(_DOL_DATASETS_DDL)
    iso = (now or datetime.now(timezone.utc)).isoformat()
    rows = []
    for e in entries:
        slug = str(e.get("slug") or "").strip()
        if not slug:
            continue
        rows.append((
            slug,
            str(e.get("agency") or "").strip(),
            str(e.get("dataset") or "").strip(),
            str(e.get("title") or "").strip(),
            e.get("frequency"),
            str(e.get("probe_status") or "unprobed"),
            json.dumps(e.get("fields") or []),
            e.get("cfr_title"),
            json.dumps(e.get("cfr_parts") or []),
            json.dumps(e.get("raw") or {}),
            e.get("discovered_at") or iso,
        ))
    con.executemany(
        """INSERT INTO dol_datasets
             (slug, agency, dataset, title, frequency, probe_status, fields_json,
              cfr_title, cfr_parts_json, raw_json, discovered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             agency = excluded.agency,
             dataset = excluded.dataset,
             title = excluded.title,
             frequency = excluded.frequency,
             probe_status = CASE WHEN excluded.probe_status != 'unprobed' THEN excluded.probe_status ELSE dol_datasets.probe_status END,
             fields_json = CASE WHEN excluded.fields_json != '[]' THEN excluded.fields_json ELSE dol_datasets.fields_json END,
             cfr_title = excluded.cfr_title,
             cfr_parts_json = excluded.cfr_parts_json,
             raw_json = excluded.raw_json,
             discovered_at = excluded.discovered_at""",
        rows,
    )
    return len(rows)


def list_dol_catalog(con: sqlite3.Connection) -> list[dict]:
    """Return cached DOL datasets ordered by agency and slug."""
    try:
        rows = con.execute(
            "SELECT slug, agency, dataset, title, frequency, probe_status, fields_json, "
            "cfr_title, cfr_parts_json, discovered_at FROM dol_datasets ORDER BY agency, slug"
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for r in rows:
        out.append({
            "slug": r["slug"],
            "agency": r["agency"],
            "dataset": r["dataset"],
            "title": r["title"],
            "frequency": r["frequency"],
            "probe_status": r["probe_status"],
            "fields": _json_load(r["fields_json"], []),
            "cfr_title": r["cfr_title"],
            "cfr_parts": _json_load(r["cfr_parts_json"], []),
            "discovered_at": r["discovered_at"],
        })
    return out
