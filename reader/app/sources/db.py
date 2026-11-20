"""`data/sources.sqlite3`: the saved source selection and the user's saved templates.

Short-lived connections (like `news_store`); reads never create the file, so a fresh
install shows defaults without writing anything. Values are JSON. Nothing here ever holds a
key or secret: selections are normalized against the registry before they are stored, which
drops every field the registry doesn't declare.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from .. import config

SCHEMA_VERSION = 1
WRITE_LOCK = threading.RLock()
SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    selection TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def db_path() -> Path:
    return config.DATA_DIR / "sources.sqlite3"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path(), timeout=5.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=5000")
    con.executescript(SCHEMA)
    con.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    return con


def _read() -> sqlite3.Connection | None:
    p = db_path()
    if not p.exists():
        return None
    con = sqlite3.connect(f"{p.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=5000")
    return con


def get_setting(key: str):
    con = _read()
    if con is None:
        return None
    with closing(con):
        try:
            row = con.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        except sqlite3.Error:
            return None
    try:
        return json.loads(row["value"]) if row else None
    except ValueError:
        return None


def set_setting(key: str, value) -> None:
    with WRITE_LOCK, closing(_connect()) as con:
        con.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?,?,?)",
                    (key, json.dumps(value, sort_keys=True), now_iso()))
        con.commit()


def delete_setting(key: str) -> None:
    if not db_path().exists():
        return
    with WRITE_LOCK, closing(_connect()) as con:
        con.execute("DELETE FROM settings WHERE key = ?", (key,))
        con.commit()


def _template(row: sqlite3.Row) -> dict:
    try:
        sel = json.loads(row["selection"])
    except ValueError:
        sel = {}
    return {"id": row["id"], "name": row["name"], "description": row["description"], "builtin": False,
            "selection": sel, "created_at": row["created_at"], "updated_at": row["updated_at"]}


def list_templates() -> list[dict]:
    con = _read()
    if con is None:
        return []
    with closing(con):
        try:
            rows = con.execute("SELECT * FROM templates ORDER BY lower(name), created_at").fetchall()
        except sqlite3.Error:
            return []
    return [_template(r) for r in rows]


def get_template(tid: str) -> dict | None:
    con = _read()
    if con is None:
        return None
    with closing(con):
        try:
            row = con.execute("SELECT * FROM templates WHERE id = ?", (tid,)).fetchone()
        except sqlite3.Error:
            return None
    return _template(row) if row else None


def create_template(name: str, description: str, selection: dict, tid: str | None = None,
                    created_at: str | None = None) -> dict:
    tid = tid or uuid.uuid4().hex[:12]
    ts = now_iso()
    with WRITE_LOCK, closing(_connect()) as con:
        con.execute("INSERT INTO templates (id, name, description, selection, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (tid, name, description, json.dumps(selection, sort_keys=True), created_at or ts, ts))
        con.commit()
    return get_template(tid)


def update_template(tid: str, name: str | None = None, description: str | None = None,
                    selection: dict | None = None) -> dict | None:
    cur = get_template(tid)
    if cur is None:
        return None
    with WRITE_LOCK, closing(_connect()) as con:
        con.execute("UPDATE templates SET name = ?, description = ?, selection = ?, updated_at = ? WHERE id = ?",
                    (name if name is not None else cur["name"],
                     description if description is not None else cur["description"],
                     json.dumps(selection if selection is not None else cur["selection"], sort_keys=True),
                     now_iso(), tid))
        con.commit()
    return get_template(tid)


def delete_template(tid: str) -> bool:
    if not db_path().exists():
        return False
    with WRITE_LOCK, closing(_connect()) as con:
        n = con.execute("DELETE FROM templates WHERE id = ?", (tid,)).rowcount
        con.commit()
    return n > 0
