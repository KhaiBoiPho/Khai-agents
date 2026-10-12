"""The Hocuspocus-compatible server, driven by a Python client that speaks the
provider's wire protocol."""

from __future__ import annotations

import asyncio

import pytest
from aiohttp import WSMsgType
from aiohttp.client_exceptions import WSServerHandshakeError
from pycrdt import Doc, XmlElement, XmlFragment, XmlText

from app_server.khaidocs import collab
from app_server.khaidocs.api import KhaiUser
from app_server.khaidocs.collab import (
    AUTH, AUTH_DENIED, AUTH_OK, AWARENESS, STEP1, STEP2, STATELESS, SYNC, SYNC_STATUS, UPDATE,
    Decoder, encode_awareness, frame, w_bytes, w_string, w_uint,
)
from core.khaidocs.pm_yjs import update_to_json
from tests.khaidocs.conftest import make_user
from tests.khaidocs.harness import Api, start


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 60))


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(collab, "DEBOUNCE", 0.1)
    monkeypatch.setattr(collab, "MAX_WAIT", 0.5)
    monkeypatch.setattr(collab, "EXTERNAL_POLL", 0.2)


@pytest.fixture
def users(base):
    out = {}
    for name in ("alice", "bob"):
        out[name] = KhaiUser(make_user(base, name), name, name.title(), "member")
    return out


class Provider:
    """What @hocuspocus/provider does for one document on one socket."""

    def __init__(self, client, user: str, page_id: str, *, token: str = "ignored") -> None:
        self.client, self.user, self.name, self.token = client, user, "page." + page_id, token
        self.doc = Doc()
        self.ws = None
        self.synced = asyncio.Event()
        self.authenticated = asyncio.Event()
        self.denied = asyncio.Event()
        self.statuses = 0
        self.stateless: list[str] = []
        self.awareness: list[bytes] = []
        self._task = None
        self._sub = None

    async def connect(self) -> Provider:
        self.ws = await self.client.ws_connect("/collab", headers={"X-Test-User": self.user})
        self._task = asyncio.ensure_future(self._read())
        self._sub = self.doc.observe(self._local)
        await self.ws.send_bytes(frame(self.name, AUTH, w_uint(0) + w_string(self.token) + w_string("4.5.0")))
        await self.ws.send_bytes(frame(self.name, SYNC, w_uint(STEP1) + w_bytes(self.doc.get_state())))
        return self

    def _local(self, event) -> None:
        if getattr(self, "_applying", False):
            return
        asyncio.ensure_future(self.ws.send_bytes(frame(self.name, SYNC, w_uint(UPDATE) + w_bytes(event.update))))

    async def _read(self) -> None:
        async for message in self.ws:
            if message.type != WSMsgType.BINARY:
                continue
            d = Decoder(message.data)
            assert d.var_string() == self.name
            kind = d.var_uint()
            if kind == AUTH:
                sub = d.var_uint()
                if sub == AUTH_OK:
                    assert d.var_string() == "read-write"
                    self.authenticated.set()
                elif sub == AUTH_DENIED:
                    self.denied.set()
            elif kind == SYNC:
                sub = d.var_uint()
                payload = d.var_bytes()
                if sub == STEP1:
                    await self.ws.send_bytes(frame(self.name, SYNC, w_uint(STEP2) + w_bytes(self.doc.get_update(payload))))
                else:
                    self._applying = True
                    try:
                        self.doc.apply_update(payload)
                    finally:
                        self._applying = False
                    if sub == STEP2:
                        self.synced.set()
            elif kind == SYNC_STATUS:
                self.statuses += 1
            elif kind == STATELESS:
                self.stateless.append(d.var_string())
            elif kind == AWARENESS:
                self.awareness.append(d.var_bytes())

    def type(self, text: str) -> None:
        fragment = self.doc.get("default", type=XmlFragment)
        paragraph = XmlElement("paragraph")
        fragment.children.append(paragraph)
        node = XmlText()
        paragraph.children.append(node)
        node.insert(0, text)

    def text(self) -> list[str]:
        return [
            "".join(c[0] for c in p.children[0].diff()) if len(p.children) else ""
            for p in self.doc.get("default", type=XmlFragment).children
        ]

    async def close(self) -> None:
        await self.ws.close()
        await self._task


async def until(predicate, seconds: float = 5.0) -> None:
    deadline = asyncio.get_running_loop().time() + seconds
    while not predicate():
        assert asyncio.get_running_loop().time() < deadline, "timed out"
        await asyncio.sleep(0.02)


def test_two_tabs_converge_and_persist(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api = Api(client, "alice")
            space = (await api.post("spaces"))["items"][0]
            page = await api.post("pages/create", {"spaceId": space["id"], "title": "Doc"})
            a = await Provider(client, "alice", page["id"]).connect()
            b = await Provider(client, "alice", page["id"], token="other").connect()
            await asyncio.wait_for(asyncio.gather(a.synced.wait(), b.synced.wait()), 5)
            await a.authenticated.wait()
            a.type("Xin chào từ tab A")
            await until(lambda: b.text() == ["Xin chào từ tab A"])
            b.type("và tab B 😀")
            await until(lambda: a.text() == ["Xin chào từ tab A", "và tab B 😀"])
            assert a.statuses >= 1  # SyncStatus acknowledged the updates
            await until(lambda: any("page.updated" in s for s in a.stateless))
            # awareness is relayed to the other tab only
            await a.ws.send_bytes(frame(a.name, AWARENESS, w_bytes(encode_awareness([(77, 1, '{"user":{"name":"A"}}')]))))
            await until(lambda: b.awareness)
            assert not a.awareness
            await a.close()
            # b stays: the stored page has the text, derived from the doc
            await until(lambda: "tab A" in (ctx.store_for(users["alice"]).get_page(page["id"])["text_content"]))
            stored = ctx.store_for(users["alice"]).get_page(page["id"])
            assert stored["text_content"] == "Xin chào từ tab A\nvà tab B 😀"
            assert stored["content"]["content"][1]["content"][0]["text"] == "và tab B 😀"
            await b.close()
            # a fresh connection (reconnect) gets the stored document
            c = await Provider(client, "alice", page["id"]).connect()
            await asyncio.wait_for(c.synced.wait(), 5)
            assert c.text() == ["Xin chào từ tab A", "và tab B 😀"]
            await c.close()
            await until(lambda: not ctx.collab.docs)
            hist = await api.post("pages/history", {"pageId": page["id"]})
            assert hist["items"]  # a snapshot was taken
        finally:
            await client.close()

    run(scenario())


def test_unauthenticated_and_cross_user_are_refused(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            alice = Api(client, "alice")
            space = (await alice.post("spaces"))["items"][0]
            page = await alice.post("pages/create", {"spaceId": space["id"], "title": "Mine"})
            with pytest.raises(WSServerHandshakeError) as err:
                await client.ws_connect("/collab")
            assert err.value.status == 401
            # a client-supplied identity is ignored: the token claims to be alice
            await Api(client, "bob").post("spaces")
            bob = await Provider(client, "bob", page["id"], token=users["alice"].id).connect()
            await asyncio.wait_for(bob.denied.wait(), 5)
            assert not bob.synced.is_set() and not bob.authenticated.is_set()
            bob.type("vandalism")
            await asyncio.sleep(0.4)
            assert ctx.store_for(users["alice"]).get_page(page["id"])["text_content"] == ""
            assert (await Api(client, "alice").post("pages/info", {"pageId": page["id"]}))["title"] == "Mine"
            await bob.close()
            # unknown document names are refused too
            ws = await client.ws_connect("/collab", headers={"X-Test-User": "bob"})
            await ws.send_bytes(frame("comment.1", SYNC, w_uint(STEP1) + w_bytes(b"\x00")))
            msg = await asyncio.wait_for(ws.receive(), 5)
            d = Decoder(msg.data)
            assert d.var_string() == "comment.1" and d.var_uint() == AUTH and d.var_uint() == AUTH_DENIED
            await ws.close()
        finally:
            await client.close()

    run(scenario())


def test_agent_write_reaches_open_editor(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            api = Api(client, "alice")
            space = (await api.post("spaces"))["items"][0]
            page = await api.post("pages/create", {"spaceId": space["id"], "title": "T"})
            a = await Provider(client, "alice", page["id"]).connect()
            await asyncio.wait_for(a.synced.wait(), 5)
            a.type("typed")
            await until(lambda: ctx.store_for(users["alice"]).get_page(page["id"])["text_content"] == "typed")
            store = ctx.store_for(users["alice"])
            await asyncio.to_thread(store.set_content, page["id"], {"type": "doc", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "from the agent"}]}]})
            await until(lambda: "from the agent" in a.text())
            await a.close()
            await until(lambda: "from the agent" in store.get_page(page["id"])["text_content"])
        finally:
            await client.close()

    run(scenario())


def test_malformed_frames_close_the_socket_not_the_server(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            ws = await client.ws_connect("/collab", headers={"X-Test-User": "alice"})
            await ws.send_bytes(b"\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff")
            msg = await asyncio.wait_for(ws.receive(), 5)
            assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED)
            ws2 = await client.ws_connect("/collab", headers={"X-Test-User": "alice"})
            await ws2.send_str("text frames are not allowed")
            msg = await asyncio.wait_for(ws2.receive(), 5)
            assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED)
            assert (await client.get("/api/health", headers={"X-Test-User": "alice"})).status == 200
        finally:
            await client.close()

    run(scenario())
