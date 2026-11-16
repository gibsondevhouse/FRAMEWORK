"""The download library: browse every CFR title on eCFR and install a title, a part or a
section into the reader.

Installs run one at a time on a background thread (`Queue`). A partial install's scope lives
in the title database's `meta.scope` (see `build.normalize_scope`); downloading more of a
title rebuilds it with the union of what it had and what was asked for, at the latest
edition. Downloading the whole title replaces any partial copy.
"""
from __future__ import annotations

import itertools
import json
import re
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from . import build, config, store

CATALOG_TTL = 30 * 60  # seconds; eCFR's title list changes at most daily

_cache_lock = threading.Lock()
_catalog: tuple[float, list[dict]] | None = None
_structures: dict[tuple[int, str], dict] = {}


def _client() -> httpx.Client:
    return httpx.Client(headers=build.HEADERS, timeout=httpx.Timeout(30.0, read=120.0), follow_redirects=True)


def ecfr_titles(refresh: bool = False) -> list[dict]:
    """eCFR's list of all 50 titles (number, name, up_to_date_as_of, reserved), cached."""
    global _catalog
    with _cache_lock:
        if _catalog and not refresh and time.time() - _catalog[0] < CATALOG_TTL:
            return _catalog[1]
    with _client() as c:
        titles = build.fetch_json(c, f"{config.ECFR_API}/titles.json").get("titles", [])
    with _cache_lock:
        _catalog = (time.time(), titles)
    return titles


def catalog_checked_at() -> float | None:
    """When eCFR's title list was last fetched (epoch seconds), or None if never."""
    with _cache_lock:
        return _catalog[0] if _catalog else None


def ecfr_title(title: int) -> dict:
    info = next((t for t in ecfr_titles() if t["number"] == title), None)
    if not info:
        raise LookupError(f"Title {title} is not on eCFR")
    return info


def structure(title: int) -> dict:
    """The latest edition's contents tree for a title, trimmed and nested like tree.json."""
    edition = ecfr_title(title)["up_to_date_as_of"]
    key = (title, edition)
    with _cache_lock:
        if key in _structures:
            return _structures[key]
    with _client() as c:
        raw = build.fetch_json(c, f"{config.ECFR_API}/structure/{edition}/title-{title}.json")
    tree = build.nest_loose_sections(build.trim_tree(raw))
    with _cache_lock:
        # Keep a handful; a structure is a few MB for the largest titles.
        if len(_structures) >= 8:
            _structures.pop(next(iter(_structures)))
        _structures[key] = tree
    return tree


# ---------------------------------------------------------------------------
# What's installed
# ---------------------------------------------------------------------------

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


def _load_blurbs() -> dict:
    try:
        return json.loads((Path(__file__).parent / "title_blurbs.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


_BLURBS = _load_blurbs()
DESKS: list[str] = list(_BLURBS.get("desks", []))
OTHER_DESK = "More titles"  # a title eCFR adds that has no editorial entry yet

# Compliance suites: titles that are usually read together, downloadable in one go
# (`POST /api/library/batch-download {"suite": id}`). A new suite is one entry here; its size
# and section count are summed from the titles' measured figures in title_blurbs.json.
COMPLIANCE_SUITES: dict[str, dict] = {
    "ehs": {
        "name": "Environment, Health & Safety",
        "badge": "Core compliance",
        "featured": True,
        "titles": [29, 40, 49],
        "summary": "Workplace safety and health (OSHA), environmental protection (EPA) and hazardous materials "
                   "transport (DOT): the baseline an EHS program is audited against.",
    },
    "trade": {
        "name": "Commerce, Banking & Securities",
        "badge": "Financial markets",
        "titles": [12, 15, 17],
        "summary": "Bank and credit union rules, Commerce export controls, and SEC and CFTC market regulation.",
    },
    "govcon": {
        "name": "Federal Contracting",
        "badge": "Government",
        "titles": [41, 48],
        "summary": "The Federal Acquisition Regulation and agency supplements, with GSA property and travel rules.",
    },
}


def suites() -> dict[str, dict]:
    """The suites with their id and estimated size (MB of eCFR text) and section count."""
    blurbs = _BLURBS.get("titles", {})
    out = {}
    for sid, s in COMPLIANCE_SUITES.items():
        bs = [blurbs.get(str(n), {}) for n in s["titles"]]
        out[sid] = {
            "id": sid, "featured": bool(s.get("featured")), **s,
            "size_mb": round(sum(b.get("size_mb") or 0 for b in bs), 1),
            "sections": sum(b.get("sections") or 0 for b in bs),
        }
    return out


def catalog() -> list[dict]:
    """Every eCFR title with its editorial summary and desk, recency and install state."""
    blurbs = _BLURBS.get("titles", {})
    rows = []
    for t in sorted(ecfr_titles(), key=lambda t: t["number"]):
        n = t["number"]
        inst = installed(n)
        b = blurbs.get(str(n), {})
        rows.append({
            "title": n,
            "name": t.get("name") or f"Title {n}",
            "latest": t.get("up_to_date_as_of"),
            "amended": t.get("latest_amended_on"),  # when the title's text last changed
            "reserved": bool(t.get("reserved")),
            "summary": b.get("summary", ""),
            "desk": b.get("desk", OTHER_DESK),
            "featured": bool(b.get("featured")),
            "agencies": list(b.get("agencies", [])),
            "size_mb": b.get("size_mb"),    # estimate: eCFR's full-text size of the title
            "sections": b.get("sections"),  # estimate: sections and appendices with text
            "installed": _install_summary(inst, n),
        })
    return rows


# ---------------------------------------------------------------------------
# The wire: what changed in the most recently amended titles
# ---------------------------------------------------------------------------

_changes: dict[tuple[int, str], dict] = {}


def _clean(name: str) -> str:
    return re.sub(r"\s+", " ", name or "").strip()


def changes(title: int, amended: str) -> dict:
    """What eCFR amended in a title on its latest amendment date: the count of sections and
    appendices, their parts, and the first one's heading. Cached per (title, date)."""
    key = (title, amended)
    with _cache_lock:
        if key in _changes:
            return _changes[key]
    with _client() as c:
        raw = build.fetch_json(c, f"{config.ECFR_API}/versions/title-{title}.json?issue_date%5Bgte%5D={amended}")
    versions = raw.get("content_versions", [])
    # An issue republishes neighbouring sections too; the amendments are the ones dated that day
    # (or marked substantive). An issue with neither only made editorial revisions.
    hits = [v for v in versions if v.get("amendment_date") == amended] or [v for v in versions if v.get("substantive")]
    kind = "amended" if hits else "revised"
    hits = hits or versions
    parts: list[str] = []
    for v in hits:
        p = str(v.get("part") or "")
        if p and p not in parts:
            parts.append(p)
    first = hits[0] if hits else None
    out = {
        "title": title, "amended": amended, "count": len(hits), "kind": kind,
        "removed": sum(1 for v in hits if v.get("removed")),
        "parts": parts,
        "first": None if not first else {"id": first.get("identifier"), "name": _clean(first.get("name", ""))},
    }
    with _cache_lock:
        if len(_changes) >= 64:
            _changes.pop(next(iter(_changes)))
        _changes[key] = out
    return out


def wire(limit: int = 5) -> list[dict]:
    """The `limit` most recently amended titles, newest first, each with `changes()`; a title
    whose change list can't be fetched still lists, with `count` None."""
    live = [t for t in ecfr_titles() if not t.get("reserved") and t.get("latest_amended_on")]
    live.sort(key=lambda t: (t["latest_amended_on"], -t["number"]), reverse=True)
    top = live[:limit]

    def one(t: dict) -> dict:
        try:
            return changes(t["number"], t["latest_amended_on"])
        except (httpx.HTTPError, ValueError, KeyError):
            return {"title": t["number"], "amended": t["latest_amended_on"], "count": None, "kind": None, "parts": [], "first": None}

    with ThreadPoolExecutor(max_workers=min(5, len(top) or 1)) as ex:
        return list(ex.map(one, top))


def _leaves(node: dict) -> list[dict]:
    if node["t"] in build.LEAF_TYPES:
        return [node]
    return [leaf for c in node.get("c", []) for leaf in _leaves(c)]


def title_view(title: int) -> dict:
    """Every part of a title, under its chapter (or subtitle) label, with install state."""
    info = ecfr_title(title)
    inst = installed(title)
    scope = inst["scope"] if inst else None
    whole = inst is not None and scope is None
    parts_in = set(scope["parts"]) if scope else set()
    sections_by_part: dict[str, int] = {}
    for s in (scope or {}).get("sections", []):
        sections_by_part[s["part"]] = sections_by_part.get(s["part"], 0) + 1

    groups: list[dict] = []

    def walk(node: dict, label: str | None) -> None:
        if node["t"] in ("subtitle", "chapter"):
            d = (node.get("d") or "").strip()
            label = f'{node.get("l") or ""}{" — " + d if d else ""}'.strip() or label
        if node["t"] == "part":
            if not groups or groups[-1]["label"] != label:
                groups.append({"label": label, "parts": []})
            pid = str(node["id"])
            # `leaves` counts what can be downloaded: reserved sections have no text.
            leaves = sum(1 for leaf in _leaves(node) if not leaf.get("r"))
            have = sections_by_part.get(pid, 0)
            state = "all" if whole or pid in parts_in or (leaves and have >= leaves) else ("some" if have else None)
            groups[-1]["parts"].append({
                "id": pid, "l": node.get("l") or f"Part {pid}", "d": (node.get("d") or "").strip(),
                "r": bool(node.get("r")), "leaves": leaves,
                "installed": state, "installed_sections": sections_by_part.get(pid, 0),
            })
            return
        for c in node.get("c", []):
            walk(c, label)

    walk(structure(title), None)
    return {
        "title": title, "name": info.get("name"), "latest": info.get("up_to_date_as_of"),
        "reserved": bool(info.get("reserved")), "installed": _install_summary(inst, title), "groups": groups,
    }


def _find_part(node: dict, part: str) -> dict | None:
    if node["t"] == "part" and str(node["id"]) == part:
        return node
    for c in node.get("c", []):
        found = _find_part(c, part)
        if found:
            return found
    return None


def part_view(title: int, part: str) -> dict:
    """A part's sections and appendices (under subpart labels), with install state."""
    node = _find_part(structure(title), part)
    if node is None:
        raise LookupError(f"No Part {part} in Title {title}")
    inst = installed(title)
    scope = inst["scope"] if inst else None
    whole_part = inst is not None and (scope is None or part in scope["parts"])
    have = {(s["t"], s["id"]) for s in (scope or {}).get("sections", [])}

    groups: list[dict] = []

    def walk(n: dict, label: str | None) -> None:
        if n["t"] in build.LEAF_TYPES:
            if not groups or groups[-1]["label"] != label:
                groups.append({"label": label, "sections": []})
            groups[-1]["sections"].append({
                "t": n["t"], "id": str(n["id"]), "l": n.get("l") or "", "d": (n.get("d") or "").strip(),
                "r": bool(n.get("r")), "installed": whole_part or (n["t"], str(n["id"])) in have,
            })
            return
        if n["t"] in ("subpart", "subject_group") and n is not node:
            d = (n.get("d") or "").strip()
            label = f'{n.get("l") or ""}{" — " + d if d else ""}'.strip()
        for c in n.get("c", []):
            walk(c, label)

    walk(node, None)
    real = [s for g in groups for s in g["sections"] if not s["r"]]
    have_n = sum(1 for s in real if s["installed"])
    # Every downloadable section already in counts as the whole part.
    state = "all" if whole_part or (real and have_n == len(real)) else ("some" if have_n else None)
    return {
        "title": title, "part": part, "l": node.get("l") or f"Part {part}", "d": (node.get("d") or "").strip(),
        "installed": state, "groups": groups,
    }


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

class JobCancelled(Exception):
    """Raised inside a running build when its job is cancelled."""


class Queue:
    """Runs installs one after another on a single worker thread. A queued job can be
    cancelled outright; a running one stops at its next progress report, unless it has
    reached "Installing" (the files are being swapped in, so it finishes)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._wake = threading.Condition(self._lock)
        self._pending: deque[dict] = deque()
        self._recent: deque[dict] = deque(maxlen=10)
        self._current: dict | None = None
        self._ids = itertools.count(1)
        self._thread: threading.Thread | None = None

    # -- public --
    def submit(self, title: int, kind: str, target: dict | None, label: str) -> dict:
        """kind: 'title' | 'part' | 'section' | 'update'. target: the part/section asked for."""
        with self._lock:
            for j in [*self._pending, *( [self._current] if self._current else [])]:
                if j["title"] == title and j["kind"] == kind and j["target"] == target:
                    return dict(j)  # already queued or running
            job = {
                "id": next(self._ids), "title": title, "kind": kind, "target": target, "label": label,
                "state": "queued", "phase": "Waiting", "done": None, "total": None,
                "error": None, "queued_at": time.time(), "finished_at": None,
            }
            self._pending.append(job)
            self._ensure_worker()
            self._wake.notify()
            return dict(job)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "current": dict(self._current) if self._current else None,
                "queued": [dict(j) for j in self._pending],
                "recent": [dict(j) for j in reversed(self._recent)],
            }

    def cancel(self, job_id: int) -> dict | None:
        """Cancel a queued or running job. None if no such active job."""
        with self._lock:
            for j in self._pending:
                if j["id"] == job_id:
                    self._pending.remove(j)
                    self._finish_cancelled(j)
                    return dict(j)
            if self._current and self._current["id"] == job_id:
                if self._current["phase"] != "Installing":
                    self._current["cancelling"] = True
                return dict(self._current)
        return None

    def clear(self) -> list[dict]:
        """Cancel every queued job (not the running one)."""
        with self._lock:
            gone = list(self._pending)
            self._pending.clear()
            for j in gone:
                self._finish_cancelled(j)
            return [dict(j) for j in gone]

    def _finish_cancelled(self, job: dict) -> None:  # caller holds the lock
        job["state"] = "cancelled"
        job["phase"] = "Cancelled"
        job["finished_at"] = time.time()
        self._recent.append(job)

    def busy_with(self, title: int) -> bool:
        with self._lock:
            return any(j["title"] == title for j in [*self._pending, *([self._current] if self._current else [])])

    # -- worker --
    def _ensure_worker(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, name="library-worker", daemon=True)
            self._thread.start()

    def _run(self) -> None:
        while True:
            with self._lock:
                while not self._pending:
                    self._wake.wait()
                job = self._pending.popleft()
                job["state"] = "running"
                job["started_at"] = time.time()
                self._current = job
            cancelled = False
            try:
                run_job(job, self._progress(job))
                job["state"] = "done"
            except JobCancelled:
                cancelled = True
                job["state"] = "cancelled"
                job["phase"] = "Cancelled"
            except Exception as exc:  # report, keep the worker alive
                build.log(f"library job {job['id']} failed: {exc}")
                job["state"] = "error"
                job["error"] = _friendly(exc)
            finally:
                with self._lock:
                    job["finished_at"] = time.time()
                    job.pop("cancelling", None)
                    self._recent.append(job)
                    self._current = None
            if cancelled:
                _remove_partial_files(job["title"])

    def _progress(self, job: dict):
        def report(phase: str, done=None, total=None) -> None:
            with self._lock:
                if job.get("cancelling") and phase != "Installing":
                    raise JobCancelled()
                job["phase"], job["done"], job["total"] = phase, done, total
        return report


def _friendly(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"eCFR answered {exc.response.status_code} for that request."
    if isinstance(exc, httpx.HTTPError):
        return "Couldn't reach eCFR. Check the connection and try again."
    if isinstance(exc, PermissionError):
        return "The title's files were in use and couldn't be replaced. Try again."
    return str(exc) or exc.__class__.__name__


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
    snap = queue.snapshot()
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


# ---------------------------------------------------------------------------
# Several titles at once: a suite, or every outdated title
# ---------------------------------------------------------------------------

def queue_titles(titles: list[int]) -> dict:
    """Queue whole-title downloads for `titles`, skipping reserved titles and ones already
    installed whole at the latest edition; a whole title on an older edition is updated."""
    queued, skipped = [], []
    for n in dict.fromkeys(titles):
        info = ecfr_title(n)
        inst = installed(n)
        if info.get("reserved"):
            skipped.append({"title": n, "reason": "reserved"})
            continue
        latest = info.get("up_to_date_as_of")
        if inst and inst["scope"] is None:
            if inst["edition"] and latest and latest > inst["edition"]:
                queued.append(queue.submit(n, "update", None, f"Update Title {n}"))
            else:
                skipped.append({"title": n, "reason": "current"})
            continue
        queued.append(queue.submit(n, "title", None, f"Title {n}"))
    return {"queued": queued, "skipped": skipped, "count": len(queued)}


def outdated() -> list[int]:
    """Installed titles (whole or partial) whose edition is older than eCFR's latest."""
    latest = {t["number"]: t.get("up_to_date_as_of") for t in ecfr_titles()}
    out = []
    for n in config.installed_titles():
        inst = installed(n)
        if inst and inst["edition"] and latest.get(n) and latest[n] > inst["edition"]:
            out.append(n)
    return out


def update_all() -> dict:
    """Queue an update for every outdated installed title, keeping each one's scope."""
    queued = [queue.submit(n, "update", None, f"Update Title {n}") for n in outdated()]
    return {"queued": queued, "count": len(queued)}


def requested_scope(kind: str, target: dict | None) -> dict | None:
    if kind == "title":
        return None
    if kind == "part":
        return build.normalize_scope({"parts": [target["part"]], "sections": []})
    if kind == "section":
        return build.normalize_scope({"parts": [], "sections": [target]})
    raise ValueError(f"unknown job kind {kind!r}")


def run_job(job: dict, report) -> None:
    title = job["title"]
    inst = installed(title)
    if job["kind"] == "update":
        if inst is None:
            raise ValueError(f"Title {title} isn't installed")
        scope = inst["scope"]
    else:
        add = requested_scope(job["kind"], job["target"])
        scope = add if inst is None else build.merge_scope(inst["scope"], add)
        if inst is not None and scope == inst["scope"] and inst["edition"] == ecfr_title(title)["up_to_date_as_of"]:
            report("Already installed", 1, 1)
            return
    build.build(
        title=title, force=True, scope=scope, progress=report,
        before_install=lambda: store.release_title(title),
    )
    store.release_title(title)


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


queue = Queue()
