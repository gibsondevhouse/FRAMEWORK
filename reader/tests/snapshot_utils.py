"""Golden-file snapshot helpers for the API/SSE parity suite.

Snapshots are canonical JSON files under `tests/snapshots/`. A test calls
`assert_snapshot(self, name, payload)`; the payload is canonicalized first:

- volatile values (timestamps, on-disk byte counts) are replaced with
  "«normalized»" / "«int»" so re-runs and other machines compare equal, while
  `None` stays `None` so the *shape* is still pinned;
- long strings (rendered HTML) are replaced by their SHA-256 and length, which
  pins exact output without storing hundreds of kilobytes in git.

A missing snapshot FAILS unless UPDATE_SNAPSHOTS=1 is set, in which case the
current payload is recorded (same policy as the visual baselines).
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

SNAP_DIR = Path(__file__).resolve().parent / "snapshots"

# Values that legitimately differ across runs/machines, by key name, at any depth.
VOLATILE_KEYS = {
    "checked_at", "built_at", "created_at", "fetched_at",
    "queued_at", "started_at", "finished_at",
    "last_ok_at", "last_error_at", "next_due_at", "retry_after",
    "bytes", "legacy_bytes", "temp_bytes", "total_bytes", "freed_bytes",
}

HASH_OVER_CHARS = 4000


def canonicalize(value, key: str | None = None):
    if key in VOLATILE_KEYS and value is not None:
        return "«int»" if isinstance(value, (int, float)) and not isinstance(value, bool) else "«normalized»"
    if isinstance(value, dict):
        return {k: canonicalize(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [canonicalize(v) for v in value]
    if isinstance(value, str) and len(value) > HASH_OVER_CHARS:
        return {"«sha256»": hashlib.sha256(value.encode("utf-8")).hexdigest(), "chars": len(value)}
    return value


def assert_snapshot(test, name: str, payload) -> None:
    """Compare `payload` (after canonicalization) against tests/snapshots/{name}.json."""
    canon = canonicalize(payload)
    path = SNAP_DIR / f"{name}.json"
    if os.environ.get("UPDATE_SNAPSHOTS") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(canon, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        return
    if not path.exists():
        test.fail(f"Missing snapshot {path.name}; run once with UPDATE_SNAPSHOTS=1 to record it.")
    expected = json.loads(path.read_text(encoding="utf-8"))
    test.maxDiff = None
    test.assertEqual(expected, json.loads(json.dumps(canon, sort_keys=True)),
                     f"Snapshot {path.name} drifted")


def sse_events(body: str) -> list[dict]:
    """Parse an SSE body (`data: {json}` lines) into the list of event dicts."""
    events = []
    for chunk in body.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            events.append(json.loads(chunk[len("data: "):]))
    return events
