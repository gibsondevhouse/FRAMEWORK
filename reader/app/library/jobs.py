"""The install queue: one background worker, cancellable jobs, batch downloads."""
from __future__ import annotations

import itertools
import threading
import time
from collections import deque

import httpx

from .. import build, config, store
from .. import library as lib

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
                lib.run_job(job, self._progress(job))
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
                lib._remove_partial_files(job["title"])

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


def queue_titles(titles: list[int]) -> dict:
    """Queue whole-title downloads for `titles`, skipping reserved titles and ones already
    installed whole at the latest edition; a whole title on an older edition is updated."""
    queued, skipped = [], []
    for n in dict.fromkeys(titles):
        info = lib.ecfr_title(n)
        inst = lib.installed(n)
        if info.get("reserved"):
            skipped.append({"title": n, "reason": "reserved"})
            continue
        latest = info.get("up_to_date_as_of")
        if inst and inst["scope"] is None:
            if inst["edition"] and latest and latest > inst["edition"]:
                queued.append(lib.queue.submit(n, "update", None, f"Update Title {n}"))
            else:
                skipped.append({"title": n, "reason": "current"})
            continue
        queued.append(lib.queue.submit(n, "title", None, f"Title {n}"))
    return {"queued": queued, "skipped": skipped, "count": len(queued)}


def outdated() -> list[int]:
    """Installed titles (whole or partial) whose edition is older than eCFR's latest."""
    latest = {t["number"]: t.get("up_to_date_as_of") for t in lib.ecfr_titles()}
    out = []
    for n in config.installed_titles():
        inst = lib.installed(n)
        if inst and inst["edition"] and latest.get(n) and latest[n] > inst["edition"]:
            out.append(n)
    return out


def update_all() -> dict:
    """Queue an update for every outdated installed title, keeping each one's scope."""
    queued = [lib.queue.submit(n, "update", None, f"Update Title {n}") for n in lib.outdated()]
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
    inst = lib.installed(title)
    if job["kind"] == "update":
        if inst is None:
            raise ValueError(f"Title {title} isn't installed")
        scope = inst["scope"]
    else:
        add = requested_scope(job["kind"], job["target"])
        scope = add if inst is None else build.merge_scope(inst["scope"], add)
        if inst is not None and scope == inst["scope"] and inst["edition"] == lib.ecfr_title(title)["up_to_date_as_of"]:
            report("Already installed", 1, 1)
            return
    build.build(
        title=title, force=True, scope=scope, progress=report,
        before_install=lambda: store.release_title(title),
    )
    store.release_title(title)


queue = Queue()
