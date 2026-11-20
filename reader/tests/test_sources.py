"""The federal source registry: /api/sources, the selection, presets, templates, preview /
apply, and the pipelines honouring enabled flags and schedules.

Hermetic: `config.DATA_DIR` is a temp dir, the library queue is a mock where jobs would be
queued, and the Federal Register is an `httpx.MockTransport`.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import httpx
from fastapi.testclient import TestClient

from app import config, fr_build, fr_client, fr_store, library, news, news_store, news_worker, usc_build, usc_store
from app.library import jobs
from app.main import app
from app.sources import presets, registry, selection
from tests.base import HermeticTestCase
from tests.test_fr_corpus import HAZCOM, RCRA


class SourcesTestCase(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="sources-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for target, attr, value in ((config, "DATA_DIR", self.tmp),):
            p = mock.patch.object(target, attr, value)
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(app)
        self.queue = mock.Mock()
        self.queue.busy_with.return_value = False
        self.queue.operation_lock.return_value = threading.Lock()
        self.queue.submit.side_effect = lambda t, k, tg, label: {"id": 1, "title": t, "kind": k, "target": tg,
                                                                 "label": label}
        self.queue.snapshot.return_value = {"current": None, "queued": [], "recent": []}
        q = mock.patch.object(library, "queue", self.queue)
        q.start()
        self.addCleanup(q.stop)
        jobs.reset_cfr_schedule()
        self.addCleanup(jobs.reset_cfr_schedule)
        usc_build.reset_schedule()
        self.addCleanup(usc_build.reset_schedule)

    def submitted(self) -> list[tuple]:
        return [c.args[:3] for c in self.queue.submit.call_args_list]


class RegistryShapeTests(SourcesTestCase):
    def test_catalog_lists_every_source_with_plain_labels(self):
        r = self.client.get("/api/sources")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["cache-control"], "no-store")
        d = r.json()
        self.assertEqual(d["categories"], ["Statutes", "Regulations", "Rulemaking", "Enforcement", "News"])
        ids = [s["id"] for s in d["sources"]]
        self.assertEqual(ids, list(registry.SOURCE_IDS))
        self.assertFalse(d["saved"])
        self.assertEqual(d["default_preset"], "preset:recommended")
        for s in d["sources"]:
            for k in ("label", "description", "category", "enabled", "schedule", "scope", "filters", "status",
                      "actions", "schedule_options", "default_scope", "needs_key", "key_present", "get_key_url"):
                self.assertIn(k, s, (s["id"], k))
            self.assertIn(s["category"], d["categories"])
            self.assertTrue(s["label"] and s["description"])
            for o in s["schedule_options"]:
                self.assertTrue(o["label"] and o["description"])
            for f in s["filters"]:
                self.assertTrue(f["label"] and f["description"], f["id"])
                for o in f.get("options", []):
                    self.assertTrue(o["label"], o)
                    self.assertIn("description", o)
        by = {s["id"]: s for s in d["sources"]}
        self.assertEqual(by["fr"]["default_scope"],
                         {"agencies": "all", "doc_types": "all", "cfr_titles": "all", "years": 5})
        cfr_titles = by["cfr"]["filters"][0]["options"]
        self.assertEqual(len(cfr_titles), 50)
        self.assertIsNone(cfr_titles[34]["estimate"])                       # Title 35 is reserved
        self.assertGreater(cfr_titles[28]["estimate"]["bytes"], 50 * registry.MB)
        for pid in ("constitution", "public_laws", "unified_agenda"):
            self.assertTrue(by[pid]["available"])
            self.assertFalse(by[pid]["needs_key"])                          # GovInfo bulk data and reginfo.gov
            self.assertFalse(by[pid]["enabled"])                            # not installed: off in the current setup
        self.assertEqual(by["public_laws"]["default_scope"], {"congresses": "all", "law_types": ["public"]})
        self.assertEqual(by["public_laws"]["filters"][0]["options"][0]["label"], "113th Congress (2013–2014)")
        self.assertIn("prerule", [o["value"] for o in by["unified_agenda"]["filters"][1]["options"]])

    def test_keys_report_presence_only(self):
        d = {s["id"]: s for s in self.client.get("/api/sources").json()["sources"]}
        dol = d["dol_enforcement"]
        self.assertTrue(dol["needs_key"])
        self.assertFalse(dol["key_present"])
        self.assertEqual(dol["get_key_url"], "https://dataportal.dol.gov/registration")
        self.assertEqual(d["fr"]["optional_key"]["get_key_url"], "https://api.data.gov/signup/")
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "SECRET-DOL-1234567", "GOVINFO_API_KEY": "SECRET-GOV-99"}):
            r = self.client.get("/api/sources")
        self.assertNotIn("SECRET", r.text)
        d = {s["id"]: s for s in r.json()["sources"]}
        self.assertTrue(d["dol_enforcement"]["key_present"])
        self.assertTrue(d["fr"]["optional_key"]["key_present"])

    def test_gets_never_create_the_settings_db(self):
        self.client.get("/api/sources")
        self.client.get("/api/sources/selection")
        self.client.get("/api/sources/templates")
        self.client.post("/api/sources/selection/preview", json={"selection": {}})
        self.assertFalse((self.tmp / "sources.sqlite3").exists())

    def test_status_reports_disk_and_on_demand_integrity(self):
        d = {s["id"]: s for s in self.client.get("/api/sources").json()["sources"]}
        self.assertFalse(d["cfr"]["status"]["installed"])
        self.assertIsNone(d["cfr"]["status"]["integrity"])
        d = {s["id"]: s for s in self.client.get("/api/sources?check=true").json()["sources"]}
        self.assertIn(d["fr"]["status"]["integrity"]["status"], ("OK", "WARN", "FAIL"))
        self.assertIsNotNone(d["usc"]["status"]["integrity"]["checked_at"])
        self.assertIsNone(d["news"]["status"]["integrity"])


class SelectionTests(SourcesTestCase):
    def test_unsaved_selection_mirrors_the_current_setup(self):
        with mock.patch.object(config, "installed_titles", return_value=[29, 40]):
            sel = self.client.get("/api/sources/selection").json()
        self.assertFalse(sel["saved"])
        s = sel["selection"]["sources"]
        self.assertEqual(s["cfr"], {"enabled": True, "schedule": "manual", "scope": {"titles": [29, 40]}})
        self.assertEqual(s["news"]["scope"]["agencies"], ["occupational-safety-and-health-administration"])
        self.assertEqual(s["fr"]["scope"]["cfr_titles"], "all")
        self.assertFalse(s["public_laws"]["enabled"])

    def test_put_normalizes_and_strips_secrets(self):
        body = {"selection": {"sources": {
            "cfr": {"enabled": True, "schedule": "hourly", "scope": {"titles": [40, "29", 35, 99, 40], "api_key": "x"}},
            "news": {"scope": {"agencies": ["environmental-protection-agency", "Bad Slug!"], "retention_days": 99999,
                               "token": "abc"}},
            "public_laws": {"enabled": True, "scope": {"congresses": [118, 99, "x"], "law_types": ["nope"]}},
            "bogus": {"enabled": True},
        }, "DOL_API_KEY": "SECRET"}}
        r = self.client.put("/api/sources/selection", json=body)
        self.assertEqual(r.status_code, 200)
        s = r.json()["selection"]["sources"]
        self.assertEqual(s["cfr"]["scope"], {"titles": [29, 40]})          # reserved/unknown titles dropped
        self.assertEqual(s["cfr"]["schedule"], "manual")                    # invalid schedule: kept the old one
        self.assertEqual(s["news"]["scope"]["agencies"], ["environmental-protection-agency"])
        self.assertEqual(s["news"]["scope"]["retention_days"], 3650)
        self.assertTrue(s["public_laws"]["enabled"])
        self.assertEqual(s["public_laws"]["scope"], {"congresses": [118], "law_types": []})
        self.assertNotIn("bogus", s)
        raw = sqlite3.connect(self.tmp / "sources.sqlite3").execute("SELECT value FROM settings").fetchone()[0]
        self.assertNotIn("SECRET", raw)
        self.assertNotIn("abc", raw)
        self.assertTrue(self.client.get("/api/sources/selection").json()["saved"])
        self.assertEqual(news_store.retention_days(), 3650)
        self.client.delete("/api/sources/selection")
        self.assertFalse(self.client.get("/api/sources/selection").json()["saved"])

    def test_partial_put_keeps_other_sources(self):
        self.client.put("/api/sources/selection", json={"selection": {"sources": {"dol_enforcement": {"enabled": False}}}})
        self.client.put("/api/sources/selection", json={"selection": {"sources": {"cfr": {"schedule": "weekly"}}}})
        s = self.client.get("/api/sources/selection").json()["selection"]["sources"]
        self.assertFalse(s["dol_enforcement"]["enabled"])
        self.assertEqual(s["cfr"]["schedule"], "weekly")


class TemplateTests(SourcesTestCase):
    def test_builtin_presets(self):
        ts = self.client.get("/api/sources/templates").json()["templates"]
        ids = [t["id"] for t in ts]
        for pid in ("preset:recommended", "preset:everything", "preset:minimal", "preset:bundle-ehs",
                    "preset:bundle-trade", "preset:bundle-govcon", "preset:desk-environment-energy"):
            self.assertIn(pid, ids)
        by = {t["id"]: t for t in ts}
        rec = by["preset:recommended"]
        self.assertTrue(rec["default"] and rec["builtin"])
        self.assertEqual(rec["needs_keys"], [])
        self.assertFalse(rec["selection"]["sources"]["dol_enforcement"]["enabled"])
        self.assertEqual(rec["selection"]["sources"]["cfr"]["scope"]["titles"], "all")
        self.assertTrue(all(not s["enabled"] for s in by["preset:minimal"]["selection"]["sources"].values()))
        ehs = by["preset:bundle-ehs"]["selection"]["sources"]
        self.assertEqual(ehs["cfr"]["scope"]["titles"], [29, 40, 49])
        self.assertEqual(ehs["usc"]["scope"]["titles"], [29, 42, 49])
        self.assertEqual(ehs["fr"]["scope"]["cfr_titles"], [29, 40, 49])
        for t in ts:
            self.assertTrue(t["name"] and t["description"], t["id"])
        self.assertEqual(self.client.put("/api/sources/templates/preset:minimal", json={"name": "x"}).status_code, 403)
        self.assertEqual(self.client.delete("/api/sources/templates/preset:minimal").status_code, 403)

    def test_create_rename_delete_and_secrets(self):
        r = self.client.post("/api/sources/templates", json={
            "name": "  My   desk ", "description": "EPA only",
            "selection": {"sources": {"cfr": {"scope": {"titles": [40], "password": "hunter2"}}},
                          "api_key": "SECRET"}})
        self.assertEqual(r.status_code, 200)
        t = r.json()
        self.assertEqual(t["name"], "My desk")
        self.assertEqual(t["selection"]["sources"]["cfr"]["scope"], {"titles": [40]})
        self.assertNotIn("hunter2", json.dumps(t))
        self.assertNotIn("SECRET", json.dumps(t))
        r = self.client.put(f"/api/sources/templates/{t['id']}", json={"name": "Environmental"})
        self.assertEqual(r.json()["name"], "Environmental")
        self.assertEqual(r.json()["selection"]["sources"]["cfr"]["scope"], {"titles": [40]})
        self.assertEqual(self.client.get(f"/api/sources/templates/{t['id']}").json()["name"], "Environmental")
        self.assertEqual(self.client.delete(f"/api/sources/templates/{t['id']}").status_code, 200)
        self.assertEqual(self.client.get(f"/api/sources/templates/{t['id']}").status_code, 404)
        self.assertEqual(self.client.post("/api/sources/templates", json={"name": "   "}).status_code, 422)

    def test_template_without_selection_saves_the_current_one(self):
        self.client.put("/api/sources/selection", json={"selection": {"sources": {"cfr": {"scope": {"titles": [12]}}}}})
        t = self.client.post("/api/sources/templates", json={"name": "Banking"}).json()
        self.assertEqual(t["selection"]["sources"]["cfr"]["scope"]["titles"], [12])

    def test_export_import_round_trip_strips_secrets(self):
        self.client.post("/api/sources/templates", json={"name": "Labor",
                                                         "selection": {"sources": {"cfr": {"scope": {"titles": [29]}}}}})
        exp = self.client.get("/api/sources/templates/export").json()
        self.assertEqual(exp["format"], "framework-source-templates")
        self.assertEqual([t["name"] for t in exp["templates"]], ["Labor"])
        exp["templates"][0]["selection"]["sources"]["dol_enforcement"] = {"enabled": True, "scope": {"api_key": "SECRET"}}
        exp["templates"].append({"name": "Bad", "selection": "nope"})
        exp["templates"][0]["DOL_API_KEY"] = "SECRET"
        r = self.client.post("/api/sources/templates/import", json=exp)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["count"], 1)
        names = [t["name"] for t in self.client.get("/api/sources/templates").json()["templates"] if not t["builtin"]]
        self.assertEqual(sorted(names), ["Labor", "Labor (imported)"])
        self.assertNotIn("SECRET", (self.tmp / "sources.sqlite3").read_bytes().decode("utf-8", "ignore"))
        self.assertEqual(self.client.post("/api/sources/templates/import", json={"format": "x"}).status_code, 422)


class PlanTests(SourcesTestCase):
    def test_preview_says_what_changes_and_keeps_data(self):
        with mock.patch.object(config, "installed_titles", return_value=[29]), \
                mock.patch.object(library, "installed", return_value={"edition": "2026-11-12", "section_count": 1,
                                                                       "scope": None}):
            p = self.client.post("/api/sources/selection/preview", json={"selection": {"sources": {
                "cfr": {"enabled": True, "scope": {"titles": [3, 11]}},
                "usc": {"enabled": True, "scope": {"titles": [4]}},
                "fr": {"enabled": False},
                "dol_enforcement": {"enabled": False}}}}).json()
        acts = [(a["source"], a["action"], a["target"]) for a in p["actions"]]
        self.assertEqual(acts, [("cfr", "install", 3), ("cfr", "install", 11), ("usc", "install", 4)])
        self.assertEqual(p["keeps"], ["CFR Title 29"])
        self.assertTrue(p["summary"].startswith("Adds 2 CFR titles and 1 U.S. Code title (~"), p["summary"])
        self.assertIn("stops DOL enforcement records updates", p["summary"])
        self.assertIn("nothing deleted", p["summary"])
        self.assertIn("MB", p["summary"])
        self.assertFalse(p["needs_confirm"])
        self.assertGreater(p["estimate"]["bytes"], 0)
        self.assertEqual(self.submitted(), [])                               # preview never queues

    def test_large_apply_needs_confirm_and_changes_nothing(self):
        rec = presets.get("preset:recommended")
        r = self.client.post("/api/sources/templates/preset:recommended/apply", json={}).json()
        self.assertFalse(r["applied"])
        self.assertTrue(r["needs_confirm"])
        self.assertGreater(r["estimate"]["bytes"], 1024 * registry.MB)
        self.assertIn("Federal Register archive", r["summary"])
        self.assertEqual(self.submitted(), [])
        self.assertFalse((self.tmp / "sources.sqlite3").exists())
        r = self.client.post("/api/sources/templates/preset:recommended/apply", json={"confirm": True}).json()
        self.assertTrue(r["applied"])
        kinds = [k for _, k, _ in self.submitted()]
        self.assertEqual(kinds.count("title"), 49)
        self.assertEqual(kinds.count("usc-title"), 57)          # 53 titles + 4 appendices
        fr_job = [s for s in self.submitted() if s[1] == "fr-build"][0]
        self.assertEqual(fr_job[2], {"titles": [0], "years": 2, "filters": {}})
        self.assertEqual(selection.current(), (rec["selection"], True))

    def test_small_apply_runs_without_confirm(self):
        r = self.client.post("/api/sources/selection/apply", json={"selection": {"sources": {
            "cfr": {"enabled": True, "scope": {"titles": [3]}}, "usc": {"enabled": False},
            "fr": {"enabled": False}}}}).json()
        self.assertTrue(r["applied"], r["summary"])
        self.assertEqual(self.submitted(), [(3, "title", None)])
        self.assertTrue(selection.current()[1])

    def test_removing_data_is_explicit_and_confirmed(self):
        removed = []
        with mock.patch.object(config, "installed_titles", return_value=[29, 40]), \
                mock.patch.object(library, "installed", return_value={"edition": "e", "section_count": 1, "scope": None}), \
                mock.patch.object(library, "remove", side_effect=removed.append):
            sel = {"sources": {"cfr": {"enabled": True, "scope": {"titles": [29]}}, "usc": {"enabled": False},
                               "fr": {"enabled": False}}}
            r = self.client.post("/api/sources/selection/apply", json={"selection": sel}).json()
            self.assertTrue(r["applied"])
            self.assertEqual(removed, [])                                     # unchecking keeps the data
            self.assertEqual(r["keeps"], ["CFR Title 40"])
            r = self.client.post("/api/sources/selection/apply",
                                 json={"selection": sel, "remove_unselected": True}).json()
            self.assertFalse(r["applied"])
            self.assertTrue(r["needs_confirm"])
            self.assertIn("deletes 1 item", r["summary"].lower())
            self.assertEqual(removed, [])
            r = self.client.post("/api/sources/selection/apply",
                                 json={"selection": sel, "remove_unselected": True, "confirm": True}).json()
            self.assertTrue(r["applied"])
            self.assertEqual(removed, [40])

    def test_needs_key_is_reported(self):
        p = self.client.post("/api/sources/selection/preview", json={"selection": {"sources": {
            "dol_enforcement": {"enabled": True}}}}).json()
        nk = [c for c in p["changes"] if c["change"] == "needs_key"]
        self.assertEqual(nk[0]["get_key_url"], "https://dataportal.dol.gov/registration")


class PipelineGatingTests(SourcesTestCase):
    def test_news_worker_follows_enabled_flags_and_schedules(self):
        self.assertEqual(news_worker.enabled_sources(), ["federal_register", "federal_register_pi"])
        selection.save({"sources": {"news": {"enabled": False}}})
        self.assertEqual(news_worker.enabled_sources(), [])
        with mock.patch.dict("os.environ", {"DOL_API_KEY": "k"}):
            self.assertEqual(news_worker.enabled_sources(), ["dol_osha"])
            selection.save({"sources": {"dol_enforcement": {"enabled": False}}})
            self.assertEqual(news_worker.enabled_sources(), [])
        selection.save({"sources": {"news": {"enabled": True, "schedule": "manual"}}})
        self.assertEqual(news_worker.due_sources(), [])                      # manual: only Refresh syncs
        self.assertEqual(news_worker.request_sync(force=True), ["federal_register", "federal_register_pi"])
        news_worker._wake.clear()
        news_worker._forced.clear()

    def test_every_agency_is_one_feed_without_an_agency_condition(self):
        selection.save({"sources": {"news": {"scope": {"agencies": "all", "public_inspection": True}}}})
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json={"count": 0, "results": [], "next_page_url": None}, request=request)

        transport = httpx.MockTransport(handler)
        with mock.patch.object(news, "client", lambda *a, **k: httpx.Client(transport=transport)):
            res = news_worker.sync_sources(["federal_register", "federal_register_pi"],
                                           now=datetime(2026, 11, 16, 17, 0, tzinfo=timezone.utc))
        self.assertEqual(res, {"federal_register": 0, "federal_register_pi": 0})
        self.assertEqual(len(seen), 2)
        for r in seen:
            self.assertNotIn("conditions[agencies][]", str(r.url))

    def test_fr_refresh_honours_flag_and_schedule(self):
        meta = {"last_ok_at": "2026-11-10T12:00:00+00:00", "fail_count": "0"}
        now = datetime(2026, 11, 17, 15, 0, tzinfo=timezone.utc)     # Tuesday, 7 days after the last refresh
        with mock.patch.object(fr_build, "is_due", return_value=True), \
                mock.patch.object(fr_store, "read_meta", return_value=meta):
            self.assertIsNotNone(fr_build.maybe_queue_update(now))
            self.queue.submit.reset_mock()
            selection.save({"sources": {"fr": {"enabled": False}}})
            self.assertIsNone(fr_build.maybe_queue_update(now))
            selection.save({"sources": {"fr": {"enabled": True, "schedule": "manual"}}})
            self.assertIsNone(fr_build.maybe_queue_update(now))
            selection.save({"sources": {"fr": {"schedule": "weekly"}}})
            self.assertIsNone(fr_build.maybe_queue_update(now - timedelta(days=1)))   # 6 days: not yet
            self.assertIsNotNone(fr_build.maybe_queue_update(now))                    # 7 days: due
        self.assertEqual([k for _, k, _ in self.submitted()], ["fr-update"])

    def test_usc_check_honours_flag_schedule_and_titles(self):
        release = {"release_point": "119-200"}
        with mock.patch.object(usc_store, "installed_titles", return_value=[4, 16]), \
                mock.patch.object(usc_build, "outdated", return_value=[4, 16]), \
                mock.patch.object(usc_build.usc_client, "current_release", return_value=release):
            selection.save({"sources": {"usc": {"enabled": False}}})
            self.assertIsNone(usc_build.maybe_queue_updates())
            selection.save({"sources": {"usc": {"enabled": True, "schedule": "manual"}}})
            self.assertIsNone(usc_build.maybe_queue_updates())
            selection.save({"sources": {"usc": {"schedule": "daily", "scope": {"titles": [16]}}}})
            res = usc_build.maybe_queue_updates()
        self.assertEqual(res["count"], 1)
        self.assertEqual(self.submitted(), [(1016, "usc-update", {"usc_title": 16})])

    def test_cfr_check_is_manual_by_default_and_skips_unchecked_titles(self):
        with mock.patch.object(config, "installed_titles", return_value=[29, 40]), \
                mock.patch.object(library, "outdated", return_value=[29, 40]) as outdated:
            self.assertIsNone(jobs.maybe_queue_cfr_updates())                # unsaved setup: manual
            outdated.assert_not_called()
            selection.save({"sources": {"cfr": {"schedule": "weekly", "scope": {"titles": [40]}}}})
            res = jobs.maybe_queue_cfr_updates(now=1000.0)
            self.assertEqual(res["count"], 1)
            self.assertIsNone(jobs.maybe_queue_cfr_updates(now=1000.0 + 86400))   # weekly: not yet
            self.assertIsNotNone(jobs.maybe_queue_cfr_updates(now=1000.0 + 8 * 86400))
        self.assertEqual(self.submitted(), [(40, "update", None), (40, "update", None)])


class FrAllDocumentsTests(SourcesTestCase):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(fr_build, "log", lambda msg: None)
        p.start()
        self.addCleanup(p.stop)
        self.requests: list[httpx.Request] = []

    def patch_fr(self, docs):
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            p = request.url.params
            gte, lte = p["conditions[publication_date][gte]"], p["conditions[publication_date][lte]"]
            types = p.get_list("conditions[type][]")
            rows = [d for d in docs if gte <= d["publication_date"] <= lte
                    and (not types or {"Rule": "RULE"}.get(d["type"], "NOTICE") in types)]
            return httpx.Response(200, json={"count": len(rows), "results": rows, "next_page_url": None},
                                  request=request)

        def fake_client(extra=None):
            return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
        return mock.patch.object(fr_client, "client", fake_client)

    def test_default_build_collects_every_document_with_filters(self):
        selection.save({"sources": {"fr": {"scope": {"doc_types": ["RULE"], "agencies": ["labor-department"]}}}})
        with self.patch_fr([HAZCOM, RCRA]):
            res = fr_build.build(since="2026-09-01", until="2026-11-18", force=True)
        self.assertEqual(res["titles"], [0])
        self.assertEqual(res["filters"], {"agencies": ["labor-department"], "doc_types": ["RULE"]})
        for r in self.requests:
            self.assertNotIn("conditions[cfr][title]", str(r.url))
            self.assertEqual(r.url.params.get_list("conditions[agencies][]"), ["labor-department"])
            self.assertEqual(r.url.params.get_list("conditions[type][]"), ["RULE"])
        meta = fr_store.read_meta()
        self.assertEqual(json.loads(meta["titles"]), [0])
        self.assertEqual(json.loads(meta["filters"])["doc_types"], ["RULE"])
        # The update reuses the stored filters.
        self.requests.clear()
        with self.patch_fr([HAZCOM, RCRA]):
            fr_build.update(now=datetime(2026, 11, 19, 15, 0, tzinfo=timezone.utc))
        self.assertTrue(self.requests)
        self.assertTrue(all(r.url.params.get_list("conditions[type][]") == ["RULE"] for r in self.requests))
        # The derived selection reflects the corpus's recorded scope.
        selection.reset()
        fr = selection.current()[0]["sources"]["fr"]["scope"]
        self.assertEqual(fr["doc_types"], ["RULE"])
        self.assertEqual(fr["cfr_titles"], "all")
