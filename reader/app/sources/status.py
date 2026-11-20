"""Per-source status for GET /api/sources: what is on disk, when it last refreshed, any
running job, and the last integrity result (run on demand with `?check=true`; offline only,
never a network request)."""
from __future__ import annotations

import threading

from .. import config

_integrity: dict[str, dict] = {}
_integrity_lock = threading.Lock()
CORPUS_OF = {"cfr": "cfr", "usc": "usc", "fr": "fr", "constitution": "constitution", "public_laws": "plaw",
             "unified_agenda": "agenda"}


def _size(path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def run_integrity() -> None:
    """Offline integrity check of the three corpora, cached for the status payload."""
    from .. import integrity
    for corpus in CORPUS_OF.values():
        try:
            rep = integrity.run(corpus=corpus, online=False)
            res = {"status": rep["status"], "summary": rep["summary"], "checked_at": rep["checked_at"],
                   "problems": [i for i in rep["items"] if i["status"] in ("FAIL", "WARN")][:10]}
        except Exception as exc:  # report, never fail the status page
            res = {"status": "FAIL", "summary": {}, "checked_at": None,
                   "problems": [{"detail": f"integrity check failed: {exc}"}]}
        with _integrity_lock:
            _integrity[corpus] = res


def integrity_for(sid: str) -> dict | None:
    corpus = CORPUS_OF.get(sid)
    with _integrity_lock:
        return dict(_integrity[corpus]) if corpus in _integrity else None


def clear_integrity() -> None:
    with _integrity_lock:
        _integrity.clear()


def _jobs(keys: set[int] | None = None, kinds: tuple[str, ...] = ()) -> list[dict]:
    from .. import library as lib
    snap = lib.queue.snapshot()
    active = ([snap["current"]] if snap["current"] else []) + snap["queued"]
    return [{"id": j["id"], "label": j["label"], "state": j["state"], "phase": j["phase"]}
            for j in active
            if (keys is not None and j["title"] in keys and not j["kind"].startswith(("fr-", "usc-")))
            or (kinds and j["kind"] in kinds)]


def cfr() -> dict:
    from .. import library as lib, store
    rows, total = [], 0
    for n in config.installed_titles():
        inst = lib.installed(n)
        b = _size(config.db_path(n)) + _size(config.tree_path(n))
        total += b
        m, _ = store.safe_meta(n)
        rows.append({"title": n, "edition": (inst or {}).get("edition"), "whole": bool(inst and inst["scope"] is None),
                     "readable": inst is not None, "bytes": b, "built_at": m.get("built_at")})
    built = [r["built_at"] for r in rows if r["built_at"]]
    return {"installed": bool(rows), "items": rows, "bytes": total, "last_refresh": max(built) if built else None,
            "jobs": _jobs(keys=set(range(1, 51)))}


def usc() -> dict:
    from .. import usc_build, usc_store
    rows = []
    for n in usc_store.installed_titles():
        s = usc_store.title_summary(n) or {}
        rows.append({"title": n, "release_point": s.get("release_point"), "built_at": s.get("built_at"),
                     "bytes": usc_build.title_bytes(n)})
    built = [r["built_at"] for r in rows if r["built_at"]]
    return {"installed": bool(rows), "items": rows, "bytes": sum(r["bytes"] for r in rows),
            "last_refresh": max(built) if built else None, "jobs": _jobs(kinds=("usc-title", "usc-update"))}


def fr() -> dict:
    from .. import fr_build, fr_store
    st = fr_store.status()
    meta = st.get("meta") or {}
    return {"installed": st["installed"], "documents": st["doc_count"], "bytes": _size(fr_store.db_path()),
            "last_refresh": meta.get("last_ok_at") or None, "window_start": meta.get("window_start") or None,
            "window_end": meta.get("window_end") or None, "last_error": meta.get("last_error") or None,
            "pending_build": fr_build.pending_build(), "jobs": _jobs(kinds=("fr-build", "fr-update"))}


def _news_row(source: str) -> dict:
    from .. import news_store
    r = news_store.sync_rows().get(source) or {}
    ok, err = r.get("last_ok_at"), r.get("last_error_at")
    return {"last_refresh": ok.isoformat() if ok else None, "last_error": r.get("last_error") or None,
            "last_error_at": err.isoformat() if err else None}


def news() -> dict:
    from .. import news_store
    fr, pi = _news_row("federal_register"), _news_row("federal_register_pi")
    return {"installed": news_store.db_path().exists(), "bytes": _size(news_store.db_path()),
            "last_refresh": fr["last_refresh"], "last_error": fr["last_error"] or pi["last_error"],
            "public_inspection_last_refresh": pi["last_refresh"], "jobs": []}


def dol() -> dict:
    row = _news_row("dol_osha")
    return {"installed": row["last_refresh"] is not None, "bytes": None, **row, "jobs": []}


def constitution() -> dict:
    from .. import constitution as k
    st = k.status()
    m = st["meta"]
    return {"installed": st["installed"], "bytes": _size(k.db_path()), "units": st["unit_count"],
            "annotations": st["note_count"], "edition": m.get("edition"), "last_refresh": m.get("built_at"),
            "jobs": _jobs(kinds=k.JOB_KINDS)}


def public_laws() -> dict:
    from .. import plaw
    st = plaw.status()
    m = st["meta"]
    return {"installed": st["installed"], "bytes": _size(plaw.db_path()), "laws": st["law_count"],
            "usc_links": st["usc_link_count"], "congresses": sorted({r["congress"] for r in st["congresses"]}),
            "last_refresh": m.get("last_ok_at"), "last_error": m.get("last_error") or None,
            "pending_build": plaw.pending_build(), "jobs": _jobs(kinds=plaw.JOB_KINDS)}


def unified_agenda() -> dict:
    from .. import agenda
    st = agenda.status()
    m = st["meta"]
    return {"installed": st["installed"], "bytes": _size(agenda.db_path()), "entries": st["entry_count"],
            "editions": [e["edition"] for e in st["editions"]], "last_refresh": m.get("last_ok_at"),
            "last_error": m.get("last_error") or None, "pending_build": agenda.pending_build(),
            "jobs": _jobs(kinds=agenda.JOB_KINDS)}


def for_source(sid: str) -> dict:
    fn = {"cfr": cfr, "usc": usc, "fr": fr, "news": news, "dol_enforcement": dol, "constitution": constitution,
          "public_laws": public_laws, "unified_agenda": unified_agenda}.get(sid)
    st = fn() if fn else {"installed": False, "bytes": None, "last_refresh": None, "jobs": []}
    st["integrity"] = integrity_for(sid)
    return st
