from __future__ import annotations

import asyncio
import io

import pytest
from aiohttp import FormData

from app_server.khaidocs.api import KhaiUser
from tests.khaidocs.conftest import make_user
from tests.khaidocs.harness import Api, start


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 60))


@pytest.fixture
def users(base):
    out = {}
    for name in ("alice", "bob"):
        uid = make_user(base, name)
        out[name] = KhaiUser(uid, name, name.title(), "member")
    return out


def doc(*lines):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in lines]}


def test_startup_endpoints(base, users) -> None:
    async def scenario():
        client, _ = await start(base, users)
        try:
            api = Api(client, "alice")
            me = await api.post("users/me")
            assert me["user"]["id"] == users["alice"].id and me["user"]["role"] == "owner"
            assert me["workspace"]["name"] == "Khai"
            assert me["workspace"]["defaultSpaceId"]
            spaces = await api.post("spaces", {"limit": 100})
            assert [s["name"] for s in spaces["items"]] == ["Private"]
            assert spaces["items"][0]["membership"]["role"] == "admin"
            assert spaces["meta"]["hasNextPage"] is False
            info = await api.post("spaces/info", {"spaceId": spaces["items"][0]["slug"]})
            assert info["id"] == spaces["items"][0]["id"]
            assert (await api.post("version"))["currentVersion"]
            assert (await api.post("workspace/info"))["id"] == users["alice"].id
            assert (await api.post("notifications/unread-count"))["count"] == 0
            r = await client.get("/api/health", headers=api.headers)
            assert r.status == 200
            # unauthenticated: 401 on everything
            r = await client.post("/api/users/me", json={})
            assert r.status == 401
        finally:
            await client.close()

    run(scenario())


def test_page_lifecycle_over_rest(base, users) -> None:
    async def scenario():
        client, _ = await start(base, users)
        try:
            api = Api(client, "alice")
            space = (await api.post("spaces"))["items"][0]
            root = await api.post("pages/create", {"spaceId": space["id"], "title": "Tiếng Việt"})
            assert root["slugId"] and root["position"] and root["space"]["slug"] == space["slug"]
            child = await api.post("pages/create", {"spaceId": space["id"], "parentPageId": root["id"]})
            assert child["parentPageId"] == root["id"]
            # info by slug id and by uuid
            assert (await api.post("pages/info", {"pageId": root["slugId"]}))["id"] == root["id"]
            tree = await api.post("pages/sidebar-pages", {"spaceId": space["id"]})
            assert [p["id"] for p in tree["items"]] == [root["id"]]
            assert tree["items"][0]["hasChildren"] is True
            kids = await api.post("pages/sidebar-pages", {"pageId": root["id"], "spaceId": space["id"]})
            assert [p["id"] for p in kids["items"]] == [child["id"]]
            crumbs = await api.post("pages/breadcrumbs", {"pageId": child["id"]})
            assert [p["id"] for p in crumbs] == [root["id"], child["id"]]
            renamed = await api.post("pages/update", {"pageId": child["id"], "title": "Con", "icon": "📄"})
            assert renamed["title"] == "Con" and renamed["icon"] == "📄"
            # search with diacritics
            hits = await api.post("search", {"query": "tieng viet"})
            assert [h["id"] for h in hits["items"]] == [root["id"]]
            suggest = await api.post("search/suggest", {"query": "con", "includePages": True})
            assert [p["id"] for p in suggest["pages"]] == [child["id"]]
            # favorite
            await api.post("favorites/add", {"type": "page", "pageId": root["id"]})
            ids = await api.post("favorites/ids", {"type": "page"})
            assert ids["items"] == [root["id"]]
            favs = await api.post("favorites", {"type": "page"})
            assert favs["items"][0]["page"]["title"] == "Tiếng Việt"
            # trash / restore
            await api.post("pages/delete", {"pageId": root["id"]})
            trash = await api.post("pages/trash", {"spaceId": space["id"]})
            assert [p["id"] for p in trash["items"]] == [root["id"]]
            info = await api.post("pages/info", {"pageId": root["id"]})
            assert info["deletedAt"] and info["canEdit"] is False
            restored = await api.post("pages/restore", {"pageId": root["id"]})
            assert restored["deletedAt"] is None and restored["hasChildren"] is True
            # move + duplicate
            await api.post("pages/move", {"pageId": child["id"], "parentPageId": None, "position": "a5"})
            moved = await api.post("pages/info", {"pageId": child["id"]})
            assert moved["parentPageId"] is None and moved["position"] == "a5"
            copy = await api.post("pages/duplicate", {"pageId": root["id"]})
            assert copy["title"] == "Copy of Tiếng Việt"
            recent = await api.post("pages/recent", {"limit": 2})
            assert len(recent["items"]) == 2 and recent["meta"]["hasNextPage"] is True
            more = await api.post("pages/recent", {"limit": 2, "cursor": recent["meta"]["nextCursor"]})
            assert more["items"]
            # history is empty until a snapshot exists, and read works
            assert (await api.post("pages/history", {"pageId": root["id"]}))["items"] == []
            # errors keep the client's shape
            bad = await api.post("pages/info", {"pageId": "nope"}, status=404)
            assert bad["statusCode"] == 404 and "message" in bad
            await api.post("pages/delete", {"pageId": root["id"], "permanentlyDelete": True})
            await api.post("pages/info", {"pageId": root["id"]}, status=404)
        finally:
            await client.close()

    run(scenario())


def test_no_cross_user_access_over_rest(base, users) -> None:
    async def scenario():
        client, _ = await start(base, users)
        try:
            alice, bob = Api(client, "alice"), Api(client, "bob")
            a_space = (await alice.post("spaces"))["items"][0]
            page = await alice.post("pages/create", {"spaceId": a_space["id"], "title": "secret"})
            await alice.post("favorites/add", {"type": "page", "pageId": page["id"]})
            b_space = (await bob.post("spaces"))["items"][0]
            assert b_space["id"] != a_space["id"]
            # Bob cannot see, change, move, delete, search or create inside Alice's rows.
            await bob.post("pages/info", {"pageId": page["id"]}, status=404)
            await bob.post("pages/info", {"pageId": page["slugId"]}, status=404)
            await bob.post("pages/update", {"pageId": page["id"], "title": "x"}, status=404)
            await bob.post("pages/delete", {"pageId": page["id"], "permanentlyDelete": True}, status=404)
            await bob.post("pages/move", {"pageId": page["id"], "parentPageId": None}, status=404)
            await bob.post("pages/move-to-space", {"pageId": page["id"], "spaceId": b_space["id"]}, status=404)
            await bob.post("pages/duplicate", {"pageId": page["id"]}, status=404)
            await bob.post("pages/create", {"spaceId": a_space["id"], "title": "x"}, status=404)
            await bob.post("spaces/info", {"spaceId": a_space["id"]}, status=404)
            await bob.post("spaces/update", {"spaceId": a_space["id"], "name": "hacked"}, status=404)
            await bob.post("favorites/add", {"type": "page", "pageId": page["id"]}, status=404)
            assert (await bob.post("search", {"query": "secret"}))["items"] == []
            assert (await bob.post("pages/recent", {}))["items"] == []
            assert (await bob.post("pages/sidebar-pages", {"spaceId": a_space["id"]}))["items"] == []
            assert (await bob.post("favorites/ids", {"type": "page"}))["items"] == []
            assert (await alice.post("pages/info", {"pageId": page["id"]}))["title"] == "secret"
        finally:
            await client.close()

    run(scenario())


def _upload(name: str, data: bytes, ctype: str, **fields) -> FormData:
    form = FormData()
    for key, value in fields.items():
        form.add_field(key, value)
    form.add_field("file", io.BytesIO(data), filename=name, content_type=ctype)
    return form


def test_attachments_upload_download(base, users, monkeypatch) -> None:
    from core.khaidocs import store as store_module

    async def scenario():
        client, _ = await start(base, users)
        try:
            alice, bob = Api(client, "alice"), Api(client, "bob")
            space = (await alice.post("spaces"))["items"][0]
            page = await alice.post("pages/create", {"spaceId": space["id"]})
            r = await client.post("/api/files/upload", data=_upload("pic.png", b"\x89PNG\r\n", "image/png", pageId=page["id"]), headers=alice.headers)
            assert r.status == 200
            att = await r.json()  # raw, not enveloped
            assert att["fileName"] == "pic.png" and att["mimeType"] == "image/png" and att["fileSize"] == 6
            got = await client.get(f"/api/files/{att['id']}/pic.png", headers=alice.headers)
            assert got.status == 200 and await got.read() == b"\x89PNG\r\n"
            assert got.headers["Content-Type"] == "image/png"
            assert got.headers["Content-Disposition"].startswith("inline")
            ranged = await client.get(f"/api/files/{att['id']}/pic.png", headers={**alice.headers, "Range": "bytes=1-3"})
            assert ranged.status == 206 and await ranged.read() == b"PNG"
            # another user, or nobody, cannot read it
            assert (await client.get(f"/api/files/{att['id']}/pic.png", headers=bob.headers)).status == 404
            assert (await client.get(f"/api/files/{att['id']}/pic.png")).status == 401
            # html is never served inline or as html
            r = await client.post("/api/files/upload", data=_upload("x.html", b"<script>alert(1)</script>", "text/html", pageId=page["id"]), headers=alice.headers)
            html = await r.json()
            got = await client.get(f"/api/files/{html['id']}/x.html", headers=alice.headers)
            assert got.headers["Content-Type"] == "application/octet-stream"
            assert got.headers["Content-Disposition"].startswith("attachment")
            # svg only inside a sandbox
            r = await client.post("/api/files/upload", data=_upload("a.svg", b"<svg/>", "image/svg+xml", pageId=page["id"]), headers=alice.headers)
            svg = await r.json()
            got = await client.get(f"/api/files/{svg['id']}/a.svg", headers=alice.headers)
            assert "sandbox" in got.headers["Content-Security-Policy"]
            # size limit and foreign page
            monkeypatch.setattr(store_module, "MAX_ATTACHMENT_BYTES", 10)
            r = await client.post("/api/files/upload", data=_upload("big.bin", b"x" * 11, "application/octet-stream", pageId=page["id"]), headers=alice.headers)
            assert r.status == 413
            r = await client.post("/api/files/upload", data=_upload("a.txt", b"x", "text/plain", pageId=page["id"]), headers=bob.headers)
            assert r.status == 404
            listed = await alice.post("pages/attachments", {"pageId": page["id"]})
            assert len(listed["items"]) == 3 and listed["items"][0]["url"].startswith("/api/files/")
            # icon upload for a space
            form = FormData()
            form.add_field("type", "space-icon")
            form.add_field("spaceId", space["id"])
            form.add_field("image", io.BytesIO(b"\x89PNG\r\n"), filename="i.png", content_type="image/png")
            r = await client.post("/api/attachments/upload-image", data=form, headers=alice.headers)
            assert r.status == 200
            info = await alice.post("spaces/info", {"spaceId": space["id"]})
            assert info["logo"]
            got = await client.get(f"/api/attachments/img/space-icon/{info['logo']}", headers=alice.headers)
            assert got.status == 200 and await got.read() == b"\x89PNG\r\n"
        finally:
            await client.close()

    run(scenario())


def test_stubs_answer_without_404(base, users) -> None:
    async def scenario():
        client, _ = await start(base, users)
        try:
            api = Api(client, "alice")
            # (phase 2 made labels, comments, notifications, file tasks real;
            # they are covered by tests/khaidocs/test_phase2_rest.py)
            for path in ("labels", "notifications", "shares", "groups", "workspace/members",
                         "workspace/invites", "public-spaces", "spaces/watched-ids", "file-tasks"):
                data = await api.post(path, {"pageId": "x"})
                assert data["items"] is not None, path
            # disabled endpoints are explicit, never a routing 404
            for path, code in (("shares/for-page", 404),):
                payload = await api.post(path, {}, status=code)
                assert payload["statusCode"] == code
            # auth endpoints do not exist at all
            for path in ("auth/login", "auth/collab-token", "sessions", "auth/setup"):
                r = await client.post("/api/" + path, json={}, headers=api.headers)
                assert r.status in (404, 405), path
        finally:
            await client.close()

    run(scenario())
