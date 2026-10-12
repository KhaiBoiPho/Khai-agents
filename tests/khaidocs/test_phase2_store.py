"""Phase 2 stores against the database: comments, labels, notifications,
watches, backlinks, templates, file tasks, and isolation between users."""

from __future__ import annotations

import json

import pytest

from core.khaidocs import KhaiDocsStore
from core.khaidocs.backlinks import BacklinkStore, extract_refs
from core.khaidocs.comments import CommentStore, mentioned_user_ids
from core.khaidocs.errors import Invalid, NotFound
from core.khaidocs.labels import LabelStore, normalize
from core.khaidocs.notifications import NotificationStore, add_listener, remove_listener
from core.khaidocs.templates import FileTaskStore, TemplateStore, fill_placeholders


def doc(*lines):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in lines]}


def body(text: str, mention: str | None = None) -> str:
    content = [{"type": "text", "text": text}]
    if mention:
        content.append({"type": "mention", "attrs": {"entityType": "user", "entityId": mention, "label": "me"}})
    return json.dumps({"type": "doc", "content": [{"type": "paragraph", "content": content}]})


@pytest.fixture
def alice_bob(two_stores):
    return two_stores


def test_comment_threads_and_resolve(store: KhaiDocsStore) -> None:
    page = store.create_page(title="P")
    comments = CommentStore(store.database)
    top = comments.create(page["id"], body("hi"), selection="chọn", kind="inline",
                          yjs_selection={"anchor": 1, "head": 2})
    assert top["selection"] == "chọn" and top["yjs_selection"] == {"anchor": 1, "head": 2}
    reply = comments.create(page["id"], body("re"), parent_comment_id=top["id"])
    nested = comments.create(page["id"], body("re re"), parent_comment_id=reply["id"])
    assert nested["parent_comment_id"] == top["id"]  # replies attach to the thread root
    items, nxt = comments.list(page["id"])
    assert [c["id"] for c in items] == [top["id"], reply["id"], nested["id"]] and nxt is None
    first, cursor = comments.list(page["id"], limit=2)
    rest, end = comments.list(page["id"], cursor=cursor, limit=2)
    assert [c["id"] for c in first + rest] == [top["id"], reply["id"], nested["id"]] and end is None
    assert comments.resolve(top["id"], True)["resolved_at"] is not None
    assert comments.resolve(top["id"], False)["resolved_at"] is None
    with pytest.raises(Invalid):
        comments.resolve(reply["id"], True)
    edited = comments.update(reply["id"], body("edited"))
    assert edited["edited_at"] is not None and "edited" in edited["content"]
    comments.delete(top["id"])  # the thread takes its replies with it
    assert comments.list(page["id"])[0] == []
    with pytest.raises(NotFound):
        comments.get(reply["id"])
    with pytest.raises(Invalid):
        comments.create(page["id"], "   ")


def test_comment_validation_and_mentions(store: KhaiDocsStore) -> None:
    page = store.create_page(title="P")
    other = store.create_page(title="Q")
    comments = CommentStore(store.database)
    top = comments.create(other["id"], body("x"))
    with pytest.raises(NotFound):  # a parent on another page
        comments.create(page["id"], body("y"), parent_comment_id=top["id"])
    with pytest.raises(NotFound):
        comments.create("00000000-0000-0000-0000-000000000000", body("z"))
    assert mentioned_user_ids(body("a", "u1")) == ["u1"]
    assert mentioned_user_ids("not json") == []


def test_notification_fan_out_rules(store: KhaiDocsStore) -> None:
    page = store.create_page(title="P")
    me = store.database.user_id
    comments, notes = CommentStore(store.database), NotificationStore(store.database)
    seen = []

    def listener(user_id, row):
        seen.append((user_id, row["type"]))

    add_listener(listener)
    try:
        own = comments.create(page["id"], body("mine"))
        assert notes.on_comment(own) == []  # your own comment tells nobody
        mention = comments.create(page["id"], body("hey", me))
        made = notes.on_comment(mention)
        assert [n["type"] for n in made] == ["comment.user_mention"]
        agent = comments.create(page["id"], body("from agent"), author="agent")
        made = notes.on_comment(agent)
        assert [n["type"] for n in made] == ["comment.created"] and made[0]["actor"] == "agent"
        assert made[0]["page"]["slug_id"] == page["slug_id"] and made[0]["space"]["slug"]
        assert notes.on_comment_resolved(agent, actor="user", resolved=True) == []
        assert notes.on_comment_resolved(agent, actor="agent", resolved=True)[0]["type"] == "comment.resolved"
        # page.updated only for watched pages and never for your own edits
        assert notes.on_page_updated(page["id"], actor="agent") == []
        notes.watch_page(page["id"])
        assert notes.is_watching_page(page["id"])
        assert notes.on_page_updated(page["id"], actor="user") == []
        assert notes.on_page_updated(page["id"], actor="agent")[0]["type"] == "page.updated"
    finally:
        remove_listener(listener)
    assert [t for _, t in seen] == ["comment.user_mention", "comment.created", "comment.resolved", "page.updated"]
    assert {u for u, _ in seen} == {me}
    assert notes.unread_count() == 4
    direct, _ = notes.list(tab="direct")
    updates, _ = notes.list(tab="updates")
    assert len(direct) == 3 and [n["type"] for n in updates] == ["page.updated"]
    notes.mark_read([updates[0]["id"]])
    assert notes.unread_count() == 3
    assert [n["type"] for n in notes.list(unread_only=True)[0]].count("page.updated") == 0
    page1, cursor = notes.list(limit=3)
    page2, end = notes.list(cursor=cursor, limit=3)
    assert len(page1) == 3 and len(page2) == 1 and end is None
    assert notes.mark_all_read() == 3 and notes.unread_count() == 0
    notes.unwatch_page(page["id"])
    assert not notes.is_watching_page(page["id"])


def test_notification_removed_with_its_comment_and_page(store: KhaiDocsStore) -> None:
    page = store.create_page(title="P")
    comments, notes = CommentStore(store.database), NotificationStore(store.database)
    agent = comments.create(page["id"], body("a"), author="agent")
    notes.on_comment(agent)
    assert notes.unread_count() == 1
    comments.delete(agent["id"])
    assert notes.unread_count() == 0
    with pytest.raises(Invalid):
        notes.notify("nope")


def test_space_watch(store: KhaiDocsStore) -> None:
    notes = NotificationStore(store.database)
    space = store.ensure_default_space()
    assert not notes.is_watching_space(space["id"])
    notes.watch_space(space["id"])
    notes.watch_space(space["id"])
    assert notes.watched_space_ids() == [space["id"]]
    notes.unwatch_space(space["id"])
    assert notes.watched_space_ids() == []
    with pytest.raises(NotFound):
        notes.watch_page("00000000-0000-0000-0000-000000000000")


def test_labels(store: KhaiDocsStore) -> None:
    a, b = store.create_page(title="A"), store.create_page(title="B")
    labels = LabelStore(store.database)
    assert normalize("  Việt  Nam  ") == "việt-nam"
    got = labels.add_to_page(a["id"], ["Việt Nam", "todo", "todo"])
    assert [x["name"] for x in got] == ["todo", "việt-nam"]
    labels.add_to_page(b["id"], ["todo"])
    found, _ = labels.search("page", query="viet")  # not diacritic-folded: exact substring
    assert found == []
    found, _ = labels.search("page", query="việt")
    assert [x["name"] for x in found] == ["việt-nam"]
    assert [x["name"] for x in labels.search("page")[0]] == ["todo", "việt-nam"]
    assert labels.info("TODO") == {"name": "todo", "usage_count": 2}
    todo = next(x for x in got if x["name"] == "todo")
    pages, _ = labels.pages(label_id=todo["id"])
    assert {p["id"] for p in pages} == {a["id"], b["id"]}
    assert [x["name"] for x in pages[0]["labels"]] and pages[0]["space"]["slug"]
    only_a, _ = labels.pages(name="việt-nam")
    assert [p["id"] for p in only_a] == [a["id"]]
    store.trash_page(b["id"])
    assert labels.info("todo")["usage_count"] == 1
    labels.remove_from_page(a["id"], todo["id"])
    assert [x["name"] for x in labels.page_labels(a["id"])] == ["việt-nam"]
    labels.remove_from_page(b["id"], todo["id"])
    assert "todo" not in [x["name"] for x in labels.search("page")[0]]  # unused labels disappear
    with pytest.raises(Invalid):
        labels.add_to_page(a["id"], ["  "])
    with pytest.raises(Invalid):
        labels.add_to_page(a["id"], ["x" * 101])
    with pytest.raises(NotFound):
        labels.add_to_page("00000000-0000-0000-0000-000000000000", ["x"])


def test_backlinks_follow_content(store: KhaiDocsStore) -> None:
    target = store.create_page(title="Target")
    other = store.create_page(title="Other")
    source = store.create_page(title="Source")
    links = BacklinkStore(store.database)
    content = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "mention", "attrs": {"entityType": "page", "entityId": target["id"], "slugId": target["slug_id"]}},
        {"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {
            "href": f"https://khai.example/s/private/p/trang-dich-{other['slug_id']}?q=1"}}]},
        {"type": "text", "text": "y", "marks": [{"type": "link", "attrs": {"href": "https://example.com/p/abcdefghij"}}]},
    ]}]}
    store.set_content(source["id"], content)
    assert links.counts(target["id"]) == {"incoming": 1, "outgoing": 0}
    assert links.counts(source["id"]) == {"incoming": 0, "outgoing": 2}
    incoming, _ = links.list(target["id"], "incoming")
    assert [p["id"] for p in incoming] == [source["id"]] and incoming[0]["space"]["slug"]
    outgoing, _ = links.list(source["id"], "outgoing")
    assert {p["id"] for p in outgoing} == {target["id"], other["id"]}
    store.set_content(source["id"], doc("no links now"))  # an edit drops the links
    assert links.counts(source["id"])["outgoing"] == 0
    store.set_content(source["id"], content)
    store.trash_page(source["id"])  # a trashed page is not a backlink
    assert links.counts(target["id"])["incoming"] == 0
    store.restore_page(source["id"])
    assert links.counts(target["id"])["incoming"] == 1
    self_link = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "mention", "attrs": {"entityType": "page", "entityId": source["id"]}}]}]}
    store.set_content(source["id"], self_link)
    assert links.counts(source["id"]) == {"incoming": 0, "outgoing": 0}
    ids, slugs = extract_refs(content)
    assert target["id"] in ids and other["slug_id"] in slugs


def test_templates_and_placeholders(store: KhaiDocsStore) -> None:
    templates = TemplateStore(store.database)
    row = templates.create(title="  Họp  ", description="d", icon="ti:x", markdown="# Họp {{date}}\n")
    assert row["title"] == "Họp" and templates.get(row["id"])["markdown"].startswith("# Họp")
    assert templates.update(row["id"], description="mới")["description"] == "mới"
    assert [t["id"] for t in templates.list()[0]] == [row["id"]]
    assert fill_placeholders({"a": ["x {{ date }}", 1]})["a"][0] != "x {{ date }}"
    templates.delete(row["id"])
    with pytest.raises(NotFound):
        templates.get(row["id"])
    with pytest.raises(Invalid):
        templates.create(title="x")


def test_file_task_lifecycle(store: KhaiDocsStore) -> None:
    tasks = FileTaskStore(store.database)
    space = store.ensure_default_space()
    task = tasks.create(kind="import", source="generic", file_name="a.zip", file_size=3,
                        space_id=space["id"], data=b"abc")
    assert task["status"] == "pending" and task["file_ext"] == "zip"
    tasks.update(task["id"], status="processing", progress={"done": 1, "total": 4})
    assert tasks.get(task["id"])["options"]["progress"] == {"done": 1, "total": 4}
    assert tasks.load_data(task["id"]) == b"abc"
    tasks.update(task["id"], status="success", result={"pages": 4}, drop_data=True)
    done = tasks.get(task["id"])
    assert done["status"] == "success" and done["options"]["result"] == {"pages": 4}
    with pytest.raises(NotFound):
        tasks.load_data(task["id"])
    stuck = tasks.create(kind="import", source=None, file_name="b.zip", file_size=1,
                         space_id=space["id"], data=b"x")
    assert tasks.fail_stale() == 1
    assert tasks.get(stuck["id"])["status"] == "failed" and "restart" in tasks.get(stuck["id"])["error_message"]
    assert len(tasks.list()[0]) == 2
    tasks.delete(task["id"])
    assert [t["id"] for t in tasks.list()[0]] == [stuck["id"]]


def test_everything_is_isolated_between_users(alice_bob) -> None:
    alice, bob = alice_bob
    page = alice.create_page(title="Private")
    comment = CommentStore(alice.database).create(page["id"], body("secret"), author="agent")
    NotificationStore(alice.database).on_comment(comment)
    LabelStore(alice.database).add_to_page(page["id"], ["mine"])
    NotificationStore(alice.database).watch_page(page["id"])
    template = TemplateStore(alice.database).create(title="T", markdown="x")
    task = FileTaskStore(alice.database).create(
        kind="import", source=None, file_name="a.zip", file_size=1,
        space_id=alice.ensure_default_space()["id"], data=b"x")
    b = bob.database
    with pytest.raises(NotFound):
        CommentStore(b).get(comment["id"])
    with pytest.raises(NotFound):
        CommentStore(b).list(page["id"])
    with pytest.raises(NotFound):
        CommentStore(b).create(page["id"], body("x"))
    assert NotificationStore(b).unread_count() == 0 and NotificationStore(b).list()[0] == []
    assert NotificationStore(b).mark_all_read() == 0
    assert not NotificationStore(b).is_watching_page(page["id"])
    with pytest.raises(NotFound):
        NotificationStore(b).watch_page(page["id"])
    assert LabelStore(b).search("page")[0] == [] and LabelStore(b).page_labels(page["id"]) == []
    with pytest.raises(NotFound):
        LabelStore(b).add_to_page(page["id"], ["x"])
    assert LabelStore(b).info("mine")["usage_count"] == 0
    assert BacklinkStore(b).counts(page["id"]) == {"incoming": 0, "outgoing": 0}
    with pytest.raises(NotFound):
        TemplateStore(b).get(template["id"])
    assert TemplateStore(b).list()[0] == []
    with pytest.raises(NotFound):
        FileTaskStore(b).get(task["id"])
    assert FileTaskStore(b).fail_stale() == 0
    assert FileTaskStore(alice.database).get(task["id"])["status"] == "pending"
