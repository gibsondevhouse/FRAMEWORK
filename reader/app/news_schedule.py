"""When each news source is stale, due, and how far back to fetch.

Pure functions: no I/O, no clock reads — `now` is always passed in (aware datetimes).
The publication schedule was verified live on 2026-11-16 (REFETCH_CADENCE_RESEARCH.md):
the Federal Register's daily issue is up by 06:00 ET on business days, Public Inspection
posts regular filings at 08:45 ET and special filings at 11:15 and 16:15 ET, and the DOL
OSHA datasets refresh daily at an unpublished hour.

Weekends are skipped. Federal holidays are not: polling on a holiday costs one small
request, while a wrong holiday table would skip real publications.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
WINDOWS = {                                   # ET wall-clock times, Mon-Fri
    "federal_register": (time(6, 15),),
    "federal_register_pi": (time(9, 0), time(11, 30), time(16, 30)),
}
DAILY_SOURCES = {"dol_osha": timedelta(hours=24)}
BACKOFF = (timedelta(minutes=5), timedelta(minutes=15), timedelta(hours=1), timedelta(hours=6))


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def latest_window(source: str, now: datetime) -> datetime | None:
    """The most recent window at or before `now` (aware), walking back over weekends."""
    local = _aware(now).astimezone(ET)
    for back in range(0, 8):
        day = (local - timedelta(days=back)).date()
        if day.weekday() >= 5:
            continue
        for t in sorted(WINDOWS[source], reverse=True):
            w = datetime.combine(day, t, ET)
            if w <= local:
                return w
    return None


def next_window(source: str, after: datetime) -> datetime:
    """The first window strictly after `after` (for status display)."""
    local = _aware(after).astimezone(ET)
    for forward in range(0, 8):
        day = (local + timedelta(days=forward)).date()
        if day.weekday() >= 5:
            continue
        for t in sorted(WINDOWS[source]):
            w = datetime.combine(day, t, ET)
            if w > local:
                return w
    raise ValueError(f"no window found for {source}")  # unreachable: 8 days always hold a weekday


def is_stale(source: str, last_ok_at: datetime | None, now: datetime) -> bool:
    if last_ok_at is None:
        return True
    ok = _aware(last_ok_at)
    cur = _aware(now)
    if source in DAILY_SOURCES:
        return cur - ok >= DAILY_SOURCES[source]
    w = latest_window(source, cur)
    return w is not None and ok < w


def retry_after(fail_count: int, last_error_at: datetime | None) -> datetime | None:
    """End of the backoff after `fail_count` consecutive failures: 5m, 15m, 1h, then 6h."""
    if not fail_count or last_error_at is None:
        return None
    return _aware(last_error_at) + BACKOFF[min(fail_count, len(BACKOFF)) - 1]


def is_due(source: str, row: dict, now: datetime) -> bool:
    """Stale and not inside a backoff. `row` is the source's sync_status row (parsed datetimes)."""
    cur = _aware(now)
    until = retry_after(row.get("fail_count") or 0, row.get("last_error_at"))
    return is_stale(source, row.get("last_ok_at"), cur) and not (until and cur < until)


def fr_since(last_ok_at: datetime | None, now: datetime, retention_days: int) -> str:
    """FR publication_date lower bound: the gap since the last success (minus 3 days of
    overlap), or the whole retention window on the first sync. ISO date."""
    if last_ok_at is None:
        return (_aware(now).astimezone(ET).date() - timedelta(days=retention_days)).isoformat()
    return (_aware(last_ok_at).astimezone(ET).date() - timedelta(days=3)).isoformat()


def dol_window(last_ok_at: datetime | None, now: datetime) -> tuple[int, int, int]:
    """(lookback_days, row_limit, max_inspections). Normal: 30 days / 1000 rows / 50
    inspections. Catch-up on the first sync or when the last success is over 30 days old:
    90 / 5000 / 150 — the cap rises too, or the wider window would fill entirely from the
    most recent days."""
    if last_ok_at is None or _aware(now) - _aware(last_ok_at) > timedelta(days=30):
        return 90, 5000, 150
    return 30, 1000, 50
