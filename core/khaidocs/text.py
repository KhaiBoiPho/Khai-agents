"""Text helpers: search folding, plain text of a ProseMirror document, ids."""

from __future__ import annotations

import re
import secrets
import unicodedata
from typing import Any

_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789"
_WS = re.compile(r"[ \t\r\f\v]+")

# Nodes that end a line of text when their text is flattened.
_BLOCKS = frozenset(
    {
        "paragraph", "heading", "blockquote", "listItem", "taskItem", "codeBlock",
        "tableRow", "tableCell", "tableHeader", "callout", "details",
        "detailsSummary", "detailsContent", "horizontalRule", "columns", "column",
        "bulletList", "orderedList", "taskList", "table", "footnote", "footnotes",
    }
)
# Attributes of atom nodes worth finding by search.
_ATOM_LABELS = {
    "mention": ("label",),
    "attachment": ("name",),
    "image": ("alt", "title"),
    "video": ("name",),
    "pdf": ("name",),
    "audio": ("name",),
    "embed": ("src",),
    "math_inline": ("text",),
    "mathInline": ("text",),
    "mathBlock": ("text",),
    "drawio": ("title",),
    "excalidraw": ("title",),
}


def _fold_char(ch: str) -> str:
    if ch in "đĐ":
        return "d"
    stripped = "".join(
        part for part in unicodedata.normalize("NFD", ch) if unicodedata.category(part) != "Mn"
    ).lower()
    if len(stripped) == 1:
        return stripped
    lowered = ch.lower()
    return lowered if len(lowered) == 1 else ch


def fold(value: str | None) -> str:
    """The search form of ``value``: lowercase, without diacritics.

    Vietnamese letters lose their tone and shape marks ("ế" -> "e", "ư" ->
    "u") and the stroked d becomes "d"; other scripts are only lowercased, so
    a query in any language still matches itself. The result has exactly the
    length of ``nfc(value)`` (one character in, one out), so a match position
    in the folded text is the same position in the original; callers store
    NFC text (see ``nfc``).
    """

    if not value:
        return ""
    return "".join(_fold_char(ch) for ch in unicodedata.normalize("NFC", value))


def nfc(value: str | None) -> str:
    return unicodedata.normalize("NFC", value or "")


def new_slug_id(length: int = 10) -> str:
    return "".join(secrets.choice(_ALNUM) for _ in range(length))


def space_slug(name: str) -> str:
    """An alphanumeric slug for a space name (callers make it unique)."""

    slug = re.sub(r"[^a-z0-9]", "", fold(name))[:40]
    return slug if len(slug) >= 2 else new_slug_id(8)


def plain_text(node: Any) -> str:
    """The visible text of a ProseMirror JSON node, one block per line."""

    out: list[str] = []

    def walk(item: Any) -> None:
        if not isinstance(item, dict):
            return
        kind = item.get("type")
        if kind == "text":
            out.append(str(item.get("text") or ""))
            return
        attrs = item.get("attrs") or {}
        for key in _ATOM_LABELS.get(kind, ()):
            value = attrs.get(key)
            if isinstance(value, str) and value:
                out.append(value + " ")
        children = item.get("content")
        if isinstance(children, list):
            for child in children:
                walk(child)
        if kind in _BLOCKS and (not out or not out[-1].endswith("\n")):
            out.append("\n")
        elif kind == "hardBreak":
            out.append("\n")

    walk(node)
    text = "".join(out)
    return nfc("\n".join(_WS.sub(" ", line).strip() for line in text.split("\n")).strip())


def doc_of(text: str | None) -> dict:
    """A ProseMirror document of plain paragraphs, for text-only imports."""

    paragraphs = [
        {"type": "paragraph", "content": [{"type": "text", "text": line}]}
        if line
        else {"type": "paragraph"}
        for line in (text or "").split("\n")
    ]
    return {"type": "doc", "content": paragraphs or [{"type": "paragraph"}]}
