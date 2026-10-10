"""Web search for DeepThink through the Session's existing tools.

DeepThink adds no search client of its own. It reuses the tools the Session
already has: a connected search MCP server (Firecrawl first) for search and
scrape, and the built-in ``web_fetch`` tool for reading a page when no
scrape tool exists. Every call goes through the Session's permission checker
and approval callback, exactly like a model-issued tool call.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from loguru import logger

PermissionChecker = Callable[[str, dict[str, Any]], Any]
ApprovalCallback = Callable[[str, dict[str, Any], str | None], Any]

#: MCP servers whose ``*search`` tool is a general web search.
_SEARCH_SERVER_HINTS = (
    "firecrawl",
    "tavily",
    "brave",
    "exa",
    "serper",
    "searxng",
    "duckduckgo",
    "kagi",
    "perplexity",
)


@dataclass(frozen=True, slots=True)
class SearchHit:
    url: str
    title: str
    snippet: str


class SearchUnavailable(RuntimeError):
    """No usable search tool, or the user/policy refused it."""


class SearchBackend(Protocol):
    name: str

    async def search(self, query: str, limit: int) -> list[SearchHit]: ...

    async def fetch(self, url: str, max_chars: int) -> str | None: ...


class ToolGate:
    """Apply the Session's permission policy to DeepThink's own tool calls.

    ``allow`` runs, ``deny`` refuses, ``ask`` goes to the approval callback
    (one prompt at a time, so parallel searches never stack approval cards).
    """

    def __init__(
        self,
        permission_checker: PermissionChecker | None,
        approval_callback: ApprovalCallback | None,
    ) -> None:
        self.permission_checker = permission_checker
        self.approval_callback = approval_callback
        self._ask_lock = asyncio.Lock()
        self._refused: set[str] = set()

    async def allows(self, tool_name: str, arguments: dict[str, Any]) -> bool:
        if tool_name in self._refused:
            return False
        if self.permission_checker is None:
            return True
        try:
            outcome = self.permission_checker(tool_name, arguments)
            if inspect.isawaitable(outcome):
                outcome = await outcome
            decision, reason = outcome
        except Exception:  # noqa: BLE001 - fail closed like the runner
            logger.exception("DeepThink permission check failed for {}", tool_name)
            return False
        value = str(getattr(decision, "value", decision))
        if value == "allow":
            return True
        if value == "deny" or self.approval_callback is None:
            self._refused.add(tool_name)
            return False
        async with self._ask_lock:
            if tool_name in self._refused:
                return False
            try:
                approved = self.approval_callback(tool_name, arguments, reason)
                if inspect.isawaitable(approved):
                    approved = await approved
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - fail closed
                logger.exception("DeepThink approval failed for {}", tool_name)
                approved = False
        if not approved:
            # One refusal covers the run: do not ask again for every query.
            self._refused.add(tool_name)
        return bool(approved)


class ToolRegistrySearchBackend:
    """Search/scrape via named tools in a Session ToolRegistry."""

    def __init__(
        self,
        registry: Any,
        *,
        search_tool: str,
        fetch_tool: str | None,
        gate: ToolGate,
        timeout_s: float,
    ) -> None:
        self.registry = registry
        self.search_tool = search_tool
        self.fetch_tool = fetch_tool
        self.gate = gate
        self.timeout_s = timeout_s
        self.name = search_tool

    async def _call(self, tool_name: str, arguments: dict[str, Any]) -> str:
        if not await self.gate.allows(tool_name, arguments):
            raise SearchUnavailable(f"{tool_name} was not permitted")
        result = await asyncio.wait_for(
            self.registry.execute(tool_name, arguments), timeout=self.timeout_s
        )
        text = str(result or "")
        if getattr(result, "is_error", False) or text.startswith("Error"):
            raise RuntimeError(text[:200] or f"{tool_name} failed")
        return text

    async def search(self, query: str, limit: int) -> list[SearchHit]:
        text = await self._call(self.search_tool, {"query": query, "limit": limit})
        return parse_search_results(text, limit)

    async def fetch(self, url: str, max_chars: int) -> str | None:
        if self.fetch_tool is None:
            return None
        if self.fetch_tool == "web_fetch":
            arguments: dict[str, Any] = {"url": url}
        else:
            arguments = {"url": url, "formats": ["markdown"], "onlyMainContent": True}
        text = await self._call(self.fetch_tool, arguments)
        return clean_page_text(text, max_chars)


def _tool_server_and_name(tool_name: str) -> tuple[str, str] | None:
    if not tool_name.startswith("mcp__"):
        return None
    parts = tool_name.split("__")
    if len(parts) < 3:
        return None
    return parts[1].lower(), "__".join(parts[2:]).lower()


def select_search_tools(tool_names: list[str] | tuple[str, ...]) -> tuple[str | None, str | None]:
    """Pick (search tool, page tool) by name; Firecrawl is preferred."""

    search: str | None = None
    fetch: str | None = None
    ranked: list[tuple[int, str, str, str]] = []
    for name in tool_names:
        split = _tool_server_and_name(name)
        if split is None:
            continue
        server, raw = split
        rank = next(
            (index for index, hint in enumerate(_SEARCH_SERVER_HINTS) if hint in server),
            None,
        )
        if rank is None:
            continue
        ranked.append((rank, server, raw, name))
    ranked.sort()
    for _rank, server, raw, name in ranked:
        if search is None and raw.endswith("search"):
            if {"map", "crawl", "extract", "code"} & set(re.split(r"[_\-]", raw)):
                continue
            search = name
            search_server = server
            fetch = next(
                (
                    candidate
                    for _r, other_server, other_raw, candidate in ranked
                    if other_server == search_server and other_raw.endswith("scrape")
                ),
                None,
            )
    if search is not None and fetch is None and "web_fetch" in tool_names:
        fetch = "web_fetch"
    return search, fetch


async def discover_search_backend(
    *,
    registry: Any,
    mcp_runtime: Any,
    gate: ToolGate,
    tool_timeout_s: float,
    discovery_timeout_s: float,
) -> ToolRegistrySearchBackend | None:
    """Start the Session's MCP servers (bounded) and find a search tool."""

    if registry is None:
        return None
    if mcp_runtime is not None:
        try:
            await asyncio.wait_for(mcp_runtime.ensure_started(), discovery_timeout_s)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - search is optional
            logger.warning("DeepThink MCP startup failed: {}", exc)
        names = list(getattr(registry, "tool_names", ()) or ())
        search, _fetch = select_search_tools(names)
        if search is None:
            # A search server may be configured with deferred loading.
            for server in getattr(getattr(mcp_runtime, "plan", None), "servers", ()) or ():
                server_id = str(getattr(server, "server_id", ""))
                if any(hint in server_id.lower() for hint in _SEARCH_SERVER_HINTS):
                    try:
                        await asyncio.wait_for(
                            mcp_runtime.activate_server(server_id),
                            discovery_timeout_s,
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            "DeepThink could not activate {}: {}", server_id, exc
                        )
                    break
    names = list(getattr(registry, "tool_names", ()) or ())
    search, fetch = select_search_tools(names)
    if search is None:
        return None
    return ToolRegistrySearchBackend(
        registry,
        search_tool=search,
        fetch_tool=fetch,
        gate=gate,
        timeout_s=tool_timeout_s,
    )


# -- result parsing -----------------------------------------------------------

_URL_KEYS = ("url", "link", "href", "sourceURL", "source_url")
_TITLE_KEYS = ("title", "name", "heading")
_SNIPPET_KEYS = ("description", "snippet", "summary", "content", "text", "markdown")
_MD_LINK = re.compile(r"\[([^\]\n]{1,200})\]\((https?://[^)\s]+)\)")
_BARE_URL = re.compile(r"https?://[^\s<>()\"'\]]+")
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_WS = re.compile(r"[ \t\f\v]+")
_BLANKS = re.compile(r"\n{3,}")


def _load_json(text: str) -> Any:
    stripped = text.strip()
    try:
        return json.loads(stripped)
    except (TypeError, ValueError):
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start, end = stripped.find(opener), stripped.rfind(closer)
        if 0 <= start < end:
            try:
                return json.loads(stripped[start : end + 1])
            except (TypeError, ValueError):
                continue
    return None


def _first_str(mapping: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    metadata = mapping.get("metadata")
    if isinstance(metadata, dict):
        for key in keys:
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _walk(value: Any, out: list[SearchHit], seen: set[str], limit: int) -> None:
    if len(out) >= limit:
        return
    if isinstance(value, dict):
        url = _first_str(value, _URL_KEYS)
        if url.startswith(("http://", "https://")) and url not in seen:
            seen.add(url)
            out.append(
                SearchHit(
                    url=url,
                    title=_first_str(value, _TITLE_KEYS) or url,
                    snippet=_first_str(value, _SNIPPET_KEYS),
                )
            )
            return
        for child in value.values():
            _walk(child, out, seen, limit)
    elif isinstance(value, list):
        for child in value:
            _walk(child, out, seen, limit)


def parse_search_results(text: str, limit: int) -> list[SearchHit]:
    """Extract up to ``limit`` hits from JSON or Markdown search output."""

    hits: list[SearchHit] = []
    seen: set[str] = set()
    data = _load_json(text)
    if data is not None:
        _walk(data, hits, seen, limit)
        if hits:
            return hits[:limit]
    for match in _MD_LINK.finditer(text):
        title, url = match.group(1).strip(), match.group(2).rstrip(".,;")
        if url in seen:
            continue
        seen.add(url)
        line_end = text.find("\n", match.end())
        snippet = text[match.end() : line_end if line_end > 0 else None].strip(" -:|")
        hits.append(SearchHit(url=url, title=title, snippet=snippet[:400]))
        if len(hits) >= limit:
            return hits
    for match in _BARE_URL.finditer(text):
        url = match.group(0).rstrip(".,;")
        if url in seen:
            continue
        seen.add(url)
        hits.append(SearchHit(url=url, title=url, snippet=""))
        if len(hits) >= limit:
            break
    return hits


def clean_page_text(text: str, max_chars: int) -> str:
    """Readable page text trimmed to ``max_chars`` (JSON scrape output aware)."""

    data = _load_json(text) if text.lstrip().startswith(("{", "[")) else None
    if isinstance(data, dict):
        for key in ("markdown", "content", "text"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                text = value
                break
            nested = data.get("data")
            if isinstance(nested, dict) and isinstance(nested.get(key), str):
                text = nested[key]
                break
    text = _MD_IMAGE.sub("", text)
    text = _WS.sub(" ", text)
    text = _BLANKS.sub("\n\n", text).strip()
    return trim(text, max_chars)


def trim(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    space = cut.rfind(" ")
    if space > max_chars * 0.8:
        cut = cut[:space]
    return cut.rstrip() + " …"


__all__ = [
    "SearchBackend",
    "SearchHit",
    "SearchUnavailable",
    "ToolGate",
    "ToolRegistrySearchBackend",
    "clean_page_text",
    "discover_search_backend",
    "parse_search_results",
    "select_search_tools",
    "trim",
]
