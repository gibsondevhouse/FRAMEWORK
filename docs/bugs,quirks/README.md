# Federal Regulatory Ingest Quirks & Edge Cases Log

This document tracks idiosyncrasies, data anomalies, duplicate identifiers, and formatting quirks across the Code of Federal Regulations (eCFR) and planned federal corpuses such as the U.S. Code (U.S.C.). State-law corpuses are out of scope per the federal-only platform direction (2026-11-19).

---

## Index of Quirks & Edge Cases

| ID | Corpus | Scope | Severity | Summary | Full Detail Doc |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **QUIRK-001** | eCFR | Title 14 (FAA) | Resolved | Duplicate SFAR appendix identifiers across parts cause `UNIQUE constraint failed: sections.id` (fixed via part-qualified IDs in `ingest/tree.py` & `parse.py`) | [title-14-sfar-duplicate-sections-id.md](title-14-sfar-duplicate-sections-id.md) |
| **QUIRK-002** | eCFR | Title 47 (FCC) | Resolved | Duplicate `Alphabetical Index` appendix identifiers across Parts 73, 74, 76, 78 (fixed via part-qualified IDs in `ingest/tree.py` & `parse.py`) | [title-14-sfar-duplicate-sections-id.md](title-14-sfar-duplicate-sections-id.md) |
| **QUIRK-003** | eCFR | Title 35 | Informational | Reserved title; eCFR returns HTTP 404 for structure JSON | Handled gracefully by library views |
| **QUIRK-004** | eCFR | Cross-Title | Moderate | Un-nested loose sections following empty subpart headers | Handled via `nest_loose_sections` in `tree.py` |
| **QUIRK-005** | State Codes | Cal/OSHA (Title 8 CCR) | Out of Scope | Historical note: non-standard state section numbering (`§ 3203`, `§ 5192`); state-law ingestion is out of scope under the federal-only direction | Out of Scope |
| **QUIRK-006** | U.S.C. | Federal Titles (USLM XML) | Architectural | Uncodified statutory notes and historical notes sharing section references | **Mitigated**: `ingest/uslm.py` stores notes apart from section text (`notes` table, category editorial / statutory / executive by crossHeading); URRI scheme still planned |

---

## Multi-Framework Federal Extensibility Principles

1. **Never Assume Globally Unique Section Numbers**:
   Within a title or sub-division, identifiers like `"Alphabetical Index"`, `"Appendix A"`, `"Table 1"`, or `"SFAR 97"` recur across parts and chapters.
2. **Corpus Namespacing (URRI Scheme)**:
   Every federal entity resolves to a Uniform Regulatory Resource Identifier:
   `reg://federal/[corpus]/[collection]/[unit]` (e.g., `cfr`, `usc`, `fr`).
3. **Pluggable Federal Ingestion Adapters**:
   Each federal legal publisher (eCFR XML/JSON, Federal Register API v1, USLM XML for U.S.C.) implements an independent adapter behind a common `IRegulatoryIngest` contract.
