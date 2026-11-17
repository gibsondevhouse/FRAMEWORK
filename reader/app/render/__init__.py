"""Convert eCFR XML into readable HTML (for the reader) and plain text (for search and Claude).

Facade over the package: external modules keep importing `from .render import …`
exactly as they did when this was one file.
"""
from .hierarchy import (ROMAN, ROMAN_ORDER, LevelTracker, compute_levels,  # noqa: F401
                        marker_tokens)
from .html import (CALLOUTS, E_STYLES, FLUSH_INDENT, INLINE_MAP, PARA_TAGS,  # noqa: F401
                   SAFE_CELL_CLASSES, TABLE_TAGS, Renderer, image_urls,
                   render_fragment_html, render_leaf_html)
from .linkifier import (_CROSS_TITLE, _NUM_IN_LIST, _WORD_SEC, _XREF,  # noqa: F401
                        _outside_anchors, make_linkifier)
from .text import BLOCK_TAGS, CELL_TAGS, clean_label, element_to_text  # noqa: F401
from .units import (APPENDIX_SPLIT_MIN_CHARS, HEAD_TAGS, UNIT_MODE_MIN_CHARS,  # noqa: F401
                    SectionDoc, appendix_heading, section_doc, split_units)
