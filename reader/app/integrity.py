"""Integrity report across the three corpora: CFR titles, the Federal Register corpus and
installed U.S. Code titles.

    python -m app.integrity                       # everything installed
    python -m app.integrity --corpus usc --title 4
    python -m app.integrity --offline             # skip upstream checks (eCFR / OLRC / GovInfo)
    python -m app.integrity --govinfo-date 2026-11-02 --json

Every finding is one item `{corpus, target, check, status, detail}` with status
`OK | WARN | FAIL | INFO`; the CLI exits 1 when any item FAILs. `GET /api/integrity`
returns the same items plus a summary.

What is checked:
- all stores: SQLite `PRAGMA quick_check`, section/document counts > 0 and matching meta;
- recorded provenance (hashes, versions, source URLs); stores built before a field
  existed report it as "unknown" (INFO) until rebuilt;
- CFR: `missing_leaves`; the cached XML re-hashed when `--keep-xml` left it on disk;
  edition vs eCFR's `up_to_date_as_of`;
- FR: every `raw_json` re-hashed against `raw_sha256`, XML bodies against `sha256`;
  coverage gaps (months in the window with no coverage row, per title); last good
  fetch more than 3 business days ago; optional GovInfo cross-check for one day;
- U.S.C.: cached zip/XML re-hashed when `--keep-source` left them on disk; release
  point vs the OLRC's current one.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import config, fr_store, govinfo, news_schedule as sched, usc_store

OK, WARN, FAIL, INFO = "OK", "WARN", "FAIL", "INFO"
CORPORA = ("cfr", "fr", "usc", "constitution", "plaw", "agenda")
FR_STALE_BUSINESS_DAYS = 3
UNKNOWN = "unknown"


def _item(corpus: str, target: str, check: str, status: str, detail: str, **extra) -> dict:
    return {"corpus": corpus, "target": target, "check": check, "status": status, "detail": detail, **extra}


def _ro(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)
    con.row_factory = sqlite3.Row
    return con


def _quick_check(con: sqlite3.Connection) -> tuple[str, str]:
    try:
        res = [r[0] for r in con.execute("PRAGMA quick_check").fetchall()]
    except sqlite3.Error as exc:
        return FAIL, f"quick_check failed: {exc}"
    return (OK, "ok") if res == ["ok"] else (FAIL, "; ".join(res[:5]))


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _rehash(corpus: str, target: str, check: str, path: Path, recorded: str | None) -> dict:
    if not path.exists():
        return _item(corpus, target, check, INFO, f"{path.name} not cached on disk; nothing to re-hash")
    if not recorded:
        return _item(corpus, target, check, INFO, f"{path.name} is on disk but no hash was recorded")
    actual = _file_sha256(path)
    if actual == recorded:
        return _item(corpus, target, check, OK, f"{path.name} matches sha256 {recorded[:12]}…")
    return _item(corpus, target, check, FAIL, f"{path.name} sha256 {actual[:12]}… ≠ recorded {recorded[:12]}…")


def _provenance(corpus: str, target: str, meta: dict, keys: tuple[str, ...]) -> dict:
    values = {k: meta.get(k) or UNKNOWN for k in keys}
    unknown = [k for k, v in values.items() if v == UNKNOWN]
    detail = ", ".join(f"{k}={v[:16] + '…' if len(v) > 20 and k.endswith('sha256') else v}" for k, v in values.items())
    if unknown:
        detail += f" (unknown: {', '.join(unknown)}; rebuild to record)"
    return _item(corpus, target, "provenance", INFO, detail, provenance=values)


# ---------------------------------------------------------------------------
# CFR
# ---------------------------------------------------------------------------

CFR_PROVENANCE = ("edition", "built_at", "fetched_at", "source_url", "xml_sha256", "xml_sha256_kind",
                  "structure_sha256")


def check_cfr(titles: list[int] | None = None, online: bool = True) -> list[dict]:
    items: list[dict] = []
    installed = config.installed_titles()
    todo = [t for t in (titles or installed)]
    if not todo:
        return [_item("cfr", "-", "installed", INFO, "no CFR titles installed")]
    upstream: dict[int, str] = {}
    upstream_error = None
    if online:
        try:
            from . import library
            upstream = {int(t["number"]): t.get("up_to_date_as_of") for t in library.ecfr_titles()}
        except Exception as exc:          # network, eCFR down: report, don't crash
            upstream_error = str(exc) or exc.__class__.__name__
    for t in todo:
        target = f"title {t}"
        if t not in installed:
            items.append(_item("cfr", target, "installed", FAIL, "not installed"))
            continue
        path = config.db_path(t)
        try:
            con = _ro(path)
        except sqlite3.Error as exc:
            items.append(_item("cfr", target, "database", FAIL, f"can't open {path.name}: {exc}"))
            continue
        with closing(con):
            st, detail = _quick_check(con)
            items.append(_item("cfr", target, "database", st, f"{path.name}: {detail}"))
            if st == FAIL:
                continue
            meta = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}
            n = con.execute("SELECT count(*) FROM sections").fetchone()[0]
        recorded = int(meta.get("section_count") or 0)
        if n == 0:
            items.append(_item("cfr", target, "sections", FAIL, "no sections"))
        elif recorded and recorded != n:
            items.append(_item("cfr", target, "sections", WARN, f"{n} sections, meta says {recorded}"))
        else:
            items.append(_item("cfr", target, "sections", OK, f"{n} sections"
                               + (" (partial install)" if meta.get("scope") else "")))
        ml = meta.get("missing_leaves")
        if ml is None:
            items.append(_item("cfr", target, "missing_leaves", INFO, f"{UNKNOWN} (built before it was recorded)"))
        elif ml == "0":
            items.append(_item("cfr", target, "missing_leaves", OK, "every structure leaf had text"))
        else:
            items.append(_item("cfr", target, "missing_leaves", WARN,
                               f"{ml} structure leaves had no XML text, e.g. {meta.get('missing_sample') or '?'}"))
        items.append(_provenance("cfr", target, meta, CFR_PROVENANCE))
        if meta.get("xml_sha256_kind", "file") == "file":
            items.append(_rehash("cfr", target, "source_xml", config.DATA_DIR / f"title-{t}.xml.tmp",
                                 meta.get("xml_sha256")))
        if online:
            ed, latest = meta.get("edition"), upstream.get(t)
            if upstream_error:
                items.append(_item("cfr", target, "upstream", WARN, f"couldn't reach eCFR: {upstream_error}"))
            elif not latest:
                items.append(_item("cfr", target, "upstream", WARN, "eCFR doesn't list this title"))
            elif ed and ed >= latest:
                items.append(_item("cfr", target, "upstream", OK, f"edition {ed} is eCFR's latest"))
            else:
                items.append(_item("cfr", target, "upstream", WARN, f"edition {ed or UNKNOWN}, eCFR has {latest}"))
    return items


# ---------------------------------------------------------------------------
# Federal Register
# ---------------------------------------------------------------------------

def business_days_between(start: date, end: date) -> int:
    """Weekdays after `start` up to and including `end`."""
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def month_starts(since: str, until: str) -> list[tuple[str, str]]:
    from .fr_build import month_chunks
    return month_chunks(since, until)


def coverage_gaps(con: sqlite3.Connection, titles: list[int], since: str, until: str) -> dict[int, list[str]]:
    rows = con.execute("SELECT title, start, end FROM coverage").fetchall()
    gaps: dict[int, list[str]] = {}
    for t in titles:
        spans = [(r["start"], r["end"]) for r in rows if r["title"] == t]
        missing = [s[:7] for s, e in month_starts(since, until)
                   if not any(cs <= e and ce >= s for cs, ce in spans)]
        if missing:
            gaps[t] = missing
    return gaps


def check_fr(online: bool = True, now: datetime | None = None, govinfo_date: str | None = None) -> list[dict]:
    target = "corpus"
    path = fr_store.db_path()
    staged: list[dict] = []
    from .fr_build import pending_build
    pending = pending_build()
    if pending:
        staged.append(_item("fr", target, "staged_build", INFO,
                            f"an unfinished build for titles {pending.get('titles')} ({pending.get('since')} → "
                            f"{pending.get('until')}) is staged; rerun python -m app.fr_build to finish it"))
    if not path.exists():
        return staged + [_item("fr", target, "installed", INFO,
                               "Federal Register corpus not built (python -m app.fr_build)")]
    items: list[dict] = list(staged)
    try:
        con = _ro(path)
    except sqlite3.Error as exc:
        return [_item("fr", target, "database", FAIL, f"can't open {path.name}: {exc}")]
    with closing(con):
        st, detail = _quick_check(con)
        items.append(_item("fr", target, "database", st, f"{path.name}: {detail}"))
        if st == FAIL:
            return items
        meta = fr_store.get_meta(con)
        n = con.execute("SELECT count(*) FROM documents").fetchone()[0]
        recorded = int(meta.get("doc_count") or 0)
        if n == 0:
            items.append(_item("fr", target, "documents", FAIL, "no documents"))
        elif recorded != n:
            items.append(_item("fr", target, "documents", WARN, f"{n} documents, meta says {recorded}"))
        else:
            items.append(_item("fr", target, "documents", OK, f"{n} documents"))

        bad = [r["document_number"] for r in con.execute("SELECT document_number, raw_json, raw_sha256 FROM documents")
               if hashlib.sha256(r["raw_json"].encode("utf-8")).hexdigest() != r["raw_sha256"]]
        items.append(_item("fr", target, "raw_sha256", FAIL if bad else OK,
                           f"{len(bad)} records don't match their hash, e.g. {bad[:5]}" if bad
                           else f"all {n} API records match their sha256"))

        xml_bad, xml_n, html_n = [], 0, 0
        for r in con.execute("SELECT document_number, format, content, sha256 FROM document_bodies"):
            if r["format"] != "xml":
                html_n += 1
                continue
            xml_n += 1
            if hashlib.sha256(r["content"].encode("utf-8")).hexdigest() != r["sha256"]:
                xml_bad.append(r["document_number"])
        if xml_n or html_n:
            items.append(_item("fr", target, "body_sha256", FAIL if xml_bad else OK,
                               (f"{len(xml_bad)} XML bodies don't match, e.g. {xml_bad[:5]}" if xml_bad
                                else f"{xml_n} XML bodies match their sha256")
                               + (f"; {html_n} sanitized HTML bodies can't be re-hashed" if html_n else "")))
        else:
            items.append(_item("fr", target, "body_sha256", INFO, "no full-text bodies fetched yet"))

        titles = json.loads(meta.get("titles") or "[]")
        since, until = meta.get("window_start"), meta.get("window_end")
        if titles and since and until:
            gaps = coverage_gaps(con, titles, since, until)
            if gaps:
                items.append(_item("fr", target, "coverage", WARN,
                                   "; ".join(f"Title {t}: {len(m)} month(s) without coverage ({', '.join(m[:6])}"
                                             f"{'…' if len(m) > 6 else ''})" for t, m in gaps.items()), gaps=gaps))
            else:
                items.append(_item("fr", target, "coverage", OK, f"titles {titles}, {since} → {until}, no gaps"))
        else:
            items.append(_item("fr", target, "coverage", WARN, "window or titles missing from meta"))

        items.append(_provenance("fr", target, meta, ("source", "built_at", "updated_at", "last_ok_at",
                                                      "window_start", "window_end")))
        corpus_day: set[str] = set()
        day = govinfo_date or meta.get("last_publication_date")
        if day:
            corpus_day = {r[0] for r in con.execute(
                "SELECT document_number FROM documents WHERE publication_date = ?", (day,))}

    now = now or datetime.now(timezone.utc)
    last_ok = meta.get("last_ok_at")
    try:
        last_dt = datetime.fromisoformat(last_ok) if last_ok else None
    except ValueError:
        last_dt = None
    if last_dt is None:
        items.append(_item("fr", target, "freshness", WARN, f"last successful fetch {UNKNOWN}"))
    else:
        bd = business_days_between(last_dt.astimezone(sched.ET).date(), now.astimezone(sched.ET).date())
        st = WARN if bd > FR_STALE_BUSINESS_DAYS else OK
        items.append(_item("fr", target, "freshness", st,
                           f"last successful fetch {last_ok} ({bd} business day{'s' if bd != 1 else ''} ago)"))
    if int(meta.get("fail_count") or 0):
        items.append(_item("fr", target, "last_update", WARN,
                           f"{meta['fail_count']} failed update(s) since: {meta.get('last_error') or '?'}"))

    if not online:
        return items
    if not govinfo.api_key():
        items.append(_item("fr", target, "govinfo", INFO, "GOVINFO_API_KEY not set; GovInfo cross-check skipped"))
    elif not day:
        items.append(_item("fr", target, "govinfo", INFO, "no publication date to cross-check"))
    else:
        try:
            res = govinfo.cross_check_fr(day, corpus_day)
        except Exception as exc:
            items.append(_item("fr", target, "govinfo", WARN, f"couldn't reach GovInfo: {exc}"))
        else:
            if res["missing_from_govinfo"]:
                items.append(_item("fr", target, "govinfo", WARN,
                                   f"{day}: {len(res['missing_from_govinfo'])} corpus documents not in GovInfo's "
                                   f"package ({', '.join(res['missing_from_govinfo'][:5])})", govinfo=res))
            else:
                items.append(_item("fr", target, "govinfo", OK,
                                   f"{day}: all {res['corpus']} corpus documents are in GovInfo's package "
                                   f"({res['govinfo']} documents; {res['not_in_corpus']} outside the corpus scope)",
                                   govinfo=res))
    return items


# ---------------------------------------------------------------------------
# U.S. Code
# ---------------------------------------------------------------------------

USC_PROVENANCE = ("release_point", "current_through", "built_at", "source_url", "zip_sha256", "xml_sha256")


def check_usc(titles: list[int] | None = None, online: bool = True) -> list[dict]:
    from . import usc_build, usc_client
    installed = usc_store.installed_titles()
    todo = titles or installed
    if not todo:
        return [_item("usc", "-", "installed", INFO, "no U.S. Code titles installed")]
    release = None
    release_error = None
    if online:
        try:
            release = usc_client.current_release()
        except Exception as exc:
            release_error = str(exc) or exc.__class__.__name__
    items: list[dict] = []
    for t in todo:
        target = f"title {t}"
        if t not in installed:
            items.append(_item("usc", target, "installed", FAIL, "not installed"))
            continue
        path = usc_store.db_path(t)
        try:
            con = _ro(path)
        except sqlite3.Error as exc:
            items.append(_item("usc", target, "database", FAIL, f"can't open {path.name}: {exc}"))
            continue
        with closing(con):
            st, detail = _quick_check(con)
            items.append(_item("usc", target, "database", st, f"{path.name}: {detail}"))
            if st == FAIL:
                continue
            meta = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}
            n = con.execute("SELECT count(*) FROM sections").fetchone()[0]
            notes = con.execute("SELECT count(*) FROM notes").fetchone()[0]
        recorded = int(meta.get("section_count") or 0)
        if n == 0:
            items.append(_item("usc", target, "sections", FAIL, "no sections"))
        elif recorded != n:
            items.append(_item("usc", target, "sections", WARN, f"{n} sections, meta says {recorded}"))
        else:
            items.append(_item("usc", target, "sections", OK, f"{n} sections, {notes} notes"))
        if int(meta.get("duplicate_ids") or 0):
            items.append(_item("usc", target, "duplicate_ids", WARN,
                               f"{meta['duplicate_ids']} duplicate section numbers stored with a ~N suffix"))
        items.append(_provenance("usc", target, meta, USC_PROVENANCE))
        zip_cache, xml_cache = usc_build.source_cache(t)
        items.append(_rehash("usc", target, "source_zip", zip_cache, meta.get("zip_sha256")))
        items.append(_rehash("usc", target, "source_xml", xml_cache, meta.get("xml_sha256")))
        if online:
            rp = meta.get("release_point")
            if release_error:
                items.append(_item("usc", target, "upstream", WARN, f"couldn't reach the OLRC: {release_error}"))
            elif rp == release["release_point"]:
                items.append(_item("usc", target, "upstream", OK, f"release point {rp} is current"))
            else:
                items.append(_item("usc", target, "upstream", WARN,
                                   f"release point {rp or UNKNOWN}, OLRC is at {release['release_point']}"))
    return items


# ---------------------------------------------------------------------------
# Constitution, Public Laws, Unified Agenda
# ---------------------------------------------------------------------------

def _open_corpus(corpus: str, path: Path, missing: str) -> tuple[sqlite3.Connection | None, list[dict]]:
    if not path.exists():
        return None, [_item(corpus, "corpus", "installed", INFO, missing)]
    try:
        con = _ro(path)
    except sqlite3.Error as exc:
        return None, [_item(corpus, "corpus", "database", FAIL, f"can't open {path.name}: {exc}")]
    st, detail = _quick_check(con)
    items = [_item(corpus, "corpus", "database", st, f"{path.name}: {detail}")]
    if st == FAIL:
        con.close()
        return None, items
    return con, items


def _meta_of(con: sqlite3.Connection) -> dict[str, str]:
    return {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}


def check_constitution(online: bool = True) -> list[dict]:
    from . import constitution, gov_http
    con, items = _open_corpus("constitution", constitution.db_path(),
                              "Constitution not installed (python -m app.constitution)")
    if con is None:
        return items
    with closing(con):
        meta = _meta_of(con)
        n = con.execute("SELECT count(*) FROM units").fetchone()[0]
        amdts = con.execute("SELECT count(DISTINCT amendment) FROM units WHERE amendment IS NOT NULL").fetchone()[0]
        arts = con.execute("SELECT count(DISTINCT article) FROM units WHERE article IS NOT NULL").fetchone()[0]
        notes = con.execute("SELECT count(*) FROM notes").fetchone()[0]
    ok = n == int(meta.get("unit_count") or -1) and notes == int(meta.get("note_count") or -1)
    items.append(_item("constitution", "corpus", "counts", OK if ok else WARN,
                       f"{n} units, {notes} annotations" + ("" if ok else " (meta disagrees)")))
    whole = arts == 7 and amdts == 27
    items.append(_item("constitution", "corpus", "completeness", OK if whole else FAIL,
                       f"{arts} articles, {amdts} amendments" + ("" if whole else " (expected 7 and 27)")))
    items.append(_provenance("constitution", "corpus", meta, ("edition", "source_url", "zip_sha256", "xml_sha256",
                                                               "fetched_at")))
    cached = config.DATA_DIR / "constitution.xml"
    if cached.exists():
        items.append(_rehash("constitution", "corpus", "xml_sha256", cached, meta.get("xml_sha256")))
    if online:
        try:
            with gov_http.client() as c:
                ed = constitution.latest_edition(c)
            cur = f"HMAN-{ed['congress']}"
            items.append(_item("constitution", "corpus", "upstream", OK if cur == meta.get("edition") else WARN,
                               f"{meta.get('edition')} is the newest House Manual" if cur == meta.get("edition")
                               else f"installed {meta.get('edition')}, GovInfo has {cur}"))
        except Exception as exc:
            items.append(_item("constitution", "corpus", "upstream", WARN, f"couldn't reach GovInfo: {exc}"))
    return items


def check_plaw(online: bool = True) -> list[dict]:
    import zlib
    from . import gov_http, plaw
    con, items = _open_corpus("plaw", plaw.db_path(), "Public Laws not installed (python -m app.plaw)")
    if con is None:
        return items
    with closing(con):
        meta = _meta_of(con)
        n = con.execute("SELECT count(*) FROM laws").fetchone()[0]
        bad = [r["id"] for r in con.execute("SELECT id, xml_z, sha256 FROM laws")
               if hashlib.sha256(zlib.decompress(r["xml_z"])).hexdigest() != r["sha256"]]
        chunks = [dict(r) for r in con.execute("SELECT congress, law_type, laws, zip_sha256 FROM build_chunks")]
    items.append(_item("plaw", "corpus", "laws", OK if n and n == int(meta.get("law_count") or -1) else WARN,
                       f"{n} laws" + ("" if n == int(meta.get("law_count") or -1) else ", meta disagrees")))
    items.append(_item("plaw", "corpus", "sha256", FAIL if bad else OK,
                       f"{len(bad)} laws don't match their hash, e.g. {bad[:5]}" if bad
                       else f"all {n} law files match their sha256"))
    scope = json.loads(meta.get("scope") or "{}")
    missing = [f"{c}/{t}" for c in scope.get("congresses", []) for t in scope.get("types", [])
               if not any(x["congress"] == c and x["law_type"] == t for x in chunks)]
    items.append(_item("plaw", "corpus", "coverage", WARN if missing else OK,
                       f"not downloaded: {missing}" if missing else f"{len(chunks)} congress/type chunks"))
    if online and scope.get("follow"):
        try:
            with gov_http.client() as c:
                latest = max(plaw.available_congresses(c))
            have = max(scope.get("congresses") or [0])
            items.append(_item("plaw", "corpus", "upstream", OK if have >= latest else WARN,
                               f"through the {have}th Congress" if have >= latest
                               else f"through the {have}th Congress, GovInfo has the {latest}th"))
        except Exception as exc:
            items.append(_item("plaw", "corpus", "upstream", WARN, f"couldn't reach GovInfo: {exc}"))
    return items


def check_agenda(online: bool = True) -> list[dict]:
    from . import agenda, gov_http
    con, items = _open_corpus("agenda", agenda.db_path(), "Unified Agenda not installed (python -m app.agenda)")
    if con is None:
        return items
    with closing(con):
        meta = _meta_of(con)
        n = con.execute("SELECT count(*) FROM entries").fetchone()[0]
        eds = [dict(r) for r in con.execute("SELECT edition, entries, sha256 FROM editions ORDER BY edition")]
        per = {r[0]: r[1] for r in con.execute("SELECT edition, count(*) FROM entries GROUP BY edition")}
    items.append(_item("agenda", "corpus", "entries", OK if n and n == int(meta.get("entry_count") or -1) else WARN,
                       f"{n} entries in {len(eds)} editions"))
    off = [e["edition"] for e in eds if per.get(e["edition"], 0) != e["entries"]]
    items.append(_item("agenda", "corpus", "editions", WARN if off else OK,
                       f"entry counts differ for {off}" if off else "every edition's entries are present"))
    nohash = [e["edition"] for e in eds if not e["sha256"]]
    items.append(_item("agenda", "corpus", "sha256", INFO if nohash else OK,
                       f"no recorded hash for {nohash}" if nohash else "every edition has its download's sha256"))
    if online:
        try:
            with gov_http.client() as c:
                newest = agenda.parse_edition_list(gov_http.request(c, agenda.LIST_URL).text)[0]["edition"]
            have = eds[-1]["edition"] if eds else ""
            items.append(_item("agenda", "corpus", "upstream", OK if have >= newest else WARN,
                               f"edition {have} is the newest" if have >= newest
                               else f"newest installed {have}, reginfo.gov has {newest}"))
        except Exception as exc:
            items.append(_item("agenda", "corpus", "upstream", WARN, f"couldn't reach reginfo.gov: {exc}"))
    return items


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def run(corpus: str | None = None, title: int | None = None, online: bool = True,
        govinfo_date: str | None = None, now: datetime | None = None) -> dict:
    if corpus is not None and corpus not in CORPORA:
        raise ValueError(f"corpus must be one of {', '.join(CORPORA)}")
    if title is not None and corpus not in (None, "cfr", "usc"):
        raise ValueError("--title applies to cfr and usc")
    items: list[dict] = []
    titles = [title] if title is not None else None
    if corpus in (None, "cfr"):
        items += check_cfr(titles, online=online)
    if corpus in (None, "fr"):
        items += check_fr(online=online, now=now, govinfo_date=govinfo_date)
    if corpus in (None, "usc"):
        items += check_usc(titles, online=online)
    if corpus in (None, "constitution"):
        items += check_constitution(online=online)
    if corpus in (None, "plaw"):
        items += check_plaw(online=online)
    if corpus in (None, "agenda"):
        items += check_agenda(online=online)
    summary = {s: sum(1 for i in items if i["status"] == s) for s in (OK, WARN, FAIL, INFO)}
    overall = FAIL if summary[FAIL] else WARN if summary[WARN] else OK
    return {"status": overall, "summary": summary, "items": items,
            "checked_at": (now or datetime.now(timezone.utc)).replace(microsecond=0).isoformat(),
            "online": online}


def format_report(report: dict) -> str:
    lines = []
    for i in report["items"]:
        lines.append(f"{i['status']:<5} {i['corpus']:<4} {i['target']:<9} {i['check']:<15} {i['detail']}")
    s = report["summary"]
    lines.append(f"\n{report['status']}: {s['OK']} ok, {s['WARN']} warn, {s['FAIL']} fail, {s['INFO']} info"
                 + ("" if report["online"] else " (offline: upstream checks skipped)"))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Verify the integrity of the installed CFR, FR, U.S.C., Constitution, Public Laws and Unified Agenda stores.")
    parser.add_argument("--corpus", choices=CORPORA)
    parser.add_argument("--title", type=int, help="one CFR or U.S.C. title (with --corpus cfr|usc)")
    parser.add_argument("--offline", action="store_true", help="skip eCFR / OLRC / GovInfo checks")
    parser.add_argument("--govinfo-date", help="ISO date for the GovInfo FR cross-check (default: newest in corpus)")
    parser.add_argument("--json", action="store_true", help="print JSON instead of a table")
    args = parser.parse_args(argv)
    try:
        report = run(args.corpus, args.title, online=not args.offline, govinfo_date=args.govinfo_date)
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2) if args.json else format_report(report))
    sys.exit(1 if report["status"] == FAIL else 0)


if __name__ == "__main__":
    main()
