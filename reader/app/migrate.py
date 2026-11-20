"""Schema versions and migrations for every SQLite store (register DM-001, SEC-007).

    python -m app.migrate                    # bring every store on disk up to date
    python -m app.migrate --status           # report each store's schema version; writes nothing
    python -m app.migrate --corpus cfr --title 29
    python -m app.migrate --keep-backup      # keep the pre-migration copy as <file>.v<N>.bak
    python -m app.migrate --json

Every store carries its schema version in `PRAGMA user_version`. A store kind's history is
the list of numbered migrations in `MIGRATIONS`; `latest(kind)` is the last number. A fresh
build stamps it (`stamp` / `init`), and `ensure(kind, path)` brings a store on disk forward
by applying the migrations it is missing, in order. A store that was never versioned
(version 0) is adopted in place by migration 1: nothing is rebuilt or downloaded again.

How a store is normally written decides how it is migrated (`StoreKind.mode`):

- `swap`: a built artifact that is only ever replaced whole (a CFR or U.S.C. title). The
  migration runs on a private copy, and the copy replaces the live file under the swap rules
  a build uses (`store.begin_swap` / `release_title`). A run that dies at any point leaves
  the live file untouched.
- `inplace`: a living store that is also written between builds (Federal Register, newsroom,
  Constitution, Public Laws, Agenda, sources). The migration runs in one transaction on the
  live file, after a copy was taken, so other writers wait for it and none of their work is
  lost. A run that dies is rolled back by SQLite on the next read-write open; `ensure` and
  this command do that open.

Both ways the store is copied first (SQLite's backup API, so the copy is consistent), every
pending migration and its version stamp share one transaction, `PRAGMA quick_check` must
pass before the commit, and a store newer than this code is refused, never downgraded.

Rules for a migration function `apply(con)`:

- it runs inside an open transaction: no COMMIT, no `executescript` (it commits; use
  `script(con, sql)`), no VACUUM and no journal-mode change; foreign keys are not enforced
  on its connection (SQLite's advice for schema changes), so it deletes dependants itself;
- it is idempotent (`IF NOT EXISTS`, a column check before `ALTER TABLE`) and never needs
  the network;
- the store module's `SCHEMA` changes in the same pull request, so a fresh build and a
  migrated store end up alike (`tests/test_migrate.py` compares them), and a module that
  keeps its own `SCHEMA_VERSION` (Federal Register, newsroom, sources) moves it to match.

Reads never migrate. Request paths open stores read-only, so code that reads something a
migration adds must cope with a store that is still one version behind, until a writer or
this command has brought it forward.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import threading
from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

from . import config

# The copy a run works on or keeps as its way back: <store>.<tag>.<pid>.tmp. The process id
# keeps two processes from ever sharing one; ".tmp" lets library.prune_temp delete a leftover.
_WORK_FILE = re.compile(r"^\.(?:migrate|reindex)\.(\d+)\.tmp$")
_SIDECARS = ("-journal", "-wal", "-shm")
_TITLE_FILE = re.compile(r"^(?:title-?|usc-)(\d+)\.sqlite3$")
_LOCK = threading.RLock()       # one migration at a time in this process


class MigrationError(sqlite3.DatabaseError):
    """A migration could not be applied; the store is as it was before the attempt.

    A `sqlite3` error on purpose: writers already treat those as "this store is unavailable"."""


class DowngradeError(MigrationError):
    """The store was written by newer code than this. It is left untouched."""


@dataclass(frozen=True)
class Migration:
    version: int                                  # the store's version once this has run
    summary: str
    apply: Callable[[sqlite3.Connection], None]


@dataclass(frozen=True)
class StoreKind:
    name: str
    label: str
    file: str                                     # file name in DATA_DIR ({N} = title number)
    mode: str                                     # "swap" | "inplace" (see the module docstring)
    schema: Callable[[], str]                     # SQL that creates a fresh store at the latest version
    floor: int = 0                                # the runner migrates from this version up


@dataclass(frozen=True)
class Store:
    kind: str
    target: str                                   # "title 29", or "-" for a one-file corpus
    path: Path


# ---------------------------------------------------------------------------
# Store kinds and their migrations
# ---------------------------------------------------------------------------

# `citations.graph.persist_title_index` creates this table at the end of a CFR build; titles
# built before the citation graph was stored do not have it.
TITLE_GRAPH_DDL = "CREATE TABLE IF NOT EXISTS title_graph (key TEXT PRIMARY KEY, payload TEXT NOT NULL);"


def _cfr_schema() -> str:
    from . import build
    return build.SCHEMA + TITLE_GRAPH_DDL


def _usc_schema() -> str:
    from . import usc_store
    return usc_store.SCHEMA


def _fr_schema() -> str:
    from . import fr_store
    return fr_store.SCHEMA


def _news_schema() -> str:
    from . import news_store
    return news_store.SCHEMA


def _constitution_schema() -> str:
    from . import constitution
    return constitution.SCHEMA


def _plaw_schema() -> str:
    from . import plaw
    return plaw.SCHEMA


def _agenda_schema() -> str:
    from . import agenda
    return agenda.SCHEMA


def _sources_schema() -> str:
    from .sources import db
    return db.SCHEMA


KINDS: dict[str, StoreKind] = {k.name: k for k in (
    StoreKind("cfr", "CFR title", "title-{N}.sqlite3", "swap", _cfr_schema),
    StoreKind("usc", "U.S. Code title", "usc-{N}.sqlite3", "swap", _usc_schema),
    StoreKind("fr", "Federal Register", "fr.sqlite3", "inplace", _fr_schema),
    # Versions 1-3 are upgraded by `news_store.connect`, as before DM-001; the runner takes
    # over at 4. That module also keeps its own rule for a newer store: it is a cache of
    # public data, dropped and refilled (pinned by tests/test_news_store.py).
    StoreKind("news", "Newsroom", "osha_news.sqlite3", "inplace", _news_schema, floor=4),
    StoreKind("constitution", "U.S. Constitution", "constitution.sqlite3", "inplace", _constitution_schema),
    StoreKind("plaw", "Public Laws", "plaw.sqlite3", "inplace", _plaw_schema),
    StoreKind("agenda", "Unified Agenda", "agenda.sqlite3", "inplace", _agenda_schema),
    StoreKind("sources", "Source selection", "sources.sqlite3", "inplace", _sources_schema),
)}


def _adopt(con: sqlite3.Connection) -> None:
    """Versioning starts here; the tables are already what a fresh build makes."""


def _adopt_cfr(con: sqlite3.Connection) -> None:
    con.execute(TITLE_GRAPH_DDL)


def _adopt_with_schema(kind: str) -> Callable[[sqlite3.Connection], None]:
    """These stores ran their `IF NOT EXISTS` schema on every writer open; adoption does it
    one last time, so a table added since the store was built is there."""
    def apply(con: sqlite3.Connection) -> None:
        script(con, KINDS[kind].schema())
    return apply


# One list per kind, numbered without gaps from `floor + 1`. Append; never edit or renumber
# a migration that has shipped.
MIGRATIONS: dict[str, list[Migration]] = {
    "cfr": [Migration(1, "Adopt schema versions; make sure the citation-graph table exists", _adopt_cfr)],
    "usc": [Migration(1, "Adopt schema versions", _adopt)],
    "fr": [Migration(1, "Baseline (the store has carried version 1 since it was introduced)", _adopt_with_schema("fr"))],
    "news": [],
    "constitution": [Migration(1, "Adopt schema versions", _adopt)],
    "plaw": [Migration(1, "Adopt schema versions", _adopt_with_schema("plaw"))],
    "agenda": [Migration(1, "Adopt schema versions", _adopt_with_schema("agenda"))],
    "sources": [Migration(1, "Baseline (the store has carried version 1 since it was introduced)",
                          _adopt_with_schema("sources"))],
}


def log(msg: str) -> None:
    from . import build
    build.log(f"[migrate] {msg}")


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

def latest(kind: str) -> int:
    """The schema version this code builds and expects for `kind`."""
    steps = MIGRATIONS[kind]
    return steps[-1].version if steps else KINDS[kind].floor


def check_registry() -> None:
    """Every kind's migrations are numbered `floor + 1, floor + 2, …` (pinned by a test)."""
    for name, kind in KINDS.items():
        got = [m.version for m in MIGRATIONS[name]]
        want = list(range(kind.floor + 1, kind.floor + 1 + len(got)))
        if got != want:
            raise MigrationError(f"{name} migrations are numbered {got}, expected {want}")
        if kind.mode not in ("swap", "inplace"):
            raise MigrationError(f"{name} has an unknown migration mode {kind.mode!r}")


def user_version(con: sqlite3.Connection) -> int:
    return int(con.execute("PRAGMA user_version").fetchone()[0])


def read_version(path: Path) -> int:
    """The schema version of the store at `path`, read without writing (0 = never versioned)."""
    with closing(sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)) as con:
        return user_version(con)


def stamp(con: sqlite3.Connection, kind: str) -> None:
    """Mark a store that was just built from the current schema. Inside the build's own
    transaction, so the version commits with the data."""
    con.execute(f"PRAGMA user_version = {latest(kind)}")


def init(con: sqlite3.Connection, kind: str) -> bool:
    """Give a database with nothing in it the kind's schema and the latest version. An
    existing store is left alone: `ensure` brings it forward before it is opened."""
    if user_version(con) or con.execute("SELECT count(*) FROM sqlite_master").fetchone()[0]:
        return False
    con.executescript(KINDS[kind].schema())
    stamp(con, kind)
    con.commit()
    return True


def statements(sql: str) -> list[str]:
    """Split a script into statements (semicolons in strings, comments and triggers are safe)."""
    out: list[str] = []
    buf = ""
    pieces = sql.split(";")
    for piece in pieces[:-1]:
        buf += piece + ";"
        if sqlite3.complete_statement(buf):
            out.append(buf.strip())
            buf = ""
    tail = (buf + pieces[-1]).strip()
    if tail:
        out.append(tail)
    return out


def script(con: sqlite3.Connection, sql: str) -> None:
    """Run several statements inside the current transaction (`executescript` would commit it)."""
    for stmt in statements(sql):
        con.execute(stmt)


def quick_check(con: sqlite3.Connection) -> str:
    """'ok', or what SQLite found wrong."""
    rows = [str(r[0]) for r in con.execute("PRAGMA quick_check").fetchall()]
    return "ok" if rows == ["ok"] else "; ".join(rows[:5]) or "no result"


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

def work_path(path: Path, tag: str = "migrate") -> Path:
    return path.with_name(f"{path.name}.{tag}.{os.getpid()}.tmp")


def _process_alive(pid: int) -> bool:
    if sys.platform == "win32":      # os.kill would terminate it there; an open copy can't be deleted anyway
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True
    return True


def discard_stale_copies(path: Path) -> int:
    """Delete the copies that runs which died left beside the store at `path`."""
    gone = 0
    for f in path.parent.glob("*.tmp"):
        m = _WORK_FILE.match(f.name[len(path.name):]) if f.name.startswith(path.name + ".") else None
        if m and int(m.group(1)) != os.getpid() and not _process_alive(int(m.group(1))):
            _discard(f)
            gone += 1
    return gone


def backup_path(path: Path, version: int) -> Path:
    return path.with_name(f"{path.name}.v{version}.bak")


def _discard(path: Path) -> None:
    for p in (path, *(path.with_name(path.name + s) for s in _SIDECARS)):
        try:
            p.unlink()
        except OSError:
            pass


def _copy(src: Path, dest: Path) -> None:
    """A consistent copy of a store that may be open elsewhere (SQLite's online backup)."""
    _discard(dest)
    with closing(sqlite3.connect(f"{src.resolve().as_uri()}?mode=ro", uri=True, timeout=30.0)) as a, \
            closing(sqlite3.connect(dest)) as b:
        a.backup(b)


def _fingerprint(path: Path) -> tuple[int, int, int]:
    st = path.stat()
    return st.st_ino, st.st_size, st.st_mtime_ns


def _roll_back_interrupted_write(path: Path) -> None:
    """A writer that died mid-transaction leaves a journal that only a read-write open can
    roll back; read-only opens fail until then."""
    with closing(sqlite3.connect(path, timeout=30.0)) as con:
        con.execute("SELECT count(*) FROM sqlite_master").fetchone()


def _version_on_disk(path: Path) -> int:
    try:
        return read_version(path)
    except sqlite3.Error:
        _roll_back_interrupted_write(path)
        return read_version(path)


def _title_in(path: Path) -> int | None:
    m = _TITLE_FILE.match(path.name)
    return int(m.group(1)) if m else None


@contextmanager
def _write_guard(kind: str) -> Iterator[None]:
    """The lock a store's own writers hold, where it has one."""
    if kind == "fr":
        from . import fr_store
        with fr_store.WRITE_LOCK:
            yield
    elif kind == "sources":
        from .sources import db
        with db.WRITE_LOCK:
            yield
    else:
        yield


def install(kind: str, staged: Path, path: Path) -> None:
    """Replace the live store with a finished copy, the way a build does: CFR titles close
    every thread's read handles and bypass caches for the swap; U.S.C. title caches are cleared."""
    from .build import _replace_with_retry
    title = _title_in(path)
    if kind == "cfr" and title is not None:
        from . import store
        store.begin_swap(title)
        try:
            _replace_with_retry(staged, path, lambda: store.release_title(title))
        finally:
            store.end_swap(title)
        return
    _replace_with_retry(staged, path)
    if kind == "usc":
        from . import usc_store
        usc_store.clear_caches(title)


@contextmanager
def staged_copy(kind: str, path: Path, tag: str = "reindex") -> Iterator[Path]:
    """For rewriting part of a built artifact (a CFR or U.S.C. title) without touching the
    live file: yields the path of a private, consistent copy. On a clean exit the copy must
    pass `quick_check`, then it replaces the live file under the store's swap rules, which
    also drops that title's caches. On any error it is deleted and the live file is as it was."""
    path = Path(path)
    work = work_path(path, tag)
    with _LOCK:
        seen = _fingerprint(path)
        try:
            _copy(path, work)
            yield work
            with closing(sqlite3.connect(work)) as con:
                found = quick_check(con)
            if found != "ok":
                raise MigrationError(f"the rewritten copy of {path.name} failed its integrity check: {found}")
            if _fingerprint(path) != seen:
                raise MigrationError(f"{path.name} changed while its copy was being rewritten; nothing was replaced. Run it again.")
            install(kind, work, path)
        except BaseException:
            _discard(work)
            raise


@contextmanager
def staged_file(path: Path, tag: str = "reindex") -> Iterator[Path]:
    """For building a derived SQLite store from scratch: yields a temporary path beside
    `path`. On a clean exit the new file must pass `quick_check`, then it is renamed over
    `path`; on any error it is deleted and `path` is as it was. A store replaced this way
    must not use WAL mode (a leftover `-wal` would be applied to the new file)."""
    from .build import _replace_with_retry
    path = Path(path)
    work = work_path(path, tag)
    _discard(work)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        yield work
        if not work.exists():
            raise MigrationError(f"nothing was written for {path.name}")
        with closing(sqlite3.connect(work)) as con:
            found = quick_check(con)
        if found != "ok":
            raise MigrationError(f"the new {path.name} failed its integrity check: {found}")
        _replace_with_retry(work, path)
    except BaseException:
        _discard(work)
        raise


# ---------------------------------------------------------------------------
# The runner
# ---------------------------------------------------------------------------

def _apply(con: sqlite3.Connection, kind: str, after_begin: Callable[[], None] | None = None) -> list[int]:
    """Run what the store is missing, each version stamp and the integrity check in one
    transaction. Returns the versions applied ([] when another process got there first).
    On any error the transaction is rolled back; `MigrationError.broken` says a migration had
    already ended it, so its changes could not be undone."""
    con.execute("BEGIN IMMEDIATE")
    try:
        have = user_version(con)
        pending = [m for m in MIGRATIONS[kind] if m.version > have]
        if not pending:
            con.execute("ROLLBACK")
            return []
        if after_begin:
            after_begin()
        for m in pending:
            m.apply(con)
            if not con.in_transaction:
                raise MigrationError(
                    f"migration {m.version} of {kind} ended the transaction (COMMIT or executescript); "
                    "use migrate.script(con, sql)")
            con.execute(f"PRAGMA user_version = {int(m.version)}")
        found = quick_check(con)
        if found != "ok":
            raise MigrationError(f"{kind} failed its integrity check after migrating: {found}")
        con.execute("COMMIT")
        return [m.version for m in pending]
    except BaseException as exc:
        if con.in_transaction:
            con.execute("ROLLBACK")
        else:
            exc.broken = True  # type: ignore[attr-defined]
        raise


def _migrate_swap(kind: str, path: Path, have: int, keep_backup: bool) -> tuple[list[int], Path | None]:
    work = work_path(path)
    kept = None
    seen = _fingerprint(path)
    try:
        _copy(path, work)
        with closing(sqlite3.connect(work, timeout=30.0, isolation_level=None)) as con:
            applied = _apply(con, kind)
        if not applied:
            _discard(work)
            return [], None
        if _fingerprint(path) != seen:
            raise MigrationError(f"{path.name} changed while it was being migrated; nothing was replaced. Run it again.")
        if keep_backup:
            kept = backup_path(path, have)
            _discard(kept)
            try:
                os.link(path, kept)          # the old file lives on under the backup name
            except OSError:
                shutil.copy2(path, kept)
        install(kind, work, path)
    except BaseException:
        _discard(work)
        if kept is not None:
            _discard(kept)
        raise
    return applied, kept


def _migrate_inplace(kind: str, path: Path, have: int, backup: bool, keep_backup: bool) -> tuple[list[int], Path | None]:
    work = work_path(path)
    copied = False

    def copy_first() -> None:
        # Taken once the write lock is held, so no other writer can add to the store after it.
        nonlocal copied
        if backup:
            _copy(path, work)
            copied = True

    try:
        with closing(sqlite3.connect(path, timeout=30.0, isolation_level=None)) as con:
            applied = _apply(con, kind, after_begin=copy_first)
    except BaseException as exc:
        if getattr(exc, "broken", False):
            if copied:
                with closing(sqlite3.connect(work)) as a, closing(sqlite3.connect(path, timeout=30.0)) as b:
                    a.backup(b)          # put the copy back, as one SQLite transaction
                log(f"{path.name}: restored the copy taken before the migration")
            else:
                log(f"{path.name}: a migration ended its own transaction and no copy was taken; "
                    "the store may be partly migrated")
        _discard(work)
        raise
    kept = None
    if copied and applied and keep_backup:
        kept = backup_path(path, have)
        _discard(kept)
        try:
            work.replace(kept)
        except FileNotFoundError:        # someone cleaned up temp files meanwhile
            kept = None
    _discard(work)
    return applied, kept


def ensure(kind: str, path: Path, *, backup: bool = True, keep_backup: bool = False) -> dict | None:
    """Bring the store at `path` up to `latest(kind)`. Call it where a store is about to be
    opened for writing; when there is nothing to do (no file yet, or already current) it
    costs one read-only `PRAGMA user_version` and returns None.

    Raises `DowngradeError` for a store newer than this code and `MigrationError` when a
    migration fails; either way the store is left as it was. `backup=False` skips the copy
    for an in-place store that can simply be rebuilt (a build's staging file)."""
    spec = KINDS[kind]
    path = Path(path)
    try:
        if not path.exists() or path.stat().st_size == 0:
            return None
    except OSError:
        return None
    want = latest(kind)
    have = _version_on_disk(path)
    if have == want or have < spec.floor:
        return None
    if have > want:
        raise DowngradeError(
            f"{path.name} is at schema version {have}, but this version of FRAMEWORK only knows "
            f"{spec.label} stores up to version {want}. Update the app; the store was left untouched.")
    with _write_guard(kind), _LOCK:
        have = _version_on_disk(path)          # another thread may have finished while this one waited
        if not spec.floor <= have < want:
            return None
        if spec.mode == "swap":
            applied, kept = _migrate_swap(kind, path, have, keep_backup)
        else:
            applied, kept = _migrate_inplace(kind, path, have, backup, keep_backup)
    if not applied:
        return None
    log(f"{path.name}: schema version {have} -> {applied[-1]}")
    return {"corpus": kind, "file": path.name, "from": have, "to": applied[-1], "applied": applied,
            "backup": str(kept) if kept else None}


# ---------------------------------------------------------------------------
# Every store on disk
# ---------------------------------------------------------------------------

def stores(corpus: str | None = None, title: int | None = None) -> list[Store]:
    """The stores in DATA_DIR, found by file name (no caches, no module state)."""
    out: list[Store] = []
    d = config.DATA_DIR
    for n in config.installed_titles():
        out.append(Store("cfr", f"title {n}", config.db_path(n)))
    usc: list[int] = []
    if d.exists():
        for f in d.glob("usc-*.sqlite3"):
            m = _TITLE_FILE.match(f.name)
            if m:
                usc.append(int(m.group(1)))
    for n in sorted(usc):
        out.append(Store("usc", f"title {n}", d / f"usc-{n}.sqlite3"))
    for name, kind in KINDS.items():
        if "{N}" not in kind.file and (d / kind.file).exists():
            out.append(Store(name, "-", d / kind.file))
    if corpus:
        out = [s for s in out if s.kind == corpus]
    if title is not None:
        out = [s for s in out if _title_in(s.path) == int(title)]
    return out


def _state(kind: str, have: int) -> tuple[str, str]:
    want = latest(kind)
    if have == want:
        return "current", "up to date"
    if have > want:
        if kind == "news":
            return "ahead", "newer than this version of FRAMEWORK; the newsroom drops and refills it on its next sync"
        return "ahead", "newer than this version of FRAMEWORK; left untouched"
    if have < KINDS[kind].floor:
        return "legacy", "older layout; upgraded the next time the newsroom writes to it"
    n = sum(1 for m in MIGRATIONS[kind] if m.version > have)
    return "behind", f"{n} migration{'s' if n != 1 else ''} to apply"


def status(corpus: str | None = None, title: int | None = None) -> list[dict]:
    """Each store's schema version against what this code expects. Never writes."""
    rows = []
    for s in stores(corpus, title):
        row = {"corpus": s.kind, "target": s.target, "file": s.path.name, "version": None,
               "latest": latest(s.kind), "state": "unreadable", "detail": ""}
        try:
            row["version"] = read_version(s.path)
        except sqlite3.Error as exc:
            interrupted = s.path.with_name(s.path.name + "-journal").exists()
            row["detail"] = ("an interrupted write needs rolling back; run python -m app.migrate"
                             if interrupted else str(exc))
        else:
            row["state"], row["detail"] = _state(s.kind, row["version"])
        rows.append(row)
    return rows


def migrate_all(corpus: str | None = None, title: int | None = None, keep_backup: bool = False) -> list[dict]:
    """`ensure` every store on disk. One store's failure never stops the others."""
    rows = []
    for s in stores(corpus, title):
        row = {"corpus": s.kind, "target": s.target, "file": s.path.name, "from": None, "to": None,
               "applied": [], "backup": None, "state": "current", "detail": "up to date"}
        try:
            row["from"] = row["to"] = _version_on_disk(s.path)
            if s.kind == "news" and row["from"] < KINDS["news"].floor:
                from . import news_store
                if s.path == news_store.db_path():
                    news_store.init_db()         # that module owns versions 1-3
            res = ensure(s.kind, s.path, keep_backup=keep_backup)
            row["to"] = _version_on_disk(s.path)
            if res:
                row.update(applied=res["applied"], backup=res["backup"])
            if row["to"] != row["from"]:
                row.update(state="migrated", detail=f"schema version {row['from']} -> {row['to']}")
            else:
                row["state"], row["detail"] = _state(s.kind, row["to"])
            discard_stale_copies(s.path)     # what a run that died left behind
        except DowngradeError:
            row["state"], row["detail"] = _state(s.kind, row["from"])
        except (sqlite3.Error, OSError) as exc:
            row.update(state="failed", detail=f"{exc} (the store was left as it was)")
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def format_rows(rows: list[dict]) -> str:
    if not rows:
        return "No stores on disk."
    lines = []
    for r in rows:
        name = KINDS[r["corpus"]].label + ("" if r["target"] == "-" else f" ({r['target']})")
        version = r["version"] if "version" in r else r["to"]
        lines.append(f"{name:<28} {r['file']:<24} v{'?' if version is None else version:<3} {r['detail']}"
                     + (f"  [copy kept: {Path(r['backup']).name}]" if r.get("backup") else ""))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Report and apply schema migrations for the local stores.")
    parser.add_argument("--status", action="store_true", help="report schema versions without writing anything")
    parser.add_argument("--corpus", choices=sorted(KINDS), help="only this kind of store")
    parser.add_argument("--title", type=int, help="only this CFR or U.S.C. title number")
    parser.add_argument("--keep-backup", action="store_true",
                        help="keep each migrated store's pre-migration copy as <file>.v<N>.bak")
    parser.add_argument("--json", action="store_true", help="print the rows as JSON")
    args = parser.parse_args(argv)
    check_registry()
    rows = (status(args.corpus, args.title) if args.status
            else migrate_all(args.corpus, args.title, keep_backup=args.keep_backup))
    print(json.dumps(rows, indent=2) if args.json else format_rows(rows))
    refused = [r for r in rows if r["state"] == "failed" or (r["state"] == "ahead" and r["corpus"] != "news")]
    if refused and not args.status:              # a report alone never fails
        sys.exit(1)


if __name__ == "__main__":
    main()
