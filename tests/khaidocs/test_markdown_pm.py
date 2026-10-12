"""Markdown / HTML <-> ProseMirror converters (no database)."""

from __future__ import annotations

import pytest

from core.khaidocs.html_pm import html_to_pm, pm_to_html, safe_href
from core.khaidocs.markdown_pm import md_to_pm, pm_to_md


def kinds(node, found=None):
    found = found if found is not None else []
    found.append(node["type"])
    for child in node.get("content") or []:
        kinds(child, found)
    return found


def first(doc, kind):
    stack = [doc]
    while stack:
        node = stack.pop(0)
        if node["type"] == kind:
            return node
        stack += node.get("content") or []
    raise AssertionError(kind)


def test_headings_marks_and_vietnamese() -> None:
    doc = md_to_pm("## Tiêu đề **đậm** và *nghiêng*\n\nNguyễn Văn Đức ~~gạch~~ `mã` [liên kết](https://x.vn/a_b)")
    heading = doc["content"][0]
    assert heading["type"] == "heading" and heading["attrs"]["level"] == 2
    bold = [n for n in heading["content"] if n.get("marks") == [{"type": "bold"}]]
    assert bold[0]["text"] == "đậm"
    para = doc["content"][1]["content"]
    assert {"type": "strike"} in next(n for n in para if n["text"] == "gạch")["marks"]
    link = next(n for n in para if n["text"] == "liên kết")["marks"][0]
    assert link["type"] == "link" and link["attrs"]["href"] == "https://x.vn/a_b"
    assert "Nguyễn Văn Đức" in para[0]["text"]


def test_lists_tasks_nesting() -> None:
    doc = md_to_pm("- a\n  - b\n- c\n\n1. x\n2. y\n\n- [x] xong\n- [ ] chưa\n")
    assert kinds(doc).count("bulletList") == 2 and "orderedList" in kinds(doc)
    tasks = first(doc, "taskList")["content"]
    assert [t["attrs"]["checked"] for t in tasks] == [True, False]
    assert tasks[0]["content"][0]["content"][0]["text"] == "xong"
    nested = first(doc, "bulletList")["content"][0]["content"]
    assert nested[1]["type"] == "bulletList"


def test_table_code_quote_image_hr() -> None:
    doc = md_to_pm(
        "| Tên | Giá |\n|---|---|\n| Phở | 50k |\n\n```python\nprint('hé')\n```\n\n> trích\n\n"
        "![ảnh đẹp](pic/a.png)\n\n---\n"
    )
    table = first(doc, "table")
    assert len(table["content"]) == 2
    assert table["content"][0]["content"][0]["type"] == "tableHeader"
    assert table["content"][1]["content"][0]["content"][0]["content"][0]["text"] == "Phở"
    code = first(doc, "codeBlock")
    assert code["attrs"]["language"] == "python" and code["content"][0]["text"] == "print('hé')"
    assert first(doc, "blockquote")
    image = first(doc, "image")
    assert image["attrs"]["src"] == "pic/a.png" and image["attrs"]["alt"] == "ảnh đẹp"
    assert "horizontalRule" in kinds(doc)


def test_inline_image_is_lifted_to_a_block() -> None:
    doc = md_to_pm("trước ![x](a.png) sau")
    assert [n["type"] for n in doc["content"]] == ["paragraph", "image", "paragraph"]


def test_math_callout_details() -> None:
    doc = md_to_pm(
        "giá $5 và $6 nhưng $E=mc^2$ là công thức\n\n$$\nx^2 + y^2\n$$\n\n"
        ":::warning\nCẩn thận **nhé**\n:::\n\n:::weird\nx\n:::\n\n"
        "<details>\n<summary>Chi tiết</summary>\n\nNội dung ẩn\n\n</details>\n"
    )
    inline = first(doc, "mathInline")
    assert inline["attrs"]["text"] == "E=mc^2"
    assert "$5 và $6" in doc["content"][0]["content"][0]["text"]
    assert first(doc, "mathBlock")["attrs"]["text"] == "x^2 + y^2"
    callouts = [n for n in doc["content"] if n["type"] == "callout"]
    assert [c["attrs"]["type"] for c in callouts] == ["warning", "info"]
    details = first(doc, "details")
    assert details["content"][0]["content"][0]["text"] == "Chi tiết"
    assert details["content"][1]["content"][0]["content"][0]["text"] == "Nội dung ẩn"


def test_code_fence_hides_directives() -> None:
    doc = md_to_pm("```\n:::info\n$$\n```\n")
    assert kinds(doc) == ["doc", "codeBlock", "text"]


FULL = """# Tiêu đề **đậm**

Xin chào *thế giới* và `code` ~~gạch~~ [link](https://x.vn/a_b) $E=mc^2$ giá $5 và $6.

- [ ] việc một
- [x] việc hai
  - lồng nhau

1. một
2. hai

> trích dẫn
> dòng hai

```python
print("héllo")
```

| Tên | Giá |
|---|---|
| Phở | 50k |
| Bún | 40k |

![ảnh](/api/files/abc/x.png)

:::warning
Cẩn thận **nhé**
:::

$$
x^2
$$

<details>
<summary>Chi tiết</summary>

Nội dung ẩn

</details>

---
"""


def test_markdown_round_trip_is_stable() -> None:
    doc = md_to_pm(FULL)
    again = md_to_pm(pm_to_md(doc))
    assert again == doc
    # and the Markdown itself reaches a fixed point
    assert pm_to_md(again) == pm_to_md(doc)


def test_html_round_trip_is_stable() -> None:
    doc = md_to_pm(FULL)
    assert html_to_pm(pm_to_html(doc)) == doc


def test_special_characters_survive() -> None:
    text = "a_b * c [x] <y> # z | w \\ ~ `q`"
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
    assert md_to_pm(pm_to_md(doc)) == doc
    assert html_to_pm(pm_to_html(doc)) == doc


def test_marks_round_trip_including_underline_and_whitespace() -> None:
    doc = md_to_pm("**a** *b* ***c*** <u>u</u> x<sub>2</sub> <mark>m</mark>")
    assert md_to_pm(pm_to_md(doc)) == doc
    spaced = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "bold ", "marks": [{"type": "bold"}]}, {"type": "text", "text": "plain"}]}]}
    assert pm_to_md(spaced).strip() == "**bold** plain"


def test_title_heading_and_empty_documents() -> None:
    assert pm_to_md({"type": "doc", "content": [{"type": "paragraph"}]}, title="Tên_trang") == "# Tên\\_trang\n"
    assert md_to_pm("")["content"] == [{"type": "paragraph"}]
    assert md_to_pm("   \n\n")["content"] == [{"type": "paragraph"}]


def test_hostile_input_is_inert() -> None:
    doc = md_to_pm('[x](javascript:alert(1)) <script>alert(1)</script> ![a](javascript:x) <b onclick="y">k</b>')
    assert not any(m["type"] == "link" for n in kinds_nodes(doc) for m in n.get("marks", []))
    assert not any(n["type"] == "image" for n in kinds_nodes(doc))
    assert "onclick" not in str(doc) and "<script" not in str(doc)
    html = html_to_pm('<p>hi</p><script>alert(1)</script><style>p{}</style><a href="javascript:1">z</a>')
    assert "alert" not in str(html) and "javascript" not in str(html)
    out = pm_to_html({"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "<img src=x onerror=1>", "marks": [{"type": "link", "attrs": {"href": "javascript:1"}}]}]}]})
    assert "<img" not in out and 'href="javascript' not in out
    assert safe_href(" JaVa\tScript:alert(1)") is None and safe_href("/s/x/p/y") == "/s/x/p/y"


def kinds_nodes(node):
    out = [node]
    for child in node.get("content") or []:
        out += kinds_nodes(child)
    return out


def test_html_import_of_typical_markup() -> None:
    doc = html_to_pm(
        "<h2>T</h2><p>a <b>b</b><br>c</p><ul><li>x<ul><li>y</li></ul></li></ul>"
        "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>"
        '<pre><code class="language-js">let a=1</code></pre><p><img src="a.png" alt="z"></p>'
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">t</li></ul>'
    )
    names = kinds(doc)
    for expected in ("heading", "hardBreak", "bulletList", "table", "tableHeader", "codeBlock", "image", "taskList"):
        assert expected in names
    assert first(doc, "taskItem")["attrs"]["checked"] is True


@pytest.mark.parametrize("text", ["", "\x00", "# " * 5000, "- " * 3000 + "x", "> " * 500 + "x", "[" * 5000])
def test_pathological_inputs_do_not_raise(text) -> None:
    assert md_to_pm(text)["type"] == "doc"
