"""The active source selection: validation, the derived "current setup", and the effective
values the pipelines read.

A selection is `{"version": 1, "sources": {id: {"enabled", "schedule", "scope"}}}`.
`normalize()` coerces anything (a PUT body, an imported template) onto the registry: unknown
sources, unknown scope fields and anything shaped like a key or secret are dropped, values
outside a filter's options fall back to its default. So templates can never carry secrets.

Until someone saves a selection, the effective one is derived from what is on disk and in
`.env` (installed titles, the FR corpus's recorded scope, NEWS_AGENCIES, …), so nothing a
user already has changes behaviour silently. Once saved, the saved selection wins over the
.env fallbacks.
"""
from __future__ import annotations

import json
import re

from .. import config
from . import db, registry

SETTING_KEY = "selection"
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,119}$")
_SECRETISH = re.compile(r"(key|token|secret|password|passwd|credential|auth)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _norm_multi(f: dict, value, default):
    if value == "all" and f.get("allow_all"):
        return "all"
    if value == "installed" and f.get("allow_installed"):
        return "installed"
    if not isinstance(value, list):
        return default
    allowed = {o["value"] for o in f.get("options", []) if not o.get("reserved")}
    out = []
    for v in value:
        if isinstance(v, bool):
            continue
        if isinstance(v, str) and v.strip().isdigit() and any(isinstance(a, int) for a in allowed):
            v = int(v.strip())
        if v in allowed or (f.get("allow_custom") and isinstance(v, str) and _SLUG_RE.fullmatch(v)):
            if v not in out:
                out.append(v)
    return sorted(out) if all(isinstance(v, int) for v in out) else out


def _norm_filter(f: dict, value, default):
    t = f["type"]
    if t == "multi":
        return _norm_multi(f, value, default)
    if t == "toggle":
        return value if isinstance(value, bool) else default
    if t == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            return default
        try:
            n = int(value)
        except (TypeError, ValueError):
            return default
        return max(f["min"], min(f["max"], n))
    if t == "choice":
        return value if value in {o["value"] for o in f.get("options", [])} else default
    return default


def normalize(raw, base: dict | None = None) -> dict:
    """A clean selection. Sources missing from `raw` keep `base`'s entry (default: the
    registry defaults), so a client may PUT just the sources it changes."""
    base = base or registry.default_selection()
    src = raw.get("sources") if isinstance(raw, dict) else None
    src = src if isinstance(src, dict) else {}
    out: dict[str, dict] = {}
    for d in registry.definitions():
        sid = d["id"]
        b = base["sources"].get(sid) or {"enabled": False, "schedule": d["default_schedule"],
                                        "scope": dict(d["default_scope"])}
        r = src.get(sid)
        r = r if isinstance(r, dict) else {}
        enabled = r.get("enabled", b["enabled"])
        enabled = bool(enabled) if isinstance(enabled, bool) else bool(b["enabled"])
        if not d["available"]:
            enabled = False
        schedules = {s["value"] for s in d["schedule_options"]}
        schedule = r.get("schedule", b["schedule"])
        if schedule not in schedules:
            schedule = b["schedule"] if b["schedule"] in schedules else d["default_schedule"]
        r_scope = r.get("scope") if isinstance(r.get("scope"), dict) else {}
        r_scope = {k: v for k, v in r_scope.items() if not _SECRETISH.search(str(k))}
        scope = {}
        for f in d["filters"]:
            fid = f["id"]
            default = b.get("scope", {}).get(fid, d["default_scope"].get(fid))
            scope[fid] = _norm_filter(f, r_scope.get(fid, default), default)
        out[sid] = {"enabled": enabled, "schedule": schedule, "scope": scope}
    return {"version": 1, "sources": out}


# ---------------------------------------------------------------------------
# Current setup (derived) and the saved selection
# ---------------------------------------------------------------------------

def derived() -> dict:
    """What the reader does today with no saved selection: the installed titles, the FR
    corpus's recorded scope (else the registry default: every document), the .env news
    agencies, and the legacy schedules (CFR only updates when asked)."""
    from .. import fr_store, news_store, usc_store
    sel = registry.default_selection()
    s = sel["sources"]
    s["cfr"].update(enabled=True, schedule="manual", scope={"titles": config.installed_titles()})
    s["usc"].update(enabled=True, schedule="daily", scope={"titles": usc_store.installed_titles()})
    fr_scope = dict(s["fr"]["scope"], years=config.fr_corpus_years())
    meta = fr_store.read_meta() if fr_store.exists() else {}
    try:
        titles = json.loads(meta.get("titles") or "[]")
        filters = json.loads(meta.get("filters") or "{}")
    except ValueError:
        titles, filters = [], {}
    if config.fr_corpus_titles():
        fr_scope["cfr_titles"] = config.fr_corpus_titles()
    elif titles and 0 not in titles:
        fr_scope["cfr_titles"] = sorted(titles)
    for k in ("agencies", "doc_types"):
        if filters.get(k):
            fr_scope[k] = filters[k]
    s["fr"].update(enabled=True, schedule="auto", scope=fr_scope)
    s["news"].update(enabled=True, schedule="auto", scope={
        "agencies": config.news_agencies(), "follow_cfr_titles": "installed",
        "public_inspection": True, "retention_days": news_store.retention_days()})
    s["dol_enforcement"].update(enabled=True, schedule="daily")
    return normalize(sel, base=sel)


def saved() -> dict | None:
    raw = db.get_setting(SETTING_KEY)
    return normalize(raw) if isinstance(raw, dict) else None


def current() -> tuple[dict, bool]:
    """(effective selection, whether it was saved by the user)."""
    sel = saved()
    return (sel, True) if sel is not None else (derived(), False)


def save(raw) -> dict:
    base, _ = current()
    sel = normalize(raw, base=base)
    db.set_setting(SETTING_KEY, sel)
    return sel


def reset() -> None:
    db.delete_setting(SETTING_KEY)


# ---------------------------------------------------------------------------
# Effective values for the pipelines
# ---------------------------------------------------------------------------

def source(sid: str) -> dict:
    return current()[0]["sources"][sid]


def enabled(sid: str) -> bool:
    return bool(source(sid)["enabled"])


def schedule(sid: str) -> str:
    return source(sid)["schedule"]


def resolve_titles(value, installed: list[int]) -> list[int] | str:
    """'all' stays 'all'; 'installed' becomes the installed list; a list stays a list."""
    if value == "installed":
        return list(installed)
    return value


def cfr_titles_of(sel: dict) -> list[int]:
    """A selection's CFR titles as numbers ('all' = every non-reserved title)."""
    v = sel["sources"]["cfr"]["scope"].get("titles", [])
    return [n for n in range(1, 51) if n != 35] if v == "all" else list(v)


def usc_titles_of(sel: dict) -> list[int]:
    from .. import usc_client
    v = sel["sources"]["usc"]["scope"].get("titles", [])
    if v == "all":
        return [n for n in usc_client.ALL_TITLES if n not in usc_client.RESERVED]
    return list(v)


def cfr_titles() -> list[int]:
    return cfr_titles_of(current()[0])


def usc_titles() -> list[int]:
    return usc_titles_of(current()[0])


def fr_corpus_scope() -> dict:
    """{"titles": [0] (= every document) | [N…], "filters": {agencies, doc_types}, "years"}.
    FR_CORPUS_TITLES in .env still narrows the titles when no selection is saved."""
    sel, is_saved = current()
    sc = sel["sources"]["fr"]["scope"]
    cfr = resolve_titles(sc.get("cfr_titles", "all"), config.installed_titles())
    if not is_saved and config.fr_corpus_titles():
        cfr = config.fr_corpus_titles()
    titles = [0] if cfr == "all" else sorted(set(cfr))
    filters = {k: sc[k] for k in ("agencies", "doc_types") if sc.get(k) not in (None, "all", [])}
    return {"titles": titles, "filters": filters, "years": sc.get("years") or config.fr_corpus_years()}


def news_agencies() -> list[str] | None:
    """FR agency slugs the news feed follows; None = every agency."""
    v = source("news")["scope"].get("agencies", "all")
    return None if v == "all" else list(v)


def news_follow_titles() -> list[int]:
    v = source("news")["scope"].get("follow_cfr_titles", [])
    return list(resolve_titles(v, config.installed_titles())) if v != "all" else []


def news_public_inspection() -> bool:
    return bool(source("news")["scope"].get("public_inspection", True))
