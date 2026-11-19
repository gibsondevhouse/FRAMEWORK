"""The download library: browse every CFR title on eCFR and install a title, a part or a
section into the reader.

Installs run one at a time on a background thread (`Queue`). A partial install's scope lives
in the title database's `meta.scope` (see `build.normalize_scope`); downloading more of a
title rebuilds it with the union of what it had and what was asked for, at the latest
edition. Downloading the whole title replaces any partial copy.

This package façade re-exports the full public surface of the old single-file
`library.py`; submodules call patched/stubbed functions through this namespace
(`lib.run_job`, `lib.queue`, `lib.ecfr_titles`, …) so test patches on
`app.library` attributes stay effective. Submodules are deliberately NOT named
`queue.py` or `storage.py`: those names would shadow the `queue` instance and
the `storage()` function re-exported here.
"""
from .client import (CATALOG_TTL, _cache_lock, _client, _structures,  # noqa: F401
                     catalog, catalog_checked_at, ecfr_title, ecfr_titles,
                     structure)
from .suites import (COMPLIANCE_SUITES, DESKS, OTHER_DESK, _BLURBS,  # noqa: F401
                     _load_blurbs, suites)
from .disk import (_db_bytes, _install_summary, _remove_partial_files,  # noqa: F401
                   installed, prune_temp, reload_installed, remove, storage)
from .views import (_changes, _find_part, _leaves, changes, part_view,  # noqa: F401
                    title_view, wire)
from .jobs import (JobCancelled, Queue, _friendly, outdated, queue,  # noqa: F401
                   queue_titles, requested_scope, run_job, update_all)
