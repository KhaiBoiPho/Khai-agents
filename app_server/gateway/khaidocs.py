"""KhaiDocs (Docmost) for many users: one Docmost account and one private
space per user, and a proxy that only ever speaks as the signed-in user.

Accounts are derived, not stored. With ``KHAI_DOCMOST_ACCOUNT_SECRET`` the
gateway computes each password as HMAC(secret, user id), so nothing about
Docmost credentials is persisted and losing the database loses nothing.

* The gateway's own Docmost account (``owner@khai-agents.local``) owns the
  workspace. On first use it creates the workspace and takes the default
  "Everyone" group out of every space, so no space is shared by default.
* A user's first visit invites ``<user hex>@users.khai-agents.local``,
  accepts the invitation with the derived password, and creates a space
  that user alone is a member of.
* The proxy drops whatever Docmost cookie the browser sends and injects the
  signed-in user's own session, so a shared browser can never carry one
  user's Docmost session into another's.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import time
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import aiohttp
from aiohttp import web

from core.auth.users import User

logger = logging.getLogger(__name__)

AUTH_COOKIE = "authToken"
OWNER_EMAIL = "owner@khai-agents.local"
# Docmost sessions last far longer; reusing them keeps sign-ins rare, which
# matters because Docmost rate-limits sign-ins and all come from the gateway.
TOKEN_REUSE_SECONDS = 12 * 60 * 60
_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
    "content-encoding", "cookie", "authorization", "origin",
}


class DocmostError(RuntimeError):
    pass


class DocmostAccounts:
    def __init__(self, server: str, secret: str) -> None:
        if len(secret) < 32:
            raise ValueError("KHAI_DOCMOST_ACCOUNT_SECRET must be at least 32 characters")
        self.server = server.rstrip("/")
        self._secret = secret.encode()
        self._tokens: dict[str, tuple[str, float]] = {}
        self._provisioning: dict[str, asyncio.Lock] = {}
        self._workspace_ready = False
        self._workspace_lock = asyncio.Lock()
        self._http: aiohttp.ClientSession | None = None

    # -- credentials ---------------------------------------------------------

    def _password(self, subject: str) -> str:
        digest = hmac.new(self._secret, f"docmost:{subject}".encode(), hashlib.sha256)
        return base64.urlsafe_b64encode(digest.digest()).decode().rstrip("=")

    @staticmethod
    def email(user_id: str) -> str:
        return f"{UUID(user_id).hex}@users.khai-agents.local"

    # -- HTTP -----------------------------------------------------------------

    def _client(self) -> aiohttp.ClientSession:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30),
                cookie_jar=aiohttp.DummyCookieJar(),
            )
        return self._http

    async def close(self) -> None:
        if self._http is not None:
            await self._http.close()

    async def _post(self, path: str, body: dict, token: str | None = None) -> tuple[int, dict, str | None]:
        headers = {"Cookie": f"{AUTH_COOKIE}={token}"} if token else {}
        async with self._client().post(
            f"{self.server}/api{path}", json=body, headers=headers
        ) as response:
            minted = response.cookies.get(AUTH_COOKIE)
            try:
                payload = await response.json(content_type=None)
            except ValueError:
                payload = {}
            data = payload.get("data", payload) if isinstance(payload, dict) else payload
            return response.status, data if isinstance(data, dict) else {"items": data}, (
                minted.value if minted else None
            )

    async def _login(self, email: str, password: str) -> str | None:
        status, data, token = await self._post(
            "/auth/login", {"email": email, "password": password}
        )
        if status == 429:
            raise DocmostError("KhaiDocs is rate limiting sign-ins; try again shortly")
        return token if status in (200, 201) and token else None

    # -- workspace ------------------------------------------------------------

    async def _owner_token(self) -> str:
        cached = self._tokens.get("owner")
        if cached and cached[1] > time.monotonic():
            return cached[0]
        token = await self._login(OWNER_EMAIL, self._password("owner"))
        if token is None:
            status, data, token = await self._post(
                "/auth/setup",
                {
                    "workspaceName": "Khai-Agents",
                    "name": "Khai-Agents",
                    "email": OWNER_EMAIL,
                    "password": self._password("owner"),
                },
            )
            if status not in (200, 201):
                raise DocmostError(
                    "KhaiDocs owner sign-in failed and the workspace already exists "
                    f"({status}); was it set up by hand or with another secret? {data}"
                )
            token = token or await self._login(OWNER_EMAIL, self._password("owner"))
        if not token:
            raise DocmostError("KhaiDocs owner sign-in failed")
        self._tokens["owner"] = (token, time.monotonic() + TOKEN_REUSE_SECONDS)
        return token

    async def _ensure_workspace(self) -> str:
        owner = await self._owner_token()
        if self._workspace_ready:
            return owner
        async with self._workspace_lock:
            if not self._workspace_ready:
                await self._unshare_spaces(owner)
                self._workspace_ready = True
        return owner

    async def _unshare_spaces(self, owner: str) -> None:
        """Take every group out of every space: membership is per user only."""

        _status, spaces, _ = await self._post("/spaces", {"limit": 100}, owner)
        for space in spaces.get("items", []):
            _status, members, _ = await self._post(
                "/spaces/members", {"spaceId": space["id"], "limit": 100}, owner
            )
            for member in members.get("items", []):
                if member.get("type") == "group":
                    await self._post(
                        "/spaces/members/remove",
                        {"spaceId": space["id"], "groupId": member["id"]},
                        owner,
                    )

    # -- users ------------------------------------------------------------------

    async def token_for(self, user: User) -> str:
        cached = self._tokens.get(user.id)
        if cached and cached[1] > time.monotonic():
            return cached[0]
        lock = self._provisioning.setdefault(user.id, asyncio.Lock())
        async with lock:
            cached = self._tokens.get(user.id)
            if cached and cached[1] > time.monotonic():
                return cached[0]
            if await self._exists(self.email(user.id)):
                token = await self._login(self.email(user.id), self._password(user.id))
                if token is None:
                    raise DocmostError("KhaiDocs sign-in failed for an existing account")
            else:
                token = await self._provision(user)
            self._tokens[user.id] = (token, time.monotonic() + TOKEN_REUSE_SECONDS)
            return token

    async def _exists(self, email: str) -> bool:
        owner = await self._ensure_workspace()
        _status, members, _ = await self._post(
            "/workspace/members", {"limit": 100, "query": email}, owner
        )
        return any(item.get("email") == email for item in members.get("items", []))

    def forget(self, user_id: str) -> None:
        self._tokens.pop(user_id, None)

    async def _provision(self, user: User) -> str:
        owner = await self._ensure_workspace()
        email = self.email(user.id)
        status, created, _ = await self._post(
            "/workspace/invites/create",
            {"emails": [email], "role": "member", "groupIds": []},
            owner,
        )
        if status not in (200, 201):
            raise DocmostError(f"KhaiDocs could not invite the account ({status})")
        _status, pending, _ = await self._post("/workspace/invites", {"limit": 100}, owner)
        invitation = next(
            (item for item in pending.get("items", []) if item.get("email") == email), None
        )
        if invitation is None:
            raise DocmostError("KhaiDocs invitation not found")
        _status, link, _ = await self._post(
            "/workspace/invites/link", {"invitationId": invitation["id"]}, owner
        )
        token = parse_qs(urlsplit(link.get("inviteLink", "")).query).get("token", [""])[0]
        status, _accepted, _ = await self._post(
            "/workspace/invites/accept",
            {
                "invitationId": invitation["id"],
                "token": token,
                "name": user.display_name,
                "password": self._password(user.id),
            },
        )
        if status not in (200, 201):
            raise DocmostError(f"KhaiDocs could not accept the invitation ({status})")
        session = await self._login(email, self._password(user.id))
        if session is None:
            raise DocmostError("KhaiDocs sign-in failed after provisioning")
        await self._private_space(owner, user, session)
        logger.info("KhaiDocs account provisioned for %s", user.username)
        return session

    async def _private_space(self, owner: str, user: User, session: str) -> None:
        _status, me, _ = await self._post("/users/me", {}, session)
        docmost_user = me.get("user", me)
        slug = f"u{UUID(user.id).hex[:12]}"
        status, space, _ = await self._post(
            "/spaces/create",
            {"name": user.display_name, "slug": slug, "description": "Private"},
            owner,
        )
        if status not in (200, 201):
            raise DocmostError(f"KhaiDocs could not create the private space ({status})")
        status, added, _ = await self._post(
            "/spaces/members/add",
            {
                "spaceId": space["id"],
                "userIds": [docmost_user["id"]],
                "groupIds": [],
                "role": "admin",
            },
            owner,
        )
        if status not in (200, 201):
            raise DocmostError(f"KhaiDocs could not open the private space ({status}): {added}")


class KhaiDocsRelay:
    """Docmost's /api, /socket.io and /collab, as the signed-in user."""

    def __init__(self, accounts: DocmostAccounts) -> None:
        self.accounts = accounts
        self.sockets: set[web.WebSocketResponse] = set()

    async def close_sockets(self) -> None:
        for socket in list(self.sockets):
            await socket.close(code=1001, message=b"Server shutting down")

    async def forward(self, request: web.Request, user: User) -> web.StreamResponse:
        target = self.accounts.server + request.rel_url.path_qs
        headers = {
            name: value for name, value in request.headers.items() if name.lower() not in _HOP
        }
        headers["X-Forwarded-Proto"] = request.scheme
        headers["X-Forwarded-Host"] = request.host
        try:
            token = await self.accounts.token_for(user)
        except (DocmostError, aiohttp.ClientError) as exc:
            logger.warning("KhaiDocs unavailable for %s: %s", user.username, exc)
            raise web.HTTPServiceUnavailable(text="KhaiDocs is unavailable") from exc
        headers["Cookie"] = f"{AUTH_COOKIE}={token}"
        if request.headers.get("Upgrade", "").lower() == "websocket":
            return await self._websocket(request, target, headers)
        body = (await request.read() or None) if request.body_exists else None
        session = self.accounts._client()

        def send():
            # Forward the browser's headers as sent: aiohttp would add
            # Content-Type: application/octet-stream to a bodiless POST, which
            # Docmost's Fastify rejects with 415.
            return session.request(
                request.method,
                target,
                headers=headers,
                data=body,
                allow_redirects=False,
                skip_auto_headers=("Content-Type", "Accept-Encoding", "User-Agent"),
            )

        upstream = await send()
        if upstream.status == 401:
            # Docmost ended the session: sign in again once.
            upstream.release()
            self.accounts.forget(user.id)
            headers["Cookie"] = f"{AUTH_COOKIE}={await self.accounts.token_for(user)}"
            upstream = await send()
        async with upstream:
            response = web.StreamResponse(status=upstream.status, reason=upstream.reason)
            for name, value in upstream.headers.items():
                # Docmost's own cookies never reach the browser.
                if name.lower() not in _HOP and name.lower() != "set-cookie":
                    response.headers.add(name, value)
            await response.prepare(request)
            async for chunk in upstream.content.iter_any():
                await response.write(chunk)
            await response.write_eof()
            return response

    async def _websocket(self, request, target, headers) -> web.WebSocketResponse:
        protocols = [
            value.strip()
            for value in request.headers.get("Sec-WebSocket-Protocol", "").split(",")
            if value.strip()
        ]
        for name in list(headers):
            if name.lower().startswith("sec-websocket"):
                headers.pop(name)
        try:
            upstream = await self.accounts._client().ws_connect(
                target.replace("http", "ws", 1), headers=headers, protocols=protocols, max_msg_size=0
            )
        except aiohttp.ClientError as exc:
            raise web.HTTPBadGateway(text="KhaiDocs is unavailable") from exc
        downstream = web.WebSocketResponse(
            protocols=[upstream.protocol] if upstream.protocol else (), max_msg_size=0
        )
        await downstream.prepare(request)
        self.sockets.add(downstream)

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
            self.sockets.discard(downstream)
            await upstream.close()
            await downstream.close()
        return downstream
