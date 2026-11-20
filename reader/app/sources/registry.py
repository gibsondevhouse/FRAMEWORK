"""The source registry: one declaration per federal source the reader can collect.

Pure data plus small builders. Every source, filter, option and schedule carries a
plain-English `label` and a one-line `description`, so a settings screen can be a
checklist that people who aren't developers can read. Sizes are estimates (`approximate:
True`) from measured figures: CFR from `title_blurbs.json` (eCFR XML size; the installed
database runs about 3.5x that with text and search index), Federal Register from ~7 KB per
document on disk and ~27,000 documents a year, U.S. Code from rough per-title sizes.

A source's `scope` is a dict keyed by its filters' ids. Multi-choice filters take a list or
the string "all" (when `allow_all`); `choice` takes one option value; `toggle` a bool;
`number` an int within `min`..`max`.
"""
from __future__ import annotations

import os

from .. import config

CATEGORIES = ("Statutes", "Regulations", "Rulemaking", "Enforcement", "News")

# ---------------------------------------------------------------------------
# Schedules
# ---------------------------------------------------------------------------

SCHEDULES: dict[str, dict] = {
    "auto": {"value": "auto", "label": "As soon as it's published",
             "description": "Checks after each weekday's Federal Register issue (about 6:15 a.m. Eastern)."},
    "daily": {"value": "daily", "label": "Once a day",
              "description": "Checks for a newer version about once every 24 hours."},
    "weekly": {"value": "weekly", "label": "Once a week",
               "description": "Checks for a newer version about once every 7 days."},
    "manual": {"value": "manual", "label": "Only when I ask",
               "description": "Never refreshes on its own; use Update in the Library."},
}


def _sched(*values: str) -> list[dict]:
    return [dict(SCHEDULES[v]) for v in values]


# ---------------------------------------------------------------------------
# Size estimates
# ---------------------------------------------------------------------------

MB = 1024 * 1024
CFR_DISK_FACTOR = 3.5           # installed DB / eCFR XML (title-29: 101 MB / 27.7 MB)
CFR_SECONDS_PER_MB = 2.0        # download + parse + index, per MB of eCFR XML
FR_BYTES_PER_DOC = 7 * 1024     # fr.sqlite3 incl. FTS (34.8 MB / 4,953 documents)
FR_DOCS_PER_YEAR = 27_000       # every agency, every document type
FR_SECONDS_PER_REQUEST = 1.5    # FR_MIN_INTERVAL pacing + response time
USC_DEFAULT_MB = 15
# Rough on-disk sizes (MB) of the larger U.S. Code titles (usc-16: 80 MB measured).
USC_SIZE_MB = {5: 45, 7: 70, 10: 90, 12: 50, 15: 80, 16: 80, 18: 40, 20: 60, 22: 45, 25: 30, 26: 70,
               33: 35, 38: 25, 42: 260, 43: 35, 46: 25, 49: 45, 50: 30, 54: 15}
USC_SECONDS_PER_MB = 1.0
# Share of all FR documents per type, for estimates when only some types are chosen.
FR_TYPE_SHARE = {"RULE": 0.11, "PRORULE": 0.07, "NOTICE": 0.79, "PRESDOCU": 0.03}


def estimate(bytes_: float, seconds: float) -> dict:
    return {"bytes": int(bytes_), "seconds": int(round(seconds)), "approximate": True}


def cfr_title_estimate(n: int) -> dict:
    from .. import library as lib
    b = (lib._BLURBS.get("titles", {}).get(str(n)) or {})
    mb = float(b.get("size_mb") or 0)
    return estimate(mb * CFR_DISK_FACTOR * MB, (mb * CFR_SECONDS_PER_MB + 10) if mb else 0)


def usc_title_estimate(n: int) -> dict:
    mb = USC_SIZE_MB.get(n, USC_DEFAULT_MB)
    return estimate(mb * MB, mb * USC_SECONDS_PER_MB + 15)


def fr_estimate(years: int, agencies="all", doc_types="all", cfr_titles="all") -> dict:
    """The size and time to collect `years` of Federal Register documents."""
    share = 1.0
    if doc_types != "all":
        share *= sum(FR_TYPE_SHARE.get(t, 0) for t in doc_types)
    if agencies != "all":
        share *= min(1.0, 0.03 * len(agencies))          # a typical agency: ~3% of documents
    streams = 1
    if cfr_titles != "all":
        titles = cfr_titles if isinstance(cfr_titles, list) else config.installed_titles()
        streams = max(1, len(titles))
        share *= min(1.0, 0.06 * len(titles))             # a typical title: ~6% cite it
    docs = FR_DOCS_PER_YEAR * years * share
    months = 12 * years
    requests = months * streams + docs / 1000
    return {**estimate(docs * FR_BYTES_PER_DOC, requests * FR_SECONDS_PER_REQUEST), "documents": int(docs)}


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

FR_DOC_TYPES = [
    {"value": "RULE", "label": "Final rules",
     "description": "Rules that take effect and change the Code of Federal Regulations."},
    {"value": "PRORULE", "label": "Proposed rules",
     "description": "Changes an agency plans to make, usually open for public comment."},
    {"value": "NOTICE", "label": "Notices",
     "description": "Meetings, guidance, permits, information collections and other announcements."},
    {"value": "PRESDOCU", "label": "Presidential documents",
     "description": "Executive orders, proclamations and memoranda from the President."},
]

# A curated set of Federal Register agency slugs (federalregister.gov/agencies); any other
# slug is accepted too (`allow_custom`).
FR_AGENCIES: list[tuple[str, str]] = [
    ("agriculture-department", "Department of Agriculture"),
    ("commerce-department", "Department of Commerce"),
    ("defense-department", "Department of Defense"),
    ("education-department", "Department of Education"),
    ("energy-department", "Department of Energy"),
    ("health-and-human-services-department", "Department of Health and Human Services"),
    ("homeland-security-department", "Department of Homeland Security"),
    ("housing-and-urban-development-department", "Department of Housing and Urban Development"),
    ("interior-department", "Department of the Interior"),
    ("justice-department", "Department of Justice"),
    ("labor-department", "Department of Labor"),
    ("state-department", "Department of State"),
    ("transportation-department", "Department of Transportation"),
    ("treasury-department", "Department of the Treasury"),
    ("veterans-affairs-department", "Department of Veterans Affairs"),
    ("executive-office-of-the-president", "Executive Office of the President"),
    ("environmental-protection-agency", "Environmental Protection Agency"),
    ("food-and-drug-administration", "Food and Drug Administration"),
    ("centers-for-medicare-medicaid-services", "Centers for Medicare & Medicaid Services"),
    ("internal-revenue-service", "Internal Revenue Service"),
    ("securities-and-exchange-commission", "Securities and Exchange Commission"),
    ("commodity-futures-trading-commission", "Commodity Futures Trading Commission"),
    ("federal-reserve-system", "Federal Reserve System"),
    ("federal-deposit-insurance-corporation", "Federal Deposit Insurance Corporation"),
    ("comptroller-of-the-currency", "Office of the Comptroller of the Currency"),
    ("consumer-financial-protection-bureau", "Consumer Financial Protection Bureau"),
    ("federal-trade-commission", "Federal Trade Commission"),
    ("federal-communications-commission", "Federal Communications Commission"),
    ("federal-energy-regulatory-commission", "Federal Energy Regulatory Commission"),
    ("nuclear-regulatory-commission", "Nuclear Regulatory Commission"),
    ("federal-aviation-administration", "Federal Aviation Administration"),
    ("federal-motor-carrier-safety-administration", "Federal Motor Carrier Safety Administration"),
    ("national-highway-traffic-safety-administration", "National Highway Traffic Safety Administration"),
    ("pipeline-and-hazardous-materials-safety-administration",
     "Pipeline and Hazardous Materials Safety Administration"),
    ("coast-guard", "Coast Guard"),
    ("occupational-safety-and-health-administration", "Occupational Safety and Health Administration"),
    ("mine-safety-and-health-administration", "Mine Safety and Health Administration"),
    ("fish-and-wildlife-service", "Fish and Wildlife Service"),
    ("national-oceanic-and-atmospheric-administration", "National Oceanic and Atmospheric Administration"),
    ("small-business-administration", "Small Business Administration"),
    ("general-services-administration", "General Services Administration"),
    ("personnel-management-office", "Office of Personnel Management"),
]


def cfr_title_options() -> list[dict]:
    from .. import library as lib
    from ..profiles import TITLE_NAMES
    blurbs = lib._BLURBS.get("titles", {})
    out = []
    for n in range(1, 51):
        b = blurbs.get(str(n)) or {}
        reserved = n == 35
        out.append({
            "value": n, "label": f"Title {n} · {TITLE_NAMES.get(n, f'Title {n}')}",
            "description": b.get("summary") or "", "desk": b.get("desk") or "More titles",
            "agencies": list(b.get("agencies") or []), "reserved": reserved,
            "estimate": None if reserved else cfr_title_estimate(n),
        })
    return out


def usc_title_options() -> list[dict]:
    from .. import usc_build, usc_client
    static = usc_build.static_catalog().get("titles", {})
    out = []
    for n in usc_client.ALL_TITLES:
        s = static.get(str(n)) or {}
        reserved = n in usc_client.RESERVED or bool(s.get("reserved"))
        name = s.get("name") or usc_client.title_name_prefix(n)
        cfr = list(s.get("cfr") or [])
        out.append({
            "value": n, "label": f"{usc_client.title_name_prefix(n)} · {name}",
            "appendix": n in usc_client.APPENDIX,
            "description": (s.get("summary") or "Reserved: no laws are assigned to this title." if reserved else
                            s["summary"] if s.get("summary") else
                            f"Implemented mainly by CFR Title{'s' if len(cfr) > 1 else ''} "
                            f"{', '.join(map(str, cfr))}." if cfr else
                            "Permanent federal statutes on this subject."),
            "desk": s.get("desk") or "More titles", "positive_law": bool(s.get("positive_law")),
            "cfr": cfr, "reserved": reserved, "estimate": None if reserved else usc_title_estimate(n),
        })
    return out


def agency_options() -> list[dict]:
    return [{"value": slug, "label": name, "description": f"Documents issued by the {name}."}
            for slug, name in FR_AGENCIES]


# ---------------------------------------------------------------------------
# Keys (presence only, never the value)
# ---------------------------------------------------------------------------

KEYS: dict[str, dict] = {
    "dol": {"env": "DOL_API_KEY", "label": "Department of Labor API key",
            "get_key_url": "https://dataportal.dol.gov/registration"},
    "govinfo": {"env": "GOVINFO_API_KEY", "label": "api.data.gov key (GovInfo)",
                "get_key_url": "https://api.data.gov/signup/"},
}


def key_present(key_id: str) -> bool:
    return bool(os.getenv(KEYS[key_id]["env"], "").strip())


def _key(key_id: str | None, required: bool) -> dict:
    if key_id is None:
        return {"needs_key": False, "key_present": None, "key_label": None, "key_env": None, "get_key_url": None,
                "optional_key": None}
    k = KEYS[key_id]
    info = {"needs_key": required, "key_present": key_present(key_id), "key_label": k["label"],
            "key_env": k["env"], "get_key_url": k["get_key_url"]}
    return {**info, "optional_key": None} if required else {
        "needs_key": False, "key_present": None, "key_label": None, "key_env": None, "get_key_url": None,
        "optional_key": {**info, "needs_key": False, "purpose": "Lets the integrity check cross-check against GovInfo."}}


# ---------------------------------------------------------------------------
# The sources
# ---------------------------------------------------------------------------

SOURCE_IDS = ("usc", "cfr", "fr", "news", "dol_enforcement", "constitution", "public_laws", "unified_agenda")


def _defs() -> list[dict]:
    """The declarations, built fresh each call (option lists read the catalogs)."""
    years_filter = {
        "id": "years", "type": "number", "label": "How far back",
        "description": "Years of past documents to keep, counted back from today.",
        "min": 1, "max": 30, "unit": "years",
    }
    return [
        {
            "id": "usc", "label": "United States Code", "short": "U.S.C.", "category": "Statutes",
            "description": "Every permanent federal law passed by Congress, organized by subject into 54 titles.",
            "provider": "Office of the Law Revision Counsel (uscode.house.gov)", "available": True,
            **_key(None, False), "actions": ["install", "update", "remove"],
            "schedule_options": _sched("daily", "weekly", "manual"), "default_schedule": "daily",
            "filters": [{"id": "titles", "type": "multi", "label": "Titles",
                         "description": "Which U.S. Code titles to keep on this computer.",
                         "allow_all": True, "options": usc_title_options()}],
            "default_scope": {"titles": "all"},
        },
        {
            "id": "cfr", "label": "Code of Federal Regulations", "short": "CFR", "category": "Regulations",
            "description": "Every rule federal agencies have issued under those laws, in 50 subject titles.",
            "provider": "eCFR (ecfr.gov)", "available": True, **_key(None, False),
            "actions": ["install", "update", "remove"],
            "schedule_options": _sched("daily", "weekly", "manual"), "default_schedule": "weekly",
            "filters": [{"id": "titles", "type": "multi", "label": "Titles",
                         "description": "Which CFR titles to keep on this computer.",
                         "allow_all": True, "options": cfr_title_options()}],
            "default_scope": {"titles": "all"},
        },
        {
            "id": "fr", "label": "Federal Register archive", "short": "FR", "category": "Rulemaking",
            "description": "The government's daily journal: new and proposed rules, notices and presidential "
                           "documents, kept as a searchable archive.",
            "provider": "FederalRegister.gov API", "available": True, **_key("govinfo", False),
            "actions": ["install", "update", "remove"],
            "schedule_options": _sched("auto", "weekly", "manual"), "default_schedule": "auto",
            "filters": [
                {"id": "agencies", "type": "multi", "label": "Agencies",
                 "description": "Only documents from these agencies. Choose All for every agency.",
                 "allow_all": True, "allow_custom": True, "options": agency_options()},
                {"id": "doc_types", "type": "multi", "label": "Document types",
                 "description": "Which kinds of documents to collect.", "allow_all": True,
                 "options": FR_DOC_TYPES},
                {"id": "cfr_titles", "type": "multi", "label": "Only documents that change these CFR titles",
                 "description": "Narrow the archive to documents citing certain CFR titles. All keeps every "
                                "document; Installed follows the CFR titles on this computer.",
                 "allow_all": True, "allow_installed": True, "options": cfr_title_options()},
                years_filter,
            ],
            "default_scope": {"agencies": "all", "doc_types": "all", "cfr_titles": "all", "years": 5},
        },
        {
            "id": "news", "label": "Regulatory news feed", "short": "News", "category": "News",
            "description": "A short-term feed of the newest Federal Register filings for the News page, "
                           "including documents not yet published (public inspection).",
            "provider": "FederalRegister.gov API", "available": True, **_key(None, False),
            "actions": ["update"],
            "schedule_options": _sched("auto", "manual"), "default_schedule": "auto",
            "filters": [
                {"id": "agencies", "type": "multi", "label": "Agencies",
                 "description": "Whose filings appear in the feed. Choose All for every agency.",
                 "allow_all": True, "allow_custom": True, "options": agency_options()},
                {"id": "follow_cfr_titles", "type": "multi", "label": "Also follow these CFR titles",
                 "description": "Add filings from any agency that change these CFR titles. Installed follows "
                                "the CFR titles on this computer.",
                 "allow_all": False, "allow_installed": True, "options": cfr_title_options()},
                {"id": "public_inspection", "type": "toggle", "label": "Include public inspection",
                 "description": "Show documents on file for public inspection, usually the day before "
                                "they're published."},
                {"id": "retention_days", "type": "number", "label": "Keep news for",
                 "description": "Older items are cleared from the feed.", "min": 30, "max": 3650,
                 "unit": "days"},
            ],
            "default_scope": {"agencies": "all", "follow_cfr_titles": [], "public_inspection": True,
                              "retention_days": 365},
        },
        {
            "id": "dol_enforcement", "label": "Labor Department enforcement records", "short": "DOL",
            "category": "Enforcement",
            "description": "OSHA inspections, citations and penalties from the Department of Labor's open data.",
            "provider": "Department of Labor Open Data (dataportal.dol.gov)", "available": True,
            **_key("dol", True), "actions": ["update"],
            "schedule_options": _sched("daily", "manual"), "default_schedule": "daily",
            "filters": [], "default_scope": {},
        },
        {
            "id": "constitution", "label": "U.S. Constitution", "short": "Const.", "category": "Statutes",
            "description": "The Constitution and its amendments. Coming in a later version.",
            "provider": "GovInfo", "available": False, **_key(None, False), "actions": [],
            "schedule_options": _sched("manual"), "default_schedule": "manual",
            "filters": [], "default_scope": {},
        },
        {
            "id": "public_laws", "label": "Public Laws (Statutes at Large)", "short": "Pub. L.",
            "category": "Statutes",
            "description": "New laws exactly as Congress passed them, before they're sorted into the U.S. Code. "
                           "Coming in a later version.",
            "provider": "GovInfo", "available": False, **_key("govinfo", True), "actions": [],
            "schedule_options": _sched("weekly", "manual"), "default_schedule": "weekly",
            "filters": [], "default_scope": {},
        },
        {
            "id": "unified_agenda", "label": "Unified Agenda", "short": "Agenda", "category": "Rulemaking",
            "description": "Each agency's published plan of rules it expects to propose or finish, with target "
                           "dates. Coming in a later version.",
            "provider": "RegInfo.gov", "available": False, **_key(None, False), "actions": [],
            "schedule_options": _sched("manual"), "default_schedule": "manual",
            "filters": [], "default_scope": {},
        },
    ]


def definitions() -> list[dict]:
    return _defs()


def definition(source_id: str) -> dict:
    for d in _defs():
        if d["id"] == source_id:
            return d
    raise KeyError(source_id)


def default_selection() -> dict:
    """Every available source on at its default scope and schedule; placeholders off."""
    return {"version": 1, "sources": {
        d["id"]: {"enabled": bool(d["available"]) and not d["needs_key"], "schedule": d["default_schedule"],
                  "scope": dict(d["default_scope"])}
        for d in _defs()}}
