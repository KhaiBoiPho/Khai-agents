"""The hosted front door: accounts, administration, and each user's worker.

Routes (every one decides its own access; nothing is reachable by default):

=========================  =========  ========================================
Route                      Access     Purpose
=========================  =========  ========================================
GET  /health/live          public     liveness probe
GET  /, /assets/*, ...     public     the web client
GET  /auth/config          public     "this server has accounts"
POST /auth/register        public     create a pending account (rate limited)
POST /auth/login           public     sign in (rate limited per IP and name)
POST /auth/logout          session    end this session
POST /auth/logout-all      session    end every session of this user
POST /auth/password        session    change password (ends other sessions)
GET  /api/session          session    who is signed in
GET  /api/admin/users      admin      list accounts (pending first)
POST /api/admin/users/...  admin      approve, reject, disable, enable, role,
                                      allow/forbid running commands
GET  /api/rpc              session    WebSocket, relayed to the user's worker
POST /api/uploads          session    relayed to the user's worker
GET  /api/download         session    relayed to the user's worker
*    /api/*, /socket.io/*,  session    KhaiDocs (Docmost), as the user's own
     /collab                           Docmost account (gateway/khaidocs.py)
=========================  =========  ========================================

Browser state-changing requests must come from the public origin (CSRF), the
session cookie is HttpOnly, Secure (``__Host-``) over HTTPS and SameSite=Lax,
and responses carry a strict CSP. Workers are never reachable from browsers:
the gateway holds each worker's bearer token.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

import aiohttp
from aiohttp import WSMsgType, web
from redis.asyncio import Redis

from app_server.gateway.khaidocs import DocmostAccounts, KhaiDocsRelay
from app_server.gateway.qdrant import QdrantProvisioner
from app_server.gateway.workers import (
    DockerBackend,
    DockerSettings,
    ProcessBackend,
    Worker,
    WorkerManager,
    WorkerSettings,
    WorkerUnavailable,
)
from app_server.web_surface import ASSET_DIRECTORY, read_web_build
from core.auth.provisioning import WorkerRoles
from core.auth.sessions import RateLimiter, SessionStore
from core.auth.users import AuthError, Forbidden, User, UserService
from core.persistence.database import Database
from core.version import __version__

logger = logging.getLogger(__name__)

MAX_JSON = 16 * 1024
MAX_UPLOAD = 10 * 1024 * 1024 + 1024
USER = web.AppKey("user", object)
_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
    "cookie", "authorization", "origin",
}


@dataclass(frozen=True, slots=True)
class GatewaySettings:
    public_origin: str
    redis_url: str
    trust_proxy: bool = False
    assets: Path = ASSET_DIRECTORY

    @property
    def secure(self) -> bool:
        return self.public_origin.startswith("https://")

    @property
    def cookie_name(self) -> str:
        # __Host- binds the cookie to this exact origin (Secure, Path=/, no Domain).
        return "__Host-khai_session" if self.secure else "khai_session"

    @classmethod
    def from_environment(cls) -> GatewaySettings:
        origin = os.environ.get("KHAI_PUBLIC_ORIGIN", "").strip().rstrip("/")
        redis_url = os.environ.get("KHAI_REDIS_URL", "").strip()
        if not origin or not redis_url:
            raise SystemExit("KHAI_PUBLIC_ORIGIN and KHAI_REDIS_URL are required")
        return cls(
            public_origin=origin,
            redis_url=redis_url,
            trust_proxy=os.environ.get("KHAI_TRUST_PROXY", "") == "1",
        )


class Gateway:
    def __init__(
        self,
        settings: GatewaySettings,
        database: Database,
        redis: Redis,
        workers: WorkerManager,
        khaidocs: DocmostAccounts | None = None,
    ) -> None:
        self.settings = settings
        self.khaidocs = KhaiDocsRelay(khaidocs) if khaidocs else None
        self.database = database.system()
        self.users = UserService(self.database)
        self.roles = WorkerRoles(self.database)
        self.redis = redis
        self.sessions = SessionStore(redis)
        self.login_limits = RateLimiter(redis, limit=10, window=15 * 60)
        self.register_limits = RateLimiter(redis, limit=5, window=60 * 60)
        self.workers = workers
        # Live browser sockets per user, closed when that user's sessions end.
        self._sockets: dict[str, set[web.WebSocketResponse]] = {}

    # -- application ----------------------------------------------------------

    def application(self) -> web.Application:
        app = web.Application(
            client_max_size=MAX_UPLOAD,
            middlewares=[self._origin_guard, self._authenticate],
        )
        app.add_routes(
            [
                web.get("/health/live", self.health),
                web.get("/", self.index),
                web.get("/index.html", self.index),
                web.get("/web-build.json", self.manifest),
                web.get("/assets/{path:.*}", self.asset),
                web.get("/khaidocs/{path:.*}", self.khaidocs_asset),
                web.get("/auth/config", self.auth_config),
                web.post("/auth/register", self.register),
                web.post("/auth/login", self.login),
                web.post("/auth/logout", self.logout),
                web.post("/auth/logout-all", self.logout_all),
                web.post("/auth/password", self.change_password),
                web.get("/api/session", self.session),
                web.get("/api/admin/users", self.list_users),
                web.post("/api/admin/users/{user_id}/{action}", self.administer),
                web.get("/api/rpc", self.rpc),
                web.post("/api/uploads", self.upload),
                web.post("/api/workspace/upload", self.upload),
                web.post("/api/workspace/clone", self.upload),
                web.get("/api/download", self.download),
            ]
        )
        if self.khaidocs is not None:
            # After the gateway's own /api routes, which keep priority.
            app.add_routes(
                [
                    web.route("*", "/api/{tail:.*}", self.docs),
                    web.route("*", "/socket.io/{tail:.*}", self.docs),
                    web.route("*", "/collab", self.docs),
                    web.route("*", "/collab/{tail:.*}", self.docs),
                ]
            )
        app.on_response_prepare.append(self._headers)
        app.on_startup.append(self._startup)
        app.on_shutdown.append(self._shutdown)
        app.on_cleanup.append(self._cleanup)
        return app

    async def _startup(self, _app) -> None:
        self.workers.start_reaper()

    async def _shutdown(self, _app) -> None:
        # Open relays would otherwise hold shutdown for the full grace period.
        for sockets in list(self._sockets.values()):
            for socket in list(sockets):
                await socket.close(code=1001, message=b"Server shutting down")
        if self.khaidocs is not None:
            await self.khaidocs.close_sockets()

    async def _cleanup(self, _app) -> None:
        await self.workers.close()
        if self.khaidocs is not None:
            await self.khaidocs.accounts.close()
        await self.redis.aclose()

    # -- middleware -----------------------------------------------------------

    @web.middleware
    async def _origin_guard(self, request: web.Request, handler):
        origin = request.headers.get("Origin")
        unsafe = request.method not in {"GET", "HEAD", "OPTIONS"}
        upgrade = request.headers.get("Upgrade", "").lower() == "websocket"
        if (unsafe or upgrade or origin) and origin != self.settings.public_origin:
            raise web.HTTPForbidden(text="Cross-origin request refused")
        return await handler(request)

    @web.middleware
    async def _authenticate(self, request: web.Request, handler):
        record = await self.sessions.resolve(
            request.cookies.get(self.settings.cookie_name)
        )
        user = None
        if record is not None:
            user = await asyncio.to_thread(self.users.active, record.user_id)
            if user is None:
                # Disabled or deleted since sign-in.
                await self.sessions.revoke_all(record.user_id)
        request[USER] = user
        return await handler(request)

    async def _headers(self, _request, response) -> None:
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if self.settings.secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        ws = self.settings.public_origin.replace("http", "ws", 1)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; "
            f"connect-src 'self' {ws}; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'self'"
        )

    # -- helpers --------------------------------------------------------------

    def _client(self, request: web.Request) -> str:
        if self.settings.trust_proxy:
            forwarded = request.headers.get("X-Forwarded-For", "")
            if forwarded:
                # The proxy appends the address it saw; earlier hops are client-supplied.
                return forwarded.split(",")[-1].strip()
        return request.remote or "unknown"

    @staticmethod
    def _require_user(request: web.Request) -> User:
        user = request[USER]
        if user is None:
            raise web.HTTPUnauthorized(
                text=json.dumps({"code": "AUTH_REQUIRED", "message": "Please sign in."}),
                content_type="application/json",
            )
        return user

    @staticmethod
    async def _json(request: web.Request) -> dict:
        if request.content_type != "application/json":
            raise web.HTTPUnsupportedMediaType(text="JSON body required")
        if (request.content_length or 0) > MAX_JSON:
            raise web.HTTPRequestEntityTooLarge(
                max_size=MAX_JSON, actual_size=request.content_length or 0
            )
        try:
            body = await request.json()
        except (ValueError, RecursionError):
            raise web.HTTPBadRequest(text="Invalid JSON") from None
        if not isinstance(body, dict):
            raise web.HTTPBadRequest(text="Expected a JSON object")
        return body

    @staticmethod
    def _error(exc: AuthError, status: int = 400) -> web.Response:
        if isinstance(exc, Forbidden):
            status = 403
        return web.json_response(
            {"code": exc.code, "message": str(exc)}, status=status
        )

    def _set_cookie(self, response: web.Response, token: str) -> None:
        response.set_cookie(
            self.settings.cookie_name,
            token,
            httponly=True,
            secure=self.settings.secure,
            samesite="Lax",
            path="/",
            max_age=self.sessions.absolute_ttl,
        )

    def _clear_cookie(self, response: web.Response) -> None:
        response.del_cookie(self.settings.cookie_name, path="/")

    async def _end_user(self, user_id: str) -> None:
        """Cut a user off: sessions, open sockets, worker and database role."""

        await self.sessions.revoke_all(user_id)
        for socket in list(self._sockets.get(user_id, ())):
            await socket.close(code=4401, message=b"Signed out")
        await self.workers.stop(user_id)
        await asyncio.to_thread(self.roles.lock, user_id)
        if self.khaidocs is not None:
            self.khaidocs.accounts.forget(user_id)

    # -- public ---------------------------------------------------------------

    async def health(self, _request) -> web.Response:
        return web.json_response({"status": "ready"})

    async def index(self, _request) -> web.StreamResponse:
        index = self.settings.assets / "index.html"
        if read_web_build(self.settings.assets) is None or not index.is_file():
            return web.Response(status=503, text="Web assets are missing; build them first.")
        return web.FileResponse(index)

    async def manifest(self, _request) -> web.Response:
        build = read_web_build(self.settings.assets)
        if build is None:
            raise web.HTTPServiceUnavailable(text="Web assets are unavailable")
        return web.json_response(build)

    def _static(self, base: Path, relative: str) -> web.FileResponse:
        path = Path(relative)
        resolved = (base / path).resolve()
        if path.is_absolute() or ".." in path.parts or not resolved.is_relative_to(base) or not resolved.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(resolved)

    async def asset(self, request) -> web.FileResponse:
        return self._static((self.settings.assets / "assets").resolve(), request.match_info["path"])

    async def khaidocs_asset(self, request) -> web.FileResponse:
        return self._static((self.settings.assets / "khaidocs").resolve(), request.match_info["path"])

    async def auth_config(self, _request) -> web.Response:
        """Tells the web client this server has accounts (the single-user
        service has no such route)."""

        return web.json_response({"accounts": True, "registration": True})

    async def register(self, request: web.Request) -> web.Response:
        body = await self._json(request)
        if not await self.register_limits.hit("register", self._client(request)):
            return web.json_response(
                {"code": "RATE_LIMITED", "message": "Too many registrations; try later."},
                status=429,
            )
        try:
            user = await asyncio.to_thread(
                self.users.register,
                str(body.get("username", "")),
                str(body.get("password", "")),
                str(body.get("displayName", "")),
            )
        except AuthError as exc:
            return self._error(exc)
        logger.info("registration: %s (%s)", user.username, user.status)
        return web.json_response(
            {"user": user.to_dict(), "pendingApproval": user.status == "pending"},
            status=201,
        )

    async def login(self, request: web.Request) -> web.Response:
        body = await self._json(request)
        username = str(body.get("username", "")).strip().lower()
        client = self._client(request)
        if not (
            await self.login_limits.hit("login-ip", client)
            and await self.login_limits.hit("login-user", username)
        ):
            return web.json_response(
                {"code": "RATE_LIMITED", "message": "Too many attempts; try again in 15 minutes."},
                status=429,
            )
        try:
            user = await asyncio.to_thread(
                self.users.authenticate, username, str(body.get("password", ""))
            )
        except AuthError as exc:
            return self._error(exc, status=401)
        await self.login_limits.reset("login-user", username)
        token = await self.sessions.create(user.id)
        response = web.json_response({"authenticated": True, "user": user.to_dict()})
        self._set_cookie(response, token)
        return response

    # -- signed in ------------------------------------------------------------

    async def logout(self, request: web.Request) -> web.Response:
        await self.sessions.revoke(request.cookies.get(self.settings.cookie_name))
        response = web.json_response({"authenticated": False})
        self._clear_cookie(response)
        return response

    async def logout_all(self, request: web.Request) -> web.Response:
        user = self._require_user(request)
        await self.sessions.revoke_all(user.id)
        for socket in list(self._sockets.get(user.id, ())):
            await socket.close(code=4401, message=b"Signed out")
        response = web.json_response({"authenticated": False})
        self._clear_cookie(response)
        return response

    async def change_password(self, request: web.Request) -> web.Response:
        user = self._require_user(request)
        body = await self._json(request)
        try:
            await asyncio.to_thread(
                self.users.change_password,
                user.id,
                str(body.get("currentPassword", "")),
                str(body.get("newPassword", "")),
            )
        except AuthError as exc:
            return self._error(exc)
        # Every other session ends; this browser gets a fresh one.
        await self.sessions.revoke_all(user.id)
        token = await self.sessions.create(user.id)
        response = web.json_response({"changed": True})
        self._set_cookie(response, token)
        return response

    async def session(self, request: web.Request) -> web.Response:
        user = self._require_user(request)
        # Warm the worker while the client loads.
        asyncio.create_task(self._warm(user))
        return web.json_response(
            {
                "authenticated": True,
                "phase": "ready",
                "version": __version__,
                "webBuild": read_web_build(self.settings.assets),
                "user": user.to_dict(),
            }
        )

    async def _warm(self, user: User) -> None:
        with contextlib.suppress(WorkerUnavailable):
            await self.workers.acquire(user.id, allow_commands=user.can_execute)

    # -- administration ---------------------------------------------------------

    async def list_users(self, request: web.Request) -> web.Response:
        user = self._require_user(request)
        status = request.query.get("status") or None
        try:
            users = await asyncio.to_thread(self.users.list, user.id, status=status)
        except AuthError as exc:
            return self._error(exc)
        return web.json_response({"users": [item.to_dict() for item in users]})

    async def administer(self, request: web.Request) -> web.Response:
        actor = self._require_user(request)
        target = request.match_info["user_id"]
        action = request.match_info["action"]
        body = await self._json(request) if request.can_read_body else {}
        operations = {
            "approve": lambda: self.users.approve(actor.id, target),
            "reject": lambda: self.users.reject(actor.id, target),
            "disable": lambda: self.users.disable(actor.id, target),
            "enable": lambda: self.users.enable(actor.id, target),
            "role": lambda: self.users.set_role(actor.id, target, str(body.get("role", ""))),
            "execute": lambda: self.users.set_can_execute(
                actor.id, target, body.get("allowed") is True
            ),
        }
        operation = operations.get(action)
        if operation is None:
            raise web.HTTPNotFound()
        try:
            updated = await asyncio.to_thread(operation)
        except AuthError as exc:
            return self._error(exc)
        if action == "disable":
            await self._end_user(updated.id)
        elif action in {"role", "execute"}:
            # Permissions are read when a worker starts; restart it to apply.
            await self.workers.stop(updated.id)
        logger.info("admin %s: %s %s", actor.username, action, updated.username)
        return web.json_response({"user": updated.to_dict()})

    # -- relays to the user's worker ------------------------------------------

    async def _worker(self, user: User) -> Worker:
        try:
            return await self.workers.acquire(user.id, allow_commands=user.can_execute)
        except WorkerUnavailable as exc:
            raise web.HTTPServiceUnavailable(
                text=json.dumps({"code": "WORKSPACE_UNAVAILABLE", "message": str(exc)}),
                content_type="application/json",
            ) from exc

    async def rpc(self, request: web.Request) -> web.WebSocketResponse:
        user = self._require_user(request)
        worker = await self._worker(user)
        client = web.WebSocketResponse(heartbeat=30, max_msg_size=8 * 1024 * 1024)
        session = aiohttp.ClientSession()
        try:
            upstream = await session.ws_connect(
                f"{worker.url.replace('http', 'ws', 1)}/api/rpc",
                headers={"Authorization": f"Bearer {worker.token}"},
                heartbeat=30,
                max_msg_size=8 * 1024 * 1024,
            )
        except aiohttp.ClientError as exc:
            await session.close()
            raise web.HTTPBadGateway(text="Your workspace is not responding") from exc
        await client.prepare(request)
        sockets = self._sockets.setdefault(user.id, set())
        sockets.add(client)
        self.workers.opened(worker)

        async def pump(source, sink) -> None:
            async for message in source:
                worker.touch()
                if message.type == WSMsgType.TEXT:
                    await sink.send_str(message.data)
                elif message.type == WSMsgType.BINARY:
                    await sink.send_bytes(message.data)
                else:
                    break

        tasks = [
            asyncio.create_task(pump(client, upstream)),
            asyncio.create_task(pump(upstream, client)),
        ]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            sockets.discard(client)
            self.workers.closed(worker)
            await upstream.close()
            await session.close()
            await client.close()
        return client

    async def _relay(self, request: web.Request, user: User) -> web.StreamResponse:
        worker = await self._worker(user)
        headers = {
            name: value
            for name, value in request.headers.items()
            if name.lower() not in _HOP
        }
        headers["Authorization"] = f"Bearer {worker.token}"
        worker.touch()
        async with aiohttp.ClientSession() as session:
            async with session.request(
                request.method,
                f"{worker.url}{request.rel_url.path_qs}",
                headers=headers,
                data=request.content if request.body_exists else None,
                allow_redirects=False,
            ) as upstream:
                response = web.StreamResponse(status=upstream.status, reason=upstream.reason)
                for name, value in upstream.headers.items():
                    if name.lower() not in _HOP and name.lower() != "content-encoding":
                        response.headers[name] = value
                await response.prepare(request)
                async for chunk in upstream.content.iter_chunked(64 * 1024):
                    await response.write(chunk)
                await response.write_eof()
                return response

    async def docs(self, request: web.Request) -> web.StreamResponse:
        """KhaiDocs, always as the signed-in user's own Docmost account."""

        return await self.khaidocs.forward(request, self._require_user(request))

    async def upload(self, request: web.Request) -> web.StreamResponse:
        return await self._relay(request, self._require_user(request))

    async def download(self, request: web.Request) -> web.StreamResponse:
        return await self._relay(request, self._require_user(request))


def build_gateway() -> Gateway:
    settings = GatewaySettings.from_environment()
    database = Database()
    database.initialize()
    redis = Redis.from_url(settings.redis_url)
    worker_settings = WorkerSettings.from_environment(database.url)
    backend = (
        ProcessBackend()
        if os.environ.get("KHAI_WORKER_BACKEND", "docker") == "process"
        else DockerBackend(DockerSettings.from_environment())
    )
    docmost_url = os.environ.get("KHAI_DOCMOST_URL", "").strip()
    docmost_secret = os.environ.get("KHAI_DOCMOST_ACCOUNT_SECRET", "").strip()
    khaidocs = (
        DocmostAccounts(docmost_url, docmost_secret)
        if docmost_url and docmost_secret
        else None
    )
    workers = WorkerManager(
        worker_settings,
        WorkerRoles(database),
        backend,
        qdrant=QdrantProvisioner.from_environment(),
    )
    return Gateway(settings, database, redis, workers, khaidocs)


def main() -> int:
    from core.dotenv import load_dotenv

    load_dotenv()
    logging.basicConfig(
        level=os.environ.get("DEEPCODE_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    os.environ["KHAI_MULTI_USER"] = "1"
    gateway = build_gateway()
    web.run_app(
        gateway.application(),
        host=os.environ.get("KHAI_BIND_HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8080")),
        access_log=None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
