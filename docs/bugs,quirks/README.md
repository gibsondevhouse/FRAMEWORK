# Regulatory Ingest Quirks & Edge Cases Log

This document tracks idiosyncrasies, data anomalies, duplicate identifiers, and formatting quirks across the Code of Federal Regulations (eCFR), as well as planned external regulatory corpuses (USC, State Admin Codes, and Standards).

---

## Index of Quirks & Edge Cases

| ID | Corpus | Scope | Severity | Summary | Full Detail Doc |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **QUIRK-001** | eCFR | Title 14 (FAA) | High / Blocking | Duplicate SFAR appendix identifiers across parts cause `UNIQUE constraint failed: sections.id` | [title-14-sfar-duplicate-sections-id.md](title-14-sfar-duplicate-sections-id.md) |
| **QUIRK-002** | eCFR | Title 47 (FCC) | High / Blocking | Duplicate `Alphabetical Index` appendix identifiers across Parts 73, 74, 76, 78 | [title-14-sfar-duplicate-sections-id.md](title-14-sfar-duplicate-sections-id.md) |
| **QUIRK-003** | eCFR | Title 35 | Informational | Reserved title; eCFR returns HTTP 404 for structure JSON | Handled gracefully by library views |
| **QUIRK-004** | eCFR | Cross-Title | Moderate | Un-nested loose sections following empty subpart headers | Handled via `nest_loose_sections` in `tree.py` |
| **QUIRK-005** | State Codes | Cal/OSHA (Title 8 CCR) | Architectural | Non-standard section numbering (`§ 3203`, `§ 5192`) and embedded tables | Planned: Adapter Pattern |
| **QUIRK-006** | USC | Title 29, Title 49 | Architectural | Uncodified statutory notes and historical notes sharing section references | Planned: URRI Scheme |

---

## Multi-Corpus Extensibility Principles

1. **Never Assume Globally Unique Section Numbers**:
   Within a title or sub-division, identifiers like `"Alphabetical Index"`, `"Appendix A"`, `"Table 1"`, or `"SFAR 97"` recur across parts and chapters.
2. **Corpus Namespacing (URRI Scheme)**:
   Every entity must resolve to a Uniform Regulatory Resource Identifier:
   `reg://[jurisdiction]/[corpus]/[collection]/[unit]`
3. **Pluggable Ingestion Adapters**:
   Each legal or regulatory publisher (eCFR XML/JSON, USLM XML for USC, state government APIs) has an independent adapter implementing a common `IRegulatoryIngest` contract.
