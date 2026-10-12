"""Word documents <-> ProseMirror (no database)."""

from __future__ import annotations

import base64
import io
import zipfile

from core.khaidocs.docx_pm import docx_to_pm, pm_to_docx
from core.khaidocs.markdown_pm import md_to_pm

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
SOURCE = """# Tiêu đề

Xin chào **đậm** *nghiêng* `mã` ~~gạch~~ [liên kết](https://x.vn/a) Nguyễn Văn Đức.

- một
  - con
- hai

1. a
2. b

Giữa

1. lại

- [x] xong
- [ ] chưa

> trích dẫn

```
dòng 1
dòng 2
```

| A | B |
|---|---|
| 1 | 2 |

![alt](/api/files/x/a.png)
"""


def walk(node, kind):
    out = []
    if node.get("type") == kind:
        out.append(node)
    for child in node.get("content") or []:
        out += walk(child, kind)
    return out


def text(node) -> str:
    return node.get("text", "") if node["type"] == "text" else "".join(text(c) for c in node.get("content") or [])


def test_export_is_a_valid_docx_with_the_content() -> None:
    data = pm_to_docx(md_to_pm(SOURCE), title="Trang thử", image_bytes=lambda attrs: (PNG, "image/png"))
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert "word/document.xml" in archive.namelist()
        assert any(n.startswith("word/media/") for n in archive.namelist())
        xml = archive.read("word/document.xml").decode("utf-8")
    assert "Nguyễn Văn Đức" in xml and "Trang thử" in xml


def test_round_trip_keeps_structure() -> None:
    data = pm_to_docx(md_to_pm(SOURCE), title="Trang thử", image_bytes=lambda attrs: (PNG, "image/png"))
    sunk = []

    def sink(blob, mime, name):
        sunk.append((blob, mime))
        return {"src": "/api/files/new/" + name, "attachmentId": "new"}

    doc = docx_to_pm(data, image_sink=sink)
    headings = walk(doc, "heading")
    assert [text(h) for h in headings] == ["Trang thử", "Tiêu đề"]
    para = next(n for n in doc["content"] if n["type"] == "paragraph")
    marks = {m["type"] for n in para["content"] for m in n.get("marks", [])}
    assert {"bold", "italic", "code", "strike", "link"} <= marks
    assert "Nguyễn Văn Đức" in text(para)
    bullets = walk(doc, "bulletList")
    assert len(bullets) >= 2 and text(bullets[0]).startswith("một")  # nested list kept
    assert any(len(walk(b, "bulletList")) == 2 for b in bullets)
    assert len(walk(doc, "orderedList")) == 2  # each numbered list restarts
    assert [t["attrs"]["checked"] for t in walk(doc, "taskItem")] == [True, False]
    assert text(walk(doc, "codeBlock")[0]) == "dòng 1\ndòng 2"
    assert walk(doc, "blockquote") and walk(doc, "table")
    assert len(walk(doc, "tableCell")) == 2 and len(walk(doc, "tableHeader")) == 2
    assert sunk == [(PNG, "image/png")]
    assert walk(doc, "image")[0]["attrs"]["attachmentId"] == "new"


def test_unsupported_image_falls_back_to_text_and_empty_doc_works() -> None:
    doc = {"type": "doc", "content": [{"type": "image", "attrs": {"src": "/x.svg", "alt": "logo"}}]}
    data = pm_to_docx(doc, image_bytes=lambda attrs: (b"<svg/>", "image/svg+xml"))
    back = docx_to_pm(data)
    assert "[logo]" in text(back)
    assert docx_to_pm(pm_to_docx({"type": "doc", "content": []}))["content"]


def test_garbage_is_rejected_by_the_reader() -> None:
    import pytest

    with pytest.raises(Exception):  # noqa: B017 - python-docx's own error types
        docx_to_pm(b"not a docx")
