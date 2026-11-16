"""The download library: partial scopes, partial builds (network mocked), install states,
and replacing a title's database while the server has it open."""
import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import build, config, library, store
from tests.base import HermeticTestCase

# A tiny title: Part 1 (two sections + an appendix) and Part 2 (one section, one reserved).
STRUCTURE = {
    "type": "title", "identifier": "99", "label": "Title 99", "label_description": "Test", "children": [
        {"type": "chapter", "identifier": "I", "label": "Chapter I", "label_description": "Testing Agency", "children": [
            {"type": "part", "identifier": "1", "label": "Part 1", "label_description": "First Part", "children": [
                {"type": "section", "identifier": "1.1", "label": "§ 1.1", "label_description": "Scope."},
                {"type": "section", "identifier": "1.2", "label": "§ 1.2", "label_description": "Terms."},
                {"type": "appendix", "identifier": "Appendix A to Part 1", "label": "Appendix A to Part 1",
                 "label_description": "Forms"},
            ]},
            {"type": "part", "identifier": "2", "label": "Part 2", "label_description": "Second Part", "children": [
                {"type": "section", "identifier": "2.1", "label": "§ 2.1", "label_description": "Purpose."},
                {"type": "section", "identifier": "2.2", "label": "§ 2.2", "label_description": "[Reserved]", "reserved": True},
            ]},
        ]},
    ],
}


def div8(n, text):
    return f'<DIV8 N="{n}" TYPE="SECTION"><HEAD>§ {n}</HEAD><P>{text}</P></DIV8>'


XML = {
    "part=1": f'<DIV5 N="1" TYPE="PART"><HEAD>PART 1</HEAD><AUTH><P>Authority: test.</P></AUTH>'
              f'{div8("1.1", "Scope text.")}{div8("1.2", "Terms text.")}'
              f'<DIV9 N="Appendix A to Part 1" TYPE="APPENDIX"><HEAD>Appendix A</HEAD><P>Forms text.</P></DIV9></DIV5>',
    "part=2": f'<DIV5 N="2" TYPE="PART"><HEAD>PART 2</HEAD>{div8("2.1", "Purpose text.")}</DIV5>',
    "section=2.1": div8("2.1", "Purpose text."),
    "section=1.2": div8("1.2", "Terms text."),
}
XML["whole"] = f'<DIV1 N="99">{XML["part=1"]}{XML["part=2"]}</DIV1>'


def fake_fetch_json(_client, url):
    if url.endswith("/titles.json"):
        return {"titles": [{"number": 99, "name": "Test", "up_to_date_as_of": "2026-01-02", "reserved": False}]}
    if "/structure/" in url:
        return STRUCTURE
    raise AssertionError(url)


def fake_download(_client, url, dest, on_bytes=None):
    key = url.split("?", 1)[1] if "?" in url else "whole"
    dest.write_text(XML[key], encoding="utf-8")
    if on_bytes:
        on_bytes(10, 10)


class ScopeTests(HermeticTestCase):
    def test_sections_inside_a_selected_part_drop(self):
        s = build.normalize_scope({"parts": ["1"], "sections": [
            {"t": "section", "id": "1.2", "part": "1"}, {"t": "section", "id": "2.1", "part": "2"},
            {"t": "section", "id": "2.1", "part": "2"},
        ]})
        self.assertEqual(s, {"parts": ["1"], "sections": [{"t": "section", "id": "2.1", "part": "2"}]})

    def test_merge_with_whole_title_is_whole(self):
        self.assertIsNone(build.merge_scope(None, {"parts": ["1"], "sections": []}))
        self.assertIsNone(build.merge_scope({"parts": ["1"], "sections": []}, None))

    def test_merge_part_absorbs_its_sections(self):
        merged = build.merge_scope({"parts": [], "sections": [{"t": "section", "id": "1.2", "part": "1"}]},
                                   {"parts": ["1"], "sections": []})
        self.assertEqual(merged, {"parts": ["1"], "sections": []})

    def test_prune_keeps_ancestors(self):
        tree = build.nest_loose_sections(build.trim_tree(STRUCTURE))
        pruned = build.prune_tree(tree, {"parts": [], "sections": [{"t": "section", "id": "2.1", "part": "2"}]})
        chapter = pruned["c"][0]
        self.assertEqual([p["id"] for p in chapter["c"]], ["2"])
        self.assertEqual([s["id"] for s in chapter["c"][0]["c"]], ["2.1"])
        self.assertEqual(build.count_leaves(pruned), 1)


class PartialBuildTests(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp())
        self.patches = [
            mock.patch.object(config, "DATA_DIR", self.tmp),
            mock.patch.object(build, "fetch_json", fake_fetch_json),
            mock.patch.object(build, "download_stream", fake_download),
            mock.patch.object(library, "ecfr_titles", lambda refresh=False: fake_fetch_json(None, "/titles.json")["titles"]),
        ]
        for p in self.patches:
            p.start()
        library._structures.clear()
        store.reset_connections()

    def tearDown(self):
        store.release_title(99)
        for p in self.patches:
            p.stop()
        store.reset_connections()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def sections(self):
        con = sqlite3.connect(self.tmp / "title-99.sqlite3")
        try:
            return [r[0] for r in con.execute("SELECT id FROM sections ORDER BY ord")]
        finally:
            con.close()

    def test_section_then_part_then_whole(self):
        phases = []
        build.build(99, force=True, scope=build.normalize_scope({"sections": [{"t": "section", "id": "2.1", "part": "2"}]}),
                    progress=lambda phase, done=None, total=None: phases.append(phase))
        self.assertEqual(self.sections(), ["2.1"])
        self.assertIn("Indexing", phases)
        inst = library.installed(99)
        self.assertEqual(inst["scope"]["sections"], [{"t": "section", "id": "2.1", "part": "2"}])

        # Adding Part 1 rebuilds with both, in reading order; the tree holds only what's in.
        library.run_job({"title": 99, "kind": "part", "target": {"part": "1"}}, lambda *a, **k: None)
        self.assertEqual(self.sections(), ["1.1", "1.2", "Appendix A to Part 1", "2.1"])
        tree = json.loads((self.tmp / "tree-99.json").read_text(encoding="utf-8"))
        self.assertEqual([p["id"] for p in tree["c"][0]["c"]], ["1", "2"])
        self.assertEqual([s["id"] for s in tree["c"][0]["c"][1]["c"]], ["2.1"])

        # The library reports Part 1 whole, Part 2's one real section as the whole part.
        view = library.title_view(99)
        states = {p["id"]: p["installed"] for g in view["groups"] for p in g["parts"]}
        self.assertEqual(states, {"1": "all", "2": "all"})
        self.assertEqual(library.part_view(99, "2")["installed"], "all")

        # The whole title replaces the partial copy and drops the scope.
        library.run_job({"title": 99, "kind": "title", "target": None}, lambda *a, **k: None)
        self.assertIsNone(library.installed(99)["scope"])
        self.assertEqual(self.sections(), ["1.1", "1.2", "Appendix A to Part 1", "2.1"])

    def test_same_scope_same_edition_is_a_no_op(self):
        build.build(99, force=True, scope={"parts": ["2"], "sections": []})
        before = (self.tmp / "title-99.sqlite3").stat().st_mtime_ns
        seen = []
        library.run_job({"title": 99, "kind": "section", "target": {"t": "section", "id": "2.1", "part": "2"}},
                        lambda phase, done=None, total=None: seen.append(phase))
        self.assertEqual(seen, ["Already installed"])
        self.assertEqual((self.tmp / "title-99.sqlite3").stat().st_mtime_ns, before)

    def test_rebuild_replaces_an_open_database(self):
        build.build(99, force=True, scope={"parts": ["2"], "sections": []})
        # A server thread holds the title open (Windows refuses to replace an open file).
        self.assertEqual(store.meta(99)["section_count"], "1")
        library.run_job({"title": 99, "kind": "part", "target": {"part": "1"}}, lambda *a, **k: None)
        self.assertEqual(store.meta(99)["section_count"], "4")

    def test_remove(self):
        build.build(99, force=True, scope={"parts": ["2"], "sections": []})
        store.meta(99)  # open it
        library.remove(99)
        self.assertFalse((self.tmp / "title-99.sqlite3").exists())
        self.assertFalse((self.tmp / "tree-99.json").exists())


class LibraryApiGuardTests(HermeticTestCase):
    def setUp(self):
        super().setUp()
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)

    def test_cannot_remove_the_only_title(self):
        with mock.patch.object(config, "installed_titles", lambda: [29]), \
             mock.patch.object(library, "remove") as remove:
            res = self.client.delete("/api/library/29")
        self.assertEqual(res.status_code, 409)
        remove.assert_not_called()

    def test_reserved_title_refused(self):
        with mock.patch.object(library, "ecfr_title", lambda t: {"number": t, "reserved": True}), \
             mock.patch.object(library.queue, "submit") as submit:
            res = self.client.post("/api/library/download", json={"title": 35})
        self.assertEqual(res.status_code, 400)
        submit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
