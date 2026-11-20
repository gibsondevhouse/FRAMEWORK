"""Generate the data dictionary, `reader/DATA_DICTIONARY.md` (register DM-002).

    python -m app.schema_doc             # write reader/DATA_DICTIONARY.md
    python -m app.schema_doc --check     # exit 1 if the committed file is out of date
    python -m app.schema_doc --stdout    # print it instead

One Markdown file lists every store: its tables, columns, indexes and FTS tables, its known
meta keys, its schema version and migrations. Everything structural is read from the schema
definitions in code: each kind in `migrate.KINDS` is created in an in-memory database and
inspected with SQLite's own pragmas, so `reader/data/` is never opened and an empty clone
generates the same file. Column notes are the `--` comments already written in each `SCHEMA`.

What code cannot say is written here, next to the generator, and checked by
`tests/test_schema_doc.py`: `STORES` (what a store is), `TABLES` (one line per table; a new
table without a line fails the test) and `META_KEYS` (every key a pipeline writes must be
listed). The same test compares this module's output with the committed file, so a schema
change that was not followed by `python -m app.schema_doc` fails.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

from . import config, migrate

OUTPUT = config.ROOT_DIR / "DATA_DICTIONARY.md"
_SHADOW = ("_data", "_idx", "_content", "_docsize", "_config")

# ---------------------------------------------------------------------------
# What the schema cannot say for itself
# ---------------------------------------------------------------------------

STORES: dict[str, dict[str, str]] = {
    "cfr": {
        "about": "One per installed CFR title: every section and appendix of the title (or of the parts chosen "
                 "for a partial install), as eCFR XML and as plain text.",
        "built": "`python -m app.build --title N`, or a Library download. A build replaces the whole file.",
        "beside": "`tree-{N}.json`, the title's contents tree, served to the sidebar as it is.",
    },
    "usc": {
        "about": "One per installed U.S. Code title, from the OLRC's USLM XML. Appendix titles are numbered "
                 "100 + N (5a is `usc-105.sqlite3`).",
        "built": "`python -m app.usc_build --title N`, or a Library download. A build replaces the whole file.",
        "beside": "`usc-tree-{N}.json`, the title's chapter outline.",
    },
    "fr": {
        "about": "The Federal Register archive: one row per document inside the collected window, with full text "
                 "fetched on demand.",
        "built": "`python -m app.fr_build` (resumable; staged in `fr.sqlite3.tmp`), then updated in place.",
    },
    "news": {
        "about": "The newsroom feed: recent Federal Register documents, Public Inspection filings and DOL "
                 "enforcement records, with enriched inspection case files. A cache of public data.",
        "built": "Created on first use and filled by the background news worker.",
    },
    "constitution": {
        "about": "The U.S. Constitution by article, section and amendment, with the House Manual's annotations "
                 "kept apart from the text.",
        "built": "`python -m app.constitution`. A build replaces the whole file.",
    },
    "plaw": {
        "about": "Public and private laws from the 113th Congress on, as USLM XML, with their links into the "
                 "U.S. Code.",
        "built": "`python -m app.plaw` (resumable; staged in `plaw.sqlite3.tmp`), then updated in place.",
    },
    "agenda": {
        "about": "The Unified Agenda of regulatory actions: one row per rule (RIN) per edition.",
        "built": "`python -m app.agenda` (resumable; staged in `agenda.sqlite3.tmp`), then updated in place.",
    },
    "sources": {
        "about": "The reader's saved choice of data sources and their saved templates. The one store that holds "
                 "the reader's own settings rather than public data.",
        "built": "Created the first time a selection or template is saved.",
    },
}

TABLES: dict[str, dict[str, str]] = {
    "cfr": {
        "meta": "Facts about the build, as key and value (keys below).",
        "sections": "One row per section or appendix, in reading order.",
        "front_matter": "Authority and source notes of parts and subparts, keyed `part/{N}` and "
                        "`part/{N}/subpart/{X}`.",
        "sections_fts": "Full-text index over `sections` (`id` joins back to it).",
        "title_graph": "Derived: the title's citation graph as one JSON document under `key = 'index'` (web "
                       "references, cited-by backlinks, IBR catalog). `python -m app.reindex` rebuilds it.",
    },
    "usc": {
        "meta": "Facts about the build, as key and value (keys below).",
        "sections": "One row per section, in reading order; `status` is NULL for a section in force.",
        "notes": "Editorial, statutory and executive notes, kept apart from the section text. `owner` is a "
                 "section id or a level identifier such as `/us/usc/t4/ch1`.",
        "sections_fts": "Full-text index over `sections` (`id` joins back to it).",
        "notes_fts": "Full-text index over `notes` (rowid = `notes.id`).",
    },
    "fr": {
        "meta": "Facts about the corpus and its last sync, as key and value (keys below).",
        "documents": "One row per Federal Register document, with the API record verbatim in `raw_json`.",
        "document_bodies": "Full text, fetched on demand: the payload as served, its plain text and its hash.",
        "document_cfr": "Which CFR title, part and section each document touches, and where the link came from.",
        "coverage": "The date ranges that have been fetched, per scope (`title` 0 = every document).",
        "build_chunks": "The chunks a full build has finished, so an interrupted build resumes.",
        "documents_fts": "Full-text index over title, abstract, action and body (rowid = the `documents` rowid).",
    },
    "news": {
        "articles": "One row per news item, whatever its source.",
        "article_citations": "The CFR parts and sections each item cites, for the in-reader activity lookups.",
        "articles_fts": "Full-text index over `articles` (rowid = the `articles` rowid).",
        "sync_status": "One row per source (`federal_register`, `federal_register_pi`, `dol_osha`): last "
                       "success, last error and the failure count that drives backoff.",
        "enforcement_cases": "An enriched DOL inspection case file, as JSON columns.",
        "enforcement_narratives_fts": "Full-text index over General Duty narratives and accident abstracts.",
        "dol_datasets": "The DOL Open Data catalog as last discovered by `python -m app.dol_catalog`.",
        "fr_bodies": "Sanitized Federal Register preambles fetched for the in-app reader.",
    },
    "constitution": {
        "meta": "Facts about the build, as key and value (keys below).",
        "units": "One row per reading unit: the preamble, an article section, an article, an amendment or an "
                 "amendment section.",
        "notes": "The House Manual's annotations for a unit, in order.",
        "units_fts": "Full-text index over `units` (`id` joins back to it).",
        "notes_fts": "Full-text index over `notes` (`unit_id` joins to `units`).",
    },
    "plaw": {
        "meta": "Facts about the corpus and its last sync, as key and value (keys below).",
        "laws": "One row per law; the USLM XML is zlib-compressed in `xml_z`, with its hash and length.",
        "law_usc": "A law's links into the U.S. Code: `reference`, `codified` or `note`.",
        "build_chunks": "The (congress, type) chunks a build has finished, so an interrupted build resumes.",
        "laws_fts": "Full-text index over `laws` (`id` joins back to it).",
    },
    "agenda": {
        "meta": "Facts about the corpus and its last sync, as key and value (keys below).",
        "entries": "One row per rule (RIN) per edition.",
        "editions": "One row per Agenda edition downloaded, with its hash and source URL.",
        "build_chunks": "The editions a build has finished, so an interrupted build resumes.",
        "entries_fts": "Full-text index over `entries` (`rin` and `edition` join back to it).",
    },
    "sources": {
        "settings": "Key and JSON value. The one key in use is `selection`: the saved source selection.",
        "templates": "The reader's saved selection templates.",
    },
}

_SYNC = {
    "last_ok_at": "When the last sync succeeded.",
    "fail_count": "Consecutive failed syncs; drives the retry backoff. `0` after a success.",
    "last_error": "The last failure, in a sentence; empty after a success.",
    "last_error_at": "When the last failure happened.",
}

META_KEYS: dict[str, dict[str, str]] = {
    "cfr": {
        "title": "The CFR title number.",
        "title_name": "The title's name, from eCFR.",
        "edition": "The eCFR edition date the text is from (`up_to_date_as_of`).",
        "built_at": "When the store was built (local time).",
        "fetched_at": "When the structure and text were downloaded (UTC).",
        "section_count": "Rows in `sections`.",
        "missing_leaves": "Structure entries that had no text in the XML.",
        "missing_sample": "JSON list of up to ten of those ids; present only when some are missing.",
        "scope": "JSON `{parts, sections}` of a partial install; absent for a whole title.",
        "source_url": "The eCFR full-text XML URL.",
        "structure_url": "The eCFR structure JSON URL.",
        "structure_sha256": "SHA-256 of the structure JSON in canonical form.",
        "xml_sha256": "SHA-256 of the downloaded XML, or of the piece manifest for a partial install.",
        "xml_sha256_kind": "`file` or `manifest`: what `xml_sha256` covers.",
        "xml_pieces": "JSON list of `{url, sha256}` per downloaded piece; partial installs only.",
    },
    "usc": {
        "title": "The title number (100 + N for an appendix title).",
        "title_name": "The title's name.",
        "release_point": "The OLRC release point the text is from, such as `119-142`.",
        "current_through": "The public law the release point is current through.",
        "built_at": "When the store was built (UTC).",
        "section_count": "Rows in `sections`.",
        "note_count": "Rows in `notes`.",
        "duplicate_ids": "Sections whose number repeated and got a `~2` suffix.",
        "positive_law": "`1` when the title is enacted as positive law.",
        "publication": "The publication name in the XML's metadata.",
        "source_url": "The zip that was downloaded.",
        "release_page": "The OLRC page where the release point was found.",
        "zip_sha256": "SHA-256 of the zip.",
        "xml_sha256": "SHA-256 of the XML inside it.",
        "xml_member": "The XML file's name inside the zip.",
    },
    "fr": {
        "source": "Where the documents come from (the Federal Register API).",
        "schema": "The schema version as text; `PRAGMA user_version` is the one that counts.",
        "built_at": "When the full build finished.",
        "build_started_at": "When the full build started.",
        "updated_at": "When the corpus was last updated.",
        "window_start": "First publication date collected.",
        "window_end": "Last publication date collected.",
        "titles": "JSON list of the scopes collected (`0` = every document, else CFR titles).",
        "filters": "JSON of the agency, type and CFR-title filters in force.",
        "doc_count": "Rows in `documents`.",
        "last_publication_date": "The newest publication date held.",
        "pending_build": "JSON of the build in progress; only in the staging file.",
        **_SYNC,
    },
    "constitution": {
        "source": "Where the text comes from (GovInfo bulk data, the House Rules and Manual).",
        "edition": "The House Manual edition, such as `HMAN-118`.",
        "congress": "That edition's Congress.",
        "source_url": "The zip that was downloaded.",
        "member": "The Constitution's XML file inside it.",
        "zip_sha256": "SHA-256 of the zip.",
        "xml_sha256": "SHA-256 of the XML.",
        "xml_bytes": "Length of the XML in bytes.",
        "fetched_at": "When it was downloaded.",
        "built_at": "When the store was built.",
        "unit_count": "Rows in `units`.",
        "note_count": "Rows in `notes`.",
        "amendment_count": "Amendments present (27 when complete).",
        "checked_at": "When GovInfo was last asked for a newer edition.",
        "last_error": "The last failed check, in a sentence; empty after a success.",
        "last_error_at": "When the last failure happened.",
    },
    "plaw": {
        "source": "Where the laws come from (GovInfo bulk data).",
        "scope": "JSON `{congresses, types, follow}`: what was asked for.",
        "latest_congress": "The newest Congress GovInfo listed at the last sync.",
        "built_at": "When the full build finished.",
        "build_started_at": "When the full build started.",
        "updated_at": "When the corpus was last updated.",
        "law_count": "Rows in `laws`.",
        "usc_link_count": "Rows in `law_usc`.",
        "pending_build": "JSON of the build in progress; only in the staging file.",
        **_SYNC,
    },
    "agenda": {
        "source": "Where the entries come from (reginfo.gov).",
        "years": "How many years of editions were asked for.",
        "filters": "JSON of the agency and stage filters in force.",
        "built_at": "When the full build finished.",
        "updated_at": "When the corpus was last updated.",
        "entry_count": "Rows in `entries`.",
        "edition_count": "Rows in `editions`.",
        "pending_build": "JSON of the build in progress; only in the staging file.",
        **_SYNC,
    },
}

_WRITTEN = {
    "swap": "Replaced whole: a migration or reindex rewrites a copy and swaps it in.",
    "inplace": "Also written between builds: a migration runs in one transaction on the live file.",
}


# ---------------------------------------------------------------------------
# Reading the schema
# ---------------------------------------------------------------------------

def _fts(sql: str) -> dict:
    """Columns and options of a `CREATE VIRTUAL TABLE … USING fts5(…)` statement."""
    inner = sql[sql.index("(") + 1: sql.rindex(")")]
    columns, options = [], {}
    for arg in (a.strip() for a in inner.split(",")):
        if not arg:
            continue
        if "=" in arg:
            key, _, value = arg.partition("=")
            options[key.strip()] = value.strip().strip("'\"")
        else:
            name, _, flag = arg.partition(" ")
            columns.append({"name": name, "indexed": flag.strip().upper() != "UNINDEXED"})
    return {"columns": columns, "options": options}


def _column_comments(sql: str, names: set[str]) -> dict[str, str]:
    """The `-- comment` written after a column in the schema source."""
    out: dict[str, str] = {}
    for line in sql.splitlines():
        m = re.match(r"\s*([A-Za-z_]\w*)\b[^\n]*?--\s*(.*\S)\s*$", line)
        if m and m.group(1) in names:
            out[m.group(1)] = m.group(2)
    return out


def describe(kind: str) -> list[dict]:
    """The tables of a freshly built store of `kind`, in the order the schema creates them."""
    con = sqlite3.connect(":memory:")
    try:
        migrate.init(con, kind)
        rows = con.execute(
            "SELECT type, name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid"
        ).fetchall()
        virtual = {n for _, n, s in rows if s.upper().startswith("CREATE VIRTUAL")}
        out: list[dict] = []
        for _, name, sql in rows:
            if any(name == v + x for v in virtual for x in _SHADOW):
                continue                                    # an FTS table's own storage
            if name in virtual:
                out.append({"name": name, "fts": _fts(sql)})
                continue
            cols = con.execute(f'PRAGMA table_xinfo("{name}")').fetchall()
            comments = _column_comments(sql, {c[1] for c in cols})
            refs = {r[3]: f"`{r[2]}.{r[4]}`" + (f" (on delete {r[6].lower()})" if r[6] != "NO ACTION" else "")
                    for r in con.execute(f'PRAGMA foreign_key_list("{name}")')}
            pk_size = sum(1 for c in cols if c[5])
            columns = []
            for _, cname, ctype, notnull, default, pk, *_ in cols:
                rules = []
                if pk:
                    rules.append("primary key" if pk_size == 1 else f"primary key, part {pk} of {pk_size}")
                if notnull:
                    rules.append("required")
                if default is not None:
                    rules.append(f"default `{default}`")
                if cname in refs:
                    rules.append(f"references {refs[cname]}")
                columns.append({"name": cname, "type": ctype or "", "rules": rules, "note": comments.get(cname, "")})
            indexes = []
            for _, iname, unique, origin, *_ in con.execute(f'PRAGMA index_list("{name}")').fetchall():
                if origin != "c":                           # implied by a primary key or UNIQUE
                    continue
                keys = [f"{r[2]} DESC" if r[3] else r[2]
                        for r in con.execute(f'PRAGMA index_xinfo("{iname}")') if r[5]]
                indexes.append({"name": iname, "unique": bool(unique), "columns": keys})
            out.append({"name": name, "columns": columns, "indexes": sorted(indexes, key=lambda i: i["name"])})
        return out
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Writing the document
# ---------------------------------------------------------------------------

def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def _store_section(kind: str) -> list[str]:
    spec, about = migrate.KINDS[kind], STORES[kind]
    lines = [f"## {spec.label}: `{spec.file}`", "", about["about"], ""]
    lines.append(f"- **Built by:** {about['built']}")
    lines.append(f"- **Written:** {_WRITTEN[spec.mode]}")
    if about.get("beside"):
        lines.append(f"- **Beside it:** {about['beside']}")
    lines.append(f"- **Schema version:** {migrate.latest(kind)} (`migrate.latest(\"{kind}\")`)")
    steps = migrate.MIGRATIONS[kind]
    if spec.floor:
        lines.append(f"- **Migrations:** the store's own module brings older layouts up to version {spec.floor}; "
                     f"numbered migrations start at {spec.floor + 1}" + (":" if steps else " (none yet)."))
    else:
        lines.append("- **Migrations:**")
    lines += [f"  - Version {m.version}: {m.summary}" for m in steps]
    lines.append("")
    for table in describe(kind):
        note = TABLES[kind].get(table["name"], "")
        if "fts" in table:
            fts = table["fts"]
            lines += [f"### `{table['name']}` (FTS5)", "", note, ""]
            cols = ", ".join(f"`{c['name']}`" + ("" if c["indexed"] else " (stored, not searched)") for c in fts["columns"])
            lines.append(f"- **Columns:** {cols}")
            for key, value in sorted(fts["options"].items()):
                lines.append(f"- **{key}:** `{value}`")
            lines.append("")
            continue
        lines += [f"### `{table['name']}`", "", note, "", "| Column | Type | Rules | Notes |", "| -- | -- | -- | -- |"]
        for c in table["columns"]:
            lines.append(f"| `{c['name']}` | {c['type']} | {_cell(', '.join(c['rules']))} | {_cell(c['note'])} |")
        lines.append("")
        for i in table["indexes"]:
            lines.append(f"- **Index** `{i['name']}`{' (unique)' if i['unique'] else ''}: {', '.join(i['columns'])}")
        if table["indexes"]:
            lines.append("")
    keys = META_KEYS.get(kind)
    if keys:
        lines += ["### Meta keys (`meta`)", "", "| Key | Meaning |", "| -- | -- |"]
        lines += [f"| `{k}` | {_cell(v)} |" for k, v in keys.items()]
        lines.append("")
    return lines


def render() -> str:
    migrate.check_registry()
    lines = [
        "# FRAMEWORK data dictionary",
        "",
        "<!-- Generated by `python -m app.schema_doc` from the schema definitions in code. Do not edit it:",
        "     change the schema (with its migration in app/migrate.py), then run the command.",
        "     tests/test_schema_doc.py fails while this file is out of date. -->",
        "",
        "Every store is a SQLite file in `reader/data/`, which is gitignored: a fresh clone has none, and each is "
        "created by the build named below. The schema version is the store's `PRAGMA user_version`; "
        "`python -m app.migrate --status` reports it for the stores on disk, and `app/migrate.py` holds the "
        "numbered migrations that bring an older store forward.",
        "",
        "| Store | File | Schema version | Tables |",
        "| -- | -- | -- | -- |",
    ]
    for kind, spec in migrate.KINDS.items():
        names = ", ".join(f"`{t['name']}`" for t in describe(kind))
        lines.append(f"| [{spec.label}](#{_anchor(spec.label, spec.file)}) | `{spec.file}` | {migrate.latest(kind)} | {names} |")
    lines += [
        "",
        "Reading the tables below: **required** is `NOT NULL`; a column with no rule may be empty. Full-text "
        "(FTS5) tables are search indexes over another table, listed with the columns they index. Notes on "
        "columns are the comments written in the schema source.",
        "",
    ]
    for kind in migrate.KINDS:
        lines += _store_section(kind)
    return "\n".join(lines).rstrip("\n") + "\n"


def _anchor(label: str, file: str) -> str:
    """The id GitHub gives the heading `## {label}: `{file}``."""
    text = f"{label}: {file}".lower()
    return re.sub(r"\s", "-", re.sub(r"[^\w\s-]", "", text))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Generate reader/DATA_DICTIONARY.md from the schema definitions in code.")
    parser.add_argument("--check", action="store_true", help="exit 1 if the committed file is out of date; write nothing")
    parser.add_argument("--stdout", action="store_true", help="print the document instead of writing it")
    args = parser.parse_args(argv)
    text = render()
    if args.stdout:
        sys.stdout.write(text)
        return
    current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else None
    if args.check:
        if current != text:
            print(f"{OUTPUT.name} is out of date: run python -m app.schema_doc", file=sys.stderr)
            sys.exit(1)
        print(f"{OUTPUT.name} is up to date")
        return
    if current == text:
        print(f"{OUTPUT.name} is already up to date")
        return
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
