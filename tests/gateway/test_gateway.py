"""The hosted gateway: accounts, administration, origin checks and relays."""

from __future__ import annotations

import asyncio
import secrets
from pathlib import Path

import pytest
from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer
from redis.asyncio import Redis

from app_server.gateway.server import Gateway, GatewaySettings
from app_server.gateway.workers import WorkerLaunch, WorkerManager, WorkerSettings
from core.auth.provisioning import WorkerRoles
from core.persistence.database import Database
from tests.conftest import TEST_REDIS_URL

pytestmark = pytest.mark.skipif(not TEST_REDIS_URL, reason="no test Redis configured")

ORIGIN = "http://gateway.test"
PASSWORD = "correct horse battery"


class FakeBackend:
    """A "worker" that echoes, and checks the gateway's bearer token."""

    def __init__(self) -> None:
        self.started: list[str] = []
        self.stopped: list[str] = []
        self.environments: list[dict[str, str]] = []
        self._runners: dict[str, web.AppRunner] = {}

    async def start(self, launch: WorkerLaunch):
        token = launch.token

        def authorized(request: web.Request) -> None:
            if request.headers.get("Authorization") != f"Bearer {token}":
                raise web.HTTPUnauthorized()

        async def ready(_request):
            return web.json_response({"status": "ready"})

        async def rpc(request):
            authorized(request)
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            async for message in ws:
                if message.type == WSMsgType.TEXT:
                    await ws.send_str(f"{launch.user_id}:{message.data}")
            return ws

        async def upload(request):
            authorized(request)
            return web.Response(body=await request.read())

        app = web.Application()
        app.add_routes(
            [
                web.get("/health/ready", ready),
                web.get("/api/rpc", rpc),
                web.post("/api/uploads", upload),
            ]
        )
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
        self._runners[launch.user_id] = runner
        self.started.append(launch.user_id)
        self.environments.append(launch.environment)
        return f"http://127.0.0.1:{port}", launch.user_id

    async def stop(self, handle):
        runner = self._runners.pop(handle, None)
        if runner is not None:
            self.stopped.append(handle)
            await runner.cleanup()

    async def alive(self, handle):
        return handle in self._runners


def _run(scenario, tmp_path: Path) -> None:
    async def main():
        database = Database(tmp_path / "state")
        database.initialize()
        redis = Redis.from_url(TEST_REDIS_URL)
        backend = FakeBackend()
        workers = WorkerManager(
            WorkerSettings(data_root=tmp_path / "data", database_url=database.url),
            WorkerRoles(database),
            backend,
        )
        gateway = Gateway(
            GatewaySettings(public_origin=ORIGIN, redis_url=TEST_REDIS_URL),
            database,
            redis,
            workers,
        )
        prefix = f"test:{secrets.token_hex(4)}:"
        for component in (gateway.sessions, gateway.login_limits, gateway.register_limits):
            component._prefix = prefix
        client = TestClient(TestServer(gateway.application()))
        await client.start_server()
        try:
            await scenario(client, gateway, backend)
        finally:
            await client.close()
            cleanup = Redis.from_url(TEST_REDIS_URL)
            keys = [key async for key in cleanup.scan_iter(match=prefix + "*")]
            if keys:
                await cleanup.delete(*keys)
            await cleanup.aclose()
            for user_id in backend.started:
                WorkerRoles(database).drop(user_id)

    asyncio.run(asyncio.wait_for(main(), 60))


def _headers() -> dict[str, str]:
    return {"Origin": ORIGIN}


async def _register(client, username: str) -> dict:
    response = await client.post(
        "/auth/register",
        json={"username": username, "password": PASSWORD, "displayName": username},
        headers=_headers(),
    )
    assert response.status == 201, await response.text()
    return (await response.json())["user"]


async def _login(client, username: str):
    return await client.post(
        "/auth/login",
        json={"username": username, "password": PASSWORD},
        headers=_headers(),
    )


def test_register_wait_for_approval_then_use(tmp_path: Path) -> None:
    async def scenario(client, gateway, backend):
        admin = await _register(client, "khai")
        assert admin["role"] == "admin"
        friend = await _register(client, "friend")
        assert friend["status"] == "pending"

        response = await _login(client, "friend")
        assert response.status == 401
        assert (await response.json())["code"] == "ACCOUNT_NOT_ACTIVE"

        assert (await _login(client, "khai")).status == 200
        listing = await client.get("/api/admin/users?status=pending")
        assert [user["username"] for user in (await listing.json())["users"]] == ["friend"]
        approved = await client.post(
            f"/api/admin/users/{friend['id']}/approve", json={}, headers=_headers()
        )
        assert (await approved.json())["user"]["status"] == "active"

        client.session.cookie_jar.clear()
        assert (await _login(client, "friend")).status == 200
        session = await (await client.get("/api/session")).json()
        assert session["user"]["username"] == "friend"
        # A member cannot administer.
        forbidden = await client.get("/api/admin/users")
        assert forbidden.status == 403

    _run(scenario, tmp_path)


def test_rpc_and_uploads_reach_only_the_signed_in_users_worker(tmp_path: Path) -> None:
    async def scenario(client, gateway, backend):
        admin = await _register(client, "khai")
        await _login(client, "khai")
        ws = await client.ws_connect("/api/rpc", headers=_headers())
        await ws.send_str("hello")
        assert (await ws.receive_str()) == f"{admin['id']}:hello"
        await ws.close()

        upload = await client.post(
            "/api/uploads?threadId=t",
            data=b"bytes",
            headers={**_headers(), "Content-Type": "application/octet-stream"},
        )
        assert upload.status == 200 and await upload.read() == b"bytes"
        assert backend.started == [admin["id"]]
        environment = backend.environments[0]
        assert environment["KHAI_USER_ID"] == admin["id"]
        # The worker gets its own database role, never the gateway's.
        assert environment["KHAI_DATABASE_URL"].startswith("postgresql://u_")

    _run(scenario, tmp_path)


def test_requests_without_a_session_or_from_other_origins_are_refused(
    tmp_path: Path,
) -> None:
    async def scenario(client, gateway, backend):
        await _register(client, "khai")
        assert (await client.get("/api/session")).status == 401
        assert (await client.post("/api/uploads", data=b"x", headers=_headers())).status == 401
        with pytest.raises(Exception):
            await client.ws_connect("/api/rpc", headers=_headers())

        await _login(client, "khai")
        evil = await client.post(
            "/auth/logout", headers={"Origin": "https://evil.example"}
        )
        assert evil.status == 403
        no_origin = await client.post("/auth/logout")
        assert no_origin.status == 403
        with pytest.raises(Exception):
            await client.ws_connect("/api/rpc", headers={"Origin": "https://evil.example"})
        assert backend.started == []

    _run(scenario, tmp_path)


def test_disabling_a_user_ends_their_sessions_and_worker(tmp_path: Path) -> None:
    async def scenario(client, gateway, backend):
        await _register(client, "khai")
        friend = await _register(client, "friend")
        await _login(client, "khai")
        await client.post(f"/api/admin/users/{friend['id']}/approve", json={}, headers=_headers())

        from aiohttp import ClientSession, CookieJar

        async with ClientSession(
            base_url=str(client.make_url("/")), cookie_jar=CookieJar(unsafe=True)
        ) as other:
            await other.post(
                "/auth/login",
                json={"username": "friend", "password": PASSWORD},
                headers=_headers(),
            )
            ws = await other.ws_connect("/api/rpc", headers=_headers())
            await ws.send_str("ping")
            await ws.receive_str()

            disabled = await client.post(
                f"/api/admin/users/{friend['id']}/disable", json={}, headers=_headers()
            )
            assert disabled.status == 200
            message = await ws.receive()
            assert message.type in {WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING}
            assert (await other.get("/api/session")).status == 401
        assert backend.stopped == [friend["id"]]

    _run(scenario, tmp_path)


def test_login_is_rate_limited(tmp_path: Path) -> None:
    async def scenario(client, gateway, backend):
        await _register(client, "khai")
        statuses = []
        for _ in range(12):
            response = await client.post(
                "/auth/login",
                json={"username": "khai", "password": "wrong password!!"},
                headers=_headers(),
            )
            statuses.append(response.status)
        assert statuses[:10] == [401] * 10
        assert statuses[10:] == [429, 429]

    _run(scenario, tmp_path)


def test_devices_are_listed_and_can_be_signed_out_one_by_one(tmp_path: Path) -> None:
    async def scenario(client, gateway, backend):
        admin = await _register(client, "khai")
        friend = await _register(client, "friend")
        await _login(client, "khai")
        await client.post(
            f"/api/admin/users/{friend['id']}/approve", json={}, headers=_headers()
        )

        # The friend signs in from a phone, keeping that session's cookie.
        phone = TestClient(client.server)
        await phone.start_server()
        try:
            await phone.post(
                "/auth/login",
                json={"username": "friend", "password": PASSWORD},
                headers={**_headers(), "User-Agent": "Phone Browser"},
            )
            ws = await phone.ws_connect("/api/rpc", headers=_headers())

            listing = await (await phone.get("/auth/sessions")).json()
            [device] = listing["sessions"]
            assert device["userAgent"] == "Phone Browser"
            assert device["id"] == listing["current"]
            assert device["address"]

            # The admin sees the friend's device and signs it out.
            seen = await (
                await client.get(f"/api/admin/users/{friend['id']}/sessions")
            ).json()
            assert [item["id"] for item in seen["sessions"]] == [device["id"]]
            ended = await client.post(
                f"/api/admin/users/{friend['id']}/sessions/{device['id']}/revoke",
                json={},
                headers=_headers(),
            )
            assert ended.status == 200
            closed = await ws.receive()
            assert closed.type in {WSMsgType.CLOSE, WSMsgType.CLOSED}
            assert (await phone.get("/api/session")).status in {200, 401}
            assert (await (await phone.get("/api/session")).json()).get("user") is None

            # Members cannot see anyone else's devices.
            await phone.post(
                "/auth/login",
                json={"username": "friend", "password": PASSWORD},
                headers=_headers(),
            )
            forbidden = await phone.get(f"/api/admin/users/{admin['id']}/sessions")
            assert forbidden.status == 403

            # A user can end their own other device.
            own = await (await client.get("/auth/sessions")).json()
            current = own["current"]
            await _login(client, "khai")
            newer = await (await client.get("/auth/sessions")).json()
            assert len(newer["sessions"]) == 2
            response = await client.post(
                f"/auth/sessions/{current}/revoke", json={}, headers=_headers()
            )
            assert response.status == 200
            remaining = await (await client.get("/auth/sessions")).json()
            assert [item["id"] for item in remaining["sessions"]] == [newer["current"]]
        finally:
            await phone.close()

    _run(scenario, tmp_path)
