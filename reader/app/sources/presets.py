"""Built-in presets: data only. Each is a selection fragment merged over the registry
defaults by `selection.normalize`, so a preset names only what it changes.

- Recommended (the default): the Constitution, every statute and regulation title, public
  laws from every congress in USLM, 2 years of the Federal Register archive and the Unified
  Agenda, the news feed for every agency. Needs no keys.
- Everything: the same with 5 years of the Federal Register and the Agenda, private laws and
  DOL enforcement (needs a key).
- Minimal: nothing refreshes and nothing new downloads; what's on disk stays readable.
- One per Library bundle (`library.COMPLIANCE_SUITES`) and one per Library desk
  (`title_blurbs.json` desks), narrowing CFR / U.S.C. / FR / news to those titles.
"""
from __future__ import annotations

from . import registry

PRESET_PREFIX = "preset:"


def _fixed() -> list[dict]:
    return [
        {
            "id": "recommended", "name": "Recommended", "default": True, "needs_keys": [],
            "description": "The Constitution, every federal law and regulation title, new Public Laws, two "
                           "years of the Federal Register and the Unified Agenda, and news from every agency. "
                           "No keys needed.",
            "sources": {
                "usc": {"enabled": True, "schedule": "daily", "scope": {"titles": "all"}},
                "cfr": {"enabled": True, "schedule": "weekly", "scope": {"titles": "all"}},
                "fr": {"enabled": True, "schedule": "auto",
                       "scope": {"agencies": "all", "doc_types": "all", "cfr_titles": "all", "years": 2}},
                "news": {"enabled": True, "schedule": "auto",
                         "scope": {"agencies": "all", "follow_cfr_titles": [], "public_inspection": True}},
                "dol_enforcement": {"enabled": False},
                "constitution": {"enabled": True, "schedule": "weekly"},
                "public_laws": {"enabled": True, "schedule": "weekly",
                                "scope": {"congresses": "all", "law_types": ["public"]}},
                "unified_agenda": {"enabled": True, "schedule": "weekly",
                                   "scope": {"agencies": "all", "stages": "all", "years": 2}},
            },
        },
        {
            "id": "everything", "name": "Everything", "default": False, "needs_keys": ["dol"],
            "description": "Recommended plus five years of the Federal Register and the Unified Agenda, "
                           "private laws, and Labor Department enforcement records (needs a free DOL key).",
            "sources": {
                "usc": {"enabled": True, "schedule": "daily", "scope": {"titles": "all"}},
                "cfr": {"enabled": True, "schedule": "weekly", "scope": {"titles": "all"}},
                "fr": {"enabled": True, "schedule": "auto",
                       "scope": {"agencies": "all", "doc_types": "all", "cfr_titles": "all", "years": 5}},
                "news": {"enabled": True, "schedule": "auto",
                         "scope": {"agencies": "all", "follow_cfr_titles": [], "public_inspection": True}},
                "dol_enforcement": {"enabled": True, "schedule": "daily"},
                "constitution": {"enabled": True, "schedule": "weekly"},
                "public_laws": {"enabled": True, "schedule": "weekly",
                                "scope": {"congresses": "all", "law_types": ["public", "private"]}},
                "unified_agenda": {"enabled": True, "schedule": "weekly",
                                   "scope": {"agencies": "all", "stages": "all", "years": 5}},
            },
        },
        {
            "id": "minimal", "name": "Minimal (offline)", "default": False, "needs_keys": [],
            "description": "Nothing refreshes and nothing new downloads. Everything already on this computer "
                           "stays readable.",
            "sources": {sid: {"enabled": False, "schedule": "manual"} for sid in registry.SOURCE_IDS},
        },
    ]


def _narrow(cfr: list[int], usc: list[int]) -> dict:
    return {
        "usc": {"enabled": bool(usc), "schedule": "daily", "scope": {"titles": usc}},
        "cfr": {"enabled": True, "schedule": "weekly", "scope": {"titles": cfr}},
        "fr": {"enabled": True, "schedule": "auto",
               "scope": {"agencies": "all", "doc_types": "all", "cfr_titles": cfr, "years": 2}},
        "news": {"enabled": True, "schedule": "auto",
                 "scope": {"agencies": [], "follow_cfr_titles": cfr, "public_inspection": False}},
        "dol_enforcement": {"enabled": False},
        "constitution": {"enabled": True, "schedule": "weekly"},
        "public_laws": {"enabled": False},
        "unified_agenda": {"enabled": False},
    }


def _bundles() -> list[dict]:
    from .. import library as lib
    out = []
    for sid, s in lib.COMPLIANCE_SUITES.items():
        out.append({"id": f"bundle-{sid}", "name": s["name"], "default": False, "needs_keys": [],
                     "group": "Library bundles", "description": s.get("summary") or "",
                     "sources": _narrow(list(s["titles"]), list(s.get("usc_titles") or []))})
    return out


def _desks() -> list[dict]:
    from .. import library as lib, usc_build
    blurbs = lib._BLURBS.get("titles", {})
    usc_static = usc_build.static_catalog().get("titles", {})
    out = []
    for desk in lib.DESKS:
        cfr = sorted(int(n) for n, b in blurbs.items() if b.get("desk") == desk and int(n) != 35)
        if not cfr:
            continue
        usc = sorted(int(n) for n, s in usc_static.items()
                     if not s.get("reserved") and set(s.get("cfr") or []) & set(cfr))
        slug = "".join(c if c.isalnum() else "-" for c in desk.lower()).strip("-")
        while "--" in slug:
            slug = slug.replace("--", "-")
        out.append({"id": f"desk-{slug}", "name": desk, "default": False, "needs_keys": [], "group": "Desks",
                    "description": f"CFR titles on the {desk} desk ({', '.join(map(str, cfr))}), the U.S. Code "
                                   "titles behind them, and their Federal Register documents.",
                    "sources": _narrow(cfr, usc)})
    return out


def presets() -> list[dict]:
    """[{id, name, description, default, needs_keys, group, selection}] with full selections."""
    from . import selection
    out = []
    for p in _fixed() + _bundles() + _desks():
        p.setdefault("group", "Starting points")
        sel = selection.normalize({"sources": p.pop("sources")})
        out.append({**p, "id": PRESET_PREFIX + p["id"], "builtin": True, "selection": sel})
    return out


def get(preset_id: str) -> dict | None:
    for p in presets():
        if p["id"] == preset_id:
            return p
    return None
