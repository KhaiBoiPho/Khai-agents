"""Budgeted LLM access for DeepThink nodes.

Plan and check are plain JSON prompts: no tool schemas are ever sent, which
is most of what a normal agent request spends on input tokens.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

from core.deepthink.limits import DeepThinkLimits

UsageSink = Callable[[dict[str, int]], None]
DeltaSink = Callable[[str], Awaitable[None]]

_LIGHT_EFFORT = "low"
_NO_EFFORT = {None, "", "none", "off", "auto"}


class LLMBudgetExceeded(RuntimeError):
    """The run's call or input-token budget does not allow another call."""


class LLMCallFailed(RuntimeError):
    """The provider returned an error response."""

    def __init__(self, message: str, *, partial_text: str = "") -> None:
        super().__init__(message)
        self.partial_text = partial_text


def estimate_tokens(text: str) -> int:
    """Cheap, provider-neutral token estimate (about four characters/token)."""

    return len(text) // 4 + 1


def messages_tokens(messages: list[dict[str, Any]]) -> int:
    return sum(estimate_tokens(str(message.get("content") or "")) + 4 for message in messages)


class DeepThinkLLM:
    """Wrap the Turn's provider with a hard call and input-token budget."""

    def __init__(
        self,
        provider: Any,
        *,
        model: str | None,
        reasoning_effort: str | None,
        limits: DeepThinkLimits,
        on_usage: UsageSink | None = None,
        max_output_tokens: int | None = None,
    ) -> None:
        self.provider = provider
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.limits = limits
        self.on_usage = on_usage
        self.max_output_tokens = max_output_tokens
        self.calls = 0
        self.input_tokens = 0

    @property
    def remaining_calls(self) -> int:
        return max(0, self.limits.max_llm_calls - self.calls)

    @property
    def remaining_input_tokens(self) -> int:
        return max(0, self.limits.max_input_tokens - self.input_tokens)

    def charge(self, tokens: int) -> None:
        """Count input DeepThink hands onward (the deliverable brief)."""

        self.input_tokens += max(0, int(tokens))

    def fits(self, messages: list[dict[str, Any]], *, reserve_calls: int = 0) -> bool:
        """Whether a call fits while keeping ``reserve_calls`` for later nodes."""

        return (
            self.remaining_calls > reserve_calls
            and messages_tokens(messages) <= self.remaining_input_tokens
        )

    def _effort(self, light: bool) -> str | None:
        effort = self.reasoning_effort
        if light and effort not in _NO_EFFORT:
            # Plan/check are short structured calls; deep reasoning there only
            # burns hidden output tokens.
            return _LIGHT_EFFORT
        return effort

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        max_tokens: int,
        light: bool = False,
        on_delta: DeltaSink | None = None,
        reserve_calls: int = 0,
    ) -> str:
        if not self.fits(messages, reserve_calls=reserve_calls):
            raise LLMBudgetExceeded(
                f"DeepThink budget exhausted ({self.calls} calls, "
                f"{self.input_tokens} input tokens)"
            )
        estimate = messages_tokens(messages)
        self.calls += 1
        self.input_tokens += estimate
        if self.max_output_tokens:
            max_tokens = min(max_tokens, self.max_output_tokens)
        kwargs: dict[str, Any] = {
            "messages": messages,
            "tools": None,
            "model": self.model,
            "max_tokens": max_tokens,
            "reasoning_effort": self._effort(light),
        }
        streamed: list[str] = []
        if on_delta is not None:

            async def forward(text: str) -> None:
                if text:
                    streamed.append(text)
                    await on_delta(text)

            response = await self.provider.chat_stream_with_retry(
                **kwargs, on_content_delta=forward
            )
        else:
            response = await self.provider.chat_with_retry(**kwargs)
        usage = {
            str(key): value
            for key, value in (getattr(response, "usage", None) or {}).items()
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        }
        observed = usage.get("prompt_tokens") or usage.get("input_tokens")
        if observed:
            # Replace the estimate with what the provider actually counted.
            self.input_tokens += observed - estimate
        if usage and self.on_usage is not None:
            self.on_usage(usage)
        if getattr(response, "finish_reason", "stop") == "error":
            raise LLMCallFailed(
                str(getattr(response, "content", "") or "provider error")[:300],
                partial_text="".join(streamed),
            )
        content = getattr(response, "content", None)
        if not content and streamed:
            content = "".join(streamed)
        return str(content or "")


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def parse_json_object(text: str) -> dict[str, Any] | None:
    """Best-effort JSON object extraction from a model reply."""

    if not text:
        return None
    candidates = [text.strip()]
    candidates.extend(match.strip() for match in _FENCE.findall(text))
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except (TypeError, ValueError):
            continue
        if isinstance(value, dict):
            return value
    try:
        from json_repair import repair_json

        value = repair_json(text, return_objects=True)
    except Exception:  # noqa: BLE001 - optional best-effort repair
        return None
    return value if isinstance(value, dict) else None


__all__ = [
    "DeepThinkLLM",
    "LLMBudgetExceeded",
    "LLMCallFailed",
    "estimate_tokens",
    "messages_tokens",
    "parse_json_object",
]
