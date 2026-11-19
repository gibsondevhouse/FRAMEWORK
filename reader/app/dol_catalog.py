"""Rate-safe CLI catalog discovery & schema probe for DOL Open Data API v4 (/v4/datasets)."""
from __future__ import annotations

import argparse
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import httpx

from . import config, news, news_store

_CFR_MAP: dict[str, tuple[int, list[str]]] = {
    "OSHA": (29, ["1900-1999"]),
    "WHD": (29, ["500-899"]),
    "EBSA": (29, ["2509-2590"]),
    "MSHA": (30, ["1-199"]),
    "OWCP": (20, ["1-799"]),
}


def map_dataset_to_cfr(entry: dict) -> tuple[int | None, list[str]]:
    """Map a DOL agency/dataset entry to its primary CFR Title and Part ranges."""
    agency = str(entry.get("agency") or "").strip().upper()
    if agency in _CFR_MAP:
        return _CFR_MAP[agency]
    text = f"{entry.get('title') or ''} {entry.get('description') or ''}".lower()
    if any(k in text for k in ("flsa", "fmla", "wage", "davis-bacon", "mspa")):
        return 29, ["500-899"]
    if any(k in text for k in ("erisa", "pension", "fiduciary")):
        return 29, ["2509-2590"]
    if any(k in text for k in ("mine", "mining", "coal")):
        return 30, ["1-199"]
    if any(k in text for k in ("workers' compensation", "black lung", "energy")):
        return 20, ["1-799"]
    return None, []


def _normalize_dataset_row(raw: dict, now_iso: str) -> dict | None:
    ag_obj = raw.get("agency")
    if isinstance(ag_obj, dict):
        agency = str(ag_obj.get("abbr") or ag_obj.get("name") or "").strip().upper()
    else:
        agency = str(ag_obj or "").strip().upper()
    dataset = str(raw.get("api_url") or raw.get("dataset") or "").strip()
    if not dataset:
        tname = str(raw.get("tablename") or "").strip()
        if agency and tname.upper().startswith(f"{agency}_"):
            dataset = tname[len(agency) + 1:]
        else:
            dataset = tname
    if not agency or not dataset:
        return None
    slug = f"{agency}/{dataset}"
    cfr_title, cfr_parts = map_dataset_to_cfr({
        "agency": agency,
        "title": raw.get("name") or raw.get("title") or "",
        "description": raw.get("description") or "",
    })
    return {
        "slug": slug,
        "agency": agency,
        "dataset": dataset,
        "title": str(raw.get("name") or raw.get("title") or slug).strip(),
        "frequency": str(raw.get("frequency") or "").strip() or None,
        "probe_status": "unprobed",
        "fields": [],
        "cfr_title": cfr_title,
        "cfr_parts": cfr_parts,
        "raw": {
            "id": raw.get("id"),
            "tablename": raw.get("tablename"),
            "description": raw.get("description"),
            "category_name": raw.get("category_name"),
            "updated_at": raw.get("updated_at"),
        },
        "discovered_at": now_iso,
    }


def _fetch_catalog_page(c: httpx.Client, key: str, *, page: int, limit: int) -> dict:
    news._dol_pace(c, "catalog", "datasets")
    try:
        r = c.get(f"{news.DOL_BASE}/datasets", params={"limit": limit, "page": page, "X-API-KEY": key})
        r.raise_for_status()
        if r.status_code == 204 or not r.content.strip():
            return {"datasets": [], "meta": {}}
        return r.json()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            news._record_dol_429(e.response.headers)
        raise news.SourceUnavailable(f"DOL datasets: HTTP {e.response.status_code}") from None
    except (httpx.HTTPError, ValueError) as e:
        raise news.SourceUnavailable(f"DOL datasets: {type(e).__name__}") from None


def fetch_dol_catalog(
    c: httpx.Client,
    key: str,
    *,
    page_size: int = 20,
    delay_s: float = 2.0,
    probe_schemas: bool = False,
    on_page: Callable[[list[dict]], None] | None = None,
) -> dict:
    """Discover DOL Open Data API v4 datasets via /v4/datasets with partial-save on 429."""
    now_iso = datetime.now(timezone.utc).isoformat()
    collected: list[dict] = []
    seen: set[str] = set()
    page = 1
    rate_limited = False
    pace_live = news._dol_should_pace(c)

    while True:
        try:
            payload = _fetch_catalog_page(c, key, page=page, limit=page_size)
        except news.SourceUnavailable as e:
            if "429" in str(e):
                rate_limited = True
                break
            raise
        raw_items = payload.get("datasets") or []
        page_entries: list[dict] = []
        for raw in raw_items:
            norm = _normalize_dataset_row(raw, now_iso)
            if norm and norm["slug"] not in seen:
                seen.add(norm["slug"])
                collected.append(norm)
                page_entries.append(norm)
        if page_entries and on_page is not None:
            on_page(page_entries)
        meta = payload.get("meta") or {}
        next_page = meta.get("next_page")
        if not next_page or not raw_items:
            break
        page = int(next_page)
        if pace_live and delay_s > 0:
            time.sleep(delay_s)

    if probe_schemas and not rate_limited:
        for entry in collected:
            if news.dol_cooldown_remaining() > 0:
                entry["probe_status"] = "rate_limited"
                rate_limited = True
                continue
            try:
                rows = news._dol_get(c, key, entry["dataset"], {"limit": 1}, agency=entry["agency"])
                if not rows:
                    entry["probe_status"] = "empty_204"
                else:
                    entry["probe_status"] = "healthy_200"
                    entry["fields"] = sorted(str(k) for k in rows[0].keys())
            except news.SourceUnavailable as e:
                msg = str(e)
                if "429" in msg:
                    entry["probe_status"] = "rate_limited"
                    rate_limited = True
                elif "HTTP 500" in msg:
                    entry["probe_status"] = "upstream_500"
                else:
                    entry["probe_status"] = msg.split(": ", 1)[-1].lower().replace(" ", "_")
            if on_page is not None:
                on_page([entry])
            if pace_live and delay_s > 0 and not rate_limited:
                time.sleep(delay_s)

    return {"entries": collected, "rate_limited": rate_limited}


def render_catalog_markdown(entries: list[dict]) -> str:
    """Render a checked-in Markdown inventory table from discovered DOL catalog entries."""
    lines = [
        "# DOL Open Data API v4 Catalog Inventory",
        "",
        f"Recorded: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · Total datasets: {len(entries)}",
        "",
        "| Slug | Agency | Title | Frequency | Probe Status | CFR Mapping | Sample Fields |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for e in sorted(entries, key=lambda x: (x.get("agency", ""), x.get("slug", ""))):
        cfr = f"Title {e['cfr_title']} ({', '.join(e.get('cfr_parts') or [])})" if e.get("cfr_title") else "—"
        fields = ", ".join((e.get("fields") or [])[:8])
        if len(e.get("fields") or []) > 8:
            fields += f" (+{len(e['fields']) - 8})"
        lines.append(
            f"| `{e['slug']}` | {e['agency']} | {e['title']} | {e.get('frequency') or '—'} "
            f"| `{e.get('probe_status') or 'unprobed'}` | {cfr} | {fields or '—'} |"
        )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Discover DOL Open Data API v4 datasets safely.")
    parser.add_argument("--probe", action="store_true", help="Run spaced limit=1 health & column probes.")
    parser.add_argument("--write-doc", action="store_true", help="Write DOL_CATALOG_INVENTORY.md.")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between live API calls.")
    args = parser.parse_args(argv)

    key = config.dol_api_key()
    if not key:
        print("DOL_API_KEY is not configured in reader/.env.")
        return 1

    def _save_batch(batch: list[dict]) -> None:
        with closing(news_store.connect()) as con:
            news_store.save_dol_catalog(con, batch)
            con.commit()

    with news.client() as c:
        res = fetch_dol_catalog(c, key, delay_s=args.delay, probe_schemas=args.probe, on_page=_save_batch)
    with closing(news_store.connect()) as con:
        all_entries = news_store.list_dol_catalog(con)
    print(f"Saved {len(res['entries'])} datasets (total stored: {len(all_entries)}, rate_limited={res['rate_limited']}).")
    if args.write_doc:
        out = config.ROOT_DIR.parent / "docs" / "plans" / "40_regulatory_intelligence_and_dol" / "42_dol_api_expansion" / "DOL_CATALOG_INVENTORY.md"
        out.write_text(render_catalog_markdown(all_entries), encoding="utf-8")
        print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
