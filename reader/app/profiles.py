"""First-run profiles: curated sets of CFR titles and parts for what a reader works in.

Pure data, no logic. The frontend reads it from `GET /api/profiles` and queues each download
through `POST /api/library/download`, so this is the one place to edit a profile. Each
download is a whole title (`{"title": N}`) or one part (`{"title": N, "part": "171"}`);
parts are strings because that is what the library's scope and eCFR use.
"""
from __future__ import annotations

# The 50 CFR titles, for the picker's summary lines (eCFR's names, trimmed). Static on purpose:
# the first-run screen must render before the reader has talked to eCFR at all.
TITLE_NAMES: dict[int, str] = {
    1: "General Provisions", 2: "Grants and Agreements", 3: "The President", 4: "Accounts",
    5: "Administrative Personnel", 6: "Domestic Security", 7: "Agriculture", 8: "Aliens and Nationality",
    9: "Animals and Animal Products", 10: "Energy", 11: "Federal Elections", 12: "Banks and Banking",
    13: "Business Credit and Assistance", 14: "Aeronautics and Space", 15: "Commerce and Foreign Trade",
    16: "Commercial Practices", 17: "Commodity and Securities Exchanges", 18: "Conservation of Power and Water Resources",
    19: "Customs Duties", 20: "Employees' Benefits", 21: "Food and Drugs", 22: "Foreign Relations",
    23: "Highways", 24: "Housing and Urban Development", 25: "Indians", 26: "Internal Revenue",
    27: "Alcohol, Tobacco Products and Firearms", 28: "Judicial Administration", 29: "Labor",
    30: "Mineral Resources", 31: "Money and Finance: Treasury", 32: "National Defense",
    33: "Navigation and Navigable Waters", 34: "Education", 35: "Reserved", 36: "Parks, Forests, and Public Property",
    37: "Patents, Trademarks, and Copyrights", 38: "Pensions, Bonuses, and Veterans' Relief",
    39: "Postal Service", 40: "Protection of Environment", 41: "Public Contracts and Property Management",
    42: "Public Health", 43: "Public Lands: Interior", 44: "Emergency Management and Assistance",
    45: "Public Welfare", 46: "Shipping", 47: "Telecommunication",
    48: "Federal Acquisition Regulations System", 49: "Transportation", 50: "Wildlife and Fisheries",
}

HAZMAT_PARTS = ["171", "172", "173", "174", "175", "176", "177", "178", "179", "180"]

PROFILES: list[dict] = [
    {
        "id": "safety",
        "name": "Safety / OSHA",
        "description": "Workplace safety and health, mine safety, and hazardous materials transport.",
        "downloads": [{"title": 29}, {"title": 30}] + [{"title": 49, "part": p} for p in HAZMAT_PARTS],
    },
    {
        "id": "environmental",
        "name": "Environmental",
        "description": "EPA rules, navigable waters and the Army Corps, and nuclear energy.",
        "downloads": [{"title": 40}, {"title": 33}, {"title": 10}],
    },
    {
        "id": "transportation",
        "name": "Transportation",
        "description": "DOT, FAA, and the federal highway program.",
        "downloads": [{"title": 49}, {"title": 14}, {"title": 23}],
    },
    {
        "id": "employment",
        "name": "Employment & benefits",
        "description": "Labor law, employee benefits, and federal contracting.",
        "downloads": [{"title": 29}, {"title": 20}, {"title": 41}],
    },
    {
        "id": "elections",
        "name": "Elections & government",
        "description": "Federal elections, the civil service, and general provisions.",
        "downloads": [{"title": 11}, {"title": 5}, {"title": 1}],
    },
    {
        "id": "food-drugs",
        "name": "Food & drugs",
        "description": "FDA regulation of food, drugs, devices, and cosmetics.",
        "downloads": [{"title": 21}],
    },
    {
        "id": "finance",
        "name": "Finance",
        "description": "Banking and the securities and commodities markets.",
        "downloads": [{"title": 12}, {"title": 17}],
    },
]
