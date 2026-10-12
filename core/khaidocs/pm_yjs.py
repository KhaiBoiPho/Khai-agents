"""ProseMirror JSON <-> Yjs, in the encoding y-prosemirror uses.

The editor (Tiptap's Collaboration extension) keeps the document in the
``XmlFragment`` named ``default``:

* a node is an ``XmlElement`` named after the node type, its attributes the
  node's non-null attrs;
* consecutive text nodes of one parent are one ``XmlText``; a mark is a
  formatting attribute named after the mark type whose value is the mark's
  attrs object (``{}`` when it has none). A mark that can overlap itself is
  written ``<type>--<hash>``; the suffix is dropped when reading.

Everything the server needs from that is here: deriving ``content`` (and so
``text_content``) from a stored Yjs document, and building a Yjs document
from JSON for pages created or replaced outside the editor (duplicate,
import, agent writes). Attributes a node's schema defaults to ``null`` are
not stored by the editor either, so a round trip is stable.
"""

from __future__ import annotations

from typing import Any

from pycrdt import Doc, XmlElement, XmlFragment, XmlText

FIELD = "default"


# -- Yjs -> JSON --------------------------------------------------------------


def _plain(value: Any) -> Any:
    """Yjs numbers come back as floats; whole ones are integers in the JSON."""

    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def _mark_name(name: str) -> str:
    head, sep, tail = name.partition("--")
    return head if sep else name


def _text_nodes(text: XmlText) -> list[dict]:
    nodes: list[dict] = []
    for insert, attrs in text.diff():
        if not isinstance(insert, str) or insert == "":
            continue
        node: dict[str, Any] = {"type": "text", "text": insert}
        marks = [
            {"type": _mark_name(name), **({"attrs": _plain(value)} if value else {})}
            for name, value in (attrs or {}).items()
            if value is not None
        ]
        if marks:
            node["marks"] = marks
        nodes.append(node)
    return nodes


def _children(parent: Any) -> list[dict]:
    out: list[dict] = []
    for child in parent.children:
        if isinstance(child, XmlText):
            out.extend(_text_nodes(child))
        elif isinstance(child, XmlElement):
            out.append(_element(child))
    return out


def _element(element: XmlElement) -> dict:
    node: dict[str, Any] = {"type": element.tag}
    attrs = {key: _plain(value) for key, value in element.attributes}
    if attrs:
        node["attrs"] = attrs
    content = _children(element)
    if content:
        node["content"] = content
    return node


def fragment_to_json(fragment: XmlFragment) -> dict:
    content = _children(fragment)
    return {"type": "doc", "content": content or [{"type": "paragraph"}]}


def ydoc_to_json(doc: Doc) -> dict:
    return fragment_to_json(doc.get(FIELD, type=XmlFragment))


def update_to_json(update: bytes | None) -> dict:
    """The document a stored Yjs update describes (an empty page when None)."""

    doc = Doc()
    if update:
        doc.apply_update(update)
    return ydoc_to_json(doc)


# -- JSON -> Yjs --------------------------------------------------------------


def _mark_attributes(marks: list[dict] | None) -> dict[str, Any]:
    attrs: dict[str, Any] = {}
    for mark in marks or []:
        name = mark.get("type")
        if isinstance(name, str) and name:
            attrs[name] = dict(mark.get("attrs") or {})
    return attrs


def _fill(parent: Any, content: list[dict] | None) -> None:
    text: XmlText | None = None
    offset = 0
    for node in content or []:
        if not isinstance(node, dict):
            continue
        kind = node.get("type")
        if kind == "text":
            value = str(node.get("text") or "")
            if not value:
                continue
            if text is None:
                text = XmlText()
                parent.children.append(text)
                offset = 0
            text.insert(offset, value, _mark_attributes(node.get("marks")) or None)
            offset += len(value.encode("utf-8"))  # pycrdt indexes XmlText in UTF-8 bytes
            continue
        text = None
        if not isinstance(kind, str) or not kind:
            continue
        element = XmlElement(kind)
        parent.children.append(element)
        for key, value in (node.get("attrs") or {}).items():
            if value is not None and key != "ref":
                element.attributes[key] = value
        _fill(element, node.get("content"))


def fill_fragment(fragment: XmlFragment, content: dict | None) -> None:
    doc = content if isinstance(content, dict) else {}
    nodes = doc.get("content") if doc.get("type") == "doc" else None
    _fill(fragment, nodes if nodes else [{"type": "paragraph"}])


def replace_content(doc: Doc, content: dict | None) -> None:
    """Replace the document's content in one transaction (a normal Yjs edit,
    so it merges with concurrent changes from the editor)."""

    fragment = doc.get(FIELD, type=XmlFragment)
    with doc.transaction():
        count = len(fragment.children)
        if count:
            del fragment.children[0:count]
        fill_fragment(fragment, content)


def json_to_ydoc(content: dict | None) -> Doc:
    doc = Doc()
    fragment = doc.get(FIELD, type=XmlFragment)
    with doc.transaction():
        fill_fragment(fragment, content)
    return doc


def json_to_update(content: dict | None) -> bytes:
    return json_to_ydoc(content).get_update()
