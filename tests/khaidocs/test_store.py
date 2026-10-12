from __future__ import annotations

import pytest

from core.khaidocs import Invalid, NotFound, TooLarge
from core.khaidocs import store as store_module
from core.khaidocs.pm_yjs import update_to_json
from core.khaidocs.text import fold, plain_text


def doc(*lines: str) -> dict:
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": line}]} for line in lines
        ],
    }


def test_default_space_created_once(store) -> None:
    first = store.ensure_default_space()
    assert first["name"] == "Private" and first["is_default"]
    assert store.ensure_default_space()["id"] == first["id"]
    assert [s["id"] for s in store.list_spaces()] == [first["id"]]
    with pytest.raises(Invalid):
        store.delete_space(first["id"])


def test_spaces_crud(store) -> None:
    space = store.create_space("Research notes")
    assert space["slug"] == "researchnotes"
    assert store.get_space("researchnotes")["id"] == space["id"]
    assert store.update_space(space["id"], name="Papers", description="d")["name"] == "Papers"
    store.delete_space(space["id"])
    with pytest.raises(NotFound):
        store.get_space(space["id"])


def test_tree_order_children_and_breadcrumbs(store) -> None:
    root = store.create_page(title="Root")
    a = store.create_page(title="A", parent_page_id=root["id"])
    b = store.create_page(title="B", parent_page_id=root["id"])
    c = store.create_page(title="C", parent_page_id=a["id"])
    roots, cursor = store.children(space_id=root["space_id"])
    assert [p["title"] for p in roots] == ["Root"] and cursor is None
    assert roots[0]["has_children"]
    kids, _ = store.children(parent_page_id=root["id"])
    assert [p["title"] for p in kids] == ["A", "B"]
    assert [p["title"] for p in store.breadcrumbs(c["id"])] == ["Root", "A", "C"]
    # move B before A, then under C
    store.move_page(b["id"], parent_page_id=root["id"], before=a["id"])
    kids, _ = store.children(parent_page_id=root["id"])
    assert [p["title"] for p in kids] == ["B", "A"]
    store.move_page(b["id"], parent_page_id=c["id"])
    assert [p["title"] for p in store.children(parent_page_id=c["id"])[0]] == ["B"]
    with pytest.raises(Invalid):
        store.move_page(root["id"], parent_page_id=c["id"])  # into its own subtree


def test_children_cursor_pagination(store) -> None:
    for i in range(5):
        store.create_page(title=f"P{i}")
    seen, cursor = [], None
    while True:
        page, cursor = store.children(space_id=store.ensure_default_space()["id"], cursor=cursor, limit=2)
        seen += [p["title"] for p in page]
        if not cursor:
            break
    assert seen == [f"P{i}" for i in range(5)]


def test_trash_restore_delete(store) -> None:
    root = store.create_page(title="Root")
    child = store.create_page(title="Child", parent_page_id=root["id"])
    store.trash_page(root["id"])
    with pytest.raises(NotFound):
        store.get_page(child["id"])
    trashed, _ = store.trash(space_id=root["space_id"])
    assert [p["title"] for p in trashed] == ["Root"]
    restored = store.restore_page(root["id"])
    assert restored["deleted_at"] is None
    assert store.get_page(child["id"])["title"] == "Child"
    store.trash_page(child["id"])
    store.trash_page(root["id"])
    # restoring the child alone while its parent is trashed makes it a root
    store.restore_page(child["id"])
    assert store.get_page(child["id"])["parent_page_id"] is None
    store.delete_page(root["id"])
    with pytest.raises(NotFound):
        store.get_page(root["id"], include_deleted=True)


def test_move_to_space_and_duplicate(store) -> None:
    other = store.create_space("Other")
    root = store.create_page(title="Root", content=doc("hello"))
    child = store.create_page(title="Child", parent_page_id=root["id"])
    copy = store.duplicate_page(root["id"])
    assert copy["title"] == "Copy of Root" and copy["id"] != root["id"]
    assert store.get_page(copy["id"])["text_content"] == "hello"
    assert [p["title"] for p in store.children(parent_page_id=copy["id"])[0]] == ["Child"]
    store.move_to_space(root["id"], other["id"])
    moved_child = store.get_page(child["id"])
    assert moved_child["space_id"] == other["id"] and moved_child["parent_page_id"] == root["id"]
    with pytest.raises(Invalid):
        store.move_to_space(root["id"], other["id"])


def test_set_content_builds_yjs_and_text(store) -> None:
    page = store.create_page(title="T")
    updated = store.set_content(page["id"], doc("Xin chào", "thế giới"))
    assert updated["text_content"] == "Xin chào\nthế giới"
    _id, state, version = store.load_ydoc(page["id"])
    assert update_to_json(state)["content"][0]["content"][0]["text"] == "Xin chào"
    assert version == updated["version"]


def test_persist_merges_external_change(store) -> None:
    from pycrdt import Doc

    from core.khaidocs.pm_yjs import json_to_ydoc, replace_content

    page = store.create_page(title="T", content=doc("one"))
    _id, state, version = store.load_ydoc(page["id"])
    live = Doc()
    live.apply_update(state)
    # An agent writes while the editor holds the document.
    store.set_content(page["id"], doc("agent"))
    # The editor's live doc types more and persists, still at the old version.
    replace_content(live, doc("typed"))
    merged, new_version = store.persist_ydoc(page["id"], live.get_update(), version)
    assert new_version > version
    assert store.get_page(page["id"])["text_content"] != ""  # converged, derived from merged state
    assert merged


def test_history_snapshots_and_cap(store, monkeypatch) -> None:
    page = store.create_page(title="T", content=doc("v1"))
    assert store.snapshot_page(page["id"]) is not None
    assert store.snapshot_page(page["id"]) is None  # unchanged
    store.set_content(page["id"], doc("v2"))
    assert store.snapshot_page(page["id"]) is not None
    items, _ = store.history(page["id"])
    assert len(items) == 2 and items[0]["version"] > items[1]["version"]
    entry = store.history_entry(items[1]["id"])
    assert plain_text(entry["content"]) == "v1"
    monkeypatch.setattr(store_module, "HISTORY_CAP", 3)
    for i in range(5):
        store.set_content(page["id"], doc(f"n{i}"))
        store.snapshot_page(page["id"])
    assert len(store.history(page["id"])[0]) == 3


def test_search_is_diacritic_and_case_insensitive(store) -> None:
    store.create_page(title="Tiếng Việt", content=doc("Hà Nội là thủ đô của Việt Nam"))
    store.create_page(title="Other", content=doc("nothing here"))
    for query in ("tieng viet", "TIẾNG", "thu do", "Hà Nội", "dô cua"):
        hits = store.search(query)
        assert [h["title"] for h in hits] == ["Tiếng Việt"], query
    assert store.search("viet nam")[0]["highlight"].count("<b>") >= 1
    assert store.search("zzz") == []
    assert store.search("nothing", title_only=True) == []
    assert fold("Đường Nguyễn Huệ") == "duong nguyen hue"
    # markup in page text is escaped in the snippet
    store.create_page(title="X", content=doc("<script>alert(1)</script> findme"))
    assert "<script>" not in store.search("findme")[0]["highlight"]


def test_favorites(store) -> None:
    page = store.create_page(title="Fav")
    space = store.ensure_default_space()
    store.add_favorite("page", page["id"])
    store.add_favorite("page", page["id"])  # idempotent
    store.add_favorite("space", space["id"])
    assert store.favorite_ids("page") == [page["id"]]
    items, _ = store.list_favorites(kind="page")
    assert items[0]["page"]["title"] == "Fav"
    store.trash_page(page["id"])
    assert store.favorite_ids("page") == []
    store.remove_favorite("space", space["id"])
    assert store.favorite_ids("space") == []


def test_attachments_and_limits(store, monkeypatch) -> None:
    page = store.create_page(title="A")
    saved = store.save_attachment(file_name="../../a b.png", data=b"\x89PNG", mime_type="image/png", page_id=page["id"])
    assert saved["file_name"] == "a b.png" and saved["file_ext"] == ".png" and saved["file_size"] == 4
    meta, data = store.read_attachment(saved["id"])
    assert data == b"\x89PNG" and meta["space_id"] == page["space_id"]
    replaced = store.save_attachment(file_name="a b.png", data=b"xy", attachment_id=saved["id"], page_id=page["id"])
    assert store.read_attachment(replaced["id"])[1] == b"xy"
    monkeypatch.setattr(store_module, "MAX_ATTACHMENT_BYTES", 10)
    with pytest.raises(TooLarge):
        store.save_attachment(file_name="big", data=b"x" * 11, page_id=page["id"])
    items, _ = store.page_attachments(page["id"])
    assert [i["id"] for i in items] == [saved["id"]]
    assert store.search_attachments("a b")[0]["page"]["id"] == page["id"]
    store.delete_page(page["id"])
    with pytest.raises(NotFound):
        store.read_attachment(saved["id"])


def test_settings_merge(store) -> None:
    store.update_settings(settings={"preferences": {"fullPageWidth": True}})
    out = store.update_settings(settings={"preferences": {"pageEditMode": "read"}}, locale="vi")
    assert out["settings"]["preferences"] == {"fullPageWidth": True, "pageEditMode": "read"}
    assert store.get_settings()["locale"] == "vi"


def test_recent_orders_by_update(store) -> None:
    a = store.create_page(title="A")
    store.create_page(title="B")
    store.update_page(a["id"], title="A2")
    items, _ = store.recent(limit=10)
    assert [p["title"] for p in items] == ["A2", "B"]
