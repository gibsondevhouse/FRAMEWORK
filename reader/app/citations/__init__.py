"""Structured citation & reference parser shared across HTML rendering, News, and Start Page hubs."""
from .parser import (  # noqa: F401
    CitationSpan,
    clean_url_tail,
    extract_reference_spans,
    normalize_part_token,
    parse_usc_targets,
    split_part_range,
)
