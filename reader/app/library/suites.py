"""Curated compliance suites, desks and the editorial title blurbs."""
from __future__ import annotations

import json
from pathlib import Path

from .. import library as lib

def _load_blurbs() -> dict:
    try:
        return json.loads((Path(__file__).parent.parent / "title_blurbs.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


_BLURBS = _load_blurbs()
DESKS: list[str] = list(_BLURBS.get("desks", []))
OTHER_DESK = "More titles"  # a title eCFR adds that has no editorial entry yet

# Compliance suites: titles that are usually read together, downloadable in one go
# (`POST /api/library/batch-download {"suite": id}`). A new suite is one entry here; its size
# and section count are summed from the titles' measured figures in title_blurbs.json.
COMPLIANCE_SUITES: dict[str, dict] = {
    "ehs": {
        "name": "Environment, Health & Safety",
        "badge": "Core compliance",
        "featured": True,
        "titles": [29, 40, 49],
        "summary": "Workplace safety and health (OSHA), environmental protection (EPA) and hazardous materials "
                   "transport (DOT): the baseline an EHS program is audited against.",
    },
    "trade": {
        "name": "Commerce, Banking & Securities",
        "badge": "Financial markets",
        "titles": [12, 15, 17],
        "summary": "Bank and credit union rules, Commerce export controls, and SEC and CFTC market regulation.",
    },
    "govcon": {
        "name": "Federal Contracting",
        "badge": "Government",
        "titles": [41, 48],
        "summary": "The Federal Acquisition Regulation and agency supplements, with GSA property and travel rules.",
    },
}


def suites() -> dict[str, dict]:
    """The suites with their id and estimated size (MB of eCFR text) and section count."""
    blurbs = lib._BLURBS.get("titles", {})
    out = {}
    for sid, s in COMPLIANCE_SUITES.items():
        bs = [blurbs.get(str(n), {}) for n in s["titles"]]
        out[sid] = {
            "id": sid, "featured": bool(s.get("featured")), **s,
            "size_mb": round(sum(b.get("size_mb") or 0 for b in bs), 1),
            "sections": sum(b.get("sections") or 0 for b in bs),
        }
    return out
