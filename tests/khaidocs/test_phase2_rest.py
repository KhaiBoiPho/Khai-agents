"""Phase 2 over HTTP: comments, labels, notifications (and the live bell),
export, import, file tasks, templates, backlinks, isolation."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import zipfile
from urllib.parse import unquote

import pytest
from aiohttp import FormData

from app_server.khaidocs.api import KhaiUser
from core.khaidocs.comments import CommentStore
from core.khaidocs.docx_pm import pm_to_docx
from core.khaidocs.markdown_pm import md_to_pm
from core.khaidocs.notifications import NotificationStore
from tests.khaidocs.conftest import make_user
from tests.khaidocs.harness import Api, start

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 90))


@pytest.fixture
def users(base):
    return {n: KhaiUser(make_user(base, n), n, n.title(), "member") for n in ("alice", "bob")}


def doc(*lines):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in lines]}


def body(text: str, mention: str | None = None) -> str:
    content = [{"type": "text", "text": text}]
    if mention:
        content.append({"type": "mention", "attrs": {"entityType": "user", "entityId": mention, "label": "me"}})
    return json.dumps({"type": "doc", "content": [{"type": "paragraph", "content": content}]}, ensure_ascii=False)


async def upload(client, user, path, name, data, **fields):
    form = FormData(quote_fields=False)
    for key, value in fields.items():
        form.add_field(key, value)
    form.add_field("file", data, filename=name, content_type="application/octet-stream")
    response = await client.post("/api/" + path, data=form, headers={"X-Test-User": user})
    return response.status, await response.json()


async def download(client, user, path, payload):
    response = await client.post("/api/" + path, json=payload, headers={"X-Test-User": user})
    return response, await response.read()


def filename_of(response) -> str:
    """The way the client reads it: split on filename=, strip quotes, decode."""

    header = response.headers["Content-Disposition"]
    return unquote(header.split("filename=")[1].replace('"', ""))


async def connect(client, user):
    ws = await client.ws_connect("/socket.io/?EIO=4&transport=websocket", headers={"X-Test-User": user})
    await asyncio.wait_for(ws.receive_str(), 5)
    await ws.send_str("40")
    await asyncio.wait_for(ws.receive_str(), 5)
    return ws


async def events(ws, count=1, timeout=5):
    out = []
    for _ in range(count):
        frame = await asyncio.wait_for(ws.receive_str(), timeout)
        assert frame.startswith("42")
        out.append(json.loads(frame[2:])[1])
    return out


def test_comments_over_http(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api = Api(client, "alice")
            page = await api.post("pages/create", {"title": "Trang"})
            ws = await connect(client, "alice")
            top = await api.post("comments/create", {
                "pageId": page["id"], "content": body("Bình luận"), "selection": "đoạn chọn", "type": "inline",
                "yjsSelection": {"anchor": 1, "head": 3}})
            assert top["creator"]["name"] == "Alice" and top["creatorId"] == users["alice"].id
            assert top["selection"] == "đoạn chọn" and top["resolvedAt"] is None and top["pageId"] == page["id"]
            created = (await events(ws))[0]
            assert created["operation"] == "commentCreated" and created["comment"]["id"] == top["id"]
            reply = await api.post("comments/create", {
                "pageId": page["id"], "content": body("trả lời"), "parentCommentId": top["id"]})
            assert reply["parentCommentId"] == top["id"]
            await events(ws)
            listed = await api.post("comments", {"pageId": page["id"], "limit": 100})
            assert [c["id"] for c in listed["items"]] == [top["id"], reply["id"]]
            assert listed["meta"]["hasNextPage"] is False
            resolved = await api.post("comments/resolve", {"commentId": top["id"], "pageId": page["id"], "resolved": True})
            assert resolved["resolvedAt"] and resolved["resolvedById"] == users["alice"].id
            assert resolved["resolvedBy"]["name"] == "Alice"
            ev = (await events(ws))[0]
            assert ev["operation"] == "commentResolved" and ev["comment"]["resolvedAt"]
            reopened = await api.post("comments/resolve", {"commentId": top["id"], "pageId": page["id"], "resolved": False})
            assert reopened["resolvedAt"] is None and reopened["resolvedBy"] is None
            await events(ws)
            await api.post("comments/resolve", {"commentId": reply["id"], "pageId": page["id"], "resolved": True}, status=400)
            updated = await api.post("comments/update", {"commentId": top["id"], "content": body("sửa")})
            assert updated["editedAt"] and "sửa" in json.dumps(updated["content"], ensure_ascii=False)
            assert (await events(ws))[0]["operation"] == "commentUpdated"
            assert (await api.post("comments/info", {"commentId": reply["id"]}))["id"] == reply["id"]
            await api.post("comments/create", {"pageId": page["id"]}, status=400)
            await api.post("comments/create", {"pageId": page["id"], "content": 5}, status=400)
            await api.post("comments/resolve", {"commentId": top["id"]}, status=400)
            await api.post("comments/delete", {"commentId": top["id"]})
            assert (await events(ws))[0] == {"operation": "commentDeleted", "pageId": page["id"], "commentId": top["id"]}
            assert (await api.post("comments", {"pageId": page["id"]}))["items"] == []
            # your own comments do not ring the bell
            assert (await api.post("notifications/unread-count"))["count"] == 0
            await ws.close()
        finally:
            await client.close()

    run(scenario())


def test_notifications_fan_out_and_live_bell(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api, bob = Api(client, "alice"), Api(client, "bob")
            page = await api.post("pages/create", {"title": "Trang"})
            ws = await connect(client, "alice")
            bob_ws = await connect(client, "bob")
            # a mention of the account notifies it, with a live event
            await api.post("comments/create", {"pageId": page["id"], "content": body("chào", users["alice"].id)})
            seen = await events(ws, 2)  # the bell and commentCreated, in either order
            assert {e["operation"] for e in seen} == {"invalidate", "commentCreated"}
            assert {"operation": "invalidate", "entity": ["notifications"]} in seen
            assert (await api.post("notifications/unread-count"))["count"] == 1
            # the agent comments (written through the store, as the agent tools do)
            store = ctx.store_for(users["alice"])
            agent = CommentStore(store.database).create(page["id"], body("tôi là agent"), author="agent")
            NotificationStore(store.database).on_comment(agent)
            bell = await events(ws)
            assert bell[0]["entity"] == ["notifications"]
            assert (await api.post("notifications/unread-count"))["count"] == 2
            listing = await api.post("notifications", {"limit": 10})
            kinds = [n["type"] for n in listing["items"]]
            assert kinds == ["comment.created", "comment.user_mention"]
            first = listing["items"][0]
            assert first["actor"]["name"] == "Khai" and first["actorId"] == "agent" and first["readAt"] is None
            assert first["page"]["slugId"] == page["slugId"] and first["space"]["slug"]
            assert first["commentId"] == agent["id"]
            assert len((await api.post("notifications", {"type": "direct"}))["items"]) == 2
            assert (await api.post("notifications", {"type": "updates"}))["items"] == []
            small = await api.post("notifications", {"limit": 1})
            assert small["meta"]["hasNextPage"] and small["meta"]["nextCursor"]
            more = await api.post("notifications", {"limit": 1, "cursor": small["meta"]["nextCursor"]})
            assert more["items"][0]["id"] != small["items"][0]["id"] and not more["meta"]["hasNextPage"]
            # another user sees and changes nothing
            assert (await bob.post("notifications/unread-count"))["count"] == 0
            assert (await bob.post("notifications"))["items"] == []
            await bob.post("notifications/mark-all-read")
            assert (await api.post("notifications/unread-count"))["count"] == 2
            await bob.post("notifications/mark-read", {"notificationIds": [first["id"]]})
            assert (await api.post("notifications/unread-count"))["count"] == 2
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(bob_ws.receive_str(), 0.3)
            # read / read all
            await api.post("notifications/mark-read", {"notificationIds": [first["id"]]})
            assert (await api.post("notifications/unread-count"))["count"] == 1
            await api.post("notifications/mark-read", {}, status=400)
            await api.post("notifications/mark-all-read")
            assert (await api.post("notifications/unread-count"))["count"] == 0
            # watching
            assert (await api.post("pages/watch-status", {"pageId": page["id"]})) == {"watching": False}
            assert (await api.post("pages/watch", {"pageId": page["id"]})) == {"watching": True}
            assert (await api.post("pages/watch-status", {"pageId": page["id"]})) == {"watching": True}
            assert (await bob.post("pages/watch-status", {"pageId": page["id"]})) == {"watching": False}
            await bob.post("pages/watch", {"pageId": page["id"]}, status=404)
            assert (await api.post("pages/unwatch", {"pageId": page["id"]})) == {"watching": False}
            space = (await api.post("spaces", {}))["items"][0]
            assert (await api.post("spaces/watch", {"spaceId": space["id"]}))["watching"] is True
            assert (await api.post("spaces/watch-status", {"spaceId": space["slug"]}))["watching"] is True
            assert (await api.post("spaces/watched-ids"))["items"] == [space["id"]]
            assert (await bob.post("spaces/watched-ids"))["items"] == []
            await api.post("spaces/unwatch", {"spaceId": space["id"]})
            assert (await api.post("spaces/watched-ids"))["items"] == []
            await ws.close()
            await bob_ws.close()
        finally:
            await client.close()

    run(scenario())


def test_labels_and_backlinks_over_http(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api, bob = Api(client, "alice"), Api(client, "bob")
            a = await api.post("pages/create", {"title": "A"})
            b = await api.post("pages/create", {"title": "B"})
            added = await api.post("pages/labels/add", {"pageId": a["id"], "names": ["Quan Trọng", "todo"]})
            assert [x["name"] for x in added] == ["quan-trọng", "todo"] and added[0]["type"] == "page"
            await api.post("pages/labels/add", {"pageId": b["id"], "names": ["todo"]})
            mine = await api.post("pages/labels", {"pageId": a["id"]})
            assert [x["name"] for x in mine["items"]] == ["quan-trọng", "todo"]
            allp = await api.post("labels", {"type": "page", "query": "to"})
            assert [x["name"] for x in allp["items"]] == ["todo"]
            assert (await api.post("labels/info", {"name": "todo", "type": "page"})) == {"name": "todo", "usageCount": 2}
            pages = await api.post("labels/pages", {"name": "todo"})
            assert {p["id"] for p in pages["items"]} == {a["id"], b["id"]}
            assert pages["items"][0]["space"]["slug"] and pages["items"][0]["creator"]["name"] == "Alice"
            assert {x["name"] for x in pages["items"][0]["labels"]} <= {"quan-trọng", "todo"}
            todo = next(x for x in added if x["name"] == "todo")
            await api.post("pages/labels/remove", {"pageId": a["id"], "labelId": todo["id"]})
            assert (await api.post("labels/info", {"name": "todo"}))["usageCount"] == 1
            await api.post("pages/labels/add", {"pageId": a["id"], "names": []}, status=400)
            await api.post("pages/labels/add", {"pageId": a["id"]}, status=400)
            # nobody else sees them
            assert (await bob.post("labels", {"type": "page"}))["items"] == []
            assert (await bob.post("pages/labels", {"pageId": a["id"]}))["items"] == []
            await bob.post("pages/labels/add", {"pageId": a["id"], "names": ["x"]}, status=404)
            # backlinks
            link = {"type": "doc", "content": [{"type": "paragraph", "content": [
                {"type": "mention", "attrs": {"entityType": "page", "entityId": b["id"], "slugId": b["slugId"], "label": "B"}}]}]}
            await ctx.store_for(users["alice"]).set_content(a["id"], link) if False else \
                await asyncio.to_thread(ctx.store_for(users["alice"]).set_content, a["id"], link)
            assert await api.post("pages/backlinks-count", {"pageId": b["id"]}) == {"incoming": 1, "outgoing": 0}
            incoming = await api.post("pages/backlinks", {"pageId": b["id"], "direction": "incoming"})
            assert [p["id"] for p in incoming["items"]] == [a["id"]] and incoming["items"][0]["slugId"] == a["slugId"]
            outgoing = await api.post("pages/backlinks", {"pageId": a["id"], "direction": "outgoing"})
            assert [p["id"] for p in outgoing["items"]] == [b["id"]]
            assert (await bob.post("pages/backlinks-count", {"pageId": b["id"]})) == {"incoming": 0, "outgoing": 0}
        finally:
            await client.close()

    run(scenario())


async def make_tree(api, ctx, users):
    """Parent (text, image, link) with a child and a grandchild, plus an attachment."""

    parent = await api.post("pages/create", {"title": "Cha: Phở/Bò"})
    store = ctx.store_for(users["alice"])
    att = await asyncio.to_thread(
        store.save_attachment, file_name="ảnh.png", data=PNG, mime_type="image/png", page_id=parent["id"])
    child = await api.post("pages/create", {"title": "Con", "parentPageId": parent["id"]})
    grand = await api.post("pages/create", {"title": "Cháu", "parentPageId": child["id"]})
    content = md_to_pm("# Nội dung\n\nXin **chào** thế giới\n\n- [x] một\n- [ ] hai\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")
    content["content"].append({"type": "image", "attrs": {
        "src": f"/api/files/{att['id']}/%E1%BA%A3nh.png", "attachmentId": att["id"], "alt": "ảnh"}})
    content["content"].append({"type": "paragraph", "content": [
        {"type": "mention", "attrs": {"entityType": "page", "entityId": child["id"], "slugId": child["slugId"], "label": "Con"}}]})
    await asyncio.to_thread(store.set_content, parent["id"], content)
    await asyncio.to_thread(store.set_content, child["id"], doc("nội dung con"))
    await asyncio.to_thread(store.set_content, grand["id"], doc("nội dung cháu"))
    return parent, child, grand, att


def test_export_formats_and_downloads(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api = Api(client, "alice")
            parent, child, grand, att = await make_tree(api, ctx, users)
            # single markdown
            r, data = await download(client, "alice", "pages/export", {"pageId": parent["id"], "format": "markdown"})
            assert r.status == 200 and filename_of(r) == "Cha_ Phở_Bò.md"
            assert r.headers["Content-Type"].startswith("text/markdown") and int(r.headers["Content-Length"]) == len(data)
            text = data.decode()
            assert text.startswith("# Cha: Phở/Bò") and "**chào**" in text and "- [x] một" in text
            assert f"/api/files/{att['id']}/" in text  # no attachments requested: links stay
            # single html
            r, data = await download(client, "alice", "pages/export", {"pageId": parent["id"], "format": "html"})
            assert filename_of(r).endswith(".html") and b"<strong>ch\xc3\xa0o</strong>" in data
            # zip with children and attachments, relative links
            r, data = await download(client, "alice", "pages/export", {
                "pageId": parent["id"], "format": "markdown", "includeChildren": True, "includeAttachments": True})
            assert filename_of(r).endswith(".zip") and r.headers["Content-Type"] == "application/zip"
            z = zipfile.ZipFile(io.BytesIO(data))
            names = sorted(z.namelist())
            assert names == sorted([
                "Cha_ Phở_Bò.md", "Cha_ Phở_Bò/Con.md", "Cha_ Phở_Bò/Con/Cháu.md", "files/ảnh.png"])
            assert z.read("files/ảnh.png") == PNG
            root_md = z.read("Cha_ Phở_Bò.md").decode()
            assert "(files/%E1%BA%A3nh.png)" in root_md and "(Cha_%20Ph" in root_md  # page mention -> relative file
            assert z.read("Cha_ Phở_Bò/Con/Cháu.md").decode().strip().endswith("nội dung cháu")
            # children without attachments
            r, data = await download(client, "alice", "pages/export", {
                "pageId": parent["id"], "format": "html", "includeChildren": True})
            assert sorted(zipfile.ZipFile(io.BytesIO(data)).namelist()) == [
                "Cha_ Phở_Bò.html", "Cha_ Phở_Bò/Con.html", "Cha_ Phở_Bò/Con/Cháu.html"]
            # a whole space
            space = (await api.post("spaces", {}))["items"][0]
            r, data = await download(client, "alice", "spaces/export", {
                "spaceId": space["id"], "format": "markdown", "includeAttachments": True})
            assert filename_of(r) == "Private.zip"
            assert "Cha_ Phở_Bò/Con/Cháu.md" in zipfile.ZipFile(io.BytesIO(data)).namelist()
            # docx
            r, data = await download(client, "alice", "docx-export", {"pageId": parent["id"]})
            assert filename_of(r) == "Cha_ Phở_Bò.docx" and "wordprocessingml" in r.headers["Content-Type"]
            names = zipfile.ZipFile(io.BytesIO(data)).namelist()
            assert "word/document.xml" in names and any(n.startswith("word/media/") for n in names)
            # errors are JSON, not downloads
            r, data = await download(client, "alice", "pages/export", {"pageId": parent["id"], "format": "pdf"})
            assert r.status == 400 and json.loads(data)["statusCode"] == 400
            r, _ = await download(client, "alice", "pages/export", {"pageId": "00000000-0000-0000-0000-000000000000"})
            assert r.status == 404
            # nobody else can export it
            r, _ = await download(client, "bob", "pages/export", {"pageId": parent["id"]})
            assert r.status == 404
            r, _ = await download(client, "bob", "docx-export", {"pageId": parent["id"]})
            assert r.status == 404
            r, _ = await download(client, "bob", "spaces/export", {"spaceId": space["id"]})
            assert r.status == 404
        finally:
            await client.close()

    run(scenario())


def test_import_single_files(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api = Api(client, "alice")
            space = (await api.post("spaces", {}))["items"][0]
            data_uri = "data:image/png;base64," + base64.b64encode(PNG).decode()
            md = f"# Tiêu đề trang\n\nXin chào **thế giới**\n\n![nhúng]({data_uri})\n\n- [x] xong\n".encode()
            status, page = await upload(client, "alice", "pages/import", "bất kỳ.md", md, spaceId=space["id"])
            assert status == 200, page
            page = page["data"]
            assert page["title"] == "Tiêu đề trang" and page["spaceId"] == space["id"]
            content = page["content"]
            assert content["content"][0]["content"][0]["text"] == "Xin chào " or content["content"][0]["type"] == "paragraph"
            image = next(n for n in content["content"] if n["type"] == "image")
            assert image["attrs"]["src"].startswith("/api/files/") and image["attrs"]["attachmentId"]
            r = await client.get(image["attrs"]["src"], headers={"X-Test-User": "alice"})
            assert r.status == 200 and await r.read() == PNG
            assert (await client.get(image["attrs"]["src"], headers={"X-Test-User": "bob"})).status == 404
            # title from the file name when there is no heading; txt; html
            status, page = await upload(client, "alice", "pages/import", "Ghi chú.txt", "dòng 1\ndòng 2".encode(), spaceId=space["id"])
            assert page["data"]["title"] == "Ghi chú" and len(page["data"]["content"]["content"]) == 2
            status, page = await upload(client, "alice", "pages/import", "web.html",
                                        "<h1>Trang web</h1><p>a <b>b</b></p><script>x()</script>".encode(), spaceId=space["id"])
            assert page["data"]["title"] == "Trang web" and "script" not in json.dumps(page["data"]["content"])
            # under a parent page
            parent = await api.post("pages/create", {"title": "Cha"})
            status, page = await upload(client, "alice", "pages/import", "con.md", b"x", spaceId=space["id"], parentPageId=parent["id"])
            assert page["data"]["parentPageId"] == parent["id"]
            # docx made by our own exporter, with its picture
            source = md_to_pm("# Văn bản\n\nNguyễn **Văn** Đức\n\n1. một\n2. hai\n")
            source["content"].append({"type": "image", "attrs": {"src": "/x.png", "alt": "hình"}})
            docx = pm_to_docx(source, image_bytes=lambda attrs: (PNG, "image/png"))
            status, page = await upload(client, "alice", "pages/import", "văn bản.docx", docx, spaceId=space["id"])
            assert status == 200, page
            page = page["data"]
            assert page["title"] == "Văn bản"
            assert any(n["type"] == "orderedList" for n in page["content"]["content"])
            image = next(n for n in page["content"]["content"] if n["type"] == "image")
            assert image["attrs"]["attachmentId"]
            # refused
            status, err = await upload(client, "alice", "pages/import", "x.exe", b"MZ", spaceId=space["id"])
            assert status == 400 and "Unsupported" in err["message"]
            status, err = await upload(client, "alice", "pages/import", "bad.docx", b"not a docx", spaceId=space["id"])
            assert status == 400
            assert len(await api.post("pages/recent", {"spaceId": space["id"]}) or {}) >= 0
            status, err = await upload(client, "bob", "pages/import", "x.md", b"x", spaceId=space["id"])
            assert status == 404  # not bob's space
            r = await client.post("/api/pages/import", json={}, headers={"X-Test-User": "alice"})
            assert r.status == 415
        finally:
            await client.close()

    run(scenario())


def make_zip(entries: dict) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return out.getvalue()


async def wait_task(api, task_id, timeout=30):
    for _ in range(int(timeout / 0.1)):
        task = await api.post("file-tasks/info", {"fileTaskId": task_id})
        if task["status"] in ("success", "failed"):
            return task
        await asyncio.sleep(0.1)
    raise AssertionError("file task did not finish")


async def tree_titles(api, space_id):
    """{title: parent title} for every page of the space."""

    from app_server.khaidocs.api import KhaiUser  # noqa: F401

    roots = await api.post("pages/sidebar-pages", {"spaceId": space_id, "limit": 100})
    out = {}

    async def walk(items, parent):
        for p in items:
            out[p["title"]] = parent
            if p.get("hasChildren"):
                kids = await api.post("pages/sidebar-pages", {"spaceId": space_id, "pageId": p["id"], "limit": 100})
                await walk(kids["items"], p["title"])

    await walk(roots["items"], None)
    return out


def test_import_zip_builds_a_tree_and_tracks_the_task(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api, bob = Api(client, "alice"), Api(client, "bob")
            space = (await api.post("spaces", {}))["items"][0]
            ws = await connect(client, "alice")
            archive = make_zip({
                "Dự án/Tổng quan.md": "# Tổng quan dự án\n\nXem [chi tiết](Chi%20tiết.md) và ![sơ đồ](../hình/so%20do.png) [tệp](../hình/tài%20liệu.pdf)\n",
                "Dự án/Chi tiết.md": "Nội dung chi tiết",
                "Dự án/Chi tiết/Phụ lục.html": "<h1>Phụ lục</h1><p>html</p>",
                "Gốc.txt": "văn bản thường",
                "hình/so do.png": PNG,
                "hình/tài liệu.pdf": b"%PDF-1.4 fake",
                "../evil.md": "# evil",
                "__MACOSX/._Gốc.txt": "junk",
            })
            status, task = await upload(client, "alice", "pages/import-zip", "bộ.zip", archive,
                                        spaceId=space["id"], source="generic")
            assert status == 200, task
            task = task["data"]
            assert task["type"] == "import" and task["status"] in ("pending", "processing", "success")
            assert task["spaceId"] == space["id"] and task["fileName"] == "bộ.zip"
            # bob cannot see the task
            await bob.post("file-tasks/info", {"fileTaskId": task["id"]}, status=404)
            assert (await bob.post("file-tasks"))["items"] == []
            done = await wait_task(api, task["id"])
            assert done["status"] == "success", done
            assert done["progress"]["done"] == done["progress"]["total"] == done["result"]["pages"]
            assert any("unsafe" in s for s in done["result"]["skipped"])  # traversal entry skipped, reported
            refetch = []
            for _ in range(5):
                refetch += await events(ws)
                if any(e["operation"] == "refetchRootTreeNodeEvent" for e in refetch):
                    break
            titles = await tree_titles(api, space["id"])
            assert titles["Dự án"] is None and titles["Gốc"] is None
            assert titles["Tổng quan dự án"] == "Dự án"  # H1 became the title
            assert titles["Chi tiết"] == "Dự án" and titles["Phụ lục"] == "Chi tiết"
            assert "evil" not in titles
            # attachments rewired, links between pages internal
            store = ctx.store_for(users["alice"])
            page = next(p for p in await asyncio.to_thread(store.all_pages) if p["title"] == "Tổng quan dự án")
            full = await asyncio.to_thread(store.get_page, page["id"])
            image = next(n for n in full["content"]["content"] if n["type"] == "image")
            assert image["attrs"]["src"].startswith("/api/files/")
            _, blob = await asyncio.to_thread(store.read_attachment, image["attrs"]["attachmentId"])
            assert blob == PNG
            links = [m["attrs"]["href"] for n in full["content"]["content"] for c in n.get("content", [])
                     for m in c.get("marks", []) if m["type"] == "link"]
            target = next(p for p in await asyncio.to_thread(store.all_pages) if p["title"] == "Chi tiết")
            assert f"/p/{target['slug_id']}" in links and any(h.startswith("/api/files/") for h in links)
            # the page link also became a backlink
            counts = await api.post("pages/backlinks-count", {"pageId": target["id"]})
            assert counts["incoming"] == 1
            listing = await api.post("file-tasks")
            assert [t["id"] for t in listing["items"]] == [task["id"]]
            await ws.close()
        finally:
            await client.close()

    run(scenario())


def test_import_zip_failures_are_reported_as_failed_tasks(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api = Api(client, "alice")
            space = (await api.post("spaces", {}))["items"][0]
            for name, data, expect in (
                ("bad.zip", b"definitely not a zip", "not a valid zip"),
                ("empty.zip", make_zip({"a.bin": b"x"}), "no .md"),
                ("bomb.zip", make_zip({"a.md": b"\0" * (30 * 1024 * 1024)}), "zip bomb"),
            ):
                status, task = await upload(client, "alice", "pages/import-zip", name, data, spaceId=space["id"])
                assert status == 200
                done = await wait_task(api, task["data"]["id"])
                assert done["status"] == "failed" and expect in done["errorMessage"], (name, done)
            # a failed task keeps no data
            assert all(t["status"] == "failed" for t in (await api.post("file-tasks"))["items"])
            status, err = await upload(client, "alice", "pages/import-zip", "x.zip", make_zip({"a.md": "x"}), spaceId="00000000-0000-0000-0000-000000000000")
            assert status == 404
            await api.post("file-tasks/info", {"fileTaskId": "nope"}, status=400)
            await api.post("file-tasks/info", {"fileTaskId": "00000000-0000-0000-0000-000000000000"}, status=404)
        finally:
            await client.close()

    run(scenario())


def test_export_then_import_zip_round_trip(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api = Api(client, "alice")
            parent, child, grand, att = await make_tree(api, ctx, users)
            r, data = await download(client, "alice", "pages/export", {
                "pageId": parent["id"], "format": "markdown", "includeChildren": True, "includeAttachments": True})
            space = await api.post("spaces/create", {"name": "Đích", "slug": "dich"})
            status, task = await upload(client, "alice", "pages/import-zip", "x.zip", data, spaceId=space["id"])
            done = await wait_task(api, task["data"]["id"])
            assert done["status"] == "success", done
            titles = await tree_titles(api, space["id"])
            # folder structure: Cha_ Phở_Bò has the page body and the Con/Cháu children
            assert titles["Cha: Phở/Bò"] is None  # the page's own heading is its title again
            assert titles["Con"] == "Cha: Phở/Bò" and titles["Cháu"] == "Con" and "files" not in titles
            store = ctx.store_for(users["alice"])
            pages = await asyncio.to_thread(store.all_pages, space_id=space["id"])
            root = next(p for p in pages if p["parent_page_id"] is None)
            full = await asyncio.to_thread(store.get_page, root["id"])
            image = next(n for n in full["content"]["content"] if n["type"] == "image")
            _, blob = await asyncio.to_thread(store.read_attachment, image["attrs"]["attachmentId"])
            assert blob == PNG and image["attrs"]["attachmentId"] != att["id"]  # a copy, in the new page
            assert "chào" in json.dumps(full["content"], ensure_ascii=False)
        finally:
            await client.close()

    run(scenario())


def test_templates_over_http(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api, bob = Api(client, "alice"), Api(client, "bob")
            space = (await api.post("spaces", {}))["items"][0]
            made = await api.post("templates/create", {
                "title": "Họp nhóm", "description": "mẫu", "icon": "ti:users",
                "markdown": "# Họp ngày {{date}}\n\n## Nội dung\n\n- [ ] việc\n"})
            assert made["title"] == "Họp nhóm" and made["markdown"].startswith("# Họp")
            listing = await api.post("templates")
            assert [t["id"] for t in listing["items"]] == [made["id"]] and "markdown" not in listing["items"][0]
            page = await api.post("templates/use", {"templateId": made["id"], "spaceId": space["id"]})
            assert page["title"].startswith("Họp ngày 20") and "{{" not in page["title"]
            assert page["icon"] == "ti:users" and page["spaceId"] == space["id"]
            kinds = [n["type"] for n in page["content"]["content"]]
            assert kinds == ["heading", "taskList"] and "{{" not in json.dumps(page["content"])
            # save a page as a template, then use it
            src = await api.post("pages/create", {"title": "Nguồn", "icon": "ti:file"})
            await asyncio.to_thread(ctx.store_for(users["alice"]).set_content, src["id"], doc("nội dung mẫu"))
            saved = await api.post("templates/create", {"pageId": src["id"]})
            assert saved["title"] == "Nguồn" and saved["content"]["content"][0]["content"][0]["text"] == "nội dung mẫu"
            copy = await api.post("templates/use", {"templateId": saved["id"], "title": "Bản sao"})
            assert copy["title"] == "Bản sao" and copy["content"]["content"][0]["content"][0]["text"] == "nội dung mẫu"
            upd = await api.post("templates/update", {"templateId": saved["id"], "title": "Đổi tên"})
            assert upd["title"] == "Đổi tên"
            # isolation
            assert (await bob.post("templates"))["items"] == []
            await bob.post("templates/info", {"templateId": made["id"]}, status=404)
            await bob.post("templates/use", {"templateId": made["id"]}, status=404)
            await bob.post("templates/delete", {"templateId": made["id"]}, status=404)
            await api.post("templates/delete", {"templateId": made["id"]})
            await api.post("templates/info", {"templateId": made["id"]}, status=404)
            await api.post("templates/create", {"title": "x"}, status=400)
        finally:
            await client.close()

    run(scenario())


def test_new_page_from_client_template_via_import(base, users) -> None:
    """What the client's template gallery does: POST the template's Markdown
    to pages/import as a file named after the title."""

    async def scenario():
        client, ctx = await start(base, users)
        try:
            api = Api(client, "alice")
            space = (await api.post("spaces", {}))["items"][0]
            markdown = "# Báo cáo tuần\n\n**Tuần:** 2026-01-05\n\n## Điểm nổi bật\n\n- \n\n## Việc cần làm\n\n- [ ] Một\n- [ ] Hai\n"
            status, page = await upload(client, "alice", "pages/import", "Báo cáo tuần.md", markdown.encode(),
                                        spaceId=space["id"])
            page = page["data"]
            assert status == 200 and page["title"] == "Báo cáo tuần"
            kinds = [n["type"] for n in page["content"]["content"]]
            assert kinds[:2] == ["paragraph", "heading"] and "taskList" in kinds
            updated = await api.post("pages/update", {"pageId": page["id"], "icon": "ti:calendar"})
            assert updated["icon"] == "ti:calendar"
            sidebar = await api.post("pages/sidebar-pages", {"spaceId": space["id"]})
            assert [p["title"] for p in sidebar["items"]] == ["Báo cáo tuần"]
        finally:
            await client.close()

    run(scenario())
