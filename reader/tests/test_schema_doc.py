"""The data dictionary (`app/schema_doc.py` -> `reader/DATA_DICTIONARY.md`, register DM-002).

The first test is the pin: the committed file must be exactly what the generator makes from
the schema definitions in code. Change a `SCHEMA`, a migration or a note and it fails until
`python -m app.schema_doc` has been run and the result committed.
"""
from __future__ import annotations

import contextlib
import io
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import date
from pathlib import Path
from unittest import mock

from app import (agenda, config, constitution, fr_build, fr_store, migrate, plaw, schema_doc, store, usc_build,
                 usc_client, usc_store)
from fake_titles import FakeTitles
from tests.base import HermeticTestCase

READER_DIR = Path(__file__).resolve().parent.parent


class DataDictionaryTests(HermeticTestCase):
    def test_the_committed_file_is_what_the_code_generates(self):
        committed = (READER_DIR / "DATA_DICTIONARY.md").read_text(encoding="utf-8")
        self.assertEqual(schema_doc.OUTPUT, READER_DIR / "DATA_DICTIONARY.md")
        self.maxDiff = None
        self.assertEqual(
            committed, schema_doc.render(),
            "reader/DATA_DICTIONARY.md is out of date: run `python -m app.schema_doc` and commit the result.")

    def test_it_needs_no_data_directory(self):
        empty = Path(tempfile.mkdtemp(prefix="schema-doc-"))
        self.addCleanup(shutil.rmtree, empty, ignore_errors=True)
        with mock.patch.object(config, "DATA_DIR", empty / "missing"):
            text = schema_doc.render()
        self.assertEqual(text, schema_doc.render())                 # and it is the same every time
        self.assertFalse((empty / "missing").exists())

    def test_every_store_table_column_and_index_is_listed(self):
        text = schema_doc.render()
        for kind, spec in migrate.KINDS.items():
            with self.subTest(kind=kind):
                section = text.split(f"## {spec.label}: `{spec.file}`", 1)[1].split("\n## ", 1)[0]
                self.assertIn(f"**Schema version:** {migrate.latest(kind)}", section)
                for m in migrate.MIGRATIONS[kind]:
                    self.assertIn(f"Version {m.version}: {m.summary}", section)
                con = sqlite3.connect(":memory:")
                self.addCleanup(con.close)
                migrate.init(con, kind)
                names = [r[0] for r in con.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
                real = [n for n in names if not any(n == v + x for v in names for x in schema_doc._SHADOW)]
                self.assertEqual([t["name"] for t in schema_doc.describe(kind)], real)
                for table in real:
                    self.assertIn(f"### `{table}`", section)
                    for col in con.execute(f'PRAGMA table_info("{table}")'):
                        self.assertIn(f"`{col[1]}`", section, f"{table}.{col[1]}")
                for (index,) in con.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"):
                    self.assertIn(f"**Index** `{index}`", section)

    def test_every_table_has_a_line_and_no_line_is_left_over(self):
        self.assertEqual(set(schema_doc.STORES), set(migrate.KINDS))
        for kind in migrate.KINDS:
            with self.subTest(kind=kind):
                tables = [t["name"] for t in schema_doc.describe(kind)]
                self.assertEqual(set(schema_doc.TABLES[kind]), set(tables),
                                 f"describe each {kind} table in schema_doc.TABLES (and remove tables that are gone)")
                self.assertEqual("meta" in tables, kind in schema_doc.META_KEYS)

    def test_what_the_schema_says_is_carried_over(self):
        by_name = {t["name"]: t for t in schema_doc.describe("fr")}
        cols = {c["name"]: c for c in by_name["document_cfr"]["columns"]}
        self.assertEqual(cols["document_number"]["rules"],
                         ["primary key, part 1 of 5", "required", "references `documents.document_number` (on delete cascade)"])
        self.assertEqual(cols["section"]["rules"], ["primary key, part 4 of 5", "required", "default `''`"])
        self.assertEqual(cols["source"]["note"], "'reference' | 'text' | 'body'")      # the comment in SCHEMA
        self.assertEqual(by_name["document_cfr"]["indexes"],
                         [{"name": "document_cfr_lookup", "unique": False, "columns": ["title", "part", "section"]}])
        self.assertEqual(by_name["documents_fts"]["fts"],
                         {"columns": [{"name": n, "indexed": True} for n in ("title", "abstract", "action", "body")],
                          "options": {"tokenize": "porter unicode61"}})
        cfr = {t["name"]: t for t in schema_doc.describe("cfr")}
        self.assertEqual(cfr["sections_fts"]["fts"]["columns"][0], {"name": "id", "indexed": False})
        news = {t["name"]: t for t in schema_doc.describe("news")}
        self.assertIn({"name": "idx_articles_pub", "unique": False, "columns": ["published_at DESC"]},
                      news["articles"]["indexes"])
        self.assertIn("federal_register \\| federal_register_pi \\| dol_osha", schema_doc.render())   # table-safe

    def test_a_schema_change_or_a_new_migration_changes_the_document(self):
        committed = (READER_DIR / "DATA_DICTIONARY.md").read_text(encoding="utf-8")
        with mock.patch.object(plaw, "SCHEMA", plaw.SCHEMA + "CREATE TABLE IF NOT EXISTS sponsors (law_id TEXT, name TEXT);"):
            changed = schema_doc.render()
            self.assertNotEqual(changed, committed)
            self.assertIn("### `sponsors`", changed)
            self.assertNotEqual(set(schema_doc.TABLES["plaw"]), {t["name"] for t in schema_doc.describe("plaw")})
        step = migrate.Migration(2, "Add the sponsors table", lambda con: None)
        with mock.patch.dict(migrate.MIGRATIONS, {"plaw": [*migrate.MIGRATIONS["plaw"], step]}):
            changed = schema_doc.render()
            self.assertIn("Version 2: Add the sponsors table", changed)
            self.assertIn("| `plaw.sqlite3` | 2 |", changed)
        self.assertEqual(schema_doc.render(), committed)

    def test_command_line(self):
        tmp = Path(tempfile.mkdtemp(prefix="schema-doc-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        out_file = tmp / "DATA_DICTIONARY.md"

        def run(*argv: str) -> tuple[str, str, int]:
            out, err, code = io.StringIO(), io.StringIO(), 0
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                try:
                    schema_doc.main(list(argv))
                except SystemExit as stop:
                    code = stop.code
            return out.getvalue(), err.getvalue(), code

        with mock.patch.object(schema_doc, "OUTPUT", out_file):
            self.assertEqual(run("--check")[2], 1)                  # no file yet
            self.assertFalse(out_file.exists())                     # --check writes nothing
            self.assertEqual(run("--stdout")[0], schema_doc.render())
            self.assertFalse(out_file.exists())
            self.assertIn("wrote", run()[0])
            self.assertEqual(out_file.read_bytes().decode("utf-8"), schema_doc.render())   # LF on every platform
            self.assertIn("already up to date", run()[0])
            self.assertEqual(run("--check")[2], 0)
            out_file.write_text(out_file.read_text(encoding="utf-8").replace("required", "optional", 1), encoding="utf-8")
            _, err, code = run("--check")
            self.assertEqual(code, 1)
            self.assertIn("python -m app.schema_doc", err)
        self.assertEqual(run("--check")[2], 0)                      # the committed file


class MetaKeyTests(HermeticTestCase):
    """`meta` is a key-value table, so its keys are not in any schema. Every key a pipeline
    writes has to be in `schema_doc.META_KEYS`; the fakes of the other suites build each store."""

    def setUp(self):
        super().setUp()
        self.fake = FakeTitles(titles=(29,))
        self.fake.install()                                         # a temp DATA_DIR for everything below
        self.addCleanup(self.fake.remove)
        for mod in (usc_build, constitution, plaw, agenda, fr_build, migrate):
            p = mock.patch.object(mod, "log", lambda msg: None)
            p.start()
            self.addCleanup(p.stop)
        usc_client.clear_cache()
        usc_store.clear_caches()
        for undo in (usc_client.clear_cache, usc_store.clear_caches, store.reset_connections):
            self.addCleanup(undo)

    def keys(self, path: Path) -> set[str]:
        with closing(sqlite3.connect(path)) as con:
            return {r[0] for r in con.execute("SELECT key FROM meta")}

    def test_every_meta_key_a_pipeline_writes_is_documented(self):
        from tests.test_fr_corpus import HAZCOM, RCRA, FakeFR
        from tests.test_new_corpora import FakeGov
        from tests.test_usc_corpus import FakeOLRC
        with FakeOLRC().patch():
            usc_build.build(4, force=True)
        with FakeGov().patch():
            constitution.build()
            constitution.update()                                   # records `checked_at`
            plaw.build(types=["public"])
            plaw.update()
            agenda.build(years=2, agencies=["1200"], today=date(2026, 11, 20))
            agenda.update()
        with FakeFR([HAZCOM, RCRA]).patch():
            fr_build.build(titles=[29, 40], since="2026-06-01", until="2026-11-18", force=True)
            fr_build.update(titles=[29, 40])
        failure = RuntimeError("source unavailable")
        fr_build.record_failure(failure)
        plaw.record_failure(failure)
        agenda.record_failure(failure)
        constitution._record({"last_error": "x", "last_error_at": constitution.now_iso()})
        written = {
            "cfr": self.keys(config.db_path(29)), "usc": self.keys(usc_store.db_path(4)),
            "fr": self.keys(fr_store.db_path()), "constitution": self.keys(constitution.db_path()),
            "plaw": self.keys(plaw.db_path()), "agenda": self.keys(agenda.db_path()),
        }
        self.assertEqual(set(written), set(schema_doc.META_KEYS))
        for kind, keys in written.items():
            with self.subTest(kind=kind):
                self.assertGreater(len(keys), 5)
                self.assertEqual(keys - set(schema_doc.META_KEYS[kind]), set(),
                                 f"add these {kind} meta keys to schema_doc.META_KEYS, then run python -m app.schema_doc")
