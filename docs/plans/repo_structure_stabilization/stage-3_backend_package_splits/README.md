# Stage 3: Core Backend Package Splits (`render.py`, `library.py`, `build.py`)

## Goal
Decompose `render.py` (833 lines), `library.py` (647 lines), and `build.py` (593 lines) into cohesive submodules without breaking module-level test stubs, colliding attribute names, or CLI entrypoints.

## Target Layout

### 1. `reader/app/render/` (replacing `render.py`)
- `text.py`: `element_to_text`, `BLOCK_TAGS`, `CELL_TAGS`
- `hierarchy.py`: `LevelTracker`, `ROMAN`, `ROMAN_ORDER`, `marker_tokens`, `compute_levels`
- `linkifier.py`: `make_linkifier`, `_outside_anchors`, citation regex constants (keep `_CROSS_TITLE`, `_NUM_IN_LIST`, `_XREF` exported for `news.py:23`, or expose public names and update `news.py`)
- `units.py`: `SectionDoc`, `section_doc` (imported by `store.py:12`), `split_units`, `_appendix_units`, `_chapter_units`
- `html.py`: `Renderer`, `render_leaf_html`, `render_fragment_html`, `image_urls`
- `__init__.py`: Re-export all public and test/internal facade symbols.

### 2. `reader/app/library/` (replacing `library.py`)
- **Avoid Name Shadowing**: Do **NOT** name submodules `queue.py` or `storage.py`, because `library.py:647` exposes `queue = Queue()` and `library.py:509` defines `def storage()`. Importing those submodules would overwrite the attribute bindings on `app.library`.
- Use non-colliding filenames:
  - `client.py`: Upstream eCFR API client (`_client`, `ecfr_titles`, `ecfr_title`, `structure`, `catalog`)
  - `suites.py`: Curated suites and `_load_blurbs`
  - `disk.py`: `installed`, `storage`, `prune_temp`, `_remove_partial_files`
  - `jobs.py`: `Queue`, `JobCancelled`, `run_job`, `queue_titles`, `update_all`, and module-level `queue = Queue()`
  - `views.py`: `title_view`, `part_view`, `changes`, `wire`
  - `__init__.py`: Facade re-exporting all functions and `queue`.

### 3. `reader/app/ingest/` (supporting `build.py`)
- `tree.py`: `trim_tree`, `nest_loose_sections`, `normalize_scope`, `merge_scope`, `prune_tree`, `renest`
- `parse.py`: `stream_parse_xml`, `ecfr_path`, `front_matter_xml`
- Keep `reader/app/build.py` as the orchestrator and CLI entrypoint (`python -m app.build`).

## Critical Test-Stub & Circular-Import Rules
1. **Intra-File & Inter-File Patch Safety**:
   - Tests monkeypatch 34 attributes directly on `app.library` and `app.build` (e.g., `library.ecfr_titles`, `library.installed`, `library.run_job`, `library.queue`, `build.fetch_json`, `build.download_stream`, `build.log`).
   - Even **within the same file** (such as `Queue` calling `run_job` inside `jobs.py`, mirroring `library.py:448`), calls to any patchable function MUST go through the package namespace (`import app.library as lib; lib.run_job(...)`) rather than local direct calls or `from .client import ...` bindings.
2. **No Circular Import Between `build` and `ingest/tree.py`**:
   - `renest()` calls `log()` (`build.py:261`). Rather than `ingest/tree.py` importing `build` (circular), pass `log=log` as an injected parameter (defaulting to a local helper, with `build.renest` passing `log=build.log` so `FakeTitles` patches on `build.log` stay effective).
3. **Docs Sync**:
   - Update `CLAUDE.md` backend layout immediately upon stage completion.

## Exit Gate
- All tests pass under the universal network guard.
- Stage 1 API JSON snapshots pass 100%.
- `PYTHONPATH=reader python -m app.build --help` executes cleanly.
