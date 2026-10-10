"""Small chat-completion client for index-time enrichment.

Contextual retrieval (:mod:`core.rag.contextual`) and page vision
(:mod:`core.rag.visual`) both ask a model for a short answer through the
user's OpenRouter connection (``POST {api_base}/chat/completions``). Calls are
cheap by construction: low reasoning effort, a small ``max_tokens``, a
process-wide concurrency limit and a bounded retry budget on 429/5xx, after
which the caller gives up on that one request and indexes without it.

Enrichment is strictly best-effort: nothing here may stop indexing. Every
failure is an :class:`EnrichmentError` the caller swallows (logged once per
reason, so an outage does not flood the log).
"""

from __future__ import annotations

import os
import random
import threading
import time
from collections.abc import Callable, Sequence
from typing import Any, Protocol

import httpx
from loguru import logger

from core.rag.embeddings import OPENROUTER_API_BASE, egress_block_reason

#: Luna 6 on OpenRouter: the default model of both enrichment features.
DEFAULT_ENRICHMENT_MODEL = "openai/gpt-6-luna"
CONCURRENCY_ENV = "KHAI_RAG_LLM_CONCURRENCY"
DEFAULT_CONCURRENCY = 2
_RETRY_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})

_SLOTS_LOCK = threading.Lock()
_SLOTS: threading.BoundedSemaphore | None = None
_LOGGED: set[str] = set()
_LOGGED_LOCK = threading.Lock()


class EnrichmentError(Exception):
    """One enrichment request failed; index without it."""


class EnrichmentUnavailable(EnrichmentError):
    """The credential or model cannot be used at all (stop asking this run)."""


class ChatClient(Protocol):
    model: str

    def complete(
        self, content: Sequence[dict[str, Any]], *, max_tokens: int
    ) -> str: ...


def env_flag(name: str, default: bool = True) -> bool:
    value = (os.environ.get(name) or "").strip().lower()
    if not value:
        return default
    return value not in {"0", "false", "off", "no", "disabled"}


def env_int(name: str, default: int, *, minimum: int = 0) -> int:
    try:
        return max(minimum, int((os.environ.get(name) or "").strip()))
    except ValueError:
        return default


def env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    try:
        return max(minimum, float((os.environ.get(name) or "").strip()))
    except ValueError:
        return default


def log_once(message: str, *args: object) -> None:
    """Warn about an enrichment problem the first time it happens."""

    key = message.format(*args) if args else message
    with _LOGGED_LOCK:
        if key in _LOGGED:
            return
        _LOGGED.add(key)
    logger.warning(message, *args)


def _slots() -> threading.BoundedSemaphore:
    global _SLOTS
    with _SLOTS_LOCK:
        if _SLOTS is None:
            _SLOTS = threading.BoundedSemaphore(
                env_int(CONCURRENCY_ENV, DEFAULT_CONCURRENCY, minimum=1)
            )
        return _SLOTS


class OpenRouterChat:
    """Bounded, retried, low-effort chat completions over OpenRouter."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        api_base: str | None = None,
        max_retries: int = 3,
        timeout: float = 60.0,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not api_key or not api_key.strip():
            raise EnrichmentUnavailable("no OpenRouter key")
        if not model or not model.strip():
            raise EnrichmentUnavailable("no enrichment model")
        self.model = model.strip()
        self.api_base = (api_base or OPENROUTER_API_BASE).rstrip("/")
        blocked = egress_block_reason(self.api_base)
        if blocked is not None:
            raise EnrichmentUnavailable(f"egress blocked: {blocked}")
        self._api_key = api_key.strip()
        self._max_retries = max(0, max_retries)
        self._timeout = timeout
        self._client = client
        self._sleep = sleep

    def complete(self, content: Sequence[dict[str, Any]], *, max_tokens: int) -> str:
        body = {
            "model": self.model,
            "messages": [{"role": "user", "content": list(content)}],
            "max_tokens": max_tokens,
            "temperature": 0,
            # Short extraction-style answers: think as little as possible.
            "reasoning": {"effort": "low", "exclude": True},
        }
        client = self._client or httpx.Client(timeout=self._timeout)
        try:
            with _slots():
                return self._post(client, body)
        finally:
            if self._client is None:
                client.close()

    def _post(self, client: httpx.Client, body: dict[str, Any]) -> str:
        last_error = "unknown error"
        for attempt in range(self._max_retries + 1):
            if attempt:
                self._sleep(min(20.0, 2 ** (attempt - 1)) + random.uniform(0, 0.5))
            try:
                response = client.post(
                    f"{self.api_base}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "X-Title": "Khai Agents",
                    },
                    json=body,
                    timeout=self._timeout,
                )
            except httpx.TransportError as exc:
                last_error = type(exc).__name__
                continue
            status = response.status_code
            if status in (401, 403):
                raise EnrichmentUnavailable(f"OpenRouter rejected the key (HTTP {status})")
            if status in (400, 404) and _mentions_model(response):
                raise EnrichmentUnavailable(f"model {self.model} unavailable (HTTP {status})")
            if status in _RETRY_STATUSES:
                last_error = f"HTTP {status}"
                continue
            if status >= 400:
                raise EnrichmentError(f"HTTP {status}")
            try:
                payload = response.json()
            except ValueError:
                last_error = "invalid JSON response"
                continue
            if isinstance(payload, dict) and payload.get("error"):
                error = payload["error"]
                code = error.get("code") if isinstance(error, dict) else None
                last_error = f"provider error {code}"
                if code is None or code in _RETRY_STATUSES:
                    continue
                raise EnrichmentError(last_error)
            text = _message_text(payload)
            if text is None:
                last_error = "empty completion"
                continue
            return text
        raise EnrichmentError(
            f"gave up after {self._max_retries + 1} attempts: {last_error}"
        )


def _mentions_model(response: httpx.Response) -> bool:
    try:
        text = response.text.lower()
    except Exception:  # noqa: BLE001
        return False
    return "model" in text and ("not" in text or "invalid" in text)


def _message_text(payload: Any) -> str | None:
    try:
        message = payload["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    if not isinstance(content, str) or not content.strip():
        return None
    return content.strip()


__all__ = [
    "DEFAULT_ENRICHMENT_MODEL",
    "ChatClient",
    "EnrichmentError",
    "EnrichmentUnavailable",
    "OpenRouterChat",
    "env_flag",
    "env_float",
    "env_int",
    "log_once",
]
