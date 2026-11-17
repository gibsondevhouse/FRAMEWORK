# Stage 4 · Phase 1 · Part 1: Suite Catalog Metadata Schema

## 1. Objectives
Define the pre-packaged compliance suites schema in `reader/app/library.py` and declare the initial vertical industry packs.

## 2. Technical Specification

### 2.1 Suite Dictionary Definition (`reader/app/library.py`)
```python
COMPLIANCE_SUITES = {
    "ehs": {
        "id": "ehs",
        "name": "EHS & Workplace Safety Suite",
        "badge": "Core Compliance",
        "titles": [29, 40, 49],
        "summary": "Occupational safety (OSHA), environmental protection (EPA), and hazardous materials transport (DOT).",
        "estimated_size_mb": 88,
        "estimated_sections": 64056,
    },
    "trade": {
        "id": "trade",
        "name": "Commerce, Banking & Securities",
        "badge": "Financial Markets",
        "titles": [12, 15, 17],
        "summary": "Federal Reserve banking standards, Commerce export controls, and SEC / CFTC market regulations.",
        "estimated_size_mb": 72,
        "estimated_sections": 41200,
    },
    "govcon": {
        "id": "govcon",
        "name": "Federal Contracting & Acquisition",
        "badge": "Government",
        "titles": [41, 48],
        "summary": "Public contracts, federal property management, and the Federal Acquisition Regulation (FAR).",
        "estimated_size_mb": 45,
        "estimated_sections": 28500,
    }
}
```

### 2.2 Endpoint Integration (`reader/app/main.py`)
Update `GET /api/library` to return the suites alongside the catalog:

```python
@app.get("/api/library")
def library_catalog():
    return {
        "titles": _library_call(library.catalog),
        "desks": library.DESKS,
        "suites": library.COMPLIANCE_SUITES,
        "jobs": library.queue.snapshot(),
    }
```

## 3. Acceptance Criteria
- [ ] Suites are exposed via `GET /api/library`.
- [ ] Each suite lists exact title numbers, summaries, and estimated payloads.
- [ ] Adding new suites requires only a configuration entry in `library.py`.
