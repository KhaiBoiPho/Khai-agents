from __future__ import annotations

import asyncio

from aiohttp import web
from aiohttp.test_utils import TestServer

from tests.app_server.support import control_server
from tests.app_server.test_web_surface import browser_headers


async def _upstream() -> TestServer:
    """A stand-in Docmost server that reports what reached it."""

    async def echo(request: web.Request) -> web.Response:
        return web.json_response(
            {
                "method": request.method,
                "path": request.path_qs,
                "contentType": request.headers.get("Content-Type"),
                "body": (await request.read()).decode(),
            }
        )

    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", echo)
    server = TestServer(app)
    await server.start_server()
    return server


def test_proxy_requires_the_browser_session(tmp_path, monkeypatch):
    async def scenario():
        upstream = await _upstream()
        monkeypatch.setenv("KHAIDOCS_SERVER_URL", str(upstream.make_url("")).rstrip("/"))
        try:
            async with control_server(tmp_path) as (_control, client):
                response = await client.get("/api/health")
                assert response.status == 401
        finally:
            await upstream.close()

    asyncio.run(scenario())


def test_proxy_forwards_docmost_calls_and_keeps_service_routes(tmp_path, monkeypatch):
    async def scenario():
        upstream = await _upstream()
        monkeypatch.setenv("KHAIDOCS_SERVER_URL", str(upstream.make_url("")).rstrip("/"))
        try:
            async with control_server(tmp_path) as (control, client):
                headers = await browser_headers(control, client)

                # A bodiless POST must not gain a Content-Type on the way:
                # Docmost's Fastify answers that with 415.
                response = await client.post(
                    "/api/users/me?x=1",
                    headers=headers,
                    # As a browser sends it: aiohttp's client would add one.
                    skip_auto_headers=["Content-Type"],
                )
                assert response.status == 200
                echoed = await response.json()
                assert echoed == {
                    "method": "POST",
                    "path": "/api/users/me?x=1",
                    "contentType": None,
                    "body": "",
                }

                response = await client.post(
                    "/api/pages/info",
                    headers={**headers, "Content-Type": "application/json"},
                    data='{"pageId":"p1"}',
                )
                assert (await response.json())["body"] == '{"pageId":"p1"}'

                # The service's own /api routes are registered first and win.
                response = await client.get("/api/session", headers=headers)
                assert (await response.json())["authenticated"] is True
        finally:
            await upstream.close()

    asyncio.run(scenario())


async def _docmost_with_login(valid_tokens: set[str]) -> TestServer:
    """A stand-in Docmost that signs in one account and checks its cookie."""

    async def login(request: web.Request) -> web.Response:
        credentials = await request.json()
        if credentials != {"email": "me@example.test", "password": "pw"}:
            return web.json_response({}, status=401)
        token = f"token-{len(valid_tokens)}"
        valid_tokens.add(token)
        response = web.json_response({})
        response.set_cookie("authToken", token, httponly=True)
        return response

    async def me(request: web.Request) -> web.Response:
        if request.cookies.get("authToken") not in valid_tokens:
            return web.json_response({"message": "Unauthorized"}, status=401)
        return web.json_response({"token": request.cookies["authToken"]})

    app = web.Application()
    app.router.add_post("/api/auth/login", login)
    app.router.add_post("/api/users/me", me)
    server = TestServer(app)
    await server.start_server()
    return server


def test_proxy_signs_in_to_docmost_when_configured(tmp_path, monkeypatch):
    async def scenario():
        tokens: set[str] = set()
        upstream = await _docmost_with_login(tokens)
        monkeypatch.setenv("KHAIDOCS_SERVER_URL", str(upstream.make_url("")).rstrip("/"))
        monkeypatch.setenv("KHAIDOCS_EMAIL", "me@example.test")
        monkeypatch.setenv("KHAIDOCS_PASSWORD", "pw")
        try:
            async with control_server(tmp_path) as (control, client):
                headers = await browser_headers(control, client)

                # No Docmost cookie yet: signed in, and the browser keeps it.
                response = await client.post("/api/users/me", headers=headers)
                assert response.status == 200
                assert response.cookies["authToken"].value == "token-0"

                # An expired Docmost session is replaced, not bounced to login.
                client.session.cookie_jar.clear()
                stale = {**headers, "Cookie": headers["Cookie"] + "; authToken=old"}
                response = await client.post("/api/users/me", headers=stale)
                assert response.status == 200
                assert (await response.json())["token"] == "token-1"
        finally:
            await upstream.close()

    asyncio.run(scenario())
