"""Download one U.S. Code title from the OLRC and build its local reading database.

The CFR pattern (`build.py`) for the U.S.C.: discover the current release point
(`usc_client.current_release`), stream the title's USLM zip to disk (SHA-256 while
streaming), extract its single XML member (SHA-256 again), stream-parse it
(`ingest.uslm.parse_title`) into `usc-{N}.sqlite3.tmp`, then atomically replace the
live database and tree. Notes are stored apart from section text (QUIRK-006).

    python -m app.usc_build --title 4            # build if missing
    python -m app.usc_build --title 4 --force    # rebuild at the current release point
    python -m app.usc_build --update             # rebuild every installed title that is behind
    python -m app.usc_build --status             # installed vs current release points

Staleness = an installed title's `meta.release_point` differs from the current one.
The daily check (`maybe_queue_updates`, from the news worker) only ever updates titles
that are already installed; a first install is always the user's choice.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import zipfile
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config, migrate, usc_client, usc_store
from .ingest import uslm

USC_JOB_BASE = 1000                     # library-queue key = 1000 + title (CFR titles are 1-50)
USC_JOB_KINDS = ("usc-title", "usc-update")
CHECK_EVERY = timedelta(hours=24)
RETRY_AFTER_FAILURE = timedelta(hours=6)

_check_lock = threading.Lock()
_last_check: datetime | None = None
_last_check_ok = True


def log(msg: str) -> None:
    from . import build
    build.log(f"[usc] {msg}")


def _noop(phase, done=None, total=None) -> None:
    return None


def valid_title(title: int) -> int:
    t = int(title)
    if t not in usc_client.ALL_TITLES or t in usc_client.RESERVED:
        raise ValueError(f"U.S. Code Title {usc_client.title_label(t)} doesn't exist or holds no laws "
                         "(titles 1-54 and appendices 5a, 11a, 18a, 28a; 53 is reserved, 50a was eliminated)")
    return t


def tmp_files(title: int) -> list[Path]:
    d = config.DATA_DIR
    return [d / f"usc-{title}.zip.tmp", d / f"usc-{title}.zip.tmp.download", d / f"usc-{title}.xml.tmp",
            d / f"usc-{title}.sqlite3.tmp", d / f"usc-tree-{title}.json.tmp"]


def _extract_xml(zip_path: Path, dest: Path) -> tuple[str, str]:
    """Extract the title's XML member, returning (member name, SHA-256 of the XML)."""
    import hashlib
    with zipfile.ZipFile(zip_path) as zf:
        members = [i for i in zf.infolist() if i.filename.lower().endswith(".xml") and "/" not in i.filename.strip("/")]
        if len(members) != 1:
            raise ValueError(f"Expected one XML file in {zip_path.name}, found {[m.filename for m in members]}")
        info = members[0]
        if info.file_size > usc_client.MAX_XML_BYTES:
            raise ValueError(f"{info.filename} is larger than expected ({info.file_size} bytes)")
        h = hashlib.sha256()
        written = 0
        with zf.open(info) as src, open(dest, "wb") as out:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > usc_client.MAX_XML_BYTES:
                    raise ValueError(f"{info.filename} exceeded the size limit while extracting")
                h.update(chunk)
                out.write(chunk)
    return info.filename, h.hexdigest()


def build(
    title: int,
    force: bool = False,
    progress=None,
    release: dict | None = None,
    keep_xml: bool = False,
    keep_source: bool = False,
) -> dict:
    """Build (or rebuild) one title at the current release point.

    `keep_source` keeps the downloaded zip and extracted XML as `usc-{N}.zip` /
    `usc-{N}.xml` in DATA_DIR, so `python -m app.integrity` can re-hash them later
    (`keep_xml` keeps just the XML)."""
    report = progress or _noop
    title = valid_title(title)
    target_db = usc_store.db_path(title)
    if target_db.exists() and not force:
        log(f"Title {title} already installed at {target_db} (use --force to rebuild)")
        return {"title": title, "cached": True}
    started = time.perf_counter()
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    zip_tmp, _, xml_tmp, db_tmp, tree_tmp = tmp_files(title)
    try:
        report("Checking OLRC")
        with usc_client.client() as c:
            release = release or usc_client.current_release(c)
            url = usc_client.zip_url(release, title)
            report("Downloading title", 0, None)
            zip_sha = usc_client.download(c, url, zip_tmp,
                                          on_bytes=lambda got, total: report("Downloading title", got, total))
        report("Extracting")
        member, xml_sha = _extract_xml(zip_tmp, xml_tmp)

        report("Reading text", 0, None)
        db_tmp.unlink(missing_ok=True)
        with closing(sqlite3_connect(db_tmp)) as con:
            con.executescript(usc_store.SCHEMA)
            counters = {"sections": 0, "notes": 0, "dupes": 0}
            seen: set[str] = set()
            note_ord = [0]

            def add_notes(owner: str, kind: str, notes: list[dict]) -> None:
                for n in notes:
                    note_ord[0] += 1
                    cur = con.execute(
                        "INSERT INTO notes (owner, owner_kind, ord, category, topic, heading, xml, text) VALUES (?,?,?,?,?,?,?,?)",
                        (owner, kind, note_ord[0], n["category"], n["topic"], n["heading"], n["xml"], n["text"]),
                    )
                    con.execute("INSERT INTO notes_fts (rowid, owner, heading, text) VALUES (?,?,?,?)",
                                (cur.lastrowid, owner, n["heading"] or "", n["text"]))
                    counters["notes"] += 1

            def on_section(rec: dict) -> None:
                sid = rec["id"]
                if sid in seen:      # rare duplicate numbering: keep both, suffix the later one
                    k = 2
                    while f"{sid}~{k}" in seen:
                        k += 1
                    sid = f"{sid}~{k}"
                    counters["dupes"] += 1
                seen.add(sid)
                counters["sections"] += 1
                con.execute(
                    "INSERT INTO sections (id, identifier, kind, ord, chapter, label, heading, path, status, xml, text, source_credit) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (sid, rec["identifier"], "section", counters["sections"], rec["chapter"], rec["label"],
                     rec["heading"], json.dumps(rec["path"]), rec["status"], rec["xml"], rec["text"],
                     rec["source_credit"]),
                )
                con.execute("INSERT INTO sections_fts (id, label, heading, text) VALUES (?,?,?,?)",
                            (sid, rec["label"], rec["heading"], rec["text"]))
                add_notes(sid, "section", rec["notes"])
                if counters["sections"] % 200 == 0:
                    report("Reading text", counters["sections"], None)

            info, tree = uslm.parse_title(xml_tmp, on_section, add_notes)
            if counters["sections"] == 0:
                raise ValueError(f"No sections found in {member}")
            if info.get("number") and str(info["number"]).lower().lstrip("0") != usc_client.title_label(title):
                raise ValueError(f"{member} is Title {info['number']}, not Title {usc_client.title_label(title)}")
            report("Indexing")
            meta = {
                "release_point": release["release_point"],
                "current_through": release.get("current_through") or "",
                "built_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "section_count": str(counters["sections"]),
                "note_count": str(counters["notes"]),
                "duplicate_ids": str(counters["dupes"]),
                "source_url": url,
                "release_page": release.get("source_url") or "",
                "zip_sha256": zip_sha,
                "xml_sha256": xml_sha,
                "xml_member": member,
                "title": str(title),
                # An appendix's own <heading> names its first act (an OLRC quirk): use the catalog's name.
                "title_name": ((static_catalog()["titles"].get(str(title)) or {}).get("name")
                               if title in usc_client.APPENDIX else None)
                              or info.get("name") or usc_client.title_name_prefix(title),
                "positive_law": "1" if info.get("positive_law") else "0",
                "publication": info.get("publication") or "",
            }
            con.executemany("INSERT INTO meta VALUES (?,?)", meta.items())
            migrate.stamp(con, "usc")
            con.commit()

        tree_tmp.write_text(json.dumps(tree, separators=(",", ":")), encoding="utf-8")
        report("Installing")
        from .build import _replace_with_retry
        _replace_with_retry(db_tmp, target_db)
        _replace_with_retry(tree_tmp, usc_store.tree_path(title))
    except BaseException:
        for p in tmp_files(title):
            p.unlink(missing_ok=True)
        raise
    zip_cache, xml_cache = source_cache(title)
    if keep_source:
        zip_tmp.replace(zip_cache)
    else:
        zip_tmp.unlink(missing_ok=True)
        zip_cache.unlink(missing_ok=True)      # a stale cache would no longer match meta
    if keep_source or keep_xml:
        xml_tmp.replace(xml_cache)
    else:
        xml_tmp.unlink(missing_ok=True)
        xml_cache.unlink(missing_ok=True)
    after_install(title)
    result = {"title": title, "name": meta["title_name"], "release_point": meta["release_point"],
              "section_count": counters["sections"], "note_count": counters["notes"],
              "duplicate_ids": counters["dupes"], "zip_sha256": zip_sha, "xml_sha256": xml_sha,
              "elapsed_sec": round(time.perf_counter() - started, 2)}
    log(f"built Title {usc_client.title_label(title)} at {meta['release_point']}: {counters['sections']} sections, "
        f"{counters['notes']} notes in {result['elapsed_sec']}s")
    return result


def source_cache(title: int) -> tuple[Path, Path]:
    """Where `keep_source` leaves the title's zip and XML."""
    return config.DATA_DIR / f"usc-{title}.zip", config.DATA_DIR / f"usc-{title}.xml"


def sqlite3_connect(path: Path):
    import sqlite3
    return sqlite3.connect(path)


def after_install(title: int | None = None) -> None:
    """Drop caches that depend on which U.S.C. sections exist: the U.S.C. id caches and the
    CFR render caches (their U.S.C. citations now link to the local copy)."""
    from . import store
    usc_store.clear_caches(title)
    store.clear_caches()


def remove(title: int) -> bool:
    title = valid_title(title)
    gone = False
    for p in (usc_store.db_path(title), usc_store.tree_path(title), *source_cache(title)):
        if p.exists():
            p.unlink()
            gone = True
    after_install(title)
    return gone


def status(release: dict | None = None) -> dict:
    """Installed titles with their release points and whether each is behind."""
    current = release["release_point"] if release else None
    rows = []
    for t in usc_store.installed_titles():
        s = usc_store.title_summary(t)
        if s is None:
            continue
        s["stale"] = bool(current and s["release_point"] != current)
        rows.append(s)
    return {"current_release": release, "titles": rows}


def outdated(release: dict) -> list[int]:
    return [r["title"] for r in status(release)["titles"] if r["stale"]]


# ---------------------------------------------------------------------------
# The Library's U.S. Code catalog (offline: static names + installed meta + cached release)
# ---------------------------------------------------------------------------

_CATALOG_PATH = Path(__file__).parent / "usc_titles.json"
_catalog_cache: dict | None = None


def static_catalog() -> dict:
    """`usc_titles.json`: {desks, titles{"N": {name, positive_law, desk, cfr[] | reserved}}}."""
    global _catalog_cache
    if _catalog_cache is None:
        try:
            _catalog_cache = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _catalog_cache = {"desks": [], "titles": {}}
    return _catalog_cache


def title_bytes(title: int) -> int:
    size = 0
    for p in (usc_store.db_path(title), usc_store.tree_path(title)):
        try:
            size += p.stat().st_size
        except OSError:
            pass
    return size


def catalog(include_appendix: bool = False) -> dict:
    """Every title 1-54 with its static facts, install summary, bytes on disk and, when this
    process has already asked the OLRC, whether it is behind the current release point.
    Never touches the network: `GET /api/usc/release?refresh=true` is the explicit check."""
    static = static_catalog()
    release = usc_client.cached_release()
    current = release["release_point"] if release else None
    installed = set(usc_store.installed_titles())
    rows = []
    for n in (usc_client.ALL_TITLES if include_appendix else usc_client.TITLE_RANGE):
        s = static["titles"].get(str(n), {})
        inst = usc_store.title_summary(n) if n in installed else None
        row = {
            "title": n,
            "label": usc_client.title_label(n),
            "name": s.get("name") or (inst or {}).get("name") or f"Title {n}",
            "reserved": n in usc_client.RESERVED or bool(s.get("reserved")),
            "positive_law": bool(inst["positive_law"]) if inst else bool(s.get("positive_law")),
            "desk": s.get("desk") or "More titles",
            "cfr": list(s.get("cfr") or []),
            "installed": None,
        }
        if inst:
            row["installed"] = {
                "release_point": inst["release_point"],
                "built_at": inst["built_at"],
                "section_count": inst["section_count"],
                "note_count": inst["note_count"],
                "bytes": title_bytes(n),
                "stale": bool(current and inst["release_point"] != current),
            }
        rows.append(row)
    return {
        "release": ({"release_point": release["release_point"], "current_through": release.get("current_through")}
                    if release else None),
        "desks": list(static.get("desks") or []),
        "titles": rows,
    }


def queue_titles(titles: list[int]) -> dict:
    """Queue installs for titles that aren't installed and, when the current release point is
    known, updates for installed titles behind it (a bundle download). Reserved titles skip."""
    from . import library as lib
    release = usc_client.cached_release()
    current = release["release_point"] if release else None
    queued, skipped = [], []
    for n in dict.fromkeys(int(t) for t in titles):
        if n not in usc_client.ALL_TITLES or n in usc_client.RESERVED:
            skipped.append({"title": n, "code": "usc", "reason": "reserved"})
            continue
        if lib.queue.busy_with(job_key(n)):
            skipped.append({"title": n, "code": "usc", "reason": "queued"})
            continue
        inst = usc_store.title_summary(n)
        if inst is None:
            queued.append(submit(n, "usc-title"))
        elif current and inst["release_point"] != current:
            queued.append(submit(n, "usc-update"))
        else:
            skipped.append({"title": n, "code": "usc", "reason": "current"})
    return {"queued": queued, "skipped": skipped, "count": len(queued)}


# ---------------------------------------------------------------------------
# Library queue and daily check
# ---------------------------------------------------------------------------

def job_key(title: int) -> int:
    return USC_JOB_BASE + int(title)


def submit(title: int, kind: str = "usc-title") -> dict:
    from . import library as lib
    title = valid_title(title)
    label = f"U.S. Code Title {title}" if kind == "usc-title" else f"Update U.S. Code Title {title}"
    return lib.queue.submit(job_key(title), kind, {"usc_title": title}, label)


def run_job(job: dict, report) -> None:
    title = int((job.get("target") or {}).get("usc_title") or job["title"] - USC_JOB_BASE)
    with usc_client.client() as c:
        release = usc_client.current_release(c)
    inst = usc_store.title_summary(title)
    if inst and inst["release_point"] == release["release_point"]:
        report("Already installed", 1, 1)
        return
    if job["kind"] == "usc-update" and inst is None:
        raise ValueError(f"U.S. Code Title {title} isn't installed")
    build(title, force=True, progress=report, release=release)


def update_all(release: dict | None = None, only: set[int] | None = None) -> dict:
    """Queue updates for installed titles behind `release` (only those in `only`, when given:
    the scheduled check skips titles unchecked in the source registry)."""
    release = release or usc_client.current_release()
    queued = [submit(t, "usc-update") for t in outdated(release) if only is None or t in only]
    return {"release_point": release["release_point"], "queued": queued, "count": len(queued)}


def maybe_queue_updates(now: datetime | None = None) -> dict | None:
    """Called by the news worker on each wake. At most once a day (6 h after a failed
    check) it asks the OLRC for the current release point and queues updates for installed
    titles that are behind. Does nothing when no U.S.C. title is installed."""
    global _last_check, _last_check_ok
    from .sources import selection
    now = now or datetime.now(timezone.utc)
    src = selection.source("usc")
    if not src["enabled"] or src["schedule"] == "manual":
        return None
    wanted = set(selection.usc_titles())
    if not set(usc_store.installed_titles()) & wanted:
        return None
    with _check_lock:
        every = timedelta(days=7) if src["schedule"] == "weekly" else CHECK_EVERY
        wait = every if _last_check_ok else RETRY_AFTER_FAILURE
        if _last_check is not None and now - _last_check < wait:
            return None
        _last_check = now
    try:
        res = update_all(usc_client.current_release(force=True), only=wanted)
        _last_check_ok = True
        return res
    except Exception as exc:
        _last_check_ok = False
        log(f"daily release check failed: {exc}")
        return None


def reset_schedule() -> None:
    global _last_check, _last_check_ok
    with _check_lock:
        _last_check, _last_check_ok = None, True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Build U.S. Code titles from the OLRC's USLM XML.")
    parser.add_argument("--title", type=int, action="append", help="title number (repeatable)")
    parser.add_argument("--force", action="store_true", help="rebuild even if installed")
    parser.add_argument("--update", action="store_true", help="rebuild installed titles that are behind")
    parser.add_argument("--status", action="store_true", help="show installed vs current release points")
    parser.add_argument("--keep-xml", action="store_true", help="keep the extracted XML in data/")
    parser.add_argument("--keep-source", action="store_true",
                        help="keep the zip and XML in data/ so `python -m app.integrity` can re-hash them")
    args = parser.parse_args(argv)
    try:
        if args.status:
            print(json.dumps(status(usc_client.current_release()), indent=2))
            return
        if args.update:
            release = usc_client.current_release()
            for t in outdated(release):
                print(json.dumps(build(t, force=True, release=release)))
            return
        if not args.title:
            parser.error("give --title N (or --update / --status)")
        release = usc_client.current_release()
        for t in args.title:
            print(json.dumps(build(t, force=args.force, release=release, keep_xml=args.keep_xml,
                                   keep_source=args.keep_source), indent=2))
    except (usc_client.SourceUnavailable, ValueError, zipfile.BadZipFile) as exc:
        log(f"failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
