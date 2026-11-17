# Stage 4 · Phase 1 · Part 2: Estimated Size & Agency Acronym Enrichment

## 1. Objectives
Enrich the title catalog rows with approximate XML/database sizes in megabytes and issuing agency acronyms (`OSHA`, `EPA`, `DOT`, `SEC`, `FAR`, `FDA`, `FCC`).

## 2. Technical Specification

### 2.1 Agency & Footprint Mapping (`reader/app/title_blurbs.json`)
Augment entries with `agencies` and `size_mb` estimates:

```json
{
  "29": {
    "desk": "Workplace & Labor",
    "featured": true,
    "agencies": ["OSHA", "WHD", "MSHA", "ERISA"],
    "size_mb": 28.4,
    "summary": "OSHA workplace safety and health standards, mine safety, and wage and hour and employee benefit regulations."
  },
  "40": {
    "desk": "Environment & Energy",
    "featured": true,
    "agencies": ["EPA"],
    "size_mb": 42.1,
    "summary": "EPA rules on air and water quality, hazardous waste, chemicals and pesticides, with permits and release reporting."
  },
  "49": {
    "desk": "Transportation",
    "featured": true,
    "agencies": ["PHMSA", "FMCSA", "FAA", "FRA"],
    "size_mb": 17.5,
    "summary": "DOT rules: hazardous materials, motor carriers and drivers, rail, pipelines and vehicle safety."
  }
}
```

### 2.2 Python Catalog Serializer (`reader/app/library.py`)
```python
def catalog() -> list[dict]:
    blurbs = _BLURBS.get("titles", {})
    rows = []
    for t in sorted(ecfr_titles(), key=lambda t: t["number"]):
        n = t["number"]
        inst = installed(n)
        b = blurbs.get(str(n), {})
        rows.append({
            "title": n,
            "name": t.get("name") or f"Title {n}",
            "latest": t.get("up_to_date_as_of"),
            "amended": t.get("latest_amended_on"),
            "reserved": bool(t.get("reserved")),
            "summary": b.get("summary", ""),
            "desk": b.get("desk", OTHER_DESK),
            "featured": bool(b.get("featured")),
            "agencies": b.get("agencies", []),
            "size_mb": b.get("size_mb", 10.0),
            "installed": _install_summary(inst),
        })
    return rows
```

## 3. Acceptance Criteria
- [ ] Catalog payloads include `agencies` and `size_mb`.
- [ ] Client search matches on agency acronyms (e.g. typing "OSHA" filters directly to Title 29).
