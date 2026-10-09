"""Browser sessions and sign-in rate limits, kept in Redis.

A session is an opaque 256-bit token in an HttpOnly cookie. Redis stores only
its SHA-256 digest (``<prefix>session:<digest>`` -> user id), so a dump of
Redis cannot be replayed as a cookie. Sessions slide: each use extends them
up to ``idle_ttl``, never beyond ``absolute_ttl`` from sign-in. Every user's
digests are also indexed (``<prefix>user-sessions:<user_id>``) so signing out
everywhere, disabling an account or changing a password revokes them all.

Rate limits are fixed windows (``INCR`` + ``EXPIRE``) per client address and
per username, which bounds password guessing without locking a real user out
for long.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

from redis.asyncio import Redis

DEFAULT_PREFIX = "khai:"


@dataclass(frozen=True, slots=True)
class SessionRecord:
    user_id: str
    created_at: float
    expires_at: float


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class SessionStore:
    def __init__(
        self,
        redis: Redis,
        *,
        prefix: str = DEFAULT_PREFIX,
        idle_ttl: int = 12 * 60 * 60,
        absolute_ttl: int = 30 * 24 * 60 * 60,
    ) -> None:
        self._redis = redis
        self._prefix = prefix
        self.idle_ttl = idle_ttl
        self.absolute_ttl = absolute_ttl

    def _key(self, digest: str) -> str:
        return f"{self._prefix}session:{digest}"

    def _index(self, user_id: str) -> str:
        return f"{self._prefix}user-sessions:{user_id}"

    async def create(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        digest = _digest(token)
        now = time.time()
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.hset(
                self._key(digest),
                mapping={"user": user_id, "created": f"{now:.3f}"},
            )
            pipe.expire(self._key(digest), self.idle_ttl)
            pipe.sadd(self._index(user_id), digest)
            pipe.expire(self._index(user_id), self.absolute_ttl)
            await pipe.execute()
        return token

    async def resolve(self, token: str | None) -> SessionRecord | None:
        """The live session for ``token``, extending its idle lifetime."""

        if not token or len(token) > 128:
            return None
        key = self._key(_digest(token))
        values = await self._redis.hgetall(key)
        if not values:
            return None
        user_id = _text(values.get(b"user") or values.get("user"))
        created = float(_text(values.get(b"created") or values.get("created")) or 0)
        now = time.time()
        hard_stop = created + self.absolute_ttl
        if not user_id or now >= hard_stop:
            await self._redis.delete(key)
            return None
        remaining = int(min(self.idle_ttl, hard_stop - now))
        await self._redis.expire(key, max(1, remaining))
        return SessionRecord(user_id=user_id, created_at=created, expires_at=now + remaining)

    async def revoke(self, token: str | None) -> None:
        if not token:
            return
        digest = _digest(token)
        key = self._key(digest)
        user_id = _text(await self._redis.hget(key, "user"))
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.delete(key)
            if user_id:
                pipe.srem(self._index(user_id), digest)
            await pipe.execute()

    async def revoke_all(self, user_id: str) -> int:
        index = self._index(user_id)
        digests = [_text(value) for value in await self._redis.smembers(index)]
        async with self._redis.pipeline(transaction=True) as pipe:
            for digest in digests:
                pipe.delete(self._key(digest))
            pipe.delete(index)
            await pipe.execute()
        return len(digests)


class RateLimiter:
    """At most ``limit`` hits per ``window`` seconds for each key."""

    def __init__(
        self, redis: Redis, *, prefix: str = DEFAULT_PREFIX, limit: int, window: int
    ) -> None:
        self._redis = redis
        self._prefix = prefix
        self.limit = limit
        self.window = window

    async def hit(self, scope: str, key: str) -> bool:
        """Count one attempt; False once the window's budget is spent."""

        name = f"{self._prefix}rl:{scope}:{hashlib.sha256(key.encode()).hexdigest()[:32]}"
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.incr(name)
            pipe.expire(name, self.window, nx=True)
            count, _ = await pipe.execute()
        return int(count) <= self.limit

    async def reset(self, scope: str, key: str) -> None:
        name = f"{self._prefix}rl:{scope}:{hashlib.sha256(key.encode()).hexdigest()[:32]}"
        await self._redis.delete(name)


def _text(value) -> str:
    if value is None:
        return ""
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)
