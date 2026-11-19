"""Offline fixtures for the news suites, shaped exactly like the live payloads.

Field names were copied from live responses on 2026-11-16 (FR documents and Public
Inspection keys: stage-1 phase-1 part-1 §4.2-4.3 of the plan; DOL columns: stage-1
phase-2 part-2 §2). Re-check them against a live call whenever a fetcher changes, and
update this date.

`FakeAPI` fakes FR/DOL HTTP with `httpx.MockTransport`, routed on path, and records
every request so tests can assert on headers and params. `NetworkGuardTestCase` is the
shared `tests.base.HermeticTestCase` (env pop-and-restore + sync/async network guard),
kept under its historical name for the news suites (MockTransport is unaffected).
"""
from __future__ import annotations

import json
from unittest import mock

import httpx

from app import news
from tests.base import HermeticTestCase

# --- Federal Register published documents (observed live for 2026-17726) -------------

FR_DOC_RULE = {
    "title": "Rescission of Coordinated Enforcement Regulations",
    "document_number": "2026-17726",
    "publication_date": "2026-08-31",
    "type": "Rule",
    "abstract": "The Department of Labor (Department) is rescinding regulations on coordinated enforcement.",
    "action": "Final rule.",
    "dates": "This final rule is effective September 30, 2026.",
    "effective_on": "2026-09-30",
    "comments_close_on": None,
    "cfr_references": [{"chapter": None, "citation_url": None, "part": "42", "title": 29}],
    "citation": "91 FR 55744",
    "html_url": "https://www.federalregister.gov/documents/2026/08/31/2026-17726/rescission",
    "pdf_url": "https://www.govinfo.gov/content/pkg/FR-2026-08-31/pdf/2026-17726.pdf",
    "body_html_url": "https://www.federalregister.gov/documents/full_text/html/2026/08/31/2026-17726.html",
    "docket_ids": ["Docket No. ETA-2025-0003"],
}

FR_DOC_PROPOSED = {
    "title": "Hazard Communication: Proposed Amendments",
    "document_number": "2026-20001",
    "publication_date": "2026-11-02",
    "type": "Proposed Rule",
    "abstract": "OSHA proposes to amend 29 CFR 1910.1200(a)(1) to align label elements. Comments are requested.",
    "action": "Proposed rule; request for comments.",
    "dates": "Comments must be submitted by December 15, 2026.",
    "effective_on": None,
    "comments_close_on": "2026-12-15",
    "cfr_references": [{"chapter": None, "citation_url": None, "part": "1910", "title": 29}],
    "citation": "91 FR 60123",
    "html_url": "https://www.federalregister.gov/documents/2026/11/02/2026-20001/hazcom",
    "pdf_url": "https://www.govinfo.gov/content/pkg/FR-2026-11-02/pdf/2026-20001.pdf",
    "body_html_url": None,
    "docket_ids": ["OSHA-2026-0007"],
}

FR_DOC_NOTICE = {
    "title": "Advisory Committee on Construction Safety and Health: Meeting",
    "document_number": "2026-21000",
    "publication_date": "2026-11-10",
    "type": "Notice",
    "abstract": "The Advisory Committee will meet in Washington, DC.",
    "action": None,
    "dates": None,
    "effective_on": None,
    "comments_close_on": None,
    "cfr_references": [],
    "citation": "91 FR 61500",
    "html_url": "https://www.federalregister.gov/documents/2026/11/10/2026-21000/accsh-meeting",
    "pdf_url": "https://www.govinfo.gov/content/pkg/FR-2026-11-10/pdf/2026-21000.pdf",
    "body_html_url": None,
    "docket_ids": [],
}

FR_DOCS_JSON = {"count": 3, "results": [FR_DOC_NOTICE, FR_DOC_PROPOSED, FR_DOC_RULE]}

# --- Federal Register Public Inspection (default result keys, verified 2026-11-16) ----

PI_DOC_SHARED = {  # shares document_number with FR_DOC_NOTICE: the no-duplicate path
    "agencies": [{"name": "Occupational Safety and Health Administration"}],
    "agency_names": ["Occupational Safety and Health Administration"],
    "docket_numbers": [],
    "document_number": "2026-21000",
    "editorial_note": None,
    "excerpts": None,
    "filed_at": "2026-11-09T08:45:00-05:00",
    "filing_type": "regular",
    "html_url": "https://www.federalregister.gov/public-inspection/2026-21000/accsh-meeting",
    "json_url": "https://www.federalregister.gov/api/v1/documents/2026-21000.json",
    "num_pages": 4,
    "pdf_file_name": "2026-21000.pdf",
    "pdf_file_size": 240000,
    "pdf_updated_at": "2026-11-09T08:45:04-05:00",
    "pdf_url": "https://public-inspection.federalregister.gov/2026-21000.pdf",
    "publication_date": "2026-11-10",
    "raw_text_url": "https://www.federalregister.gov/documents/raw_text/2026/21000.txt",
    "subject_1": "Advisory Committee on Construction Safety and Health",
    "subject_2": "Notice of meeting",
    "subject_3": None,
    "title": "Advisory Committee on Construction Safety and Health: Meeting",
    "toc_doc": None,
    "toc_subject": None,
    "type": "Notice",
}

PI_DOC_ONLY = {  # only on file, not yet published
    "agencies": [{"name": "Occupational Safety and Health Administration"}],
    "agency_names": ["Occupational Safety and Health Administration"],
    "docket_numbers": ["OSHA-2025-0011"],
    "document_number": "2026-22222",
    "editorial_note": None,
    "excerpts": None,
    "filed_at": "2026-11-16T11:15:00-05:00",
    "filing_type": "special",
    "html_url": "https://www.federalregister.gov/public-inspection/2026-22222/nrtl-expansion",
    "json_url": "https://www.federalregister.gov/api/v1/documents/2026-22222.json",
    "num_pages": 6,
    "pdf_file_name": "2026-22222.pdf",
    "pdf_file_size": 310000,
    "pdf_updated_at": "2026-11-16T11:15:02-05:00",
    "pdf_url": "https://public-inspection.federalregister.gov/2026-22222.pdf",
    "publication_date": "2026-11-18",
    "raw_text_url": None,
    "subject_1": "TUV Rheinland of North America: expansion of recognition under 29 CFR 1910.7",
    "subject_2": None,
    "subject_3": None,
    "title": "Nationally Recognized Testing Laboratories: Expansion of Recognition",
    "toc_doc": None,
    "toc_subject": None,
    "type": "Notice",
}

PI_JSON = {"results": [PI_DOC_ONLY, PI_DOC_SHARED]}

# --- DOL Open Data API v4 (column names from datasets 10334 and 10338) ----------------

DOL_VIOLATIONS = [
    # Inspection 306953084: a Willful 1910.1030, a deleted row, a Serious with an empty
    # current_penalty (falls back to initial), a General Duty code and a state-plan code.
    {"activity_nr": 306953084, "citation_id": "01001", "delete_flag": None,
     "standard": "19101030 G02   IIA", "viol_type": "W", "issuance_date": "2026-11-10",
     "initial_penalty": "11000", "current_penalty": "14000", "nr_instances": 1, "nr_exposed": 4},
    {"activity_nr": 306953084, "citation_id": "01002", "delete_flag": "X",
     "standard": "19101030 G02", "viol_type": "S", "issuance_date": "2026-11-10",
     "initial_penalty": "99999", "current_penalty": "99999", "nr_instances": 1, "nr_exposed": 1},
    {"activity_nr": 306953084, "citation_id": "01003", "delete_flag": None,
     "standard": "19260501 B13", "viol_type": "S", "issuance_date": "2026-11-08",
     "initial_penalty": "9000", "current_penalty": "", "nr_instances": 1, "nr_exposed": 2},
    {"activity_nr": 306953084, "citation_id": "01004", "delete_flag": None,
     "standard": "5A0001", "viol_type": "S", "issuance_date": "2026-11-08",
     "initial_penalty": "7000", "current_penalty": "7000", "nr_instances": 1, "nr_exposed": 3},
    {"activity_nr": 306953084, "citation_id": "01005", "delete_flag": None,
     "standard": "83590050 A01", "viol_type": "O", "issuance_date": "2026-11-08",
     "initial_penalty": "0", "current_penalty": "0", "nr_instances": 1, "nr_exposed": 1},
    # Inspection 307000001: one Repeat citation, issued earlier.
    {"activity_nr": 307000001, "citation_id": "01001", "delete_flag": None,
     "standard": "19100134 A01", "viol_type": "R", "issuance_date": "2026-10-20",
     "initial_penalty": "30000", "current_penalty": "25000", "nr_instances": 1, "nr_exposed": 6},
]

DOL_INSPECTIONS = [
    {"activity_nr": 306953084, "estab_name": "CHRISTMAS TREE SHOPS", "site_city": "SALEM",
     "site_state": "NH", "naics_code": "455219", "insp_type": "F", "safety_hlth": "S",
     "open_date": "2026-09-15", "close_case_date": None},
    {"activity_nr": 307000001, "estab_name": "ACME FOUNDRY LLC", "site_city": "HOUSTON",
     "site_state": "TX", "naics_code": "331511", "insp_type": "A", "safety_hlth": "S",
     "open_date": "2026-08-01", "close_case_date": None},
]

# --- One shared table for the Python and JS citation linkifiers -----------------------
# (text, expected section ids, expected Title 29 part refs). Every case here must give
# the same section set from news.extract_citations and from NEWS_CITE_RE in app.js.

CITATION_CASES = [
    ("29 CFR 1926.651 and § 1910.1200(a)(1)", ["1910.1200", "1926.651"], []),
    ("29 CFR 1910.1030(g)", ["1910.1030"], []),
    ("29 CFR part 1904", [], ["1904"]),
    ("costs of $1999.5 million", [], []),
    ("§ 541.100", [], []),
    ("40 CFR 261.3", [], []),
    ("no citations here at all", [], []),
]

# Python-only shapes (lists after one CFR prefix) that the deliberately simpler JS
# regex does not expand; they stay out of the parity check.
CITATION_CASES_PY_ONLY = [
    ("29 C.F.R. §§ 1910.1001 and 1926.1101", ["1910.1001", "1926.1101"], []),
    ("29 CFR parts 1910 and 1926", [], ["1910", "1926"]),
]


class FakeAPI:
    """MockTransport handler: serves the fixtures and records every request."""

    def __init__(self, fr_pages: list[dict] | None = None, pi: dict | None = None,
                 violations: list[dict] | None = None, inspections: list[dict] | None = None,
                 related_activities: list[dict] | None = None,
                 fail_paths: tuple = (), malformed_paths: tuple = (), timeout_paths: tuple = (),
                 rate_limit_paths: tuple = (), extra_routes: dict | None = None):
        self.fr_pages = fr_pages if fr_pages is not None else [FR_DOCS_JSON]
        self.pi = pi if pi is not None else PI_JSON
        self.violations = violations if violations is not None else DOL_VIOLATIONS
        self.inspections = inspections if inspections is not None else DOL_INSPECTIONS
        self.related_activities = related_activities if related_activities is not None else [
            {"activity_nr": 306953084, "rel_type": "A", "rel_act_nr": 307000001,
             "rel_safety": "Y", "rel_health": None},
        ]
        self.fail_paths = fail_paths
        self.malformed_paths = malformed_paths
        self.timeout_paths = timeout_paths
        self.rate_limit_paths = rate_limit_paths
        self.extra_routes = extra_routes or {}
        self.requests: list[httpx.Request] = []
        self._fr_page_index = 0

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def requests_for(self, fragment: str) -> list[httpx.Request]:
        return [r for r in self.requests if fragment in r.url.path]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path in self.timeout_paths:
            raise httpx.ConnectTimeout("timed out", request=request)
        if path in self.rate_limit_paths:
            return httpx.Response(429, headers={"Retry-After": "30"}, json={"error": "rate limit"}, request=request)
        if path in self.fail_paths:
            return httpx.Response(500, json={"error": "server error"}, request=request)
        if path in self.malformed_paths:
            return httpx.Response(200, text="<html>not json</html>", request=request)
        if path in self.extra_routes:
            res = self.extra_routes[path]
            if callable(res):
                return res(request)
            return httpx.Response(200, json=res, request=request)
        if path == "/api/v1/documents.json":
            i = min(self._fr_page_index, len(self.fr_pages) - 1)
            page = dict(self.fr_pages[i])
            self._fr_page_index += 1
            return httpx.Response(200, json=page, request=request)
        if path == "/api/v1/public-inspection-documents.json":
            return httpx.Response(200, json=self.pi, request=request)
        if path == "/v4/get/OSHA/violation/json":
            filt = json.loads(request.url.params.get("filter_object") or "{}")
            rows = [r for r in self.violations if self._match_filter(r, filt)]
            return httpx.Response(200, json={"data": rows}, request=request)
        if path == "/v4/get/OSHA/inspection/json":
            filt = json.loads(request.url.params.get("filter_object") or "{}")
            rows = [r for r in self.inspections if self._match_filter(r, filt)]
            return httpx.Response(200, json={"data": rows}, request=request)
        if path == "/v4/get/OSHA/violation_event/json":
            return httpx.Response(200, json={"data": [
                {"activity_nr": 306953084, "citation_id": "01001", "hist_event": "I",
                 "hist_date": "2026-11-10T00:00:00", "hist_penalty": "11000"},
                {"activity_nr": 306953084, "citation_id": "01001", "hist_event": "M",
                 "hist_date": "2026-11-12T00:00:00", "hist_penalty": "14000"},
            ]}, request=request)
        if path == "/v4/get/OSHA/violation_gen_duty_std/json":
            return httpx.Response(200, json={"data": [
                {"activity_nr": 306953084, "citation_id": "01004", "line_nr": 1,
                 "line_text": "Employer failed to furnish employment free from recognized hazards."},
            ]}, request=request)
        if path in ("/v4/get/OSHA/accident_injury/json", "/v4/get/OSHA/accident/json", "/v4/get/OSHA/accident_abstract/json"):
            return httpx.Response(200, json={"data": []}, request=request)
        if path == "/v4/get/OSHA/related_activity/json":
            filt = json.loads(request.url.params.get("filter_object") or "{}")
            fld = filt.get("field")
            val = filt.get("value")
            rows = [r for r in self.related_activities if r.get(fld) == val]
            return httpx.Response(200, json={"data": rows}, request=request)
        raise AssertionError(f"unexpected request: {request.url}")

    def _match_filter(self, row: dict, filt: dict) -> bool:
        if not filt:
            return True
        if "and" in filt:
            return all(self._match_filter(row, c) for c in filt["and"])
        fld = filt.get("field")
        op = filt.get("operator")
        val = filt.get("value")
        rv = row.get(fld)
        if op == "eq":
            return str(rv or "").upper() == str(val or "").upper() if isinstance(val, str) else rv == val
        if op == "in":
            return rv in set(val or [])
        if op == "gt":
            return str(rv or "") > str(val or "")
        if op == "like":
            pat = str(val or "").upper()
            s = str(rv or "").upper()
            if pat.startswith("%") and pat.endswith("%"):
                return pat.strip("%") in s
            if pat.endswith("%"):
                return s.startswith(pat[:-1])
            return s == pat
        return True

    def patch_client(self):
        """Patch news.client so every fetch in the block goes through this transport,
        keeping news.client's real headers (the User-Agent assertions stay honest)."""
        fake = self

        def fake_client(extra=None):
            headers = {"User-Agent": news.USER_AGENT, "Accept": "application/json"}
            headers.update(extra or {})
            return httpx.Client(headers=headers, timeout=20.0, follow_redirects=True,
                                transport=fake.transport())

        return mock.patch.object(news, "client", fake_client)


class NetworkGuardTestCase(HermeticTestCase):
    """Historical name for the news suites; the guard lives in tests.base."""
