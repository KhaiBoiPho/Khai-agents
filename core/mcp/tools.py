"""MCP capabilities adapted to native DeepCode Tool contracts."""

from __future__ import annotations

from html.parser import HTMLParser
import json
import time
from typing import Any

from loguru import logger

from core.agent_runtime.tools.base import Tool, ToolResult, sanitize_description
from core.mcp.connection import McpConnection
from core.mcp.models import (
    McpToolAnnotations,
    McpToolIdentity,
)
from core.mcp.schema import normalize_schema_for_openai
from core.observability import log_mcp_call

_MCP_DESCRIPTION_MAX_CHARS = 8_000


class _HtmlMarkdownFallback(HTMLParser):
    """Extract readable Markdown when GenOffice rejects HTML with no content."""

    _SKIP = frozenset({"script", "style", "noscript", "svg", "template"})
    _BLOCK = frozenset({"p", "div", "section", "article", "br", "tr", "li"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0
        self.list_depth = 0
        self.heading_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in self._SKIP:
            self.skip_depth += 1
        elif not self.skip_depth:
            if tag == "ul" or tag == "ol":
                self.list_depth += 1
                self.parts.append("\n")
            elif tag == "li":
                self.parts.append("\n- ")
            elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                self.heading_depth = int(tag[1])
                self.parts.append("\n" + "#" * self.heading_depth + " ")
            elif tag in self._BLOCK:
                self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self._SKIP and self.skip_depth:
            self.skip_depth -= 1
        elif not self.skip_depth:
            if tag in {"ul", "ol"}:
                self.list_depth = max(0, self.list_depth - 1)
                self.parts.append("\n")
            elif tag in self._BLOCK or tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                self.parts.append("\n")
                if tag.startswith("h"):
                    self.heading_depth = 0

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)

    def markdown(self) -> str:
        lines = [" ".join(line.split()) for line in "".join(self.parts).splitlines()]
        compact: list[str] = []
        for line in lines:
            if line:
                compact.append(line)
            elif compact and compact[-1] != "":
                compact.append("")
        return "\n".join(compact).strip()


def _html_to_markdown(value: str) -> str:
    parser = _HtmlMarkdownFallback()
    try:
        parser.feed(value)
        parser.close()
    except (AssertionError, ValueError):
        return ""
    return parser.markdown()


class McpToolAdapter(Tool):
    """One discovered MCP tool with authoritative raw identity metadata."""

    def __init__(
        self,
        connection: McpConnection,
        tool_definition: Any,
        *,
        visible_name: str,
    ) -> None:
        server = connection.server
        self.connection = connection
        self.identity = McpToolIdentity(
            server_id=server.server_id,
            server_name=server.name,
            source=server.source,
            raw_name=str(tool_definition.name),
        )
        self._name = visible_name
        # Remote descriptions are untrusted and quality-uncontrolled — bound
        # length (they count against the prompt budget, keeping the historical
        # 8,000-character allowance) and replace degenerate/empty ones so the
        # model still has something to route on.
        self._description = sanitize_description(
            str(tool_definition.description or ""),
            name=visible_name,
            max_chars=_MCP_DESCRIPTION_MAX_CHARS,
        )
        if server.name == "genoffice" and self.identity.raw_name == "pdf_read":
            self._description += (
                " Use at most one of `page` or `range` (never both); when you need "
                "several pages, use `range` alone."
            )
        raw_schema = getattr(tool_definition, "inputSchema", None)
        self._parameters = normalize_schema_for_openai(raw_schema)
        self.annotations = McpToolAnnotations.from_sdk(
            getattr(tool_definition, "annotations", None)
        )
        self.approval_mode = server.definition.policy_for(self.identity.raw_name)

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return self._description

    @property
    def parameters(self) -> dict[str, Any]:
        return self._parameters

    @property
    def read_only(self) -> bool:
        # MCP annotations are hints, not grants. Unknown is deliberately
        # mutating so default/writes policies fail toward confirmation.
        return self.annotations.read_only

    @property
    def concurrency_safe(self) -> bool:
        return self.connection.server.definition.supports_parallel_tool_calls

    def presentation_detail(self, arguments: dict[str, Any]) -> str | None:
        # Arbitrary remote tools may accept credentials or signed URLs under
        # innocent-looking argument names. Inventory identifies the tool; raw
        # arguments remain in protected observability only.
        return ""

    async def execute(self, **kwargs: Any) -> ToolResult:
        started = time.monotonic()
        arguments = _normalize_tool_arguments(self.identity, kwargs)
        try:
            result = await self.connection.call_tool(self.identity.raw_name, arguments)
            text = _result_text(result)
            html = arguments.get("html")
            if (
                self.identity.server_name == "genoffice"
                and self.identity.raw_name == "create_docx"
                and isinstance(html, str)
                and "no content could be parsed from the html" in text.lower()
                and not arguments.get("markdown")
            ):
                markdown = _html_to_markdown(html)
                if markdown:
                    retry_kwargs = {key: value for key, value in arguments.items() if key != "html"}
                    retry_kwargs["markdown"] = markdown
                    result = await self.connection.call_tool(
                        self.identity.raw_name, retry_kwargs
                    )
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            _log_call(
                self.identity,
                arguments,
                started,
                status="error",
                error=f"{type(exc).__name__}: {exc}",
            )
            raise
        text = _result_text(result)
        is_error = bool(getattr(result, "isError", False))
        _log_call(
            self.identity,
            arguments,
            started,
            status="error" if is_error else "ok",
            result=None if is_error else text,
            error=text if is_error else None,
        )
        return ToolResult(
            text,
            is_error=is_error,
            metadata={
                "origin": "mcp",
                "serverId": self.identity.server_id,
                "serverName": self.identity.server_name,
                "toolName": self.identity.raw_name,
                "source": self.identity.source.value,
                "readOnly": self.annotations.read_only,
                "approvalMode": self.approval_mode.value,
            },
        )


def _normalize_tool_arguments(
    identity: McpToolIdentity, arguments: dict[str, Any]
) -> dict[str, Any]:
    """Remove absent PDF flags and resolve GenOffice's exclusive page/range pair."""

    normalized = dict(arguments)
    if identity.server_name == "genoffice" and identity.raw_name == "pdf_read":
        for key in ("page", "range"):
            if normalized.get(key) is None or normalized.get(key) == "":
                normalized.pop(key, None)
        # A page range is the more informative request when a model emits both.
        if normalized.get("page") is not None and normalized.get("range") is not None:
            normalized.pop("page", None)
    return normalized


def _result_text(result: Any) -> str:
    parts: list[str] = []
    for block in getattr(result, "content", ()):
        text = getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)
            continue
        if getattr(block, "type", None) in {"image", "audio"}:
            # Binary content is not model-readable as text; base64 would only
            # burn the context window. Servers that render (e.g. genoffice)
            # also write the files to disk and name them in a text block.
            data = getattr(block, "data", "")
            size = len(data) * 3 // 4 if isinstance(data, str) else 0
            parts.append(
                f"[{block.type} omitted: {getattr(block, 'mimeType', '?')}, "
                f"~{size} bytes]"
            )
            continue
        dump = getattr(block, "model_dump", None)
        value = dump(mode="json", by_alias=True) if callable(dump) else str(block)
        parts.append(
            json.dumps(value, ensure_ascii=False)
            if not isinstance(value, str)
            else value
        )
    structured = getattr(result, "structuredContent", None)
    if structured is not None and not parts:
        parts.append(json.dumps(structured, ensure_ascii=False, sort_keys=True))
    return "\n".join(part for part in parts if part) or "(no output)"


def _log_call(
    identity: McpToolIdentity,
    arguments: dict[str, Any],
    started: float,
    *,
    status: str,
    result: str | None = None,
    error: str | None = None,
) -> None:
    try:
        log_mcp_call(
            server=identity.server_id,
            tool=identity.raw_name,
            duration_ms=int((time.monotonic() - started) * 1_000),
            status=status,
            arguments=arguments,
            result=result,
            error=error,
        )
    except Exception as exc:  # noqa: BLE001 - telemetry never changes tool outcome
        logger.debug("Unable to record MCP call telemetry: {}", type(exc).__name__)


__all__ = ["McpToolAdapter"]
