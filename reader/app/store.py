"""Read-side access to the federated CFR databases."""
from __future__ import annotations

import json
import logging
import re
import sqlite3
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from typing import Iterator

from . import config
from .render import SectionDoc, clean_label, render_fragment_html, section_doc

logger = logging.getLogger(__name__)

_local = threading.local()
# Every open connection, across threads, paired with its own RLock so release_title() can
# close handles cleanly on Windows without closing a connection mid-query on another thread.
_registry_lock = threading.Lock()
_registry: list[tuple[int, sqlite3.Connection, threading.RLock]] = []
_con_locks: dict[int, threading.RLock] = {}
_generation: dict[int, int] = {}
_swapping: set[int] = set()

_cache_lock = threading.Lock()
_meta_cache: dict[int, dict] = {}
_known_ids_cache: dict[int, frozenset[str]] = {}
_known_parts_cache: dict[int, frozenset[str]] = {}
_section_doc_cache: OrderedDict[tuple[str, int], SectionDoc | None] = OrderedDict()
_section_html_cache: OrderedDict[tuple[str, int], str | None] = OrderedDict()
_unit_html_cache: OrderedDict[tuple[str, str, int], str | None] = OrderedDict()

_SECTION_DOC_MAX = 32
_SECTION_HTML_MAX = 512
_UNIT_HTML_MAX = 1024


def db(title: int = config.DEFAULT_TITLE) -> sqlite3.Connection:
    """Return a thread-local SQLite connection for the specified CFR title."""
    cons = getattr(_local, "cons", None)
    if cons is None:
        cons = {}
        _local.cons = cons
    with _registry_lock:
        gen = _generation.get(title, 0)
    entry = cons.get(title)
    if entry is not None and entry[1] == gen:
        return entry[0]
    path = config.db_path(title)
    if not path.exists():
        raise FileNotFoundError(f"Title {title} is not installed (no database at {path})")
    con = sqlite3.connect(path, timeout=5.0, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout = 5000")
    con.execute("PRAGMA query_only = ON")
    lock = threading.RLock()
    with _registry_lock:
        _registry.append((title, con, lock))
        _con_locks[id(con)] = lock
    cons[title] = (con, gen)
    return con


@contextmanager
def read_db(title: int = config.DEFAULT_TITLE) -> Iterator[sqlite3.Connection]:
    """Acquire the title's connection and hold its per-connection lock while querying."""
    con = db(title)
    with _registry_lock:
        lock = _con_locks.get(id(con))
    if lock is None:
        yield con
        return
    with lock:
        yield con


def release_title(title: int) -> None:
    """Close every thread's connection to `title` and drop cached renders for `title`."""
    to_close: list[tuple[sqlite3.Connection, threading.RLock]] = []
    with _registry_lock:
        _generation[title] = _generation.get(title, 0) + 1
        keep = []
        for t, con, lock in _registry:
            if t == title:
                _con_locks.pop(id(con), None)
                to_close.append((con, lock))
            else:
                keep.append((t, con, lock))
        _registry[:] = keep
    for con, lock in to_close:
        with lock:
            try:
                con.close()
            except Exception:
                pass
    clear_caches(title)


def begin_swap(title: int) -> None:
    """Mark `title` as actively replacing its on-disk files and release existing handles."""
    with _registry_lock:
        _swapping.add(title)
    release_title(title)


def end_swap(title: int) -> None:
    """Finish file replacement for `title` and drop any caches populated mid-swap."""
    with _registry_lock:
        _swapping.discard(title)
    release_title(title)


def _is_swapping(title: int) -> bool:
    with _registry_lock:
        return title in _swapping


def clear_caches(title: int | None = None) -> None:
    from .citations import graph
    with _cache_lock:
        if title is None:
            _meta_cache.clear()
            _known_ids_cache.clear()
            _known_parts_cache.clear()
            _section_doc_cache.clear()
            _section_html_cache.clear()
            _unit_html_cache.clear()
        else:
            _meta_cache.pop(title, None)
            _known_ids_cache.pop(title, None)
            _known_parts_cache.pop(title, None)
            for k in [k for k in _section_doc_cache if k[1] == title]:
                _section_doc_cache.pop(k, None)
            for k in [k for k in _section_html_cache if k[1] == title]:
                _section_html_cache.pop(k, None)
            for k in [k for k in _unit_html_cache if k[2] == title]:
                _unit_html_cache.pop(k, None)
    graph.clear_caches(title)


def reset_connections() -> None:
    """Close all open connections and clear in-memory caches."""
    to_close: list[tuple[sqlite3.Connection, threading.RLock]] = []
    with _registry_lock:
        for t in {t for t, _, _ in _registry} | set(_generation):
            _generation[t] = _generation.get(t, 0) + 1
        _swapping.clear()
        for _, c, lock in _registry:
            _con_locks.pop(id(c), None)
            to_close.append((c, lock))
        _registry.clear()
    for c, lock in to_close:
        with lock:
            try:
                c.close()
            except Exception:
                pass
    _local.__dict__.clear()
    clear_caches(None)


def _lru_get(cache: OrderedDict, key):
    with _cache_lock:
        if key in cache:
            cache.move_to_end(key)
            return True, cache[key]
    return False, None


def _lru_put(cache: OrderedDict, key, val, maxsize: int) -> None:
    with _cache_lock:
        cache[key] = val
        cache.move_to_end(key)
        while len(cache) > maxsize:
            cache.popitem(last=False)


def meta(title: int = config.DEFAULT_TITLE) -> dict:
    if not _is_swapping(title):
        with _cache_lock:
            if title in _meta_cache:
                return _meta_cache[title]
    with read_db(title) as con:
        val = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}
    if not _is_swapping(title):
        with _cache_lock:
            _meta_cache[title] = val
    return val


meta.cache_clear = lambda: clear_caches(None)  # type: ignore[attr-defined]


def safe_meta(title: int) -> tuple[dict, bool]:
    """Read `meta(title)` with fault isolation. Returns (meta_dict, unreadable)."""
    try:
        return meta(title), False
    except (sqlite3.Error, OSError):
        return {}, True


def edition(title: int = config.DEFAULT_TITLE) -> str:
    return meta(title).get("edition", "")


def known_ids(title: int = config.DEFAULT_TITLE) -> frozenset[str]:
    """Return known section IDs for `title`, never caching transient read failures."""
    try:
        if not _is_swapping(title):
            with _cache_lock:
                if title in _known_ids_cache:
                    return _known_ids_cache[title]
        with read_db(title) as con:
            val = frozenset(r[0] for r in con.execute("SELECT id FROM sections"))
        if not _is_swapping(title):
            with _cache_lock:
                _known_ids_cache[title] = val
        return val
    except (sqlite3.Error, OSError):
        return frozenset()


known_ids.cache_clear = lambda: _known_ids_cache.clear()  # type: ignore[attr-defined]


def known_parts(title: int = config.DEFAULT_TITLE) -> frozenset[str]:
    """Return known part IDs for `title`, never caching transient read failures."""
    try:
        if not _is_swapping(title):
            with _cache_lock:
                if title in _known_parts_cache:
                    return _known_parts_cache[title]
        with read_db(title) as con:
            val = frozenset(r[0] for r in con.execute("SELECT DISTINCT part FROM sections WHERE part IS NOT NULL"))
        if not _is_swapping(title):
            with _cache_lock:
                _known_parts_cache[title] = val
        return val
    except (sqlite3.Error, OSError):
        return frozenset()


known_parts.cache_clear = lambda: _known_parts_cache.clear()  # type: ignore[attr-defined]


def is_known_in_title(title: int, section_id: str) -> bool:
    try:
        return section_id in known_ids(title)
    except Exception:
        return False


def normalize_id(raw: str, title: int = config.DEFAULT_TITLE) -> str:
    """Accepts '§ 541.100', '29 CFR 541.100', '541.100(a)(1)' and returns '541.100'."""
    s = raw.strip()
    if s in known_ids(title):
        return s
    s = re.sub(r"^(\d{1,2}\s*C\.?F\.?R\.?\s*)?(§+\s*)?", "", s, flags=re.I).strip()
    s = re.sub(r"(\([^)]*\))+$", "", s).strip()
    return s


def _build_section_doc(section_id: str, title: int) -> SectionDoc | None:
    with read_db(title) as con:
        row = con.execute("SELECT xml FROM sections WHERE id = ?", (section_id,)).fetchone()
    if not row:
        return None
    return section_doc(
        row["xml"],
        known=known_ids(title).__contains__,
        title=title,
        known_by_title=is_known_in_title,
        installed_titles=config.installed_titles,
        known_parts=known_parts(title).__contains__,
    )


def _section_doc(section_id: str, title: int = config.DEFAULT_TITLE) -> SectionDoc | None:
    """A parsed section (units, levels), shared by the full and per-unit renders."""
    key = (section_id, title)
    if _is_swapping(title):
        return _build_section_doc(section_id, title)
    hit, val = _lru_get(_section_doc_cache, key)
    if hit:
        return val
    val = _build_section_doc(section_id, title)
    if not _is_swapping(title):
        _lru_put(_section_doc_cache, key, val, _SECTION_DOC_MAX)
    return val


_section_doc.cache_clear = lambda: _section_doc_cache.clear()  # type: ignore[attr-defined]


def section_html(section_id: str, title: int = config.DEFAULT_TITLE) -> str | None:
    key = (section_id, title)
    if _is_swapping(title):
        doc = _section_doc(section_id, title)
        return doc.full_html() if doc else None
    hit, val = _lru_get(_section_html_cache, key)
    if hit:
        return val
    doc = _section_doc(section_id, title)
    val = doc.full_html() if doc else None
    if not _is_swapping(title):
        _lru_put(_section_html_cache, key, val, _SECTION_HTML_MAX)
    return val


section_html.cache_clear = lambda: _section_html_cache.clear()  # type: ignore[attr-defined]


def unit_html(section_id: str, key: str, title: int = config.DEFAULT_TITLE) -> str | None:
    ck = (section_id, key, title)
    if _is_swapping(title):
        doc = _section_doc(section_id, title)
        return doc.unit_html(key) if doc else None
    hit, val = _lru_get(_unit_html_cache, ck)
    if hit:
        return val
    doc = _section_doc(section_id, title)
    val = doc.unit_html(key) if doc else None
    if not _is_swapping(title):
        _lru_put(_unit_html_cache, ck, val, _UNIT_HTML_MAX)
    return val


unit_html.cache_clear = lambda: _unit_html_cache.clear()  # type: ignore[attr-defined]


def _clean_path(raw: str) -> list:
    path = json.loads(raw)
    for item in path:
        if isinstance(item, dict):
            if "l" in item:
                item["l"] = clean_label(item["l"])
            if "d" in item:
                item["d"] = clean_label(item["d"])
    return path


def _clean_neighbor(row: sqlite3.Row | None) -> dict | None:
    if not row:
        return None
    d = dict(row)
    d["label"] = clean_label(d.get("label"))
    d["title"] = clean_label(d.get("title"))
    return d


def get_section(raw_id: str, title: int = config.DEFAULT_TITLE, unit: str | None = None) -> dict | None:
    """A section with its outline. With `unit` (possibly "" for the first) and a section long
    enough to read in parts, `html` is just that unit; otherwise it is the whole section."""
    section_id = normalize_id(raw_id, title)
    with read_db(title) as con:
        row = con.execute(
            "SELECT id, kind, ord, part, label, title, reserved, path, ecfr_path FROM sections WHERE id = ?",
            (section_id,),
        ).fetchone()
        if not row:
            return None
        neighbors = {}
        for name, op, order in (("prev", "<", "DESC"), ("next", ">", "ASC")):
            n = con.execute(
                f"SELECT id, label, title FROM sections WHERE ord {op} ? ORDER BY ord {order} LIMIT 1",
                (row["ord"],),
            ).fetchone()
            neighbors[name] = _clean_neighbor(n)

    doc = _section_doc(row["id"], title)
    outline = doc.outline() if doc else []
    mode = doc.mode if doc else "page"
    current = None
    if unit is not None and mode == "units":
        found = doc.find(unit)
        if found is not None:
            current = found["key"]
            html = unit_html(row["id"], current, title)
        else:
            html = section_html(row["id"], title)
    else:
        html = section_html(row["id"], title)
    keys = [u["key"] for u in outline]
    i = keys.index(current) if current in keys else -1
    clean_sec_title = clean_label(row["title"])
    return {
        "id": row["id"],
        "title": title,
        "kind": row["kind"],
        "part": row["part"],
        "label": clean_label(row["label"]),
        "section_title": clean_sec_title,
        "title_label": clean_sec_title,
        "reserved": bool(row["reserved"]),
        "path": _clean_path(row["path"]),
        "ecfr_url": config.ECFR_BASE + (row["ecfr_path"] or f"/current/title-{title}/part-{row['part']}"),
        "html": html,
        "mode": mode,          # "units": long, read a unit at a time; "page": one page
        "outline": outline,    # every unit: key, label, title, kind, group…, chars
        "unit": current,       # the unit in `html`, or None when `html` is the whole section
        "unit_prev": outline[i - 1] if i > 0 else None,
        "unit_next": outline[i + 1] if 0 <= i < len(outline) - 1 else None,
        **neighbors,
    }


def section_text(raw_id: str, title: int = config.DEFAULT_TITLE) -> dict | None:
    section_id = normalize_id(raw_id, title)
    with read_db(title) as con:
        row = con.execute(
            "SELECT id, kind, part, label, title, text FROM sections WHERE id = ?", (section_id,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["label"] = clean_label(d.get("label"))
    d["title"] = clean_label(d.get("title"))
    return d


def part_sections(part: str, title: int = config.DEFAULT_TITLE) -> list[dict]:
    with read_db(title) as con:
        rows = con.execute(
            "SELECT id, label, title, reserved, path FROM sections WHERE part = ? ORDER BY ord", (part,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["label"] = clean_label(d.get("label"))
        d["title"] = clean_label(d.get("title"))
        out.append(d)
    return out


def part_full(part: str, title: int = config.DEFAULT_TITLE) -> list[dict]:
    """Every section of a part in reading order, each with its rendered HTML."""
    with read_db(title) as con:
        rows = con.execute(
            "SELECT id, kind, label, title, reserved FROM sections WHERE part = ? ORDER BY ord",
            (part,),
        ).fetchall()
    return [
        {
            "id": r["id"], "kind": r["kind"], "label": clean_label(r["label"]),
            "title": clean_label(r["title"]), "reserved": bool(r["reserved"]),
            "html": section_html(r["id"], title) or "",
        }
        for r in rows
    ]


def get_part_front_matter(part: str, title: int = config.DEFAULT_TITLE) -> dict:
    known = known_ids(title).__contains__
    with read_db(title) as con:
        rows = con.execute(
            "SELECT key, xml FROM front_matter WHERE key = ? OR key LIKE ?", (f"part/{part}", f"part/{part}/subpart/%")
        ).fetchall()
    out = {"part": "", "subparts": {}}
    for r in rows:
        rendered = render_fragment_html(
            r["xml"],
            known=known,
            title=title,
            known_by_title=is_known_in_title,
            installed_titles=config.installed_titles,
            known_parts=known_parts(title).__contains__,
        )
        if r["key"] == f"part/{part}":
            out["part"] = rendered
        elif rendered:
            out["subparts"][r["key"].rsplit("/", 1)[-1]] = rendered
    return out


# ---------------------------------------------------------------------------
# Full-text search
# ---------------------------------------------------------------------------

_PHRASE = re.compile(r'"([^"]+)"|(\S+)')
_TOKEN = re.compile(r"\w+(?:[.\-]\w+)*")


def fts_query(q: str, prefix_last: bool = True) -> str | None:
    terms: list[str] = []
    for m in _PHRASE.finditer(q):
        if m.group(1):
            words = _TOKEN.findall(m.group(1))
            if words:
                cleaned = " ".join(words).replace('"', '""')
                terms.append(f'"{cleaned}"')
        else:
            for t in _TOKEN.findall(m.group(2)):
                cleaned = t.replace('"', '""')
                terms.append(f'"{cleaned}"')
    if not terms:
        return None
    last = terms[-1]
    if prefix_last and " " not in last and len(last.strip('"')) >= 5 and not q.rstrip().endswith('"'):
        terms[-1] = last + "*"
    return " ".join(terms)


def search_single_title(q: str, title: int, part: str | None = None, limit: int = 30) -> tuple[int, list[dict]]:
    """Search within a single title database. Returns (total_matches, results_list)."""
    results: list[dict] = []
    exact_id = normalize_id(q, title)
    with read_db(title) as con:
        if exact_id in known_ids(title):
            row = con.execute(
                "SELECT id, kind, part, label, title FROM sections WHERE id = ?", (exact_id,)
            ).fetchone()
            if row:
                d = dict(row)
                d["label"] = clean_label(d.get("label"))
                d["title"] = clean_label(d.get("title"))
                results.append({**d, "title_label": d["title"], "title": title,
                                "snippet": "", "exact": True, "score": -999.0})

        match = fts_query(q)
        total = 0
        if match:
            where = "sections_fts MATCH ?"
            params: list = [match]
            if part:
                where += " AND s.part = ?"
                params.append(part)
            try:
                total = con.execute(
                    f"SELECT count(*) FROM sections_fts JOIN sections s ON s.id = sections_fts.id WHERE {where}",
                    params,
                ).fetchone()[0]
                rows = con.execute(
                    f"""SELECT s.id, s.kind, s.part, s.label, s.title,
                               snippet(sections_fts, 3, char(2), char(3), ' … ', 28) AS snippet,
                               bm25(sections_fts, 0.0, 8.0, 6.0, 1.0) AS score
                        FROM sections_fts JOIN sections s ON s.id = sections_fts.id
                        WHERE {where}
                        ORDER BY score, s.reserved
                        LIMIT ?""",
                    params + [limit],
                ).fetchall()
            except sqlite3.OperationalError as exc:
                logger.warning("FTS query failed for title %s (%r): %s", title, q, exc)
                rows = []
            seen = {r["id"] for r in results}
            for r in rows:
                if r["id"] not in seen:
                    d = dict(r)
                    d["label"] = clean_label(d.get("label"))
                    d["title"] = clean_label(d.get("title"))
                    results.append({**d, "title_label": d["title"], "title": title, "exact": False})
    return max(total, len(results)), results


def search(
    q: str,
    part: str | None = None,
    limit: int = 30,
    title: int | str = config.DEFAULT_TITLE,
) -> dict:
    """Execute search scoped to a specific title, or across all installed titles if title='all'."""
    started = time.perf_counter()
    safe_limit = max(1, min(limit, 100))

    if title == "all" or title is None:
        installed = config.installed_titles()
        all_results: list[dict] = []
        grand_total = 0
        for t in installed:
            try:
                t_total, t_res = search_single_title(q, title=t, part=part, limit=safe_limit)
                grand_total += t_total
                all_results.extend(t_res)
            except Exception as exc:
                logger.warning("Federated search skipped title %s (%r): %s", t, q, exc)
                continue

        # Sort combined results: exact matches first, then best BM25 score
        all_results.sort(key=lambda r: (not r.get("exact", False), r.get("score", 0.0)))
        final_results = all_results[:safe_limit]
        return {
            "query": q,
            "title": "all",
            "total": grand_total,
            "results": final_results,
            "ms": round((time.perf_counter() - started) * 1000),
        }

    target_title = int(title)
    total, results = search_single_title(q, title=target_title, part=part, limit=safe_limit)
    return {
        "query": q,
        "title": target_title,
        "total": total,
        "results": results[:safe_limit],
        "ms": round((time.perf_counter() - started) * 1000),
    }


