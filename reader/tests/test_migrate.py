"""Schema versions and the migration runner (`app/migrate.py`, register DM-001 / SEC-007).

Hermetic like every suite: a temp `DATA_DIR`, no network. Stores are made two ways: through
the real pipelines (`FakeTitles`, `news_store.connect`, `sources.db`) and from
`tests/store_baselines.json`, the frozen schema each store kind had before migrations existed.
Tests register a throwaway migration with `extra_migration`; none ships one.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import threading
from contextlib import closing
from datetime import date
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app import (agenda, build, config, constitution, fr_store, migrate, news_store, plaw, store, usc_build,
                 usc_client, usc_store)
from app.main import app
from app.sources import db as sources_db
from fake_titles import FakeTitles
from tests.base import HermeticTestCase

READER_DIR = Path(__file__).resolve().parent.parent
BASELINES = json.loads((Path(__file__).resolve().parent / "store_baselines.json").read_text(encoding="utf-8"))
ONE_FILE = {"fr": "fr.sqlite3", "news": "osha_news.sqlite3", "constitution": "constitution.sqlite3",
            "plaw": "plaw.sqlite3", "agenda": "agenda.sqlite3", "sources": "sources.sqlite3"}
_SHADOW = ("_data", "_idx", "_content", "_docsize", "_config")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def version(path: Path) -> int:
    with closing(sqlite3.connect(path)) as con:
        return con.execute("PRAGMA user_version").fetchone()[0]


def tables(path: Path) -> set[str]:
    with closing(sqlite3.connect(path)) as con:
        return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def baseline_store(kind: str, path: Path) -> Path:
    """A store as it exists on disk before DM-001: frozen schema, frozen version, one meta-ish row."""
    with closing(sqlite3.connect(path)) as con:
        for stmt in BASELINES[kind]["sql"]:
            con.execute(stmt)
        if "meta" in {r[0] for r in con.execute("SELECT name FROM sqlite_master")}:
            con.execute("INSERT INTO meta (key, value) VALUES ('kept', 'yes')")
        con.execute(f"PRAGMA user_version = {BASELINES[kind]['version']}")
        con.commit()
    return path


def shape(con: sqlite3.Connection) -> dict:
    """What a store is made of, independent of how it got there (`ALTER TABLE` and a fresh
    `CREATE TABLE` leave different SQL text behind for the same table)."""
    rows = con.execute("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
    virtual = [n for t, n, _, s in rows if s and s.upper().startswith("CREATE VIRTUAL")]
    out: dict = {}
    for type_, name, tbl, sql in rows:
        if any(name == v + x for v in virtual for x in _SHADOW):
            continue
        if name in virtual:
            out[name] = ("virtual", re.sub(r"\s+", " ", sql.replace("IF NOT EXISTS ", "")).strip())
        elif type_ == "table":
            out[name] = ("table", sorted((c[1], (c[2] or "").upper(), c[3], c[4], c[5])
                                         for c in con.execute(f'PRAGMA table_xinfo("{name}")')))
        elif type_ == "index":
            out[name] = ("index", tbl, [c[2] for c in con.execute(f'PRAGMA index_info("{name}")')])
        else:
            out[name] = (type_, re.sub(r"\s+", " ", sql or "").strip())
    return out


def add_table(con: sqlite3.Connection) -> None:
    con.execute("CREATE TABLE IF NOT EXISTS extra (k TEXT PRIMARY KEY, v TEXT)")
    con.execute("INSERT OR REPLACE INTO extra VALUES ('made-by', 'migration')")


def add_table_then_fail(con: sqlite3.Connection) -> None:
    add_table(con)
    con.executemany("INSERT INTO extra VALUES (?, ?)", [(f"k{i}", "x" * 200) for i in range(50)])
    raise RuntimeError("killed half way")


def extra_migration(kind: str, apply=add_table, summary: str = "test: add a table"):
    """Register one more migration for `kind`, for the length of a `with` block."""
    step = migrate.Migration(migrate.latest(kind) + 1, summary, apply)
    return mock.patch.dict(migrate.MIGRATIONS, {kind: [*migrate.MIGRATIONS[kind], step]})


class MigrateTestCase(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="migrate-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for target, name, value in ((config, "DATA_DIR", self.tmp), (migrate, "log", lambda msg: None)):
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        store.reset_connections()
        usc_store.clear_caches()
        self.addCleanup(store.reset_connections)
        self.addCleanup(usc_store.clear_caches)

    def leftovers(self) -> list[str]:
        return sorted(f.name for f in config.DATA_DIR.iterdir() if ".tmp" in f.name or f.name.endswith("-journal"))


class CfrTitleCase(MigrateTestCase):
    """A real fake Title 29, built by the CFR pipeline."""

    def setUp(self):
        super().setUp()
        self.fake = FakeTitles(titles=(29,))
        self.fake.install()                       # patches DATA_DIR to its own temp dir
        self.addCleanup(self.fake.remove)
        self.db = config.db_path(29)

    def as_built_before_dm001(self) -> None:
        with closing(sqlite3.connect(self.db)) as con:
            con.execute("DROP TABLE title_graph")
            con.execute("PRAGMA user_version = 0")
            con.commit()
        store.reset_connections()

    def sections(self) -> list[tuple]:
        with closing(sqlite3.connect(self.db)) as con:
            return con.execute("SELECT id, ord, label, title, path, xml, text FROM sections ORDER BY ord").fetchall()


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

class RegistryTests(MigrateTestCase):
    def test_migrations_are_numbered_without_gaps(self):
        migrate.check_registry()
        self.assertEqual(set(migrate.MIGRATIONS), set(migrate.KINDS))
        with mock.patch.dict(migrate.MIGRATIONS, {"usc": [migrate.Migration(2, "skips 1", add_table)]}), \
                self.assertRaises(migrate.MigrationError):
            migrate.check_registry()

    def test_stores_that_had_a_version_keep_their_number(self):
        self.assertEqual(migrate.latest("fr"), fr_store.SCHEMA_VERSION)
        self.assertEqual(migrate.latest("news"), news_store.SCHEMA_VERSION)
        self.assertEqual(migrate.latest("sources"), sources_db.SCHEMA_VERSION)
        self.assertEqual(migrate.KINDS["news"].floor, news_store._RUNNER_FLOOR)

    def test_file_names_match_the_store_modules(self):
        for kind, mod in (("fr", fr_store), ("news", news_store), ("constitution", constitution),
                          ("plaw", plaw), ("agenda", agenda), ("sources", sources_db)):
            self.assertEqual(config.DATA_DIR / migrate.KINDS[kind].file, mod.db_path(), kind)
        self.assertEqual(config.DATA_DIR / migrate.KINDS["usc"].file.replace("{N}", "4"), usc_store.db_path(4))
        self.assertEqual(config.DATA_DIR / migrate.KINDS["cfr"].file.replace("{N}", "40"), config.db_path(40))

    def test_statements_splits_only_at_statement_ends(self):
        sql = ("-- a comment; with a semicolon\n"
               "CREATE TABLE a (x TEXT DEFAULT 'semi;colon');\n"
               "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 'y'; DELETE FROM a WHERE x = ';'; END;\n"
               "CREATE INDEX a_x ON a(x)")
        got = migrate.statements(sql)
        self.assertEqual(len(got), 3)
        con = sqlite3.connect(":memory:", isolation_level=None)
        con.execute("BEGIN")
        migrate.script(con, sql)
        self.assertTrue(con.in_transaction)       # unlike executescript, the transaction is still open
        self.assertEqual({r[0] for r in con.execute("SELECT name FROM sqlite_master")}, {"a", "t", "a_x"})

    def test_every_baseline_migrates_to_what_a_fresh_build_makes(self):
        """The check that keeps future migrations honest: a store from before DM-001, taken
        through every migration, has the tables, columns and indexes of a fresh build."""
        self.assertEqual(set(BASELINES) - {"_note"}, set(migrate.KINDS))
        for kind in migrate.KINDS:
            with self.subTest(kind=kind):
                old = baseline_store(kind, self.tmp / f"old-{kind}.sqlite3")
                migrate.ensure(kind, old)
                fresh = self.tmp / f"fresh-{kind}.sqlite3"
                with closing(sqlite3.connect(fresh)) as con:
                    self.assertTrue(migrate.init(con, kind))
                    self.assertFalse(migrate.init(con, kind))
                with closing(sqlite3.connect(old)) as a, closing(sqlite3.connect(fresh)) as b:
                    self.assertEqual(shape(a), shape(b))
                    self.assertEqual(migrate.user_version(a), migrate.latest(kind))
                    self.assertEqual(migrate.user_version(b), migrate.latest(kind))


# ---------------------------------------------------------------------------
# Every store reports a version; version-0 stores are adopted in place
# ---------------------------------------------------------------------------

class AdoptionTests(MigrateTestCase):
    def install_everything(self) -> None:
        baseline_store("cfr", self.tmp / "title-40.sqlite3")
        baseline_store("usc", self.tmp / "usc-4.sqlite3")
        baseline_store("usc", self.tmp / "usc-105.sqlite3")           # an appendix title (5a)
        for kind, name in ONE_FILE.items():
            baseline_store(kind, self.tmp / name)

    def test_every_store_reports_a_version_and_is_adopted_without_a_rebuild(self):
        self.install_everything()
        before = migrate.status()
        self.assertEqual({r["corpus"] for r in before}, set(migrate.KINDS))
        self.assertEqual(len(before), 9)
        by_state = {r["file"]: r["state"] for r in before}
        for name in ("title-40.sqlite3", "usc-4.sqlite3", "usc-105.sqlite3", "constitution.sqlite3",
                     "plaw.sqlite3", "agenda.sqlite3"):
            self.assertEqual(by_state[name], "behind", name)       # version 0: never versioned
        for name in ("fr.sqlite3", "osha_news.sqlite3", "sources.sqlite3"):
            self.assertEqual(by_state[name], "current", name)      # they already carried a number
        self.assertTrue(all(r["version"] is not None for r in before))

        rows = migrate.migrate_all()                               # the network guard is on: nothing is downloaded
        self.assertEqual({r["state"] for r in rows}, {"migrated", "current"})
        after = migrate.status()
        self.assertTrue(all(r["state"] == "current" and r["version"] == r["latest"] for r in after), after)
        for r in after:                                            # the data is still there
            path = self.tmp / r["file"]
            if "meta" in tables(path):
                with closing(sqlite3.connect(path)) as con:
                    self.assertEqual(con.execute("SELECT value FROM meta WHERE key = 'kept'").fetchone()[0], "yes")
        self.assertIn("title_graph", tables(self.tmp / "title-40.sqlite3"))
        self.assertEqual(self.leftovers(), [])
        self.assertEqual({r["state"] for r in migrate.migrate_all()}, {"current"})   # running it again is a no-op

    def test_status_never_writes_and_filters(self):
        self.install_everything()
        hashes = {f.name: sha(f) for f in self.tmp.iterdir()}
        self.assertEqual([r["file"] for r in migrate.status(corpus="usc")], ["usc-4.sqlite3", "usc-105.sqlite3"])
        self.assertEqual([r["file"] for r in migrate.status(title=40)], ["title-40.sqlite3"])
        self.assertEqual([r["file"] for r in migrate.status(corpus="usc", title=4)], ["usc-4.sqlite3"])
        self.assertEqual({f.name: sha(f) for f in self.tmp.iterdir()}, hashes)

    def test_command_line(self):
        self.install_everything()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            migrate.main(["--status", "--json"])
        self.assertEqual(len(json.loads(out.getvalue())), 9)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            migrate.main(["--corpus", "plaw", "--keep-backup"])
        self.assertIn("schema version 0 -> 1", out.getvalue())
        self.assertIn("plaw.sqlite3.v0.bak", out.getvalue())
        self.assertEqual(version(self.tmp / "plaw.sqlite3.v0.bak"), 0)
        self.assertEqual(version(self.tmp / "usc-4.sqlite3"), 0)   # --corpus left the others alone
        with closing(sqlite3.connect(self.tmp / "agenda.sqlite3")) as con:
            con.execute("PRAGMA user_version = 99")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as stop:
            migrate.main([])
        self.assertEqual(stop.exception.code, 1)                   # a refused store fails the command…
        self.assertEqual(version(self.tmp / "usc-4.sqlite3"), 1)   # …without stopping the others
        with contextlib.redirect_stdout(io.StringIO()):
            migrate.main(["--status"])                             # a report alone never fails

    def test_only_the_copies_of_dead_runs_are_cleared(self):
        path = baseline_store("plaw", self.tmp / "plaw.sqlite3")
        dead = path.with_name("plaw.sqlite3.migrate.999999999.tmp")           # no such process
        running = path.with_name(f"plaw.sqlite3.reindex.{os.getppid()}.tmp")   # another process, still alive
        staging = path.with_name("plaw.sqlite3.tmp")                           # a resumable build's file: not ours
        for f in (dead, running, staging):
            f.write_bytes(b"x")
        self.assertNotIn(str(os.getppid()), migrate.work_path(path).name)      # copies are per process
        migrate.migrate_all()
        self.assertFalse(dead.exists())
        self.assertTrue(staging.exists())
        if sys.platform != "win32":            # there an open copy cannot be deleted in the first place
            self.assertTrue(running.exists())

    def test_empty_install(self):
        self.assertEqual(migrate.status(), [])
        self.assertEqual(migrate.migrate_all(), [])
        self.assertEqual(migrate.format_rows([]), "No stores on disk.")
        self.assertIsNone(migrate.ensure("plaw", self.tmp / "plaw.sqlite3"))
        self.assertFalse((self.tmp / "plaw.sqlite3").exists())     # nothing was created


class PipelineStampTests(MigrateTestCase):
    def test_every_pipeline_builds_a_store_at_the_latest_version(self):
        """The CFR pipeline is covered by `CfrMigrationTests`; these are the other seven."""
        from tests.test_new_corpora import FakeGov
        from tests.test_usc_corpus import FakeOLRC
        for mod in (usc_build, constitution, plaw, agenda):
            p = mock.patch.object(mod, "log", lambda msg: None)
            p.start()
            self.addCleanup(p.stop)
        usc_client.clear_cache()
        self.addCleanup(usc_client.clear_cache)
        with FakeOLRC().patch():
            usc_build.build(4, force=True)
        with FakeGov().patch():
            constitution.build()
            plaw.build(types=["public"])
            agenda.build(years=2, agencies=["1200"], today=date(2026, 11, 20))
        fr_store.connect().close()
        news_store.init_db()
        sources_db.set_setting("selection", {"version": 1})
        rows = migrate.status()
        self.assertEqual({r["corpus"] for r in rows}, set(migrate.KINDS) - {"cfr"})
        for r in rows:
            self.assertEqual((r["state"], r["version"]), ("current", migrate.latest(r["corpus"])), r)
        self.assertTrue(all(r["version"] >= 1 for r in rows))
        self.assertEqual({r["state"] for r in migrate.migrate_all()}, {"current"})


# ---------------------------------------------------------------------------
# A built artifact: a CFR title is migrated on a copy, then swapped in
# ---------------------------------------------------------------------------

class CfrMigrationTests(CfrTitleCase):
    def test_a_fresh_build_is_stamped_with_the_latest_version(self):
        self.assertEqual(version(self.db), migrate.latest("cfr"))
        self.assertIsNone(migrate.ensure("cfr", self.db))
        with closing(sqlite3.connect(self.db)) as con:              # the registry's schema is what a build makes
            fresh = sqlite3.connect(":memory:")
            migrate.init(fresh, "cfr")
            self.assertEqual(shape(con), shape(fresh))

    def test_a_title_built_before_versions_is_adopted_in_place(self):
        self.as_built_before_dm001()
        rows = self.sections()
        res = migrate.ensure("cfr", self.db)
        self.assertEqual((res["from"], res["to"], res["applied"]), (0, 1, [1]))
        self.assertEqual(self.sections(), rows)
        self.assertIn("title_graph", tables(self.db))
        self.assertEqual(self.leftovers(), [])
        self.assertEqual(store.get_section("1910.134", 29)["label"], "§ 1910.134")

    def test_a_migration_adds_a_table_and_the_data_survives(self):
        rows = self.sections()
        self.assertEqual(store.search("respirators", title=29)["results"][0]["id"], "1910.134")   # handles are open
        with extra_migration("cfr"):
            res = migrate.ensure("cfr", self.db)
            self.assertEqual((res["from"], res["to"]), (1, 2))
            self.assertIsNone(migrate.ensure("cfr", self.db))       # idempotent: nothing left to do
        self.assertEqual(version(self.db), 2)
        with closing(sqlite3.connect(self.db)) as con:
            self.assertEqual(con.execute("SELECT v FROM extra WHERE k = 'made-by'").fetchone()[0], "migration")
            self.assertEqual(con.execute("PRAGMA quick_check").fetchone()[0], "ok")
        self.assertEqual(self.sections(), rows)
        # The reader sees the swapped-in file: cached handles were released, nothing was rebuilt.
        self.assertEqual(store.search("respirators", title=29)["results"][0]["id"], "1910.134")
        self.assertEqual(store.meta(29)["edition"], "2026-01-02")
        self.assertEqual(self.leftovers(), [])

    def test_killed_half_way_the_live_title_is_untouched(self):
        before = sha(self.db)
        with extra_migration("cfr", add_table_then_fail), self.assertRaises(RuntimeError):
            migrate.ensure("cfr", self.db)
        self.assertEqual(sha(self.db), before)
        self.assertEqual(self.leftovers(), [])
        self.assertEqual(store.get_section("1910.120", 29)["id"], "1910.120")

    def test_a_failed_integrity_check_installs_nothing(self):
        before = sha(self.db)
        with extra_migration("cfr"), mock.patch.object(migrate, "quick_check", lambda con: "row 3 missing from index"), \
                self.assertRaisesRegex(migrate.MigrationError, "integrity check"):
            migrate.ensure("cfr", self.db)
        self.assertEqual(sha(self.db), before)
        self.assertEqual(self.leftovers(), [])

    def test_a_title_replaced_meanwhile_is_not_overwritten(self):
        real = migrate._apply

        def rebuilt_meanwhile(con, kind, after_begin=None):
            os.utime(self.db, ns=(1, 1))                           # e.g. a build installed a new edition
            return real(con, kind, after_begin)

        with extra_migration("cfr"), mock.patch.object(migrate, "_apply", rebuilt_meanwhile), \
                self.assertRaisesRegex(migrate.MigrationError, "changed while"):
            migrate.ensure("cfr", self.db)
        self.assertEqual(version(self.db), 1)
        self.assertEqual(self.leftovers(), [])

    def test_downgrade_is_refused(self):
        with closing(sqlite3.connect(self.db)) as con:
            con.execute("PRAGMA user_version = 7")
        store.reset_connections()
        before = sha(self.db)
        with self.assertRaisesRegex(migrate.DowngradeError, "version 7"):
            migrate.ensure("cfr", self.db)
        with self.assertRaises(sqlite3.Error):                     # writers already handle sqlite errors
            build.renest(29)
        self.assertEqual(sha(self.db), before)
        self.assertEqual(migrate.status()[0]["state"], "ahead")
        self.assertEqual(store.get_section("1910.134", 29)["id"], "1910.134")   # reading still works

    def test_keep_backup_keeps_the_old_file(self):
        self.as_built_before_dm001()
        res = migrate.ensure("cfr", self.db, keep_backup=True)
        kept = Path(res["backup"])
        self.assertEqual(kept.name, "title-29.sqlite3.v0.bak")
        self.assertEqual((version(kept), version(self.db)), (0, 1))
        self.assertEqual(config.installed_titles(), [29])           # a backup is not a title

    def test_renest_is_a_writer_so_it_migrates_first(self):
        self.as_built_before_dm001()
        build.renest(29)
        self.assertEqual(version(self.db), migrate.latest("cfr"))

    def test_reading_never_migrates(self):
        self.as_built_before_dm001()
        with extra_migration("cfr"):                               # two migrations are pending
            before = sha(self.db)
            c = TestClient(app)
            for url in ("/api/titles", "/api/29/section/1910.134", "/api/29/section/1910.1200?unit=",
                        "/api/search?q=respirators&title=29", "/api/29/references", "/api/29/citations/1910.134",
                        "/api/29/part/1910/full", "/api/library/storage"):
                self.assertEqual(c.get(url).status_code, 200, url)
            self.assertEqual(migrate.status()[0]["state"], "behind")
            store.reset_connections()
            self.assertEqual(sha(self.db), before)
            self.assertEqual(version(self.db), 0)

    def test_hard_kill_half_way_leaves_the_live_title_untouched(self):
        before = sha(self.db)
        self.assertEqual(run_and_kill("cfr", self.db), 9)
        self.assertEqual(sha(self.db), before)
        self.assertEqual(store.get_section("1910.134", 29)["id"], "1910.134")
        dead = self.leftovers()                 # the dead run's copy (and its journal), named for its process
        self.assertRegex(dead[0], r"^title-29\.sqlite3\.migrate\.\d+\.tmp$")
        self.assertNotEqual(dead[0], migrate.work_path(self.db).name)
        self.assertTrue(all(n.startswith(dead[0]) for n in dead), dead)
        with extra_migration("cfr"):                               # the next run is not in its way…
            self.assertEqual(migrate.ensure("cfr", self.db)["to"], 2)
            self.assertEqual(self.leftovers(), dead)
            migrate.migrate_all()                                  # …and the command clears it away
        self.assertEqual(self.leftovers(), [])
        self.assertEqual(store.get_section("1910.134", 29)["id"], "1910.134")


def run_and_kill(kind: str, path: Path) -> int:
    """Run a migration in another process that dies (no cleanup, no rollback) after it has
    written part of its work to disk."""
    child = textwrap.dedent("""
        import os, sys
        from pathlib import Path
        from app import config, migrate

        def dies(con):
            con.execute("PRAGMA cache_size = 5")          # so pages reach the file before the kill
            con.execute("CREATE TABLE half_done (x)")
            con.executemany("INSERT INTO half_done VALUES (?)", [("z" * 4000,) for _ in range(1500)])
            os._exit(9)

        kind, path = sys.argv[1], Path(sys.argv[2])
        config.DATA_DIR = path.parent
        migrate.log = lambda msg: None
        migrate.MIGRATIONS[kind].append(migrate.Migration(migrate.latest(kind) + 1, "dies half way", dies))
        migrate.ensure(kind, path)
    """)
    return subprocess.run([sys.executable, "-c", child, kind, str(path)], cwd=READER_DIR).returncode


# ---------------------------------------------------------------------------
# A living store: migrated in one transaction, where it is opened for writing
# ---------------------------------------------------------------------------

class InPlaceMigrationTests(MigrateTestCase):
    def test_a_writer_open_migrates_and_the_data_survives(self):
        sources_db.set_setting("selection", {"version": 1})
        self.assertEqual(version(sources_db.db_path()), 1)
        with extra_migration("sources"), mock.patch.object(sources_db, "SCHEMA_VERSION", 2):
            self.assertEqual(sources_db.get_setting("selection"), {"version": 1})     # a read…
            self.assertEqual(version(sources_db.db_path()), 1)                        # …migrates nothing
            sources_db.set_setting("other", [1, 2])                                   # a write does
            self.assertEqual(version(sources_db.db_path()), 2)
            self.assertIn("extra", tables(sources_db.db_path()))
            self.assertEqual(sources_db.get_setting("selection"), {"version": 1})
            self.assertEqual(sources_db.get_setting("other"), [1, 2])
        self.assertEqual(self.leftovers(), [])

    def test_killed_half_way_rolls_back_to_the_store_as_it_was(self):
        sources_db.set_setting("selection", {"version": 1})
        path = sources_db.db_path()
        with extra_migration("sources", add_table_then_fail):
            with self.assertRaises(RuntimeError):
                migrate.ensure("sources", path)
            self.assertEqual(version(path), 1)
            self.assertNotIn("extra", tables(path))
            self.assertEqual(sources_db.get_setting("selection"), {"version": 1})
            with closing(sqlite3.connect(path)) as con:
                self.assertEqual(con.execute("PRAGMA quick_check").fetchone()[0], "ok")
        self.assertEqual(self.leftovers(), [])

    def test_a_migration_that_commits_early_is_undone_from_the_copy(self):
        def commits_then_fails(con):
            con.executescript("CREATE TABLE sneaky (x); INSERT INTO sneaky VALUES (1);")   # executescript commits
            raise RuntimeError("after the damage")

        path = baseline_store("plaw", self.tmp / "plaw.sqlite3")
        migrate.ensure("plaw", path)
        with extra_migration("plaw", commits_then_fails), self.assertRaises(RuntimeError):
            migrate.ensure("plaw", path)
        self.assertNotIn("sneaky", tables(path))
        self.assertEqual(version(path), 1)

        def commits_quietly(con):
            con.executescript("CREATE TABLE sneaky (x);")

        with extra_migration("plaw", commits_quietly), self.assertRaisesRegex(migrate.MigrationError, "migrate.script"):
            migrate.ensure("plaw", path)
        self.assertNotIn("sneaky", tables(path))
        self.assertEqual(version(path), 1)
        self.assertEqual(self.leftovers(), [])

    def test_a_failed_integrity_check_rolls_back(self):
        path = baseline_store("agenda", self.tmp / "agenda.sqlite3")
        with mock.patch.object(migrate, "quick_check", lambda con: "page 9 is never used"), \
                self.assertRaises(migrate.MigrationError):
            migrate.ensure("agenda", path)
        self.assertEqual(version(path), 0)
        self.assertEqual(self.leftovers(), [])

    def test_keep_backup_and_no_backup(self):
        path = baseline_store("constitution", self.tmp / "constitution.sqlite3")
        with mock.patch.object(migrate, "_copy", side_effect=AssertionError("copied")):
            self.assertEqual(migrate.ensure("constitution", path, backup=False)["backup"], None)
        with extra_migration("constitution"):
            res = migrate.ensure("constitution", path, keep_backup=True)
        self.assertEqual(Path(res["backup"]).name, "constitution.sqlite3.v1.bak")
        self.assertEqual((version(Path(res["backup"])), version(path)), (1, 2))
        self.assertNotIn("extra", tables(Path(res["backup"])))

    def test_hard_kill_half_way_is_rolled_back_by_the_next_writer(self):
        sources_db.set_setting("selection", {"version": 1})
        path = sources_db.db_path()
        self.assertEqual(run_and_kill("sources", path), 9)
        self.assertTrue(path.with_name(path.name + "-journal").exists())    # the dead transaction
        self.assertEqual(migrate.status()[0]["state"], "unreadable")        # read-only opens can't roll it back
        self.assertIn("python -m app.migrate", migrate.status()[0]["detail"])
        sources_db.set_setting("other", 5)                                  # any writer open does
        self.assertEqual(migrate.status()[0]["state"], "current")
        self.assertEqual(sources_db.get_setting("selection"), {"version": 1})
        self.assertNotIn("half_done", tables(path))
        with closing(sqlite3.connect(path)) as con:
            self.assertEqual(con.execute("PRAGMA quick_check").fetchone()[0], "ok")
        self.assertRegex(self.leftovers()[0], r"^sources\.sqlite3\.migrate\.\d+\.tmp$")   # the dead run's copy
        migrate.migrate_all()                                               # the command (or storage cleanup) removes it
        self.assertEqual(self.leftovers(), [])

    def test_the_command_rolls_back_a_hard_kill_too(self):
        path = baseline_store("plaw", self.tmp / "plaw.sqlite3")
        self.assertEqual(run_and_kill("plaw", path), 9)
        rows = migrate.migrate_all()
        self.assertEqual((rows[0]["state"], rows[0]["to"]), ("migrated", 1))
        self.assertEqual(plaw.status()["meta"]["kept"], "yes")
        self.assertNotIn("half_done", tables(path))
        self.assertEqual(self.leftovers(), [])

    def test_downgrade_is_refused_and_no_longer_restamped(self):
        sources_db.set_setting("selection", {"version": 1})
        with closing(fr_store.connect()) as con:
            fr_store.set_meta(con, {"kept": "yes"})
            con.commit()
        for path in (sources_db.db_path(), fr_store.db_path()):
            with closing(sqlite3.connect(path)) as con:
                con.execute("PRAGMA user_version = 3")
        with self.assertRaises(migrate.DowngradeError):
            sources_db.set_setting("other", 1)
        with self.assertRaises(migrate.DowngradeError):
            fr_store.connect()
        self.assertEqual((version(sources_db.db_path()), version(fr_store.db_path())), (3, 3))
        self.assertIsNone(sources_db.get_setting("other"))

    def test_federal_register_writer_migrates_under_its_lock(self):
        with closing(fr_store.connect()) as con:
            fr_store.set_meta(con, {"kept": "yes"})
            con.commit()
        self.assertEqual(version(fr_store.db_path()), 1)
        free_for_others: list[bool] = []

        def under_lock(con):
            def other_thread():
                got = fr_store.WRITE_LOCK.acquire(blocking=False)
                free_for_others.append(got)
                if got:
                    fr_store.WRITE_LOCK.release()
            t = threading.Thread(target=other_thread)
            t.start()
            t.join()
            add_table(con)

        with extra_migration("fr", under_lock), mock.patch.object(fr_store, "SCHEMA_VERSION", 2):
            with closing(fr_store.connect()) as con:
                self.assertEqual(fr_store.get_meta(con)["kept"], "yes")
                self.assertEqual(migrate.user_version(con), 2)
            self.assertEqual(fr_store.read_meta()["kept"], "yes")
            staging = fr_store.tmp_path()                               # a build's staging file: no copy is taken
            baseline_store("fr", staging)
            with mock.patch.object(migrate, "_copy", side_effect=AssertionError("copied")), \
                    closing(fr_store.connect(path=staging)) as con:
                self.assertEqual(migrate.user_version(con), 2)
        self.assertEqual(free_for_others, [False, False])           # body fetches and builds wait for it

    def test_newsroom_keeps_its_own_rules_and_hands_later_versions_to_the_runner(self):
        news_store.init_db()
        path = news_store.db_path()
        self.assertEqual(version(path), news_store.SCHEMA_VERSION)
        with closing(news_store.connect()) as con:
            con.execute("INSERT INTO sync_status (source, last_count) VALUES ('federal_register', 7)")
            con.commit()
        with extra_migration("news"), mock.patch.object(news_store, "SCHEMA_VERSION", 5):
            with closing(news_store.connect()) as con:                  # kept, not dropped and refilled
                self.assertEqual(con.execute("SELECT last_count FROM sync_status").fetchone()[0], 7)
                self.assertEqual(migrate.user_version(con), 5)
                self.assertEqual(con.execute("SELECT v FROM extra").fetchone()[0], "migration")
        with closing(sqlite3.connect(path)) as con:                     # an older layout: news_store upgrades it…
            con.execute("DROP TABLE extra")
            con.execute("PRAGMA user_version = 3")
        self.assertEqual(migrate.status()[0]["state"], "legacy")
        self.assertIsNone(migrate.ensure("news", path))                 # …the runner does not
        self.assertEqual(version(path), 3)
        rows = migrate.migrate_all()
        self.assertEqual((rows[0]["from"], rows[0]["to"]), (3, 4))
        with closing(news_store.connect()) as con:
            self.assertEqual(con.execute("SELECT last_count FROM sync_status").fetchone()[0], 7)

    def test_public_laws_and_agenda_openers_create_adopt_and_stamp(self):
        for mod, kind in ((plaw, "plaw"), (agenda, "agenda")):
            with self.subTest(kind=kind):
                with closing(mod._connect(mod.db_path())) as con:        # a new file
                    self.assertEqual(migrate.user_version(con), migrate.latest(kind))
                    self.assertIn("build_chunks", {r[0] for r in con.execute("SELECT name FROM sqlite_master")})
                mod.db_path().unlink()
                baseline_store(kind, mod.db_path())                      # a store from before DM-001
                with closing(mod._connect(mod.db_path())) as con:
                    self.assertEqual(migrate.user_version(con), migrate.latest(kind))
                    self.assertEqual(mod._get_meta(con)["kept"], "yes")
        self.assertEqual(self.leftovers(), [])
