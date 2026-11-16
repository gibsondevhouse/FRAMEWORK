"""What the reader keeps on disk: install state, storage accounting, cleanup, removal."""
from __future__ import annotations

import json
import time

from .. import config, store
from .. import library as lib

def installed(title: int) -> dict | None:
    """None if not installed, else {edition, section_count, scope} (scope None = whole title)."""
    if title not in config.installed_titles():
        return None
    m = store.meta(title)
    raw = m.get("scope")
    return {
        "edition": m.get("edition"),
        "section_count": int(m.get("section_count", 0)),
        "scope": json.loads(raw) if raw else None,
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
    import gc
    gc.collect()  # the abandoned build's SQLite connection is only closed once collected
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

def _is_temp(name: str) -> bool:
    # Builds write `title-N.tmp`, `title-N(.pieceI).xml.tmp(.download)` and `tree-N.json.tmp`.
    return ".tmp" in name


def storage() -> dict:
    """Bytes per installed title (database + contents tree), Title 29's legacy copies, and
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
    temp = [f for f in config.DATA_DIR.glob("*") if f.is_file() and _is_temp(f.name)] if config.DATA_DIR.exists() else []
    temp_bytes = sum(f.stat().st_size for f in temp)
    return {
        "titles": titles,
        "legacy_bytes": legacy,
        "temp_files": len(temp),
        "temp_bytes": temp_bytes,
        "total_bytes": sum(t["bytes"] for t in titles) + legacy + temp_bytes,
    }


def prune_temp() -> dict:
    """Delete leftover temporary build files. Refused while a download is queued or running,
    since those files may be in use."""
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
    for f in files:
        for attempt in range(40):
            store.release_title(title)
            try:
                f.unlink(missing_ok=True)
                break
            except PermissionError:
                if attempt == 39:
                    raise
                time.sleep(0.25)
    store.release_title(title)
