# Stage 3: Verification, Baselines & Documentation Sync

## Goal
Verify every behavioral, API, fault-tolerance, build-stamp, and visual regression gate across macOS and prepare clean documentation + CI guidance for Windows visual baselines.

---

## Verification Steps

### 1. Automated Test Updates (`reader/tests/`)
- **`tests/test_api_snapshots.py`**:
  - Update `snapshots/route_inventory.json` to include `GET /api/titles/snapshot`.
  - Record `snapshots/get_titles_snapshot.json` asserting the exact offline snapshot structure across fake Titles 29, 40, and 49.
- **`tests/test_api_endpoints.py` & `tests/test_federated_store.py`**:
  - Test `store.known_ids()` recovery after transient `sqlite3.OperationalError`.
  - Test `/api/titles` and `/api/titles/snapshot` resilience when one DB file is unreadable/corrupt.
  - Test `news_store.connect(readonly=True)` avoids creating `osha_news.sqlite3` when missing.
  - Test `library.jobs.Queue` thread-safe state transitions inside `self._lock`.
- **`tests/test_browser_parity.py`**:
  - Replace `mask.getdata()` with `mask.get_flattened_data()` to eliminate the 6 Pillow `DeprecationWarning`s.
  - Update Home behavior tests to verify:
    - Band 1 (**Continue reading** + **Workspaces**), Band 2 (**Downloaded Titles** hydrated from `/api/titles/snapshot`), and Band 3 (**Regulatory Pulse**) render with zero external network requests.
    - Removed developer chrome (`#hm-jump-input`, `Import JSON`, `Commands`, `Connections`, `DOL inspection sync is off`) is absent from `#/`.
  - Wait for `.hm-titles[data-snapshot-loaded="1"]` and `.hm-news[data-news-loaded="1"]` before capturing `overview-dark-desktop` and `overview-light-desktop`.

### 2. Visual Baseline Recording & Inspection
- Regenerate `reader/tests/baselines/darwin/*.png` using `UPDATE_BASELINES=1 REQUIRE_BROWSER=1`.
- Visually inspect `overview-dark-desktop.png` and `overview-light-desktop.png` on `1280×800` to confirm Band 1 and Band 2 fit cleanly above the fold.
- Document that `reader/tests/baselines/win32/` must be refreshed via GitHub Actions `workflow_dispatch` (`record_baselines: true`) or on Windows.

### 3. Documentation Sync
- Update `CLAUDE.md` and `reader/API.md` to document `GET /api/titles/snapshot`, the hardened `store.py`/`news_store.py` contracts, and the refactored 3-band Home screen.

## Exit Gate
- `cd reader/frontend && npm run build && npx tsc --noEmit` passes.
- `cd reader && REQUIRE_BROWSER=1 ../.venv/bin/python -m pytest tests -q` passes with **0 failures** and **0 Pillow deprecation warnings**.
- `git status` shows committed `reader/static/dist/` matching `build-stamp.json`.
