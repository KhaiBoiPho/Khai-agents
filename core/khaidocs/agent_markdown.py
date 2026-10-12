"""Markdown <-> ProseMirror JSON for agent tools (read a page, write a page).

A deliberately small bridge: headings, paragraphs, bullet / ordered / task
lists, tables, code blocks, quotes, rules, images and the bold / italic /
strike / code / link marks. Node and mark names are the ones the KhaiDocs
editor (tiptap) uses. Anything else (callouts, mentions, embeds) is flattened
to its text on the way out, so nothing is lost for reading.

May later be unified with ``core.khaidocs.markdown_pm`` (phase 2's import /
export converter); this module has no dependency on it.
"""

from __future__ import annotations

import re
from typing import Any

from markdown_it import MarkdownIt

from core.khaidocs.text import fold, nfc, plain_text

MAX_MARKDOWN_CHARS = 200_000

_MD = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])
_TASK = re.compile(r"^\[([ xX])\]\s+")


# ------------------------------------------------------------------ Markdown -> PM


def markdown_to_pm(markdown: str) -> dict:
    """A ProseMirror ``doc`` for ``markdown`` (never empty)."""

    text = nfc(markdown or "")
    root: dict = {"type": "doc", "content": []}
    stack: list[dict] = [root]
    marks: list[dict] = []

    def push(node: dict) -> None:
        stack[-1].setdefault("content", []).append(node)
        stack.append(node)

    def pop() -> dict:
        return stack.pop()

    def add_text(value: str) -> None:
        if not value:
            return
        target = stack[-1]
        node: dict = {"type": "text", "text": value}
        if marks:
            node["marks"] = [dict(m) for m in marks]
        content = target.setdefault("content", [])
        if (
            content and content[-1].get("type") == "text"
            and content[-1].get("marks") == node.get("marks")
        ):
            content[-1]["text"] += value
        else:
            content.append(node)

    def inline(children: list) -> None:
        for tok in children:
            kind = tok.type
            if kind == "text":
                add_text(tok.content)
            elif kind in ("softbreak", "hardbreak"):
                if kind == "softbreak":
                    add_text(" ")
                else:
                    stack[-1].setdefault("content", []).append({"type": "hardBreak"})
            elif kind == "code_inline":
                marks.append({"type": "code"})
                add_text(tok.content)
                marks.pop()
            elif kind in ("strong_open", "em_open", "s_open"):
                marks.append({"type": {"strong_open": "bold", "em_open": "italic", "s_open": "strike"}[kind]})
            elif kind in ("strong_close", "em_close", "s_close"):
                if marks:
                    marks.pop()
            elif kind == "link_open":
                marks.append({"type": "link", "attrs": {"href": tok.attrGet("href") or ""}})
            elif kind == "link_close":
                if marks:
                    marks.pop()
            elif kind == "image":
                stack[-1].setdefault("content", []).append(
                    {"type": "image", "attrs": {"src": tok.attrGet("src") or "", "alt": tok.content or ""}}
                )
            elif kind == "html_inline":
                add_text(tok.content)

    for tok in _MD.parse(text):
        kind = tok.type
        if kind == "heading_open":
            push({"type": "heading", "attrs": {"level": int(tok.tag[1])}})
        elif kind == "paragraph_open":
            push({"type": "paragraph"})
        elif kind in ("heading_close", "paragraph_close"):
            node = pop()
            if node["type"] == "paragraph":
                _split_images(stack[-1], node)
        elif kind == "inline":
            cell = stack[-1]["type"] in ("tableCell", "tableHeader")
            if cell:
                push({"type": "paragraph"})
            inline(tok.children or [])
            if cell:
                pop()
        elif kind == "bullet_list_open":
            push({"type": "bulletList"})
        elif kind == "ordered_list_open":
            start = int(tok.attrGet("start") or 1)
            push({"type": "orderedList", "attrs": {"start": start}})
        elif kind in ("bullet_list_close", "ordered_list_close"):
            _finish_list(pop())
        elif kind == "list_item_open":
            push({"type": "listItem"})
        elif kind == "list_item_close":
            pop()
        elif kind == "blockquote_open":
            push({"type": "blockquote"})
        elif kind == "blockquote_close":
            pop()
        elif kind in ("fence", "code_block"):
            language = (tok.info or "").strip().split(" ")[0] if kind == "fence" else ""
            code = tok.content[:-1] if tok.content.endswith("\n") else tok.content
            node = {"type": "codeBlock", "attrs": {"language": language or None}}
            if code:
                node["content"] = [{"type": "text", "text": code}]
            stack[-1].setdefault("content", []).append(node)
        elif kind == "hr":
            stack[-1].setdefault("content", []).append({"type": "horizontalRule"})
        elif kind == "table_open":
            push({"type": "table"})
        elif kind == "table_close":
            pop()
        elif kind == "tr_open":
            push({"type": "tableRow"})
        elif kind == "tr_close":
            pop()
        elif kind in ("th_open", "td_open"):
            push({"type": "tableHeader" if kind == "th_open" else "tableCell"})
        elif kind in ("th_close", "td_close"):
            node = pop()
            if not node.get("content"):
                node["content"] = [{"type": "paragraph"}]
        elif kind == "html_block":
            for line in tok.content.strip().splitlines():
                if line.strip():
                    stack[-1].setdefault("content", []).append(
                        {"type": "paragraph", "content": [{"type": "text", "text": line.strip()}]}
                    )
    if not root["content"]:
        root["content"] = [{"type": "paragraph"}]
    return root


def _split_images(parent: dict, para: dict) -> None:
    """Images are block nodes in the editor: lift them out of their paragraph."""

    content = para.get("content") or []
    if not any(n.get("type") == "image" for n in content):
        if not content:
            para.pop("content", None)
        return
    parent["content"].remove(para)
    run: list[dict] = []

    def flush() -> None:
        if run and any(n.get("type") != "text" or n["text"].strip() for n in run):
            parent["content"].append({"type": "paragraph", "content": list(run)})
        run.clear()

    for node in content:
        if node.get("type") == "image":
            flush()
            parent["content"].append(node)
        else:
            run.append(node)
    flush()


def _finish_list(node: dict) -> None:
    items = node.get("content") or []
    first_text = _first_text(items[0]) if items else None
    if node["type"] == "bulletList" and first_text is not None and _TASK.match(first_text):
        node["type"] = "taskList"
        for item in items:
            checked = False
            text = _first_text(item)
            match = _TASK.match(text or "")
            if match:
                checked = match.group(1) in "xX"
                _strip_prefix(item, match.end())
            item["type"] = "taskItem"
            item["attrs"] = {"checked": checked}
    for item in items:
        if not item.get("content"):
            item["content"] = [{"type": "paragraph"}]


def _first_text(item: dict) -> str | None:
    for block in item.get("content") or []:
        if block.get("type") == "paragraph":
            for node in block.get("content") or []:
                if node.get("type") == "text":
                    return node["text"]
                break
            return None
        return None
    return None


def _strip_prefix(item: dict, size: int) -> None:
    para = item["content"][0]
    first = para["content"][0]
    first["text"] = first["text"][size:]
    if not first["text"]:
        para["content"].pop(0)
        if not para["content"]:
            para.pop("content")


# ------------------------------------------------------------------ PM -> Markdown


_ESCAPE = re.compile(r"([\\`*\[\]<>|])|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])")


def _escape(text: str) -> str:
    return _ESCAPE.sub(lambda m: "\\" + m.group(0), text)


def _inline(nodes: list[dict] | None) -> str:
    out: list[str] = []
    for node in nodes or []:
        kind = node.get("type")
        if kind == "text":
            out.append(_marked(node))
        elif kind == "hardBreak":
            out.append("  \n")
        elif kind == "image":
            attrs = node.get("attrs") or {}
            out.append(f"![{attrs.get('alt') or ''}]({attrs.get('src') or ''})")
        else:
            out.append(plain_text(node).replace("\n", " "))
    return "".join(out)


def _marked(node: dict) -> str:
    text = node.get("text") or ""
    marks = {m.get("type"): m for m in node.get("marks") or [] if isinstance(m, dict)}
    if "code" in marks:
        body = "`" + text.replace("`", "'") + "`"
        lead = trail = ""
    else:
        body = _escape(text.strip(" "))
        lead = text[: len(text) - len(text.lstrip(" "))]
        trail = text[len(text.rstrip(" ")):] if text.strip(" ") else ""
        if not body:
            return text
    for name, wrap in (("strike", "~~"), ("italic", "*"), ("bold", "**")):
        if name in marks:
            body = wrap + body + wrap
    link = marks.get("link")
    if link:
        body = f"[{body}]({(link.get('attrs') or {}).get('href') or ''})"
    return lead + body + trail


def _blocks(nodes: list[dict] | None, indent: str = "") -> list[str]:
    parts: list[str] = []
    for node in nodes or []:
        text = _block(node, indent)
        if text:
            parts.append(text)
    return parts


def _block(node: dict, indent: str) -> str:
    kind = node.get("type")
    content = node.get("content")
    attrs = node.get("attrs") or {}
    if kind == "paragraph":
        return indent + _inline(content)
    if kind == "heading":
        level = max(1, min(6, int(attrs.get("level") or 1)))
        return "#" * level + " " + _inline(content)
    if kind in ("bulletList", "orderedList", "taskList"):
        lines: list[str] = []
        number = int(attrs.get("start") or 1)
        for item in content or []:
            if kind == "bulletList":
                marker = "- "
            elif kind == "orderedList":
                marker = f"{number}. "
                number += 1
            else:
                marker = "- [x] " if (item.get("attrs") or {}).get("checked") else "- [ ] "
            inner = _blocks(item.get("content"))
            body = "\n".join(inner[:1])
            rest = "\n".join(inner[1:])
            pad = " " * len(marker)
            text = marker + body
            if rest:
                text += "\n" + "\n".join(pad + line if line else line for line in rest.split("\n"))
            lines.append(indent + text if not indent else "\n".join(indent + ln for ln in text.split("\n")))
        return "\n".join(lines)
    if kind == "codeBlock":
        code = "".join(n.get("text", "") for n in content or [])
        fence = "```" if "```" not in code else "````"
        return f"{fence}{attrs.get('language') or ''}\n{code}\n{fence}"
    if kind == "blockquote":
        inner = "\n\n".join(_blocks(content))
        return "\n".join("> " + line if line else ">" for line in inner.split("\n"))
    if kind == "horizontalRule":
        return "---"
    if kind == "image":
        return f"![{attrs.get('alt') or ''}]({attrs.get('src') or ''})"
    if kind == "table":
        return _table(node)
    if kind in ("listItem", "taskItem"):
        return "\n\n".join(_blocks(content))
    if isinstance(content, list):  # callout, details, columns, ...: keep the text
        return "\n\n".join(_blocks(content))
    return plain_text(node)


def _table(node: dict) -> str:
    rows = []
    for row in node.get("content") or []:
        cells = [
            " ".join(_inline(p.get("content")) for p in (cell.get("content") or []) if isinstance(p, dict)).replace("|", "\\|")
            for cell in row.get("content") or []
        ]
        rows.append(cells)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def pm_to_markdown(doc: dict | None) -> str:
    if not isinstance(doc, dict):
        return ""
    return "\n\n".join(_blocks(doc.get("content"))).strip()


# ------------------------------------------------------------------ sections


def outline(doc: dict | None) -> list[tuple[int, str, int]]:
    """``(level, heading text, index of the block in doc.content)``."""

    found = []
    for index, node in enumerate((doc or {}).get("content") or []):
        if node.get("type") == "heading":
            level = int((node.get("attrs") or {}).get("level") or 1)
            found.append((level, plain_text(node), index))
    return found


def _section_bounds(doc: dict, heading: str) -> tuple[int, int, int] | None:
    """``(heading block index, first block after the section, level)``."""

    want = fold(heading.strip().lstrip("#").strip())
    items = outline(doc)
    total = len((doc.get("content") or []))
    for pos, (level, text, index) in enumerate(items):
        if fold(text) == want:
            end = total
            for next_level, _t, next_index in items[pos + 1:]:
                if next_level <= level:
                    end = next_index
                    break
            return index, end, level
    return None


def section_markdown(doc: dict, heading: str) -> str | None:
    """Markdown of the section under ``heading`` (heading included)."""

    bounds = _section_bounds(doc, heading)
    if bounds is None:
        return None
    start, end, _level = bounds
    return pm_to_markdown({"content": doc["content"][start:end]})


def replace_section(doc: dict, heading: str, markdown: str) -> dict | None:
    """A copy of ``doc`` whose section ``heading`` has new content. When
    ``markdown`` starts with a heading it replaces the heading too; otherwise
    the heading stays and only its body is replaced. None: heading not found."""

    bounds = _section_bounds(doc, heading)
    if bounds is None:
        return None
    start, end, _level = bounds
    blocks = markdown_to_pm(markdown)["content"]
    keep = [] if blocks and blocks[0].get("type") == "heading" else [doc["content"][start]]
    if blocks == [{"type": "paragraph"}]:
        blocks = []
    return {**doc, "content": doc["content"][:start] + keep + blocks + doc["content"][end:]}


def append_markdown(doc: dict | None, markdown: str) -> dict:
    existing = [
        n for n in (doc or {}).get("content") or []
    ]
    if existing == [{"type": "paragraph"}]:
        existing = []
    blocks = markdown_to_pm(markdown)["content"]
    return {"type": "doc", "content": existing + blocks}


__all__ = [
    "MAX_MARKDOWN_CHARS",
    "append_markdown",
    "markdown_to_pm",
    "outline",
    "pm_to_markdown",
    "replace_section",
    "section_markdown",
]
