"""What the reader keeps on disk: install state, storage accounting, cleanup, removal."""
from __future__ import annotations

import json
import time

from .. import config, store
from .. import library as lib

def installed(title: int) -> dict | None:
    """None if not installed or unreadable, else {edition, section_count, scope} (scope None = whole title)."""
    if title not in config.installed_titles():
        return None
    m, unreadable = store.safe_meta(title)
    if unreadable:
        return None
    try:
        section_count = int(m.get("section_count", 0))
    except (TypeError, ValueError):
        section_count = 0
    raw = m.get("scope")
    try:
        scope = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        scope = None
    return {
        "edition": m.get("edition"),
        "section_count": section_count,
        "scope": scope,
    }


def _db_bytes(title: int) -> int | None:
    try:
        return config.db_path(title).stat().st_size
    except OSError:
        return None


def _install_summary(inst: dict | None, title: int | None = None) -> dict | None:
    if inst is None:
        return None
    scope = inst["scope"]
    return {
        "edition": inst["edition"],
        "section_count": inst["section_count"],
        "bytes": _db_bytes(title) if title is not None else None,  # the database on disk
        "whole": scope is None,
        "parts": None if scope is None else len(scope["parts"]),
        "sections": None if scope is None else len(scope["sections"]),
    }


def _remove_partial_files(title: int) -> None:
    """Delete what a cancelled build left behind: its downloaded XML and unfinished database.
    The live title's files are untouched (a build only replaces them after "Installing")."""
    patterns = [f"title-{title}.tmp", f"title-{title}.xml.tmp*", f"title-{title}.piece*.xml.tmp*", f"tree-{title}.json.tmp"]
    for pattern in patterns:
        for f in config.DATA_DIR.glob(pattern):
            try:
                f.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Storage: what the reader keeps on disk, and cleaning up after interrupted builds
# ---------------------------------------------------------------------------

# Staging databases of resumable builds: kept so the next run picks up where one stopped.
RESUMABLE_STAGING = {"fr.sqlite3.tmp", "plaw.sqlite3.tmp", "agenda.sqlite3.tmp"}


def _is_temp(name: str) -> bool:
    # Builds write `title-N.tmp`, `title-N(.pieceI).xml.tmp(.download)` and `tree-N.json.tmp`.
    if name in RESUMABLE_STAGING:
        return False
    return ".tmp" in name or name.endswith(".download")


def storage() -> dict:
    """Bytes per installed CFR title (database + contents tree), per installed U.S. Code title
    (`usc`), Title 29's legacy copies, and
    leftover temporary files from builds that didn't finish."""
    titles = []
    for n in config.installed_titles():
        size = 0
        for f in (config.db_path(n), config.tree_path(n)):
            try:
                size += f.stat().st_size
            except OSError:
                pass
        titles.append({"title": n, "bytes": size})
    legacy = 0
    for name in ("title29.sqlite3", "tree.json"):
        f = config.DATA_DIR / name
        if f.exists() and f not in (config.db_path(29), config.tree_path(29)):
            legacy += f.stat().st_size
    from .. import usc_build, usc_store
    usc = [{"title": n, "bytes": usc_build.title_bytes(n)} for n in usc_store.installed_titles()]
    temp = [f for f in config.DATA_DIR.glob("*") if f.is_file() and _is_temp(f.name)] if config.DATA_DIR.exists() else []
    temp_bytes = sum(f.stat().st_size for f in temp)
    return {
        "titles": titles,
        "usc": usc,
        "legacy_bytes": legacy,
        "temp_files": len(temp),
        "temp_bytes": temp_bytes,
        "total_bytes": sum(t["bytes"] for t in titles) + sum(t["bytes"] for t in usc) + legacy + temp_bytes,
    }


def prune_temp() -> dict:
    """Delete leftover temporary build files. Refused while a download is queued or running,
    since those files may be in use."""
    with lib.queue.operation_lock():
        snap = lib.queue.snapshot()
        if snap["current"] or snap["queued"]:
            raise RuntimeError("A download is in progress. Clean up once it has finished.")
        freed, removed = 0, 0
        if config.DATA_DIR.exists():
            for f in config.DATA_DIR.glob("*"):
                if f.is_file() and _is_temp(f.name):
                    try:
                        size = f.stat().st_size
                        f.unlink()
                        freed += size
                        removed += 1
                    except OSError:
                        pass
        return {"removed": removed, "freed_bytes": freed}


def remove(title: int) -> None:
    """Delete an installed title's database and contents (and Title 29's legacy copies)."""
    files = [config.DATA_DIR / f"title-{title}.sqlite3", config.DATA_DIR / f"tree-{title}.json"]
    if title == 29:
        files += [config.DATA_DIR / "title29.sqlite3", config.DATA_DIR / "tree.json"]
    store.begin_swap(title)
    try:
        for f in files:
            for attempt in range(40):
                try:
                    f.unlink(missing_ok=True)
                    break
                except PermissionError:
                    if attempt == 39:
                        raise
                    store.release_title(title)
                    time.sleep(0.25)
    finally:
        store.end_swap(title)


def reload_installed() -> list[int]:
    """Release cached SQLite handles, tree/render caches, and library structure caches so
    CLI-rebuilt titles on disk are visible without restarting the server."""
    with lib.queue.operation_lock():
        titles = config.installed_titles()
        for n in titles:
            store.release_title(n)
        store.clear_caches()
        from .. import usc_store
        usc_store.clear_caches()  # CLI-built U.S.C. titles (python -m app.usc_build)
        with lib._cache_lock:
            lib._structures.clear()
        return titles
