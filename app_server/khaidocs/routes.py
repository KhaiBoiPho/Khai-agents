"""Mounts every KhaiDocs module on an aiohttp application.

``install(app, ctx)`` adds ``/api/*`` (REST), ``/socket.io/`` and ``/collab``.
Call it BEFORE any catch-all route under ``/api/{tail}``.
Module order matters: aiohttp answers with the first matching route, so real
modules come before ``stubs``.
"""

from __future__ import annotations

import importlib
import logging

from aiohttp import web

from app_server.khaidocs import files, pages, search, spaces, stubs, workspace
from app_server.khaidocs.api import Router, mount
from app_server.khaidocs.context import KhaiDocsContext

logger = logging.getLogger(__name__)

# Phase 2/3 modules: dropped into app_server/khaidocs/<name>.py with a
# module-level ``router = Router()``; picked up here when present.
OPTIONAL_MODULES = (
    "comments", "labels", "notifications", "import_export", "templates", "agent_tools",
)


def routers() -> list[Router]:
    found: list[Router] = []
    for name in OPTIONAL_MODULES:
        try:
            module = importlib.import_module(f"app_server.khaidocs.{name}")
        except ModuleNotFoundError as exc:
            if exc.name != f"app_server.khaidocs.{name}":
                raise
            continue
        found.append(module.router)
    found += [pages.router, spaces.router, files.router, search.router, workspace.router]
    found.append(stubs.router)
    return found


def install(app: web.Application, ctx: KhaiDocsContext) -> None:
    from app_server.khaidocs import collab

    defs: list[web.RouteDef] = []
    for router in routers():
        mount(defs, router, ctx)
    app.add_routes(defs)
    collab.install(app, ctx)
    from app_server.khaidocs import agent_events

    agent_events.install(app, ctx)

    async def socket_io(request: web.Request) -> web.StreamResponse:
        user = await ctx.authenticate(request)
        return await ctx.sockets.handle(request, user.id, user.session)

    app.add_routes(
        [web.get("/socket.io/", socket_io), web.get("/socket.io", socket_io)]
    )
