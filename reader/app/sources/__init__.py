"""The federal source registry (`registry`), the active selection (`selection`), built-in
presets (`presets`), saved templates (`db`), preview/apply (`plan`) and status (`status`).

One person per install: the selection and templates live in `data/sources.sqlite3` and move
between installs only as an exported JSON file. Templates never contain keys or secrets:
every selection is normalized against the registry before it is stored or exported.
"""
from __future__ import annotations

from . import db, plan, presets, registry, selection, status

EXPORT_FORMAT = "framework-source-templates"
EXPORT_VERSION = 1
NAME_MAX = 80
DESC_MAX = 300


def catalog(check: bool = False) -> dict:
    """GET /api/sources: every source with its declaration and status, the effective
    selection, and the category order."""
    if check:
        status.run_integrity()
    sel, is_saved = selection.current()
    sources = []
    for d in registry.definitions():
        s = sel["sources"][d["id"]]
        sources.append({**d, "enabled": s["enabled"], "schedule": s["schedule"], "scope": s["scope"],
                        "status": status.for_source(d["id"])})
    return {"categories": list(registry.CATEGORIES), "sources": sources, "selection": sel, "saved": is_saved,
            "default_preset": next((p["id"] for p in presets.presets() if p.get("default")), None)}


def clean_name(name, fallback: str | None = None) -> str:
    n = " ".join(str(name or "").split())[:NAME_MAX]
    if not n:
        if fallback is None:
            raise ValueError("A template needs a name.")
        return fallback
    return n


def clean_desc(desc) -> str:
    return " ".join(str(desc or "").split())[:DESC_MAX]


def all_templates() -> list[dict]:
    return presets.presets() + db.list_templates()


def get_template(tid: str) -> dict | None:
    if tid.startswith(presets.PRESET_PREFIX):
        return presets.get(tid)
    return db.get_template(tid)


def create_template(name, description, sel) -> dict:
    return db.create_template(clean_name(name), clean_desc(description),
                              selection.normalize(sel if isinstance(sel, dict) else selection.current()[0]))


def update_template(tid: str, name=None, description=None, sel=None) -> dict | None:
    return db.update_template(tid, clean_name(name) if name is not None else None,
                              clean_desc(description) if description is not None else None,
                              selection.normalize(sel) if isinstance(sel, dict) else None)


def export_templates(ids: list[str] | None = None) -> dict:
    rows = [t for t in db.list_templates() if ids is None or t["id"] in ids]
    return {"format": EXPORT_FORMAT, "version": EXPORT_VERSION,
            "templates": [{"name": t["name"], "description": t["description"],
                           "selection": selection.normalize(t["selection"]), "created_at": t["created_at"]}
                          for t in rows]}


def import_templates(payload) -> dict:
    """Add every template in an export file as a new saved template (names that already
    exist get " (imported)"). Each selection is normalized, which strips anything that isn't
    a declared filter, so keys or secrets in the file never get stored."""
    if not isinstance(payload, dict) or payload.get("format") != EXPORT_FORMAT:
        raise ValueError("That file isn't a FRAMEWORK source template export.")
    items = payload.get("templates")
    if not isinstance(items, list):
        raise ValueError("The file has no templates.")
    existing = {t["name"] for t in all_templates()}
    added = []
    for it in items[:200]:
        if not isinstance(it, dict) or not isinstance(it.get("selection"), dict):
            continue
        name = clean_name(it.get("name"), fallback="Imported template")
        base, i = name[:NAME_MAX - 16], 1
        while name in existing:
            name = f"{base} (imported)" if i == 1 else f"{base} (imported {i})"
            i += 1
        existing.add(name)
        added.append(db.create_template(name, clean_desc(it.get("description")), selection.normalize(it["selection"])))
    return {"imported": added, "count": len(added)}
