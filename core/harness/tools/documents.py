"""``search_documents``: semantic search over the workspace's documents."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from core.agent_runtime.tools.base import Tool, ToolResult, tool_parameters
from core.rag.embeddings import EmbeddingError, EmbeddingNotConfigured
from core.rag.service import (
    EmbedderFactory,
    RagService,
    get_rag_service,
    uploaded_documents,
)

MAX_RESULTS = 20
DEFAULT_RESULTS = 6
# How long one search may wait for pending documents to be indexed. The rest
# keeps indexing in the background and the result says so.
INDEX_WAIT_S = 20.0
_EXCERPT_CHARS = 1_600

DOCUMENT_SEARCH_PREAMBLE = (
    "## Workspace documents\n"
    "Documents in the workspace (PDF, Word, Excel/CSV, PowerPoint, Markdown, "
    "text and HTML files, including files the user uploaded) are indexed for "
    "semantic search. For questions about their content, call "
    "`search_documents` first, then `read` a cited file when you need more "
    "context. Base answers on the returned passages and cite each source as "
    "(file, page/sheet/slide), e.g. (reports/q3.pdf, page 4). If search is "
    "unavailable or finds nothing relevant, read the files directly."
)


#: In a code project document search covers only the user's uploads.
UPLOADS_SEARCH_PREAMBLE = (
    "## Uploaded documents\n"
    "Documents the user uploaded to this project (files named "
    "`deepcode-upload-*`) are indexed for semantic search. For questions about "
    "their content, call `search_documents` and cite each source as (file, "
    "page/sheet/slide). The project's code and its own docs are not indexed: "
    "read them with the file tools."
)


def format_locator(path: str, locator: str) -> str:
    return f"{path} · {locator}" if locator else path


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "minLength": 1,
                "description": "What to look for, phrased as a question or key terms.",
            },
            "k": {
                "type": "integer",
                "minimum": 1,
                "maximum": MAX_RESULTS,
                "description": f"Number of passages to return (default {DEFAULT_RESULTS}).",
            },
            "paths": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Optional workspace-relative files or folders to restrict "
                    "the search to."
                ),
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    }
)
class SearchDocumentsTool(Tool):
    """Return the passages of workspace documents most relevant to a query."""

    def __init__(
        self,
        workspace: str | Path,
        embedder_factory: EmbedderFactory,
        *,
        service: RagService | None = None,
        index_wait_s: float = INDEX_WAIT_S,
        uploads_only: bool = False,
    ) -> None:
        self._workspace = Path(workspace)
        # A code project: search (and index) only the user's uploaded files.
        self._uploads_only = uploads_only
        self._factory = embedder_factory
        self._service = service
        self._wait = index_wait_s

    @property
    def name(self) -> str:
        return "search_documents"

    @property
    def description(self) -> str:
        if self._uploads_only:
            return (
                "Semantic search over documents the user uploaded to this project "
                "(PDF, Word, Excel/CSV, PowerPoint, Markdown, text, HTML). Returns "
                "the most relevant passages with file path and page/sheet/slide "
                "locator. Not for code: read source files with the file tools."
            )
        return (
            "Semantic search over the workspace's documents (PDF, Word, Excel/CSV, "
            "PowerPoint, Markdown, text, HTML, including uploads). Returns the most "
            "relevant passages with file path, page/sheet/slide locator and a "
            "relevance score. Use it for questions about document content and cite "
            "the returned locators."
        )

    @property
    def read_only(self) -> bool:
        return True

    def presentation_detail(self, arguments: dict[str, Any]) -> str | None:
        query = arguments.get("query")
        return query.strip()[:160] if isinstance(query, str) else ""

    async def execute(self, **kwargs: Any) -> ToolResult:
        query = kwargs.get("query")
        if not isinstance(query, str) or not query.strip():
            return ToolResult("Error: query must be a non-empty string", is_error=True)
        k = kwargs.get("k", DEFAULT_RESULTS)
        if isinstance(k, bool) or not isinstance(k, int):
            k = DEFAULT_RESULTS
        k = max(1, min(MAX_RESULTS, k))
        raw_paths = kwargs.get("paths")
        paths = (
            [p for p in raw_paths if isinstance(p, str) and p.strip()]
            if isinstance(raw_paths, list)
            else None
        )
        if paths and any(
            Path(p).is_absolute() or ".." in Path(p).parts for p in paths
        ):
            return ToolResult(
                "Error: paths must be workspace-relative", is_error=True
            )
        only: set[str] | None = None
        if self._uploads_only:
            only = await asyncio.to_thread(uploaded_documents, self._workspace)
            if not only:
                return ToolResult(
                    "No uploaded documents in this project. Document search covers "
                    "only uploads here; read project files with the file tools.",
                    metadata={"resultCount": 0},
                )
        service = self._service or get_rag_service()
        try:
            outcome = await asyncio.to_thread(
                service.search,
                self._workspace,
                self._factory,
                query.strip(),
                k=k,
                paths=paths or None,
                only=only,
                wait_s=self._wait,
            )
        except EmbeddingNotConfigured as exc:
            return ToolResult(
                f"Document search is unavailable: {exc} Read the files directly instead.",
                is_error=True,
                metadata={"resultCount": 0},
            )
        except EmbeddingError as exc:
            return ToolResult(
                f"Document search failed: {exc} Read the files directly instead.",
                is_error=True,
                metadata={"resultCount": 0},
            )
        return render_search_result(query.strip(), outcome)


def render_search_result(query: str, outcome) -> ToolResult:  # noqa: ANN001
    hits = outcome.hits
    noun = "result" if len(hits) == 1 else "results"
    lines = [f'Found {len(hits)} {noun} for "{query}".']
    coverage = f"{outcome.indexed} document{'s' if outcome.indexed != 1 else ''} indexed"
    if outcome.pending:
        coverage += f", {outcome.pending} still indexing"
    if outcome.failed:
        coverage += f", {outcome.failed} could not be read"
    lines.append(f"Index: {coverage}.")
    if outcome.error and outcome.pending:
        lines.append(f"Indexing problem: {outcome.error}")
    if not hits:
        lines.append(
            "No indexed passages matched. Read the files directly if the answer "
            "should be in a document."
        )
    for rank, hit in enumerate(hits, start=1):
        text = hit.text.strip()
        if len(text) > _EXCERPT_CHARS:
            text = text[:_EXCERPT_CHARS].rstrip() + " …"
        header = f"[{rank}] {format_locator(hit.path, hit.locator)} · score {hit.score:.3f}"
        visual = bool(getattr(hit, "visual", False))
        if visual:
            # Read from the page image by a vision model: say so, so the agent
            # can render that page itself when exact visual detail matters.
            header += " · visual (transcribed from the page image)"
        elif hit.heading and hit.heading not in hit.locator:
            header += f"\nSection: {hit.heading}"
        lines.extend(["", header, text])
    if hits:
        lines.extend(
            ["", "Cite sources as (file, locator), e.g. (" + format_locator(hits[0].path, hits[0].locator).replace(" · ", ", ") + ")."]
        )
    return ToolResult(
        "\n".join(lines),
        metadata={
            "resultCount": len(hits),
            "sources": [
                {
                    "path": hit.path,
                    "locator": hit.locator,
                    "score": hit.score,
                    **({"visual": True} if getattr(hit, "visual", False) else {}),
                }
                for hit in hits
            ],
        },
    )


__all__ = [
    "DOCUMENT_SEARCH_PREAMBLE",
    "UPLOADS_SEARCH_PREAMBLE",
    "SearchDocumentsTool",
    "render_search_result",
]
