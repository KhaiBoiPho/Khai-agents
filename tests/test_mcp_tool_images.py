"""Images in MCP tool results: inline for image models, saved file otherwise."""

from __future__ import annotations

import asyncio
import base64
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.agent_runtime.runner import AgentRunner, AgentRunSpec
from core.agent_runtime.tools.registry import ToolRegistry
from core.mcp.tools import MCP_IMAGES_METADATA_KEY, McpToolAdapter, _result_text
from core.providers.anthropic import AnthropicProvider
from core.providers.base import LLMResponse, ToolCallRequest
from core.providers.openai_compat import OpenAICompatProvider

PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-image-bytes"
PNG_B64 = base64.b64encode(PNG_BYTES).decode()


def _mcp_result() -> SimpleNamespace:
    return SimpleNamespace(
        content=[
            SimpleNamespace(type="text", text="rendered chart"),
            SimpleNamespace(type="image", data=PNG_B64, mimeType="image/png"),
        ],
        isError=False,
        structuredContent=None,
    )


def _adapter() -> McpToolAdapter:
    server = SimpleNamespace(
        server_id="srv",
        name="charts",
        source=SimpleNamespace(value="user"),
        definition=SimpleNamespace(
            policy_for=lambda _name: SimpleNamespace(value="auto"),
            supports_parallel_tool_calls=False,
        ),
    )

    class _Connection:
        def __init__(self) -> None:
            self.server = server

        async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
            return _mcp_result()

    definition = SimpleNamespace(
        name="render",
        description="Render a chart",
        inputSchema={"type": "object", "properties": {}},
        annotations=SimpleNamespace(readOnlyHint=True),
    )
    return McpToolAdapter(_Connection(), definition, visible_name="mcp_charts_render")


class _Provider:
    def __init__(self, input_modalities: tuple[str, ...] | None) -> None:
        self.input_modalities = input_modalities
        self._responses = [
            LLMResponse(
                content="",
                tool_calls=[
                    ToolCallRequest(id="call-1", name="mcp_charts_render", arguments={})
                ],
                finish_reason="tool_calls",
            ),
            LLMResponse(content="done", finish_reason="stop"),
        ]
        self.calls = 0

    def get_default_model(self) -> str:
        return "fake-model"

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        index = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        return self._responses[index]


def _run(modalities: tuple[str, ...] | None, workspace: Path | None) -> dict[str, Any]:
    registry = ToolRegistry()
    registry.register(_adapter())
    spec = AgentRunSpec(
        initial_messages=[{"role": "user", "content": "chart please"}],
        tools=registry,
        model="fake-model",
        max_iterations=4,
        max_tool_result_chars=50_000,
        workspace=workspace,
        session_key="sess",
    )
    result = asyncio.run(AgentRunner(_Provider(modalities)).run(spec))
    return next(m for m in result.messages if m.get("role") == "tool")


def test_adapter_collects_images_without_base64_in_text() -> None:
    result = asyncio.run(_adapter().execute())
    assert "rendered chart" in result
    assert "[image 1: image/png" in result
    assert PNG_B64 not in result
    assert result.metadata[MCP_IMAGES_METADATA_KEY] == [
        {"mimeType": "image/png", "data": PNG_B64}
    ]
    # Plain rendering (no collector) keeps the historical placeholder.
    assert "[image omitted: image/png" in _result_text(_mcp_result())


def test_image_capable_model_receives_image_block(tmp_path: Path) -> None:
    message = _run(("text", "image"), tmp_path)
    # Content stays text (what persistence stores); images ride beside it.
    assert isinstance(message["content"], str)
    assert "rendered chart" in message["content"]
    assert "[image 1: image/png" in message["content"]
    assert PNG_B64 not in message["content"]
    assert message["images"] == [
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{PNG_B64}"},
        }
    ]
    assert not (tmp_path / ".deepcode").exists()

    from core.sessions.transcript import kernel_message_to_record

    record = kernel_message_to_record(message)
    assert record is not None and PNG_B64 not in record.content


def test_text_only_or_unknown_model_gets_saved_file(tmp_path: Path) -> None:
    for modalities in (("text",), None):
        message = _run(modalities, tmp_path)
        content = message["content"]
        assert isinstance(content, str)
        assert "images" not in message
        assert PNG_B64 not in content
        saved = tmp_path / ".deepcode" / "tool-results" / "sess" / "call-1-image-1.png"
        assert saved.read_bytes() == PNG_BYTES
        assert f"[image 1 saved to: {saved}" in content


def test_unsupported_inline_mime_is_saved_even_for_image_models(tmp_path: Path) -> None:
    runner = AgentRunner(_Provider(("text", "image")))
    from core.agent_runtime.tools.base import ToolResult

    spec = AgentRunSpec(
        initial_messages=[],
        tools=ToolRegistry(),
        model="m",
        max_iterations=1,
        max_tool_result_chars=10_000,
        workspace=tmp_path,
        session_key="s",
    )
    svg = base64.b64encode(b"<svg/>").decode()
    result = ToolResult(
        "[image 1: image/svg+xml, ~6 bytes]",
        metadata={"images": [{"mimeType": "image/svg+xml", "data": svg}]},
    )
    content = runner._normalize_tool_result(spec, "c1", "mcp_x", result)
    assert isinstance(content, str)
    assert "c1-image-1.svg" in content


# ---- adapter serialization ---------------------------------------------------


_TOOL_MESSAGES = [
    {"role": "user", "content": "go"},
    {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
            {"id": "call_2", "type": "function", "function": {"name": "b", "arguments": "{}"}},
        ],
    },
    {
        "role": "tool",
        "tool_call_id": "call_1",
        "content": [
            {"type": "text", "text": "chart"},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{PNG_B64}"}},
        ],
    },
    {"role": "tool", "tool_call_id": "call_2", "content": "plain"},
]


_IMAGE_PART = {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{PNG_B64}"}}
_ANTHROPIC_IMAGE = {
    "type": "image",
    "source": {"type": "base64", "media_type": "image/png", "data": PNG_B64},
}


def test_anthropic_serializes_image_inside_tool_result() -> None:
    block = AnthropicProvider._tool_result_block(_TOOL_MESSAGES[2])
    assert block["type"] == "tool_result"
    assert block["content"] == [{"type": "text", "text": "chart"}, _ANTHROPIC_IMAGE]

    # The runner's shape: text content plus a separate ``images`` key.
    runner_shape = {
        "role": "tool",
        "tool_call_id": "call_1",
        "content": "chart [image 1: image/png]",
        "images": [_IMAGE_PART],
    }
    block = AnthropicProvider._tool_result_block(runner_shape)
    assert block["content"] == [
        {"type": "text", "text": "chart [image 1: image/png]"},
        _ANTHROPIC_IMAGE,
    ]


def test_anthropic_drops_images_for_declared_text_only_model() -> None:
    provider = object.__new__(AnthropicProvider)
    provider.input_modalities = ("text",)
    _system, converted = provider._convert_messages(
        [
            {"role": "user", "content": "go"},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"id": "c", "type": "function", "function": {"name": "a", "arguments": "{}"}}
                ],
            },
            {"role": "tool", "tool_call_id": "c", "content": "t", "images": [_IMAGE_PART]},
        ]
    )
    assert converted[-1]["content"][0]["content"] == "t"


def test_openai_compat_lifts_tool_images_into_following_user_turn() -> None:
    lifted = OpenAICompatProvider._lift_tool_result_images(_TOOL_MESSAGES)
    roles = [m["role"] for m in lifted]
    assert roles == ["user", "assistant", "tool", "tool", "user"]
    assert lifted[2]["content"] == "chart"
    assert lifted[3]["content"] == "plain"
    images = [p for p in lifted[4]["content"] if p.get("type") == "image_url"]
    assert len(images) == 1

    # A user message already following the tool run absorbs the images.
    with_user = [*_TOOL_MESSAGES, {"role": "user", "content": "next"}]
    lifted = OpenAICompatProvider._lift_tool_result_images(with_user)
    assert [m["role"] for m in lifted] == ["user", "assistant", "tool", "tool", "user"]
    assert lifted[4]["content"][-1] == {"type": "text", "text": "next"}

    # The runner's ``images`` key lifts the same way and never reaches the wire.
    runner_shape = [
        *_TOOL_MESSAGES[:2],
        {"role": "tool", "tool_call_id": "call_1", "content": "chart", "images": [_IMAGE_PART]},
        _TOOL_MESSAGES[3],
    ]
    lifted = OpenAICompatProvider._lift_tool_result_images(runner_shape)
    assert [m["role"] for m in lifted] == ["user", "assistant", "tool", "tool", "user"]
    assert "images" not in lifted[2]
    assert _IMAGE_PART in lifted[4]["content"]
    dropped = OpenAICompatProvider._lift_tool_result_images(runner_shape, drop_images=True)
    assert [m["role"] for m in dropped] == ["user", "assistant", "tool", "tool"]
    assert "images" not in dropped[2]

    # No list content: messages are returned untouched.
    plain = [{"role": "user", "content": "hi"}]
    assert OpenAICompatProvider._lift_tool_result_images(plain) is plain


def test_openai_responses_body_carries_image_as_input_image() -> None:
    from core.providers.openai_responses.converters import convert_messages

    lifted = OpenAICompatProvider._lift_tool_result_images(_TOOL_MESSAGES)
    _system, items = convert_messages(lifted)
    outputs = [i for i in items if i.get("type") == "function_call_output"]
    assert [o["output"] for o in outputs] == ["chart", "plain"]
    last = items[-1]
    assert last["role"] == "user"
    assert any(part.get("type") == "input_image" for part in last["content"])
