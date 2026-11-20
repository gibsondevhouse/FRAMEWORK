"""Scheduled refreshes for the Constitution, Public Laws and the Unified Agenda.

Called by the news worker on every wake. Each corpus refreshes only when the source registry
has it switched on, it is installed (the first download is always a deliberate choice), its
schedule is "daily" or "weekly", that long has passed since its last good refresh or check
(stored in the corpus's own meta, so restarts don't reset it), and no failure happened in the
last 6 hours.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import selection

PERIODS = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}
RETRY_AFTER_FAILURE = timedelta(hours=6)


def _dt(v: str | None) -> datetime | None:
    try:
        d = datetime.fromisoformat(v) if v else None
    except ValueError:
        return None
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def is_due(schedule: str, meta: dict, now: datetime) -> bool:
    period = PERIODS.get(schedule)
    if period is None:
        return False
    err = _dt(meta.get("last_error_at"))
    if err is not None and meta.get("last_error") and now - err < RETRY_AFTER_FAILURE:
        return False
    stamps = [d for d in (_dt(meta.get(k)) for k in ("last_ok_at", "checked_at", "built_at", "updated_at")) if d]
    return not stamps or now - max(stamps) >= period


def maybe_queue_corpus_updates(now: datetime | None = None) -> list[dict]:
    from .. import agenda, constitution, library as lib, plaw
    now = now or datetime.now(timezone.utc)
    queued = []
    for sid, mod, kind in (("constitution", constitution, "constitution-update"),
                           ("public_laws", plaw, "plaw-update"), ("unified_agenda", agenda, "agenda-update")):
        src = selection.source(sid)
        if not src["enabled"] or not mod.exists() or lib.queue.busy_with(mod.JOB_KEY):
            continue
        if is_due(src["schedule"], mod.status()["meta"], now):
            queued.append(mod.submit(kind))
    return queued
