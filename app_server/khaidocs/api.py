"""Plumbing shared by every KhaiDocs route module.

A route module owns a :class:`Router`, decorates async handlers with
``@router.post("pages/info")`` (paths are relative to ``/api``), and exposes
``router`` for ``app_server.khaidocs.routes`` to mount. A handler receives a
:class:`Call` and returns the value for the response's ``data`` field (or a
``web.StreamResponse`` / :class:`Raw` for responses that are not enveloped).
Errors raised by the store (core.khaidocs.errors) and :class:`ApiError` become
client-shaped JSON errors, so the client's ``error.response.data.message``
keeps working.

Wire format (what the vendored client expects, written from its call sites):

* success   ``{"data": <value>, "success": true, "status": 200}``
* error     ``{"message": ..., "error": <reason>, "statusCode": N}``
* list      ``data = {"items": [...], "meta": {limit, hasNextPage,
  hasPrevPage, nextCursor, prevCursor}}``
* JSON keys are camelCase, times ISO-8601 UTC strings.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from aiohttp import web

from core.khaidocs import KhaiDocsError, KhaiDocsStore

logger = logging.getLogger(__name__)

MAX_JSON_BODY = 2 * 1024 * 1024
_REASONS = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type",
    501: "Not Implemented",
}


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True, slots=True)
class KhaiUser:
    """The signed-in Khai account, as KhaiDocs sees it."""

    id: str
    username: str
    display_name: str
    role: str  # "admin" | "member"
    created_at: datetime | None = None
    # The Khai session this request/socket belongs to (for sign-out cleanup).
    session: str = ""


@dataclass
class Raw:
    """A pre-built (not enveloped) response."""

    response: web.StreamResponse


@dataclass
class Call:
    request: web.Request
    user: KhaiUser
    store: KhaiDocsStore
    ctx: Any  # KhaiDocsContext
    body: dict = field(default_factory=dict)

    async def run(self, function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """Run a (synchronous) store call off the event loop."""

        return await asyncio.to_thread(function, *args, **kwargs)

    def need(self, name: str) -> Any:
        value = self.body.get(name)
        if value is None or value == "":
            raise ApiError(400, f"{name} is required")
        return value

    def publish(self, event: dict, *, exclude_sid: str | None = None) -> None:
        """Send a Socket.IO ``message`` event to this user's other tabs."""

        self.ctx.sockets.publish(self.user.id, event, exclude=exclude_sid)


Handler = Callable[[Call], Awaitable[Any]]


def to_json(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: to_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json(v) for v in value]
    return value


def ok(data: Any = None, status: int = 200) -> web.Response:
    return web.json_response(
        {"data": to_json(data), "success": True, "status": status},
        dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
    )


def error_response(status: int, message: str) -> web.Response:
    return web.json_response(
        {"message": message, "error": _REASONS.get(status, "Error"), "statusCode": status},
        status=status,
    )


def meta(limit: int, next_cursor: str | None, prev_cursor: str | None = None) -> dict:
    return {
        "limit": limit,
        "hasNextPage": next_cursor is not None,
        "hasPrevPage": prev_cursor is not None,
        "nextCursor": next_cursor,
        "prevCursor": prev_cursor,
    }


def page_of(items: list, limit: int, next_cursor: str | None = None) -> dict:
    return {"items": items, "meta": meta(limit, next_cursor)}


def camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def camelize(row: dict, *, drop: tuple[str, ...] = ()) -> dict:
    return {camel(k): v for k, v in row.items() if k not in drop}


class Router:
    def __init__(self) -> None:
        self.routes: list[tuple[str, str, Handler]] = []

    def post(self, path: str):
        return self._add("POST", path)

    def get(self, path: str):
        return self._add("GET", path)

    def _add(self, method: str, path: str):
        def decorator(handler: Handler) -> Handler:
            self.routes.append((method, path, handler))
            return handler

        return decorator


def mount(app_routes: list[web.RouteDef], router: Router, ctx: Any, *, prefix: str = "/api/") -> None:
    for method, path, handler in router.routes:
        app_routes.append(web.route(method, prefix + path.lstrip("/"), _wrap(ctx, handler)))


def _wrap(ctx: Any, handler: Handler):
    async def run(request: web.Request) -> web.StreamResponse:
        try:
            user = await ctx.authenticate(request)
            body: dict = {}
            if request.method == "POST" and request.content_type == "application/json":
                if (request.content_length or 0) > MAX_JSON_BODY:
                    raise ApiError(413, "Request body too large")
                try:
                    parsed = await request.json()
                except (ValueError, RecursionError):
                    raise ApiError(400, "Invalid JSON") from None
                body = parsed if isinstance(parsed, dict) else {}
            call = Call(request, user, ctx.store_for(user), ctx, body)
            result = await handler(call)
            if isinstance(result, Raw):
                return result.response
            if isinstance(result, web.StreamResponse):
                return result
            return ok(result)
        except web.HTTPException:
            raise
        except ApiError as exc:
            return error_response(exc.status, exc.message)
        except KhaiDocsError as exc:
            return error_response(exc.status, str(exc))
        except Exception:
            logger.exception("KhaiDocs %s %s failed", request.method, request.path)
            return error_response(500, "Internal server error")

    return run
