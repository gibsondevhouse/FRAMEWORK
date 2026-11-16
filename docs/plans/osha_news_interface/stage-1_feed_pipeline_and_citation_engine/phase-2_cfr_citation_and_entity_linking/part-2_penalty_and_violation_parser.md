# Stage 1 · Phase 2 · Part 2: DOL Enforcement Violation, Gravity & Penalty Builder

## 1. Objectives
Turn the recent `violation` rows (fetched first; see Phase 1 Part 1 §4.5; the window is 30 or 90 days, set by `news_schedule.dol_window`) and their `inspection` rows into one enforcement item per inspection. The item is dated by its newest **citation issuance**, not by when the inspection opened.

## 2. DOL Column Schemas
From `https://apiprod.dol.gov/v4/datasets/10334` and `10338`:
- **`inspection`** (`OSHA_inspection`): `activity_nr` (number, id), `estab_name`, `site_address`, `site_city`, `site_state`, `site_zip`, `naics_code`, `sic_code`, `insp_type` (`A` Accident, `B` Complaint, `C` Referral, `F` Follow-up, `H` Planned, `M` Fatality/Catastrophe, others → generic label), `safety_hlth` (`S`/`H`), `open_date`, `close_case_date`.
- **`violation`** (`OSHA_violation`): `activity_nr` (FK), `citation_id` (e.g. `"01006D"`), `delete_flag` (drop the row when set), `standard`, `viol_type` (`W` Willful, `R` Repeat, `S` Serious, `O` Other-than-Serious, `U` Unclassified), `initial_penalty`, `current_penalty` (strings or numbers), `nr_instances`, `nr_exposed`, `issuance_date`.

## 3. Pipeline (`reader/app/news.py`)
```python
VIOL_TYPE_LABELS = {"W": "Willful", "R": "Repeat", "S": "Serious", "O": "Other-than-Serious", "U": "Unclassified"}
INSP_TYPE_LABELS = {"A": "Accident investigation", "B": "Complaint inspection", "C": "Referral inspection",
                    "F": "Follow-up inspection", "H": "Planned inspection", "M": "Fatality/catastrophe investigation"}
def group_violations(rows: list[dict], max_inspections: int) -> dict[int, list[dict]]:
    """Drop deleted rows; group by activity_nr; keep the max_inspections with the newest issuance.
    max_inspections is 50 normally, 150 on a catch-up run (news_schedule.dol_window)."""
    groups: dict[int, list[dict]] = {}
    for r in rows:
        if r.get("delete_flag") or not r.get("activity_nr"):
            continue
        groups.setdefault(int(r["activity_nr"]), []).append(r)
    newest = sorted(groups, key=lambda a: max(str(v.get("issuance_date") or "") for v in groups[a]), reverse=True)
    return {a: groups[a] for a in newest[:max_inspections]}


def _money(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def build_enforcement_article(insp: dict, violations: list[dict]) -> dict:
    act_nr = int(insp["activity_nr"])
    company = (insp.get("estab_name") or "Unknown establishment").strip().title()
    city = (insp.get("site_city") or "").strip().title() or None
    state = (insp.get("site_state") or "").strip().upper() or None
    loc = ", ".join(p for p in (city, state) if p)
    label = INSP_TYPE_LABELS.get((insp.get("insp_type") or "").upper(), "OSHA inspection")

    total, sections, counts, gdc, unmapped = 0.0, set(), {}, 0, 0
    for v in violations:
        # current_penalty reflects settlements and contest outcomes; fall back to the initial amount.
        cur = v.get("current_penalty")
        total += _money(cur) if cur not in (None, "") else _money(v.get("initial_penalty"))
        std = v.get("standard") or ""
        if (sec := normalize_dol_standard(std)):
            sections.add(sec)
        elif is_general_duty(std):
            gdc += 1
        elif std.strip():
            unmapped += 1
        vt = (v.get("viol_type") or "").strip().upper()
        if vt:
            counts[vt] = counts.get(vt, 0) + 1

    issued = max((str(v.get("issuance_date") or "")[:10] for v in violations), default="")
    return {
        **empty_item(),
        "guid": f"dol-insp:{act_nr}",
        "source": "dol_osha",
        "agency": "occupational-safety-and-health-administration",
        "category": "enforcement",
        "doc_type": label,
        "title": f"{company} cited after {label.lower()}" + (f" in {loc}" if loc else ""),
        "link": f"https://www.osha.gov/ords/imis/establishment.inspection_detail?id={act_nr}",
        "published_at": issued or str(insp.get("open_date") or "")[:10],
        "description": "",   # the takeaways carry the substance; FTS indexes company + title
        "company": company, "city": city, "state": state, "naics": insp.get("naics_code"),
        "penalty_usd": round(total, 2) if total > 0 else None,
        "violation_types": sorted(counts),
        "violation_counts": counts,          # used by takeaways; not stored as a column
        "general_duty": gdc,
        "unmapped_standards": unmapped,
        "opened_on": str(insp.get("open_date") or "")[:10] or None,  # used by takeaways
        "sections": sorted(sections),
    }
```
- The `link` is OSHA's public establishment-search detail page, opened by the **user's** browser when they click it. FRAMEWORK never fetches it, so the "no osha.gov scraping" rule holds.
- Penalties are what the dataset says today. A takeaway notes "current penalty", because open cases can still be contested and amounts change.
- An inspection that comes back with violations but no `inspection` row (rare; the datasets refresh separately) is skipped this run and picked up on the next.

## 4. Acceptance Criteria
- [ ] Violations and inspections are fetched in two requests in total (the `in` filter), never one request per inspection.
- [ ] Rows with `delete_flag` are excluded from counts and totals.
- [ ] `published_at` is the newest `issuance_date` across the inspection's violations.
- [ ] Penalty totals use `current_penalty`, falling back to `initial_penalty` per row.
- [ ] General Duty and unmapped (state-plan) standards are counted, not dropped and not mislinked.
