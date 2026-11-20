"""The U.S. Constitution as a small local corpus (`data/constitution.sqlite3`).

Source: the Constitution file of the *House Rules and Manual* in GovInfo's bulk data
(`https://www.govinfo.gov/bulkdata/HMAN/{congress}/HMAN-{congress}.zip` →
`HMAN-{congress}-constitution.xml`), the newest edition listed. It is official GPO USLM XML
and needs no key. (constitution.congress.gov answers automated requests with 403, and
GovInfo's CONAN is PDF, so neither is used.) The Manual interleaves the House
Parliamentarian's annotations with the text as `<note>` elements; they are kept apart as
`notes`, never mixed into the constitutional text.

Units: the Preamble, each section of an article (Art. I, § 2) or the whole article when it
has none (Art. V), and each amendment or section of one (Amdt. XIV, § 1). Ids: `preamble`,
`art1-s2`, `art5`, `amdt1`, `amdt14-s1`.

    python -m app.constitution            # build if missing
    python -m app.constitution --force    # rebuild from the newest Manual
    python -m app.constitution --status
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from . import config, gov_http

BULK_JSON = "https://www.govinfo.gov/bulkdata/json/HMAN"
NS = "{http://xml.house.gov/schemas/uslm/1.0}"
JOB_KEY = 2000
JOB_KINDS = ("constitution-build", "constitution-update")
MAX_XML_BYTES = 20_000_000
SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE units (
    id TEXT PRIMARY KEY, ord INTEGER NOT NULL, kind TEXT NOT NULL, article INTEGER, amendment INTEGER,
    section INTEGER, label TEXT NOT NULL, text TEXT NOT NULL, note_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE notes (id INTEGER PRIMARY KEY, unit_id TEXT NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL);
CREATE VIRTUAL TABLE units_fts USING fts5(id UNINDEXED, label, text, tokenize='porter unicode61');
CREATE VIRTUAL TABLE notes_fts USING fts5(unit_id UNINDEXED, text, tokenize='porter unicode61');
"""
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
_WS = re.compile(r"\s+")


def log(msg: str) -> None:
    from . import build
    build.log(f"[constitution] {msg}")


def db_path() -> Path:
    return config.DATA_DIR / "constitution.sqlite3"


def exists() -> bool:
    return db_path().exists()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def roman(s: str) -> int:
    s = s.strip().upper()
    total = 0
    for i, ch in enumerate(s):
        v = _ROMAN[ch]
        total += -v if i + 1 < len(s) and _ROMAN[s[i + 1]] > v else v
    return total


def to_roman(n: int) -> str:
    out = ""
    for v, r in ((100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= v:
            out, n = out + r, n - v
    return out


# ---------------------------------------------------------------------------
# Parsing (pure)
# ---------------------------------------------------------------------------

def _text(el: ET.Element) -> str:
    """Text of `el` without its <note> annotations."""
    parts: list[str] = []

    def walk(e: ET.Element) -> None:
        if e.tag == NS + "note":
            if e.tail:
                parts.append(e.tail)
            return
        if e.text:
            parts.append(e.text)
        for ch in e:
            walk(ch)
        if e.tail and e is not el:
            parts.append(e.tail)
    walk(el)
    return _WS.sub(" ", " ".join(parts)).strip()


def _notes(el: ET.Element) -> list[str]:
    out = []
    for n in el.iter(NS + "note"):
        t = _WS.sub(" ", " ".join(n.itertext())).strip()
        if t:
            out.append(t)
    return out


def _num(el: ET.Element) -> str:
    n = el.find(NS + "num")
    return (n.text or "").strip() if n is not None else ""


def parse(xml_bytes: bytes) -> list[dict]:
    """[{id, ord, kind, article, amendment, section, label, text, notes[]}] in reading order."""
    root = ET.fromstring(xml_bytes)
    units: list[dict] = []

    def add(uid, kind, label, el, article=None, amendment=None, section=None):
        text, num = _text(el), _num(el)
        if num and text.startswith(num):          # "Section 1. All persons …" → "All persons …"
            text = text[len(num):].lstrip(" .")
        units.append({"id": uid, "ord": len(units) + 1, "kind": kind, "article": article, "amendment": amendment,
                      "section": section, "label": label, "text": text, "notes": _notes(el)})

    pre = root.find(f".//{NS}preamble")
    if pre is not None:
        add("preamble", "preamble", "Preamble", pre)
    for art in root.iter(NS + "article"):
        m = re.match(r"ARTICLE\s+([IVXLC]+)", _num(art), re.I)
        if not m:
            continue
        a = roman(m.group(1))
        secs = art.findall(NS + "section")
        if not secs:
            add(f"art{a}", "article", f"Art. {to_roman(a)}", art, article=a)
        for s in secs:
            k = int(re.sub(r"\D", "", _num(s)) or 0)
            add(f"art{a}-s{k}", "section", f"Art. {to_roman(a)}, § {k}", s, article=a, section=k)
    for lv in root.iter(NS + "level"):
        m = re.match(r"AMENDMENT\s+([IVXLC]+)", _num(lv), re.I)
        if not m:
            continue
        n = roman(m.group(1))
        secs = lv.findall(NS + "section")
        if not secs:
            add(f"amdt{n}", "amendment", f"Amdt. {to_roman(n)}", lv, amendment=n)
        for s in secs:
            k = int(re.sub(r"\D", "", _num(s)) or 0)
            add(f"amdt{n}-s{k}", "amendment", f"Amdt. {to_roman(n)}, § {k}", s, amendment=n, section=k)
    if not any(u["kind"] == "section" for u in units) or not any(u["amendment"] for u in units):
        raise ValueError("The Constitution file has no articles or amendments (unexpected layout)")
    return units


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

def latest_edition(c) -> dict:
    """{congress, zip_url} of the newest House Manual in GovInfo bulk data."""
    listing = gov_http.get_json(c, BULK_JSON)
    congresses = sorted((int(f["name"]) for f in listing.get("files", []) if str(f.get("name", "")).isdigit()),
                        reverse=True)
    for cong in congresses:
        files = gov_http.get_json(c, f"{BULK_JSON}/{cong}").get("files", [])
        z = next((f for f in files if str(f.get("name", "")).endswith(".zip")), None)
        if z and z.get("link"):
            return {"congress": cong, "zip_url": z["link"].replace("/bulkdata/json/", "/bulkdata/")}
    raise gov_http.SourceUnavailable("www.govinfo.gov: no House Manual edition listed")


# ---------------------------------------------------------------------------
# Build (atomic)
# ---------------------------------------------------------------------------

def build(force: bool = False, progress=None, keep_source: bool = False) -> dict:
    report = progress or (lambda *a, **k: None)
    if exists() and not force:
        return {"cached": True, **status()}
    started = time.perf_counter()
    d = config.DATA_DIR
    d.mkdir(parents=True, exist_ok=True)
    zip_tmp, db_tmp = d / "constitution.zip.tmp", d / "constitution.sqlite3.tmp"
    try:
        report("Checking GovInfo", None, None)
        with gov_http.client() as c:
            ed = latest_edition(c)
            report("Downloading", 0, None)
            zip_sha = gov_http.download(c, ed["zip_url"], zip_tmp,
                                        on_bytes=lambda got, total: report("Downloading", got, total))
        with zipfile.ZipFile(zip_tmp) as zf:
            member = next((n for n in zf.namelist() if n.lower().endswith("-constitution.xml")), None)
            if member is None:
                raise ValueError("The House Manual zip has no Constitution file")
            if zf.getinfo(member).file_size > MAX_XML_BYTES:
                raise ValueError("The Constitution file is unexpectedly large")
            raw = zf.read(member)
        report("Parsing", None, None)
        units = parse(raw)
        db_tmp.unlink(missing_ok=True)
        with closing(sqlite3.connect(db_tmp)) as con:
            con.executescript(SCHEMA)
            n_notes = 0
            for u in units:
                con.execute("INSERT INTO units (id, ord, kind, article, amendment, section, label, text, note_count) "
                            "VALUES (?,?,?,?,?,?,?,?,?)",
                            (u["id"], u["ord"], u["kind"], u["article"], u["amendment"], u["section"], u["label"],
                             u["text"], len(u["notes"])))
                con.execute("INSERT INTO units_fts (id, label, text) VALUES (?,?,?)", (u["id"], u["label"], u["text"]))
                for i, t in enumerate(u["notes"], 1):
                    con.execute("INSERT INTO notes (unit_id, ord, text) VALUES (?,?,?)", (u["id"], i, t))
                    con.execute("INSERT INTO notes_fts (unit_id, text) VALUES (?,?)", (u["id"], t))
                    n_notes += 1
            meta = {
                "source": "GovInfo bulk data: House Rules and Manual (HMAN)",
                "edition": f"HMAN-{ed['congress']}", "congress": str(ed["congress"]),
                "source_url": ed["zip_url"], "member": member, "zip_sha256": zip_sha,
                "xml_sha256": hashlib.sha256(raw).hexdigest(), "xml_bytes": str(len(raw)),
                "fetched_at": now_iso(), "built_at": now_iso(), "unit_count": str(len(units)),
                "note_count": str(n_notes), "amendment_count": str(len({u["amendment"] for u in units if u["amendment"]})),
            }
            con.executemany("INSERT INTO meta (key, value) VALUES (?,?)", list(meta.items()))
            con.commit()
        report("Installing")
        from .build import _replace_with_retry
        _replace_with_retry(db_tmp, db_path())
        if keep_source:
            (d / "constitution.xml").write_bytes(raw)
    finally:
        db_tmp.unlink(missing_ok=True)
        zip_tmp.unlink(missing_ok=True)
        (d / "constitution.zip.tmp.download").unlink(missing_ok=True)
    res = {**status(), "elapsed_sec": round(time.perf_counter() - started, 2)}
    log(f"built from {res['meta'].get('edition')}: {res['unit_count']} units, {res['note_count']} annotations")
    return res


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
            return {"installed": False, "unit_count": 0, "note_count": 0, "meta": {}}
        meta = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}
    return {"installed": True, "unit_count": int(meta.get("unit_count") or 0),
            "note_count": int(meta.get("note_count") or 0), "meta": meta}


def outline() -> list[dict]:
    with read_con() as con:
        if con is None:
            return []
        return [dict(r) for r in con.execute(
            "SELECT id, kind, article, amendment, section, label, length(text) AS chars, note_count "
            "FROM units ORDER BY ord")]


def get_unit(uid: str) -> dict | None:
    with read_con() as con:
        if con is None:
            return None
        row = con.execute("SELECT * FROM units WHERE id = ?", (uid,)).fetchone()
        if row is None:
            return None
        notes = [r["text"] for r in con.execute("SELECT text FROM notes WHERE unit_id = ? ORDER BY ord", (uid,))]
        prev = con.execute("SELECT id FROM units WHERE ord = ?", (row["ord"] - 1,)).fetchone()
        nxt = con.execute("SELECT id FROM units WHERE ord = ?", (row["ord"] + 1,)).fetchone()
    return {**dict(row), "notes": notes, "prev": prev["id"] if prev else None, "next": nxt["id"] if nxt else None}


def search(q: str, limit: int = 20, include_notes: bool = False) -> dict:
    from .store import fts_query
    fq = fts_query(q)
    with read_con() as con:
        if con is None or not fq:
            return {"installed": con is not None, "total": 0, "results": []}
        rows = con.execute(
            "SELECT id, label, snippet(units_fts, 2, char(2), char(3), ' … ', 24) AS snippet "
            "FROM units_fts WHERE units_fts MATCH ? ORDER BY bm25(units_fts, 0, 2.0, 1.0) LIMIT ?",
            (fq, limit)).fetchall()
        out = [{**dict(r), "kind": "text"} for r in rows]
        if include_notes:
            out += [{**dict(r), "label": None, "kind": "annotation"} for r in con.execute(
                "SELECT unit_id AS id, snippet(notes_fts, 1, char(2), char(3), ' … ', 24) AS snippet "
                "FROM notes_fts WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts) LIMIT ?", (fq, limit))]
    return {"installed": True, "total": len(out), "results": out}


def remove() -> bool:
    p = db_path()
    gone = p.exists()
    p.unlink(missing_ok=True)
    return gone


# ---------------------------------------------------------------------------
# Queue
# ---------------------------------------------------------------------------

def submit(kind: str = "constitution-build") -> dict:
    from . import library as lib
    label = "U.S. Constitution" if kind == "constitution-build" else "Check the U.S. Constitution for a new edition"
    return lib.queue.submit(JOB_KEY, kind, None, label)


def _record(values: dict) -> None:
    if not exists():
        return
    with closing(sqlite3.connect(db_path(), timeout=5.0)) as con:
        con.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)", list(values.items()))
        con.commit()


def update(progress=None) -> dict:
    """Rebuild only when GovInfo lists a newer House Manual than the installed edition."""
    report = progress or (lambda *a, **k: None)
    if not exists():
        return build(progress=progress)
    report("Checking GovInfo", None, None)
    with gov_http.client() as c:
        ed = latest_edition(c)
    if f"HMAN-{ed['congress']}" == status()["meta"].get("edition"):
        _record({"checked_at": now_iso(), "last_error": ""})
        report("Already current", 1, 1)
        return {"updated": False, **status()}
    return {"updated": True, **build(force=True, progress=progress)}


def run_job(job: dict, report) -> None:
    try:
        if job["kind"] == "constitution-update":
            update(progress=report)
        else:
            build(force=True, progress=report)
    except Exception as exc:
        from .library.jobs import JobCancelled
        if not isinstance(exc, JobCancelled):
            try:
                _record({"last_error": str(exc)[:300], "last_error_at": now_iso()})
            except sqlite3.Error:
                pass
        raise


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Build the U.S. Constitution corpus from GovInfo (no key needed).")
    p.add_argument("--force", action="store_true")
    p.add_argument("--status", action="store_true")
    p.add_argument("--keep-source", action="store_true", help="keep constitution.xml so integrity can re-hash it")
    a = p.parse_args(argv)
    try:
        print(json.dumps(status() if a.status else build(force=a.force, keep_source=a.keep_source), indent=2))
    except (gov_http.SourceUnavailable, ValueError, zipfile.BadZipFile) as exc:
        log(f"failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
