"""Preview and apply a selection: a size/time estimate, a plain-English summary, then jobs.

`preview(target)` never writes and never touches the network. `apply(target, confirm)`
saves the selection and queues installs through the library queue, but when the plan is
large (or deletes anything) it returns the preview with `needs_confirm: True` and does
nothing until it is called again with `confirm=True`.

Unchecking a source or a title only stops its updates; its data stays on disk. Data is
deleted only when `remove_unselected=True` is passed explicitly (and confirmed).
"""
from __future__ import annotations

import json

from .. import config
from . import registry, selection

LARGE_BYTES = 50 * registry.MB
LARGE_SECONDS = 120
SOURCE_SHORT = {"cfr": "CFR", "usc": "U.S. Code", "fr": "Federal Register archive", "news": "news feed",
                "dol_enforcement": "DOL enforcement records"}


def _human_bytes(n: int) -> str:
    if n >= 1024 * registry.MB:
        return f"{n / (1024 * registry.MB):.1f} GB"
    if n >= registry.MB:
        return f"{round(n / registry.MB)} MB"
    return f"{max(1, round(n / 1024))} KB" if n else "0 MB"


def _human_time(s: int) -> str:
    if s < 90:
        return "under 2 minutes"
    if s < 3600:
        return f"about {round(s / 60)} minutes"
    return f"about {s / 3600:.1f} hours"


def _titles(n: int, what: str) -> str:
    return f"{n} {what} title{'s' if n != 1 else ''}"


def _fr_state() -> dict | None:
    from .. import fr_store
    if not fr_store.exists():
        return None
    meta = fr_store.read_meta()
    try:
        titles = sorted(json.loads(meta.get("titles") or "[]"))
        filters = json.loads(meta.get("filters") or "{}")
    except ValueError:
        titles, filters = [], {}
    return {"titles": titles or [0], "filters": filters, "window_start": meta.get("window_start"),
            "bytes": fr_store.db_path().stat().st_size if fr_store.db_path().exists() else 0}


def _fr_target(sel: dict) -> dict:
    sc = sel["sources"]["fr"]["scope"]
    cfr = selection.resolve_titles(sc.get("cfr_titles", "all"), config.installed_titles())
    return {"titles": [0] if cfr == "all" else sorted(set(cfr)),
            "filters": {k: sc[k] for k in ("agencies", "doc_types") if sc.get(k) not in (None, "all", [])},
            "years": int(sc.get("years") or 5), "cfr": cfr}


def _fr_scope_label(t: dict) -> str:
    f = t["filters"]
    n = len(f.get("agencies") or [])
    who = "every agency" if "agencies" not in f else f"{n} agenc{'y' if n == 1 else 'ies'}"
    what = "every document" if t["titles"] == [0] else f"documents citing CFR {', '.join(map(str, t['titles']))}"
    return f"{who}, {what}, {t['years']} year{'s' if t['years'] != 1 else ''}"


def preview(raw, remove_unselected: bool = False) -> dict:  # noqa: C901
    from .. import fr_build, library as lib, usc_store
    cur, cur_saved = selection.current()
    target = selection.normalize(raw, base=cur)
    T, C = target["sources"], cur["sources"]
    actions: list[dict] = []
    keeps: list[str] = []

    # CFR
    installed_cfr = {n: lib.installed(n) for n in config.installed_titles()}
    want_cfr = set(selection.cfr_titles_of(target)) if T["cfr"]["enabled"] else set()
    for n in sorted(want_cfr):
        inst = installed_cfr.get(n)
        if inst is None:
            actions.append({"source": "cfr", "action": "install", "target": n, "label": f"Download CFR Title {n}",
                            "estimate": registry.cfr_title_estimate(n)})
        elif inst["scope"] is not None:
            actions.append({"source": "cfr", "action": "complete", "target": n,
                            "label": f"Complete CFR Title {n} (only part of it is on this computer)",
                            "estimate": registry.cfr_title_estimate(n)})
    for n in sorted(set(installed_cfr) - want_cfr):
        if remove_unselected:
            actions.append({"source": "cfr", "action": "remove", "target": n, "label": f"Delete CFR Title {n}",
                            "estimate": None})
        else:
            keeps.append(f"CFR Title {n}")

    # U.S. Code
    installed_usc = set(usc_store.installed_titles())
    want_usc = set(selection.usc_titles_of(target)) if T["usc"]["enabled"] else set()
    for n in sorted(want_usc - installed_usc):
        actions.append({"source": "usc", "action": "install", "target": n, "label": f"Download U.S. Code Title {n}",
                        "estimate": registry.usc_title_estimate(n)})
    for n in sorted(installed_usc - want_usc):
        if remove_unselected:
            actions.append({"source": "usc", "action": "remove", "target": n,
                            "label": f"Delete U.S. Code Title {n}", "estimate": None})
        else:
            keeps.append(f"U.S. Code Title {n}")

    # Federal Register archive
    fr_now = _fr_state()
    fr_want = _fr_target(target)
    if T["fr"]["enabled"]:
        est = registry.fr_estimate(fr_want["years"], T["fr"]["scope"].get("agencies", "all"),
                                   T["fr"]["scope"].get("doc_types", "all"), fr_want["cfr"])
        start = fr_build.default_window(fr_want["years"])[0]
        if fr_now is None:
            actions.append({"source": "fr", "action": "install", "target": fr_want,
                            "label": f"Build the Federal Register archive ({_fr_scope_label(fr_want)})",
                            "estimate": est})
        elif (fr_now["titles"] != fr_want["titles"] or fr_now["filters"] != fr_want["filters"]
              or (fr_now["window_start"] or "9999") > start):
            actions.append({"source": "fr", "action": "rebuild", "target": fr_want,
                            "label": f"Rebuild the Federal Register archive ({_fr_scope_label(fr_want)})",
                            "estimate": est})
    elif fr_now is not None:
        if remove_unselected:
            actions.append({"source": "fr", "action": "remove", "target": None,
                            "label": "Delete the Federal Register archive", "estimate": None})
        else:
            keeps.append("the Federal Register archive")

    # Updates switched on or off, schedules
    changes: list[dict] = []
    for d in registry.definitions():
        sid = d["id"]
        if not d["available"]:
            continue
        a, b = C[sid], T[sid]
        if a["enabled"] and not b["enabled"]:
            changes.append({"source": sid, "change": "stop_updates", "label": f"Stop updating the {d['label']}"})
        elif b["enabled"] and not a["enabled"]:
            changes.append({"source": sid, "change": "start_updates", "label": f"Start updating the {d['label']}"})
        elif b["enabled"] and a["schedule"] != b["schedule"]:
            new = registry.SCHEDULES[b["schedule"]]["label"].lower()
            changes.append({"source": sid, "change": "schedule",
                            "label": f"{d['label']}: refresh {new} (was {registry.SCHEDULES[a['schedule']]['label'].lower()})"})
        elif b["enabled"] and a["scope"] != b["scope"] and sid in ("news", "dol_enforcement"):
            changes.append({"source": sid, "change": "scope", "label": f"{d['label']}: new filters"})
        if b["enabled"] and d["needs_key"] and not d["key_present"]:
            changes.append({"source": sid, "change": "needs_key",
                            "label": f"{d['label']} needs a {d['key_label']} before it can update",
                            "get_key_url": d["get_key_url"]})

    downloads = [a for a in actions if a["estimate"]]
    total_bytes = sum(a["estimate"]["bytes"] for a in downloads)
    total_secs = sum(a["estimate"]["seconds"] for a in downloads)
    removes = [a for a in actions if a["action"] == "remove"]
    needs_confirm = bool(removes) or total_bytes > LARGE_BYTES or total_secs > LARGE_SECONDS

    # One plain-English line.
    parts: list[str] = []
    n_cfr = sum(1 for a in downloads if a["source"] == "cfr")
    n_usc = sum(1 for a in downloads if a["source"] == "usc")
    adds = [x for x in (_titles(n_cfr, "CFR") if n_cfr else "", _titles(n_usc, "U.S. Code") if n_usc else "") if x]
    if adds:
        parts.append("adds " + " and ".join(adds))
    fr_act = next((a for a in actions if a["source"] == "fr" and a["action"] in ("install", "rebuild")), None)
    if fr_act:
        parts.append(("builds" if fr_act["action"] == "install" else "rebuilds") + " the Federal Register archive")
    if downloads:
        parts[-1] += f" (~{_human_bytes(total_bytes)}, {_human_time(total_secs)})"
    for c in changes:
        if c["change"] == "stop_updates":
            parts.append(f"stops {SOURCE_SHORT.get(c['source'], c['source'])} updates")
        elif c["change"] == "start_updates":
            parts.append(f"starts {SOURCE_SHORT.get(c['source'], c['source'])} updates")
    if keeps:
        parts.append(f"keeps {len(keeps)} item{'s' if len(keeps) != 1 else ''} on disk without updates")
    if removes:
        parts.append(f"deletes {len(removes)} item{'s' if len(removes) != 1 else ''}")
    elif parts:
        parts.append("nothing deleted")
    joined = "; ".join(parts) + "."
    summary = joined[0].upper() + joined[1:] if parts else (
        "Only schedules or filters change." if changes else "No changes.")

    return {
        "summary": summary, "needs_confirm": needs_confirm,
        "estimate": {"bytes": total_bytes, "seconds": total_secs, "approximate": True,
                     "bytes_label": _human_bytes(total_bytes), "time_label": _human_time(total_secs) if total_secs else ""},
        "actions": actions, "changes": changes, "keeps": keeps,
        "selection": target, "current_saved": cur_saved,
    }


def apply(raw, confirm: bool = False, remove_unselected: bool = False) -> dict:
    """Save the selection and queue its jobs. Without `confirm`, a large or destructive plan
    is returned unapplied (`applied: False`)."""
    from .. import fr_build, fr_store, library as lib, usc_build
    plan = preview(raw, remove_unselected=remove_unselected)
    if plan["needs_confirm"] and not confirm:
        return {"applied": False, **plan}
    selection.save(plan["selection"])
    queued, removed, skipped = [], [], []
    for a in plan["actions"]:
        src, act, t = a["source"], a["action"], a["target"]
        try:
            if src == "cfr" and act in ("install", "complete"):
                if lib.queue.busy_with(t):
                    skipped.append({**a, "reason": "already queued"})
                else:
                    queued.append(lib.queue.submit(t, "title", None, f"Title {t}"))
            elif src == "usc" and act == "install":
                if lib.queue.busy_with(usc_build.job_key(t)):
                    skipped.append({**a, "reason": "already queued"})
                else:
                    queued.append(usc_build.submit(t, "usc-title"))
            elif src == "fr" and act in ("install", "rebuild"):
                if lib.queue.busy_with(fr_build.FR_JOB_TITLE):
                    skipped.append({**a, "reason": "already queued"})
                else:
                    queued.append(fr_build.submit("fr-build", {"titles": t["titles"], "years": t["years"],
                                                               "filters": t["filters"]}))
            elif act == "remove":
                if src == "cfr":
                    if lib.queue.busy_with(t):
                        skipped.append({**a, "reason": "a download for it is running"})
                        continue
                    with lib.queue.operation_lock():
                        lib.remove(t)
                elif src == "usc":
                    if lib.queue.busy_with(usc_build.job_key(t)):
                        skipped.append({**a, "reason": "a download for it is running"})
                        continue
                    usc_build.remove(t)
                elif src == "fr":
                    if lib.queue.busy_with(fr_build.FR_JOB_TITLE):
                        skipped.append({**a, "reason": "a Federal Register job is running"})
                        continue
                    with fr_store.WRITE_LOCK:
                        fr_store.db_path().unlink(missing_ok=True)
                removed.append(a)
        except (OSError, ValueError) as exc:
            skipped.append({**a, "reason": str(exc)})
    return {"applied": True, **plan, "queued": queued, "removed": removed, "skipped": skipped}
