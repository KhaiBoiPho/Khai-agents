"""Same-origin passage to the KhaiDocs (Docmost) server for the web client.

KhaiDocs runs Docmost's browser client inside the web app; that client calls
``/api/*``, ``/socket.io/*`` and ``/collab`` on its own origin. In development
Vite proxies those paths. Here the service does the same, so the web build
works without the dev server. Routes the service owns itself (``/api/rpc``,
``/api/session``, ``/api/uploads``, ``/api/download``) are registered first
and keep winning; everything else under those prefixes goes to Docmost.

Every proxied request still needs the DeepCode browser session, so in remote
mode Docmost is never reachable without signing in to DeepCode first.

Single sign-on: with ``KHAIDOCS_EMAIL`` and ``KHAIDOCS_PASSWORD`` set (e.g. in
the checkout's ``.env``), a browser that has no Docmost session yet is signed
in to Docmost here, so KhaiDocs opens straight into the wiki. The DeepCode
session above is what guards it; without the two variables Docmost shows its
own login page as usual.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

import aiohttp
from aiohttp import web

from app_server.browser_auth import BrowserAuth

DEFAULT_SERVER = "http://127.0.0.1:3456"
AUTH_COOKIE = "authToken"  # Docmost's session cookie (AuthController.setAuthCookie)
# Re-use a minted Docmost session briefly, so a page load's burst of parallel
# requests signs in once; each browser then keeps the cookie it is handed.
TOKEN_REUSE_SECONDS = 10 * 60

logger = logging.getLogger(__name__)

# Hop-by-hop headers (RFC 9110 §7.6.1) plus the ones aiohttp recomputes.
_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    "content-encoding",
}


class KhaiDocsProxy:
    def __init__(self, auth: BrowserAuth, assets: Path, *, server: str | None = None):
        self.auth = auth
        self.assets = (assets / "khaidocs").resolve()
        self.server = (server or os.environ.get("KHAIDOCS_SERVER_URL") or DEFAULT_SERVER).rstrip("/")
        self._session: aiohttp.ClientSession | None = None
        self._credentials = (
            os.environ.get("KHAIDOCS_EMAIL", "").strip(),
            os.environ.get("KHAIDOCS_PASSWORD", ""),
        )
        self._token: tuple[str, float] | None = None
        self._login_lock = asyncio.Lock()

    def set_credentials(self, email: str, password: str) -> None:
        """Adopt credentials provisioned after startup (khaidocs_stack)."""
        self._credentials = (email.strip(), password)
        self._token = None

    def routes(self):
        return [
            web.get("/khaidocs/{path:.*}", self.static),
            web.route("*", "/api/{tail:.*}", self.forward),
            web.route("*", "/socket.io/{tail:.*}", self.forward),
            web.route("*", "/collab", self.forward),
            web.route("*", "/collab/{tail:.*}", self.forward),
        ]

    async def close(self, _app=None) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    def _client(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                auto_decompress=False,
                timeout=aiohttp.ClientTimeout(total=None, connect=10, sock_read=None),
            )
        return self._session

    async def static(self, request: web.Request) -> web.FileResponse:
        """Docmost's locales and icons, copied into the web build by Vite."""
        relative = Path(request.match_info["path"])
        path = (self.assets / relative).resolve()
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or not path.is_relative_to(self.assets)
            or not path.is_file()
        ):
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    async def forward(self, request: web.Request) -> web.StreamResponse:
        self.auth.require(request)
        target = self.server + request.rel_url.path_qs
        headers = {
            name: value
            for name, value in request.headers.items()
            if name.lower() not in _HOP_HEADERS
        }
        headers["X-Forwarded-For"] = request.remote or ""
        headers["X-Forwarded-Proto"] = request.scheme
        headers["X-Forwarded-Host"] = request.host
        if request.headers.get("Upgrade", "").lower() == "websocket":
            return await self._websocket(request, target, headers)
        signing_in = not request.path.startswith("/api/auth/")
        minted = None
        if AUTH_COOKIE not in request.cookies and signing_in:
            minted = await self._sign_in()
            if minted:
                headers["Cookie"] = _with_auth_cookie(request.headers.get("Cookie"), minted)
        upstream = await self._send(request, target, headers)
        if upstream.status == 401 and signing_in and not minted and not request.body_exists:
            # The browser's Docmost session expired: sign in afresh and retry
            # once (only bodiless requests; a consumed body can't be resent).
            self._token = None
            fresh = await self._sign_in()
            if fresh:
                upstream.release()
                minted = fresh
                headers["Cookie"] = _with_auth_cookie(request.headers.get("Cookie"), minted)
                upstream = await self._send(request, target, headers)
        async with upstream:
            response = web.StreamResponse(status=upstream.status, reason=upstream.reason)
            for name, value in upstream.headers.items():
                if name.lower() not in _HOP_HEADERS:
                    response.headers.add(name, value)
            if "Content-Encoding" in upstream.headers:
                response.headers["Content-Encoding"] = upstream.headers["Content-Encoding"]
            if minted:
                response.set_cookie(
                    AUTH_COOKIE, minted, path="/", httponly=True, samesite="Lax"
                )
            await response.prepare(request)
            async for chunk in upstream.content.iter_any():
                await response.write(chunk)
            await response.write_eof()
            return response

    async def _send(self, request, target, headers) -> aiohttp.ClientResponse:
        try:
            return await self._client().request(
                request.method,
                target,
                headers=headers,
                data=request.content if request.body_exists else None,
                allow_redirects=False,
                # Forward the browser's headers as sent. aiohttp would add a
                # Content-Type of application/octet-stream to a bodiless POST,
                # which Docmost's Fastify rejects with 415.
                skip_auto_headers=("Content-Type", "Accept-Encoding", "User-Agent"),
            )
        except aiohttp.ClientError as exc:
            raise web.HTTPBadGateway(text=f"KhaiDocs server unreachable: {exc}") from None

    async def _sign_in(self) -> str | None:
        """A Docmost session for the configured account, or None."""
        email, password = self._credentials
        if not email or not password:
            return None
        async with self._login_lock:
            if self._token and self._token[1] > time.monotonic():
                return self._token[0]
            try:
                async with self._client().post(
                    self.server + "/api/auth/login",
                    json={"email": email, "password": password},
                ) as response:
                    morsel = response.cookies.get(AUTH_COOKIE)
                    if response.status != 200 or morsel is None:
                        logger.warning("KhaiDocs sign-in failed: HTTP %s", response.status)
                        return None
            except aiohttp.ClientError as exc:
                logger.warning("KhaiDocs sign-in failed: %s", exc)
                return None
            self._token = (morsel.value, time.monotonic() + TOKEN_REUSE_SECONDS)
            return morsel.value

    async def _websocket(self, request, target, headers) -> web.WebSocketResponse:
        for name in ("Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions"):
            headers.pop(name, None)
        protocols = [
            value.strip()
            for value in request.headers.get("Sec-WebSocket-Protocol", "").split(",")
            if value.strip()
        ]
        headers.pop("Sec-WebSocket-Protocol", None)
        try:
            upstream = await self._client().ws_connect(
                target.replace("http", "ws", 1),
                headers=headers,
                protocols=protocols,
                max_msg_size=0,
            )
        except aiohttp.ClientError as exc:
            raise web.HTTPBadGateway(text=f"KhaiDocs server unreachable: {exc}") from None
        downstream = web.WebSocketResponse(
            protocols=[upstream.protocol] if upstream.protocol else (), max_msg_size=0
        )
        await downstream.prepare(request)

        async def pump(source, sink):
            async for message in source:
                if message.type == aiohttp.WSMsgType.TEXT:
                    await sink.send_str(message.data)
                elif message.type == aiohttp.WSMsgType.BINARY:
                    await sink.send_bytes(message.data)
                else:
                    break

        tasks = [
            asyncio.ensure_future(pump(downstream, upstream)),
            asyncio.ensure_future(pump(upstream, downstream)),
        ]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await upstream.close()
            await downstream.close()
        return downstream


def _with_auth_cookie(cookie_header: str | None, token: str) -> str:
    """The browser's Cookie header with Docmost's session set to ``token``."""
    pairs = [
        pair.strip()
        for pair in (cookie_header or "").split(";")
        if pair.strip() and not pair.strip().startswith(f"{AUTH_COOKIE}=")
    ]
    return "; ".join([*pairs, f"{AUTH_COOKIE}={token}"])
