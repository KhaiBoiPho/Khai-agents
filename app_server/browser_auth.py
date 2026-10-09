"""Browser sessions; all access belongs to the HTTP event loop.

With a ``store`` path, sessions survive a service restart: only SHA-256
digests of the session tokens are written (owner-only), with their
wall-clock expiry, so the file cannot be replayed as a cookie.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from collections import deque
from collections.abc import Callable
from pathlib import Path

from aiohttp import web


class BrowserAuth:
    TICKET_TTL = 60
    SESSION_TTL = 12 * 60 * 60
    CAPACITY = 64
    EXCHANGES_PER_MINUTE = 60

    def __init__(
        self,
        instance_id: str,
        *,
        clock: Callable[[], float] = time.monotonic,
        store: Path | None = None,
        cookie_key: str | None = None,
    ):
        # Cookies are not scoped by port. Without a store the name is per
        # instance and a restart invalidates all sessions; with one, the name
        # is per database (cookie_key) so a restart keeps people signed in.
        self.cookie_name = f"deepcode_session_{cookie_key or instance_id}"
        self._clock = clock
        self._tickets: dict[str, float] = {}
        self._sessions: dict[str, float] = {}
        self._attempts: deque[float] = deque()
        self._store = store
        # Digest -> expiry on this instance's clock, restored from the store.
        self._restored: dict[str, float] = self._load()

    def issue(self) -> dict[str, str | int]:
        self._prune(self._tickets)
        if len(self._tickets) >= self.CAPACITY:
            raise web.HTTPTooManyRequests(text="Too many pending browser links")
        ticket = secrets.token_urlsafe(32)
        self._tickets[ticket] = self._clock() + self.TICKET_TTL
        return {"ticket": ticket, "expiresIn": self.TICKET_TTL}

    def exchange(self, ticket: object) -> str:
        now = self._clock()
        while self._attempts and self._attempts[0] <= now - 60:
            self._attempts.popleft()
        if len(self._attempts) >= self.EXCHANGES_PER_MINUTE:
            raise web.HTTPTooManyRequests(text="Too many exchange attempts")
        self._attempts.append(now)
        self._prune(self._tickets)
        self._prune(self._sessions)
        if not isinstance(ticket, str) or ticket not in self._tickets:
            raise web.HTTPUnauthorized(text="Invalid or expired browser link")
        if len(self._sessions) >= self.CAPACITY:
            raise web.HTTPTooManyRequests(text="Too many browser sessions")
        del self._tickets[ticket]
        session = secrets.token_urlsafe(32)
        self._sessions[session] = now + self.SESSION_TTL
        self._save()
        return session

    def password_session(self, supplied: str, expected: str) -> str:
        """Open a session for the remote-mode access password."""

        now = self._clock()
        while self._attempts and self._attempts[0] <= now - 60:
            self._attempts.popleft()
        if len(self._attempts) >= 10:
            raise web.HTTPTooManyRequests(text="Too many login attempts")
        self._attempts.append(now)
        if not expected or not secrets.compare_digest(
            supplied.encode(), expected.encode()
        ):
            raise web.HTTPUnauthorized(text="Invalid access password")
        self._prune(self._sessions)
        if len(self._sessions) >= self.CAPACITY:
            raise web.HTTPTooManyRequests(text="Too many browser sessions")
        session = secrets.token_urlsafe(32)
        self._sessions[session] = now + self.SESSION_TTL
        self._save()
        return session

    def remaining(self, session: str) -> float:
        expiry = self._sessions.get(session)
        if expiry is None and session and self._restored:
            expiry = self._restored.get(_digest(session))
        return max(0.0, (expiry or 0.0) - self._clock())

    def require(self, request: web.Request) -> str:
        session = request.cookies.get(self.cookie_name, "")
        if not self.remaining(session):
            raise web.HTTPUnauthorized(text="Browser session expired; open a new link")
        return session

    def revoke(self, session: str) -> None:
        self._sessions.pop(session, None)
        if session:
            self._restored.pop(_digest(session), None)
        self._save()

    def _prune(self, entries: dict[str, float]) -> None:
        now = self._clock()
        for key, expiry in tuple(entries.items()):
            if expiry <= now:
                del entries[key]

    # ---- persistence -------------------------------------------------------

    def _load(self) -> dict[str, float]:
        if self._store is None:
            return {}
        try:
            stored = json.loads(self._store.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        now_wall, now = time.time(), self._clock()
        restored: dict[str, float] = {}
        for digest, wall_expiry in (stored.get("sessions") or {}).items():
            if isinstance(wall_expiry, (int, float)) and wall_expiry > now_wall:
                restored[str(digest)] = now + (wall_expiry - now_wall)
        return restored

    def _save(self) -> None:
        if self._store is None:
            return
        self._prune(self._sessions)
        self._prune(self._restored)
        now_wall, now = time.time(), self._clock()
        sessions = {
            _digest(token): now_wall + (expiry - now)
            for token, expiry in self._sessions.items()
        }
        sessions.update(
            (digest, now_wall + (expiry - now))
            for digest, expiry in self._restored.items()
        )
        try:
            from core.private_storage import atomic_write_private_json

            atomic_write_private_json(self._store, {"sessions": sessions})
        except OSError:
            pass  # Sessions then last for this instance only.


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class WorkerAuth:
    """Authorization for a user's worker, which only its gateway may call.

    Every request must carry ``Authorization: Bearer <KHAI_WORKER_TOKEN>``;
    there are no browser sessions on a worker. Mirrors the parts of
    :class:`BrowserAuth` the transports use.
    """

    cookie_name = "khai_worker"
    SESSION_TTL = 365 * 24 * 60 * 60

    def __init__(self, token: str) -> None:
        if len(token) < 32:
            raise ValueError("KHAI_WORKER_TOKEN must be at least 32 characters")
        self._expected = f"Bearer {token}".encode()

    def authenticated(self, request: web.Request) -> bool:
        supplied = request.headers.get("Authorization", "").encode()
        return secrets.compare_digest(supplied, self._expected)

    def require(self, request: web.Request) -> str:
        if not self.authenticated(request):
            raise web.HTTPUnauthorized(text="Worker credential required")
        return "worker"

    def remaining(self, session: str) -> float:
        return float(self.SESSION_TTL) if session == "worker" else 0.0

    def revoke(self, session: str) -> None:
        return None
