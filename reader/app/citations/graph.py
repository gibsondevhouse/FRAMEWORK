"""Corpus-wide citation graph, web reference directory, and IBR standard resolver."""
from __future__ import annotations

import re
from collections import defaultdict
from functools import lru_cache
from urllib.parse import urlparse

from .parser import (
    CONTEXT_BARE_SEC_RE,
    CROSS_TITLE_EXT_RE,
    PARA_OF_SEC_RE,
    SECTION_ITEM_RE,
    WEB_URL_RE,
    WORD_SEC_EXT_RE,
    XREF_EXT_RE,
    clean_url_tail,
)

# ---------------------------------------------------------------------------
# Web domain categorization & retired-URL migration hints
# ---------------------------------------------------------------------------

_STANDARDS_HOSTS = frozenset({
    "ansi.org", "webstore.ansi.org", "astm.org", "nfpa.org", "iso.org", "asme.org",
    "acgih.org", "safetyequipment.org", "nsc.org", "iec.ch", "din.de", "asabe.org",
    "aws.org", "bsigroup.com", "ime.org", "aem.org", "sae.org", "global.ihs.com",
    "techstreet.com", "document-center.com", "store.accuristech.com",
    "standards.globalspec.com", "ul.com", "ashrae.org", "ieee.org", "standards.ieee.org",
    "cganet.com", "api.org", "nema.org",
})

_PORTAL_HOSTS = frozenset({
    "sam.gov", "alpha.sam.gov", "govinfo.gov", "regulations.gov", "ecfr.gov",
    "federalregister.gov", "archives.gov", "foia.gov", "pay.gov", "census.gov",
    "epa.gov", "gao.gov", "treasury.gov", "sec.gov", "gsa.gov", "irs.gov",
    "opm.gov", "wdol.gov", "epls.arnet.gov", "congress.gov", "whitehouse.gov",
    "thomas.loc.gov", "gpo.gov", "gpoaccess.gov",
})

_LEGACY_HOSTS: dict[str, dict[str, str]] = {
    "wdol.gov": {
        "replacement_url": "https://sam.gov/content/wage-determinations",
        "replacement_label": "SAM.gov Wage Determinations",
        "note": "Retired URL — Wage Determinations Online migrated to SAM.gov.",
    },
    "epls.arnet.gov": {
        "replacement_url": "https://sam.gov",
        "replacement_label": "SAM.gov Exclusions",
        "note": "Retired URL — Excluded Parties List System moved to SAM.gov.",
    },
    "alpha.sam.gov": {
        "replacement_url": "https://sam.gov",
        "replacement_label": "SAM.gov",
        "note": "Legacy preview host — consolidated onto SAM.gov.",
    },
    "thomas.loc.gov": {
        "replacement_url": "https://www.congress.gov",
        "replacement_label": "Congress.gov",
        "note": "Retired legislative archive — replaced by Congress.gov.",
    },
    "gpo.gov": {
        "replacement_url": "https://www.govinfo.gov",
        "replacement_label": "GovInfo.gov",
        "note": "Replaced by GPO's GovInfo publishing platform.",
    },
    "gpoaccess.gov": {
        "replacement_url": "https://www.govinfo.gov",
        "replacement_label": "GovInfo.gov",
        "note": "Retired GPO portal — publications live on GovInfo.gov.",
    },
}

SDO_ORGS: dict[str, tuple[str, str]] = {
    "ANSI": ("American National Standards Institute", "https://webstore.ansi.org"),
    "NFPA": ("National Fire Protection Association", "https://www.nfpa.org"),
    "ASTM": ("ASTM International", "https://www.astm.org"),
    "ASME": ("American Society of Mechanical Engineers", "https://www.asme.org"),
    "IEEE": ("Institute of Electrical and Electronics Engineers", "https://standards.ieee.org"),
    "ISO": ("International Organization for Standardization", "https://www.iso.org"),
    "IEC": ("International Electrotechnical Commission", "https://www.iec.ch"),
    "CGA": ("Compressed Gas Association", "https://www.cganet.com"),
    "AWS": ("American Welding Society", "https://www.aws.org"),
    "API": ("American Petroleum Institute", "https://www.api.org"),
    "SAE": ("SAE International", "https://www.sae.org"),
    "UL": ("UL Solutions", "https://www.ul.com"),
    "ACGIH": ("ACGIH", "https://www.acgih.org"),
    "ASHRAE": ("ASHRAE", "https://www.ashrae.org"),
    "NIOSH": ("National Institute for Occupational Safety & Health", "https://www.cdc.gov/niosh"),
    "IME": ("Institute of Makers of Explosives", "https://www.ime.org"),
    "ACI": ("American Concrete Institute", "https://www.concrete.org"),
    "NEMA": ("National Electrical Manufacturers Association", "https://www.nema.org"),
    "ASAE": ("ASABE", "https://www.asabe.org"),
    "BS": ("British Standards Institution", "https://www.bsigroup.com"),
    "DIN": ("DIN Standards", "https://www.din.de"),
}

_SDO_ALT = "|".join(sorted(SDO_ORGS.keys(), key=len, reverse=True))
# Matches e.g. "ANSI Z89.1-2009", "(ANSI) Z89.1-2003", "ANSI/NFPA 30",
# "NFPA 101-2009", "ASTM D93-79", "ISO/IEC 17025:2017", "ANSI Z535.1-2006 (R2011)".
STANDARD_CODE_RE = re.compile(
    rf"(?P<org>\((?:{_SDO_ALT})\)|\b(?:{_SDO_ALT})(?:/(?:{_SDO_ALT}))?)\s+"
    rf"(?P<des>[A-Z]{{0,4}}\d[A-Z0-9.\-/]*(?:[-:]\d{{2,4}})?(?:\s*\(R\d{{4}}\))?)\b"
)

_TOP_MARKER_RE = re.compile(r"^\(([a-z])(?:\)\(([0-9]+))?\)")
_ITEM_MARKER_RE = re.compile(r"^(?:\([a-z]\))?(\(\d+\)|\(\s*[ivxlcdm]+\s*\)|\(\s*[A-Z]\s*\))")


def _norm_host(raw_url: str) -> str:
    try:
        host = (urlparse(raw_url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _url_dedup_key(raw_url: str, host: str) -> str:
    """Collapse scheme (`http`/`https`) and `www.` variants for the same path."""
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return raw_url.rstrip("/").lower()
    path = parsed.path.rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{host}{path}{query}".lower()


def _classify_host(host: str) -> str:
    if not host:
        return "technical"
    if host in _STANDARDS_HOSTS or any(host.endswith("." + h) for h in _STANDARDS_HOSTS):
        return "standards"
    if host in _PORTAL_HOSTS or any(host.endswith("." + h) for h in _PORTAL_HOSTS):
        return "portals"
    if host.endswith(".gov") or host.endswith(".mil") or host.endswith(".state.md.us"):
        return "agencies"
    return "technical"


def _normalize_standard(org_raw: str, des_raw: str) -> tuple[str, str, str, str]:
    """Return (full_code, base_code, primary_org, clean_des)."""
    org_clean = org_raw.strip("() \t").upper()
    primary_org = org_clean.split("/", 1)[0].split("-", 1)[0]
    des_clean = re.sub(r"\s+", " ", des_raw.strip())
    full_code = f"{org_clean} {des_clean}"
    base_des = re.sub(r"\s*\(R\d{4}\)$", "", des_clean)
    base_des = re.sub(r"(?:[-:](?:19|20)\d{2}|-\d{2})$", "", base_des)
    base_code = f"{org_clean} {base_des or des_clean}".upper()
    return full_code, base_code, primary_org, des_clean


def _is_ibr_catalog_section(sec_title: str, sec_id: str) -> bool:
    tl = (sec_title or "").lower()
    if "incorporation by reference" in tl:
        return True
    if sec_id == "Appendix D to Subpart L of Part 1910":
        return True
    return False


def _clip(text: str, limit: int = 240) -> str:
    s = re.sub(r"\s+", " ", text or "").strip()
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


@lru_cache(maxsize=16)
def _build_title_index(title: int) -> dict:
    from .. import store

    con = store.db(title)
    rows = con.execute(
        "SELECT id, part, label, title, text FROM sections ORDER BY ord"
    ).fetchall()
    known_secs = {r["id"] for r in rows}

    # --- Accumulators ---
    sec_meta_by_id: dict[str, dict] = {}
    url_map: dict[str, dict] = {}
    url_citers: dict[str, dict[str, dict]] = defaultdict(dict)
    backlinks_map: dict[str, dict[str, dict]] = defaultdict(dict)
    ibr_by_full: dict[str, list[dict]] = defaultdict(list)
    ibr_by_base: dict[str, list[dict]] = defaultdict(list)

    for row in rows:
        sec_id = row["id"]
        sec_part = row["part"] or ""
        sec_label = store.clean_label(row["label"])
        sec_title = store.clean_label(row["title"])
        text = row["text"] or ""
        sec_meta = {"id": sec_id, "part": sec_part, "label": sec_label, "title": sec_title}
        sec_meta_by_id[sec_id] = sec_meta

        # 1. Web URLs (Phase 5 References Hub)
        if "http" in text or "www." in text:
            for m in WEB_URL_RE.finditer(text):
                clean, _ = clean_url_tail(m.group(1))
                if not clean:
                    continue
                href = f"https://{clean}" if clean.lower().startswith("www.") else clean
                host = _norm_host(href)
                if not host:
                    continue
                key = _url_dedup_key(href, host)
                if key not in url_map:
                    legacy = _LEGACY_HOSTS.get(host)
                    url_map[key] = {
                        "url": href,
                        "display": clean,
                        "host": host,
                        "category": _classify_host(host),
                        "legacy": legacy,
                    }
                elif href.lower().startswith("https://") and url_map[key]["url"].lower().startswith("http://"):
                    url_map[key]["url"] = href
                    url_map[key]["display"] = clean
                url_citers[key][sec_id] = sec_meta

        # 2. Internal Reverse Citation Index ("Cited By")
        cited_targets: set[str] = set()
        if "§" in text:
            for m in XREF_EXT_RE.finditer(text):
                for im in SECTION_ITEM_RE.finditer(m.group(2)):
                    tok = im.group(1)
                    if tok in known_secs:
                        cited_targets.add(tok)
                    elif "-" in tok:
                        a, b = tok.split("-", 1)
                        if a in known_secs:
                            cited_targets.add(a)
                        if b in known_secs:
                            cited_targets.add(b)
        if "section" in text.lower():
            for m in WORD_SEC_EXT_RE.finditer(text):
                for im in SECTION_ITEM_RE.finditer(m.group(2)):
                    tok = im.group(1)
                    if tok in known_secs:
                        cited_targets.add(tok)
        if "." in text:
            for m in CONTEXT_BARE_SEC_RE.finditer(text):
                tok = m.group(2)
                if tok in known_secs:
                    cited_targets.add(tok)
        if "paragraph" in text.lower():
            for m in PARA_OF_SEC_RE.finditer(text):
                tok = m.group(4)
                if tok in known_secs:
                    cited_targets.add(tok)
        if "CFR" in text or "C.F.R" in text:
            for m in CROSS_TITLE_EXT_RE.finditer(text):
                if int(m.group(1)) == title:
                    src = m.group(3) or m.group(4) or ""
                    for im in SECTION_ITEM_RE.finditer(src):
                        tok = im.group(1)
                        if tok in known_secs:
                            cited_targets.add(tok)

        cited_targets.discard(sec_id)
        for target_id in cited_targets:
            backlinks_map[target_id][sec_id] = sec_meta

        # 3. Statutory IBR Catalog Extraction
        if _is_ibr_catalog_section(sec_title, sec_id):
            cur_top = ""
            for line in text.splitlines():
                stripped = line.strip()
                if not stripped:
                    continue
                tm = _TOP_MARKER_RE.match(stripped)
                if tm:
                    cur_top = f"({tm.group(1)})"
                im = _ITEM_MARKER_RE.match(stripped)
                para = ""
                if im:
                    item_tok = im.group(1).replace(" ", "")
                    para = f"{cur_top}{item_tok}" if (cur_top and item_tok != cur_top) else cur_top or item_tok
                elif cur_top:
                    para = cur_top

                if not any(ch.isdigit() for ch in stripped):
                    continue
                for sm in STANDARD_CODE_RE.finditer(stripped):
                    line_para = para
                    if cur_top and not re.search(r"\(\d+\)$", line_para):
                        prefix_slice = stripped[: sm.start()]
                        num_m = re.findall(r"\(\d+\)", prefix_slice)
                        if num_m:
                            line_para = f"{cur_top}{num_m[-1]}"
                    full_code, base_code, org, _des = _normalize_standard(sm.group("org"), sm.group("des"))
                    # Skip common noise like "ISO 9001" if missing separator? No, that IS valid. Skip pure dates/sections if needed.
                    line_urls: list[str] = []
                    if "http" in stripped or "www." in stripped:
                        for um in WEB_URL_RE.finditer(stripped):
                            c_u, _ = clean_url_tail(um.group(1))
                            if c_u:
                                line_urls.append(f"https://{c_u}" if c_u.lower().startswith("www.") else c_u)
                    rec = {
                        "code": full_code,
                        "base_code": base_code,
                        "org": org,
                        "section_id": sec_id,
                        "part": sec_part,
                        "label": sec_label,
                        "para": line_para,
                        "excerpt": _clip(stripped, 260),
                        "urls": line_urls[:2],
                    }
                    ibr_by_full[full_code.upper()].append(rec)
                    ibr_by_base[base_code].append(rec)

    # Finalize References list grouped by normalized URL and rolled up by host
    ref_items: list[dict] = []
    cat_counts: dict[str, int] = {"standards": 0, "portals": 0, "agencies": 0, "technical": 0}
    host_groups: dict[str, dict] = {}
    host_citers: dict[str, dict[str, dict]] = defaultdict(dict)
    host_urls: dict[str, list[dict]] = defaultdict(list)

    for key, info in url_map.items():
        citers_dict = url_citers[key]
        citers = list(citers_dict.values())
        cat_counts[info["category"]] += 1
        item = {
            **info,
            "cite_count": len(citers),
            "cited_in": citers[:8],
        }
        ref_items.append(item)

        host = info["host"]
        if host not in host_groups:
            host_groups[host] = {
                "host": host,
                "category": info["category"],
                "legacy": info["legacy"],
            }
        host_citers[host].update(citers_dict)
        host_urls[host].append({
            "url": info["url"],
            "display": info["display"],
            "cite_count": len(citers),
        })
    ref_items.sort(key=lambda r: (-r["cite_count"], r["host"], r["url"]))

    host_items: list[dict] = []
    host_cat_counts: dict[str, int] = {"standards": 0, "portals": 0, "agencies": 0, "technical": 0}
    for host, info in host_groups.items():
        citers = list(host_citers[host].values())
        urls = sorted(host_urls[host], key=lambda u: (-u["cite_count"], len(u["url"]), u["url"]))
        primary = urls[0]
        host_cat_counts[info["category"]] += 1
        host_items.append({
            **info,
            "url": primary["url"],
            "display": primary["display"],
            "url_count": len(urls),
            "urls": urls[:8],
            "cite_count": len(citers),
            "cited_in": citers[:8],
        })
    host_items.sort(key=lambda h: (-h["cite_count"], h["host"]))

    ibr_standards: list[dict] = []
    for recs in ibr_by_full.values():
        first = recs[0]
        org = first["org"]
        org_name, org_url = SDO_ORGS.get(org, (org, ""))
        seen_secs: dict[str, dict] = {}
        for r in recs:
            sid = r["section_id"]
            if sid not in seen_secs:
                seen_secs[sid] = {
                    "id": sid,
                    "part": r["part"],
                    "label": r["label"],
                    "para": r["para"],
                }
        approved_list = list(seen_secs.values())
        ibr_standards.append({
            "code": first["code"],
            "base_code": first["base_code"],
            "org": org,
            "org_name": org_name,
            "org_url": org_url,
            "section_id": first["section_id"],
            "part": first["part"],
            "label": first["label"],
            "para": first["para"],
            "excerpt": first["excerpt"],
            "urls": first["urls"],
            "section_count": len(approved_list),
            "approved_in": approved_list[:6],
        })
    ibr_standards.sort(key=lambda s: (-s["section_count"], s["org"], s["code"]))

    most_cited = [
        {**sec_meta_by_id[tid], "cited_by_count": len(citers)}
        for tid, citers in backlinks_map.items()
        if tid in sec_meta_by_id and citers
    ]
    most_cited.sort(key=lambda r: (-r["cited_by_count"], r["id"]))

    return {
        "title": title,
        "references": {
            "total": len(ref_items),
            "category_counts": cat_counts,
            "items": ref_items,
            "host_total": len(host_items),
            "host_category_counts": host_cat_counts,
            "hosts": host_items,
            "ibr_total": len(ibr_standards),
            "ibr_standards": ibr_standards,
            "most_cited_total": len(most_cited),
            "most_cited": most_cited[:12],
        },
        "backlinks": {k: list(v.values()) for k, v in backlinks_map.items()},
        "ibr_by_full": dict(ibr_by_full),
        "ibr_by_base": dict(ibr_by_base),
    }


def _pick_ibr_match(candidates: list[dict], part: str) -> dict | None:
    if not candidates:
        return None
    for c in candidates:
        if c["part"] == part:
            return c
    return candidates[0]


def get_references(title: int) -> dict:
    """Return categorized web references, legacy URL warnings, and citing sections for `title`."""
    idx = _build_title_index(title)
    return {"title": title, **idx["references"]}


def get_section_graph(title: int, raw_section_id: str) -> dict | None:
    """Return reverse 'Cited By' backlinks and resolved IBR standards for a section."""
    from .. import store

    section_id = store.normalize_id(raw_section_id, title)
    row = store.db(title).execute(
        "SELECT id, part, label, title, text FROM sections WHERE id = ?",
        (section_id,),
    ).fetchone()
    if not row:
        return None

    idx = _build_title_index(title)
    cited_by = idx["backlinks"].get(row["id"], [])
    part = row["part"] or ""
    text = row["text"] or ""

    # Resolve consensus technical standards mentioned in this section
    ibr_matches: list[dict] = []
    seen_codes: set[str] = set()
    for sm in STANDARD_CODE_RE.finditer(text):
        raw_match = sm.group(0).strip()
        full_code, base_code, org, _des = _normalize_standard(sm.group("org"), sm.group("des"))
        if full_code.upper() in seen_codes:
            continue
        seen_codes.add(full_code.upper())

        exact = _pick_ibr_match(idx["ibr_by_full"].get(full_code.upper(), []), part)
        loose = None if exact else _pick_ibr_match(idx["ibr_by_base"].get(base_code, []), part)
        catalog_hit = exact or loose
        org_name, org_url = SDO_ORGS.get(org, (org, ""))
        ibr_matches.append({
            "code": full_code,
            "match_text": raw_match,
            "org": org,
            "org_name": org_name,
            "org_url": org_url,
            "exact": bool(exact),
            "approved_in": catalog_hit,
        })

    return {
        "title": title,
        "section_id": row["id"],
        "cited_by_count": len(cited_by),
        "cited_by": cited_by,
        "ibr": ibr_matches,
    }


def clear_caches() -> None:
    _build_title_index.cache_clear()
