"""Read-only search and reading across the six federal frameworks (TL-01, TL-02, TL-09).

Claude's tools (`chat.py`) and, later, the MCP server (TL-10) share this module, so a
framework is taught to every caller in one place. It only reads: every store is opened
through its own read-only connection, a store that is not installed is reported and never
created, and nothing here makes a network request (a Federal Register document whose full
text was never downloaded says so instead of fetching it).

    hits = search("hazard communication")                  # every installed framework
    hits = search("due process", frameworks=["constitution"])
    doc = read("42 U.S.C. 2000e-2")                         # a citation or a canonical id
    doc = read_ref(ids.from_store_key("usc", "655", collection=29))

Every hit and every document carries its canonical id (`app/ids.py`), the citation a person
would write, and the app route, so a caller can always say where a passage came from.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field

from . import agenda, config, constitution, fr_store, ids, plaw, store, usc_store

# The order the frameworks are listed in: the authority chain, statutes before regulations.
FRAMEWORKS = ("constitution", "usc", "plaw", "cfr", "fr", "agenda")
FRAMEWORK_NAMES = {
    "constitution": "U.S. Constitution",
    "usc": "United States Code",
    "plaw": "Public Laws",
    "cfr": "Code of Federal Regulations",
    "fr": "Federal Register",
    "agenda": "Unified Agenda",
}
MAX_QUERY_CHARS = 200
MAX_HITS = 25


class NotInstalled(LookupError):
    """The framework (or the CFR / U.S.C. title) that holds this unit is not installed."""


@dataclass
class Hit:
    framework: str
    id: str
    citation: str
    heading: str
    snippet: str = ""
    route: str | None = None


@dataclass
class Document:
    framework: str
    id: str
    citation: str
    heading: str
    text: str
    route: str | None = None
    source_url: str | None = None
    facts: list[tuple[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# What is installed
# ---------------------------------------------------------------------------

def installed() -> dict[str, bool]:
    """Which frameworks have something on disk. Cheap: file checks only."""
    return {
        "constitution": constitution.exists(),
        "usc": bool(usc_store.installed_titles()),
        "plaw": plaw.exists(),
        "cfr": bool(config.installed_titles()),
        "fr": fr_store.exists(),
        "agenda": agenda.exists(),
    }


def installed_summary() -> str:
    """One line for the system prompt: what this install holds."""
    parts = []
    have = installed()
    if have["constitution"]:
        parts.append("the U.S. Constitution")
    usc = usc_store.installed_titles()
    if usc:
        parts.append("U.S. Code titles " + ", ".join(_usc_label(t) for t in usc))
    if have["plaw"]:
        parts.append("Public Laws")
    cfr = config.installed_titles()
    if cfr:
        parts.append("CFR titles " + ", ".join(str(t) for t in cfr))
    if have["fr"]:
        parts.append("the Federal Register archive")
    if have["agenda"]:
        parts.append("the Unified Agenda")
    return "; ".join(parts) if parts else "nothing yet"


def _usc_label(code: int) -> str:
    return ids.usc_collection(code)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def _clean_snippet(s: str | None) -> str:
    return (s or "").replace("\x02", "**").replace("\x03", "**").strip()


def _hit(framework: str, ref_fn, heading: str, snippet: str | None) -> Hit | None:
    try:
        ref = ref_fn()
    except (ids.IdError, TypeError, ValueError):
        return None
    return Hit(framework, ref.id, ids.to_citation(ref), (heading or "").strip(), _clean_snippet(snippet),
               ids.to_route(ref))


def normalize_frameworks(value) -> list[str]:
    """A list (or comma-separated string) of framework names → the known ones, in chain
    order. Empty or "all" means every framework."""
    if value is None or value == "" or value == "all" or value == ["all"]:
        return list(FRAMEWORKS)
    items = value.split(",") if isinstance(value, str) else list(value)
    wanted = {str(v).strip().lower() for v in items}
    return [f for f in FRAMEWORKS if f in wanted]


def search(query: str, frameworks=None, limit: int = 8) -> dict[str, dict]:
    """{framework: {installed, total, hits}} for each requested framework, in chain order.
    `limit` is per framework (1 to `MAX_HITS`)."""
    q = str(query or "").strip()[:MAX_QUERY_CHARS]
    limit = max(1, min(int(limit or 8), MAX_HITS))
    out: dict[str, dict] = {}
    for fw in normalize_frameworks(frameworks):
        out[fw] = _SEARCHERS[fw](q, limit)
    return out


def _search_cfr(q: str, limit: int) -> dict:
    if not config.installed_titles():
        return {"installed": False, "total": 0, "hits": []}
    found = store.search(q, limit=limit, title="all")
    hits = []
    for r in found.get("results", []):
        t, sid = r.get("title"), r.get("id")
        h = _hit("cfr", lambda: ids.from_store_key("cfr", sid, collection=t), r.get("title_label") or "",
                 r.get("snippet"))
        if h:
            hits.append(h)
    return {"installed": True, "total": found.get("total", len(hits)), "hits": hits}


def _search_usc(q: str, limit: int) -> dict:
    found = usc_store.search(q, None, limit)
    hits = []
    for r in found.get("results", []):
        t, sid = r.get("usc_title"), r.get("id")
        h = _hit("usc", lambda: ids.from_store_key("usc", sid, collection=t),
                 (r.get("heading") or "") + (f" [{r['status']}]" if r.get("status") else ""), r.get("snippet"))
        if h:
            hits.append(h)
    return {"installed": found.get("installed", False), "total": found.get("total", 0), "hits": hits}


def _search_constitution(q: str, limit: int) -> dict:
    found = constitution.search(q, limit)
    hits = [h for r in found.get("results", [])
            if (h := _hit("constitution", lambda: ids.constitution_unit(r["id"]), r.get("label") or "",
                          r.get("snippet")))]
    return {"installed": found.get("installed", False), "total": found.get("total", 0), "hits": hits}


def _search_plaw(q: str, limit: int) -> dict:
    found = plaw.search(q, limit)
    hits = [h for r in found.get("results", [])
            if (h := _hit("plaw", lambda: ids.from_store_key("plaw", r["id"]), r.get("title") or "",
                          r.get("snippet")))]
    return {"installed": found.get("installed", False), "total": found.get("total", 0), "hits": hits}


def _search_fr(q: str, limit: int) -> dict:
    with fr_store.read_con() as con:
        if con is None:
            return {"installed": False, "total": 0, "hits": []}
        found = fr_store.search(con, q, limit=limit)
    hits = []
    for r in found.get("results", []):
        bits = [r.get("title") or ""]
        if r.get("type") or r.get("publication_date"):
            bits.append(f"({' · '.join(x for x in (r.get('type'), r.get('publication_date')) if x)})")
        h = _hit("fr", lambda: ids.fr_document(r["document_number"]), " ".join(bits), r.get("snippet"))
        if h:
            hits.append(h)
    return {"installed": True, "total": found.get("total", 0), "hits": hits}


def _search_agenda(q: str, limit: int) -> dict:
    found = agenda.search(q, limit)
    hits = []
    for r in found.get("results", []):
        heading = (r.get("title") or "") + (f" ({r['stage']})" if r.get("stage") else "")
        h = _hit("agenda", lambda: ids.agenda_rule(r["rin"]), heading, r.get("snippet"))
        if h:
            hits.append(h)
    return {"installed": found.get("installed", False), "total": found.get("total", 0), "hits": hits}


_SEARCHERS = {
    "constitution": _search_constitution,
    "usc": _search_usc,
    "plaw": _search_plaw,
    "cfr": _search_cfr,
    "fr": _search_fr,
    "agenda": _search_agenda,
}


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def read(text: str, default_title: int | None = None) -> Document | None:
    """A citation ("29 CFR 1910.134", "42 U.S.C. 2000e-2", "U.S. Const. amend. XIV, § 1",
    "Pub. L. 117-58", "91 FR 60123", "RIN 1218-AD39") or a canonical id → the stored unit.
    Raises `ids.IdError` when the text is neither, `NotInstalled` when its framework is not
    on disk; returns None when the framework is installed but holds no such unit."""
    return read_ref(ids.resolve(str(text or "")[:ids.MAX_ID_LEN], default_title))


def read_ref(ref: ids.Ref) -> Document | None:
    return _READERS[ref.corpus](ref)


def _doc(ref: ids.Ref, heading: str, text: str, facts=None) -> Document:
    return Document(ref.corpus, str(ref), ids.to_citation(ref), (heading or "").strip(), text or "",
                    ids.to_route(ref), ids.to_url(ref), list(facts or []))


def _read_cfr(ref: ids.Ref) -> Document | None:
    title = int(ref.collection)
    if title not in config.installed_titles():
        raise NotInstalled(f"CFR Title {title} is not installed")
    if ref.kind == "part":
        rows = store.part_sections(ref.key, title=title)
        if not rows:
            return None
        lines, last = [], None
        for r in rows:
            path = json.loads(r["path"])
            group = next((f"{p['l']} {p['d']}" for p in reversed(path) if p["t"] in ("subpart", "subject_group")), None)
            if group and group != last:
                lines.append(f"\n{group}")
                last = group
            lines.append(f"  {r['label']} {r['title']}")
        return _doc(ref, f"Part {ref.key} contents", "\n".join(lines).strip())
    try:
        sec = store.section_text(ref.key, title=title)
    except (FileNotFoundError, sqlite3.Error):
        raise NotInstalled(f"CFR Title {title} is not readable") from None
    if not sec:
        return None
    return _doc(ref, sec["title"], sec["text"], [("Part", str(sec["part"]))])


def _read_usc(ref: ids.Ref) -> Document | None:
    code = ids.usc_title_code(ref.collection)
    if code not in usc_store.installed_titles():
        raise NotInstalled(f"Title {ref.collection} of the U.S. Code is not installed")
    key = dict(ids.to_store_key(ref).where)["id"]
    sec = usc_store.get_section(code, key)
    if not sec:
        return None
    parts = [sec["text"]]
    if sec.get("source_credit"):
        parts.append(f"Source credit: {sec['source_credit']}")
    for n in sec.get("notes") or []:
        head = " · ".join(x for x in (n.get("category"), n.get("heading")) if x)
        parts.append(f"Note ({head}): {n.get('text') or ''}" if head else f"Note: {n.get('text') or ''}")
    facts = [("Status", sec["status"])] if sec.get("status") else []
    meta = usc_store.meta(code)
    if meta.get("release_point"):
        facts.append(("Release point", meta["release_point"]))
    return _doc(ref, sec["heading"], "\n\n".join(p for p in parts if p), facts)


def _read_constitution(ref: ids.Ref) -> Document | None:
    if not constitution.exists():
        raise NotInstalled("the U.S. Constitution is not installed")
    if ref.kind == "group":
        sk = ids.to_store_key(ref)
        column, number = sk.where[0]
        with constitution.read_con() as con:
            if con is None:
                raise NotInstalled("the U.S. Constitution is not readable")
            rows = con.execute(f"SELECT label, text FROM units WHERE {column} = ? ORDER BY ord",
                               (number,)).fetchall() if column in ("article", "amendment") else []
        if not rows:
            return None
        return _doc(ref, ids.to_citation(ref), "\n\n".join(f"{r['label']}\n{r['text']}" for r in rows))
    unit = constitution.get_unit(ref.key)
    if not unit:
        return None
    text = unit["text"]
    if unit.get("notes"):
        text += "\n\n" + "\n\n".join(f"Annotation: {n}" for n in unit["notes"])
    return _doc(ref, unit["label"], text)


def _read_plaw(ref: ids.Ref) -> Document | None:
    if not plaw.exists():
        raise NotInstalled("Public Laws are not installed")
    lid = dict(ids.to_store_key(ref).where)["id"]
    with plaw.read_con() as con:
        if con is None:
            raise NotInstalled("Public Laws are not readable")
        row = con.execute("SELECT citation, statute, title, approved_date, bill, text FROM laws WHERE id = ?",
                          (lid,)).fetchone()
        codified = con.execute("SELECT count(*) FROM law_usc WHERE law_id = ? AND kind != 'reference'",
                               (lid,)).fetchone()[0] if row else 0
    if row is None:
        return None
    facts = [(k, v) for k, v in (("Statutes at Large", row["statute"]), ("Approved", row["approved_date"]),
                                 ("Bill", row["bill"])) if v]
    if codified:
        facts.append(("U.S. Code sections it was classified to", str(codified)))
    return _doc(ref, row["title"] or row["citation"] or "", row["text"], facts)


def _read_fr(ref: ids.Ref) -> Document | None:
    with fr_store.read_con() as con:
        if con is None:
            raise NotInstalled("the Federal Register archive is not installed")
        num = ref.key
        if ref.kind == "page":
            r = con.execute("SELECT document_number FROM documents WHERE volume = ? AND start_page <= ? "
                            "AND coalesce(end_page, start_page) >= ? ORDER BY start_page DESC LIMIT 1",
                            (int(ref.collection), int(ref.key), int(ref.key))).fetchone()
            if r is None:
                return None
            num = r["document_number"]
            ref = ids.fr_document(num)
        d = fr_store.get_document(con, num, include_body=True)
    if d is None:
        return None
    facts = [(k, str(v)) for k, v in (
        ("Type", d.get("type")), ("Citation", d.get("citation")), ("Published", d.get("publication_date")),
        ("Effective", d.get("effective_on")), ("Comments close", d.get("comments_close_on")),
        ("Agencies", ", ".join(a.get("name") or a.get("raw_name") or "" for a in d.get("agencies") or [])),
        ("Docket", ", ".join(d.get("docket_ids") or [])), ("RIN", ", ".join(d.get("regulation_id_numbers") or [])),
    ) if v]
    cfr = [f"{c['title']} CFR {c['section'] or 'part ' + c['part']}" for c in d.get("cfr_links") or []]
    if cfr:
        facts.append(("CFR it concerns", ", ".join(cfr[:30])))
    parts = [p for p in (f"Action: {d['action']}" if d.get("action") else "",
                         f"Dates: {d['dates']}" if d.get("dates") else "",
                         f"Summary: {d['abstract']}" if d.get("abstract") else "") if p]
    body = d.get("body") or {}
    if body.get("text"):
        parts.append(body["text"])
    else:
        parts.append("[Only the summary is stored. The full text of this document has not been downloaded; "
                     "the reader can open it in the app to fetch it.]")
    return _doc(ref, d.get("title") or num, "\n\n".join(parts), facts)


def _read_agenda(ref: ids.Ref) -> Document | None:
    if not agenda.exists():
        raise NotInstalled("the Unified Agenda is not installed")
    e = agenda.get_entry(ref.key, None if ref.collection == "rin" else ref.collection)
    if not e:
        return None
    facts = [(k, str(v)) for k, v in (
        ("Edition", ids.edition_label(e["edition"]) if e.get("edition") else None),
        ("Agency", e.get("agency") or e.get("parent")), ("Stage", e.get("stage")), ("Priority", e.get("priority")),
        ("Major", e.get("major")), ("Status", e.get("rin_status")),
        ("CFR", ", ".join(map(str, e.get("cfr") or []))), ("Legal authority", ", ".join(map(str, e.get("authority") or []))),
    ) if v]
    parts = [e.get("abstract") or ""]
    tt = e.get("timetable") or []
    if tt:
        parts.append("Timetable:\n" + "\n".join(
            f"- {t.get('action') or ''}: {t.get('date') or ''}" + (f" ({t['fr_citation']})" if t.get("fr_citation") else "")
            for t in tt))
    docs = e.get("fr_documents") or []
    if docs:
        parts.append("Federal Register documents:\n" + "\n".join(
            f"- {x.get('citation') or x['document_number']} {x.get('title') or ''} ({x.get('publication_date') or ''})"
            for x in docs))
    return _doc(ref, e.get("title") or ref.key, "\n\n".join(p for p in parts if p), facts)


_READERS = {
    "cfr": _read_cfr,
    "usc": _read_usc,
    "constitution": _read_constitution,
    "plaw": _read_plaw,
    "fr": _read_fr,
    "agenda": _read_agenda,
}
