# Stage 3: Core Backend Package Splits (`render.py`, `library.py`, `build.py`)

## Goal
Decompose the three large backend modules (`render.py` at 833 lines, `library.py` at 647 lines, `build.py` at 593 lines) into single-responsibility submodules while keeping module-level APIs and test monkeypatches 100% intact.

## Target Layout

### 1. `reader/app/render/` (replacing `render.py`)
- `text.py`: `element_to_text`, `BLOCK_TAGS`, `CELL_TAGS`
- `hierarchy.py`: `LevelTracker`, `ROMAN`, `ROMAN_ORDER`, `marker_tokens`, `compute_levels`
- `linkifier.py`: `make_linkifier`, `_outside_anchors`, citation regex constants (keep `_CROSS_TITLE`, `_NUM_IN_LIST`, `_XREF` accessible for `news.py:23`, or promote to public names and update `news.py`)
- `units.py`: `SectionDoc`, `split_units`, `_appendix_units`, `_chapter_units`
- `html.py`: `Renderer`, `render_leaf_html`, `render_fragment_html`, `image_urls`
- `__init__.py`: Re-export all public and required internal symbols.

### 2. `reader/app/library/` (replacing `library.py`)
- `client.py`: Upstream eCFR API client (`_client`, `ecfr_titles`, `ecfr_title`, `structure`, `catalog`)
- `suites.py`: Curated suites and `_load_blurbs`
- `storage.py`: `installed`, `storage`, `prune_temp`, `_remove_partial_files`
- `queue.py`: `Queue`, `JobCancelled`, `run_job`, `queue_titles`, `update_all`
- `views.py`: `title_view`, `part_view`, `changes`, `wire`
- `__init__.py`: Facade re-exporting public functions.

### 3. `reader/app/ingest/` (supporting `build.py`)
- `tree.py`: `trim_tree`, `nest_loose_sections`, `normalize_scope`, `merge_scope`, `prune_tree`, `renest`
- `parse.py`: `stream_parse_xml`, `ecfr_path`, `front_matter_xml`
- Keep `reader/app/build.py` as the orchestrating module and CLI entrypoint (`python -m app.build`).

## Critical Implementation Constraint: Preserving Test Stubs
Existing tests (`test_library.py`, `test_library_suites.py`, `test_library_front_page.py`, `test_api_endpoints.py`, `fake_titles.py`) patch **34 attributes directly on `app.library` and `app.build`** (e.g., `library.ecfr_titles`, `library.installed`, `build.fetch_json`, `build.download_stream`, `build.log`).
- **Rule**: Submodules inside `app/library/` and `app/ingest/` must NOT bind sibling functions via `from .client import ecfr_titles` at import time, which bypasses monkeypatching on `app.library`. Instead, access sibling functions via the package namespace (`import app.library as lib; lib.ecfr_titles()`) or pass callables explicitly, ensuring every existing test mock intercepts calls reliably.

## Exit Gate
- Full pytest suite (with universal network guard active) passes 100%.
- Stage 1 API JSON snapshots pass 100%.
- `PYTHONPATH=reader python -m app.build --help` runs cleanly.
