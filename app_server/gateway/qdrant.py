"""Per-user Qdrant collections and the tokens that open only them.

Qdrant runs with ``QDRANT__SERVICE__JWT_RBAC=true``. The gateway alone holds
the API key: it creates ``khai_rag_<user hex>_<dims>`` for each user and gives
that user's worker an HS256 token (signed with the API key, as Qdrant
expects) whose only grant is read-write on that collection. A worker never
sees the key, so it cannot read or list anyone else's vectors.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from uuid import UUID

import aiohttp

TOKEN_TTL = 7 * 24 * 60 * 60
PAYLOAD_INDEXES = ("user_id", "workspace", "path", "dirs")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def sign_token(claims: dict, secret: str) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64(json.dumps(claims, separators=(",", ":")).encode())
    signature = hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{_b64(signature)}"


@dataclass(frozen=True, slots=True)
class QdrantProvisioner:
    url: str
    api_key: str
    dims: int = 1024

    @classmethod
    def from_environment(cls) -> QdrantProvisioner | None:
        url = os.environ.get("KHAI_QDRANT_URL", "").strip()
        key = os.environ.get("KHAI_QDRANT_API_KEY", "").strip()
        if not url or not key:
            return None
        return cls(url.rstrip("/"), key, int(os.environ.get("KHAI_RAG_EMBEDDING_DIMS", "1024")))

    @staticmethod
    def prefix(user_id: str) -> str:
        return f"khai_rag_{UUID(user_id).hex}_"

    def collection(self, user_id: str) -> str:
        return f"{self.prefix(user_id)}{self.dims}"

    def _session(self) -> aiohttp.ClientSession:
        return aiohttp.ClientSession(
            base_url=self.url,
            headers={"api-key": self.api_key},
            timeout=aiohttp.ClientTimeout(total=30),
        )

    async def ensure(self, user_id: str) -> None:
        name = self.collection(user_id)
        async with self._session() as qdrant:
            async with qdrant.get(f"/collections/{name}/exists") as response:
                response.raise_for_status()
                if (await response.json())["result"]["exists"]:
                    return
            async with qdrant.put(
                f"/collections/{name}",
                json={"vectors": {"size": self.dims, "distance": "Cosine"}},
            ) as response:
                if response.status not in (200, 409):
                    response.raise_for_status()
            for field in PAYLOAD_INDEXES:
                async with qdrant.put(
                    f"/collections/{name}/index",
                    params={"wait": "true"},
                    json={"field_name": field, "field_schema": "keyword"},
                ) as response:
                    response.raise_for_status()

    def token(self, user_id: str, *, ttl: int = TOKEN_TTL) -> str:
        return sign_token(
            {
                "access": [{"collection": self.collection(user_id), "access": "rw"}],
                "exp": int(time.time()) + ttl,
            },
            self.api_key,
        )

    async def environment(self, user_id: str) -> dict[str, str]:
        """What a user's worker needs to reach its own collection."""

        await self.ensure(user_id)
        return {
            "KHAI_QDRANT_URL": self.url,
            "KHAI_QDRANT_API_KEY": self.token(user_id),
            "KHAI_QDRANT_COLLECTION_PREFIX": self.prefix(user_id),
            "KHAI_RAG_EMBEDDING_DIMS": str(self.dims),
        }

    async def drop(self, user_id: str) -> None:
        prefix = self.prefix(user_id)
        async with self._session() as qdrant:
            async with qdrant.get("/collections") as response:
                response.raise_for_status()
                names = [
                    entry["name"]
                    for entry in (await response.json())["result"]["collections"]
                    if entry["name"].startswith(prefix)
                ]
            for name in names:
                async with qdrant.delete(f"/collections/{name}") as response:
                    if response.status != 404:
                        response.raise_for_status()
