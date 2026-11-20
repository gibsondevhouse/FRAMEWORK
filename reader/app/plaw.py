"""Public Laws (slip laws, cited to the Statutes at Large) as a local corpus (`data/plaw.sqlite3`).

Source: GovInfo bulk data, `https://www.govinfo.gov/bulkdata/PLAW/{congress}/{public|private}/
PLAW-{congress}-{type}.zip` — official GPO USLM XML, one file per law, no key needed (the
GovInfo API would need an api.data.gov key; the bulk repository doesn't). USLM bulk data
starts with the 113th Congress (2013); earlier laws exist on GovInfo only as Statutes at
Large PDFs and are out of scope.

Each law keeps its metadata (citation, Statutes at Large page, approval date, originating
bill), its text for search, its XML (zlib-compressed) with the SHA-256 of the file as served,
and its links to the U.S. Code: `reference` = a `<ref href="/us/usc/tN/sX">` in the text
(including every amendment it makes), `codified` = the margin note saying where a provision
was placed ("10 USC 7013."), `note` = placed as a statutory note ("10 USC 101 note.").

Builds are resumable: each (congress, type) chunk is committed to `plaw.sqlite3.tmp` with a
`build_chunks` row; re-running the same scope skips finished chunks; the live file is
replaced only when every chunk is done. `update()` re-reads the newest congress in place.

    python -m app.plaw [--congress 118-119] [--types public,private] [--force] | --update | --status
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
import zlib
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterator

from . import config, gov_http

BULK_JSON = "https://www.govinfo.gov/bulkdata/json/PLAW"
FIRST_CONGRESS = 113
TYPES = ("public", "private")
JOB_KEY = 3000
JOB_KINDS = ("plaw-build", "plaw-update")
MAX_XML_BYTES = 60_000_000
BYTES_PER_PUBLIC_CONGRESS = 32 * 1024 * 1024     # measured: 118th = 274 laws -> 32 MB database
SECONDS_PER_CHUNK = 20
SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS laws (
    id TEXT PRIMARY KEY, congress INTEGER NOT NULL, law_type TEXT NOT NULL, number INTEGER NOT NULL,
    citation TEXT, statute TEXT, title TEXT, approved_date TEXT, bill TEXT, text TEXT NOT NULL,
    xml_z BLOB NOT NULL, sha256 TEXT NOT NULL, byte_len INTEGER NOT NULL, source_url TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS laws_by_congress ON laws (congress, law_type, number);
CREATE TABLE IF NOT EXISTS law_usc (
    law_id TEXT NOT NULL, title INTEGER NOT NULL, section TEXT NOT NULL, kind TEXT NOT NULL,
    PRIMARY KEY (law_id, title, section, kind)
);
CREATE INDEX IF NOT EXISTS law_usc_by_section ON law_usc (title, section);
CREATE TABLE IF NOT EXISTS build_chunks (congress INTEGER, law_type TEXT, laws INTEGER, zip_sha256 TEXT,
    source_url TEXT, done_at TEXT, PRIMARY KEY (congress, law_type));
CREATE VIRTUAL TABLE IF NOT EXISTS laws_fts USING fts5(id UNINDEXED, title, text, tokenize='porter unicode61');
"""
_WS = re.compile(r"\s+")
_USC_HREF = re.compile(r"^/us/usc/t(\d+)(a?)/s([0-9A-Za-z.\-–]+)")
_SIDENOTE = re.compile(r"(\d+)\s*USC\s*(note\s*|prec\.\s*|note\s*prec\.\s*)?([0-9][0-9A-Za-z.\-–]*)(\s*note)?", re.I)


def log(msg: str) -> None:
    from . import build
    build.log(f"[plaw] {msg}")


def db_path() -> Path:
    return config.DATA_DIR / "plaw.sqlite3"


def tmp_path() -> Path:
    return config.DATA_DIR / "plaw.sqlite3.tmp"


def exists() -> bool:
    return db_path().exists()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ---------------------------------------------------------------------------
# Parsing (pure)
# ---------------------------------------------------------------------------

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _usc_title(num: str, appendix: str) -> int:
    return (100 + int(num)) if appendix else int(num)


def parse_law(raw: bytes) -> dict:
    """One law's metadata, text and U.S. Code links from its USLM XML."""
    root = ET.fromstring(raw)
    meta = next((e for e in root if _local(e.tag) == "meta"), None)
    info: dict = {"citations": []}
    if meta is not None:
        for e in meta:
            t, v = _local(e.tag), _WS.sub(" ", "".join(e.itertext())).strip()
            if t == "title":
                info["title"] = v
            elif t == "docNumber":
                info["number"] = v
            elif t == "citableAs":
                info["citations"].append(v)
            elif t == "approvedDate":
                info["approved_date"] = v
            elif t == "congress":
                info["congress"] = v
            elif t == "publicPrivate":
                info["law_type"] = v.lower()
    bill = None
    links: set[tuple[int, str, str]] = set()
    for e in root.iter():
        t = _local(e.tag)
        if t == "ref":
            href = e.get("href") or ""
            m = _USC_HREF.match(href)
            if m:
                links.add((_usc_title(m.group(1), m.group(2)), m.group(3).replace("–", "-"), "reference"))
            elif href.startswith("/us/bill/") and bill is None:
                bill = _WS.sub(" ", "".join(e.itertext())).strip() or href
        elif t == "sidenote":
            for m in _SIDENOTE.finditer("".join(e.itertext())):
                is_note = bool(m.group(2) or m.group(4))
                links.add((int(m.group(1)), m.group(3).rstrip(".").replace("–", "-"), "note" if is_note else "codified"))
    main = next((e for e in root.iter() if _local(e.tag) == "main"), root)
    text = _WS.sub(" ", " ".join(main.itertext())).strip()
    title = info.get("title") or ""
    title = re.sub(r"^(Public|Private) Law \d+[–-]\d+:\s*", "", title)
    pub = next((c for c in info["citations"] if re.match(r"(Public|Private) Law", c)), None)
    stat = next((c for c in info["citations"] if "Stat." in c), None)
    return {"congress": int(info.get("congress") or 0), "law_type": info.get("law_type") or "public",
            "number": int(re.sub(r"\D", "", info.get("number") or "0") or 0), "citation": pub, "statute": stat,
            "title": title, "approved_date": info.get("approved_date"), "bill": bill, "text": text,
            "usc": sorted(links)}


def law_id(congress: int, law_type: str, number: int) -> str:
    return f"{congress}-{number}" if law_type == "public" else f"{congress}-pvt-{number}"


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------

def available_congresses(c) -> list[int]:
    listing = gov_http.get_json(c, BULK_JSON)
    return sorted(int(f["name"]) for f in listing.get("files", []) if str(f.get("name", "")).isdigit())


def chunk_zip(c, congress: int, law_type: str) -> dict | None:
    """{url, size, modified} of the (congress, type) zip, or None when GovInfo has none."""
    try:
        files = gov_http.get_json(c, f"{BULK_JSON}/{congress}/{law_type}").get("files", [])
    except gov_http.SourceUnavailable as exc:
        if "HTTP 404" in str(exc):
            return None
        raise
    z = next((f for f in files if str(f.get("name", "")).endswith(".zip")), None)
    if not z or not z.get("link"):
        return None
    return {"url": z["link"].replace("/bulkdata/json/", "/bulkdata/"), "size": z.get("size"),
            "modified": z.get("formattedLastModifiedTime")}


def current_congress(today: date | None = None) -> int:
    """The congress sitting on `today` (a new one starts on Jan 3 of odd years)."""
    today = today or date.today()
    return (today.year - 1789) // 2 + 1 - (1 if today.year % 2 == 1 and (today.month, today.day) < (1, 3) else 0)


def resolve_scope(congresses, types: list[str] | None, latest: int) -> dict:
    """{congresses: [...], follow: bool, types: [...]}. `congresses` is "all" / None (every
    congress GovInfo has in USLM, following new ones) or a list."""
    ts = [t for t in TYPES if t in (types or ["public"])] or ["public"]
    if congresses in (None, "all"):
        return {"congresses": list(range(FIRST_CONGRESS, latest + 1)), "follow": True, "types": ts}
    cs = sorted({int(c) for c in congresses if FIRST_CONGRESS <= int(c) <= latest})
    if not cs:
        raise ValueError(f"No congresses in {congresses} (GovInfo has {FIRST_CONGRESS}-{latest} in USLM)")
    return {"congresses": cs, "follow": False, "types": ts}


def estimate(congresses, types: list[str]) -> dict:
    n = len(range(FIRST_CONGRESS, current_congress() + 1)) if congresses in (None, "all") else len(congresses)
    per = BYTES_PER_PUBLIC_CONGRESS * (1.05 if "private" in types else 1.0) if "public" in types else 512 * 1024
    return {"bytes": int(n * per), "seconds": int(n * len(types) * SECONDS_PER_CHUNK), "approximate": True}


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=5.0)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def _set_meta(con: sqlite3.Connection, values: dict) -> None:
    con.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)",
                    [(k, v if isinstance(v, str) else json.dumps(v)) for k, v in values.items()])


def _get_meta(con: sqlite3.Connection) -> dict[str, str]:
    return {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}


def _ingest_chunk(con: sqlite3.Connection, c, congress: int, law_type: str, work: Path, report=None) -> int:
    """Download one (congress, type) zip and replace that chunk's laws. Commits."""
    z = chunk_zip(c, congress, law_type)
    con.execute("DELETE FROM laws_fts WHERE id IN (SELECT id FROM laws WHERE congress = ? AND law_type = ?)",
                (congress, law_type))
    con.execute("DELETE FROM law_usc WHERE law_id IN (SELECT id FROM laws WHERE congress = ? AND law_type = ?)",
                (congress, law_type))
    con.execute("DELETE FROM laws WHERE congress = ? AND law_type = ?", (congress, law_type))
    if z is None:
        con.execute("INSERT OR REPLACE INTO build_chunks VALUES (?,?,?,?,?,?)",
                    (congress, law_type, 0, None, None, now_iso()))
        con.commit()
        return 0
    zip_tmp = work / f"plaw-{congress}-{law_type}.zip.tmp"
    try:
        zip_sha = gov_http.download(c, z["url"], zip_tmp)
        n = 0
        fetched = now_iso()
        with zipfile.ZipFile(zip_tmp) as zf:
            for name in sorted(zf.namelist()):
                if not name.lower().endswith(".xml"):
                    continue
                if zf.getinfo(name).file_size > MAX_XML_BYTES:
                    log(f"skipping oversized {name}")
                    continue
                raw = zf.read(name)
                try:
                    law = parse_law(raw)
                except ET.ParseError as exc:
                    log(f"skipping unparsable {name}: {exc}")
                    continue
                if not law["number"]:
                    continue
                lid = law_id(congress, law_type, law["number"])
                con.execute(
                    "INSERT OR REPLACE INTO laws (id, congress, law_type, number, citation, statute, title, "
                    "approved_date, bill, text, xml_z, sha256, byte_len, source_url, fetched_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (lid, congress, law_type, law["number"], law["citation"], law["statute"], law["title"],
                     law["approved_date"], law["bill"], law["text"], zlib.compress(raw, 6),
                     hashlib.sha256(raw).hexdigest(), len(raw), f"{z['url']}#{name}", fetched))
                con.executemany("INSERT OR IGNORE INTO law_usc VALUES (?,?,?,?)",
                                [(lid, t, s, k) for t, s, k in law["usc"]])
                con.execute("INSERT INTO laws_fts (id, title, text) VALUES (?,?,?)", (lid, law["title"], law["text"]))
                n += 1
        con.execute("INSERT OR REPLACE INTO build_chunks VALUES (?,?,?,?,?,?)",
                    (congress, law_type, n, zip_sha, z["url"], now_iso()))
        con.commit()
        return n
    finally:
        zip_tmp.unlink(missing_ok=True)
        zip_tmp.with_suffix(zip_tmp.suffix + ".download").unlink(missing_ok=True)


def _refresh_counts(con: sqlite3.Connection) -> None:
    n = con.execute("SELECT count(*) FROM laws").fetchone()[0]
    links = con.execute("SELECT count(*) FROM law_usc").fetchone()[0]
    _set_meta(con, {"law_count": str(n), "usc_link_count": str(links)})


def pending_build() -> dict | None:
    p = tmp_path()
    if not p.exists():
        return None
    try:
        with closing(sqlite3.connect(f"{p.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)) as con:
            con.row_factory = sqlite3.Row
            raw = _get_meta(con).get("pending_build")
    except sqlite3.Error:
        return None
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def build(congresses=None, types: list[str] | None = None, force: bool = False, progress=None) -> dict:
    """Full (resumable, atomic) build of the chosen congresses and law types."""
    report = progress or (lambda *a, **k: None)
    started = time.perf_counter()
    with gov_http.client() as c:
        report("Checking GovInfo", None, None)
        latest = max(available_congresses(c))
        scope = resolve_scope(congresses, types, latest)
        pending = None if force else pending_build()
        resume = bool(pending and pending.get("scope") == scope)
        if not resume:
            tmp_path().unlink(missing_ok=True)
        chunks = [(cg, t) for cg in scope["congresses"] for t in scope["types"]]
        con = _connect(tmp_path())
        with closing(con):
            if not resume:
                _set_meta(con, {"pending_build": {"scope": scope}, "build_started_at": now_iso()})
                con.commit()
            done = {(r["congress"], r["law_type"]) for r in con.execute("SELECT congress, law_type FROM build_chunks")}
            for i, (cg, t) in enumerate(chunks, 1):
                report("Downloading Public Laws", i - 1, len(chunks))
                if (cg, t) in done:
                    continue
                n = _ingest_chunk(con, c, cg, t, config.DATA_DIR)
                log(f"{cg}th Congress, {t}: {n} laws ({i}/{len(chunks)})")
            report("Indexing", None, None)
            _refresh_counts(con)
            _set_meta(con, {"source": "GovInfo bulk data (PLAW, USLM)", "scope": scope, "latest_congress": str(latest),
                            "built_at": now_iso(), "last_ok_at": now_iso(), "fail_count": "0", "last_error": ""})
            con.execute("DELETE FROM meta WHERE key = 'pending_build'")
            con.commit()
    report("Installing")
    from .build import _replace_with_retry
    _replace_with_retry(tmp_path(), db_path())
    st = status()
    log(f"built: {st['law_count']} laws, {st['usc_link_count']} U.S. Code links in "
        f"{round(time.perf_counter() - started, 1)}s")
    return {**st, "elapsed_sec": round(time.perf_counter() - started, 2), "resumed": resume}


def update(progress=None) -> dict:
    """Re-read the newest congress in the stored scope (and any newer one) in place."""
    report = progress or (lambda *a, **k: None)
    if not exists():
        raise ValueError("Public Laws aren't installed yet (python -m app.plaw).")
    with gov_http.client() as c:
        latest = max(available_congresses(c))
        con = _connect(db_path())
        with closing(con):
            meta = _get_meta(con)
            scope = json.loads(meta.get("scope") or "{}")
            have = list(scope.get("congresses") or [])
            newest = max(have) if have else latest
            # Laws are added to the newest congress as they're signed; earlier ones are final.
            # A scope of "every congress" also picks up congresses that began since.
            todo = list(range(newest, latest + 1)) if scope.get("follow") else ([newest] if newest == latest else [])
            chunks = [(cg, t) for cg in todo for t in scope.get("types", ["public"])]
            n = 0
            for i, (cg, t) in enumerate(chunks, 1):
                report("Updating Public Laws", i - 1, len(chunks))
                n += _ingest_chunk(con, c, cg, t, config.DATA_DIR)
            scope["congresses"] = sorted(set(have) | set(todo))
            _refresh_counts(con)
            _set_meta(con, {"scope": scope, "latest_congress": str(latest), "updated_at": now_iso(),
                            "last_ok_at": now_iso(), "fail_count": "0", "last_error": ""})
            con.commit()
    return {**status(), "updated_laws": n}


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
            return {"installed": False, "law_count": 0, "usc_link_count": 0, "meta": {}, "congresses": [],
                    "first_congress": FIRST_CONGRESS, "current_congress": current_congress()}
        meta = _get_meta(con)
        cong = [dict(r) for r in con.execute(
            "SELECT congress, law_type, count(*) AS laws FROM laws GROUP BY congress, law_type ORDER BY congress")]
    return {"installed": True, "law_count": int(meta.get("law_count") or 0),
            "usc_link_count": int(meta.get("usc_link_count") or 0), "meta": meta, "congresses": cong,
            "first_congress": FIRST_CONGRESS, "current_congress": current_congress()}


_LIST = "id, congress, law_type, number, citation, statute, title, approved_date, bill"


def list_laws(congress: int | None = None, law_type: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    with read_con() as con:
        if con is None:
            return {"installed": False, "total": 0, "results": []}
        where, args = [], []
        if congress:
            where.append("congress = ?")
            args.append(congress)
        if law_type:
            where.append("law_type = ?")
            args.append(law_type)
        w = f"WHERE {' AND '.join(where)}" if where else ""
        total = con.execute(f"SELECT count(*) FROM laws {w}", args).fetchone()[0]
        rows = con.execute(f"SELECT {_LIST} FROM laws {w} ORDER BY congress DESC, number DESC LIMIT ? OFFSET ?",
                           [*args, limit, offset]).fetchall()
    return {"installed": True, "total": total, "results": [dict(r) for r in rows]}


def get_law(lid: str, include_xml: bool = False) -> dict | None:
    with read_con() as con:
        if con is None:
            return None
        row = con.execute("SELECT * FROM laws WHERE id = ?", (lid,)).fetchone()
        if row is None:
            return None
        usc = [dict(r) for r in con.execute(
            "SELECT title, section, kind FROM law_usc WHERE law_id = ? ORDER BY title, section", (lid,))]
    d = dict(row)
    xml = zlib.decompress(d.pop("xml_z")).decode("utf-8", "replace")
    if include_xml:
        d["xml"] = xml
    d["usc"] = usc
    d["provenance"] = {"source_url": d.pop("source_url"), "sha256": d.pop("sha256"), "byte_len": d.pop("byte_len"),
                       "fetched_at": d.pop("fetched_at")}
    return d


def law_text(lid: str, unit: str | None = None) -> dict | None:
    """A law as reading units (render/plaw_html): `mode` "units" for a long law with 2+
    sections (one section at a time; `unit` '' = the first), else "page" (all of it)."""
    from .render import plaw_html
    from .render.units import UNIT_MODE_MIN_CHARS
    with read_con() as con:
        if con is None:
            return None
        row = con.execute("SELECT xml_z FROM laws WHERE id = ?", (lid,)).fetchone()
    if row is None:
        return None
    units = plaw_html.law_units(zlib.decompress(row["xml_z"]))
    total = sum(u["chars"] for u in units)
    mode = "units" if len(units) >= 2 and total > UNIT_MODE_MIN_CHARS else "page"
    outline = [{k: u[k] for k in ("key", "label", "title", "kind", "group", "group_label", "group_title", "chars")}
               for u in units]
    out: dict = {"id": lid, "mode": mode, "outline": outline, "chars": total}
    if mode == "units" and unit is not None:
        keys = [u["key"] for u in units]
        i = keys.index(unit) if unit in keys else (0 if unit == "" else -1)
        if i < 0:
            raise KeyError(unit)
        out.update(unit=keys[i], html=units[i]["html"],
                   unit_prev=outline[i - 1] if i > 0 else None,
                   unit_next=outline[i + 1] if i + 1 < len(units) else None)
    else:
        out.update(unit=None, unit_prev=None, unit_next=None,
                   html="".join(f'<section class="reg-unit" id="u-{u["key"]}" data-unit="{u["key"]}">'
                                + (f'<h2 class="plaw-sec-head">{_esc(u["label"])}'
                                   + (f' <span class="plaw-sec-title">{_esc(u["title"])}</span>' if u["title"] else "")
                                   + "</h2>" if u["key"] != "preamble" and u["label"] else "")
                                + u["html"] + "</section>" for u in units))
    return out


def _esc(s: str) -> str:
    from html import escape
    return escape(s or "", quote=False)


def laws_for_usc(title: int, section: str, limit: int = 50) -> list[dict]:
    with read_con() as con:
        if con is None:
            return []
        rows = con.execute(
            f"SELECT {', '.join('l.' + c.strip() for c in _LIST.split(','))}, group_concat(DISTINCT u.kind) AS kinds "
            "FROM law_usc u JOIN laws l ON l.id = u.law_id WHERE u.title = ? AND u.section = ? "
            "GROUP BY l.id ORDER BY l.congress DESC, l.number DESC LIMIT ?", (title, section, limit)).fetchall()
    return [dict(r) for r in rows]


def search(q: str, limit: int = 20) -> dict:
    from .store import fts_query
    m = re.match(r"^\s*(?:Pub(?:lic)?\.?\s*L(?:aw)?\.?\s*(?:No\.?\s*)?)?(\d{3})[–-](\d+)\s*$", q, re.I)
    with read_con() as con:
        if con is None:
            return {"installed": False, "total": 0, "results": []}
        if m:
            row = con.execute(f"SELECT {_LIST} FROM laws WHERE id = ?", (f"{m.group(1)}-{m.group(2)}",)).fetchone()
            if row:
                return {"installed": True, "total": 1, "results": [{**dict(row), "exact": True, "snippet": None}]}
        fq = fts_query(q)
        if not fq:
            return {"installed": True, "total": 0, "results": []}
        rows = con.execute(
            f"SELECT {', '.join('l.' + c.strip() for c in _LIST.split(','))}, "
            "snippet(laws_fts, 2, char(2), char(3), ' … ', 24) AS snippet FROM laws_fts "
            "JOIN laws l ON l.id = laws_fts.id WHERE laws_fts MATCH ? ORDER BY bm25(laws_fts, 0, 3.0, 1.0) LIMIT ?",
            (fq, limit)).fetchall()
        total = con.execute("SELECT count(*) FROM laws_fts WHERE laws_fts MATCH ?", (fq,)).fetchone()[0]
    return {"installed": True, "total": total, "results": [dict(r) for r in rows]}


def remove() -> bool:
    gone = db_path().exists()
    db_path().unlink(missing_ok=True)
    return gone


# ---------------------------------------------------------------------------
# Queue
# ---------------------------------------------------------------------------

def submit(kind: str, target: dict | None = None) -> dict:
    from . import library as lib
    label = "Download Public Laws" if kind == "plaw-build" else "Update Public Laws"
    return lib.queue.submit(JOB_KEY, kind, target, label)


def run_job(job: dict, report) -> None:
    t = job.get("target") or {}
    try:
        if job["kind"] == "plaw-build" or not exists():
            build(t.get("congresses"), t.get("types"), force=job["kind"] == "plaw-build", progress=report)
        else:
            update(progress=report)
    except Exception as exc:
        from .library.jobs import JobCancelled
        if job["kind"] == "plaw-update" and not isinstance(exc, JobCancelled):
            record_failure(exc)
        raise


def _parse_range(raw: str | None):
    if not raw:
        return "all"
    a, _, b = raw.partition("-")
    return list(range(int(a), int(b or a) + 1))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Build the Public Laws corpus from GovInfo bulk data (no key needed).")
    p.add_argument("--congress", help="e.g. 118 or 113-119 (default: 113 to the newest)")
    p.add_argument("--types", default="public", help="public,private")
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
            print(json.dumps(build(_parse_range(a.congress), [t.strip() for t in a.types.split(",")], force=a.force),
                             indent=2))
    except (gov_http.SourceUnavailable, ValueError, zipfile.BadZipFile) as exc:
        log(f"failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
