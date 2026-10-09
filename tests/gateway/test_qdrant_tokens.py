"""A worker's Qdrant token opens its own collection and nothing else."""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import httpx
import pytest

from app_server.gateway.qdrant import QdrantProvisioner


def _settings() -> tuple[str, str] | None:
    env_file = Path(__file__).resolve().parents[2] / "docker" / "stack" / ".env"
    try:
        values = dict(
            line.split("=", 1)
            for line in env_file.read_text().splitlines()
            if "=" in line and not line.startswith("#")
        )
    except OSError:
        return None
    key = values.get("KHAI_QDRANT_API_KEY")
    port = values.get("KHAI_QDRANT_PORT", "6353")
    return (os.environ.get("KHAI_TEST_QDRANT_URL") or f"http://127.0.0.1:{port}", key) if key else None


SETTINGS = _settings()
pytestmark = pytest.mark.skipif(SETTINGS is None, reason="no test Qdrant configured")


def test_tokens_are_confined_to_their_users_collection() -> None:
    url, key = SETTINGS
    provisioner = QdrantProvisioner(url, key, dims=4)
    alice, bob = str(uuid.uuid4()), str(uuid.uuid4())

    async def scenario():
        await provisioner.ensure(alice)
        await provisioner.ensure(bob)
        try:
            token = provisioner.token(alice)
            with httpx.Client(base_url=url, headers={"api-key": token}) as worker:
                own = provisioner.collection(alice)
                other = provisioner.collection(bob)
                upsert = worker.put(
                    f"/collections/{own}/points",
                    params={"wait": "true"},
                    json={"points": [{"id": 1, "vector": [1, 0, 0, 0], "payload": {"user_id": alice}}]},
                )
                assert upsert.status_code == 200, upsert.text
                assert worker.post(
                    f"/collections/{own}/points/search", json={"vector": [1, 0, 0, 0], "limit": 1}
                ).status_code == 200
                assert worker.post(
                    f"/collections/{other}/points/search", json={"vector": [1, 0, 0, 0], "limit": 1}
                ).status_code == 403
                assert worker.put(
                    "/collections/khai_rag_intruder_4",
                    json={"vectors": {"size": 4, "distance": "Cosine"}},
                ).status_code == 403
                assert worker.delete(f"/collections/{other}").status_code == 403
            forged = provisioner.token(alice).rsplit(".", 1)[0] + ".AAAA"
            with httpx.Client(base_url=url, headers={"api-key": forged}) as intruder:
                assert intruder.post(
                    f"/collections/{provisioner.collection(alice)}/points/search",
                    json={"vector": [1, 0, 0, 0], "limit": 1},
                ).status_code in (401, 403)
        finally:
            await provisioner.drop(alice)
            await provisioner.drop(bob)

    asyncio.run(scenario())
