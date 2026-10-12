"""The single-user service serves the native KhaiDocs backend directly."""

from __future__ import annotations

import asyncio

from tests.app_server.support import control_server
from tests.app_server.test_web_surface import browser_headers


def test_khaidocs_requires_the_browser_session(tmp_path):
    async def scenario():
        async with control_server(tmp_path) as (control, client):
            response = await client.post(
                "/api/users/me", headers={"Origin": control.record.url}
            )
            assert response.status == 401

    asyncio.run(scenario())


def test_khaidocs_serves_the_primary_administrator(tmp_path):
    async def scenario():
        async with control_server(tmp_path) as (control, client):
            headers = await browser_headers(control, client)
            json_headers = {**headers, "Content-Type": "application/json"}

            response = await client.post("/api/users/me", headers=json_headers, data="{}")
            assert response.status == 200
            me = (await response.json())["data"]
            assert me["user"]["id"]

            response = await client.post(
                "/api/pages/create",
                headers=json_headers,
                data='{"title": "Service page"}',
            )
            assert response.status == 200
            created = (await response.json())["data"]
            response = await client.post(
                "/api/pages/info",
                headers=json_headers,
                data=f'{{"pageId": "{created["slugId"]}"}}',
            )
            assert (await response.json())["data"]["title"] == "Service page"

            # The service's own /api routes are registered first and win.
            response = await client.get("/api/session", headers=headers)
            assert (await response.json())["authenticated"] is True

    asyncio.run(scenario())
