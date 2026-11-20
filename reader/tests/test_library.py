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

    def test_corrupt_db_does_not_crash_installed(self):
        (self.tmp / "title-99.sqlite3").write_bytes(b"not a sqlite database")
        self.assertIsNone(library.installed(99))

    def test_duplicate_appendix_ids_across_parts_disambiguate_and_build(self):
        dup_struct = {
            "type": "title", "identifier": "14", "label": "Title 14", "label_description": "Test", "children": [
                {"type": "chapter", "identifier": "I", "label": "Chapter I", "label_description": "FAA", "children": [
                    {"type": "part", "identifier": "71", "label": "Part 71", "label_description": "Airspace", "children": [
                        {"type": "appendix", "identifier": "SFAR No. 97", "label": "SFAR No. 97", "label_description": "Ops A"},
                    ]},
                    {"type": "part", "identifier": "91", "label": "Part 91", "label_description": "Flight", "children": [
                        {"type": "appendix", "identifier": "SFAR No. 97", "label": "SFAR No. 97", "label_description": "Ops B"},
                    ]},
                ]},
            ],
        }
        dup_xml = (
            '<DIV1 N="14">'
            '<DIV5 N="71" TYPE="PART"><HEAD>PART 71</HEAD>'
            '<DIV9 N="SFAR No. 97" TYPE="APPENDIX"><HEAD>SFAR 97</HEAD><P>Part 71 rules.</P></DIV9></DIV5>'
            '<DIV5 N="91" TYPE="PART"><HEAD>PART 91</HEAD>'
            '<DIV9 N="SFAR No. 97" TYPE="APPENDIX"><HEAD>SFAR 97</HEAD><P>Part 91 rules.</P></DIV9></DIV5>'
            '</DIV1>'
        )

        def dup_fetch(_c, url):
            if url.endswith("/titles.json"):
                return {"titles": [{"number": 14, "name": "Aeronautics", "up_to_date_as_of": "2026-01-02", "reserved": False}]}
            return dup_struct

        def dup_dl(_c, url, dest, on_bytes=None):
            if "part=71" in url:
                dest.write_text('<DIV5 N="71"><DIV9 N="SFAR No. 97"><P>Part 71 rules.</P></DIV9></DIV5>', encoding="utf-8")
            else:
                dest.write_text(dup_xml, encoding="utf-8")

        with mock.patch.object(build, "fetch_json", dup_fetch), \
             mock.patch.object(build, "download_stream", dup_dl), \
             mock.patch.object(library, "ecfr_titles", lambda refresh=False: dup_fetch(None, "/titles.json")["titles"]):
            library._structures.clear()
            build.build(14, force=True)
            self.assertEqual(store.known_ids(14), frozenset({"71:SFAR No. 97", "91:SFAR No. 97"}))
            self.assertIn("Part 71</a> rules.", store.get_section("71:SFAR No. 97", title=14)["html"])
            self.assertIn("Part 91</a> rules.", store.get_section("91:SFAR No. 97", title=14)["html"])

            # Partial install of 71:SFAR No. 97 must not mark Part 91's SFAR as installed.
            build.build(14, force=True, scope=build.normalize_scope({
                "parts": [], "sections": [{"t": "appendix", "id": "71:SFAR No. 97", "part": "71"}],
            }))
            self.assertEqual(library.part_view(14, "71")["installed"], "all")
            self.assertIsNone(library.part_view(14, "91")["installed"])
            store.release_title(14)

    def test_rebuild_closes_open_reader_connections_before_replacing(self):
        # Windows refuses to replace a file that is open; emulate that so the
        # regression is caught on every platform.
        build.build(99, force=True)
        store.known_ids(99)  # leaves a read connection to title-99.sqlite3 open
        self.assertTrue(any(t == 99 for t, _c, _l in store._registry))
        real_replace = Path.replace

        def windows_replace(src, dest):
            if Path(dest).name == "title-99.sqlite3" and any(t == 99 for t, _c, _l in store._registry):
                raise PermissionError("[WinError 5] Access is denied")
            return real_replace(src, dest)

        with mock.patch.object(Path, "replace", windows_replace), \
             mock.patch.object(build.time, "sleep", lambda _s: None):
            build.build(99, force=True)
        self.assertTrue(store.known_ids(99))

    def test_invalid_partial_addition_does_not_corrupt_scope(self):
        build.build(99, force=True, scope={"parts": ["2"], "sections": []})
        with self.assertRaises(ValueError):
            library.run_job({"title": 99, "kind": "part", "target": {"part": "9999"}}, lambda *a, **k: None)
        self.assertEqual(library.installed(99)["scope"], {"parts": ["2"], "sections": []})


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

    def test_retry_delay_429_and_404_fast_fail(self):
        import httpx
        req = httpx.Request("GET", "https://www.ecfr.gov/api/versioner/v1/titles.json")
        r429 = httpx.Response(429, headers={"Retry-After": "12"}, request=req)
        r404 = httpx.Response(404, request=req)
        self.assertEqual(build._retry_delay(httpx.HTTPStatusError("rate", request=req, response=r429), 0), 12.0)
        self.assertIsNone(build._retry_delay(httpx.HTTPStatusError("missing", request=req, response=r404), 0))

        calls = []
        transport = httpx.MockTransport(lambda r: (calls.append(r), httpx.Response(404, request=r))[1])
        with httpx.Client(transport=transport) as client, mock.patch.object(build, "_pace_ecfr"):
            with self.assertRaises(httpx.HTTPStatusError):
                build.fetch_json(client, "https://www.ecfr.gov/api/versioner/v1/structure/2026-01-01/title-35.json")
        self.assertEqual(len(calls), 1)

    def test_completeness_meta_and_empty_scope_error(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.addCleanup(store.release_title, 99)
        with mock.patch.object(config, "DATA_DIR", tmp), \
             mock.patch.object(build, "fetch_json", fake_fetch_json), \
             mock.patch.object(build, "download_stream", fake_download), \
             mock.patch.object(library, "ecfr_titles", lambda refresh=False: fake_fetch_json(None, "/titles.json")["titles"]):
            # Title 99 has reserved section 2.2 with no XML: should NOT count as missing_leaves.
            build.build(99, force=True)
            self.assertEqual(store.meta(99)["missing_leaves"], "0")

            # Empty XML for Part 2 must fail cleanly with no .tmp left behind.
            def empty_dl(_c, _url, dest, on_bytes=None):
                dest.write_text('<DIV5 N="2"></DIV5>', encoding="utf-8")
            with mock.patch.object(build, "download_stream", empty_dl):
                with self.assertRaises(ValueError):
                    build.build(99, force=True, scope={"parts": ["2"], "sections": []})
            self.assertFalse((tmp / "title-99.tmp").exists())

    def test_reload_endpoint_and_temp_detection(self):
        from app.library import disk
        self.assertTrue(disk._is_temp("title-29.xml.tmp.download"))
        with mock.patch.object(library, "reload_installed", return_value=[29, 40]) as rel:
            res = self.client.post("/api/library/reload")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"reloaded": [29, 40]})
        rel.assert_called_once()


if __name__ == "__main__":
    unittest.main()
