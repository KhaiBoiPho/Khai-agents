"""Markdown <-> ProseMirror JSON (the KhaiDocs editor schema).

Dialect (matches what the editor's own Markdown import/export uses, see
desktop editor-ext/lib/markdown): CommonMark + GFM tables, strikethrough and
task lists (``- [x] item``), ``:::info`` .. ``:::`` callouts (info, success,
warning, danger), ``$$`` .. ``$$`` math blocks and ``$x$`` inline math,
``<details><summary>`` blocks, ``<u>`` ``<sub>`` ``<sup>`` ``<mark>`` marks.
Raw HTML blocks go through :mod:`core.khaidocs.html_pm`.

``md_to_pm`` never raises on odd input; every Markdown string is a document.
Images keep their ``src`` as written; importers rewrite them to attachments.
"""

from __future__ import annotations

import re
from typing import Any

from markdown_it import MarkdownIt

from core.khaidocs.html_pm import CALLOUTS, html_to_pm, safe_href, trim_inline
from core.khaidocs.text import nfc

_MD = MarkdownIt("commonmark", {"html": True, "linkify": False}).enable(["table", "strikethrough"])
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_CALLOUT_OPEN = re.compile(r"^:::\s*([A-Za-z0-9_-]+)\s*$")
_INLINE_MATH = re.compile(r"(?<![\\$])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?!\d)")
_TASK = re.compile(r"^\[([ xX])\][ \t]+")
MAX_INPUT = 20 * 1024 * 1024
MAX_NESTING = 24


def md_to_pm(markdown: str) -> dict:
    """ProseMirror document JSON for a Markdown string."""

    text = (markdown or "")[:MAX_INPUT].replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    blocks = _parse(text, 0)
    return {"type": "doc", "content": blocks or [{"type": "paragraph"}]}


# --------------------------------------------------------------- segmentation


def _parse(text: str, depth: int) -> list[dict]:
    out: list[dict] = []
    chunk: list[str] = []
    lines = text.split("\n")
    i, fence = 0, None

    def flush() -> None:
        if chunk:
            out.extend(_markdown_blocks("\n".join(chunk)))
            chunk.clear()

    while i < len(lines):
        line = lines[i]
        match = _FENCE.match(line)
        if fence:
            chunk.append(line)
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence) \
                    and not line.strip()[len(match.group(1)):].strip():
                fence = None
            i += 1
            continue
        if match:
            fence = match.group(1)
            chunk.append(line)
            i += 1
            continue
        stripped = line.strip()
        callout = _CALLOUT_OPEN.match(stripped) if depth < MAX_NESTING else None
        if callout:
            end, inner = _until_callout(lines, i + 1)
            if end is not None:
                flush()
                kind = callout.group(1).lower()
                body = _parse("\n".join(inner), depth + 1) or [{"type": "paragraph"}]
                out.append({"type": "callout", "attrs": {"type": kind if kind in CALLOUTS else "info"},
                            "content": body})
                i = end + 1
                continue
        if stripped.startswith("$$") and not line.startswith("    "):
            end = _math_end(lines, i)
            if end is not None:
                flush()
                body = "\n".join(lines[i : end + 1]).strip()[2:-2].strip()
                if body:
                    out.append({"type": "mathBlock", "attrs": {"text": body}})
                i = end + 1
                continue
        if stripped.lower().startswith("<details") and depth < MAX_NESTING:
            end = _details_end(lines, i)
            if end is not None:
                flush()
                out.append(_details("\n".join(lines[i : end + 1]), depth))
                i = end + 1
                continue
        chunk.append(line)
        i += 1
    flush()
    return out


def _until_callout(lines: list[str], start: int) -> tuple[int | None, list[str]]:
    nesting, fence = 1, None
    for j in range(start, len(lines)):
        stripped = lines[j].strip()
        match = _FENCE.match(lines[j])
        if fence:
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence):
                fence = None
            continue
        if match:
            fence = match.group(1)
            continue
        if stripped == ":::":
            nesting -= 1
            if nesting == 0:
                return j, lines[start:j]
        elif _CALLOUT_OPEN.match(stripped):
            nesting += 1
    return None, []


def _math_end(lines: list[str], start: int) -> int | None:
    first = lines[start].strip()
    if len(first) >= 4 and first.endswith("$$"):
        return start
    for j in range(start + 1, min(len(lines), start + 2000)):
        if lines[j].strip().endswith("$$"):
            return j
    return None


def _details_end(lines: list[str], start: int) -> int | None:
    nesting = 0
    for j in range(start, len(lines)):
        low = lines[j].lower()
        nesting += len(re.findall(r"<details[\s>]", low)) - low.count("</details>")
        if nesting <= 0:
            return j
    return None


def _details(block: str, depth: int) -> dict:
    match = re.match(r"\s*<details([^>]*)>(.*)</details>\s*$", block, re.S | re.I)
    attrs, body = (match.group(1), match.group(2)) if match else ("", block)
    summary = ""
    found = re.search(r"<summary[^>]*>(.*?)</summary>", body, re.S | re.I)
    if found:
        summary = re.sub(r"<[^>]+>", "", found.group(1)).strip()
        body = body[: found.start()] + body[found.end():]
    head: dict = {"type": "detailsSummary"}
    if summary:
        head["content"] = [{"type": "text", "text": nfc(summary)}]
    content = _parse(body.strip("\n"), depth + 1) or [{"type": "paragraph"}]
    return {"type": "details", "attrs": {"open": bool(re.search(r"\bopen\b", attrs, re.I))},
            "content": [head, {"type": "detailsContent", "content": content}]}


# ------------------------------------------------------------- markdown-it walk


def _markdown_blocks(source: str) -> list[dict]:
    if not source.strip():
        return []
    try:
        tokens = _MD.parse(source)
    except RecursionError:
        return [{"type": "paragraph", "content": [{"type": "text", "text": nfc(source[:5000])}]}]
    return _blocks(tokens, 0, len(tokens))


def _close_index(tokens: list, start: int) -> int:
    level = tokens[start].level
    for j in range(start + 1, len(tokens)):
        if tokens[j].level == level and tokens[j].type.endswith("_close"):
            return j
    return len(tokens) - 1


def _blocks(tokens: list, start: int, end: int) -> list[dict]:
    out: list[dict] = []
    i = start
    while i < end:
        token = tokens[i]
        kind = token.type
        if kind == "heading_open":
            inline = _inline(tokens[i + 1].children or [])
            node: dict = {"type": "heading", "attrs": {"level": int(token.tag[1])}}
            text = [n for n in inline if n["type"] != "image"]
            if text := trim_inline(text):
                node["content"] = text
            out.append(node)
            out += [n for n in inline if n["type"] == "image"]
            i = _close_index(tokens, i) + 1
        elif kind == "paragraph_open":
            out += _paragraphs(_inline(tokens[i + 1].children or []))
            i = _close_index(tokens, i) + 1
        elif kind in ("bullet_list_open", "ordered_list_open"):
            close = _close_index(tokens, i)
            out.append(_list(tokens, i, close))
            i = close + 1
        elif kind == "blockquote_open":
            close = _close_index(tokens, i)
            out.append({"type": "blockquote", "content": _blocks(tokens, i + 1, close) or [{"type": "paragraph"}]})
            i = close + 1
        elif kind in ("fence", "code_block"):
            info = (token.info or "").strip().split(" ")[0] if kind == "fence" else ""
            code = token.content.rstrip("\n")
            node = {"type": "codeBlock", "attrs": {"language": info or None}}
            if code:
                node["content"] = [{"type": "text", "text": nfc(code)}]
            out.append(node)
            i += 1
        elif kind == "hr":
            out.append({"type": "horizontalRule"})
            i += 1
        elif kind == "table_open":
            close = _close_index(tokens, i)
            table = _table(tokens, i, close)
            if table:
                out.append(table)
            i = close + 1
        elif kind == "html_block":
            out += html_to_pm(token.content)["content"] if token.content.strip() else []
            i += 1
        else:
            i += 1
    return [n for n in out if not (n["type"] == "paragraph" and not n.get("content"))] or out


def _paragraphs(inline: list[dict]) -> list[dict]:
    """A paragraph, with images lifted out as sibling blocks."""

    out: list[dict] = []
    run: list[dict] = []

    def flush() -> None:
        if run and (content := trim_inline(list(run))):
            out.append({"type": "paragraph", "content": content})
        run.clear()

    for node in inline:
        if node["type"] == "image":
            flush()
            out.append(node)
        else:
            run.append(node)
    flush()
    return out


def _list(tokens: list, start: int, close: int) -> dict:
    ordered = tokens[start].type == "ordered_list_open"
    items: list[dict] = []
    tasks: list[bool | None] = []
    i = start + 1
    while i < close:
        if tokens[i].type == "list_item_open":
            item_close = _close_index(tokens, i)
            content = _blocks(tokens, i + 1, item_close)
            checked = None
            if content and content[0]["type"] == "paragraph":
                first = (content[0].get("content") or [{}])[0]
                match = _TASK.match(first.get("text", "")) if first.get("type") == "text" else None
                if match:
                    checked = match.group(1) in "xX"
                    rest = first["text"][match.end():]
                    inline = ([{**first, "text": rest}] if rest else []) + content[0]["content"][1:]
                    content[0] = {"type": "paragraph", "content": inline} if inline else {"type": "paragraph"}
            if not content:
                content = [{"type": "paragraph"}]
            if content[0]["type"] != "paragraph":
                content.insert(0, {"type": "paragraph"})
            items.append({"content": content})
            tasks.append(checked)
            i = item_close + 1
        else:
            i += 1
    if not items:
        items = [{"content": [{"type": "paragraph"}]}]
        tasks = [None]
    if any(t is not None for t in tasks):
        return {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": bool(t)}, "content": it["content"]}
            for it, t in zip(items, tasks, strict=True)
        ]}
    body = [{"type": "listItem", "content": it["content"]} for it in items]
    if ordered:
        start_attr = tokens[start].attrGet("start")
        return {"type": "orderedList", "attrs": {"start": int(start_attr) if start_attr else 1}, "content": body}
    return {"type": "bulletList", "content": body}


def _table(tokens: list, start: int, close: int) -> dict | None:
    rows: list[dict] = []
    i = start + 1
    while i < close:
        if tokens[i].type == "tr_open":
            row_close = _close_index(tokens, i)
            cells = []
            j = i + 1
            while j < row_close:
                if tokens[j].type in ("th_open", "td_open"):
                    cell_type = "tableHeader" if tokens[j].type == "th_open" else "tableCell"
                    inline = _inline(tokens[j + 1].children or []) if tokens[j + 1].type == "inline" else []
                    para = trim_inline([n for n in inline if n["type"] != "image"])
                    paragraph: dict = {"type": "paragraph"}
                    if para:
                        paragraph["content"] = para
                    body = [paragraph] + [n for n in inline if n["type"] == "image"]
                    cells.append({"type": cell_type, "content": body})
                    j = _close_index(tokens, j) + 1
                else:
                    j += 1
            if cells:
                rows.append({"type": "tableRow", "content": cells})
            i = row_close + 1
        else:
            i += 1
    return {"type": "table", "content": rows} if rows else None


# ------------------------------------------------------------------- inline


_HTML_TAG_MARK = {"u": "underline", "sub": "subscript", "sup": "superscript", "mark": "highlight",
                  "ins": "underline", "kbd": "code"}


def _text_nodes(value: str, marks: list[dict]) -> list[dict]:
    value = nfc(value)
    out: list[dict] = []
    allow_math = not any(m["type"] == "code" for m in marks)
    pos = 0
    for match in (_INLINE_MATH.finditer(value) if allow_math else ()):
        if match.start() > pos:
            out.append(_t(value[pos : match.start()], marks))
        out.append({"type": "mathInline", "attrs": {"text": match.group(1)}})
        pos = match.end()
    if pos < len(value):
        out.append(_t(value[pos:], marks))
    return out


def _t(value: str, marks: list[dict]) -> dict:
    node: dict = {"type": "text", "text": value}
    if marks:
        if any(m["type"] == "code" for m in marks):
            marks = [m for m in marks if m["type"] in ("code", "link")]
        node["marks"] = [dict(m) for m in marks]
    return node


def _inline(children: list) -> list[dict]:
    out: list[dict] = []
    marks: list[dict] = []
    html_open: list[str] = []

    def push(kind: str, **attrs: Any) -> None:
        marks.append({"type": kind, "attrs": attrs} if attrs else {"type": kind})

    def pop(kind: str) -> None:
        for idx in range(len(marks) - 1, -1, -1):
            if marks[idx]["type"] == kind:
                del marks[idx]
                return

    for token in children:
        kind = token.type
        if kind == "text":
            out += _text_nodes(token.content, marks)
        elif kind == "code_inline":
            out.append(_t(nfc(token.content), [*marks, {"type": "code"}]))
        elif kind in ("softbreak",):
            out.append(_t(" ", marks))
        elif kind == "hardbreak":
            out.append({"type": "hardBreak"})
        elif kind == "em_open":
            push("italic")
        elif kind == "em_close":
            pop("italic")
        elif kind == "strong_open":
            push("bold")
        elif kind == "strong_close":
            pop("bold")
        elif kind == "s_open":
            push("strike")
        elif kind == "s_close":
            pop("strike")
        elif kind == "link_open":
            href = safe_href(token.attrGet("href"))
            push("link", href=href, internal=False) if href else push("_skip")
        elif kind == "link_close":
            if any(m["type"] == "link" for m in marks):
                pop("link")
            else:
                pop("_skip")
        elif kind == "image":
            attrs: dict[str, Any] = {"src": token.attrGet("src") or ""}
            alt = token.content or "".join(c.content for c in (token.children or []) if c.type == "text")
            if alt:
                attrs["alt"] = nfc(alt)
            out.append({"type": "image", "attrs": attrs})
        elif kind == "html_inline":
            tag = re.match(r"</?\s*([a-zA-Z0-9]+)", token.content)
            name = tag.group(1).lower() if tag else ""
            if name == "br":
                out.append({"type": "hardBreak"})
            elif name in _HTML_TAG_MARK:
                if token.content.startswith("</"):
                    pop(_HTML_TAG_MARK[name])
                elif not token.content.rstrip().endswith("/>"):
                    push(_HTML_TAG_MARK[name])
                    html_open.append(name)
    return [n for n in out if n["type"] != "text" or n["text"] != ""]


# ====================================================================== PM -> MD

_ESCAPE = re.compile(r"([\\`*_\[\]<>|~])")
_BLOCK_START = re.compile(r"^(\s*)(#{1,6}\s|[-+*]\s|\d+[.)]\s|>|={2,}|-{3,}|:::|~~~)")


def _esc(value: str) -> str:
    return _ESCAPE.sub(r"\\\1", value)


def _wrap_marks(text: str, marks: list[dict]) -> str:
    kinds = {m["type"]: m for m in marks}
    lead = text[: len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()):]
    core = text.strip()
    if not core:
        return text
    if "code" in kinds:
        ticks = "`" * (max((len(r) for r in re.findall(r"`+", core)), default=0) + 1)
        pad = " " if core.startswith("`") or core.endswith("`") else ""
        core = f"{ticks}{pad}{core}{pad}{ticks}"
    else:
        core = _esc(core)
    if "bold" in kinds:
        core = f"**{core}**"
    if "italic" in kinds:
        core = f"*{core}*"
    if "strike" in kinds:
        core = f"~~{core}~~"
    for name, tag in (("underline", "u"), ("subscript", "sub"), ("superscript", "sup"), ("highlight", "mark")):
        if name in kinds:
            core = f"<{tag}>{core}</{tag}>"
    link = kinds.get("link")
    if link:
        href = safe_href((link.get("attrs") or {}).get("href"))
        if href:
            href = href.replace("(", "%28").replace(")", "%29").replace(" ", "%20")
            core = f"[{core}]({href})"
    return lead + core + trail


def _inline_md(nodes: list[dict] | None, url: Any) -> str:
    out: list[str] = []
    for node in nodes or []:
        kind = node.get("type")
        if kind == "text":
            out.append(_wrap_marks(node.get("text", ""), node.get("marks") or []))
        elif kind == "hardBreak":
            out.append("\\\n")
        elif kind == "mathInline":
            out.append(f"${(node.get('attrs') or {}).get('text', '')}$")
        elif kind == "mention":
            attrs = node.get("attrs") or {}
            label = attrs.get("label") or ""
            if attrs.get("entityType") == "page" and attrs.get("slugId"):
                out.append(f"[{_esc(label)}]({url('page', attrs)})")
            else:
                out.append(f"@{_esc(label)}")
        elif kind == "image":
            out.append(_image_md(node, url))
        else:
            out.append(_inline_md(node.get("content"), url))
    return "".join(out)


def _image_md(node: dict, url: Any) -> str:
    attrs = node.get("attrs") or {}
    src = str(url("image", attrs)).replace(" ", "%20").replace("(", "%28").replace(")", "%29")
    return f"![{_esc(attrs.get('alt') or '')}]({src})"


def _plain(nodes: list[dict] | None) -> str:
    return "".join(n.get("text", "") if n.get("type") == "text" else _plain(n.get("content")) for n in nodes or [])


def _indent(text: str, prefix: str, first: str | None = None) -> str:
    lines = text.split("\n")
    return "\n".join(
        ((first if idx == 0 and first is not None else prefix) + line) if line else (
            first.rstrip() if idx == 0 and first is not None else ""
        )
        for idx, line in enumerate(lines)
    )


def _blocks_md(nodes: list[dict] | None, url: Any) -> str:
    parts = [p for p in (_block_md(n, url) for n in nodes or []) if p is not None]
    return "\n\n".join(parts)


def _item_md(content: list[dict], url: Any) -> str:
    parts, last_list = [], False
    for child in content:
        rendered = _block_md(child, url)
        if rendered is None:
            continue
        is_list = child.get("type") in ("bulletList", "orderedList", "taskList")
        sep = "\n" if (parts and is_list and not last_list) else "\n\n"
        if parts:
            parts.append(sep)
        parts.append(rendered)
        last_list = is_list
    return "".join(parts)


def _list_md(node: dict, url: Any) -> str:
    kind = node["type"]
    attrs = node.get("attrs") or {}
    items = node.get("content") or []
    number = int(attrs.get("start") or 1)
    tight = all(
        sum(1 for c in (it.get("content") or []) if c.get("type") == "paragraph") <= 1 for it in items
    )
    rendered = []
    for item in items:
        if kind == "orderedList":
            marker = f"{number}. "
            number += 1
        elif kind == "taskList":
            marker = "- [x] " if (item.get("attrs") or {}).get("checked") else "- [ ] "
        else:
            marker = "- "
        body = _item_md(item.get("content") or [], url)
        width = 2 if kind != "orderedList" else len(marker)
        rendered.append(_indent(body, " " * width, marker) if body else marker.rstrip())
    return ("\n" if tight else "\n\n").join(rendered)


def _cell_md(cell: dict, url: Any) -> str:
    parts = []
    for child in cell.get("content") or []:
        if child.get("type") == "paragraph":
            parts.append(_inline_md(child.get("content"), url))
        else:
            parts.append((_block_md(child, url) or "").replace("\n", " "))
    return " <br> ".join(p for p in parts if p).replace("\n", " ").replace("|", "\\|").replace("\\\\|", "\\|")


def _table_md(node: dict, url: Any) -> str | None:
    rows = [[_cell_md(c, url) for c in (r.get("content") or [])] for r in node.get("content") or []]
    rows = [r for r in rows if r]
    if not rows:
        return None
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def _block_md(node: dict, url: Any) -> str | None:
    kind = node.get("type")
    content = node.get("content") or []
    attrs = node.get("attrs") or {}
    if kind == "paragraph":
        text = _inline_md(content, url).strip("\n")
        if not text:
            return None
        return _BLOCK_START.sub(lambda m: m.group(1) + "\\" + m.group(2), text, count=1) \
            if _BLOCK_START.match(text.split("\n")[0]) else text
    if kind == "heading":
        level = min(max(int(attrs.get("level") or 1), 1), 6)
        text = " ".join(_inline_md(content, url).split("\n")).strip()
        return f"{'#' * level} {text}".rstrip()
    if kind == "blockquote":
        inner = _blocks_md(content, url)
        return _indent(inner, "> ") if inner else ">"
    if kind in ("bulletList", "orderedList", "taskList"):
        return _list_md(node, url)
    if kind == "codeBlock":
        code = _plain(content)
        fence = "`" * max(3, max((len(r) for r in re.findall(r"`+", code)), default=0) + 1)
        language = attrs.get("language") or ""
        return f"{fence}{language}\n{code}\n{fence}"
    if kind in ("horizontalRule", "pageBreak"):
        return "---"
    if kind == "image":
        return _image_md(node, url)
    if kind == "table":
        return _table_md(node, url)
    if kind == "callout":
        ctype = attrs.get("type") if attrs.get("type") in CALLOUTS else "info"
        return f":::{ctype}\n{_blocks_md(content, url)}\n:::"
    if kind == "details":
        summary = next((c for c in content if c.get("type") == "detailsSummary"), None)
        body = next((c for c in content if c.get("type") == "detailsContent"), None)
        head = _esc(_plain((summary or {}).get("content")))
        open_attr = " open" if attrs.get("open") else ""
        inner = _blocks_md((body or {}).get("content"), url)
        return f"<details{open_attr}>\n<summary>{head}</summary>\n\n{inner}\n\n</details>"
    if kind == "mathBlock":
        return f"$$\n{attrs.get('text', '')}\n$$"
    if kind in ("attachment", "video", "audio", "pdf"):
        name = attrs.get("name") or attrs.get("src") or "file"
        return f"[{_esc(str(name))}]({url('file', attrs)})"
    if kind in ("embed", "drawio", "excalidraw"):
        src = safe_href(attrs.get("src") or attrs.get("url") or "")
        return f"<{src}>" if src and re.match(r"https?:", src) else None
    if kind in ("columns", "column", "transclusionSource", "footnotes", "footnote", "detailsContent"):
        return _blocks_md(content, url) or None
    if content:
        return _blocks_md(content, url) or None
    return None


def _default_url(kind: str, attrs: dict) -> str:
    if kind == "page":
        return f"/p/{attrs.get('slugId')}"
    return attrs.get("src") or attrs.get("url") or ""


def pm_to_md(doc: dict, *, url: Any = _default_url, title: str | None = None) -> str:
    """Markdown for a ProseMirror document. ``url(kind, attrs)`` maps images,
    files and page mentions to link targets (kind: image, file, page). With
    ``title`` the output starts with ``# title``."""

    body = _blocks_md((doc or {}).get("content"), url)
    head = f"# {_esc(title)}\n\n" if title else ""
    return nfc(f"{head}{body}\n" if body else head.rstrip("\n") + ("\n" if head else ""))
