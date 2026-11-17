"""Deterministic golden snapshots of every API route, the chat SSE stream and the
error shapes, taken against fake Titles 29/40/49 and the seeded news fixtures.

These pin the exact external contract of the backend before (and across) the
decomposition stages: a refactor that changes any payload shape, route path, or
SSE event fails here. Volatile values and long HTML are canonicalized by
`snapshot_utils`. Record/update with UPDATE_SNAPSHOTS=1.
"""
from __future__ import annotations

import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

import anthropic
import httpx
from fastapi.testclient import TestClient

from app import chat, config, library, news, news_store, news_worker
from app.main import app
from fake_titles import FakeTitles
from tests.base import HermeticTestCase
from tests.news_fixtures import (DOL_INSPECTIONS, DOL_VIOLATIONS, FR_DOC_NOTICE,
                                 FR_DOC_PROPOSED, FR_DOC_RULE, PI_DOC_ONLY)
from tests.snapshot_utils import assert_snapshot, sse_events

AGENCY = "occupational-safety-and-health-administration"


def seed_news() -> None:
    items = [
        news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY)),
        news.enrich_item(news.fr_document_item(FR_DOC_PROPOSED, AGENCY)),
        news.enrich_item(news.fr_document_item(FR_DOC_NOTICE, AGENCY)),
        news.enrich_item(news.pi_item(PI_DOC_ONLY, AGENCY)),
    ]
    groups = news.group_violations(DOL_VIOLATIONS, 50)
    for insp in DOL_INSPECTIONS:
        items.append(news.enrich_item(news.build_enforcement_article(insp, groups[insp["activity_nr"]])))
    with closing(news_store.connect()) as con:
        for item in items:
            news_store.upsert_article(con, item)
        con.commit()


class SnapshotBase(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeTitles()
        cls.fake.install()
        seed_news()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.fake.remove()

    def setUp(self):
        super().setUp()
        # A fresh queue whose worker never starts: submitted jobs stay queued, so
        # POST download/update snapshots can never race a background build.
        self.queue = library.Queue()
        self.queue._ensure_worker = lambda: None
        q_patch = mock.patch.object(library, "queue", self.queue)
        q_patch.start()
        self.addCleanup(q_patch.stop)
        # /api/settings/env reads and writes ROOT_DIR/.env: point it at a temp dir.
        self.tmp = Path(tempfile.mkdtemp(prefix="snap-env-"))
        root_patch = mock.patch.object(config, "ROOT_DIR", self.tmp)
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def snap_get(self, name: str, url: str, expect: int = 200, **kwargs):
        res = self.client.get(url, **kwargs)
        self.assertEqual(res.status_code, expect, f"{url} -> {res.status_code}")
        assert_snapshot(self, name, res.json())
        return res


class GetRouteSnapshots(SnapshotBase):
    def test_route_inventory(self):
        """The ordered route table: pins paths, methods AND registration order
        (the news router must stay ahead of /api/{title})."""
        rows = []
        for r in app.routes:
            nested = getattr(getattr(r, "original_router", None), "routes", None)
            for x in (nested if nested is not None else [r]):
                path = getattr(x, "path", "")
                methods = sorted(getattr(x, "methods", None) or [])
                rows.append(f"{','.join(methods) or '-'} {path}")
        assert_snapshot(self, "route_inventory", rows)

    def test_titles(self):
        self.snap_get("get_titles", "/api/titles")
        self.snap_get("get_titles_snapshot", "/api/titles/snapshot")
        self.snap_get("get_profiles", "/api/profiles")

    def test_legacy_title29_aliases(self):
        self.snap_get("get_meta_legacy", "/api/meta")
        self.snap_get("get_tree_legacy", "/api/tree")
        self.snap_get("get_section_legacy", "/api/section/1910.135")
        self.snap_get("get_part_legacy", "/api/part/1910")
        self.snap_get("get_part_full_legacy", "/api/part/1910/full")
        self.snap_get("get_models_legacy", "/api/models")

    def test_title_scoped_reader_routes(self):
        self.snap_get("get_title_meta", "/api/29/meta")
        self.snap_get("get_title_tree", "/api/40/tree")
        self.snap_get("get_title_section", "/api/40/section/261.3")
        self.snap_get("get_title_section_units_whole", "/api/29/section/1910.1200")
        self.snap_get("get_title_section_unit_first", "/api/29/section/1910.1200?unit=")
        self.snap_get("get_title_section_unit_chapter", "/api/29/section/1910.1200?unit=appendix-a-a-1")
        self.snap_get("get_title_part", "/api/29/part/1910")
        self.snap_get("get_title_part_full", "/api/29/part/1910/full")
        self.snap_get("get_title_models", "/api/29/models")

    def test_search_routes(self):
        self.snap_get("get_search_global_all", "/api/search?q=waste&title=all&limit=5")
        self.snap_get("get_search_global_default", "/api/search?q=waste")
        self.snap_get("get_search_title", "/api/49/search?q=hazardous")
        self.snap_get("get_search_part_filter", "/api/29/search?q=protection&part=1910")

    def test_library_routes(self):
        self.snap_get("get_library_catalog", "/api/library")
        self.snap_get("get_library_jobs", "/api/library/jobs")
        self.snap_get("get_library_storage", "/api/library/storage")
        self.snap_get("get_library_wire", "/api/library/wire")
        self.snap_get("get_library_title", "/api/library/29")
        self.snap_get("get_library_title_part", "/api/library/29/part/1910")

    def test_news_routes(self):
        self.snap_get("get_news_feed", "/api/news")
        self.snap_get("get_news_enforcement", "/api/news?category=enforcement")
        self.snap_get("get_news_q_section", "/api/news?q=1910.1030")
        self.snap_get("get_news_status", "/api/news/status")
        self.snap_get("get_news_facets", "/api/news/facets")
        self.snap_get("get_news_section", "/api/news/section/1910.1030")
        self.snap_get("get_news_part", "/api/news/part/1910")

    def test_settings_env_get(self):
        self.snap_get("get_settings_env", "/api/settings/env")


class MutatingRouteSnapshots(SnapshotBase):
    def test_settings_env_post(self):
        with mock.patch.object(news_worker, "is_syncing", return_value=False), \
             mock.patch.object(news_worker, "request_sync", return_value=["dol_osha"]):
            res = self.client.post("/api/settings/env", json={
                "dol_api_key": "dol_live_secret_9876",
                "anthropic_api_key": "sk-ant-api03-abcdef1234",
                "anthropic_model": "claude-sonnet-5-5",
                "news_retention_days": 180,
            })
        self.assertEqual(res.status_code, 200)
        assert_snapshot(self, "post_settings_env", res.json())

    def test_library_download_submissions(self):
        whole = self.client.post("/api/library/download", json={"title": 40, "kind": "section"})
        self.assertEqual(whole.status_code, 200)
        assert_snapshot(self, "post_library_download_title", whole.json())
        part = self.client.post("/api/library/download", json={"title": 29, "part": "1910", "kind": "section"})
        assert_snapshot(self, "post_library_download_part", part.json())
        sec = self.client.post("/api/library/download",
                               json={"title": 49, "part": "172", "section": "172.101", "kind": "section"})
        assert_snapshot(self, "post_library_download_section", sec.json())
        assert_snapshot(self, "get_library_jobs_after_submits", self.client.get("/api/library/jobs").json())

    def test_library_batch_update_cancel_clear(self):
        batch = self.client.post("/api/library/batch-download", json={"suite": "ehs"})
        self.assertEqual(batch.status_code, 200)
        assert_snapshot(self, "post_library_batch_download_ehs", batch.json())
        upd = self.client.post("/api/library/29/update")
        assert_snapshot(self, "post_library_title_update", upd.json())
        upd_all = self.client.post("/api/library/update-all")
        assert_snapshot(self, "post_library_update_all", upd_all.json())
        job_id = upd.json()["id"]
        cancel = self.client.post(f"/api/library/jobs/{job_id}/cancel")
        assert_snapshot(self, "post_library_job_cancel", cancel.json())
        clear = self.client.post("/api/library/jobs/clear")
        assert_snapshot(self, "post_library_jobs_clear", clear.json())

    def test_library_storage_prune(self):
        res = self.client.post("/api/library/storage/prune")
        self.assertEqual(res.status_code, 200)
        assert_snapshot(self, "post_library_storage_prune", res.json())

    def test_library_delete(self):
        # A separate fake install so removing Title 49 never mutates the class fixture.
        own = FakeTitles()
        own.install()
        try:
            seed_news()
            res = self.client.delete("/api/library/49")
            self.assertEqual(res.status_code, 200)
            assert_snapshot(self, "delete_library_title", res.json())
        finally:
            own.remove()

    def test_news_refresh(self):
        with mock.patch.object(news_worker, "is_syncing", return_value=False), \
             mock.patch.object(news_worker, "request_sync",
                               side_effect=lambda force: ["federal_register", "federal_register_pi"] if force else ["federal_register"]):
            lazy = self.client.post("/api/news/refresh", json={"force": False})
            self.assertEqual(lazy.status_code, 202)
            assert_snapshot(self, "post_news_refresh_lazy", lazy.json())
            forced = self.client.post("/api/news/refresh", json={"force": True})
            self.assertEqual(forced.status_code, 202)
            assert_snapshot(self, "post_news_refresh_forced", forced.json())


class ErrorShapeSnapshots(SnapshotBase):
    def test_404_shapes(self):
        self.snap_get("err_404_section", "/api/40/section/9999.99", expect=404)
        self.snap_get("err_404_uninstalled_title", "/api/35/meta", expect=404)
        res = self.client.post("/api/library/jobs/12345/cancel")
        self.assertEqual(res.status_code, 404)
        assert_snapshot(self, "err_404_job_cancel", res.json())

    def test_409_shapes(self):
        library.queue.submit(49, "title", None, "Title 49")
        res = self.client.delete("/api/library/49")
        self.assertEqual(res.status_code, 409)
        assert_snapshot(self, "err_409_delete_busy", res.json())
        prune = self.client.post("/api/library/storage/prune")
        self.assertEqual(prune.status_code, 409)
        assert_snapshot(self, "err_409_prune_busy", prune.json())
        with mock.patch.object(news_worker, "is_syncing", return_value=True):
            busy = self.client.post("/api/news/refresh", json={"force": True})
        self.assertEqual(busy.status_code, 409)
        assert_snapshot(self, "err_409_news_syncing", busy.json())

    def test_422_shapes(self):
        self.snap_get("err_422_title_range", "/api/99/meta", expect=422)
        self.snap_get("err_422_news_category", "/api/news?category=bogus", expect=422)

    def test_503_news_sync_off(self):
        import os
        os.environ["NEWS_SYNC"] = "0"  # restored by HermeticTestCase's cleanup
        res = self.client.post("/api/news/refresh", json={"force": True})
        self.assertEqual(res.status_code, 503)
        assert_snapshot(self, "err_503_news_sync_off", res.json())

    def test_400_shapes(self):
        res = self.client.post("/api/29/chat", json={"messages": [{"role": "user", "content": "hi"}], "model": "m"})
        self.assertEqual(res.status_code, 400)
        assert_snapshot(self, "err_400_chat_no_key", res.json())
        batch = self.client.post("/api/library/batch-download", json={})
        self.assertEqual(batch.status_code, 400)
        assert_snapshot(self, "err_400_batch_empty", batch.json())


# ---------------------------------------------------------------------------
# Chat SSE streams via a scripted fake AsyncAnthropic
# ---------------------------------------------------------------------------

class _Delta:
    type = "text_delta"

    def __init__(self, text):
        self.text = text


class _DeltaEvent:
    type = "content_block_delta"

    def __init__(self, text):
        self.delta = _Delta(text)


class _TextBlock:
    type = "text"

    def __init__(self, text):
        self.text = text


class _ToolBlock:
    type = "tool_use"

    def __init__(self, name, input, id):
        self.name, self.input, self.id = name, input, id


class _Usage:
    def __init__(self, d):
        self._d = d

    def model_dump(self):
        return dict(self._d)


class _Final:
    def __init__(self, stop_reason, content, usage):
        self.stop_reason, self.content, self.usage = stop_reason, content, _Usage(usage)


class _FakeStream:
    def __init__(self, events, final):
        self._events, self._final = list(events), final

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._events:
            raise StopAsyncIteration
        return self._events.pop(0)

    async def get_final_message(self):
        return self._final


class _FakeMessages:
    def __init__(self, streams):
        self._streams = list(streams)

    def stream(self, **kwargs):
        item = self._streams.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class _FakeAnthropic:
    def __init__(self, streams):
        self.messages = _FakeMessages(streams)


def scripted_tool_use_rounds():
    round1 = _FakeStream(
        [_DeltaEvent("Checking the regulation.")],
        _Final("tool_use",
               [_TextBlock("Checking the regulation."),
                _ToolBlock("read_section", {"section_id": "1910.135", "title": 29}, "toolu_01")],
               {"input_tokens": 120, "output_tokens": 30}))
    round2 = _FakeStream(
        [_DeltaEvent("Head protection is required under § 1910.135.")],
        _Final("end_turn",
               [_TextBlock("Head protection is required under § 1910.135.")],
               {"input_tokens": 150, "output_tokens": 20}))
    return [round1, round2]


class ChatSseSnapshots(SnapshotBase):
    def post_chat(self, url, streams):
        key_patch = mock.patch.object(config, "anthropic_key", lambda: "sk-test")
        client_patch = mock.patch.object(chat, "client", lambda: _FakeAnthropic(streams))
        with key_patch, client_patch:
            res = self.client.post(url, json={
                "messages": [{"role": "user", "content": "Do my workers need hard hats?"}],
                "section_id": "1910.135",
                "model": "claude-sonnet-5-5",
            })
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.headers["content-type"].startswith("text/event-stream"))
        return sse_events(res.text)

    def test_chat_sse_stream_legacy(self):
        assert_snapshot(self, "sse_chat_legacy", self.post_chat("/api/chat", scripted_tool_use_rounds()))

    def test_chat_sse_stream_title_scoped(self):
        assert_snapshot(self, "sse_chat_title", self.post_chat("/api/29/chat", scripted_tool_use_rounds()))

    def test_chat_sse_error_event(self):
        err = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
        assert_snapshot(self, "sse_chat_error", self.post_chat("/api/chat", [err]))


if __name__ == "__main__":
    unittest.main()
