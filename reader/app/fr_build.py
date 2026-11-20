"""Build and refresh the Federal Register corpus (`data/fr.sqlite3`).

Follows the CFR pattern in `build.py`: a full build writes `fr.sqlite3.tmp` and replaces
the live file atomically only once it is complete; incremental updates upsert into the
live file one committed chunk at a time (re-running a chunk is idempotent, so an
interrupted update just resumes from the last recorded window).

Scope: documents whose `cfr_references` cite one of the corpus titles
(`conditions[cfr][title]=N`), published within the last `FR_CORPUS_YEARS` years
(default 5). The titles default to the installed CFR titles (`FR_CORPUS_TITLES`
overrides). Each (title, month) is one query; when the API reports the 10,000-result
ceiling the range is split in half until it fits.

Full text is not downloaded during a build (tens of thousands of requests); `fetch_body`
pulls one document's XML on demand and stores it with its SHA-256.

    python -m app.fr_build                     # build if missing, else update
    python -m app.fr_build --titles 29,40      # build for these CFR titles
    python -m app.fr_build --years 1 --force   # rebuild a 1-year window from scratch
    python -m app.fr_build --since 2026-11-01 --until 2026-11-18 --titles 29 --force
    python -m app.fr_build --update            # incremental refresh only
    python -m app.fr_build --body 2026-22306   # fetch and store one document's full text

TODO(govinfo): cross-check `raw_sha256`/page ranges against GovInfo's FR package
metadata once an api.data.gov key is configured (`verify_against_govinfo` below).
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from contextlib import closing
from datetime import date, datetime, timedelta, timezone

from . import config, fr_client, fr_store, news_schedule as sched

FR_JOB_TITLE = 0                      # library queue key for corpus jobs (no CFR title 0)
FR_JOB_KINDS = ("fr-build", "fr-update")
UPDATE_OVERLAP_DAYS = 3               # re-read the last few days: late corrections land there
SCHEDULE_SOURCE = "federal_register"  # the 06:15 ET Mon-Fri window in news_schedule

_noop = lambda phase, done=None, total=None: None  # noqa: E731


def log(msg: str) -> None:
    from . import build
    build.log(f"[fr] {msg}")


# ---------------------------------------------------------------------------
# Windows and chunking (pure)
# ---------------------------------------------------------------------------

def today_et(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(sched.ET).date()


def default_window(years: int | None = None, today: date | None = None) -> tuple[str, str]:
    """(since, until) ISO dates: `years` back from `today` (ET), inclusive."""
    today = today or today_et()
    years = years or config.fr_corpus_years()
    try:
        since = today.replace(year=today.year - years)
    except ValueError:                # Feb 29
        since = today.replace(year=today.year - years, day=28)
    return since.isoformat(), today.isoformat()


def default_titles() -> list[int]:
    return config.fr_corpus_titles() or config.installed_titles()


def month_chunks(since: str, until: str) -> list[tuple[str, str]]:
    """Split [since, until] into calendar-month ranges (inclusive ISO dates)."""
    start, end = date.fromisoformat(since), date.fromisoformat(until)
    out: list[tuple[str, str]] = []
    cur = start
    while cur <= end:
        nxt = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        stop = min(end, nxt - timedelta(days=1))
        out.append((cur.isoformat(), stop.isoformat()))
        cur = stop + timedelta(days=1)
    return out


def split_range(start: str, end: str) -> tuple[tuple[str, str], tuple[str, str]] | None:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if a >= b:
        return None
    mid = a + (b - a) // 2
    return (a.isoformat(), mid.isoformat()), ((mid + timedelta(days=1)).isoformat(), b.isoformat())


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

def query_params(title: int, start: str, end: str) -> list[tuple[str, str]]:
    return [
        ("conditions[cfr][title]", str(int(title))),
        ("conditions[publication_date][gte]", start),
        ("conditions[publication_date][lte]", end),
        ("order", "oldest"),
        ("per_page", str(fr_client.MAX_PER_PAGE)),
    ]


def fetch_range(c, title: int, start: str, end: str) -> list[tuple[list[dict], str, str, str]]:
    """Every document citing `title` published in [start, end], as
    [(docs, source_url, start, end)] — one entry per sub-range actually fetched. A range
    whose count reaches the API's 10,000 ceiling is split in half and re-queried."""
    max_pages = -(-fr_client.RESULT_CAP // fr_client.MAX_PER_PAGE)
    docs, count, urls = fr_client.paginate(c, query_params(title, start, end), fr_client.CORPUS_FIELDS, max_pages)
    if count >= fr_client.RESULT_CAP:
        halves = split_range(start, end)
        if halves is not None:
            out = []
            for s, e in halves:
                out += fetch_range(c, title, s, e)
            return out
        log(f"warning: Title {title} on {start} reports {count}+ documents; kept the first {len(docs)}")
    return [(docs, urls[0] if urls else fr_client.documents_url(), start, end)]


def _ingest_ranges(con, titles: list[int], ranges: dict[int, list[tuple[str, str]]], report) -> dict[str, int]:
    """Fetch each (title, chunk) and upsert it, committing per chunk."""
    totals = {"inserted": 0, "changed": 0, "unchanged": 0, "skipped": 0, "requests": 0}
    steps = sum(len(ranges[t]) for t in titles)
    done = 0
    report("Fetching Federal Register", 0, steps)
    with fr_client.client() as c:
        for t in titles:
            for start, end in ranges[t]:
                for docs, src, s, e in fetch_range(c, t, start, end):
                    fetched_at = fr_store.now_iso()
                    counts = fr_store.upsert_documents(con, docs, src, fetched_at)
                    for k, v in counts.items():
                        totals[k] += v
                    totals["requests"] += 1
                    fr_store.record_coverage(con, t, s, e, len(docs), fetched_at)
                con.commit()
                done += 1
                report("Fetching Federal Register", done, steps)
    return totals


# ---------------------------------------------------------------------------
# Build (atomic) and update (in place)
# ---------------------------------------------------------------------------

def build(
    titles: list[int] | None = None,
    since: str | None = None,
    until: str | None = None,
    years: int | None = None,
    force: bool = False,
    progress=None,
) -> dict:
    """Full build into `fr.sqlite3.tmp`, then atomic replace. Without `force`, an existing
    corpus is updated in place instead."""
    report = progress or _noop
    if fr_store.exists() and not force:
        return update(titles=titles, progress=progress)
    titles = sorted(set(titles or default_titles()))
    if not titles:
        raise ValueError("No CFR titles to collect Federal Register documents for. "
                         "Install a title or set FR_CORPUS_TITLES.")
    d_since, d_until = default_window(years)
    since, until = since or d_since, until or d_until
    if since > until:
        raise ValueError(f"Empty window: {since} is after {until}")
    started = time.perf_counter()
    log(f"building corpus for CFR titles {titles}, {since} → {until}")
    tmp = fr_store.tmp_path()
    tmp.unlink(missing_ok=True)
    try:
        con = fr_store.connect(path=tmp)
        with closing(con):
            ranges = {t: month_chunks(since, until) for t in titles}
            totals = _ingest_ranges(con, titles, ranges, report)
            report("Indexing", None, None)
            built = fr_store.now_iso()
            fr_store.set_meta(con, {
                "source": fr_store.SOURCE, "schema": str(fr_store.SCHEMA_VERSION),
                "built_at": built, "updated_at": built, "last_ok_at": built,
                "window_start": since, "window_end": until, "titles": titles,
                "fail_count": "0", "last_error": "", "last_error_at": "",
            })
            fr_store.refresh_counts(con)
            con.commit()
        report("Installing")
        with fr_store.WRITE_LOCK:
            from .build import _replace_with_retry
            _replace_with_retry(tmp, fr_store.db_path())
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    result = {**totals, "titles": titles, "window_start": since, "window_end": until,
              "doc_count": _doc_count(), "elapsed_sec": round(time.perf_counter() - started, 2), "mode": "build"}
    log(f"built: {result['doc_count']} documents in {result['elapsed_sec']}s ({totals['requests']} queries)")
    return result


def update(titles: list[int] | None = None, now: datetime | None = None, progress=None) -> dict:
    """Incremental refresh of an existing corpus: each known title from its last covered
    day minus `UPDATE_OVERLAP_DAYS` to today; a newly added title gets the whole window."""
    report = progress or _noop
    if not fr_store.exists():
        raise ValueError("The Federal Register corpus isn't built yet (python -m app.fr_build).")
    started = time.perf_counter()
    until = today_et(now).isoformat()
    # No WRITE_LOCK here: an update never replaces the file, and each chunk's write
    # transaction is short (the network fetch finishes before it opens).
    with closing(fr_store.connect()) as con:
        meta = fr_store.get_meta(con)
        known = json.loads(meta.get("titles") or "[]")
        titles = sorted(set(titles or known or default_titles()))
        window_start = meta.get("window_start") or default_window(today=date.fromisoformat(until))[0]
        last_end = {r["title"]: r["e"] for r in con.execute("SELECT title, max(end) AS e FROM coverage GROUP BY title")}
        ranges: dict[int, list[tuple[str, str]]] = {}
        for t in titles:
            if t in last_end and last_end[t]:
                s = (date.fromisoformat(last_end[t]) - timedelta(days=UPDATE_OVERLAP_DAYS)).isoformat()
                s = max(s, window_start)
            else:
                s = window_start
            ranges[t] = month_chunks(s, until) if s <= until else []
        totals = _ingest_ranges(con, titles, ranges, report)
        ok = fr_store.now_iso()
        fr_store.set_meta(con, {
            "updated_at": ok, "last_ok_at": ok, "window_end": until,
            "titles": sorted(set(known) | set(titles)),
            "fail_count": "0", "last_error": "", "last_error_at": "",
        })
        fr_store.refresh_counts(con)
        con.commit()
    result = {**totals, "titles": titles, "window_end": until, "doc_count": _doc_count(),
              "elapsed_sec": round(time.perf_counter() - started, 2), "mode": "update"}
    log(f"updated: +{totals['inserted']} new, {totals['changed']} changed, {totals['unchanged']} unchanged")
    return result


def _doc_count() -> int:
    with fr_store.read_con() as con:
        return con.execute("SELECT count(*) FROM documents").fetchone()[0] if con is not None else 0


def record_failure(exc: BaseException) -> None:
    """Remember a failed refresh in meta so the schedule backs off (5m → 15m → 1h → 6h)."""
    if not fr_store.exists():
        return
    try:
        with fr_store.WRITE_LOCK, closing(fr_store.connect()) as con:
            meta = fr_store.get_meta(con)
            fails = int(meta.get("fail_count") or 0) + 1
            fr_store.set_meta(con, {"fail_count": str(fails), "last_error_at": fr_store.now_iso(),
                                    "last_error": str(exc)[:300]})
            con.commit()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Full text on demand
# ---------------------------------------------------------------------------

_WS = re.compile(r"\s+")
_TAG = re.compile(r"<[^>]+>")


def xml_to_text(content: str) -> str:
    try:
        root = ET.fromstring(content)
        return _WS.sub(" ", " ".join(root.itertext())).strip()
    except ET.ParseError:
        return _WS.sub(" ", html.unescape(_TAG.sub(" ", content))).strip()


def fetch_body(document_number: str, c=None) -> dict:
    """Download one document's full text (XML, else body HTML), store it with the SHA-256
    of the bytes as served, and index it. Raises LookupError if the document isn't in the
    corpus, ValueError if it has no full-text URL, `fr_client.SourceUnavailable` on HTTP
    failure."""
    num = (document_number or "").strip()
    if not fr_client.DOC_NUM_RE.fullmatch(num):
        raise ValueError("Invalid Federal Register document number")
    with fr_store.read_con() as con:
        row = con.execute(
            "SELECT full_text_xml_url, body_html_url FROM documents WHERE document_number = ?", (num,)
        ).fetchone() if con is not None else None
    if row is None:
        raise LookupError(num)
    if row["full_text_xml_url"]:
        fmt, url = "xml", row["full_text_xml_url"]
    elif row["body_html_url"]:
        fmt, url = "html", row["body_html_url"]
    else:
        raise ValueError(f"{num} has no full-text URL")
    own = c is None
    c = c or fr_client.client()
    try:
        raw = fr_client.fetch_bytes(c, url)
    finally:
        if own:
            c.close()
    digest = fr_client.sha256_hex(raw)
    decoded = raw.decode("utf-8", errors="replace")
    if fmt == "xml":
        content, text = decoded, xml_to_text(decoded)
    else:
        content = fr_client.sanitize_fr_html(decoded)
        text = _WS.sub(" ", html.unescape(_TAG.sub(" ", content))).strip()
    fetched = fr_store.now_iso()
    with fr_store.WRITE_LOCK, closing(fr_store.connect()) as con:
        fr_store.save_body(con, num, fmt, content, text, digest, len(raw), url, fetched)
        con.commit()
    return {"document_number": num, "format": fmt, "sha256": digest, "byte_len": len(raw),
            "source_url": url, "fetched_at": fetched, "chars": len(text)}


def verify_against_govinfo(document_number: str) -> None:  # pragma: no cover - TODO hook
    """TODO(govinfo): compare a stored document with GovInfo's FR granule metadata
    (needs an api.data.gov key). Intentionally unimplemented."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# Library queue and schedule
# ---------------------------------------------------------------------------

def run_job(job: dict, report) -> None:
    """Entry point for `library.run_job` when `job["kind"]` is an FR kind."""
    target = job.get("target") or {}
    try:
        if job["kind"] == "fr-build":
            build(titles=target.get("titles"), years=target.get("years"), force=True, progress=report)
        elif fr_store.exists():
            update(progress=report)
        else:
            build(progress=report)
    except Exception as exc:
        from .library.jobs import JobCancelled
        if job["kind"] == "fr-update" and not isinstance(exc, JobCancelled):
            record_failure(exc)
        raise


def submit(kind: str, target: dict | None = None) -> dict:
    from . import library as lib
    label = "Build Federal Register corpus" if kind == "fr-build" else "Update Federal Register corpus"
    return lib.queue.submit(FR_JOB_TITLE, kind, target, label)


def schedule_row(meta: dict[str, str]) -> dict:
    def _dt(v: str | None) -> datetime | None:
        try:
            return datetime.fromisoformat(v) if v else None
        except ValueError:
            return None
    return {"last_ok_at": _dt(meta.get("last_ok_at")), "last_error_at": _dt(meta.get("last_error_at")),
            "fail_count": int(meta.get("fail_count") or 0)}


def is_due(now: datetime | None = None, meta: dict[str, str] | None = None) -> bool:
    """True once the day's FR issue is out (06:15 ET Mon-Fri) since the last good refresh,
    outside any failure backoff. Never due before the corpus exists: the first build is
    always a deliberate user action."""
    if meta is None:
        if not fr_store.exists():
            return False
        meta = fr_store.read_meta()
    if not meta:
        return False
    return sched.is_due(SCHEDULE_SOURCE, schedule_row(meta), now or datetime.now(timezone.utc))


def maybe_queue_update(now: datetime | None = None) -> dict | None:
    """Called by the news worker on each wake: queue an update when one is due."""
    from . import library as lib
    if not is_due(now) or lib.queue.busy_with(FR_JOB_TITLE):
        return None
    return submit("fr-update")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_titles(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    out = []
    for tok in raw.split(","):
        tok = tok.strip()
        if not tok.isdigit() or not 1 <= int(tok) <= 50:
            raise argparse.ArgumentTypeError(f"bad CFR title {tok!r}")
        out.append(int(tok))
    return out


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Build or refresh the Federal Register corpus (data/fr.sqlite3).")
    parser.add_argument("--titles", help="comma-separated CFR titles (default: FR_CORPUS_TITLES or installed titles)")
    parser.add_argument("--years", type=int, help="years back from today (default FR_CORPUS_YEARS or 5)")
    parser.add_argument("--since", help="ISO start date (overrides --years)")
    parser.add_argument("--until", help="ISO end date (default today, ET)")
    parser.add_argument("--force", action="store_true", help="rebuild from scratch (atomic replace)")
    parser.add_argument("--update", action="store_true", help="incremental refresh of an existing corpus")
    parser.add_argument("--body", metavar="DOCUMENT_NUMBER", help="fetch and store one document's full text")
    args = parser.parse_args(argv)
    try:
        titles = _parse_titles(args.titles)
        if args.body:
            print(json.dumps(fetch_body(args.body), indent=2))
        elif args.update:
            print(json.dumps(update(titles=titles), indent=2))
        else:
            print(json.dumps(build(titles=titles, since=args.since, until=args.until,
                                   years=args.years, force=args.force), indent=2))
    except (fr_client.SourceUnavailable, ValueError, LookupError, argparse.ArgumentTypeError) as exc:
        log(f"failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
