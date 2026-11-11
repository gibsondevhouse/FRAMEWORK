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
import threading
import time
from collections import deque

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


def _install_summary(inst: dict | None) -> dict | None:
    if inst is None:
        return None
    scope = inst["scope"]
    return {
        "edition": inst["edition"],
        "section_count": inst["section_count"],
        "whole": scope is None,
        "parts": None if scope is None else len(scope["parts"]),
        "sections": None if scope is None else len(scope["sections"]),
    }


def catalog() -> list[dict]:
    rows = []
    for t in sorted(ecfr_titles(), key=lambda t: t["number"]):
        n = t["number"]
        inst = installed(n)
        rows.append({
            "title": n,
            "name": t.get("name") or f"Title {n}",
            "latest": t.get("up_to_date_as_of"),
            "reserved": bool(t.get("reserved")),
            "installed": _install_summary(inst),
        })
    return rows


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
        "reserved": bool(info.get("reserved")), "installed": _install_summary(inst), "groups": groups,
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

class Queue:
    """Runs installs one after another on a single worker thread."""

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
            try:
                run_job(job, self._progress(job))
                job["state"] = "done"
            except Exception as exc:  # report, keep the worker alive
                build.log(f"library job {job['id']} failed: {exc}")
                job["state"] = "error"
                job["error"] = _friendly(exc)
            finally:
                with self._lock:
                    job["finished_at"] = time.time()
                    self._recent.append(job)
                    self._current = None

    def _progress(self, job: dict):
        def report(phase: str, done=None, total=None) -> None:
            with self._lock:
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
