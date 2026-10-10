"""Anthropic extended-thinking robustness (stubbed SDK; no network)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.providers.anthropic import AnthropicProvider
from core.providers.protocol_config import ProviderCompat
from core.providers.reasoning import ANTHROPIC_THINKING_BLOCKS

LEGACY_MODEL = "claude-sonnet-4-20250514"  # budget_tokens thinking path


def _provider(model: str = LEGACY_MODEL) -> AnthropicProvider:
    provider = object.__new__(AnthropicProvider)
    provider.api_key = None
    provider.default_model = model
    provider.extra_headers = {}
    provider.compat = ProviderCompat()
    provider._emit_observability = lambda **kwargs: None

    async def no_refresh() -> None:
        return None

    provider.refresh_request_credentials = no_refresh
    return provider


def _response(*blocks: Any, stop_reason: str = "end_turn") -> SimpleNamespace:
    return SimpleNamespace(content=list(blocks), stop_reason=stop_reason, usage=None)


# ---- (a) redacted_thinking round trip --------------------------------------


def test_redacted_thinking_is_preserved_and_replayed_in_order() -> None:
    response = AnthropicProvider._parse_response(
        _response(
            SimpleNamespace(type="thinking", thinking="plan", signature="sig-1"),
            SimpleNamespace(type="redacted_thinking", data="ENCRYPTED=="),
            SimpleNamespace(type="text", text="calling"),
            SimpleNamespace(type="tool_use", id="toolu_1", name="grep", input={}),
            stop_reason="tool_use",
        ),
        expose_reasoning_summary=True,
    )

    expected = [
        {"type": "thinking", "thinking": "plan", "signature": "sig-1"},
        {"type": "redacted_thinking", "data": "ENCRYPTED=="},
    ]
    assert response.provider_state == {ANTHROPIC_THINKING_BLOCKS: expected}
    assert response.thinking_blocks == expected
    # Redacted content never leaks into the visible reasoning summary.
    assert response.reasoning_summary == "plan"

    blocks = AnthropicProvider._assistant_blocks(
        {
            "role": "assistant",
            "content": "calling",
            "provider_state": response.provider_state,
            "tool_calls": [
                {
                    "id": "toolu_1",
                    "type": "function",
                    "function": {"name": "grep", "arguments": "{}"},
                }
            ],
        }
    )
    assert [b["type"] for b in blocks] == [
        "thinking",
        "redacted_thinking",
        "text",
        "tool_use",
    ]
    assert blocks[1] == {"type": "redacted_thinking", "data": "ENCRYPTED=="}


def test_redacted_thinking_only_response_still_round_trips() -> None:
    response = AnthropicProvider._parse_response(
        _response(
            SimpleNamespace(type="redacted_thinking", data="OPAQUE"),
            SimpleNamespace(type="text", text="ok"),
        )
    )
    assert response.provider_state == {
        ANTHROPIC_THINKING_BLOCKS: [{"type": "redacted_thinking", "data": "OPAQUE"}]
    }
    assert response.reasoning_summary is None


# ---- (b) monotonic legacy budgets ------------------------------------------


def _budget(effort: str | None, max_tokens: int) -> tuple[int | None, int]:
    kwargs = _provider()._build_kwargs(
        [{"role": "user", "content": "hi"}],
        None,
        LEGACY_MODEL,
        max_tokens,
        0.2,
        effort,
        None,
        supports_caching=False,
    )
    thinking = kwargs.get("thinking")
    return (thinking or {}).get("budget_tokens"), kwargs["max_tokens"]


@pytest.mark.parametrize("max_tokens", [1, 4096, 8192, 16000, 32000, 64000, 128000])
def test_budgets_are_strictly_monotonic_and_below_max_tokens(max_tokens: int) -> None:
    minimal, _ = _budget("minimal", max_tokens)
    assert minimal is None  # below the API's 1,024 floor: thinking off

    previous = 0
    for effort in ("low", "medium", "high", "xhigh", "max"):
        budget, request_max = _budget(effort, max_tokens)
        assert budget is not None and budget >= 1024
        assert budget > previous, (effort, budget, previous)
        assert budget < request_max
        previous = budget


def test_low_and_medium_keep_their_documented_budgets() -> None:
    assert _budget("low", 64000)[0] == 1024
    assert _budget("medium", 64000)[0] == 4096


def test_large_max_tokens_is_respected_not_exceeded() -> None:
    # With a model-sized output cap, no level pushes the request past it.
    for effort in ("high", "xhigh", "max"):
        budget, request_max = _budget(effort, 64000)
        assert request_max == 64000
        assert budget < 64000


def test_minimal_disables_thinking_on_legacy_path() -> None:
    kwargs = _provider()._build_kwargs(
        [{"role": "user", "content": "hi"}],
        [{"type": "function", "function": {"name": "t", "parameters": {}}}],
        LEGACY_MODEL,
        8192,
        0.2,
        "minimal",
        "required",
        supports_caching=False,
    )
    assert "thinking" not in kwargs
    assert kwargs["extra_body"]["temperature"] == 0.2
    assert kwargs["tool_choice"] == {"type": "any"}


# ---- (c) stop reasons -------------------------------------------------------


def test_pause_turn_maps_to_continuation() -> None:
    response = AnthropicProvider._parse_response(
        _response(SimpleNamespace(type="text", text="partial"), stop_reason="pause_turn")
    )
    assert response.finish_reason == "length"


def test_refusal_is_surfaced_with_clear_message() -> None:
    empty = AnthropicProvider._parse_response(_response(stop_reason="refusal"))
    assert empty.finish_reason == "refusal"
    assert empty.content and "declined" in empty.content

    with_text = AnthropicProvider._parse_response(
        _response(SimpleNamespace(type="text", text="I can't help."), stop_reason="refusal")
    )
    assert with_text.finish_reason == "refusal"
    assert with_text.content == "I can't help."


def test_known_stop_reasons_unchanged() -> None:
    for raw, expected in (
        ("end_turn", "stop"),
        ("tool_use", "tool_calls"),
        ("max_tokens", "length"),
        ("stop_sequence", "stop"),
    ):
        response = AnthropicProvider._parse_response(
            _response(SimpleNamespace(type="text", text="x"), stop_reason=raw)
        )
        assert response.finish_reason == expected


# ---- (d) retry once without thinking history -------------------------------


class _BadRequest(Exception):
    status_code = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.body = {"error": {"type": "invalid_request_error", "message": message}}


_HISTORY = [
    {"role": "user", "content": "find it"},
    {
        "role": "assistant",
        "content": "",
        "provider_state": {
            ANTHROPIC_THINKING_BLOCKS: [
                {"type": "thinking", "thinking": "x", "signature": "stale"},
                {"type": "redacted_thinking", "data": "OLD"},
            ]
        },
        "tool_calls": [
            {
                "id": "toolu_1",
                "type": "function",
                "function": {"name": "grep", "arguments": "{}"},
            }
        ],
    },
    {"role": "tool", "tool_call_id": "toolu_1", "content": "hit"},
]


def _thinking_types(request: dict[str, Any]) -> list[str]:
    return [
        block.get("type")
        for message in request["messages"]
        if isinstance(message.get("content"), list)
        for block in message["content"]
        if block.get("type") in {"thinking", "redacted_thinking"}
    ]


def test_chat_retries_once_without_thinking_blocks_on_invalid_signature() -> None:
    provider = _provider()
    requests: list[dict[str, Any]] = []

    async def create(**kwargs: Any) -> Any:
        requests.append(kwargs)
        if len(requests) == 1:
            raise _BadRequest(
                "messages.1.content.0: Invalid `signature` in `thinking` block"
            )
        return _response(SimpleNamespace(type="text", text="recovered"))

    provider._client = SimpleNamespace(messages=SimpleNamespace(create=create))
    result = asyncio.run(provider.chat(_HISTORY, reasoning_effort="high"))

    assert result.content == "recovered"
    assert len(requests) == 2
    assert _thinking_types(requests[0]) == ["thinking", "redacted_thinking"]
    assert "thinking" in requests[0]
    assert _thinking_types(requests[1]) == []
    assert "thinking" not in requests[1]
    # The tool_use / tool_result pairing is intact.
    assistant = requests[1]["messages"][1]
    assert [b["type"] for b in assistant["content"]] == ["tool_use"]


def test_chat_does_not_retry_unrelated_400_or_second_failure() -> None:
    provider = _provider()
    calls = {"n": 0}

    async def create(**kwargs: Any) -> Any:
        calls["n"] += 1
        raise _BadRequest("max_tokens: field required")

    provider._client = SimpleNamespace(messages=SimpleNamespace(create=create))
    result = asyncio.run(provider.chat(_HISTORY, reasoning_effort="high"))
    assert result.finish_reason == "error"
    assert calls["n"] == 1

    calls["n"] = 0

    async def always_thinking_error(**kwargs: Any) -> Any:
        calls["n"] += 1
        raise _BadRequest("thinking blocks cannot be modified")

    provider._client = SimpleNamespace(
        messages=SimpleNamespace(create=always_thinking_error)
    )
    result = asyncio.run(provider.chat(_HISTORY, reasoning_effort="high"))
    assert result.finish_reason == "error"
    assert calls["n"] == 2  # exactly one retry


def test_chat_without_thinking_history_never_retries() -> None:
    provider = _provider()
    calls = {"n": 0}

    async def create(**kwargs: Any) -> Any:
        calls["n"] += 1
        raise _BadRequest("Invalid `signature` in `thinking` block")

    provider._client = SimpleNamespace(messages=SimpleNamespace(create=create))
    asyncio.run(provider.chat([{"role": "user", "content": "hi"}]))
    assert calls["n"] == 1


def test_stream_retries_before_any_delta_was_emitted() -> None:
    provider = _provider()
    requests: list[dict[str, Any]] = []

    class _Stream:
        def __init__(self, kwargs: dict[str, Any]) -> None:
            self._kwargs = kwargs
            self._events = iter([{"delta": {"type": "text_delta", "text": "ok"}}])

        async def __aenter__(self):
            requests.append(self._kwargs)
            if len(requests) == 1:
                raise _BadRequest("Invalid `signature` in `thinking` block")
            return self

        async def __aexit__(self, *exc: Any) -> bool:
            return False

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._events)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

        async def get_final_message(self):
            return _response(SimpleNamespace(type="text", text="ok"))

    provider._client = SimpleNamespace(
        messages=SimpleNamespace(stream=lambda **kwargs: _Stream(kwargs))
    )
    deltas: list[str] = []

    async def on_delta(text: str) -> None:
        deltas.append(text)

    result = asyncio.run(
        provider.chat_stream(
            _HISTORY, reasoning_effort="high", on_content_delta=on_delta
        )
    )
    assert result.content == "ok"
    assert deltas == ["ok"]
    assert len(requests) == 2
    assert _thinking_types(requests[1]) == []
