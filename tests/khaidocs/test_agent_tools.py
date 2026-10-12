"""The agent's KhaiDocs tools, the Markdown bridge and the freshness path."""

from __future__ import annotations

import asyncio
import json

import pytest

from app_server.khaidocs import agent_events, collab
from app_server.khaidocs.api import KhaiUser
from core.agent_runtime.tools.registry import ToolRegistry
from core.harness.permissions import PermissionDecision, PermissionEngine, PermissionMode
from core.harness.tools import khaidocs as tools
from core.khaidocs import KhaiDocsStore, agent_markdown as md
from tests.khaidocs.conftest import make_user
from tests.khaidocs.harness import Api, start
from tests.khaidocs.test_collab import Provider, until

SAMPLE = """# Kế hoạch

Xin chào **đậm**, *nghiêng*, `code`, [liên kết](https://x.vn) và ~~gạch~~.

- một
- hai
  - lồng

1. đầu
2. cuối

- [ ] việc A
- [x] việc B

| Cột | Giá trị |
|---|---|
| a | 1 |

> trích dẫn

```python
print("xin chào")
```

![ảnh](/img.png)

---

## Chi tiết

Nội dung chi tiết.

### Con

Dòng con.

## Kết

Hết.
"""


def call(tool, **kwargs) -> str:
    return asyncio.run(tool.execute(**kwargs))


@pytest.fixture
def rw(store):
    return tools.KhaiDocsReadTool(lambda: store), tools.KhaiDocsWriteTool(lambda: store)


def slug(text: str) -> str:
    return text.split("[", 1)[1].split("]", 1)[0]


# -- Markdown bridge ---------------------------------------------------------


def test_markdown_round_trip_vietnamese() -> None:
    doc = md.markdown_to_pm(SAMPLE)
    again = md.markdown_to_pm(md.pm_to_markdown(doc))
    assert again == doc
    types = [n["type"] for n in doc["content"]]
    assert types == [
        "heading", "paragraph", "bulletList", "orderedList", "taskList", "table",
        "blockquote", "codeBlock", "image", "horizontalRule", "heading", "paragraph",
        "heading", "paragraph", "heading", "paragraph",
    ]
    marks = {m["type"] for n in doc["content"][1]["content"] for m in n.get("marks", [])}
    assert marks == {"bold", "italic", "code", "link", "strike"}
    task = doc["content"][4]["content"]
    assert [t["attrs"]["checked"] for t in task] == [False, True]
    assert "Xin chào **đậm**" in md.pm_to_markdown(doc)


def test_markdown_edge_cases() -> None:
    assert md.markdown_to_pm("")["content"] == [{"type": "paragraph"}]
    odd = md.markdown_to_pm("snake_case a*b 1 < 2 | x")
    assert md.pm_to_markdown(md.markdown_to_pm(md.pm_to_markdown(odd))) == md.pm_to_markdown(odd)
    assert md.pm_to_markdown({"type": "doc", "content": [
        {"type": "callout", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "tip"}]}]}
    ]}) == "tip"


def test_sections() -> None:
    doc = md.markdown_to_pm(SAMPLE)
    assert md.section_markdown(doc, "chi tiet").startswith("## Chi tiết")  # diacritics ignored
    assert "Dòng con." in md.section_markdown(doc, "Chi tiết")
    assert "Hết" not in md.section_markdown(doc, "Chi tiết")
    new = md.replace_section(doc, "Chi tiết", "Mới hoàn toàn.")
    out = md.pm_to_markdown(new)
    assert "## Chi tiết\n\nMới hoàn toàn." in out and "Dòng con" not in out and "## Kết" in out
    assert md.replace_section(doc, "không có", "x") is None
    assert [h[1] for h in md.outline(doc)] == ["Kế hoạch", "Chi tiết", "Con", "Kết"]


# -- registration, schema, permissions ---------------------------------------


def test_registration_requires_a_store(monkeypatch, store) -> None:
    assert tools.khaidocs_tools(None) == ()
    monkeypatch.delenv("KHAI_DATABASE_URL", raising=False)
    assert tools.default_store() is None
    assert [t.name for t in tools.khaidocs_tools(store)] == ["khaidocs_read", "khaidocs_write"]


def test_default_store_unbound_in_multi_user_mode(monkeypatch) -> None:
    monkeypatch.setenv("KHAI_MULTI_USER", "1")
    monkeypatch.delenv("KHAI_USER_ID", raising=False)
    assert tools.default_store() is None


def test_token_budget(rw) -> None:
    sizes = []
    for tool in rw:
        text = json.dumps(tool.parameters) + tool.description
        sizes.append(len(text))
        assert len(tool.description) <= 560
    # ~4 chars per token: both definitions together stay under ~500 tokens.
    assert sum(sizes) <= 2000, sizes


def test_permission_classes(rw) -> None:
    read, write = rw
    assert read.read_only and read.concurrency_safe
    assert not write.read_only and not write.concurrency_safe
    registry = ToolRegistry()
    for tool in rw:
        registry.register(tool)
    assert registry.read_only_tool_names == frozenset({"khaidocs_read"})
    engine = PermissionEngine(mode=PermissionMode.DEFAULT)
    engine.read_only_tools = engine.read_only_tools.union(registry.read_only_tool_names)
    assert engine.evaluate("khaidocs_read", {"action": "read"})[0] is PermissionDecision.ALLOW
    assert engine.evaluate("khaidocs_write", {"action": "create"})[0] is PermissionDecision.ASK
    plan = PermissionEngine(mode=PermissionMode.PLAN, read_only_tools=engine.read_only_tools)
    assert plan.evaluate("khaidocs_write", {"action": "trash"})[0] is not PermissionDecision.ALLOW


# -- actions -----------------------------------------------------------------


def test_create_read_search_tree(rw, store) -> None:
    read, write = rw
    made = call(write, action="create", title="Kế hoạch", markdown=SAMPLE)
    assert made.startswith("Created Kế hoạch [")
    ref = slug(made)
    page = store.get_page(ref)
    assert page["updated_by"] == "agent"
    # the duplicated H1 was dropped
    assert page["content"]["content"][0]["type"] == "paragraph"
    child = call(write, action="create", title="Con trang", markdown="Nội dung con", parent=ref)
    assert store.get_page(slug(child))["parent_page_id"] == page["id"]

    text = call(read, action="read", page=ref)
    assert text.startswith("Kế hoạch [") and "Xin chào **đậm**" in text
    assert call(read, action="read", page=ref, section="chi tiet").count("Nội dung chi tiết.") == 1
    missing = call(read, action="read", page=ref, section="nope")
    assert missing.startswith("Error: no section") and "Chi tiết" in missing

    found = call(read, action="search", query="noi dung con")
    assert "Con trang" in found and ref not in found.split("\n")[0]
    assert call(read, action="search", query="zzzqqq") == 'No pages match "zzzqqq".'
    outline = call(read, action="tree")
    assert f"- Kế hoạch [{ref}]" in outline and f"  - Con trang [{slug(child)}]" in outline
    assert call(read, action="tree", page=ref).startswith("- Con trang")


def test_edit_actions_merge_and_snapshot(rw, store) -> None:
    read, write = rw
    ref = slug(call(write, action="create", title="Ghi chú", markdown="## A\n\nmột\n\n## B\n\nhai"))
    assert call(write, action="append", page=ref, markdown="ba").startswith("Appended to")
    assert md.pm_to_markdown(store.get_page(ref)["content"]).endswith("hai\n\nba")
    assert call(write, action="replace_section", page=ref, section="A", markdown="mới").startswith("Replaced section")
    body = md.pm_to_markdown(store.get_page(ref)["content"])
    assert "## A\n\nmới" in body and "một" not in body and "## B" in body
    assert call(write, action="replace_section", page=ref, section="Z", markdown="x").startswith("Error: no section")
    assert call(write, action="update", page=ref, markdown="# Tất cả mới").startswith("Replaced the body")
    assert md.pm_to_markdown(store.get_page(ref)["content"]) == "# Tất cả mới"
    items, _ = store.history(ref)
    assert len(items) >= 2  # snapshots taken before the agent's edits
    assert call(write, action="rename", page=ref, title="Tên mới").startswith("Renamed to Tên mới")
    assert call(write, action="update", page=ref, markdown="  ").startswith("Error: markdown is required")
    store.update_page(ref, is_locked=True)
    assert "locked" in call(write, action="update", page=ref, markdown="x")


def test_move_trash_restore_never_delete(rw, store) -> None:
    read, write = rw
    a = slug(call(write, action="create", title="A"))
    b = slug(call(write, action="create", title="B"))
    assert "under" in call(write, action="move", page=b, parent=a)
    assert store.get_page(b)["parent_page_id"] == store.get_page(a)["id"]
    assert "top level" in call(write, action="move", page=b, parent="root")
    assert call(write, action="move", page=b).startswith("Error: parent is required")
    assert call(write, action="move", page=a, parent=a).startswith("Error")

    assert "trash" in call(write, action="trash", page=a)
    row = store.get_page(a, include_deleted=True)  # still stored, only marked
    assert row["deleted_at"] is not None
    assert f"[{a}]" in call(read, action="trash")
    assert f"[{a}]" not in call(read, action="tree")
    assert call(read, action="read", page=a).startswith("Error: Page not found")
    assert "delete" not in write.parameters["properties"]["action"]["enum"]
    assert call(write, action="delete", page=a).startswith("Error: action must be")
    assert call(write, action="restore", page=a).startswith("Restored")
    assert store.get_page(a)["deleted_at"] is None


def test_read_truncates_with_hint(rw, store) -> None:
    read, write = rw
    long = "## Một\n\n" + "\n\n".join(f"đoạn {i} " + "x" * 80 for i in range(200)) + "\n\n## Hai\n\nđuôi"
    ref = slug(call(write, action="create", title="Dài", markdown=long))
    text = call(read, action="read", page=ref, max_chars=1000)
    assert "truncated" in text and "section=" in text and "Một | Hai" in text
    assert len(text) < 1500
    assert "đuôi" in call(read, action="read", page=ref, section="Hai", max_chars=1000)
    assert "truncated" not in call(read, action="read", page=ref, max_chars=30000)


def test_bad_arguments_are_errors_not_crashes(rw) -> None:
    read, write = rw
    assert call(read, action="read").startswith("Error: page is required")
    assert call(read, action="search").startswith("Error: query is required")
    assert call(read, action="nope").startswith("Error: action must be")
    assert call(write, action="create").startswith("Error: title is required")
    assert call(read, action="read", page="doesnotexist").startswith("Error: Page not found")
    assert call(read, action="tree", space="no-such").startswith("Error: unknown space")


def test_two_users_are_isolated(two_stores) -> None:
    alice, bob = two_stores
    a_write = tools.KhaiDocsWriteTool(lambda: alice)
    b_read = tools.KhaiDocsReadTool(lambda: bob)
    b_write = tools.KhaiDocsWriteTool(lambda: bob)
    ref = slug(call(a_write, action="create", title="Bí mật", markdown="mật khẩu của alice"))
    assert call(b_read, action="read", page=ref).startswith("Error: Page not found")
    assert call(b_read, action="search", query="alice") == 'No pages match "alice".'
    assert call(b_read, action="tree") == "No pages yet."
    assert call(b_write, action="trash", page=ref).startswith("Error: Page not found")
    assert call(b_write, action="update", page=ref, markdown="x").startswith("Error: Page not found")
    assert alice.get_page(ref)["deleted_at"] is None


# -- freshness ---------------------------------------------------------------


@pytest.fixture
def users(base):
    return {n: KhaiUser(make_user(base, n), n, n.title(), "member") for n in ("alice",)}


def test_worker_side_write_reaches_open_editor_and_tabs(base, users, monkeypatch) -> None:
    monkeypatch.setattr(collab, "DEBOUNCE", 0.1)
    monkeypatch.setattr(collab, "MAX_WAIT", 0.5)
    monkeypatch.setattr(collab, "EXTERNAL_POLL", 30.0)  # only the NOTIFY path can be fast enough
    monkeypatch.setattr(agent_events, "RECONNECT_SECONDS", 0.2)

    async def scenario():
        client, ctx = await start(base, users)
        events: list[dict] = []
        real = ctx.sockets.publish
        ctx.sockets.publish = lambda user, event, **kw: (events.append(event), real(user, event, **kw))
        try:
            api = Api(client, "alice")
            space = (await api.post("spaces"))["items"][0]
            page = await api.post("pages/create", {"spaceId": space["id"], "title": "T"})
            editor = await Provider(client, "alice", page["id"]).connect()
            await asyncio.wait_for(editor.synced.wait(), 5)
            editor.type("gõ tay")
            gateway_store = ctx.store_for(users["alice"])
            await until(lambda: gateway_store.get_page(page["id"])["text_content"] == "gõ tay")
            # a "worker": its own Database object (separate pool user binding), same role
            worker = KhaiDocsStore(base.for_user(users["alice"].id))
            write = tools.KhaiDocsWriteTool(lambda: worker)
            # the listener connects asynchronously; wait for a socket to exist
            await asyncio.sleep(0.3)
            ws = await client.ws_connect("/socket.io/?EIO=4&transport=websocket", headers={"X-Test-User": "alice"})
            await ws.receive()
            await ws.send_str("40")
            await ws.receive()
            out = await write.execute(action="append", page=page["id"], markdown="từ agent")
            assert out.startswith("Appended")
            await until(lambda: "từ agent" in editor.text(), seconds=5)
            assert "gõ tay" in editor.text()  # live typing survived the merge
            await until(lambda: any(e.get("entity") == ["pages"] for e in events))
            created = await write.execute(action="create", title="Mới")
            assert created.startswith("Created")
            frame = None
            for _ in range(20):
                msg = await asyncio.wait_for(ws.receive(), 5)
                if "root-sidebar-pages" in msg.data:
                    frame = msg.data
                    break
            assert frame and frame.startswith('42["message",{"operation":"invalidate"')
            await ws.close()
            await editor.close()
        finally:
            await client.close()

    asyncio.run(asyncio.wait_for(scenario(), 60))


def test_agent_event_payloads_are_validated() -> None:
    sent = []

    class Sockets:
        def count(self, user):
            return 1

        def publish(self, user, event, **kw):
            sent.append((user, event))

    class Ctx:
        sockets = Sockets()
        collab = None

    for bad in ("not json", "{}", '{"u": "nope"}', "[1]"):
        asyncio.run(agent_events._handle(Ctx, bad))
    assert sent == []
    user = "11111111-1111-1111-1111-111111111111"
    asyncio.run(agent_events._handle(Ctx, json.dumps({"u": user, "op": "trash", "s": "S", "p": "P", "g": "G"})))
    kinds = [e["entity"] for _u, e in sent]
    assert ["root-sidebar-pages"] in kinds and ["trash-list"] in kinds and ["pages"] in kinds
