"""A minimal Socket.IO (protocol v5 / Engine.IO v4) server over WebSocket.

KhaiDocs' client uses Socket.IO for exactly one thing: tabs of the same user
tell each other about tree and page changes with ``socket.emit("message",
event)`` and listen with ``socket.on("message", ...)``. It connects with
``transports: ["websocket"]`` only, so this implements the WebSocket
transport, the default namespace ``/`` and plain JSON events (no binary, no
acknowledgements, no rooms). ``python-socketio`` is not a dependency.

Wire format (one text frame per Engine.IO packet): ``0{...}`` open (server),
``2`` ping (server, every ``PING_INTERVAL``) / ``3`` pong (client),
``4`` message wrapping a Socket.IO packet: ``40`` connect (the server
answers ``40{"sid": ...}``), ``41`` disconnect, ``42["message", {...}]``
event. ``1`` close.

Identity comes from the Khai session at the upgrade; a connection only ever
joins its own user's "room", so events cannot cross users.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import secrets
from typing import Any

from aiohttp import WSMsgType, web

logger = logging.getLogger(__name__)

PING_INTERVAL = 25.0
PING_TIMEOUT = 20.0
MAX_PAYLOAD = 1_000_000
MAX_EVENT = 256 * 1024
MAX_CONNECTIONS_PER_USER = 32


class Connection:
    def __init__(self, ws: web.WebSocketResponse, user_id: str, session: str = "") -> None:
        self.ws = ws
        self.user_id = user_id
        self.session = session
        self.sid = secrets.token_urlsafe(12)
        self.connected = False  # the Socket.IO namespace connect packet was seen
        self.last_seen = asyncio.get_running_loop().time()


class SocketHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[Connection]] = {}

    def count(self, user_id: str) -> int:
        return len(self._connections.get(user_id, ()))

    def publish(self, user_id: str, event: Any, *, exclude: str | None = None) -> None:
        """Send ``event`` as a Socket.IO ``message`` to the user's tabs."""

        frame = "42" + json.dumps(["message", event], ensure_ascii=False, separators=(",", ":"))
        for conn in list(self._connections.get(user_id, ())):
            if conn.connected and conn.sid != exclude and not conn.ws.closed:
                asyncio.ensure_future(self._send(conn, frame))

    @staticmethod
    async def _send(conn: Connection, frame: str) -> None:
        with contextlib.suppress(ConnectionError, RuntimeError):
            await conn.ws.send_str(frame)

    async def close_all(self, code: int = 1001) -> None:
        for conns in list(self._connections.values()):
            for conn in list(conns):
                with contextlib.suppress(Exception):
                    await conn.ws.close(code=code, message=b"Server shutting down")

    async def close_user(self, user_id: str, session: str | None = None, code: int = 4401) -> None:
        """Close a user's sockets (those of one session when given)."""

        for conn in list(self._connections.get(user_id, ())):
            if session is None or conn.session == session:
                with contextlib.suppress(Exception):
                    await conn.ws.close(code=code, message=b"Signed out")

    # -- the endpoint -------------------------------------------------------------

    async def handle(
        self, request: web.Request, user_id: str, session: str = ""
    ) -> web.StreamResponse:
        query = request.query
        if query.get("EIO") != "4":
            return _engine_error(request, 5, "Unsupported protocol version")
        if query.get("transport") != "websocket":
            return _engine_error(request, 0, "Only the websocket transport is supported")
        if self.count(user_id) >= MAX_CONNECTIONS_PER_USER:
            return _engine_error(request, 1, "Too many connections", status=429)
        ws = web.WebSocketResponse(max_msg_size=MAX_PAYLOAD, heartbeat=None)
        await ws.prepare(request)
        conn = Connection(ws, user_id, session)
        self._connections.setdefault(user_id, set()).add(conn)
        await ws.send_str(
            "0"
            + json.dumps(
                {
                    "sid": conn.sid,
                    "upgrades": [],
                    "pingInterval": int(PING_INTERVAL * 1000),
                    "pingTimeout": int(PING_TIMEOUT * 1000),
                    "maxPayload": MAX_PAYLOAD,
                },
                separators=(",", ":"),
            )
        )
        pinger = asyncio.ensure_future(self._ping(conn))
        try:
            async for message in ws:
                if message.type != WSMsgType.TEXT:
                    continue
                conn.last_seen = asyncio.get_running_loop().time()
                await self._packet(conn, message.data)
        finally:
            pinger.cancel()
            conns = self._connections.get(user_id)
            if conns is not None:
                conns.discard(conn)
                if not conns:
                    self._connections.pop(user_id, None)
        return ws

    @staticmethod
    async def _ping(conn: Connection) -> None:
        loop = asyncio.get_running_loop()
        while not conn.ws.closed:
            await asyncio.sleep(PING_INTERVAL)
            if loop.time() - conn.last_seen > PING_INTERVAL + PING_TIMEOUT:
                await conn.ws.close(code=1001, message=b"ping timeout")
                return
            with contextlib.suppress(ConnectionError, RuntimeError):
                await conn.ws.send_str("2")

    async def _packet(self, conn: Connection, data: str) -> None:
        if not data:
            return
        kind, body = data[0], data[1:]
        if kind == "3":  # pong
            return
        if kind == "2":  # a client ping (v3 style); answer politely
            await conn.ws.send_str("3" + body)
            return
        if kind == "1":  # close
            await conn.ws.close()
            return
        if kind != "4" or not body:
            return
        sio_type, payload = body[0], body[1:]
        if sio_type == "0":  # connect to the default namespace
            if payload.startswith("/") and not payload.startswith("/,"):
                await conn.ws.send_str(
                    "44" + payload.split(",", 1)[0] + "," + json.dumps({"message": "Invalid namespace"})
                )
                return
            conn.connected = True
            await conn.ws.send_str("40" + json.dumps({"sid": conn.sid}, separators=(",", ":")))
        elif sio_type == "1":  # disconnect
            conn.connected = False
        elif sio_type == "2" and conn.connected:
            if len(payload) > MAX_EVENT:
                return
            start = 0
            while start < len(payload) and payload[start].isdigit():
                start += 1  # an ack id, which this server never answers
            try:
                event = json.loads(payload[start:])
            except ValueError:
                return
            if (
                isinstance(event, list) and len(event) == 2 and event[0] == "message"
                and isinstance(event[1], dict)
            ):
                self.publish(conn.user_id, event[1], exclude=conn.sid)


def _engine_error(request: web.Request, code: int, message: str, status: int = 400) -> web.Response:
    return web.json_response({"code": code, "message": message}, status=status)
