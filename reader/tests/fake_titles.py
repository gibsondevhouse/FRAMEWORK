"""Three tiny fake CFR titles (29, 40, 49) built into a temporary data directory with the eCFR
network mocked, so the federation and API tests run on any machine without downloads.

The real title numbers are used because `config.DEFAULT_TITLE` is 29 (the legacy unprefixed
routes alias it) and because the sections mirror the real cross-title citation trio:
29 CFR 1910.120 (HAZWOPER) cites 40 CFR 261.3 (hazardous waste) and 49 CFR 172.101 (hazmat table).

Title 29 also carries a long section (1910.1200) with lettered clauses, an `(i)` clause after
`(h)`, and an embedded appendix long enough to split into chapters, so the units endpoint is
exercised; 1910.135 is short enough to read as one page.
"""
from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from unittest import mock

from app import build, config, library, store

EDITION = "2026-01-02"
TITLES = {29: "Labor", 40: "Protection of Environment", 49: "Transportation"}


def _section(n: str, heading: str, body: str, title: int | None = None) -> str:
    # Real eCFR XML carries the section's path in `hierarchy_metadata` (HTML-escaped JSON);
    # pass `title` to include it, otherwise the reader falls back to the part's URL.
    meta = (f' hierarchy_metadata="{{&quot;path&quot;:&quot;/on/_SUBSTITUTE_DATE_/title-{title}/section-{n}&quot;}}"'
            if title else "")
    return f'<DIV8 N="{n}" TYPE="SECTION"{meta}><HEAD>§ {n} {heading}</HEAD>{body}</DIV8>'


def _filler(words: int, seed: str) -> str:
    return " ".join(f"{seed}{i}" for i in range(words)) + "."


def _long_section_1910_1200() -> str:
    clauses = []
    for letter, title in zip("abcdefgh", ["Purpose", "Scope and application", "Definitions", "Written hazard communication program",
                                          "Labels and other forms of warning", "Safety data sheets", "Employee information and training",
                                          "Training"]):
        clauses.append(f"<P>({letter}) <I>{title}.</I> {_filler(40, letter)}</P>")
        clauses.append(f"<P>(1) {_filler(30, letter + 'x')}</P><P>(2) {_filler(30, letter + 'y')}</P>")
    # (i) after (h), resolved as a letter by the (1) that follows it and the (j) after.
    clauses.append("<P>(i) <I>Trade secrets.</I> (1) The chemical manufacturer may withhold the specific chemical identity.</P>"
                   "<P>(2) Where a treating physician determines a medical emergency exists.</P>")
    clauses.append("<P>(j) <I>Effective dates.</I> Chemical manufacturers shall label containers.</P>")
    # Embedded appendix, over APPENDIX_SPLIT_MIN_CHARS, with HD1 chapters and a figure in A.1.
    chapters = ""
    for i, name in enumerate(["Acute Toxicity", "Skin Corrosion", "Eye Damage", "Respiratory Sensitization"], start=1):
        fig = '<img src="/graphics/er08ja26.000.gif"/>' if i == 1 else ""
        chapters += f"<HD1>A.{i} {name}</HD1>{fig}<P>{_filler(700, f'a{i}')}</P>"
    appendix = ("<EXTRACT><HD1>Appendix A to § 1910.1200—Health Hazard Criteria (Mandatory)</HD1>"
                "<P>A.0 General classification considerations.</P>" + chapters + "</EXTRACT>")
    return _section("1910.1200", "Hazard communication.", "".join(clauses) + appendix)


XML = {
    29: '<DIV1 N="29" TYPE="TITLE"><DIV5 N="1910" TYPE="PART"><HEAD>PART 1910—OCCUPATIONAL SAFETY AND HEALTH STANDARDS</HEAD>'
        '<AUTH><HED>Authority:</HED><P>29 U.S.C. 653, 655, and 657.</P></AUTH>'
        '<DIV6 N="Subpart H" TYPE="SUBPART"><HEAD>Subpart H—Hazardous Materials</HEAD>'
        + _section("1910.120", "Hazardous waste operations and emergency response.",
                   "<P>(a) <I>Scope.</I> This section covers hazardous waste operations. Waste defined under 40 CFR 261.3 "
                   "and materials listed in 49 CFR 172.101 are covered. See also § 1910.134 and § 1910.1200.</P>")
        + '</DIV6><DIV6 N="Subpart I" TYPE="SUBPART"><HEAD>Subpart I—Personal Protective Equipment</HEAD>'
        + _section("1910.134", "Respiratory protection.", "<P>(a) <I>Permissible practice.</I> Respirators shall be provided.</P>")
        + _section("1910.135", "Head protection.", "<P>(a) <I>General requirements.</I> The employer shall ensure that each "
                   "affected employee wears a protective helmet.</P><P>(b) <I>Criteria.</I> Helmets shall comply with ANSI Z89.1.</P>")
        + '</DIV6><DIV6 N="Subpart Z" TYPE="SUBPART"><HEAD>Subpart Z—Toxic and Hazardous Substances</HEAD>'
        + _long_section_1910_1200()
        + '</DIV6></DIV5></DIV1>',
    40: '<DIV1 N="40" TYPE="TITLE"><DIV5 N="261" TYPE="PART"><HEAD>PART 261—IDENTIFICATION AND LISTING OF HAZARDOUS WASTE</HEAD>'
        + _section("261.2", "Definition of solid waste.", "<P>(a) A solid waste is any discarded material.</P>")
        + _section("261.3", "Definition of hazardous waste.", "<P>(a) A solid waste is a hazardous waste if it is listed in "
                   "subpart D or exhibits a characteristic. Generators follow 40 CFR part 262.</P>", title=40)
        + '</DIV5></DIV1>',
    49: '<DIV1 N="49" TYPE="TITLE"><DIV5 N="172" TYPE="PART"><HEAD>PART 172—HAZARDOUS MATERIALS TABLE</HEAD>'
        + _section("172.101", "Purpose and use of hazardous materials table.", "<P>(a) The Hazardous Materials Table "
                   "designates the materials listed as hazardous materials for transportation.</P>")
        + _section("172.102", "Special provisions.", "<P>(a) Special provisions apply to shipments.</P>")
        + '</DIV5></DIV1>',
}


def _sec(n: str, desc: str) -> dict:
    return {"type": "section", "identifier": n, "label": f"§ {n}", "label_description": desc}


STRUCTURE = {
    29: {"type": "title", "identifier": "29", "label": "Title 29", "label_description": "Labor", "children": [
        {"type": "subtitle", "identifier": "B", "label": "Subtitle B", "label_description": "Regulations Relating to Labor", "children": [
            {"type": "chapter", "identifier": "XVII", "label": "Chapter XVII",
             "label_description": "Occupational Safety and Health Administration, Department of Labor", "children": [
                {"type": "part", "identifier": "1910", "label": "Part 1910",
                 "label_description": "Occupational Safety and Health Standards", "children": [
                    {"type": "subpart", "identifier": "H", "label": "Subpart H", "label_description": "Hazardous Materials",
                     "children": [_sec("1910.120", "Hazardous waste operations and emergency response.")]},
                    {"type": "subpart", "identifier": "I", "label": "Subpart I", "label_description": "Personal Protective Equipment",
                     "children": [_sec("1910.134", "Respiratory protection."), _sec("1910.135", "Head protection.")]},
                    {"type": "subpart", "identifier": "Z", "label": "Subpart Z", "label_description": "Toxic and Hazardous Substances",
                     "children": [_sec("1910.1200", "Hazard communication.")]},
                ]},
            ]},
        ]},
    ]},
    40: {"type": "title", "identifier": "40", "label": "Title 40", "label_description": "Protection of Environment", "children": [
        {"type": "chapter", "identifier": "I", "label": "Chapter I", "label_description": "Environmental Protection Agency", "children": [
            {"type": "part", "identifier": "261", "label": "Part 261",
             "label_description": "Identification and Listing of Hazardous Waste",
             "children": [_sec("261.2", "Definition of solid waste."), _sec("261.3", "Definition of hazardous waste.")]},
        ]},
    ]},
    49: {"type": "title", "identifier": "49", "label": "Title 49", "label_description": "Transportation", "children": [
        {"type": "chapter", "identifier": "I", "label": "Chapter I",
         "label_description": "Pipeline and Hazardous Materials Safety Administration", "children": [
            {"type": "part", "identifier": "172", "label": "Part 172", "label_description": "Hazardous Materials Table",
             "children": [_sec("172.101", "Purpose and use of hazardous materials table."), _sec("172.102", "Special provisions.")]},
        ]},
    ]},
}

_TITLE_IN_URL = re.compile(r"title-(\d+)\.(?:json|xml)")


def fake_fetch_json(_client, url: str) -> dict:
    if url.endswith("/titles.json"):
        return {"titles": [{"number": n, "name": name, "up_to_date_as_of": EDITION, "reserved": False}
                           for n, name in TITLES.items()]}
    m = _TITLE_IN_URL.search(url)
    if "/structure/" in url and m:
        return STRUCTURE[int(m.group(1))]
    raise AssertionError(f"unexpected eCFR request: {url}")


def fake_download(_client, url: str, dest: Path, on_bytes=None) -> None:
    m = _TITLE_IN_URL.search(url)
    if not m or "?" in url:
        raise AssertionError(f"unexpected eCFR download: {url}")
    dest.write_text(XML[int(m.group(1))], encoding="utf-8")
    if on_bytes:
        on_bytes(10, 10)


class FakeTitles:
    """Build the fake titles into a fresh temp DATA_DIR. Use `install()` in setUpClass and
    `remove()` in tearDownClass."""

    def __init__(self, titles=(29, 40, 49)):
        self.titles = tuple(titles)
        self.tmp: Path | None = None
        self.patches: list = []

    def install(self) -> Path:
        self.tmp = Path(tempfile.mkdtemp(prefix="cfr-fake-"))
        self.patches = [
            mock.patch.object(config, "DATA_DIR", self.tmp),
            mock.patch.object(build, "fetch_json", fake_fetch_json),
            mock.patch.object(build, "download_stream", fake_download),
            mock.patch.object(build, "log", lambda msg: None),
            mock.patch.object(library, "ecfr_titles", lambda refresh=False: fake_fetch_json(None, "/titles.json")["titles"]),
        ]
        for p in self.patches:
            p.start()
        library._structures.clear()
        store.reset_connections()
        for t in self.titles:
            build.build(t, force=True)
        return self.tmp

    def remove(self) -> None:
        store.reset_connections()
        for p in self.patches:
            p.stop()
        library._structures.clear()
        if self.tmp:
            shutil.rmtree(self.tmp, ignore_errors=True)
