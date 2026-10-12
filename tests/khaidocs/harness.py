"""A KhaiDocs-only aiohttp app for tests: the caller is named by a header."""

from __future__ import annotations

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from app_server.khaidocs.api import KhaiUser
from app_server.khaidocs.context import KhaiDocsContext
from app_server.khaidocs.routes import install
from core.persistence import Database


def build_app(database: Database, users: dict[str, KhaiUser]):
    async def authenticate(request: web.Request) -> KhaiUser:
        token = request.headers.get("X-Test-User") or request.query.get("as", "")
        user = users.get(token)
        if user is None:
            raise web.HTTPUnauthorized(text="Please sign in.")
        return user

    ctx = KhaiDocsContext(database, authenticate)
    app = web.Application(client_max_size=64 * 1024 * 1024)
    install(app, ctx)
    return app, ctx


async def start(database: Database, users: dict[str, KhaiUser]):
    app, ctx = build_app(database, users)
    client = TestClient(TestServer(app))
    await client.start_server()
    return client, ctx


class Api:
    """Calls like the browser does: POST JSON, read {data, success, status}."""

    def __init__(self, client: TestClient, user: str) -> None:
        self.client = client
        self.headers = {"X-Test-User": user}

    async def post(self, path: str, body: dict | None = None, *, status: int = 200):
        response = await self.client.post("/api/" + path, json=body or {}, headers=self.headers)
        payload = await response.json()
        assert response.status == status, (path, response.status, payload)
        return payload["data"] if status == 200 and isinstance(payload, dict) and "data" in payload else payload
