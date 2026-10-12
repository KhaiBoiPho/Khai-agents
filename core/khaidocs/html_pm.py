"""HTML <-> ProseMirror JSON (the editor's schema, see desktop editor-ext).

``html_to_pm`` is a small tolerant converter (stdlib ``html.parser``): it
understands what the editor's own ``getHTML`` produces, what Markdown renders
to, and the usual hand-written HTML. Unknown tags are transparent (their
children are kept), scripts, styles and comments are dropped, ``javascript:``
style links are removed. ``pm_to_html`` writes escaped, standalone HTML.
"""

from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser
from typing import Any

from core.khaidocs.text import nfc

VOID = frozenset({"br", "hr", "img", "input", "meta", "link", "col", "source", "area", "base", "wbr"})
DROP = frozenset({"script", "style", "head", "title", "noscript", "template", "iframe", "object", "svg"})
INLINE_MARKS = {
    "strong": "bold", "b": "bold", "em": "italic", "i": "italic", "s": "strike",
    "del": "strike", "strike": "strike", "u": "underline", "code": "code",
    "sub": "subscript", "sup": "superscript", "mark": "highlight",
}
HEADINGS = {f"h{n}": n for n in range(1, 7)}
SAFE_SCHEMES = ("http:", "https:", "mailto:", "tel:", "/", "#", "./", "../")
CALLOUTS = ("info", "success", "warning", "danger")
_AUTOCLOSE = {"li": {"li"}, "p": {"p"}, "td": {"td", "th"}, "th": {"td", "th"}, "tr": {"tr", "td", "th"}}
_STOP = ("table", "ul", "ol", "div", "body", "blockquote", "details")
MAX_DEPTH = 80
_BLOCK_TAGS = frozenset({
    "p", "ul", "ol", "blockquote", "pre", "hr", "table", "details", "li", *HEADINGS,
})
_CONTAINERS = frozenset({
    "div", "section", "article", "main", "body", "html", "figure", "header", "footer",
    "nav", "aside", "center", "figcaption", "form", "fieldset",
})


class El:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag: str, attrs: dict[str, str], parent: El | None = None) -> None:
        self.tag, self.attrs, self.children, self.parent = tag, attrs, [], parent

    def text(self) -> str:
        return "".join(c if isinstance(c, str) else c.text() for c in self.children)


class _Tree(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = El("root", {})
        self.cur = self.root
        self.depth = 0
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if self.skip:
            if tag in DROP:
                self.skip += 1
            return
        if tag in DROP:
            self.skip = 1
            return
        close = _AUTOCLOSE.get(tag)
        if close:
            node = self.cur
            while node is not self.root and node.tag not in _STOP:
                if node.tag in close:
                    self.cur = node.parent or self.root
                    self.depth -= 1
                    break
                node = node.parent
        element = El(tag, {k: (v or "") for k, v in attrs}, self.cur)
        self.cur.children.append(element)
        if tag not in VOID and self.depth < MAX_DEPTH:
            self.cur = element
            self.depth += 1

    def handle_startendtag(self, tag, attrs):
        if tag in DROP:
            return
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.skip:
            if tag in DROP:
                self.skip -= 1
            return
        node = self.cur
        while node is not self.root:
            if node.tag == tag:
                self.cur = node.parent or self.root
                self.depth = max(0, self.depth - 1)
                return
            node = node.parent

    def handle_data(self, data):
        if not self.skip:
            self.cur.children.append(data)


def safe_href(href: str | None) -> str | None:
    value = (href or "").strip()
    if not value:
        return None
    lowered = re.sub(r"[\x00-\x20]", "", value).lower()
    head = lowered.split("/")[0].split("?")[0].split("#")[0]
    if ":" in head and not lowered.startswith(SAFE_SCHEMES):
        return None
    return value


def _mark(kind: str, **attrs: Any) -> dict:
    return {"type": kind, "attrs": attrs} if attrs else {"type": kind}


def _add_mark(marks: list[dict], mark: dict) -> list[dict]:
    if any(m["type"] == mark["type"] for m in marks):
        return marks
    return [*marks, mark]


def _text(value: str, marks: list[dict]) -> dict | None:
    if not value:
        return None
    node: dict = {"type": "text", "text": value}
    marks = _norm_marks(marks)
    if marks:
        node["marks"] = [dict(m) for m in marks]
    return node


def _norm_marks(marks: list[dict]) -> list[dict]:
    # `code` excludes the other marks (except link) in the editor schema.
    if any(m["type"] == "code" for m in marks):
        return [m for m in marks if m["type"] in ("code", "link")]
    return marks


def merge_inline(nodes: list[dict]) -> list[dict]:
    out: list[dict] = []
    for node in nodes:
        if out and node["type"] == "text" and out[-1]["type"] == "text" \
                and out[-1].get("marks") == node.get("marks"):
            out[-1] = {**out[-1], "text": out[-1]["text"] + node["text"]}
        else:
            out.append(node)
    return out


def _lstrip(node: dict) -> dict:
    return {**node, "text": node["text"].lstrip()} if node["type"] == "text" else node


def _rstrip(node: dict) -> dict:
    return {**node, "text": node["text"].rstrip()} if node["type"] == "text" else node


def trim_inline(inline: list[dict]) -> list[dict]:
    inline = merge_inline(inline)
    while inline and inline[0]["type"] == "text" and not inline[0]["text"].strip():
        inline.pop(0)
    while inline and inline[-1]["type"] == "text" and not inline[-1]["text"].strip():
        inline.pop()
    if inline:
        inline[0] = _lstrip(inline[0])
        inline[-1] = _rstrip(inline[-1])
    return inline


def _has_image(el: El) -> bool:
    return any(isinstance(c, El) and (c.tag == "img" or _has_image(c)) for c in el.children)


def _checkbox(item: El) -> El | None:
    for child in item.children:
        if isinstance(child, El) and child.tag == "input" and child.attrs.get("type") == "checkbox":
            return child
        if isinstance(child, El) and child.tag in ("p", "label"):
            inner = _checkbox(child)
            if inner is not None:
                return inner
    return None


class _Converter:
    def convert(self, root: El) -> dict:
        return {"type": "doc", "content": self.blocks(root.children) or [{"type": "paragraph"}]}

    # -- inline ---------------------------------------------------------------
    def inline(self, children: list, marks: list[dict]) -> list[dict]:
        out: list[dict] = []
        for child in children:
            if isinstance(child, str):
                node = _text(re.sub(r"\s+", " ", child), marks)
                if node:
                    out.append(node)
            else:
                out += self.inline_el(child, marks)
        return out

    def inline_el(self, el: El, marks: list[dict]) -> list[dict]:
        tag = el.tag
        if tag == "br":
            return [{"type": "hardBreak"}]
        if tag == "img":
            return []
        if tag in INLINE_MARKS:
            return self.inline(el.children, _add_mark(marks, _mark(INLINE_MARKS[tag])))
        if tag == "a":
            href = safe_href(el.attrs.get("href"))
            if href:
                marks = _add_mark(marks, _mark("link", href=href, internal=el.attrs.get("data-internal") == "true"))
            return self.inline(el.children, marks)
        if tag == "span" and el.attrs.get("data-type") == "mathInline":
            latex = (el.attrs.get("data-latex") or el.text()).strip()
            return [{"type": "mathInline", "attrs": {"text": latex}}] if latex else []
        if tag == "span" and el.attrs.get("data-type") == "mention":
            return [{"type": "mention", "attrs": {
                "id": el.attrs.get("data-id"),
                "label": el.attrs.get("data-label") or el.text().lstrip("@"),
                "entityType": el.attrs.get("data-entity-type") or "user",
                "entityId": el.attrs.get("data-entity-id"),
                "slugId": el.attrs.get("data-slug-id"),
            }}]
        return self.inline(el.children, marks)

    # -- blocks ----------------------------------------------------------------
    def blocks(self, children: list) -> list[dict]:
        out: list[dict] = []
        run: list = []

        def flush() -> None:
            if run:
                inline = trim_inline(self.inline(run, []))
                run.clear()
                if inline:
                    out.append({"type": "paragraph", "content": inline})

        for child in children:
            if isinstance(child, str):
                run.append(child)
                continue
            tag = child.tag
            special = tag == "div" and child.attrs.get("data-type") in ("callout", "mathBlock")
            if tag == "img":
                flush()
                out.append(self.image(child))
            elif tag in _BLOCK_TAGS or special:
                flush()
                out += self.block_el(child)
            elif tag in _CONTAINERS or (tag not in INLINE_MARKS and tag != "br" and _has_image(child)) \
                    or (tag in INLINE_MARKS and _has_image(child)):
                flush()
                out += self.blocks(child.children)
            else:
                run.append(child)
        flush()
        return out

    @staticmethod
    def image(el: El) -> dict:
        attrs: dict[str, Any] = {"src": el.attrs.get("src", "")}
        if el.attrs.get("alt"):
            attrs["alt"] = el.attrs["alt"]
        width = el.attrs.get("width", "")
        if width.isdigit():
            attrs["width"] = int(width)
        if el.attrs.get("data-attachment-id"):
            attrs["attachmentId"] = el.attrs["data-attachment-id"]
        return {"type": "image", "attrs": attrs}

    def block_el(self, el: El) -> list[dict]:
        tag = el.tag
        if tag in HEADINGS:
            node: dict = {"type": "heading", "attrs": {"level": HEADINGS[tag]}}
            inline = trim_inline(self.inline(el.children, []))
            if inline:
                node["content"] = inline
            return [node]
        if tag == "p":
            return self.blocks(el.children)
        if tag == "hr":
            return [{"type": "horizontalRule"}]
        if tag == "blockquote":
            return [{"type": "blockquote", "content": self.blocks(el.children) or [{"type": "paragraph"}]}]
        if tag == "pre":
            return [self.code(el)]
        if tag in ("ul", "ol"):
            return [self.list_el(el)]
        if tag == "li":
            holder = El("ul", {})
            holder.children.append(el)
            return [self.list_el(holder)]
        if tag == "table":
            return self.table(el)
        if tag == "details":
            return [self.details(el)]
        if tag == "div" and el.attrs.get("data-type") == "callout":
            kind = el.attrs.get("data-callout-type", "info")
            return [{"type": "callout", "attrs": {"type": kind if kind in CALLOUTS else "info"},
                     "content": self.blocks(el.children) or [{"type": "paragraph"}]}]
        if tag == "div" and el.attrs.get("data-type") == "mathBlock":
            latex = (el.attrs.get("data-latex") or el.text()).strip()
            return [{"type": "mathBlock", "attrs": {"text": latex}}] if latex else []
        return self.blocks(el.children)

    @staticmethod
    def code(el: El) -> dict:
        inner = el.children[0] if len(el.children) == 1 and isinstance(el.children[0], El) \
            and el.children[0].tag == "code" else None
        source = (inner or el).text().rstrip("\n")
        classes = (inner.attrs.get("class", "") if inner else "") + " " + el.attrs.get("class", "")
        match = re.search(r"language-([\w+#.-]+)", classes)
        node: dict = {"type": "codeBlock", "attrs": {"language": match.group(1) if match else None}}
        if source:
            node["content"] = [{"type": "text", "text": source}]
        return node

    def details(self, el: El) -> dict:
        summary = next((c for c in el.children if isinstance(c, El) and c.tag == "summary"), None)
        rest = [c for c in el.children if c is not summary]
        head: dict = {"type": "detailsSummary"}
        inline = trim_inline(self.inline(summary.children, [])) if summary else []
        if inline:
            head["content"] = inline
        body = self.blocks(rest) or [{"type": "paragraph"}]
        return {"type": "details", "attrs": {"open": "open" in el.attrs},
                "content": [head, {"type": "detailsContent", "content": body}]}

    def list_el(self, el: El) -> dict:
        items = [c for c in el.children if isinstance(c, El) and c.tag == "li"]
        nested = [c for c in el.children if isinstance(c, El) and c.tag in ("ul", "ol")]
        task = bool(items) and (
            el.attrs.get("data-type") == "taskList"
            or all(_checkbox(i) is not None or i.attrs.get("data-type") == "taskItem" for i in items)
        )
        out_items: list[dict] = []
        for item in items:
            checkbox = _checkbox(item)
            body = [c for c in item.children if c is not checkbox] if checkbox else item.children
            content = self.blocks(body) or [{"type": "paragraph"}]
            if content[0]["type"] != "paragraph":
                content.insert(0, {"type": "paragraph"})
            if task:
                checked = item.attrs.get("data-checked") == "true" or (
                    checkbox is not None and "checked" in checkbox.attrs
                )
                out_items.append({"type": "taskItem", "attrs": {"checked": checked}, "content": content})
            else:
                out_items.append({"type": "listItem", "content": content})
        for child in nested:
            if out_items:
                out_items[-1]["content"].append(self.list_el(child))
        if not out_items:
            out_items = [{"type": "listItem", "content": [{"type": "paragraph"}]}]
        if task:
            return {"type": "taskList", "content": out_items}
        if el.tag == "ol":
            start = el.attrs.get("start", "")
            return {"type": "orderedList", "attrs": {"start": int(start) if start.isdigit() else 1},
                    "content": out_items}
        return {"type": "bulletList", "content": out_items}

    def table(self, el: El) -> list[dict]:
        rows: list[El] = []

        def collect(node: El) -> None:
            for child in node.children:
                if isinstance(child, El):
                    if child.tag == "tr":
                        rows.append(child)
                    elif child.tag in ("thead", "tbody", "tfoot"):
                        collect(child)

        collect(el)
        out_rows = []
        for row in rows:
            cells = []
            for cell in row.children:
                if not (isinstance(cell, El) and cell.tag in ("td", "th")):
                    continue
                node: dict = {
                    "type": "tableHeader" if cell.tag == "th" else "tableCell",
                    "content": self.blocks(cell.children) or [{"type": "paragraph"}],
                }
                attrs = {
                    key: min(int(cell.attrs[key]), 50)
                    for key in ("colspan", "rowspan")
                    if cell.attrs.get(key, "").isdigit() and int(cell.attrs[key]) > 1
                }
                if attrs:
                    node["attrs"] = attrs
                cells.append(node)
            if cells:
                out_rows.append({"type": "tableRow", "content": cells})
        return [{"type": "table", "content": out_rows}] if out_rows else []


def _nfc(node: Any) -> Any:
    if isinstance(node, dict):
        return {k: (nfc(v) if k == "text" and isinstance(v, str) else _nfc(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [_nfc(v) for v in node]
    return node


def html_to_pm(html: str) -> dict:
    """ProseMirror document JSON for an HTML string."""

    tree = _Tree()
    tree.feed(html or "")
    tree.close()
    return _nfc(_Converter().convert(tree.root))


# ------------------------------------------------------------------ PM -> HTML

_MARK_TAGS = [
    ("code", "code"), ("bold", "strong"), ("italic", "em"), ("strike", "s"),
    ("underline", "u"), ("subscript", "sub"), ("superscript", "sup"), ("highlight", "mark"),
]


def default_url(kind: str, attrs: dict) -> str:
    if kind == "page":
        return f"/p/{attrs.get('slugId')}"
    return attrs.get("src") or attrs.get("url") or ""


def _inline_html(nodes: list[dict] | None, url: Any) -> str:
    out = []
    for node in nodes or []:
        kind = node.get("type")
        if kind == "text":
            html = escape(node.get("text", ""), quote=False)
            marks = {m["type"]: m for m in node.get("marks", [])}
            for name, tag in _MARK_TAGS:
                if name in marks:
                    html = f"<{tag}>{html}</{tag}>"
            link = marks.get("link")
            href = safe_href((link.get("attrs") or {}).get("href")) if link else None
            if href:
                html = f'<a href="{escape(href)}">{html}</a>'
            out.append(html)
        elif kind == "hardBreak":
            out.append("<br>")
        elif kind == "mathInline":
            latex = (node.get("attrs") or {}).get("text", "")
            out.append(f'<span data-type="mathInline" data-latex="{escape(latex)}">'
                       f"{escape(latex, quote=False)}</span>")
        elif kind == "mention":
            attrs = node.get("attrs") or {}
            label = escape(attrs.get("label") or "", quote=False)
            if attrs.get("entityType") == "page" and attrs.get("slugId"):
                out.append(f'<a href="{escape(url("page", attrs))}">{label}</a>')
            else:
                out.append(f"@{label}")
        else:
            out.append(_inline_html(node.get("content"), url))
    return "".join(out)


def _item_html(content: list[dict], url: Any) -> str:
    parts = []
    for child in content:
        if child.get("type") == "paragraph":
            parts.append(_inline_html(child.get("content"), url))
        else:
            parts.append("\n" + _block_html(child, url))
    return "".join(parts)


def _block_html(node: dict, url: Any) -> str:
    kind = node.get("type")
    content = node.get("content") or []
    attrs = node.get("attrs") or {}

    def inner() -> str:
        return "".join(_block_html(c, url) for c in content)

    if kind == "paragraph":
        return f"<p>{_inline_html(content, url)}</p>\n"
    if kind == "heading":
        level = min(max(int(attrs.get("level") or 1), 1), 6)
        return f"<h{level}>{_inline_html(content, url)}</h{level}>\n"
    if kind == "blockquote":
        return f"<blockquote>\n{inner()}</blockquote>\n"
    if kind == "bulletList":
        return f"<ul>\n{inner()}</ul>\n"
    if kind == "orderedList":
        start = int(attrs.get("start") or 1)
        return f"<ol{'' if start == 1 else f' start={start}'}>\n{inner()}</ol>\n"
    if kind == "taskList":
        return f'<ul data-type="taskList">\n{inner()}</ul>\n'
    if kind == "listItem":
        return f"<li>{_item_html(content, url)}</li>\n"
    if kind == "taskItem":
        checked = bool(attrs.get("checked"))
        box = "<input type=\"checkbox\" disabled" + (" checked" if checked else "") + ">"
        return (f'<li data-type="taskItem" data-checked="{str(checked).lower()}">'
                f"{box} {_item_html(content, url)}</li>\n")
    if kind == "codeBlock":
        language = attrs.get("language")
        cls = f' class="language-{escape(str(language))}"' if language else ""
        text = "".join(c.get("text", "") for c in content)
        return f"<pre><code{cls}>{escape(text, quote=False)}</code></pre>\n"
    if kind in ("horizontalRule", "pageBreak"):
        return "<hr>\n"
    if kind == "image":
        return f'<p><img src="{escape(url("image", attrs))}" alt="{escape(attrs.get("alt") or "")}"></p>\n'
    if kind == "table":
        return f"<table>\n{inner()}</table>\n"
    if kind == "tableRow":
        return f"<tr>{inner()}</tr>\n"
    if kind in ("tableCell", "tableHeader"):
        tag = "th" if kind == "tableHeader" else "td"
        extra = "".join(f' {k}="{int(attrs[k])}"' for k in ("colspan", "rowspan") if attrs.get(k))
        return f"<{tag}{extra}>{inner()}</{tag}>"
    if kind == "callout":
        return (f'<div data-type="callout" data-callout-type="{escape(str(attrs.get("type") or "info"))}">'
                f"\n{inner()}</div>\n")
    if kind == "details":
        return f"<details{' open' if attrs.get('open') else ''}>\n{inner()}</details>\n"
    if kind == "detailsSummary":
        return f"<summary>{_inline_html(content, url)}</summary>\n"
    if kind == "mathBlock":
        latex = attrs.get("text", "")
        return f'<div data-type="mathBlock" data-latex="{escape(latex)}">{escape(latex, quote=False)}</div>\n'
    if kind in ("attachment", "video", "audio", "pdf"):
        name = attrs.get("name") or attrs.get("src") or "file"
        return f'<p><a href="{escape(url("file", attrs))}">{escape(str(name), quote=False)}</a></p>\n'
    if kind in ("embed", "drawio", "excalidraw"):
        safe = safe_href(attrs.get("src") or attrs.get("url") or "")
        return f'<p><a href="{escape(safe)}">{escape(safe, quote=False)}</a></p>\n' if safe else ""
    return inner() if content else ""


def pm_to_html(doc: dict, *, url: Any = default_url, title: str | None = None, full: bool = True) -> str:
    """HTML for a ProseMirror document. ``url(kind, attrs)`` maps images,
    files and page mentions to hrefs (kind: image, file, page)."""

    body = "".join(_block_html(c, url) for c in (doc or {}).get("content") or [])
    if not full:
        return body
    head = f"<title>{escape(title, quote=False)}</title>" if title is not None else ""
    heading = f"<h1>{escape(title, quote=False)}</h1>\n" if title else ""
    return (
        '<!doctype html>\n<html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"{head}</head>\n<body>\n{heading}{body}</body></html>\n"
    )
