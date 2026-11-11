"""Claude-powered chat grounded in the federated CFR databases."""
from __future__ import annotations

import json
import time
from typing import AsyncIterator

import anthropic

from . import config, store

MAX_TOOL_ROUNDS = 10
MAX_CONTEXT_CHARS = 120_000   # roughly 30k tokens of the open section
READ_CHUNK_CHARS = 40_000

SYSTEM_PROMPT = """You are the research companion inside a federated Code of Federal Regulations (CFR) reader.
Installed CFR titles: {installed}. The active title is Title {title} (current as of {edition}).

How to answer:
- Ground substantive claims in the regulation text and cite sections with their title, e.g., 29 CFR § 1910.120, 40 CFR § 261.3, or 49 CFR § 172.101. The reader turns those citations into clickable links.
- Use your tools to search and read sections rather than relying on memory. If an answer depends on a section you have not read in this conversation, read it first.
- Specify the title in tool calls (e.g. title=29 for OSHA/FLSA, title=40 for EPA, title=49 for DOT, or title='all' for broad search).
- Write in plain English for a smart non-lawyer. Lead with the direct answer, then supporting details. Prefer short paragraphs, bullet lists, and tables. Quote the regulation sparingly and only when exact wording matters.
- Be clear about scope. Statutes (U.S.C.), state/local laws, agency guidance, and court decisions are outside this regulatory database. Say so when they matter.
- If the text is ambiguous or depends on facts you don't have, say what it depends on instead of guessing. You aren't a lawyer. When a decision has real consequences, mention that it's worth confirming with agency counsel."""

TOOLS = [
    {
        "name": "search_regulations",
        "description": (
            "Full-text search across one or all installed CFR titles. Returns section numbers, "
            "titles, and short matching excerpts."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords or a quoted exact phrase."},
                "title": {"type": "string", "description": "CFR Title number (e.g. '29', '40', '49') or 'all'. Defaults to active title."},
                "part": {"type": "string", "description": "Optional part number to restrict to, e.g. '1910'."},
                "limit": {"type": "integer", "description": "Max results (default 10, max 25)."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_section",
        "description": (
            "Read the full text of one section or appendix from an installed CFR title. "
            "Long sections come back in chunks; call again with the offset given to continue."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "section_id": {"type": "string", "description": "Section number, e.g. '1910.120' or '261.3'."},
                "title": {"type": "integer", "description": "CFR Title number (e.g. 29, 40, 49). Defaults to active title."},
                "offset": {"type": "integer", "description": "Character offset for continuing long sections."},
            },
            "required": ["section_id"],
        },
    },
    {
        "name": "list_part",
        "description": "List the table of contents (all sections, grouped by subpart) of one part in a CFR title.",
        "input_schema": {
            "type": "object",
            "properties": {
                "part": {"type": "string", "description": "Part number, e.g. '1910' or '261'."},
                "title": {"type": "integer", "description": "CFR Title number (e.g. 29, 40, 49). Defaults to active title."},
            },
            "required": ["part"],
        },
    },
]


# ---------------------------------------------------------------------------
# Client and models
# ---------------------------------------------------------------------------

_models_cache: tuple[float, list[dict]] | None = None


def client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=config.anthropic_key())


async def list_models() -> list[dict]:
    """Models available to this API key, newest first (cached for 10 minutes)."""
    global _models_cache
    if _models_cache and time.time() - _models_cache[0] < 600:
        return _models_cache[1]
    models = []
    async for m in client().models.list(limit=100):
        models.append({"id": m.id, "name": getattr(m, "display_name", None) or m.id})
    _models_cache = (time.time(), models)
    return models


def pick_default_model(models: list[dict]) -> str | None:
    preferred = config.preferred_model()
    ids = [m["id"] for m in models]
    if preferred and (preferred in ids or not ids):
        return preferred
    for family in ("sonnet", "opus", "haiku"):
        for mid in ids:
            if family in mid:
                return mid
    return ids[0] if ids else None


def friendly_error(exc: Exception) -> str:
    if isinstance(exc, anthropic.AuthenticationError):
        return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in reader/.env and restart the app."
    if isinstance(exc, anthropic.PermissionDeniedError):
        return "Anthropic says this API key cannot use the requested model."
    if isinstance(exc, anthropic.RateLimitError):
        return "Hit the Anthropic rate limit. Wait a few seconds and try again."
    if isinstance(exc, anthropic.BadRequestError):
        msg = _api_message(exc)
        if "credit balance is too low" in msg.lower():
            return "Anthropic account has no credits left. Add credits at console.anthropic.com/settings/plans."
        return f"Anthropic request error: {msg}"
    if isinstance(exc, anthropic.APIConnectionError):
        return "Couldn't reach the Anthropic API. Check your internet connection."
    if isinstance(exc, anthropic.APIStatusError):
        return f"Anthropic API error ({exc.status_code}): {_api_message(exc)}"
    return f"Unexpected error: {exc}"


def _api_message(exc: anthropic.APIStatusError) -> str:
    try:
        return exc.body["error"]["message"]  # type: ignore[index]
    except (TypeError, KeyError):
        return str(exc)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

def run_tool(name: str, args: dict, default_title: int = config.DEFAULT_TITLE) -> tuple[str, str]:
    """Returns (result text for Claude, short human-readable summary for the UI)."""
    if name == "search_regulations":
        query = str(args.get("query", "")).strip()
        limit = max(1, min(int(args.get("limit") or 10), 25))
        t_arg = args.get("title")
        target_title: int | str
        if t_arg is None:
            target_title = default_title
        elif str(t_arg).lower() == "all":
            target_title = "all"
        else:
            try:
                target_title = int(t_arg)
            except (ValueError, TypeError):
                target_title = default_title

        found = store.search(
            query,
            part=(str(args["part"]) if args.get("part") else None),
            limit=limit,
            title=target_title,
        )
        if not found["results"]:
            scope = f"in Title {target_title}" if target_title != "all" else "across installed titles"
            return f"No sections matched {query!r} {scope}. Try different or fewer keywords.", f"No results for “{query}”"
        lines = [f"{found['total']} matching sections; top {len(found['results'])}:"]
        for r in found["results"]:
            snippet = (r.get("snippet") or "").replace("\x02", "**").replace("\x03", "**")
            t_num = r.get("title", target_title)
            lines.append(f"- Title {t_num} {r['label']} {r['title']} (part {r['part']})" + (f"\n  …{snippet}…" if snippet else ""))
        scope_lbl = f"Title {target_title}" if target_title != "all" else "all titles"
        return "\n".join(lines), f"Searched {scope_lbl} for “{query}” · {found['total']} matches"

    if name == "read_section":
        t_num = int(args.get("title") or default_title)
        sec = store.section_text(str(args.get("section_id", "")), title=t_num)
        if not sec:
            return f"No section {args.get('section_id')!r} exists in Title {t_num}.", f"Couldn't find {args.get('section_id')}"
        offset = max(0, int(args.get("offset") or 0))
        text = sec["text"]
        chunk = text[offset:offset + READ_CHUNK_CHARS]
        header = f"Title {t_num} {sec['label']} {sec['title']} (part {sec['part']})"
        if offset or len(text) > READ_CHUNK_CHARS:
            end = offset + len(chunk)
            header += f"\n[characters {offset}-{end} of {len(text)}"
            header += f"; call read_section again with offset={end} to continue]" if end < len(text) else "; end]"
        return f"{header}\n\n{chunk}", f"Read Title {t_num} {sec['label']}"

    if name == "list_part":
        t_num = int(args.get("title") or default_title)
        part = str(args.get("part", "")).strip()
        rows = store.part_sections(part, title=t_num)
        if not rows:
            return f"Part {part!r} has no sections in Title {t_num}.", f"Part {part} not found in Title {t_num}"
        lines, last_group = [f"Title {t_num} Part {part} contents:"], None
        for r in rows:
            path = json.loads(r["path"])
            group = next((f"{p['l']} {p['d']}" for p in reversed(path) if p["t"] in ("subpart", "subject_group")), None)
            if group and group != last_group:
                lines.append(f"\n{group}")
                last_group = group
            lines.append(f"  {r['label']} {r['title']}" + (" [Reserved]" if r["reserved"] and "Reserved" not in r["title"] else ""))
        return "\n".join(lines), f"Listed Title {t_num} part {part}"

    return f"Unknown tool {name}", name


# ---------------------------------------------------------------------------
# Streaming chat
# ---------------------------------------------------------------------------

def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def build_system(section_id: str | None, title: int = config.DEFAULT_TITLE) -> list[dict]:
    ed = store.edition(title)
    installed_str = ", ".join(f"Title {t}" for t in config.installed_titles()) or f"Title {title}"
    prompt = SYSTEM_PROMPT.format(edition=ed or "current", installed=installed_str, title=title)
    blocks = [{"type": "text", "text": prompt}]
    if section_id:
        sec = store.section_text(section_id, title=title)
        if sec:
            text = sec["text"][:MAX_CONTEXT_CHARS]
            note = ""
            if len(sec["text"]) > MAX_CONTEXT_CHARS:
                note = (f"\n[Truncated at {MAX_CONTEXT_CHARS} characters; use read_section with "
                        f"offset={MAX_CONTEXT_CHARS} for the rest.]")
            blocks.append({
                "type": "text",
                "text": (f"The user has this section open in Title {title} right now. Questions like \"this section\" "
                         f"or \"this\" refer to it.\n\n<open_section id=\"{sec['id']}\" title=\"{title}\">\n{sec['label']} {sec['title']} "
                         f"(Title {title} part {sec['part']})\n\n{text}{note}\n</open_section>"),
                "cache_control": {"type": "ephemeral"},
            })
    return blocks


async def stream_chat(
    messages: list[dict],
    section_id: str | None,
    model: str,
    title: int = config.DEFAULT_TITLE,
) -> AsyncIterator[str]:
    convo = [{"role": m["role"], "content": m["content"]} for m in messages if m.get("content")]
    system = build_system(section_id, title=title)
    api = client()
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            async with api.messages.stream(
                model=model, max_tokens=8000, system=system, messages=convo, tools=TOOLS,
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield sse({"type": "text", "text": event.delta.text})
                final = await stream.get_final_message()

            if final.stop_reason != "tool_use":
                if final.stop_reason == "max_tokens":
                    yield sse({"type": "text", "text": "\n\n*(Reply cut off at length limit. Ask me to continue.)*"})
                yield sse({"type": "done", "usage": final.usage.model_dump()})
                return

            convo.append({"role": "assistant", "content": final.content})
            results = []
            for block in final.content:
                if block.type != "tool_use":
                    continue
                yield sse({"type": "tool", "name": block.name, "input": block.input})
                try:
                    output, summary = run_tool(block.name, dict(block.input), default_title=title)
                except Exception as exc:
                    output, summary = f"Tool error: {exc}", f"{block.name} failed"
                yield sse({"type": "tool_result", "name": block.name, "summary": summary})
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
            convo.append({"role": "user", "content": results})
            yield sse({"type": "text", "text": "\n\n"})

        yield sse({"type": "error", "message": "Stopped after too many research steps. Try a narrower question."})
    except Exception as exc:
        yield sse({"type": "error", "message": friendly_error(exc)})


