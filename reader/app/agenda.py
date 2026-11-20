"""The Unified Agenda of Federal Regulatory and Deregulatory Actions (`data/agenda.sqlite3`).

Source: reginfo.gov's XML editions, `https://www.reginfo.gov/public/do/XMLViewFileAction?f=
REGINFO_RIN_DATA_{YYYYMM}.xml` (spring = 04, fall = 10; listed on
`/public/do/eAgendaXmlReport`), no key needed. Each edition is ~18 MB of XML with ~4,000
entries. One row per (RIN, edition): agency and parent agency, title, abstract (as text),
stage, priority, major flag, status, CFR parts, legal authority, timetable (with FR
citations), related RINs and the regulatory-plan flag. Agency contact names, phone numbers
and e-mail addresses are deliberately not stored.

Links to the Federal Register corpus are made at read time: documents whose
`regulation_id_numbers` include the RIN, plus documents whose citation matches a timetable
FR citation (`89 FR 91529`).

Builds are resumable per edition (staging DB + `build_chunks`); `update()` adds editions
published since. Filters: editions within `years`, parent agency codes, stages.

    python -m app.agenda [--years 2] [--agencies 2000,1200] [--stages final,proposed] [--force] | --update | --status
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterator

from . import config, gov_http

LIST_URL = "https://www.reginfo.gov/public/do/eAgendaXmlReport"
FILE_URL = "https://www.reginfo.gov/public/do/XMLViewFileAction?f={name}"
JOB_KEY = 4000
JOB_KINDS = ("agenda-build", "agenda-update")
BYTES_PER_EDITION = 11 * 1024 * 1024            # measured: 2025-10 edition, 3,954 entries
SECONDS_PER_EDITION = 25
STAGES = {
    "prerule": "Prerule Stage", "proposed": "Proposed Rule Stage", "final": "Final Rule Stage",
    "long_term": "Long-Term Actions", "completed": "Completed Actions",
}
_EDITION_RE = re.compile(r"REGINFO_RIN_DATA_(\d{4})(\d{2})?\.xml")
_WS = re.compile(r"\s+")
_TAG = re.compile(r"<[^>]+>")
SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS entries (
    rin TEXT NOT NULL, edition TEXT NOT NULL, agency_code TEXT, agency TEXT, agency_acronym TEXT,
    parent_code TEXT, parent TEXT, parent_acronym TEXT, title TEXT NOT NULL, abstract TEXT, stage TEXT,
    priority TEXT, major TEXT, rin_status TEXT, rplan TEXT, cfr_json TEXT, authority_json TEXT,
    timetable_json TEXT, related_json TEXT, further_info_url TEXT, comment_url TEXT,
    PRIMARY KEY (rin, edition)
);
CREATE INDEX IF NOT EXISTS entries_by_edition ON entries (edition, parent_code, stage);
CREATE TABLE IF NOT EXISTS editions (edition TEXT PRIMARY KEY, title TEXT, entries INTEGER, sha256 TEXT,
    byte_len INTEGER, source_url TEXT, run_date TEXT, fetched_at TEXT);
CREATE TABLE IF NOT EXISTS build_chunks (edition TEXT PRIMARY KEY, done_at TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(rin UNINDEXED, edition UNINDEXED, title, abstract,
    tokenize='porter unicode61');
"""
# Parent agencies with the most Agenda entries (reginfo.gov codes, from the 2025-10 edition).
AGENCIES: list[tuple[str, str, str]] = [
    ("0500", "USDA", "Department of Agriculture"), ("0600", "DOC", "Department of Commerce"),
    ("0700", "DOW", "Department of War (Defense)"), ("0900", "HHS", "Department of Health and Human Services"),
    ("0960", "SSA", "Social Security Administration"), ("1000", "DOI", "Department of the Interior"),
    ("1100", "DOJ", "Department of Justice"), ("1200", "DOL", "Department of Labor"),
    ("1400", "STATE", "Department of State"), ("1500", "TREAS", "Department of the Treasury"),
    ("1600", "DHS", "Department of Homeland Security"), ("1800", "ED", "Department of Education"),
    ("1900", "DOE", "Department of Energy"), ("1902", "FERC", "Federal Energy Regulatory Commission"),
    ("2000", "EPA", "Environmental Protection Agency"), ("2100", "DOT", "Department of Transportation"),
    ("2500", "HUD", "Department of Housing and Urban Development"), ("2900", "VA", "Department of Veterans Affairs"),
    ("3038", "CFTC", "Commodity Futures Trading Commission"), ("3041", "CPSC", "Consumer Product Safety Commission"),
    ("3060", "FCC", "Federal Communications Commission"), ("3064", "FDIC", "Federal Deposit Insurance Corporation"),
    ("3084", "FTC", "Federal Trade Commission"), ("3090", "GSA", "General Services Administration"),
    ("3133", "NCUA", "National Credit Union Administration"), ("3150", "NRC", "Nuclear Regulatory Commission"),
    ("3170", "CFPB", "Consumer Financial Protection Bureau"), ("3206", "OPM", "Office of Personnel Management"),
    ("3235", "SEC", "Securities and Exchange Commission"), ("3245", "SBA", "Small Business Administration"),
    ("7100", "FRS", "Federal Reserve System"), ("9000", "FAR", "DOD/GSA/NASA (FAR)"),
]


def log(msg: str) -> None:
    from . import build
    build.log(f"[agenda] {msg}")


def db_path() -> Path:
    return config.DATA_DIR / "agenda.sqlite3"


def tmp_path() -> Path:
    return config.DATA_DIR / "agenda.sqlite3.tmp"


def exists() -> bool:
    return db_path().exists()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ---------------------------------------------------------------------------
# Editions (pure)
# ---------------------------------------------------------------------------

def parse_edition_list(page: str) -> list[dict]:
    """[{edition: 'YYYYMM', name, url}] newest first. A yearly file (`…_2012.xml`) counts as 'YYYY00'."""
    seen: dict[str, dict] = {}
    for m in _EDITION_RE.finditer(page):
        ed = m.group(1) + (m.group(2) or "00")
        seen[ed] = {"edition": ed, "name": m.group(0), "url": FILE_URL.format(name=m.group(0))}
    return sorted(seen.values(), key=lambda e: e["edition"], reverse=True)


def editions_in_window(editions: list[dict], years: int, today: date | None = None) -> list[dict]:
    """The newest edition always, plus every edition within `years` of today."""
    today = today or date.today()
    cutoff = f"{today.year - years:04d}{today.month:02d}"
    keep = [e for e in editions if e["edition"] >= cutoff]
    return keep or editions[:1]


def estimate(years: int, agencies="all", stages="all") -> dict:
    n = max(1, 2 * years)
    share = 1.0
    if agencies != "all":
        share *= min(1.0, 0.04 * len(agencies))
    if stages != "all":
        share *= min(1.0, 0.25 * len(stages))
    return {"bytes": int(n * BYTES_PER_EDITION * max(share, 0.05)), "seconds": int(n * SECONDS_PER_EDITION),
            "approximate": True}


def _clean(s: str | None) -> str:
    return _WS.sub(" ", html.unescape(_TAG.sub(" ", s or ""))).strip()


def parse_entry(e: ET.Element) -> dict:
    ag, par = e.find("AGENCY"), e.find("PARENT_AGENCY")
    ag = ag if ag is not None else ET.Element("x")
    par = par if par is not None else ag
    timetable = [{"action": _clean(t.findtext("TTBL_ACTION")), "date": (t.findtext("TTBL_DATE") or "").strip(),
                  "fr_citation": (t.findtext("FR_CITATION") or "").strip() or None}
                 for t in e.iter("TIMETABLE")]
    return {
        "rin": (e.findtext("RIN") or "").strip(), "edition": (e.findtext("PUBLICATION/PUBLICATION_ID") or "").strip(),
        "edition_title": _clean(e.findtext("PUBLICATION/PUBLICATION_TITLE")),
        "agency_code": ag.findtext("CODE"), "agency": ag.findtext("NAME"), "agency_acronym": ag.findtext("ACRONYM"),
        "parent_code": par.findtext("CODE"), "parent": par.findtext("NAME"), "parent_acronym": par.findtext("ACRONYM"),
        "title": _clean(e.findtext("RULE_TITLE")), "abstract": _clean(e.findtext("ABSTRACT")),
        "stage": (e.findtext("RULE_STAGE") or "").strip(), "priority": (e.findtext("PRIORITY_CATEGORY") or "").strip(),
        "major": (e.findtext("MAJOR") or "").strip(), "rin_status": (e.findtext("RIN_STATUS") or "").strip(),
        "rplan": (e.findtext("RPLAN_ENTRY") or "").strip(),
        "cfr": [_clean(x.text) for x in e.iter("CFR") if x.text],
        "authority": [_clean(x.text) for x in e.iter("LEGAL_AUTHORITY") if x.text],
        "timetable": timetable,
        "related": [(x.findtext("RIN") or "").strip() for x in e.iter("RELATED_RIN") if x.findtext("RIN")],
        "further_info_url": (e.findtext("FURTHER_INFO_URL") or "").strip() or None,
        "comment_url": (e.findtext("PUBLIC_COMMENT_URL") or "").strip() or None,
    }


def keep_entry(rec: dict, agencies: list[str] | None, stages: list[str] | None) -> bool:
    if agencies and rec["parent_code"] not in agencies and rec["agency_code"] not in agencies:
        return False
    if stages and rec["stage"] not in {STAGES[s] for s in stages if s in STAGES}:
        return False
    return bool(rec["rin"])


# ---------------------------------------------------------------------------
# Storage and build
# ---------------------------------------------------------------------------

def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=5.0)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def _set_meta(con, values: dict) -> None:
    con.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)",
                    [(k, v if isinstance(v, str) else json.dumps(v)) for k, v in values.items()])


def _get_meta(con) -> dict[str, str]:
    return {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}


def _ingest_edition(con, c, ed: dict, filters: dict, work: Path) -> int:
    xml_tmp = work / f"agenda-{ed['edition']}.xml.tmp"
    try:
        sha = gov_http.download(c, ed["url"], xml_tmp)
        con.execute("DELETE FROM entries_fts WHERE edition = ?", (ed["edition"],))
        con.execute("DELETE FROM entries WHERE edition = ?", (ed["edition"],))
        n, title, run_date = 0, None, None
        for ev, e in ET.iterparse(xml_tmp, events=("start", "end")):
            if ev == "start":
                if e.tag == "REGINFO_RIN_DATA":
                    run_date = e.get("RUN_DATE")
                continue
            if e.tag != "RIN_INFO":
                continue
            rec = parse_entry(e)
            e.clear()
            title = title or rec["edition_title"]
            if not keep_entry(rec, filters.get("agencies"), filters.get("stages")):
                continue
            con.execute(
                "INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (rec["rin"], ed["edition"], rec["agency_code"], rec["agency"], rec["agency_acronym"],
                 rec["parent_code"], rec["parent"], rec["parent_acronym"], rec["title"], rec["abstract"], rec["stage"],
                 rec["priority"], rec["major"], rec["rin_status"], rec["rplan"], json.dumps(rec["cfr"]),
                 json.dumps(rec["authority"]), json.dumps(rec["timetable"]), json.dumps(rec["related"]),
                 rec["further_info_url"], rec["comment_url"]))
            con.execute("INSERT INTO entries_fts (rin, edition, title, abstract) VALUES (?,?,?,?)",
                        (rec["rin"], ed["edition"], rec["title"], rec["abstract"]))
            n += 1
        con.execute("INSERT OR REPLACE INTO editions VALUES (?,?,?,?,?,?,?,?)",
                    (ed["edition"], title, n, sha, xml_tmp.stat().st_size, ed["url"], run_date, now_iso()))
        con.execute("INSERT OR REPLACE INTO build_chunks VALUES (?,?)", (ed["edition"], now_iso()))
        con.commit()
        return n
    finally:
        xml_tmp.unlink(missing_ok=True)
        xml_tmp.with_suffix(xml_tmp.suffix + ".download").unlink(missing_ok=True)


def _refresh_counts(con) -> None:
    _set_meta(con, {"entry_count": str(con.execute("SELECT count(*) FROM entries").fetchone()[0]),
                    "edition_count": str(con.execute("SELECT count(*) FROM editions").fetchone()[0])})


def clean_filters(agencies=None, stages=None) -> dict:
    out = {}
    if isinstance(agencies, list) and agencies:
        out["agencies"] = sorted({str(a) for a in agencies if re.fullmatch(r"\d{4}", str(a))})
    if isinstance(stages, list) and stages:
        out["stages"] = sorted({s for s in stages if s in STAGES})
    return out


def pending_build() -> dict | None:
    p = tmp_path()
    if not p.exists():
        return None
    try:
        with closing(sqlite3.connect(f"{p.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)) as con:
            con.row_factory = sqlite3.Row
            raw = _get_meta(con).get("pending_build")
        return json.loads(raw) if raw else None
    except (sqlite3.Error, ValueError):
        return None


def build(years: int = 2, agencies=None, stages=None, force: bool = False, progress=None,
          today: date | None = None) -> dict:
    report = progress or (lambda *a, **k: None)
    started = time.perf_counter()
    filters = clean_filters(agencies, stages)
    with gov_http.client() as c:
        report("Checking reginfo.gov", None, None)
        editions = editions_in_window(parse_edition_list(gov_http.request(c, LIST_URL).text), years, today)
        scope = {"years": int(years), "filters": filters, "editions": [e["edition"] for e in editions]}
        pending = None if force else pending_build()
        resume = bool(pending and pending.get("scope") == scope)
        if not resume:
            tmp_path().unlink(missing_ok=True)
        con = _connect(tmp_path())
        with closing(con):
            if not resume:
                _set_meta(con, {"pending_build": {"scope": scope}})
                con.commit()
            done = {r["edition"] for r in con.execute("SELECT edition FROM build_chunks")}
            for i, ed in enumerate(editions, 1):
                report("Downloading the Unified Agenda", i - 1, len(editions))
                if ed["edition"] in done:
                    continue
                n = _ingest_edition(con, c, ed, filters, config.DATA_DIR)
                log(f"edition {ed['edition']}: {n} entries ({i}/{len(editions)})")
            _refresh_counts(con)
            _set_meta(con, {"source": "reginfo.gov Unified Agenda XML", "years": str(int(years)), "filters": filters,
                            "built_at": now_iso(), "last_ok_at": now_iso(), "fail_count": "0", "last_error": ""})
            con.execute("DELETE FROM meta WHERE key = 'pending_build'")
            con.commit()
    report("Installing")
    from .build import _replace_with_retry
    _replace_with_retry(tmp_path(), db_path())
    st = status()
    log(f"built: {st['entry_count']} entries from {st['edition_count']} editions")
    return {**st, "elapsed_sec": round(time.perf_counter() - started, 2), "resumed": resume}


def update(progress=None, today: date | None = None) -> dict:
    """Add editions newer than the newest stored one (with the stored filters)."""
    report = progress or (lambda *a, **k: None)
    if not exists():
        raise ValueError("The Unified Agenda isn't installed yet (python -m app.agenda).")
    with gov_http.client() as c:
        editions = parse_edition_list(gov_http.request(c, LIST_URL).text)
        con = _connect(db_path())
        with closing(con):
            meta = _get_meta(con)
            filters = json.loads(meta.get("filters") or "{}")
            have = {r["edition"] for r in con.execute("SELECT edition FROM editions")}
            newest = max(have) if have else ""
            todo = [e for e in editions if e["edition"] > newest]
            n = 0
            for i, ed in enumerate(todo, 1):
                report("Updating the Unified Agenda", i - 1, len(todo))
                n += _ingest_edition(con, c, ed, filters, config.DATA_DIR)
            _refresh_counts(con)
            _set_meta(con, {"updated_at": now_iso(), "last_ok_at": now_iso(), "fail_count": "0", "last_error": ""})
            con.commit()
    return {**status(), "new_editions": [e["edition"] for e in todo], "new_entries": n}


def record_failure(exc: BaseException) -> None:
    if not exists():
        return
    try:
        with closing(_connect(db_path())) as con:
            meta = _get_meta(con)
            _set_meta(con, {"fail_count": str(int(meta.get("fail_count") or 0) + 1), "last_error": str(exc)[:300],
                            "last_error_at": now_iso()})
            con.commit()
    except sqlite3.Error:
        pass


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

@contextmanager
def read_con() -> Iterator[sqlite3.Connection | None]:
    p = db_path()
    if not p.exists():
        yield None
        return
    con = sqlite3.connect(f"{p.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA query_only=ON")
    try:
        yield con
    finally:
        con.close()


def status() -> dict:
    with read_con() as con:
        if con is None:
            return {"installed": False, "entry_count": 0, "edition_count": 0, "editions": [], "meta": {}}
        meta = _get_meta(con)
        eds = [dict(r) for r in con.execute(
            "SELECT edition, title, entries, sha256, byte_len, run_date, fetched_at FROM editions ORDER BY edition DESC")]
    return {"installed": True, "entry_count": int(meta.get("entry_count") or 0),
            "edition_count": int(meta.get("edition_count") or 0), "editions": eds, "meta": meta}


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    for k in ("cfr_json", "authority_json", "timetable_json", "related_json"):
        if k in d:
            d[k[:-5]] = json.loads(d.pop(k) or "[]")
    return d


_RIN_RE = re.compile(r"\s*\d{4}-[A-Z]{2}\d{2}\s*", re.I)


def _filters(ed: str, agency: str | None, stage: str | None, q: str | None) -> tuple[str, list]:
    where, args = ["edition = ?"], [ed]
    if agency:
        where.append("(parent_code = ? OR agency_code = ?)")
        args += [agency, agency]
    if stage:
        where.append("stage = ?")
        args.append(STAGES.get(stage, stage))
    if q and _RIN_RE.fullmatch(q):
        where.append("rin = ?")
        args.append(q.strip().upper())
    elif q:
        from .store import fts_query
        fq = fts_query(q)
        if fq:
            where.append("rin IN (SELECT rin FROM entries_fts WHERE entries_fts MATCH ? AND edition = ?)")
            args += [fq, ed]
    return " AND ".join(where), args


def list_entries(edition: str | None = None, agency: str | None = None, stage: str | None = None,
                 limit: int = 50, offset: int = 0, q: str | None = None) -> dict:
    """One edition's entries (default the newest), filtered by agency (parent or sub-agency
    code), stage (a `STAGES` key or label) and `q` (a RIN, else FTS over title and abstract)."""
    with read_con() as con:
        if con is None:
            return {"installed": False, "total": 0, "results": []}
        ed = edition or (con.execute("SELECT max(edition) FROM editions").fetchone()[0])
        w, args = _filters(ed, agency, stage, q)
        total = con.execute(f"SELECT count(*) FROM entries WHERE {w}", args).fetchone()[0]
        rows = con.execute(
            f"SELECT rin, edition, agency_code, agency, agency_acronym, parent_code, parent, parent_acronym, "
            f"title, stage, priority, major, rin_status FROM entries WHERE {w} ORDER BY parent_code, rin LIMIT ? OFFSET ?",
            [*args, limit, offset]).fetchall()
    return {"installed": True, "edition": ed, "total": total, "results": [dict(r) for r in rows]}


def facets(edition: str | None = None) -> dict:
    """What one edition holds, for the Newsroom's filters: entries per parent agency (most
    first) and per stage (in `STAGES` order, with its key)."""
    with read_con() as con:
        if con is None:
            return {"installed": False, "edition": None, "agencies": [], "stages": []}
        ed = edition or (con.execute("SELECT max(edition) FROM editions").fetchone()[0])
        agencies = [dict(r) for r in con.execute(
            "SELECT parent_code AS code, max(parent_acronym) AS acronym, max(parent) AS name, count(*) AS entries "
            "FROM entries WHERE edition = ? AND parent_code IS NOT NULL AND parent_code != '' "
            "GROUP BY parent_code ORDER BY entries DESC, code", (ed,))]
        by_stage = dict(con.execute("SELECT stage, count(*) FROM entries WHERE edition = ? GROUP BY stage", (ed,)).fetchall())
    stages = [{"key": k, "label": v, "entries": by_stage.get(v, 0)} for k, v in STAGES.items() if by_stage.get(v)]
    return {"installed": True, "edition": ed, "agencies": agencies, "stages": stages}


def fr_documents_for(rin: str, fr_citations: list[str]) -> list[dict]:
    """Federal Register corpus documents for a RIN (its regulation_id_numbers) or for the
    timetable's FR citations. [] when the FR corpus isn't built."""
    from . import fr_store
    with fr_store.read_con() as con:
        if con is None:
            return []
        rows = con.execute(
            "SELECT document_number, type, title, publication_date, citation, html_url FROM documents "
            "WHERE EXISTS (SELECT 1 FROM json_each(documents.rins_json) WHERE value = ?) "
            "OR citation IN (SELECT value FROM json_each(?)) ORDER BY publication_date",
            (rin, json.dumps(fr_citations))).fetchall()
    return [dict(r) for r in rows]


def get_entry(rin: str, edition: str | None = None) -> dict | None:
    with read_con() as con:
        if con is None:
            return None
        if edition:
            row = con.execute("SELECT * FROM entries WHERE rin = ? AND edition = ?", (rin, edition)).fetchone()
        else:
            row = con.execute("SELECT * FROM entries WHERE rin = ? ORDER BY edition DESC LIMIT 1", (rin,)).fetchone()
        if row is None:
            return None
        history = [dict(r) for r in con.execute(
            "SELECT edition, stage, rin_status FROM entries WHERE rin = ? ORDER BY edition DESC", (rin,))]
    d = _row(row)
    cites = [t["fr_citation"] for t in d["timetable"] if t.get("fr_citation")]
    d["history"] = history
    d["fr_documents"] = fr_documents_for(rin, cites)
    return d


def search(q: str, limit: int = 20) -> dict:
    from .store import fts_query
    with read_con() as con:
        if con is None:
            return {"installed": False, "total": 0, "results": []}
        if _RIN_RE.fullmatch(q):
            rows = con.execute("SELECT rin, edition, title, stage, parent_acronym FROM entries WHERE rin = ? "
                               "ORDER BY edition DESC LIMIT 1", (q.strip().upper(),)).fetchall()
            return {"installed": True, "total": len(rows), "results": [{**dict(r), "exact": True} for r in rows]}
        fq = fts_query(q)
        if not fq:
            return {"installed": True, "total": 0, "results": []}
        # One result per rule: a RIN matches once per edition, so keep its newest matching
        # entry and count distinct RINs, before the limit is applied.
        newest: dict[str, tuple] = {}
        for rid, rin, edition, score in con.execute(
                "SELECT rowid, rin, edition, bm25(entries_fts, 0, 0, 3.0, 1.0) FROM entries_fts "
                "WHERE entries_fts MATCH ?", (fq,)):
            if rin not in newest or edition > newest[rin][1]:
                newest[rin] = (rid, edition, score)
        top = sorted(newest.items(), key=lambda kv: kv[1][2])                 # best match first…
        top = sorted(top, key=lambda kv: kv[1][1], reverse=True)[:limit]      # …within the newest edition
        marks = ",".join("?" * len(top))
        snippets = dict(con.execute(
            "SELECT rowid, snippet(entries_fts, 3, char(2), char(3), ' … ', 24) FROM entries_fts "
            f"WHERE entries_fts MATCH ? AND rowid IN ({marks})", (fq, *(v[0] for _, v in top))).fetchall())
        results = []
        for rin, (rid, edition, _score) in top:
            e = con.execute("SELECT title, stage, parent_acronym FROM entries WHERE rin = ? AND edition = ?",
                            (rin, edition)).fetchone()
            results.append({"rin": rin, "edition": edition, "title": e["title"] if e else None,
                            "stage": e["stage"] if e else None,
                            "parent_acronym": e["parent_acronym"] if e else None,
                            "snippet": snippets.get(rid, "")})
    return {"installed": True, "total": len(newest), "results": results}


def remove() -> bool:
    gone = db_path().exists()
    db_path().unlink(missing_ok=True)
    return gone


# ---------------------------------------------------------------------------
# Queue
# ---------------------------------------------------------------------------

def submit(kind: str, target: dict | None = None) -> dict:
    from . import library as lib
    label = "Download the Unified Agenda" if kind == "agenda-build" else "Update the Unified Agenda"
    return lib.queue.submit(JOB_KEY, kind, target, label)


def run_job(job: dict, report) -> None:
    t = job.get("target") or {}
    try:
        if job["kind"] == "agenda-build" or not exists():
            build(int(t.get("years") or 2), t.get("agencies"), t.get("stages"), force=job["kind"] == "agenda-build",
                  progress=report)
        else:
            update(progress=report)
    except Exception as exc:
        from .library.jobs import JobCancelled
        if job["kind"] == "agenda-update" and not isinstance(exc, JobCancelled):
            record_failure(exc)
        raise


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Build the Unified Agenda corpus from reginfo.gov (no key needed).")
    p.add_argument("--years", type=int, default=2)
    p.add_argument("--agencies", help="parent agency codes, e.g. 2000,1200")
    p.add_argument("--stages", help=",".join(STAGES))
    p.add_argument("--force", action="store_true")
    p.add_argument("--update", action="store_true")
    p.add_argument("--status", action="store_true")
    a = p.parse_args(argv)
    try:
        if a.status:
            print(json.dumps(status(), indent=2))
        elif a.update:
            print(json.dumps(update(), indent=2))
        else:
            split = lambda v: [x.strip() for x in v.split(",") if x.strip()] if v else None  # noqa: E731
            print(json.dumps(build(a.years, split(a.agencies), split(a.stages), force=a.force), indent=2))
    except (gov_http.SourceUnavailable, ValueError, ET.ParseError) as exc:
        log(f"failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
