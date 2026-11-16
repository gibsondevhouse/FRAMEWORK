"""Structure-tree utilities: trimming and re-nesting eCFR's structure JSON, install
scopes, pruning partial builds, and in-place re-nesting of an installed title.

`renest` takes `log` as an injected parameter (build.py passes its own patchable
`build.log`) so this module never imports build, avoiding a circular import.
"""
from __future__ import annotations

import json
import re
import sqlite3

from .. import config

LEAF_TYPES = {"section", "appendix"}

def trim_tree(node: dict) -> dict:
    out = {
        "t": node["type"],
        "id": node.get("identifier"),
        "l": node.get("label_level") or node.get("label") or "",
        "d": (node.get("label_description") or "").strip(),
    }
    if node.get("reserved"):
        out["r"] = 1
    if node.get("descendant_range"):
        out["range"] = node["descendant_range"]
    kids = [trim_tree(c) for c in node.get("children") or []]
    if kids:
        out["c"] = kids
    return out


def nest_loose_sections(node: dict) -> dict:
    """eCFR's structure sometimes lists a subpart as an empty heading followed by its sections
    as siblings (29 CFR 1910 Subpart Z, Part 2520 Subparts D-F, 49 CFR 1201 Subpart B).
    Move those sections inside the subpart. An appendix is adopted only when its title names
    that subpart ("Appendix A to Subpart F of Part 2520"); "Appendix I to Part 1201" belongs
    to the part. Mutates and returns `node`."""
    kids = node.get("c")
    if not kids:
        return node
    out: list[dict] = []
    holder: dict | None = None   # the subpart just passed
    holder_was_empty = False     # only an empty heading adopts the plain sections after it
    for c in kids:
        if holder is not None and ((holder_was_empty and c["t"] == "section") or _appendix_of(c, holder)):
            holder.setdefault("c", []).append(c)
            continue
        if c["t"] == "subpart" and not c.get("r"):
            holder, holder_was_empty = c, not c.get("c")
        else:
            holder = None
        out.append(nest_loose_sections(c))
    node["c"] = out
    return node


def _appendix_of(node: dict, subpart: dict) -> bool:
    if node["t"] != "appendix":
        return False
    m = re.search(r"\bto Subpart\s+([A-Z0-9-]+)\b", f'{node.get("id") or ""} {node.get("l") or ""}')
    return bool(m) and m.group(1) == str(subpart.get("id"))


def normalize_scope(scope: dict | None) -> dict | None:
    """A partial install is {"parts": [ids], "sections": [{"t", "id", "part"}]}; None is the
    whole title. Sections inside a selected part are dropped (the part already holds them),
    duplicates collapse, and the lists are sorted so equal scopes compare equal."""
    if scope is None:
        return None
    parts = sorted({str(p) for p in scope.get("parts") or []})
    seen: dict[tuple[str, str], dict] = {}
    for s in scope.get("sections") or []:
        t, sid, part = s.get("t", "section"), str(s["id"]), str(s.get("part") or "")
        if t not in LEAF_TYPES or part in parts:
            continue
        seen[(t, sid)] = {"t": t, "id": sid, "part": part}
    return {"parts": parts, "sections": [seen[k] for k in sorted(seen)]}


def merge_scope(current: dict | None, add: dict | None) -> dict | None:
    """Union of two scopes; either being the whole title (None) makes the whole title."""
    if current is None or add is None:
        return None
    return normalize_scope({
        "parts": [*current.get("parts", []), *add.get("parts", [])],
        "sections": [*current.get("sections", []), *add.get("sections", [])],
    })


def prune_tree(tree: dict, scope: dict) -> dict:
    """Keep only the selected parts (whole) and sections (with their ancestors)."""
    parts = set(scope.get("parts") or [])
    leaves = {(s["t"], s["id"]) for s in scope.get("sections") or []}

    def keep(node: dict) -> dict | None:
        if node["t"] == "part" and str(node["id"]) in parts:
            return node
        if node["t"] in LEAF_TYPES:
            return node if (node["t"], str(node["id"])) in leaves else None
        kids = [k for k in (keep(c) for c in node.get("c", [])) if k is not None]
        if not kids:
            return None
        out = {k: v for k, v in node.items() if k != "c"}
        out["c"] = kids
        return out

    return keep(tree) or {k: v for k, v in tree.items() if k != "c"}


def count_leaves(node: dict) -> int:
    if node["t"] in LEAF_TYPES:
        return 1
    return sum(count_leaves(c) for c in node.get("c", []))


def _crumb(node: dict) -> dict:
    return {"t": node["t"], "id": node["id"], "l": node["l"], "d": node["d"]}


def leaf_paths(tree: dict) -> list[tuple[str, str]]:
    """(path JSON, id) for every leaf: the breadcrumb stored in sections.path."""
    out: list[tuple[str, str]] = []

    def walk(node: dict, ancestors: list[dict]) -> None:
        if node["t"] in LEAF_TYPES:
            out.append((json.dumps(ancestors), node["id"]))
            return
        nxt = ancestors + [_crumb(node)] if node["t"] != "title" else ancestors
        for child in node.get("c", []):
            walk(child, nxt)

    walk(tree, [])
    return out


def renest(title: int, log=None) -> int:
    """Apply `nest_loose_sections` to an installed title without downloading: rewrite its
    tree JSON and the breadcrumbs in its database. Returns the number of breadcrumbs changed."""
    log = log or (lambda msg: None)
    tree_file = config.tree_path(title)
    db_file = config.db_path(title)
    if not tree_file.exists() or not db_file.exists():
        raise ValueError(f"Title {title} is not installed")
    tree = nest_loose_sections(json.loads(tree_file.read_text(encoding="utf-8")))
    con = sqlite3.connect(db_file)
    current = dict(con.execute("SELECT id, path FROM sections"))
    changed = [(p, i) for p, i in leaf_paths(tree) if current.get(i) not in (None, p)]
    con.executemany("UPDATE sections SET path = ? WHERE id = ?", changed)
    con.commit()
    con.close()
    payload = json.dumps(tree, separators=(",", ":"))
    tree_file.write_text(payload, encoding="utf-8")
    legacy = config.DATA_DIR / "tree.json"
    if title == 29 and legacy.exists() and legacy != tree_file:
        legacy.write_text(payload, encoding="utf-8")
    log(f"Title {title}: re-nested contents, {len(changed)} section breadcrumbs updated")
    return len(changed)
