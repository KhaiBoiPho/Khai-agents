"""Embedding clients for document search.

The production client talks to OpenRouter's OpenAI-compatible
``POST {api_base}/embeddings`` endpoint (request ``{"model", "input": [...]}``,
response ``{"data": [{"index", "embedding"}]}``). The model is configurable
with ``KHAI_RAG_EMBEDDING_MODEL``; the default is ``baai/bge-m3`` (1024
dimensions, 8K-token input), a multilingual model that handles Vietnamese and
mixed-language documents well and is the embedding RAGFlow defaults to.
"""

from __future__ import annotations

import os
import random
import time
from collections.abc import Callable, Sequence
from typing import Protocol

import httpx

DEFAULT_EMBEDDING_MODEL = "baai/bge-m3"  # multilingual, 1024 dims
EMBEDDING_MODEL_ENV = "KHAI_RAG_EMBEDDING_MODEL"
OPENROUTER_API_BASE = "https://openrouter.ai/api/v1"
OPENROUTER_KEY_ENV = "OPENROUTER_API_KEY"
DEFAULT_BATCH_SIZE = 64
_RETRY_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})


class EmbeddingError(Exception):
    """The embedding service could not produce vectors."""


class EmbeddingNotConfigured(EmbeddingError):
    """No credential is available for the embedding connection."""


class Embedder(Protocol):
    model: str

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


def configured_embedding_model() -> str:
    return (os.environ.get(EMBEDDING_MODEL_ENV) or "").strip() or DEFAULT_EMBEDDING_MODEL


def not_configured_message() -> str:
    return (
        f"{OPENROUTER_KEY_ENV} is not set: add it to .env (or save a key for the "
        "OpenRouter connection in Settings) and restart the service to enable "
        "document search."
    )


class OpenRouterEmbedder:
    """Batched OpenAI-compatible embeddings with bounded retries."""

    def __init__(
        self,
        api_key: str | None,
        *,
        model: str | None = None,
        api_base: str | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        max_retries: int = 4,
        timeout: float = 60.0,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not api_key or not api_key.strip():
            raise EmbeddingNotConfigured(not_configured_message())
        self.model = (model or configured_embedding_model()).strip()
        self.api_base = (api_base or OPENROUTER_API_BASE).rstrip("/")
        self._check_egress()
        self._api_key = api_key.strip()
        self._batch_size = max(1, batch_size)
        self._max_retries = max(0, max_retries)
        self._timeout = timeout
        self._client = client
        self._sleep = sleep

    def _check_egress(self) -> None:
        from core.providers.egress import (
            WARN,
            evaluate_provider_egress,
            resolve_egress_policy,
        )

        policy = resolve_egress_policy(None)
        decision = evaluate_provider_egress(
            self.api_base,
            endpoint_class="gateway",
            allowed_domains=policy.allowed_domains,
            blocked_domains=policy.blocked_domains,
        )
        if not decision.allowed and policy.mode != WARN:
            raise EmbeddingError(f"Embedding egress blocked: {decision.reason}")

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        client = self._client or httpx.Client(timeout=self._timeout)
        try:
            for start in range(0, len(texts), self._batch_size):
                vectors.extend(
                    self._embed_batch(client, list(texts[start : start + self._batch_size]))
                )
        finally:
            if self._client is None:
                client.close()
        return vectors

    def _embed_batch(self, client: httpx.Client, batch: list[str]) -> list[list[float]]:
        last_error = "unknown error"
        for attempt in range(self._max_retries + 1):
            if attempt:
                self._sleep(min(30.0, 2 ** (attempt - 1)) + random.uniform(0, 0.5))
            try:
                response = client.post(
                    f"{self.api_base}/embeddings",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "X-Title": "Khai Agents",
                    },
                    json={
                        "model": self.model,
                        "input": batch,
                        "encoding_format": "float",
                    },
                )
            except httpx.TransportError as exc:
                last_error = f"{type(exc).__name__}"
                continue
            if response.status_code in (401, 403):
                raise EmbeddingNotConfigured(
                    f"OpenRouter rejected the API key (HTTP {response.status_code})."
                )
            if response.status_code in _RETRY_STATUSES:
                last_error = f"HTTP {response.status_code}"
                continue
            if response.status_code >= 400:
                raise EmbeddingError(
                    f"Embedding request failed: HTTP {response.status_code} "
                    f"{_error_message(response)}".strip()
                )
            try:
                payload = response.json()
            except ValueError:
                last_error = "invalid JSON response"
                continue
            if isinstance(payload, dict) and payload.get("error"):
                last_error = _error_message(response)
                code = payload["error"].get("code") if isinstance(payload["error"], dict) else None
                if code in _RETRY_STATUSES or code is None:
                    continue
                raise EmbeddingError(f"Embedding request failed: {last_error}")
            data = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(data, list) or len(data) != len(batch):
                last_error = "response did not contain one embedding per input"
                continue
            ordered = sorted(
                data,
                key=lambda row: row.get("index", 0) if isinstance(row, dict) else 0,
            )
            try:
                return [[float(value) for value in row["embedding"]] for row in ordered]
            except (KeyError, TypeError, ValueError):
                last_error = "malformed embedding vectors"
                continue
        raise EmbeddingError(
            f"Embedding request failed after {self._max_retries + 1} attempts: {last_error}"
        )


def _error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return ""
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return str(error.get("message") or "")[:300]
    return str(error or "")[:300]


__all__ = [
    "DEFAULT_EMBEDDING_MODEL",
    "EMBEDDING_MODEL_ENV",
    "OPENROUTER_API_BASE",
    "OPENROUTER_KEY_ENV",
    "Embedder",
    "EmbeddingError",
    "EmbeddingNotConfigured",
    "OpenRouterEmbedder",
    "configured_embedding_model",
    "not_configured_message",
]
