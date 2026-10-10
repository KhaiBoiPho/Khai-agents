"""Anthropic provider — direct SDK integration for Claude models."""

from __future__ import annotations

import re
import secrets
import string
import time
from collections.abc import Awaitable, Callable
from typing import Any

import json_repair
from loguru import logger

from core.observability import log_llm_call
from core.providers.base import (
    LLMProvider,
    ProviderCapabilityError,
    ProviderConfigurationError,
    LLMResponse,
    ReasoningDeltaCallback,
    ToolCallRequest,
)
from core.providers.protocol_config import ProviderCompat
from core.providers.reasoning import (
    ANTHROPIC_THINKING_BLOCKS,
    infer_reasoning_capabilities,
    normalize_reasoning_effort,
)
from core.providers.timeouts import (
    StreamIdleTimeoutError,
    iter_with_stream_idle_timeout,
    resolve_stream_idle_timeout_s,
    wait_for_stream_activity,
)
from core.reasoning import ReasoningChannel

_ALNUM = string.ascii_letters + string.digits

# Anthropic stop reasons -> the finish reasons the agent runner understands.
# ``pause_turn`` means a long server-side turn was paused and should simply be
# continued, which is what the runner's "length" recovery does.
_STOP_REASON_MAP = {
    "tool_use": "tool_calls",
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "pause_turn": "length",
    "refusal": "refusal",
}
_THINKING_TYPES = frozenset({"thinking", "redacted_thinking"})
_REFUSAL_MESSAGE = (
    "The model declined to respond to this request (stop reason: refusal). "
    "Try rephrasing the request or starting a new conversation."
)

# Legacy extended-thinking budgets: effort -> (floor tokens, share of the
# max_tokens left after the answer reserve). 1,024 is the API minimum.
_THINKING_ANSWER_RESERVE = 4096
_THINKING_BUDGETS: dict[str, tuple[int, float]] = {
    "low": (1024, 0.0),
    "medium": (4096, 0.0),
    "high": (8192, 0.5),
    "xhigh": (16384, 0.75),
    "max": (32768, 1.0),
}


def _gen_tool_id() -> str:
    return "toolu_" + "".join(secrets.choice(_ALNUM) for _ in range(22))


def _stream_text_delta(event: Any) -> str | None:
    """Project only visible text while every raw event renews stream activity."""

    delta = (
        event.get("delta") if isinstance(event, dict) else getattr(event, "delta", None)
    )
    delta_type = (
        delta.get("type") if isinstance(delta, dict) else getattr(delta, "type", None)
    )
    if delta_type != "text_delta":
        return None
    text = (
        delta.get("text") if isinstance(delta, dict) else getattr(delta, "text", None)
    )
    return text if isinstance(text, str) and text else None


def _stream_reasoning_delta(event: Any) -> str | None:
    """Return Anthropic's provider-designated summarized thinking delta."""

    delta = (
        event.get("delta") if isinstance(event, dict) else getattr(event, "delta", None)
    )
    delta_type = (
        delta.get("type") if isinstance(delta, dict) else getattr(delta, "type", None)
    )
    if delta_type != "thinking_delta":
        return None
    text = (
        delta.get("thinking")
        if isinstance(delta, dict)
        else getattr(delta, "thinking", None)
    )
    return text if isinstance(text, str) and text else None


class AnthropicProvider(LLMProvider):
    """LLM provider using the native Anthropic SDK for Claude models.

    Handles message format conversion (OpenAI → Anthropic Messages API),
    prompt caching, extended thinking, tool calls, and streaming.
    """

    def __init__(
        self,
        api_key: str | None = None,
        api_base: str | None = None,
        default_model: str = "claude-sonnet-4-20250514",
        extra_headers: dict[str, str] | None = None,
        compat: ProviderCompat | None = None,
    ):
        super().__init__(api_key, api_base)
        self.default_model = default_model
        self.extra_headers = extra_headers or {}
        self.compat = compat or ProviderCompat()
        self.compat.validate_protocol("anthropic_messages")

        from anthropic import AsyncAnthropic

        client_kw: dict[str, Any] = {}
        if api_key:
            client_kw["api_key"] = api_key
            client_kw["auth_token"] = ""
        if api_base:
            client_kw["base_url"] = api_base
        if extra_headers:
            client_kw["default_headers"] = extra_headers
        # Keep retries centralized in LLMProvider._run_with_retry to avoid retry amplification.
        client_kw["max_retries"] = 0
        self._client = AsyncAnthropic(**client_kw)
        if api_key:
            self._client.auth_token = None

    async def aclose(self) -> None:
        await self._client.close()

    def _set_runtime_credential(self, key: str | None) -> None:
        self.api_key = key
        self._client.api_key = key
        self._client.auth_token = None

    @classmethod
    def _handle_error(cls, e: Exception) -> LLMResponse:
        if isinstance(e, (ProviderCapabilityError, ProviderConfigurationError)):
            return LLMResponse(
                content=str(e),
                finish_reason="error",
                error_kind="capability"
                if isinstance(e, ProviderCapabilityError)
                else "configuration",
                error_should_retry=False,
            )
        response = getattr(e, "response", None)
        headers = getattr(response, "headers", None)
        payload = (
            getattr(e, "body", None)
            or getattr(e, "doc", None)
            or getattr(response, "text", None)
        )
        if payload is None and response is not None:
            response_json = getattr(response, "json", None)
            if callable(response_json):
                try:
                    payload = response_json()
                except Exception:
                    payload = None
        payload_text = (
            payload
            if isinstance(payload, str)
            else str(payload)
            if payload is not None
            else ""
        )
        msg = (
            f"Error: {payload_text.strip()[:500]}"
            if payload_text.strip()
            else f"Error calling LLM: {e}"
        )
        retry_after = cls._extract_retry_after_from_headers(headers)
        if retry_after is None:
            retry_after = LLMProvider._extract_retry_after(msg)

        status_code = getattr(e, "status_code", None)
        if status_code is None and response is not None:
            status_code = getattr(response, "status_code", None)

        should_retry: bool | None = None
        if headers is not None:
            raw = headers.get("x-should-retry")
            if isinstance(raw, str):
                lowered = raw.strip().lower()
                if lowered == "true":
                    should_retry = True
                elif lowered == "false":
                    should_retry = False

        error_kind: str | None = None
        error_name = e.__class__.__name__.lower()
        if "timeout" in error_name:
            error_kind = "timeout"
        elif "connection" in error_name:
            error_kind = "connection"
        error_type, error_code = LLMProvider._extract_error_type_code(payload)

        return LLMResponse(
            content=msg,
            finish_reason="error",
            retry_after=retry_after,
            error_status_code=int(status_code) if status_code is not None else None,
            error_kind=error_kind,
            error_type=error_type,
            error_code=error_code,
            error_retry_after_s=retry_after,
            error_should_retry=should_retry,
        )

    @staticmethod
    def _strip_prefix(model: str) -> str:
        if model.startswith("anthropic/"):
            return model[len("anthropic/") :]
        return model

    # ------------------------------------------------------------------
    # Message conversion: OpenAI chat format → Anthropic Messages API
    # ------------------------------------------------------------------

    def _convert_messages(
        self,
        messages: list[dict[str, Any]],
    ) -> tuple[str | list[dict[str, Any]], list[dict[str, Any]]]:
        """Return ``(system, anthropic_messages)``."""
        system: str | list[dict[str, Any]] = ""
        raw: list[dict[str, Any]] = []

        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content")

            if role == "system":
                system = (
                    content if isinstance(content, (str, list)) else str(content or "")
                )
                continue

            if role == "tool":
                if msg.get("images") and not self._accepts_images():
                    msg = {k: v for k, v in msg.items() if k != "images"}
                block = self._tool_result_block(msg)
                if raw and raw[-1]["role"] == "user":
                    prev_c = raw[-1]["content"]
                    if isinstance(prev_c, list):
                        prev_c.append(block)
                    else:
                        raw[-1]["content"] = [
                            {"type": "text", "text": prev_c or ""},
                            block,
                        ]
                else:
                    raw.append({"role": "user", "content": [block]})
                continue

            if role == "assistant":
                raw.append(
                    {"role": "assistant", "content": self._assistant_blocks(msg)}
                )
                continue

            if role == "user":
                raw.append(
                    {
                        "role": "user",
                        "content": self._convert_user_content(content),
                    }
                )
                continue

        return system, self._merge_consecutive(raw)

    def _accepts_images(self) -> bool:
        modalities = getattr(self, "input_modalities", None)
        return modalities is None or "image" in modalities

    @staticmethod
    def _tool_result_block(msg: dict[str, Any]) -> dict[str, Any]:
        content = msg.get("content")
        block: dict[str, Any] = {
            "type": "tool_result",
            "tool_use_id": msg.get("tool_call_id", ""),
        }
        images = msg.get("images")
        if isinstance(images, list) and images:
            # The runner keeps tool text in ``content`` and inline images in
            # ``images``; Anthropic accepts both inside one tool_result.
            text = content if isinstance(content, str) else str(content or "")
            content = [*([{"type": "text", "text": text}] if text else []), *images]
        if isinstance(content, str):
            block["content"] = content
        elif isinstance(content, list):
            # Tool results may carry images (e.g. from MCP tools) in the same
            # OpenAI ``image_url`` shape as user attachments.
            converted: list[dict[str, Any]] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "image_url":
                    image = AnthropicProvider._convert_image_block(item)
                    if image:
                        converted.append(image)
                elif isinstance(item, dict):
                    converted.append(item)
                else:
                    converted.append({"type": "text", "text": str(item)})
            block["content"] = converted
        else:
            block["content"] = str(content) if content else ""
        return block

    @staticmethod
    def _assistant_blocks(msg: dict[str, Any]) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = []
        content = msg.get("content")

        state = msg.get("provider_state")
        state_blocks = (
            state.get(ANTHROPIC_THINKING_BLOCKS) if isinstance(state, dict) else None
        )
        thinking_blocks = (
            state_blocks
            if isinstance(state_blocks, list)
            else msg.get("thinking_blocks")
        )
        for tb in thinking_blocks or []:
            if not isinstance(tb, dict):
                continue
            if tb.get("type") == "thinking":
                blocks.append(
                    {
                        "type": "thinking",
                        "thinking": tb.get("thinking", ""),
                        "signature": tb.get("signature", ""),
                    }
                )
            elif tb.get("type") == "redacted_thinking" and tb.get("data"):
                # Encrypted by the provider; it must go back byte-for-byte
                # and in its original position among the thinking blocks.
                blocks.append({"type": "redacted_thinking", "data": tb["data"]})

        if isinstance(content, str) and content:
            blocks.append({"type": "text", "text": content})
        elif isinstance(content, list):
            for item in content:
                blocks.append(
                    item
                    if isinstance(item, dict)
                    else {"type": "text", "text": str(item)}
                )

        for tc in msg.get("tool_calls") or []:
            if not isinstance(tc, dict):
                continue
            func = tc.get("function", {})
            args = func.get("arguments", "{}")
            if isinstance(args, str):
                args = json_repair.loads(args)
            blocks.append(
                {
                    "type": "tool_use",
                    "id": tc.get("id") or _gen_tool_id(),
                    "name": func.get("name", ""),
                    "input": args,
                }
            )

        return blocks or [{"type": "text", "text": ""}]

    def _convert_user_content(self, content: Any) -> Any:
        """Convert user message content, translating image_url blocks."""
        if isinstance(content, str) or content is None:
            return content or "(empty)"
        if not isinstance(content, list):
            return str(content)

        result: list[dict[str, Any]] = []
        for item in content:
            if not isinstance(item, dict):
                result.append({"type": "text", "text": str(item)})
                continue
            if item.get("type") == "image_url":
                converted = self._convert_image_block(item)
                if converted:
                    result.append(converted)
                continue
            result.append(item)
        return result or "(empty)"

    @staticmethod
    def _convert_image_block(block: dict[str, Any]) -> dict[str, Any] | None:
        """Convert OpenAI image_url block to Anthropic image block."""
        url = (block.get("image_url") or {}).get("url", "")
        if not url:
            return None
        m = re.match(r"data:(image/\w+);base64,(.+)", url, re.DOTALL)
        if m:
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": m.group(1),
                    "data": m.group(2),
                },
            }
        return {
            "type": "image",
            "source": {"type": "url", "url": url},
        }

    @staticmethod
    def _merge_consecutive(msgs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Anthropic requires alternating user/assistant roles."""
        merged: list[dict[str, Any]] = []
        for msg in msgs:
            if merged and merged[-1]["role"] == msg["role"]:
                prev_c = merged[-1]["content"]
                cur_c = msg["content"]
                if isinstance(prev_c, str):
                    prev_c = [{"type": "text", "text": prev_c}]
                if isinstance(cur_c, str):
                    cur_c = [{"type": "text", "text": cur_c}]
                if isinstance(cur_c, list):
                    prev_c.extend(cur_c)
                merged[-1]["content"] = prev_c
            else:
                merged.append(msg)
        return merged

    # ------------------------------------------------------------------
    # Tool definition conversion
    # ------------------------------------------------------------------

    @staticmethod
    def _convert_tools(
        tools: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]] | None:
        if not tools:
            return None
        result = []
        for tool in tools:
            func = tool.get("function", tool)
            entry: dict[str, Any] = {
                "name": func.get("name", ""),
                "input_schema": func.get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            }
            desc = func.get("description")
            if desc:
                entry["description"] = desc
            if "cache_control" in tool:
                entry["cache_control"] = tool["cache_control"]
            result.append(entry)
        return result

    @staticmethod
    def _convert_tool_choice(
        tool_choice: str | dict[str, Any] | None,
        thinking_enabled: bool = False,
    ) -> dict[str, Any] | None:
        if thinking_enabled:
            return {"type": "auto"}
        if tool_choice is None or tool_choice == "auto":
            return {"type": "auto"}
        if tool_choice == "required":
            return {"type": "any"}
        if tool_choice == "none":
            return None
        if isinstance(tool_choice, dict):
            name = tool_choice.get("function", {}).get("name")
            if name:
                return {"type": "tool", "name": name}
        return {"type": "auto"}

    # ------------------------------------------------------------------
    # Prompt caching
    # ------------------------------------------------------------------

    @classmethod
    def _apply_cache_control(
        cls,
        system: str | list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
    ) -> tuple[
        str | list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]] | None
    ]:
        marker = {"type": "ephemeral"}

        if isinstance(system, str) and system:
            system = [{"type": "text", "text": system, "cache_control": marker}]
        elif isinstance(system, list) and system:
            system = list(system)
            system[-1] = {**system[-1], "cache_control": marker}

        # The rolling breakpoint sits on the LAST message: the newest tool
        # results are written to the cache once and read back (lookback of up
        # to 20 blocks) by the next request. Marking the message before it
        # billed those results at full price and then again as a cache write.
        # Order of the prefix is tools → system → messages, so together with
        # the system marker and at most two tool markers this stays within
        # Anthropic's four-breakpoint limit.
        new_msgs = list(messages)
        if new_msgs:
            m = new_msgs[-1]
            c = m.get("content")
            if isinstance(c, str) and c:
                new_msgs[-1] = {
                    **m,
                    "content": [{"type": "text", "text": c, "cache_control": marker}],
                }
            elif isinstance(c, list) and c:
                nc = list(c)
                last = nc[-1]
                # Thinking blocks cannot carry cache_control.
                if isinstance(last, dict) and last.get("type") not in {
                    "thinking",
                    "redacted_thinking",
                }:
                    nc[-1] = {**last, "cache_control": marker}
                    new_msgs[-1] = {**m, "content": nc}

        new_tools = tools
        if tools:
            new_tools = list(tools)
            for idx in cls._tool_cache_marker_indices(new_tools):
                new_tools[idx] = {**new_tools[idx], "cache_control": marker}

        return system, new_msgs, new_tools

    # ------------------------------------------------------------------
    # Build API kwargs
    # ------------------------------------------------------------------

    def _build_kwargs(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str | None,
        max_tokens: int,
        temperature: float,
        reasoning_effort: str | None,
        tool_choice: str | dict[str, Any] | None,
        supports_caching: bool = True,
    ) -> dict[str, Any]:
        self.validate_request_capabilities(messages, tools)
        model_name = self._strip_prefix(model or self.default_model)
        system, anthropic_msgs = self._convert_messages(
            self._sanitize_empty_content(messages)
        )
        anthropic_tools = self._convert_tools(tools)

        if supports_caching:
            system, anthropic_msgs, anthropic_tools = self._apply_cache_control(
                system,
                anthropic_msgs,
                anthropic_tools,
            )

        max_tokens = max(1, max_tokens)
        effort = normalize_reasoning_effort(reasoning_effort)
        if self.reasoning_supported is False:
            effort = None
        summarized_thinking = (
            self.reasoning_supported is not False
            and self._uses_summarized_thinking(model_name, effort)
        )
        thinking_enabled = summarized_thinking or effort not in {None, "auto", "none"}
        if not summarized_thinking and effort == "minimal":
            # The legacy budget API cannot think for fewer than 1,024 tokens
            # (which is "low"), so the level below it is thinking off.
            thinking_enabled = False

        kwargs: dict[str, Any] = {
            "model": model_name,
            "messages": anthropic_msgs,
            "max_tokens": max_tokens,
        }

        if system:
            kwargs["system"] = system

        if summarized_thinking:
            # Current Claude reasoning models expose only summarized thinking
            # to clients while signed blocks are retained for continuation.
            kwargs["thinking"] = {"type": "adaptive", "display": "summarized"}
            if effort not in {None, "auto", "adaptive"}:
                kwargs["output_config"] = {"effort": effort}
        elif thinking_enabled:
            budget, request_max_tokens = self._thinking_budget(effort, max_tokens)
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": budget}
            kwargs["max_tokens"] = request_max_tokens
            kwargs["temperature"] = 1.0
        else:
            kwargs["temperature"] = temperature

        if self.compat.temperature is False:
            kwargs.pop("temperature", None)
        elif self.compat.temperature is True:
            kwargs.setdefault("temperature", temperature)
        if "temperature" in kwargs:
            # SDK 1.x removed the typed parameter. The documented extra_body
            # path preserves the same legacy wire value on both SDK generations.
            kwargs["extra_body"] = {"temperature": kwargs.pop("temperature")}

        if anthropic_tools:
            kwargs["tools"] = anthropic_tools
            tc = self._convert_tool_choice(tool_choice, thinking_enabled)
            if tc:
                kwargs["tool_choice"] = tc

        if self.extra_headers:
            kwargs["extra_headers"] = self.extra_headers

        return kwargs

    @staticmethod
    def _thinking_budget(effort: str | None, max_tokens: int) -> tuple[int, int]:
        """Return ``(budget_tokens, max_tokens)`` for the legacy budget API.

        Budgets rise strictly with effort (low < medium < high < xhigh < max)
        for every ``max_tokens``. The larger levels claim a growing share of
        the caller's ``max_tokens`` (normally the model's output cap) while
        leaving room for the visible answer, so they never push the request
        past that cap. Only when ``max_tokens`` is too small for a level's
        floor is it raised to ``budget + reserve``; the budget always stays
        strictly below the request's ``max_tokens`` as the API requires.
        """

        floor, share = _THINKING_BUDGETS.get(
            effort or "medium", _THINKING_BUDGETS["medium"]
        )
        available = max(0, max_tokens - _THINKING_ANSWER_RESERVE)
        budget = max(floor, int(available * share))
        return budget, max(max_tokens, budget + _THINKING_ANSWER_RESERVE)

    @staticmethod
    def _uses_summarized_thinking(model_name: str, effort: str | None) -> bool:
        if effort == "none":
            return False
        capabilities = infer_reasoning_capabilities(
            model_name,
            provider_name="anthropic",
        )
        return bool(
            capabilities
            and capabilities.supports_summary
            and (effort not in {None, "auto"} or capabilities.default_enabled)
        )

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_response(
        response: Any, *, expose_reasoning_summary: bool = False
    ) -> LLMResponse:
        content_parts: list[str] = []
        tool_calls: list[ToolCallRequest] = []
        thinking_blocks: list[dict[str, Any]] = []

        for block in response.content:
            if block.type == "text":
                content_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCallRequest(
                        id=block.id,
                        name=block.name,
                        arguments=block.input if isinstance(block.input, dict) else {},
                    )
                )
            elif block.type == "thinking":
                thinking_blocks.append(
                    {
                        "type": "thinking",
                        "thinking": block.thinking,
                        "signature": getattr(block, "signature", ""),
                    }
                )
            elif block.type == "redacted_thinking":
                data = getattr(block, "data", None)
                if isinstance(data, str) and data:
                    thinking_blocks.append({"type": "redacted_thinking", "data": data})

        stop_reason = response.stop_reason or ""
        finish_reason = _STOP_REASON_MAP.get(stop_reason, stop_reason or "stop")
        if stop_reason == "refusal" and not "".join(content_parts).strip():
            # Surface the refusal as the visible answer rather than an empty
            # completion the runner would keep retrying.
            content_parts = [_REFUSAL_MESSAGE]

        usage: dict[str, int] = {}
        if response.usage:
            input_tokens = response.usage.input_tokens
            cache_creation = (
                getattr(response.usage, "cache_creation_input_tokens", 0) or 0
            )
            cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
            total_prompt_tokens = input_tokens + cache_creation + cache_read
            usage = {
                "prompt_tokens": total_prompt_tokens,
                "completion_tokens": response.usage.output_tokens,
                "total_tokens": total_prompt_tokens + response.usage.output_tokens,
            }
            for attr in ("cache_creation_input_tokens", "cache_read_input_tokens"):
                val = getattr(response.usage, attr, 0)
                if val:
                    usage[attr] = val
            # Normalize to cached_tokens for downstream consistency.
            if cache_read:
                usage["cached_tokens"] = cache_read

        return LLMResponse(
            content="".join(content_parts) or None,
            tool_calls=tool_calls,
            finish_reason=finish_reason,
            usage=usage,
            thinking_blocks=thinking_blocks or None,
            reasoning_summary=(
                "\n\n".join(
                    block["thinking"]
                    for block in thinking_blocks
                    if block.get("type") == "thinking"
                    and isinstance(block.get("thinking"), str)
                    and block["thinking"].strip()
                )
                or None
                if expose_reasoning_summary
                else None
            ),
            provider_state=(
                {ANTHROPIC_THINKING_BLOCKS: thinking_blocks}
                if thinking_blocks
                else None
            ),
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        reasoning_effort: str | None = None,
        tool_choice: str | dict[str, Any] | None = None,
    ) -> LLMResponse:
        model_name = self._strip_prefix(model or self.default_model)
        effort = normalize_reasoning_effort(reasoning_effort)
        summarized_thinking = self._uses_summarized_thinking(model_name, effort)
        started = time.monotonic()
        result: LLMResponse | None = None
        try:
            await self.refresh_request_credentials()
            kwargs = self._build_kwargs(
                messages,
                tools,
                model,
                max_tokens,
                temperature,
                reasoning_effort,
                tool_choice,
            )

            try:
                response = await self._client.messages.create(**kwargs)
            except Exception as exc:
                if not self._thinking_replay_rejected(exc, kwargs):
                    raise
                logger.warning(
                    "Anthropic rejected replayed thinking blocks; retrying once "
                    "without them"
                )
                response = await self._client.messages.create(
                    **self._without_thinking_history(kwargs)
                )
            result = self._parse_response(
                response,
                expose_reasoning_summary=summarized_thinking,
            )
            return result
        except Exception as e:
            result = self.redact_error(
                self._handle_error(e), e, [self.api_key, *self.extra_headers.values()]
            )
            return result
        finally:
            self._emit_observability(
                model=model,
                messages=messages,
                tools=tools,
                response=result,
                duration_ms=int((time.monotonic() - started) * 1000),
            )

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        reasoning_effort: str | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        on_content_delta: Callable[[str], Awaitable[None]] | None = None,
        on_reasoning_delta: ReasoningDeltaCallback | None = None,
    ) -> LLMResponse:
        model_name = self._strip_prefix(model or self.default_model)
        effort = normalize_reasoning_effort(reasoning_effort)
        summarized_thinking = self._uses_summarized_thinking(model_name, effort)
        idle_timeout_s = resolve_stream_idle_timeout_s()
        started = time.monotonic()
        result: LLMResponse | None = None
        try:
            await self.refresh_request_credentials()
            kwargs = self._build_kwargs(
                messages,
                tools,
                model,
                max_tokens,
                temperature,
                reasoning_effort,
                tool_choice,
            )

            emitted = False

            async def consume(request: dict[str, Any]) -> Any:
                nonlocal emitted
                async with self._client.messages.stream(**request) as stream:
                    async for event in iter_with_stream_idle_timeout(
                        stream, timeout_s=idle_timeout_s
                    ):
                        text = _stream_text_delta(event)
                        if text and on_content_delta:
                            emitted = True
                            await on_content_delta(text)
                        reasoning = _stream_reasoning_delta(event)
                        if reasoning and on_reasoning_delta:
                            emitted = True
                            await on_reasoning_delta(
                                reasoning,
                                (
                                    ReasoningChannel.SUMMARY
                                    if summarized_thinking
                                    else ReasoningChannel.PROVIDER_TRACE
                                ),
                            )
                    return await wait_for_stream_activity(
                        stream.get_final_message(), timeout_s=idle_timeout_s
                    )

            try:
                response = await consume(kwargs)
            except Exception as exc:
                # Only before anything reached the caller: a retry must never
                # duplicate streamed text.
                if emitted or not self._thinking_replay_rejected(exc, kwargs):
                    raise
                logger.warning(
                    "Anthropic rejected replayed thinking blocks; retrying once "
                    "without them"
                )
                response = await consume(self._without_thinking_history(kwargs))
            result = self._parse_response(
                response,
                expose_reasoning_summary=summarized_thinking,
            )
            return result
        except StreamIdleTimeoutError:
            result = LLMResponse(
                content=(
                    f"Error calling LLM: stream stalled for more than "
                    f"{idle_timeout_s} seconds"
                ),
                finish_reason="error",
                error_kind="timeout",
            )
            return result
        except Exception as e:
            result = self.redact_error(
                self._handle_error(e), e, [self.api_key, *self.extra_headers.values()]
            )
            return result
        finally:
            self._emit_observability(
                model=model,
                messages=messages,
                tools=tools,
                response=result,
                duration_ms=int((time.monotonic() - started) * 1000),
            )

    def get_default_model(self) -> str:
        return self.default_model

    # ------------------------------------------------------------------
    # Recovery from rejected thinking replay
    # ------------------------------------------------------------------

    @staticmethod
    def _has_thinking_history(messages: Any) -> bool:
        for message in messages or ():
            content = message.get("content") if isinstance(message, dict) else None
            if message.get("role") == "assistant" and isinstance(content, list):
                if any(
                    isinstance(block, dict) and block.get("type") in _THINKING_TYPES
                    for block in content
                ):
                    return True
        return False

    @classmethod
    def _thinking_replay_rejected(cls, exc: Exception, kwargs: dict[str, Any]) -> bool:
        """True for an HTTP 400 that blames a replayed thinking block.

        Signed thinking blocks can become unusable (for example after a model
        or credential switch); the API then rejects the whole request. Only
        requests that actually carry thinking history qualify.
        """

        status = getattr(exc, "status_code", None)
        if status is None:
            status = getattr(getattr(exc, "response", None), "status_code", None)
        if status != 400 or not cls._has_thinking_history(kwargs.get("messages")):
            return False
        text = " ".join(
            str(part)
            for part in (exc, getattr(exc, "message", None), getattr(exc, "body", None))
            if part
        ).lower()
        return "thinking" in text and ("block" in text or "signature" in text)

    @staticmethod
    def _without_thinking_history(kwargs: dict[str, Any]) -> dict[str, Any]:
        """Copy ``kwargs`` with thinking blocks stripped and thinking disabled.

        Thinking stays off for this one request: with it on, the API requires
        the latest assistant tool-use turn to start with a thinking block,
        which is exactly what was just removed.
        """

        messages: list[dict[str, Any]] = []
        for message in kwargs.get("messages") or ():
            content = message.get("content")
            if message.get("role") == "assistant" and isinstance(content, list):
                kept = [
                    block
                    for block in content
                    if not (
                        isinstance(block, dict) and block.get("type") in _THINKING_TYPES
                    )
                ]
                if len(kept) != len(content):
                    message = {
                        **message,
                        "content": kept or [{"type": "text", "text": "(no content)"}],
                    }
            messages.append(message)
        retry = {**kwargs, "messages": messages}
        retry.pop("thinking", None)
        return retry

    def _emit_observability(
        self,
        *,
        model: str | None,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        response: LLMResponse | None,
        duration_ms: int,
    ) -> None:
        """Forward one Anthropic call to the observability bus."""
        try:
            chosen_model = model or self.default_model

            request_preview: dict[str, Any] = {
                "model": chosen_model,
                "message_count": len(messages),
                "tool_count": len(tools) if tools else 0,
                "first_role": messages[0].get("role") if messages else None,
                "last_role": messages[-1].get("role") if messages else None,
            }

            response_text: Any = None
            tool_calls_payload: list[dict[str, Any]] | None = None
            usage: dict[str, int] | None = None
            finish_reason: str | None = None
            error: str | None = None
            status = "ok"

            if response is not None:
                finish_reason = response.finish_reason
                usage = dict(response.usage) if response.usage else None
                response_text = response.content
                if response.tool_calls:
                    tool_calls_payload = [
                        {
                            "name": tc.name,
                            "arguments": tc.arguments,
                        }
                        for tc in response.tool_calls
                    ]
                if response.finish_reason == "error":
                    status = "error"
                    error = response.content

            log_llm_call(
                provider="anthropic",
                model=chosen_model,
                phase=None,
                duration_ms=duration_ms,
                status=status,
                finish_reason=finish_reason,
                usage=usage,
                request=request_preview,
                response=response_text,
                tool_calls=tool_calls_payload,
                error=error,
            )
        except Exception:  # pragma: no cover - logging must not raise
            pass
