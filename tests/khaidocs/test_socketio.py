from __future__ import annotations

import asyncio
import json

import pytest
from aiohttp.client_exceptions import WSServerHandshakeError

from app_server.khaidocs.api import KhaiUser
from tests.khaidocs.conftest import make_user
from tests.khaidocs.harness import start


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 30))


@pytest.fixture
def users(base):
    return {n: KhaiUser(make_user(base, n), n, n.title(), "member") for n in ("alice", "bob")}


async def connect(client, user):
    ws = await client.ws_connect(
        "/socket.io/?EIO=4&transport=websocket", headers={"X-Test-User": user}
    )
    opened = await asyncio.wait_for(ws.receive_str(), 5)
    assert opened.startswith("0")
    info = json.loads(opened[1:])
    assert info["upgrades"] == [] and info["pingInterval"] > 0 and info["sid"]
    await ws.send_str("40")
    ack = await asyncio.wait_for(ws.receive_str(), 5)
    assert ack.startswith("40{") and "sid" in json.loads(ack[2:])
    return ws


def test_handshake_and_user_scoped_relay(base, users) -> None:
    async def scenario():
        client, ctx = await start(base, users)
        try:
            a1, a2, b1 = (await connect(client, "alice"), await connect(client, "alice"),
                          await connect(client, "bob"))
            event = {"operation": "refetchRootTreeNodeEvent", "spaceId": "s"}
            await a1.send_str("42" + json.dumps(["message", event]))
            got = await asyncio.wait_for(a2.receive_str(), 5)
            assert got.startswith("42") and json.loads(got[2:]) == ["message", event]
            # not echoed to the sender, never to another user
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(a1.receive_str(), 0.3)
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(b1.receive_str(), 0.3)
            # server-side publish reaches every tab of that user
            ctx.sockets.publish(users["alice"].id, {"operation": "invalidate", "entity": ["x"]})
            assert "invalidate" in await asyncio.wait_for(a1.receive_str(), 5)
            assert "invalidate" in await asyncio.wait_for(a2.receive_str(), 5)
            # garbage and non-message events are ignored
            await a1.send_str("42" + json.dumps(["other", {"a": 1}]))
            await a1.send_str("42not json")
            await a1.send_str("3")
            for ws in (a1, a2, b1):
                await ws.close()
        finally:
            await client.close()

    run(scenario())


def test_unauthenticated_and_polling_are_refused(base, users) -> None:
    async def scenario():
        client, _ = await start(base, users)
        try:
            with pytest.raises(WSServerHandshakeError) as err:
                await client.ws_connect("/socket.io/?EIO=4&transport=websocket")
            assert err.value.status == 401
            r = await client.get("/socket.io/?EIO=4&transport=polling", headers={"X-Test-User": "alice"})
            assert r.status == 400 and (await r.json())["message"]
            r = await client.get("/socket.io/?EIO=3&transport=websocket", headers={"X-Test-User": "alice"})
            assert r.status == 400
        finally:
            await client.close()

    run(scenario())
