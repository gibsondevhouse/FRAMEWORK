"""Tests for reader/.env inspection/editing endpoints and the #/help + modal frontend contract."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app import config, news_worker
from app.main import app
from tests.base import HermeticTestCase
from tests.frontend_sources import combined_css, index_html

STATIC = Path(__file__).resolve().parent.parent / "static"


class SettingsEnvEndpointTests(HermeticTestCase):
    def setUp(self):
        super().setUp()  # HermeticTestCase pops and restores the TRACKED_KEYS
        self.tmp = Path(tempfile.mkdtemp())
        self.root_patch = mock.patch.object(config, "ROOT_DIR", self.tmp)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.client = TestClient(app)

    def test_get_env_when_missing(self):
        res = self.client.get("/api/settings/env")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("cache-control"), "no-store")
        data = res.json()
        self.assertFalse(data["env_exists"])
        self.assertEqual(data["env_file"], "reader/.env")
        self.assertFalse(data["keys"]["DOL_API_KEY"]["configured"])
        self.assertIsNone(data["keys"]["DOL_API_KEY"]["masked"])
        self.assertFalse(data["keys"]["ANTHROPIC_API_KEY"]["configured"])

    def test_create_env_masks_secrets_and_updates_environ_live(self):
        with mock.patch.object(news_worker, "is_syncing", return_value=False), \
             mock.patch.object(news_worker, "request_sync", return_value=["dol_osha"]) as req_sync:
            res = self.client.post("/api/settings/env", json={
                "dol_api_key": "dol_live_secret_9876",
                "anthropic_api_key": "sk-ant-api03-abcdef1234",
                "anthropic_model": "claude-sonnet-5-5",
                "news_retention_days": 180,
            })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("cache-control"), "no-store")
        body = res.json()
        self.assertEqual(body["news_sync_queued"], ["dol_osha"])
        req_sync.assert_called_once_with(force=False)

        # File created and secrets applied immediately in memory.
        env_text = (self.tmp / ".env").read_text(encoding="utf-8")
        self.assertIn("DOL_API_KEY=dol_live_secret_9876", env_text)
        self.assertIn("ANTHROPIC_API_KEY=sk-ant-api03-abcdef1234", env_text)
        self.assertIn("NEWS_RETENTION_DAYS=180", env_text)
        self.assertEqual(config.dol_api_key(), "dol_live_secret_9876")
        self.assertEqual(config.anthropic_key(), "sk-ant-api03-abcdef1234")

        # Raw secrets must never be returned by GET or POST.
        dumped = str(body)
        self.assertNotIn("dol_live_secret_9876", dumped)
        self.assertNotIn("sk-ant-api03-abcdef1234", dumped)
        self.assertTrue(body["status"]["env_exists"])
        self.assertTrue(body["status"]["keys"]["DOL_API_KEY"]["configured"])
        self.assertTrue(body["status"]["keys"]["DOL_API_KEY"]["masked"].endswith("9876"))
        self.assertEqual(body["status"]["keys"]["ANTHROPIC_API_KEY"]["masked"], "sk-ant-••••1234")

        get_res = self.client.get("/api/settings/env").json()
        self.assertNotIn("dol_live_secret_9876", str(get_res))
        self.assertNotIn("sk-ant-api03-abcdef1234", str(get_res))

    def test_partial_update_preserves_other_secret_and_clear_removes(self):
        with mock.patch.object(news_worker, "request_sync", return_value=[]):
            self.client.post("/api/settings/env", json={
                "dol_api_key": "dol-key-1111",
                "anthropic_api_key": "sk-ant-key-2222",
            })
            # Updating only DOL key (leaving anthropic blank) keeps anthropic intact.
            self.client.post("/api/settings/env", json={
                "dol_api_key": "dol-key-3333",
                "anthropic_api_key": "",
            })
        self.assertEqual(config.dol_api_key(), "dol-key-3333")
        self.assertEqual(config.anthropic_key(), "sk-ant-key-2222")

        # Explicit clear removes it from both .env and os.environ.
        res = self.client.post("/api/settings/env", json={"clear_dol_api_key": True})
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(config.dol_api_key())
        self.assertEqual(config.anthropic_key(), "sk-ant-key-2222")
        self.assertFalse(res.json()["status"]["keys"]["DOL_API_KEY"]["configured"])

    def test_rejects_newline_injection(self):
        res = self.client.post("/api/settings/env", json={
            "dol_api_key": "bad\nANTHROPIC_API_KEY=evil",
        })
        self.assertEqual(res.status_code, 400)
        self.assertFalse((self.tmp / ".env").exists())


class HelpAndModalContractTests(HermeticTestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = index_html()
        cls.css = combined_css()

    def test_modal_container_exists(self):
        self.assertIn('id="env-modal"', self.html)
        self.assertIn('role="dialog" aria-modal="true"', self.html)

    def test_rail_settings_icon_is_a_gear_not_a_sun(self):
        settings_btn = self.html.split('data-target="settings"', 1)[1].split("</button>", 1)[0]
        # The old glyph was a circle with detached rays (reads as a dark/light toggle).
        self.assertNotIn('M8 1.75v1.5M8 12.75v1.5', settings_btn)
        self.assertIn('19.4 15', settings_btn)        # the gear outline path
        self.assertIn('<circle cx="12" cy="12" r="3"', settings_btn)

    def test_help_and_modal_styles_use_tokens_only(self):
        block = self.css.split("/* ---------- Help & Setup Guide (#/help)", 1)[1]
        self.assertNotRegex(block, r"#[0-9a-fA-F]{3,6}\b")
        for cls in (".help-card", ".help-logo", ".help-status-chip", ".help-group-label",
                    ".help-footnote", ".modal-backdrop", ".modal-dialog"):
            self.assertIn(cls, block)
        self.assertNotIn(".help-card.is-left", block)
        self.assertNotIn(".help-card.is-right", block)


if __name__ == "__main__":
    unittest.main()
