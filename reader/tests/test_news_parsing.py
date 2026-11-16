"""Pure-function news tests: DOL standard codes, prose citations, violation grouping,
enforcement building, item mapping and the fixed takeaway bullets. No DB, no network."""
import unittest

from app import news
from tests.base import HermeticTestCase
from tests.news_fixtures import (
    CITATION_CASES, CITATION_CASES_PY_ONLY, DOL_INSPECTIONS, DOL_VIOLATIONS,
    FR_DOC_NOTICE, FR_DOC_PROPOSED, FR_DOC_RULE, PI_DOC_ONLY, PI_DOC_SHARED,
)

AGENCY = "occupational-safety-and-health-administration"


class DolStandardTests(HermeticTestCase):
    def test_normalize_dol_standard(self):
        cases = {
            "19101030 G02   IIA": "1910.1030",
            "19100134 A01": "1910.134",
            "19260651 C02": "1926.651",
            "19260501 B13": "1926.501",
            "": None,
            None: None,
            "5A0001": None,
            "83590050 A01": None,   # state-plan code
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(news.normalize_dol_standard(raw), want)

    def test_is_general_duty(self):
        self.assertTrue(news.is_general_duty("5A0001"))
        self.assertTrue(news.is_general_duty(" 5a0001 "))
        self.assertFalse(news.is_general_duty("19101030 G02"))
        self.assertFalse(news.is_general_duty(None))
        self.assertFalse(news.is_general_duty(""))

    def test_state_plan_codes_count_as_unmapped(self):
        art = news.build_enforcement_article(DOL_INSPECTIONS[0],
                                             [v for v in DOL_VIOLATIONS
                                              if v["activity_nr"] == 306953084 and not v["delete_flag"]])
        self.assertEqual(art["unmapped_standards"], 1)
        self.assertEqual(art["general_duty"], 1)
        self.assertNotIn("8359.50", art["sections"])


class ExtractCitationsTests(HermeticTestCase):
    def test_shared_cases(self):
        for text, want_secs, want_parts in CITATION_CASES + CITATION_CASES_PY_ONLY:
            with self.subTest(text=text):
                secs, parts = news.extract_citations(text)
                self.assertEqual(secs, want_secs)
                self.assertEqual([p["part"] for p in parts], want_parts)
                self.assertTrue(all(p["title"] == 29 for p in parts))

    def test_empty_and_none(self):
        self.assertEqual(news.extract_citations(""), ([], []))
        self.assertEqual(news.extract_citations(None), ([], []))


class GroupViolationsTests(HermeticTestCase):
    def test_drops_deleted_and_groups(self):
        groups = news.group_violations(DOL_VIOLATIONS, 50)
        self.assertEqual(set(groups), {306953084, 307000001})
        self.assertEqual(len(groups[306953084]), 4)   # the delete_flag row is gone
        self.assertTrue(all(not v.get("delete_flag") for vs in groups.values() for v in vs))

    def test_caps_at_newest_issuance(self):
        groups = news.group_violations(DOL_VIOLATIONS, 1)
        self.assertEqual(list(groups), [306953084])   # newest issuance 2026-11-10 wins

    def test_skips_rows_without_activity_nr(self):
        groups = news.group_violations([{"activity_nr": None, "standard": "19100134"}], 50)
        self.assertEqual(groups, {})


class BuildEnforcementTests(HermeticTestCase):
    def setUp(self):
        super().setUp()
        self.groups = news.group_violations(DOL_VIOLATIONS, 50)
        self.art = news.build_enforcement_article(DOL_INSPECTIONS[0], self.groups[306953084])

    def test_identity_and_shape(self):
        self.assertEqual(self.art["guid"], "dol-insp:306953084")
        self.assertEqual(self.art["source"], "dol_osha")
        self.assertEqual(self.art["category"], "enforcement")
        self.assertEqual(self.art["company"], "Christmas Tree Shops")
        self.assertEqual(self.art["state"], "NH")
        self.assertEqual(self.art["city"], "Salem")
        self.assertEqual(self.art["doc_type"], "Follow-up inspection")
        for key in news.empty_item():
            self.assertIn(key, self.art)

    def test_dated_by_newest_issuance_not_open_date(self):
        self.assertEqual(self.art["published_at"], "2026-11-10")

    def test_penalty_fallback_per_row(self):
        # 14000 (current) + 9000 (initial fallback) + 7000 + 0 = 30000
        self.assertEqual(self.art["penalty_usd"], 30000.0)

    def test_sections_and_counts(self):
        self.assertEqual(self.art["sections"], ["1910.1030", "1926.501"])
        self.assertEqual(self.art["violation_types"], ["O", "S", "W"])
        self.assertEqual(self.art["violation_counts"], {"W": 1, "S": 2, "O": 1})
        self.assertEqual(self.art["general_duty"], 1)
        self.assertEqual(self.art["unmapped_standards"], 1)

    def test_link_is_establishment_search(self):
        self.assertEqual(
            self.art["link"],
            "https://www.osha.gov/ords/imis/establishment.inspection_detail?id=306953084")

    def test_no_penalty_is_none(self):
        art = news.build_enforcement_article(
            DOL_INSPECTIONS[1],
            [{"activity_nr": 307000001, "standard": "19100134 A01", "viol_type": "O",
              "issuance_date": "2026-10-20", "initial_penalty": "0", "current_penalty": "0"}])
        self.assertIsNone(art["penalty_usd"])


class ItemMappingTests(HermeticTestCase):
    def test_same_guid_for_pi_and_published(self):
        pub = news.fr_document_item(FR_DOC_NOTICE, AGENCY)
        pi = news.pi_item(PI_DOC_SHARED, AGENCY)
        self.assertEqual(pub["guid"], pi["guid"])
        self.assertEqual(pub["guid"], "fr:2026-21000")

    def test_published_at_is_always_a_date(self):
        for item in (news.fr_document_item(FR_DOC_RULE, AGENCY),
                     news.fr_document_item(FR_DOC_NOTICE, AGENCY),
                     news.pi_item(PI_DOC_ONLY, AGENCY),
                     news.pi_item(PI_DOC_SHARED, AGENCY)):
            with self.subTest(guid=item["guid"]):
                self.assertRegex(item["published_at"], r"^\d{4}-\d{2}-\d{2}$")

    def test_pi_item_fields(self):
        pi = news.pi_item(PI_DOC_ONLY, AGENCY)
        self.assertEqual(pi["source"], "federal_register_pi")
        self.assertEqual(pi["category"], "public_inspection")
        self.assertEqual(pi["published_at"], "2026-11-16")   # date of filed_at
        self.assertEqual(pi["scheduled_on"], "2026-11-18")
        self.assertEqual(pi["docket_ids"], ["OSHA-2025-0011"])
        for key in news.empty_item():
            self.assertIn(key, pi)

    def test_fr_item_fields(self):
        doc = news.fr_document_item(FR_DOC_RULE, AGENCY)
        self.assertEqual(doc["category"], "rules")
        self.assertEqual(doc["citation"], "91 FR 55744")
        self.assertEqual(doc["effective_on"], "2026-09-30")
        self.assertEqual(doc["cfr_parts"], [{"title": 29, "part": "42"}])
        self.assertEqual(news.fr_document_item(FR_DOC_PROPOSED, AGENCY)["category"], "rulemaking")
        self.assertEqual(news.fr_document_item(FR_DOC_NOTICE, AGENCY)["category"], "notices")


class TakeawaysTests(HermeticTestCase):
    def kinds(self):
        return {
            "rule": news.enrich_item(news.fr_document_item(FR_DOC_RULE, AGENCY)),
            "proposed": news.enrich_item(news.fr_document_item(FR_DOC_PROPOSED, AGENCY)),
            "notice": news.enrich_item(news.fr_document_item(FR_DOC_NOTICE, AGENCY)),
            "pi": news.enrich_item(news.pi_item(PI_DOC_ONLY, AGENCY)),
            "enforcement": news.enrich_item(news.build_enforcement_article(
                DOL_INSPECTIONS[0], news.group_violations(DOL_VIOLATIONS, 50)[306953084])),
        }

    def test_exactly_three_bullets_each(self):
        for kind, item in self.kinds().items():
            with self.subTest(kind=kind):
                self.assertEqual(len(item["takeaways"]), 3)
                for t in item["takeaways"]:
                    self.assertEqual(set(t), {"key", "label", "text"})
                    self.assertTrue(t["text"])
                    self.assertLessEqual(len(t["text"]), news.TAKEAWAY_MAX_CHARS + 1)

    def test_rule_bullets(self):
        t = {x["key"]: x["text"] for x in self.kinds()["rule"]["takeaways"]}
        self.assertTrue(t["action"].startswith("Final rule."))
        self.assertEqual(t["cfr"], "29 CFR Part 42")
        self.assertEqual(t["dates"], "Effective Sep 30, 2026 · Docket No. ETA-2025-0003")

    def test_proposed_rule_bullets(self):
        t = {x["key"]: x["text"] for x in self.kinds()["proposed"]["takeaways"]}
        self.assertIn("Comments close Dec 15, 2026", t["dates"])
        self.assertIn("Docket OSHA-2026-0007", t["dates"])
        self.assertIn("§ 1910.1200", t["cfr"])   # from the abstract's prose citation

    def test_notice_fallbacks(self):
        t = {x["key"]: x["text"] for x in self.kinds()["notice"]["takeaways"]}
        self.assertEqual(t["cfr"], "No CFR parts listed")
        self.assertEqual(t["dates"], "Published Nov 10, 2026")

    def test_action_fallback(self):
        item = {**news.empty_item(), "category": "rules", "doc_type": "Rule",
                "published_at": "2026-01-02"}
        t = {x["key"]: x["text"] for x in news.takeaways(item)}
        self.assertEqual(t["action"], "See the document for details.")
        self.assertEqual(t["dates"], "Published Jan 2, 2026")

    def test_pi_bullets(self):
        t = {x["label"]: x["text"] for x in self.kinds()["pi"]["takeaways"]}
        self.assertEqual(t["Filing"], "Notice filed for public inspection Nov 16, 2026")
        self.assertIn("§ 1910.7", t["CFR"])   # extracted from subject_1 prose
        self.assertEqual(t["Publishes"], "Scheduled for Nov 18, 2026")

    def test_pi_cfr_fallback(self):
        item = news.enrich_item(news.pi_item(PI_DOC_SHARED, AGENCY))
        t = {x["label"]: x["text"] for x in item["takeaways"]}
        self.assertEqual(t["CFR"], "CFR parts appear when it publishes")

    def test_enforcement_bullets(self):
        t = {x["label"]: x["text"] for x in self.kinds()["enforcement"]["takeaways"]}
        self.assertIn("Follow-up inspection at Christmas Tree Shops, Salem, NH", t["Incident"])
        self.assertIn("NAICS 455219", t["Incident"])
        self.assertIn("opened Sep 15, 2026", t["Incident"])
        self.assertIn("§ 1910.1030, § 1926.501", t["Standards"])
        self.assertIn("General Duty Clause ×1", t["Standards"])
        self.assertIn("1 state-plan standards", t["Standards"])
        self.assertIn("$30,000 current penalty", t["Penalty"])
        self.assertIn("1 Willful, 2 Serious, 1 Other-than-Serious", t["Penalty"])
        self.assertIn("issued Nov 10, 2026", t["Penalty"])

    def test_enforcement_no_penalty_fallback(self):
        art = news.build_enforcement_article(
            DOL_INSPECTIONS[1],
            [{"activity_nr": 307000001, "standard": "", "viol_type": "O",
              "issuance_date": "2026-10-20", "initial_penalty": "0", "current_penalty": "0"}])
        t = {x["label"]: x["text"] for x in news.takeaways(art)}
        self.assertTrue(t["Penalty"].startswith("No penalty assessed"))
        self.assertEqual(t["Standards"], "No standards listed")

    def test_standards_overflow(self):
        item = {**news.empty_item(), "category": "enforcement", "company": "X",
                "sections": ["1910.1", "1910.2", "1910.3", "1910.4", "1910.5", "1910.6"],
                "published_at": "2026-01-01"}
        t = {x["label"]: x["text"] for x in news.takeaways(item)}
        self.assertIn("+2 more", t["Standards"])


class EnrichTests(HermeticTestCase):
    def test_merges_prose_and_structured_citations(self):
        item = news.enrich_item(news.fr_document_item(FR_DOC_PROPOSED, AGENCY))
        self.assertEqual(item["cfr_parts"], [{"title": 29, "part": "1910"}])
        self.assertEqual(item["sections"], ["1910.1200"])
        self.assertEqual(len(item["takeaways"]), 3)

    def test_other_title_citations_ignored(self):
        item = {**news.empty_item(), "category": "notices",
                "title": "Waste under 40 CFR 261.3", "published_at": "2026-01-01"}
        news.enrich_item(item)
        self.assertEqual(item["sections"], [])
        self.assertEqual(item["cfr_parts"], [])


if __name__ == "__main__":
    unittest.main()
