"""Realtime collaboration: a Hocuspocus-compatible Yjs server at ``/collab``.

The client (``@hocuspocus/provider`` 4.x) multiplexes documents over one
WebSocket. Every binary frame starts with a varint-prefixed document name
(``page.<page id>``) and a varint message type::

    0 Sync            1 Awareness      2 Auth         3 QueryAwareness
    5 Stateless       7 CLOSE (client leaves the document)
    8 SyncStatus      9 Ping           10 Pong

Sync carries the y-protocols messages (0 step1 = state vector, 1 step2 =
update, 2 update). Auth is answered with ``Authenticated "read-write"``. After
every update or step2 from a client the server answers ``SyncStatus 1`` so
the client can tell its changes are held.

Identity. The WebSocket must carry the Khai session cookie (same origin; the
gateway's origin guard rejects other origins). The token in the client's
Auth message is ignored: the user is whoever the session says, a document is
looked up through that user's row-level-security scope, so another user's
page id simply does not exist.

Documents. One in-memory ``pycrdt.Doc`` per (user, page), shared by all that
user's connections (tabs). Client updates are applied and relayed to the
other connections; persistence is debounced (``DEBOUNCE`` seconds after the
last change, at most ``MAX_WAIT`` under constant typing): the full state goes
to ``kd_pages.ydoc`` and ``content`` / ``text_content`` are derived from it
(core.khaidocs.store.persist_ydoc), with periodic history snapshots. A change
made outside the editor (an agent's ``set_content``) is noticed by a version
poll every ``EXTERNAL_POLL`` seconds and merged into the live document.
A document with no connections is flushed and dropped.

Process model. Live documents are per process: run ONE gateway process (the
deployment does). With several, two processes could hold the same page
concurrently; the version check in ``persist_ydoc`` keeps stored state
convergent (merge, never overwrite), but editors on different processes would
not see each other until the poll merges them.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime

from aiohttp import WSMsgType, web
from pycrdt import Doc

from app_server.khaidocs.api import KhaiUser
from core.khaidocs.errors import KhaiDocsError

logger = logging.getLogger(__name__)

DEBOUNCE = 2.0
MAX_WAIT = 10.0
EXTERNAL_POLL = 3.0
MAX_MESSAGE = 32 * 1024 * 1024
MAX_CONNECTIONS_PER_USER = 64
MAX_QUEUE = 4096

SYNC, AWARENESS, AUTH, QUERY_AWARENESS, STATELESS, CLOSE, SYNC_STATUS = 0, 1, 2, 3, 5, 7, 8
STEP1, STEP2, UPDATE = 0, 1, 2
AUTH_TOKEN, AUTH_DENIED, AUTH_OK = 0, 1, 2
DOC_PREFIX = "page."


# -- lib0 varint encoding -------------------------------------------------------


class Decoder:
    __slots__ = ("data", "pos")

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def var_uint(self) -> int:
        value, shift = 0, 0
        while True:
            if self.pos >= len(self.data):
                raise ValueError("truncated varint")
            byte = self.data[self.pos]
            self.pos += 1
            value |= (byte & 0x7F) << shift
            if byte < 0x80:
                return value
            shift += 7
            if shift > 63:
                raise ValueError("varint too long")

    def var_bytes(self) -> bytes:
        length = self.var_uint()
        end = self.pos + length
        if end > len(self.data):
            raise ValueError("truncated data")
        chunk = self.data[self.pos : end]
        self.pos = end
        return chunk

    def var_string(self) -> str:
        return self.var_bytes().decode("utf-8")


def w_uint(value: int) -> bytes:
    out = bytearray()
    while value > 0x7F:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    out.append(value)
    return bytes(out)


def w_bytes(data: bytes) -> bytes:
    return w_uint(len(data)) + data


def w_string(text: str) -> bytes:
    return w_bytes(text.encode("utf-8"))


def frame(name: str, kind: int, payload: bytes = b"") -> bytes:
    return w_string(name) + w_uint(kind) + payload


# -- awareness ------------------------------------------------------------------


def parse_awareness(update: bytes) -> list[tuple[int, int, str]]:
    decoder = Decoder(update)
    return [
        (decoder.var_uint(), decoder.var_uint(), decoder.var_string())
        for _ in range(decoder.var_uint())
    ]


def encode_awareness(entries: list[tuple[int, int, str]]) -> bytes:
    out = bytearray(w_uint(len(entries)))
    for client_id, clock, state in entries:
        out += w_uint(client_id) + w_uint(clock) + w_string(state)
    return bytes(out)


# -- documents and connections ---------------------------------------------------


class Peer:
    """One WebSocket of one user: an outbound queue and the documents it joined."""

    def __init__(self, ws: web.WebSocketResponse, user: KhaiUser) -> None:
        self.ws = ws
        self.user = user
        self.docs: dict[str, LiveDoc] = {}
        self.denied: set[str] = set()
        self.client_ids: dict[str, set[int]] = {}
        self.queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self.writer = asyncio.ensure_future(self._write())

    def send(self, data: bytes) -> None:
        if self.queue.qsize() > MAX_QUEUE:
            asyncio.ensure_future(self.ws.close(code=1013, message=b"too slow"))
            return
        self.queue.put_nowait(data)

    async def _write(self) -> None:
        while (data := await self.queue.get()) is not None:
            try:
                await self.ws.send_bytes(data)
            except (ConnectionError, RuntimeError):
                return

    async def stop(self) -> None:
        self.queue.put_nowait(None)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self.writer, 2)


class LiveDoc:
    def __init__(self, hub: CollabHub, user: KhaiUser, page_id: str, state: bytes | None, version: int):
        self.hub = hub
        self.user = user
        self.page_id = page_id
        self.name = DOC_PREFIX + page_id
        self.doc = Doc()
        if state:
            self.doc.apply_update(state)
        self.known_version = version
        self.peers: set[Peer] = set()
        self.awareness: dict[int, tuple[int, str]] = {}
        self.dirty = False
        self._dirty_since: float | None = None
        self._timer: asyncio.TimerHandle | None = None
        self._lock = asyncio.Lock()
        self._origin: Peer | None = None
        self._quiet = False  # applying stored state: relay, but do not persist
        self._subscription = self.doc.observe(self._on_update)
        self.closed = False

    # -- changes -------------------------------------------------------------------

    def _on_update(self, event) -> None:
        update = event.update
        message = frame(self.name, SYNC, w_uint(UPDATE) + w_bytes(update))
        for peer in self.peers:
            if peer is not self._origin:
                peer.send(message)
        if not self._quiet:
            self._mark_dirty()

    def apply(self, update: bytes, origin: Peer | None) -> None:
        self._origin = origin
        try:
            self.doc.apply_update(update)
        finally:
            self._origin = None

    def apply_stored(self, update: bytes) -> None:
        self._quiet = True
        try:
            self.apply(update, None)
        finally:
            self._quiet = False

    def _mark_dirty(self) -> None:
        loop = asyncio.get_running_loop()
        now = loop.time()
        self.dirty = True
        if self._dirty_since is None:
            self._dirty_since = now
        if self._timer is not None:
            self._timer.cancel()
        delay = max(0.0, min(DEBOUNCE, MAX_WAIT - (now - self._dirty_since)))
        self._timer = loop.call_later(delay, lambda: asyncio.ensure_future(self.flush()))

    async def flush(self) -> None:
        """Persist the document if it changed. Safe to call at any time."""

        async with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            if not self.dirty or self.closed:
                return
            self.dirty = False
            self._dirty_since = None
            state = self.doc.get_update()
            store = self.hub.ctx.store_for(self.user)
            try:
                merged, version = await asyncio.to_thread(
                    store.persist_ydoc, self.page_id, state, self.known_version, snapshot=True
                )
            except KhaiDocsError as exc:
                # The page was deleted for good (or trashed): nothing to store.
                logger.info("KhaiDocs collab: %s not saved: %s", self.page_id, exc)
                return
            except Exception:
                logger.exception("KhaiDocs collab: saving %s failed; will retry", self.page_id)
                self.dirty = True
                self._dirty_since = self._dirty_since or asyncio.get_running_loop().time()
                self._timer = asyncio.get_running_loop().call_later(
                    5.0, lambda: asyncio.ensure_future(self.flush())
                )
                return
            self.known_version = version
            self.apply_stored(merged)  # picks up whatever another writer added
            notice = frame(
                self.name,
                STATELESS,
                w_string(
                    json.dumps(
                        {
                            "type": "page.updated",
                            "updatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                            "lastUpdatedBy": {"id": self.user.id, "name": self.user.display_name,
                                              "avatarUrl": None},
                        }
                    )
                ),
            )
            for peer in self.peers:
                peer.send(notice)

    async def check_external(self) -> None:
        """Merge a change another writer stored (set_content) into the live doc."""

        if self.dirty or self.closed or self._lock.locked():
            return
        store = self.hub.ctx.store_for(self.user)
        try:
            version = await asyncio.to_thread(store.current_version, self.page_id)
            if version is None or version == self.known_version:
                return
            _id, state, version = await asyncio.to_thread(store.load_ydoc, self.page_id)
        except KhaiDocsError:
            return
        except Exception:
            logger.exception("KhaiDocs collab: version check of %s failed", self.page_id)
            return
        async with self._lock:
            if self.dirty or self.closed:
                return
            if state:
                self.apply_stored(state)
            self.known_version = version

    # -- awareness ---------------------------------------------------------------------

    def awareness_message(self) -> bytes | None:
        if not self.awareness:
            return None
        entries = [(cid, clock, state) for cid, (clock, state) in self.awareness.items()]
        return frame(self.name, AWARENESS, w_bytes(encode_awareness(entries)))

    def update_awareness(self, peer: Peer, update: bytes) -> None:
        owned = peer.client_ids.setdefault(self.name, set())
        for client_id, clock, state in parse_awareness(update):
            current = self.awareness.get(client_id)
            if current is not None and clock < current[0]:
                continue
            if state == "null":
                self.awareness.pop(client_id, None)
                owned.discard(client_id)
            else:
                self.awareness[client_id] = (clock, state)
                owned.add(client_id)
        message = frame(self.name, AWARENESS, w_bytes(update))
        for other in self.peers:
            if other is not peer:
                other.send(message)

    def drop_peer(self, peer: Peer) -> None:
        self.peers.discard(peer)
        removed = []
        for client_id in peer.client_ids.pop(self.name, set()):
            current = self.awareness.pop(client_id, None)
            if current is not None:
                removed.append((client_id, current[0] + 1, "null"))
        if removed:
            message = frame(self.name, AWARENESS, w_bytes(encode_awareness(removed)))
            for other in self.peers:
                other.send(message)


class CollabHub:
    def __init__(self, ctx) -> None:
        self.ctx = ctx
        self.docs: dict[tuple[str, str], LiveDoc] = {}
        self.peers: dict[str, set[Peer]] = {}
        self._loading: dict[tuple[str, str], asyncio.Lock] = {}
        self._poller: asyncio.Task | None = None

    # -- lifecycle -------------------------------------------------------------------

    def start(self) -> None:
        if self._poller is None:
            self._poller = asyncio.ensure_future(self._poll())

    async def _poll(self) -> None:
        while True:
            await asyncio.sleep(EXTERNAL_POLL)
            for live in list(self.docs.values()):
                if live.peers:
                    await live.check_external()

    async def shutdown(self) -> None:
        if self._poller is not None:
            self._poller.cancel()
            self._poller = None
        for peers in list(self.peers.values()):
            for peer in list(peers):
                with contextlib.suppress(Exception):
                    await peer.ws.close(code=1001, message=b"Server shutting down")
        for live in list(self.docs.values()):
            await live.flush()
        self.docs.clear()

    async def close_user(self, user_id: str, session: str | None = None) -> None:
        """Close a user's collaboration sockets (one session's when given)."""

        for peer in list(self.peers.get(user_id, ())):
            if session is None or peer.user.session == session:
                with contextlib.suppress(Exception):
                    await peer.ws.close(code=4401, message=b"Signed out")

    # -- documents ---------------------------------------------------------------------

    async def open(self, user: KhaiUser, name: str) -> LiveDoc | None:
        if not name.startswith(DOC_PREFIX):
            return None
        ref = name[len(DOC_PREFIX):]
        store = self.ctx.store_for(user)
        try:
            page_id, state, version = await asyncio.to_thread(store.load_ydoc, ref)
        except KhaiDocsError:
            return None
        key = (user.id, page_id)
        lock = self._loading.setdefault(key, asyncio.Lock())
        async with lock:
            live = self.docs.get(key)
            if live is None or live.closed:
                live = LiveDoc(self, user, page_id, state, version)
                self.docs[key] = live
            self._loading.pop(key, None)
        return live

    async def release(self, live: LiveDoc) -> None:
        if live.peers:
            return
        await live.flush()
        if not live.peers and self.docs.get((live.user.id, live.page_id)) is live:
            live.closed = True
            with contextlib.suppress(Exception):
                live.doc.unobserve(live._subscription)
            del self.docs[(live.user.id, live.page_id)]

    async def refresh(self, user_id: str, page_id: str) -> None:
        """Merge a just-stored external change into an open document now."""

        live = self.docs.get((user_id, page_id))
        if live is not None:
            await live.check_external()

    # -- the endpoint --------------------------------------------------------------------

    async def handle(self, request: web.Request, user: KhaiUser) -> web.StreamResponse:
        if len(self.peers.get(user.id, ())) >= MAX_CONNECTIONS_PER_USER:
            raise web.HTTPTooManyRequests(text="Too many collaboration connections")
        ws = web.WebSocketResponse(max_msg_size=MAX_MESSAGE, heartbeat=25.0)
        await ws.prepare(request)
        peer = Peer(ws, user)
        self.peers.setdefault(user.id, set()).add(peer)
        try:
            async for message in ws:
                if message.type == WSMsgType.BINARY:
                    try:
                        await self._message(peer, message.data)
                    except ValueError:
                        logger.info("KhaiDocs collab: malformed frame from %s", user.id)
                        await ws.close(code=1007, message=b"malformed message")
                        break
                elif message.type == WSMsgType.TEXT:
                    await ws.close(code=1003, message=b"binary frames only")
                    break
        finally:
            # aiohttp cancels the handler when the client goes away; the
            # cleanup (flush to the database) must still run to the end.
            await asyncio.shield(asyncio.ensure_future(self._cleanup(peer)))
        return ws

    async def _cleanup(self, peer: Peer) -> None:
        docs = list(peer.docs.values())
        for live in docs:
            live.drop_peer(peer)
        group = self.peers.get(peer.user.id)
        if group is not None:
            group.discard(peer)
            if not group:
                self.peers.pop(peer.user.id, None)
        peer.docs.clear()
        await peer.stop()
        for live in docs:
            await self.release(live)

    async def _attach(self, peer: Peer, name: str) -> LiveDoc | None:
        live = peer.docs.get(name)
        if live is not None:
            return live
        if name in peer.denied:
            return None
        live = await self.open(peer.user, name)
        if live is None:
            peer.denied.add(name)
            peer.send(frame(name, AUTH, w_uint(AUTH_DENIED) + w_string("permission-denied")))
            return None
        peer.docs[name] = live
        live.peers.add(peer)
        return live

    async def _message(self, peer: Peer, data: bytes) -> None:
        if len(data) <= 1:  # application-level Ping/Pong
            return
        decoder = Decoder(data)
        name = decoder.var_string()
        kind = decoder.var_uint()
        if kind == CLOSE:
            live = peer.docs.pop(name, None)
            if live is not None:
                live.drop_peer(peer)
                await self.release(live)
            return
        live = await self._attach(peer, name)
        if live is None:
            return
        if kind == AUTH:
            # The token (if any) is ignored; the session decided already.
            peer.send(frame(name, AUTH, w_uint(AUTH_OK) + w_string("read-write")))
        elif kind == SYNC:
            sub = decoder.var_uint()
            payload = decoder.var_bytes()
            if sub == STEP1:
                diff = live.doc.get_update(payload)
                peer.send(frame(name, SYNC, w_uint(STEP2) + w_bytes(diff)))
                # Ask the client for what the server lacks (its offline edits).
                peer.send(frame(name, SYNC, w_uint(STEP1) + w_bytes(live.doc.get_state())))
                awareness = live.awareness_message()
                if awareness:
                    peer.send(awareness)
            elif sub in (STEP2, UPDATE):
                try:
                    live.apply(payload, peer)
                except Exception as exc:
                    raise ValueError(f"bad update: {exc}") from exc
                peer.send(frame(name, SYNC_STATUS, b"\x01"))
            else:
                raise ValueError("unknown sync message")
        elif kind == AWARENESS:
            live.update_awareness(peer, decoder.var_bytes())
        elif kind == QUERY_AWARENESS:
            awareness = live.awareness_message()
            if awareness:
                peer.send(awareness)
        elif kind == STATELESS:
            payload = decoder.var_string()
            message = frame(name, STATELESS, w_string(payload))
            for other in live.peers:
                if other is not peer:
                    other.send(message)


def install(app: web.Application, ctx) -> None:
    hub = CollabHub(ctx)
    ctx.collab = hub

    async def endpoint(request: web.Request) -> web.StreamResponse:
        user = await ctx.authenticate(request)
        if request.headers.get("Upgrade", "").lower() != "websocket":
            raise web.HTTPUpgradeRequired(text="WebSocket required")
        hub.start()
        return await hub.handle(request, user)

    app.add_routes([web.get("/collab", endpoint), web.get("/collab/", endpoint)])

    async def on_shutdown(_app: web.Application) -> None:
        await hub.shutdown()
        await ctx.sockets.close_all()

    app.on_shutdown.append(on_shutdown)


__all__ = ["CollabHub", "install"]
