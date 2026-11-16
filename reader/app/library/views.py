"""Library views: the wire of recent changes, a title's parts, a part's sections."""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

import httpx

from .. import build, config
from .. import library as lib
from .client import _cache_lock, _client

_changes: dict[tuple[int, str], dict] = {}


def _clean(name: str) -> str:
    return re.sub(r"\s+", " ", name or "").strip()


def changes(title: int, amended: str) -> dict:
    """What eCFR amended in a title on its latest amendment date: the count of sections and
    appendices, their parts, and the first one's heading. Cached per (title, date)."""
    key = (title, amended)
    with _cache_lock:
        if key in _changes:
            return _changes[key]
    with _client() as c:
        raw = build.fetch_json(c, f"{config.ECFR_API}/versions/title-{title}.json?issue_date%5Bgte%5D={amended}")
    versions = raw.get("content_versions", [])
    # An issue republishes neighbouring sections too; the amendments are the ones dated that day
    # (or marked substantive). An issue with neither only made editorial revisions.
    hits = [v for v in versions if v.get("amendment_date") == amended] or [v for v in versions if v.get("substantive")]
    kind = "amended" if hits else "revised"
    hits = hits or versions
    parts: list[str] = []
    for v in hits:
        p = str(v.get("part") or "")
        if p and p not in parts:
            parts.append(p)
    first = hits[0] if hits else None
    out = {
        "title": title, "amended": amended, "count": len(hits), "kind": kind,
        "removed": sum(1 for v in hits if v.get("removed")),
        "parts": parts,
        "first": None if not first else {"id": first.get("identifier"), "name": _clean(first.get("name", ""))},
    }
    with _cache_lock:
        if len(_changes) >= 64:
            _changes.pop(next(iter(_changes)))
        _changes[key] = out
    return out


def wire(limit: int = 5) -> list[dict]:
    """The `limit` most recently amended titles, newest first, each with `changes()`; a title
    whose change list can't be fetched still lists, with `count` None."""
    live = [t for t in lib.ecfr_titles() if not t.get("reserved") and t.get("latest_amended_on")]
    live.sort(key=lambda t: (t["latest_amended_on"], -t["number"]), reverse=True)
    top = live[:limit]

    def one(t: dict) -> dict:
        try:
            return lib.changes(t["number"], t["latest_amended_on"])
        except (httpx.HTTPError, ValueError, KeyError):
            return {"title": t["number"], "amended": t["latest_amended_on"], "count": None, "kind": None, "parts": [], "first": None}

    with ThreadPoolExecutor(max_workers=min(5, len(top) or 1)) as ex:
        return list(ex.map(one, top))


def _leaves(node: dict) -> list[dict]:
    if node["t"] in build.LEAF_TYPES:
        return [node]
    return [leaf for c in node.get("c", []) for leaf in _leaves(c)]


def title_view(title: int) -> dict:
    """Every part of a title, under its chapter (or subtitle) label, with install state."""
    info = lib.ecfr_title(title)
    inst = lib.installed(title)
    scope = inst["scope"] if inst else None
    whole = inst is not None and scope is None
    parts_in = set(scope["parts"]) if scope else set()
    sections_by_part: dict[str, int] = {}
    for s in (scope or {}).get("sections", []):
        sections_by_part[s["part"]] = sections_by_part.get(s["part"], 0) + 1

    groups: list[dict] = []

    def walk(node: dict, label: str | None) -> None:
        if node["t"] in ("subtitle", "chapter"):
            d = (node.get("d") or "").strip()
            label = f'{node.get("l") or ""}{" — " + d if d else ""}'.strip() or label
        if node["t"] == "part":
            if not groups or groups[-1]["label"] != label:
                groups.append({"label": label, "parts": []})
            pid = str(node["id"])
            # `leaves` counts what can be downloaded: reserved sections have no text.
            leaves = sum(1 for leaf in _leaves(node) if not leaf.get("r"))
            have = sections_by_part.get(pid, 0)
            state = "all" if whole or pid in parts_in or (leaves and have >= leaves) else ("some" if have else None)
            groups[-1]["parts"].append({
                "id": pid, "l": node.get("l") or f"Part {pid}", "d": (node.get("d") or "").strip(),
                "r": bool(node.get("r")), "leaves": leaves,
                "installed": state, "installed_sections": sections_by_part.get(pid, 0),
            })
            return
        for c in node.get("c", []):
            walk(c, label)

    walk(lib.structure(title), None)
    return {
        "title": title, "name": info.get("name"), "latest": info.get("up_to_date_as_of"),
        "reserved": bool(info.get("reserved")), "installed": lib._install_summary(inst, title), "groups": groups,
    }


def _find_part(node: dict, part: str) -> dict | None:
    if node["t"] == "part" and str(node["id"]) == part:
        return node
    for c in node.get("c", []):
        found = _find_part(c, part)
        if found:
            return found
    return None


def part_view(title: int, part: str) -> dict:
    """A part's sections and appendices (under subpart labels), with install state."""
    node = _find_part(lib.structure(title), part)
    if node is None:
        raise LookupError(f"No Part {part} in Title {title}")
    inst = lib.installed(title)
    scope = inst["scope"] if inst else None
    whole_part = inst is not None and (scope is None or part in scope["parts"])
    have = {(s["t"], s["id"]) for s in (scope or {}).get("sections", [])}

    groups: list[dict] = []

    def walk(n: dict, label: str | None) -> None:
        if n["t"] in build.LEAF_TYPES:
            if not groups or groups[-1]["label"] != label:
                groups.append({"label": label, "sections": []})
            groups[-1]["sections"].append({
                "t": n["t"], "id": str(n["id"]), "l": n.get("l") or "", "d": (n.get("d") or "").strip(),
                "r": bool(n.get("r")), "installed": whole_part or (n["t"], str(n["id"])) in have,
            })
            return
        if n["t"] in ("subpart", "subject_group") and n is not node:
            d = (n.get("d") or "").strip()
            label = f'{n.get("l") or ""}{" — " + d if d else ""}'.strip()
        for c in n.get("c", []):
            walk(c, label)

    walk(node, None)
    real = [s for g in groups for s in g["sections"] if not s["r"]]
    have_n = sum(1 for s in real if s["installed"])
    # Every downloadable section already in counts as the whole part.
    state = "all" if whole_part or (real and have_n == len(real)) else ("some" if have_n else None)
    return {
        "title": title, "part": part, "l": node.get("l") or f"Part {part}", "d": (node.get("d") or "").strip(),
        "installed": state, "groups": groups,
    }
