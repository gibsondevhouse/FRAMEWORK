"""Offline tests for Stage 5 DOL Open Data API v4 catalog discovery & schema probing."""
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

import httpx

from app import config, dol_catalog, news, news_store
from tests.news_fixtures import FakeAPI, NetworkGuardTestCase


class DolCatalogTests(NetworkGuardTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="dol-cat-"))
        p = mock.patch.object(config, "DATA_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)

    def test_cfr_mapping_heuristics(self):
        self.assertEqual(dol_catalog.map_dataset_to_cfr({"agency": "OSHA"}), (29, ["1900-1999"]))
        self.assertEqual(dol_catalog.map_dataset_to_cfr({"agency": "WHD"}), (29, ["500-899"]))
        self.assertEqual(dol_catalog.map_dataset_to_cfr({"agency": "EBSA"}), (29, ["2509-2590"]))
        self.assertEqual(dol_catalog.map_dataset_to_cfr({"agency": "MSHA"}), (30, ["1-199"]))
        self.assertEqual(dol_catalog.map_dataset_to_cfr({"agency": "OWCP"}), (20, ["1-799"]))

    def test_paginated_discovery_and_limit1_probe_statuses(self):
        page1 = {
            "datasets": [
                {"id": 1, "name": "OSHA Inspection", "agency": {"abbr": "OSHA"},
                 "api_url": "inspection", "frequency": "Daily"},
                {"id": 2, "name": "OSHA Optional Info", "agency": {"abbr": "OSHA"},
                 "api_url": "optional_info", "frequency": "Daily"},
            ],
            "meta": {"current_page": 1, "next_page": 2, "total_pages": 2, "total_count": 3},
        }
        page2 = {
            "datasets": [
                {"id": 3, "name": "WHD WHISARD", "agency": {"abbr": "WHD"},
                 "api_url": "whisard", "frequency": "Weekly"},
            ],
            "meta": {"current_page": 2, "next_page": None, "total_pages": 2, "total_count": 3},
        }

        def datasets_handler(req: httpx.Request) -> httpx.Response:
            pg = int(req.url.params.get("page") or 1)
            return httpx.Response(200, json=(page1 if pg == 1 else page2), request=req)

        fake = FakeAPI(
            extra_routes={
                "/v4/datasets": datasets_handler,
                "/v4/get/OSHA/inspection/json": {"data": [{"activity_nr": 1, "estab_name": "ACME"}]},
                "/v4/get/WHD/whisard/json": lambda req: httpx.Response(204, request=req),
            },
            fail_paths=("/v4/get/OSHA/optional_info/json",),
        )

        def save_batch(batch):
            with closing(news_store.connect()) as con:
                news_store.save_dol_catalog(con, batch)
                con.commit()

        with fake.patch_client(), news.client() as c:
            res = dol_catalog.fetch_dol_catalog(
                c, "secret-key", page_size=2, delay_s=0.0, probe_schemas=True, on_page=save_batch)

        self.assertFalse(res["rate_limited"])
        with closing(news_store.connect()) as con:
            stored = {r["slug"]: r for r in news_store.list_dol_catalog(con)}
        self.assertEqual(set(stored), {"OSHA/inspection", "OSHA/optional_info", "WHD/whisard"})
        self.assertEqual(stored["OSHA/inspection"]["probe_status"], "healthy_200")
        self.assertEqual(stored["OSHA/inspection"]["fields"], ["activity_nr", "estab_name"])
        self.assertEqual(stored["OSHA/optional_info"]["probe_status"], "upstream_500")
        self.assertEqual(stored["WHD/whisard"]["probe_status"], "empty_204")
        self.assertEqual(stored["WHD/whisard"]["cfr_title"], 29)
        self.assertEqual(stored["WHD/whisard"]["cfr_parts"], ["500-899"])

        md = dol_catalog.render_catalog_markdown(list(stored.values()))
        self.assertIn("OSHA/inspection", md)
        self.assertIn("healthy_200", md)

    def test_429_partial_save_recovery_without_key_leakage(self):
        page1 = {
            "datasets": [
                {"id": 1, "name": "MSHA Mines", "agency": {"abbr": "MSHA"}, "api_url": "mines", "frequency": "Daily"},
            ],
            "meta": {"current_page": 1, "next_page": 2, "total_pages": 2, "total_count": 2},
        }

        def datasets_handler(req: httpx.Request) -> httpx.Response:
            if int(req.url.params.get("page") or 1) == 1:
                return httpx.Response(200, json=page1, request=req)
            return httpx.Response(429, headers={"Retry-After": "10"}, request=req)

        fake = FakeAPI(extra_routes={"/v4/datasets": datasets_handler})
        saved_batches = []
        with fake.patch_client(), news.client() as c:
            res = dol_catalog.fetch_dol_catalog(
                c, "super-secret-dol-key", page_size=1, delay_s=0.0,
                on_page=lambda b: saved_batches.extend(b),
            )
        self.assertTrue(res["rate_limited"])
        self.assertEqual([e["slug"] for e in saved_batches], ["MSHA/mines"])
        self.assertGreater(news.dol_cooldown_remaining(), 0.0)


if __name__ == "__main__":
    unittest.main()
