# Stage 3: Core Backend Package Splits (`render.py`, `library.py`, `build.py`)

## Goal
Decompose `render.py` (833 lines), `library.py` (647 lines), and `build.py` (593 lines) into single-responsibility submodules without breaking module-level test stubs, shadowing module attributes, or introducing circular imports.

## Branch & Tag Discipline
- Branch `stage-3-backend-packages` from `stage-2-passed`; merge via PR after gate passes and tag `stage-3-passed`.

## Target Layout

### 1. `reader/app/render/` (replacing `render.py`)
- `text.py`: `element_to_text`, `BLOCK_TAGS`, `CELL_TAGS`
- `hierarchy.py`: `LevelTracker`, `ROMAN`, `ROMAN_ORDER`, `marker_tokens`, `compute_levels`
- `linkifier.py`: `make_linkifier`, `_outside_anchors`, citation regex constants (keep `_CROSS_TITLE`, `_NUM_IN_LIST`, `_XREF` exported for `news.py:23`, or promote to public names and update `news.py`)
- `units.py`: `SectionDoc`, `section_doc` (imported by `store.py:12`), `split_units`, `_appendix_units`, `_chapter_units`
- `html.py`: `Renderer`, `render_leaf_html`, `render_fragment_html`, `image_urls`
- `__init__.py`: Facade re-exporting all public and required internal symbols.

### 2. `reader/app/library/` (replacing `library.py`)
- **Non-Shadowing Filenames**: Do **NOT** name submodules `queue.py` or `storage.py`, because `library.py:647` exposes `queue = Queue()` and `library.py:509` defines `def storage()`. Importing submodules with those names would overwrite the attributes on `app.library`.
- Use:
  - `client.py`: Upstream eCFR API client (`_client`, `ecfr_titles`, `ecfr_title`, `structure`, `catalog`)
  - `suites.py`: Curated suites and `_load_blurbs`
  - `disk.py`: `installed`, `storage`, `prune_temp`, `_remove_partial_files`
  - `jobs.py`: `Queue`, `JobCancelled`, `run_job`, `queue_titles`, `update_all`, and `queue = Queue()`
  - `views.py`: `title_view`, `part_view`, `changes`, `wire`
  - `__init__.py`: Facade re-exporting all functions and `queue`.

### 3. `reader/app/ingest/` (supporting `build.py`)
- `tree.py`: `trim_tree`, `nest_loose_sections`, `normalize_scope`, `merge_scope`, `prune_tree`, `renest`
- `parse.py`: `stream_parse_xml`, `ecfr_path`, `front_matter_xml`
- Keep `reader/app/build.py` as the orchestrator and CLI entrypoint (`python -m app.build`).

## Critical Implementation Rules
1. **Intra-File & Inter-File Patch Safety**:
   - Tests patch 34 attributes directly on `app.library` and `app.build` (`library.ecfr_titles`, `library.installed`, `library.run_job`, `library.queue`, `build.fetch_json`, `build.download_stream`, `build.log`).
   - **Rule**: Every patchable function—including intra-file calls such as `Queue` calling `run_job` inside `jobs.py` (`library.py:448`)—**MUST** call through the package namespace (`import app.library as lib; lib.run_job(...)`), never via direct local name lookup or `from .client import ...` bindings.
2. **Avoid Circular Imports (`build` <-> `ingest/tree.py`)**:
   - `renest()` calls `log()` (`build.py:261`). Rather than `ingest/tree.py` importing `build` (circular), pass `log=log` as an injected parameter (with `build.renest` passing `log=build.log` so `FakeTitles` patches on `build.log` keep working cleanly).
3. **Docs Sync**:
   - Update `CLAUDE.md` backend layout immediately upon stage completion.

## Exit Gate
- All Python tests (under `pytest` and `unittest discover`), Stage 1 API/SSE snapshots, `python -m app.build --help`, and CI (`REQUIRE_BROWSER=1`) pass.
