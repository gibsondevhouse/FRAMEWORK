# Stage 1 · Phase 1 · Part 2: SQLite News, Rulemaking & Enforcement Store

## 1. Objectives
Create `reader/app/news_store.py`: a local SQLite database at `{config.DATA_DIR}/osha_news.sqlite3` with FTS5, holding Federal Register and DOL records in one table. It also records each source's sync status and prunes old rows.

The file name does not match `title-*.sqlite3`, so `config.installed_titles()` and the library ignore it. Showing it in Settings → Storage is out of scope.

## 2. Connections
- **Path at call time.** `db_path()` returns `config.DATA_DIR / "osha_news.sqlite3"` when called. A module-level constant would freeze the path at import, and tests patch `config.DATA_DIR`.
- **One short-lived connection per use**: `connect()` opens, sets the pragmas, and `init_db()`s on first use per process. Callers use `with closing(news_store.connect()) as con:` and commit explicitly. (A `sqlite3.Connection` used as a context manager only commits; it doesn't close.) The worker writes rarely and requests are cheap reads, so per-use connections are simpler than `store`'s thread-local registry and leave no handles open.
- **Pragmas**: `journal_mode=WAL` (the worker writes while requests read), `foreign_keys=ON` (needed for `ON DELETE CASCADE`), `busy_timeout=5000`, `row_factory=sqlite3.Row`.
- **Schema version** in `PRAGMA user_version` (starts at 1). A future mismatch drops and recreates the tables: the store is a cache of public data, and the next sync refills it.

## 3. Schema (`news_store.SCHEMA`)
```sql
CREATE TABLE IF NOT EXISTS articles (
    guid TEXT PRIMARY KEY,           -- "fr:2026-17726" (published or PI), "dol-insp:306953084"
    source TEXT NOT NULL,            -- federal_register | federal_register_pi | dol_osha
    agency TEXT NOT NULL,            -- FR agency slug; "occupational-safety-and-health-administration"
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
    docket_ids TEXT NOT NULL DEFAULT '[]',        -- JSON array
    company TEXT, city TEXT, state TEXT, naics TEXT,
    penalty_usd REAL,
    violation_types TEXT NOT NULL DEFAULT '[]',   -- JSON array, e.g. ["S","W"]
    general_duty INTEGER NOT NULL DEFAULT 0,      -- count of 5(a)(1) citations
    unmapped_standards INTEGER NOT NULL DEFAULT 0,-- cited standards with no CFR mapping (state plans)
    cfr_parts TEXT NOT NULL DEFAULT '[]',         -- JSON [{"title":29,"part":"42"}]
    sections TEXT NOT NULL DEFAULT '[]',          -- JSON ["1910.1030"]
    takeaways TEXT NOT NULL DEFAULT '[]',         -- JSON [{"key","label","text"}] (Stage 2 · Phase 2 · Part 1)
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
    last_ok_at TEXT,                 -- ISO timestamp
    last_count INTEGER,
    last_error TEXT,                 -- short, user-facing; NULL after a success
    last_error_at TEXT,
    fail_count INTEGER NOT NULL DEFAULT 0   -- consecutive failures; drives backoff; 0 after a success
);
```
The API returns the JSON columns as arrays (Part 3), so the frontend never calls `JSON.parse` on a field.

## 4. Upsert (`news_store.upsert_article(con, item)`)
Rules:
1. **Never downgrade a published document to a PI filing.** A sync fetches both, and today's PI list can include documents already published. A PI upsert must not overwrite a `federal_register` row with the same guid. A published upsert always replaces a PI row (the category moves from `public_inspection` to `rules` / `rulemaking` / `notices`).
2. **Everything else is replaced** on conflict, so the stored row always matches the latest fetch.
3. Citations and the FTS row are rewritten in the same transaction.

```python
COLUMNS = ("guid source agency category doc_type title link pdf_url citation action effective_on "
           "comments_close_on scheduled_on published_at description docket_ids company city state "
           "naics penalty_usd violation_types general_duty unmapped_standards cfr_parts sections "
           "takeaways fetched_at").split()
JSON_COLUMNS = {"docket_ids", "violation_types", "cfr_parts", "sections", "takeaways"}

UPSERT = f"""
INSERT INTO articles ({", ".join(COLUMNS)}) VALUES ({", ".join("?" * len(COLUMNS))})
ON CONFLICT(guid) DO UPDATE SET
  {", ".join(f"{c} = excluded.{c}" for c in COLUMNS if c != "guid")}
WHERE NOT (excluded.source = 'federal_register_pi' AND articles.source = 'federal_register')
"""


def upsert_article(con: sqlite3.Connection, item: dict) -> bool:
    """Insert or replace one item. Returns False when skipped (PI over a published doc)."""
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
    con.executemany(
        "INSERT OR IGNORE INTO article_citations VALUES (?, 29, ?, ?)",
        [(guid, s.split(".", 1)[0], s) for s in item.get("sections") or []],
    )
    con.execute("DELETE FROM articles_fts WHERE guid = ?", (guid,))
    con.execute("INSERT INTO articles_fts (guid, title, description, company) VALUES (?, ?, ?, ?)",
                (guid, item["title"], item.get("description") or "", item.get("company") or ""))
    return True
```
Section-level citations are Title 29 by construction, since OSHA is the only agency in scope. When other agencies arrive, `sections` becomes `[{"title", "id"}]`. That is noted here so nobody hard-codes 29 elsewhere.

## 5. Sync status and retention
- `record_ok(con, source, count, now)` sets `last_ok_at`, `last_count`, clears `last_error` and resets `fail_count` to 0.
- `record_error(con, source, message, now)` sets `last_error`, `last_error_at` and increments `fail_count`. It leaves `last_ok_at` alone, so the source stays stale and the backoff applies (Stage 4 · Phase 1 · Part 1). Messages are short and safe to show the user (`"Federal Register unreachable (timeout)"`), never a stack trace or the API key.
- `sync_rows() -> {source: row}` reads `sync_status` with timestamps parsed to aware UTC datetimes. Both the worker and `/api/news/status` use it with `news_schedule`.
- Timestamps are stored as ISO 8601 UTC (`2026-11-16T14:20:00+00:00`). `now` defaults to the current UTC time; tests pass it.
- `retention_days()` reads `NEWS_RETENTION_DAYS` (default **365**) at call time. The first FR sync backfills exactly this window.
- `prune(con, today: date | None = None)` runs after each sync (`today` defaults to `date.today()`; tests pass it):
  - delete `articles` with `published_at` older than `retention_days()`;
  - delete `public_inspection` rows whose `scheduled_on` is more than 7 days past. They were withdrawn or never matched a published document;
  - delete the matching `articles_fts` rows. FTS5 has no foreign keys, so do it explicitly with `DELETE FROM articles_fts WHERE guid NOT IN (SELECT guid FROM articles)`. `article_citations` goes by cascade.

## 6. Acceptance Criteria
- [ ] `init_db()` creates the schema in whatever `config.DATA_DIR` is at call time, and running it twice is harmless.
- [ ] Upserting the same item twice leaves one `articles` row, one FTS row, and the same citation rows.
- [ ] A PI item followed by its published document leaves one row, `source = federal_register`. The reverse order also leaves the published row untouched.
- [ ] `prune` removes old rows from `articles`, `article_citations` and `articles_fts` alike.
- [ ] Every connection is closed after use (no handles left open; Windows can then delete the file).
