"""The offline reindex command (`app/reindex.py`, register DM-003 / SEC-007).

Two fake CFR titles are built by the real pipeline (Title 29 with the § 1910.6 IBR section from
`test_graph`), so the citation graph has web references, backlinks and an IBR catalog to lose
and rebuild. Every test runs under the network guard: a step that reached for the network
would fail its row.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import textwrap
from contextlib import closing
from pathlib import Path
from unittest import mock

import httpx
from fastapi.testclient import TestClient

import fake_titles
from app import config, migrate, reindex, store
from app.citations import graph
from app.main import app
from tests.base import HermeticTestCase
from tests.test_graph import IBR_AUGMENTED_STRUCT, IBR_AUGMENTED_XML

READER_DIR = Path(__file__).resolve().parent.parent


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def graph_payload(title: int) -> dict | None:
    """The stored index, parsed: its key order follows set iteration, which differs from one
    process to the next, so the bytes are not comparable across runs; the content is."""
    with closing(sqlite3.connect(config.db_path(title))) as con:
        try:
            row = con.execute("SELECT payload FROM title_graph WHERE key = 'index'").fetchone()
        except sqlite3.OperationalError:
            return None
    return json.loads(row[0]) if row else None


class ReindexTestCase(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.fake = fake_titles.FakeTitles(titles=(29, 40))
        with mock.patch.dict(fake_titles.XML, {29: IBR_AUGMENTED_XML}), \
                mock.patch.dict(fake_titles.STRUCTURE, {29: IBR_AUGMENTED_STRUCT}):
            self.fake.install()
        self.addCleanup(self.fake.remove)
        for target, name, value in ((migrate, "log", lambda msg: None),):
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        isolated = mock.patch.dict(reindex._STEPS)      # steps a test registers go away with it
        isolated.start()
        self.addCleanup(isolated.stop)
        self.client = TestClient(app)

    def get(self, url: str) -> dict:
        res = self.client.get(url)
        self.assertEqual(res.status_code, 200, url)
        return res.json()

    def leftovers(self) -> list[str]:
        return sorted(f.name for f in config.DATA_DIR.iterdir() if ".tmp" in f.name or f.name.endswith("-journal"))


class CitationGraphTests(ReindexTestCase):
    def test_a_deleted_graph_is_rebuilt_identically_with_no_network(self):
        references = self.get("/api/29/references")
        cited_by = self.get("/api/29/citations/1910.134")
        stored = graph_payload(29)
        self.assertGreaterEqual(references["ibr_total"], 1)             # there is something to lose
        self.assertGreaterEqual(cited_by["cited_by_count"], 1)

        with closing(sqlite3.connect(config.db_path(29))) as con:
            con.execute("DELETE FROM title_graph")
            con.commit()
        self.assertIsNone(graph_payload(29))

        rows = reindex.run(corpus="cfr", title=29)                      # the network guard is on
        self.assertEqual([(r["step"], r["target"], r["status"]) for r in rows],
                         [("cfr.citation_graph", "title 29", "ok")])
        self.assertEqual(graph_payload(29), stored)                     # exactly what the build had stored
        self.assertEqual(self.get("/api/29/references"), references)
        self.assertEqual(self.get("/api/29/citations/1910.134"), cited_by)
        self.assertEqual(self.leftovers(), [])
        with closing(sqlite3.connect(config.db_path(29))) as con:
            self.assertEqual(con.execute("PRAGMA quick_check").fetchone()[0], "ok")
            self.assertEqual(migrate.user_version(con), migrate.latest("cfr"))

    def test_a_title_from_before_the_graph_was_stored_gets_one(self):
        stored = {t: graph_payload(t) for t in (29, 40)}
        for t in (29, 40):
            with closing(sqlite3.connect(config.db_path(t))) as con:
                con.execute("DROP TABLE title_graph")
                con.execute("PRAGMA user_version = 0")                  # and from before schema versions
                con.commit()
        store.reset_connections()
        rows = reindex.run()                                            # every step, everything installed
        self.assertEqual([(r["target"], r["status"]) for r in rows], [("title 29", "ok"), ("title 40", "ok")])
        self.assertEqual({t: graph_payload(t) for t in (29, 40)}, stored)
        self.assertEqual(migrate.read_version(config.db_path(40)), migrate.latest("cfr"))

    def test_the_rebuilt_graph_follows_the_stored_text_and_caches_are_cleared(self):
        before = self.get("/api/29/references")                         # warms the in-memory index
        self.assertNotIn("example.gov", json.dumps(before))
        with closing(sqlite3.connect(config.db_path(29))) as con:
            con.execute("UPDATE sections SET text = text || ' See https://www.example.gov/respirators and § 1910.135.' "
                        "WHERE id = '1910.134'")
            con.commit()
        self.assertEqual(self.get("/api/29/references"), before)        # derived data is stale until reindexed
        reindex.run(corpus="cfr", title=29)
        after = self.get("/api/29/references")
        self.assertIn("example.gov", {h["host"] for h in after["hosts"]})
        self.assertIn("1910.134", {c["id"] for c in self.get("/api/29/citations/1910.135")["cited_by"]})
        self.assertEqual(self.get("/api/29/section/1910.134")["id"], "1910.134")

    def test_a_step_that_fails_half_way_leaves_the_title_untouched(self):
        before = {t: sha(config.db_path(t)) for t in (29, 40)}
        real = graph.persist_title_index

        def fails_for_29(con, title):
            real(con, title)
            con.execute("DELETE FROM sections")                         # damage, on the copy
            con.commit()
            if title == 29:
                raise RuntimeError("killed half way")

        with mock.patch.object(graph, "persist_title_index", fails_for_29):
            rows = reindex.run(corpus="cfr")
        self.assertEqual([(r["target"], r["status"]) for r in rows], [("title 29", "failed"), ("title 40", "ok")])
        self.assertIn("killed half way", rows[0]["detail"])
        self.assertEqual(sha(config.db_path(29)), before[29])
        self.assertNotEqual(sha(config.db_path(40)), before[40])        # one failure does not stop the next title
        self.assertEqual(self.get("/api/29/section/1910.134")["id"], "1910.134")
        self.assertEqual(self.leftovers(), [])

    def test_a_copy_that_fails_its_integrity_check_is_not_installed(self):
        before = sha(config.db_path(29))
        with mock.patch.object(migrate, "quick_check", lambda con: "row 2 missing from index"):
            rows = reindex.run(corpus="cfr", title=29)
        self.assertEqual(rows[0]["status"], "failed")
        self.assertIn("integrity check", rows[0]["detail"])
        self.assertEqual(sha(config.db_path(29)), before)
        self.assertEqual(self.leftovers(), [])

    def test_a_title_replaced_meanwhile_is_not_overwritten(self):
        real = graph.persist_title_index

        def rebuilt_meanwhile(con, title):
            os.utime(config.db_path(title), ns=(1, 1))                  # e.g. a build installed a new edition
            real(con, title)

        with mock.patch.object(graph, "persist_title_index", rebuilt_meanwhile):
            rows = reindex.run(corpus="cfr", title=29)
        self.assertEqual(rows[0]["status"], "failed")
        self.assertIn("Run it again", rows[0]["detail"])
        self.assertEqual(self.leftovers(), [])

    def test_a_newer_store_is_refused(self):
        with closing(sqlite3.connect(config.db_path(29))) as con:
            con.execute("PRAGMA user_version = 9")
        before = sha(config.db_path(29))
        rows = reindex.run(corpus="cfr", title=29)
        self.assertEqual(rows[0]["status"], "failed")
        self.assertIn("version 9", rows[0]["detail"])
        self.assertEqual(sha(config.db_path(29)), before)

    def test_hard_kill_half_way_leaves_the_live_title_untouched(self):
        before = sha(config.db_path(29))
        child = textwrap.dedent("""
            import os, sys
            from pathlib import Path
            from app import config, migrate, reindex
            from app.citations import graph

            config.DATA_DIR = Path(sys.argv[1])
            migrate.log = lambda msg: None
            real = graph.persist_title_index

            def dies(con, title):
                real(con, title)
                con.execute("UPDATE sections SET text = text || 'x'")
                con.commit()                                # the copy is now different, on disk
                os._exit(9)

            graph.persist_title_index = dies
            reindex.run(corpus="cfr", title=29)
        """)
        done = subprocess.run([sys.executable, "-c", child, str(config.DATA_DIR)], cwd=READER_DIR)
        self.assertEqual(done.returncode, 9)
        self.assertEqual(sha(config.db_path(29)), before)
        self.assertRegex(self.leftovers()[0], r"^title-29\.sqlite3\.reindex\.\d+\.tmp$")   # the dead run's copy
        self.assertEqual(reindex.run(corpus="cfr", title=29)[0]["status"], "ok")           # is not in the next run's way
        self.assertEqual(migrate.discard_stale_copies(config.db_path(29)), 1)
        self.assertEqual(self.leftovers(), [])


class RegistryTests(ReindexTestCase):
    """What the next derived store (the link index) relies on: one registered function."""

    def derived(self) -> Path:
        return config.DATA_DIR / "derived.sqlite3"

    def register_derived_store(self, fail: bool = False, marker: str = "v1"):
        @reindex.step("test.derived", corpus="test", summary="A derived store in its own file")
        def build(target, report):
            with reindex.new_file(self.derived()) as tmp:
                with closing(sqlite3.connect(tmp)) as con:
                    con.execute("CREATE TABLE made (marker TEXT, sections INTEGER)")
                    n = sum(store.db(t).execute("SELECT count(*) FROM sections").fetchone()[0]
                            for t in config.installed_titles())
                    con.execute("INSERT INTO made VALUES (?, ?)", (marker, n))
                    con.commit()
                if fail:
                    raise RuntimeError("killed half way")
            return f"{n} sections counted"
        return build

    def made(self) -> tuple:
        with closing(sqlite3.connect(self.derived())) as con:
            return con.execute("SELECT marker, sections FROM made").fetchone()

    def test_a_registered_function_is_all_a_new_step_needs(self):
        self.register_derived_store()
        self.assertEqual([s.name for s in reindex.steps()], ["cfr.citation_graph", "test.derived"])
        rows = reindex.run(corpus="test")
        self.assertEqual([(r["step"], r["target"], r["status"], r["detail"]) for r in rows],
                         [("test.derived", "-", "ok", "7 sections counted")])
        self.assertEqual(self.made(), ("v1", 7))
        self.assertEqual({r["step"] for r in reindex.run()}, {"cfr.citation_graph", "test.derived"})
        self.assertEqual([r["step"] for r in reindex.run(only="test.derived")], ["test.derived"])
        # --title picks among per-title steps; a step that runs once is not one of them
        self.assertEqual([(r["step"], r["target"]) for r in reindex.run(title=40)], [("cfr.citation_graph", "title 40")])
        self.assertEqual(reindex.run(corpus="nothing"), [])

    def test_a_new_file_step_that_dies_keeps_the_old_file(self):
        self.register_derived_store()
        reindex.run(corpus="test")
        before = sha(self.derived())
        reindex._STEPS.pop("test.derived")
        self.register_derived_store(fail=True, marker="v2")
        rows = reindex.run(corpus="test")
        self.assertEqual(rows[0]["status"], "failed")
        self.assertEqual(sha(self.derived()), before)
        self.assertEqual(self.made(), ("v1", 7))
        self.assertEqual(self.leftovers(), [])

    def test_new_file_checks_what_was_built(self):
        with self.assertRaisesRegex(migrate.MigrationError, "nothing was written"), reindex.new_file(self.derived()):
            pass
        with self.assertRaises(sqlite3.DatabaseError), reindex.new_file(self.derived()) as tmp:
            tmp.write_bytes(b"this is not a database, " * 100)
        self.assertFalse(self.derived().exists())
        self.assertEqual(self.leftovers(), [])

    def test_two_modules_cannot_claim_one_name(self):
        self.register_derived_store()
        self.register_derived_store()                    # the same function again (a re-import) is fine
        with self.assertRaisesRegex(ValueError, "already registered"):
            @reindex.step("test.derived", corpus="test", summary="someone else's")
            def other(target, report):
                return None

    def test_discover_imports_the_app_and_reports_broken_modules(self):
        self.assertEqual(reindex.discover(), [])
        self.assertIn("app.usc_citations", sys.modules)
        real = reindex.importlib.import_module
        sys.modules.pop("app.dol_catalog", None)

        def broken(name):
            if name == "app.dol_catalog":
                raise ImportError("missing dependency")
            return real(name)

        with mock.patch.object(reindex.importlib, "import_module", broken):
            self.assertEqual(reindex.discover(), ["app.dol_catalog: missing dependency"])
        self.assertEqual(reindex.discover(), [])


class CommandTests(ReindexTestCase):
    def run_main(self, *argv: str) -> tuple[str, int]:
        out = io.StringIO()
        code = 0
        with contextlib.redirect_stdout(out):
            try:
                reindex.main(list(argv))
            except SystemExit as stop:
                code = stop.code
        return out.getvalue(), code

    def test_reindex_offline_rebuilds_and_reports(self):
        stored = graph_payload(29)
        with closing(sqlite3.connect(config.db_path(29))) as con:
            con.execute("DELETE FROM title_graph")
            con.commit()
        text, code = self.run_main("--offline", "--json")
        rows = json.loads(text)
        self.assertEqual(code, 0)
        self.assertEqual([(r["target"], r["status"]) for r in rows], [("title 29", "ok"), ("title 40", "ok")])
        self.assertEqual(graph_payload(29), stored)
        text, code = self.run_main("--corpus", "cfr", "--title", "40")
        self.assertIn("cfr.citation_graph", text)
        self.assertNotIn("title 29", text)

    def test_list_and_nothing_to_do(self):
        text, code = self.run_main("--list")
        self.assertEqual((code, text.split()[0]), (0, "cfr.citation_graph"))
        self.assertEqual(json.loads(self.run_main("--list", "--json")[0])[0]["per_title"], True)
        text, code = self.run_main("--corpus", "usc")
        self.assertEqual((code, text.strip()), (0, "Nothing to reindex: no matching step, or nothing installed for it."))

    def test_the_command_refuses_the_network_and_fails_the_step_that_tried(self):
        guard = httpx.HTTPTransport.handle_request

        @reindex.step("test.online", corpus="test", summary="A step that should not exist")
        def online(target, report):
            httpx.get("https://www.ecfr.gov/api/versioner/v1/titles.json")

        text, code = self.run_main("--corpus", "test")
        self.assertEqual(code, 1)                                       # a failed step fails the command
        self.assertIn("reindex is offline", text)
        self.assertIs(httpx.HTTPTransport.handle_request, guard)        # and the process gets its network back

    def test_python_dash_m_runs_the_importable_module(self):
        """`python -m app.reindex` executes the file as `__main__`; steps register against
        `app.reindex`. The command must list them all the same."""
        done = subprocess.run([sys.executable, "-m", "app.reindex", "--list"], cwd=READER_DIR,
                              capture_output=True, text=True)
        self.assertEqual((done.returncode, done.stderr), (0, ""))
        self.assertTrue(done.stdout.startswith("cfr.citation_graph"))
