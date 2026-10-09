"""Redis-backed browser sessions and rate limits."""

from __future__ import annotations

import asyncio
import secrets

import pytest

from core.auth.sessions import RateLimiter, SessionStore
from tests.conftest import TEST_REDIS_URL

pytestmark = pytest.mark.skipif(not TEST_REDIS_URL, reason="no test Redis configured")


def _run(scenario):
    async def main():
        from redis.asyncio import Redis

        redis = Redis.from_url(TEST_REDIS_URL)
        prefix = f"test:{secrets.token_hex(4)}:"
        try:
            await scenario(redis, prefix)
        finally:
            keys = [key async for key in redis.scan_iter(match=prefix + "*")]
            if keys:
                await redis.delete(*keys)
            await redis.aclose()

    asyncio.run(main())


def test_session_round_trip_and_revoke() -> None:
    async def scenario(redis, prefix):
        store = SessionStore(redis, prefix=prefix)
        token = await store.create("user-1")
        record = await store.resolve(token)
        assert record is not None and record.user_id == "user-1"
        assert await store.resolve(token + "x") is None
        assert await store.resolve(None) is None
        # Only a digest is stored; the token itself never reaches Redis.
        assert not [key async for key in redis.scan_iter(match=f"*{token}*")]
        await store.revoke(token)
        assert await store.resolve(token) is None

    _run(scenario)


def test_revoke_all_ends_every_session_of_one_user() -> None:
    async def scenario(redis, prefix):
        store = SessionStore(redis, prefix=prefix)
        first = await store.create("user-1")
        second = await store.create("user-1")
        other = await store.create("user-2")
        assert await store.revoke_all("user-1") == 2
        assert await store.resolve(first) is None
        assert await store.resolve(second) is None
        assert (await store.resolve(other)).user_id == "user-2"

    _run(scenario)


def test_absolute_lifetime_is_enforced() -> None:
    async def scenario(redis, prefix):
        store = SessionStore(redis, prefix=prefix, idle_ttl=60, absolute_ttl=1)
        token = await store.create("user-1")
        await asyncio.sleep(1.1)
        assert await store.resolve(token) is None

    _run(scenario)


def test_rate_limit_window() -> None:
    async def scenario(redis, prefix):
        limiter = RateLimiter(redis, prefix=prefix, limit=3, window=60)
        assert [await limiter.hit("login", "1.2.3.4") for _ in range(4)] == [
            True,
            True,
            True,
            False,
        ]
        assert await limiter.hit("login", "5.6.7.8")
        await limiter.reset("login", "1.2.3.4")
        assert await limiter.hit("login", "1.2.3.4")

    _run(scenario)
