"""Turn a prompt's attached files into model-ready text, for every Turn mode.

* Files that fit (together, half the model's context window) go in whole.
* A file that does not fit goes in as a summary tree (see ``digest``): the
  summary of the whole file plus an outline that names where each part is,
  with the agent's document search and ``read`` for the detail. The tree is
  written by the model selected for the chat, once per file content.
* Writing a tree that is estimated to cost more than ``threshold_usd`` (or
  whose cost is unknown) asks the user first. Refused, the file goes in as its
  opening excerpt with the same pointers to search and ``read``.

Spreadsheets and binary files are not read here; their paths stay listed for
the agent's own tools.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

from loguru import logger

from core.attachments.content import (
    ATTACHED_HEADING,
    AttachedText,
    estimate_tokens,
    read_attached,
    split_attached,
)
from core.attachments.digest import (
    Digest,
    DigestBudget,
    DigestCache,
    DigestLLM,
    build_digest,
    document_chunks,
    estimate,
)
from core.events.protocol import (
    Event,
    ModelUsageRecorded,
    ToolCompleted,
    ToolStarted,
    summarize_result,
)

TOOL_NAME = "summarize_document"
INLINE_RATIO = 0.5
THRESHOLD_USD = 0.5
#: The overview of a summarized file: summary plus outline, in characters.
OVERVIEW_CHARS = 32_000
#: DeepThink's planner sees at most this much of each file.
BRIEF_FILE_CHARS = 6_000
#: Usage ordinals for summary calls, clear of the agent loop's own.
USAGE_ORDINAL_BASE = 1_000_000

Approve = Callable[[str, dict[str, Any], str | None], Awaitable[bool]]
Emit = Callable[[Any], None]


@dataclass(slots=True)
class PreparedFile:
    name: str
    path: Path
    tokens: int
    mode: str  # inline | summary | excerpt
    digest: Digest | None = None


@dataclass(slots=True)
class PreparedAttachments:
    """``full`` replaces the prompt for the agent loop; DeepThink plans from
    ``brief`` and answers with ``attachments``."""

    prompt: str
    full: str
    brief: str
    attachments: str = ""
    files: list[PreparedFile] = field(default_factory=list)

    @classmethod
    def unchanged(cls, prompt: str) -> PreparedAttachments:
        return cls(prompt=prompt, full=prompt, brief=prompt)

    @property
    def attachment_tokens(self) -> int:
        return estimate_tokens(self.attachments) if self.attachments else 0


def list_prices(model: str | None) -> tuple[float, float] | None:
    """USD per million (input, output) tokens, or None when unknown."""

    if not model:
        return None
    if model.endswith(":free"):
        return 0.0, 0.0
    try:
        from core.providers.catalog import resolve_model_info

        info = resolve_model_info(model)
    except Exception:  # noqa: BLE001 - pricing is best effort
        return None
    if info.source not in {"seed", "snapshot"}:
        return None
    if info.input_cost_per_1m is None or info.output_cost_per_1m is None:
        return None
    return float(info.input_cost_per_1m), float(info.output_cost_per_1m)


class ProviderDigestLLM:
    """The chat's own provider and model, reported as Turn usage."""

    def __init__(
        self,
        provider: Any,
        *,
        model: str,
        reasoning_effort: str | None,
        emit: Emit | None,
    ) -> None:
        self.provider = provider
        self.model = model
        # Summaries are plain writing: light effort when the model reasons.
        self.reasoning_effort = (
            "low" if reasoning_effort not in {None, "", "none", "off", "auto"} else None
        )
        self.emit = emit
        self._ordinal = USAGE_ORDINAL_BASE

    async def complete(self, messages: list[dict[str, Any]], *, max_tokens: int) -> str:
        response = await self.provider.chat_with_retry(
            messages=messages,
            tools=None,
            model=self.model,
            max_tokens=max_tokens,
            reasoning_effort=self.reasoning_effort,
        )
        usage = {
            str(key): value
            for key, value in (getattr(response, "usage", None) or {}).items()
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        }
        if usage and self.emit is not None:
            self._ordinal += 1
            self.emit(ModelUsageRecorded(response_ordinal=self._ordinal, usage=usage))
        if getattr(response, "finish_reason", "stop") == "error":
            raise RuntimeError(str(getattr(response, "content", "") or "provider error")[:300])
        return str(getattr(response, "content", None) or "")


def _relative(path: Path, workspace: Path | None) -> str:
    if workspace is not None and path.is_relative_to(workspace):
        return path.relative_to(workspace).as_posix()
    return str(path)


def _pointer(path: Path, workspace: Path | None) -> str:
    if workspace is not None and path.is_relative_to(workspace):
        return (
            f'call search_documents with paths=["{_relative(path, workspace)}"] '
            f"or read {path} around the part you need"
        )
    return f"read {path} around the part you need"


def _inline_block(document: AttachedText) -> str:
    return (
        f'<attached_file name="{document.name}" path="{document.path}" '
        f'tokens="{document.tokens}">\n{document.text}\n</attached_file>'
    )


def _summary_block(document: AttachedText, digest: Digest, workspace: Path | None) -> str:
    outline = digest.outline()
    room = max(200, (OVERVIEW_CHARS - len(digest.root)) // max(1, len(outline)))
    lines = []
    for node in outline:
        summary = " ".join(node.summary.split())
        if len(summary) > room:
            summary = summary[:room].rstrip() + " …"
        lines.append(f"- [{node.locator}] {summary}")
    partial = (
        "\nSome parts could not be summarized and are only excerpted below."
        if digest.partial
        else ""
    )
    return (
        f'<attached_file name="{document.name}" path="{document.path}" '
        f'tokens="{document.tokens}" mode="summary">\n'
        f"This file is too long to include whole (~{document.tokens:,} tokens). Below is "
        "a summary written from all of it, then an outline in document order; each "
        "entry names where that part is. For exact wording, figures or detail, "
        f"{_pointer(document.path, workspace)}.{partial}\n\n"
        f"## Summary\n{digest.root}\n\n## Outline\n" + "\n".join(lines) + "\n</attached_file>"
    )


def _excerpt_block(document: AttachedText, tokens: int, workspace: Path | None) -> str:
    text = document.text[: tokens * 4]
    return (
        f'<attached_file name="{document.name}" path="{document.path}" '
        f'tokens="{document.tokens}" mode="excerpt">\n'
        f"Only the opening of this file is included (~{tokens:,} of "
        f"{document.tokens:,} tokens). For the rest, {_pointer(document.path, workspace)}."
        f"\n\n{text}\n[... the file continues]\n</attached_file>"
    )


def _brief_block(document: AttachedText, digest: Digest | None) -> str:
    if digest is not None:
        outline = "\n".join(f"- {node.locator}" for node in digest.outline())
        body = f"Summary:\n{digest.root}\n\nOutline:\n{outline}"
    else:
        body = document.text[:BRIEF_FILE_CHARS]
        if len(document.text) > BRIEF_FILE_CHARS:
            body += "\n[... the answer step reads the whole file]"
    return f'<attached_file name="{document.name}" tokens="{document.tokens}">\n{body}\n</attached_file>'


def _join(question: str, blocks: list[str], leftover: list[str]) -> str:
    text = question.rstrip()
    if blocks:
        text += (
            "\n\nThe user attached these files; their text is below, so answer from it "
            "directly.\n\n" + "\n\n".join(blocks)
        )
    if leftover:
        text += ATTACHED_HEADING + "\n".join(f"- {path}" for path in leftover)
    return text


async def prepare_attachments(
    prompt: str,
    *,
    workspace: Path | None,
    context_window: int,
    max_output_tokens: int | None,
    llm: DigestLLM | None,
    approve: Approve | None,
    emit: Emit,
    cache: DigestCache,
    threshold_usd: float = THRESHOLD_USD,
) -> PreparedAttachments:
    question, paths = split_attached(prompt)
    if not paths:
        return PreparedAttachments.unchanged(prompt)
    documents: list[AttachedText] = []
    leftover: list[str] = []
    for raw in paths:
        document = await asyncio.to_thread(read_attached, raw, workspace)
        if document is None:
            leftover.append(raw)
        else:
            documents.append(document)
    if not documents:
        return PreparedAttachments.unchanged(prompt)

    # Smallest first: as many files as fit go in whole.
    room = int(context_window * INLINE_RATIO)
    inline: set[int] = set()
    used = 0
    for index in sorted(range(len(documents)), key=lambda i: documents[i].tokens):
        if used + documents[index].tokens <= room:
            inline.add(index)
            used += documents[index].tokens

    budget = DigestBudget.for_context(context_window, max_output_tokens)
    root_output = budget.root_output(max_output_tokens)
    prepared_files: list[PreparedFile] = []
    blocks: list[str] = []
    briefs: list[str] = []
    excerpt_room = max(2_000, (room - used) // max(1, len(documents) - len(inline)))
    for index, document in enumerate(documents):
        if index in inline:
            blocks.append(_inline_block(document))
            briefs.append(_brief_block(document, None))
            prepared_files.append(PreparedFile(document.name, document.path, document.tokens, "inline"))
            continue
        digest = await _digest_for(
            document,
            llm=llm,
            budget=budget,
            root_output=root_output,
            approve=approve,
            emit=emit,
            cache=cache,
            threshold_usd=threshold_usd,
        )
        if digest is not None:
            blocks.append(_summary_block(document, digest, workspace))
            briefs.append(_brief_block(document, digest))
            prepared_files.append(
                PreparedFile(document.name, document.path, document.tokens, "summary", digest)
            )
        else:
            blocks.append(_excerpt_block(document, excerpt_room, workspace))
            briefs.append(_brief_block(document, None))
            prepared_files.append(PreparedFile(document.name, document.path, document.tokens, "excerpt"))

    return PreparedAttachments(
        prompt=prompt,
        full=_join(question, blocks, leftover),
        brief=_join(question, briefs, leftover),
        attachments="\n\n".join(blocks),
        files=prepared_files,
    )


async def _digest_for(
    document: AttachedText,
    *,
    llm: DigestLLM | None,
    budget: DigestBudget,
    root_output: int,
    approve: Approve | None,
    emit: Emit,
    cache: DigestCache,
    threshold_usd: float,
) -> Digest | None:
    cached = await asyncio.to_thread(cache.get, document.sha256)
    if cached is not None:
        return cached
    if llm is None:
        return None
    chunks = await asyncio.to_thread(document_chunks, document)
    planned = estimate([estimate_tokens(c.text) for c in chunks], budget, root_output)
    cost = planned.cost_usd(list_prices(llm.model))
    arguments = {
        "file": document.name,
        "tokens": document.tokens,
        "calls": planned.calls,
        "model": llm.model,
        "estimatedUsd": round(cost, 2) if cost is not None else None,
    }
    if cost is None or cost > threshold_usd:
        price = f"about ${cost:.2f}" if cost is not None else "an unknown cost (no list price for this model)"
        reason = (
            f"“{document.name}” (~{document.tokens:,} tokens) is too long to read whole. "
            f"Summarizing it takes about {planned.calls} calls to {llm.model}, {price}. "
            "The summary is saved and reused for this file. Deny to use only its "
            "opening plus document search."
        )
        allowed = False
        if approve is not None:
            try:
                allowed = bool(await approve(TOOL_NAME, arguments, reason))
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - fail closed
                logger.exception("Summary approval failed for {}", document.name)
        if not allowed:
            return None

    call_id = f"digest-{uuid4().hex[:12]}"
    emit(
        ToolStarted(
            call_id=call_id,
            name=TOOL_NAME,
            detail=f"{document.name} · {planned.calls} calls",
        )
    )
    try:
        digest = await build_digest(
            document, llm, budget, root_output=root_output, chunks=chunks
        )
    except asyncio.CancelledError:
        emit(ToolCompleted(call_id=call_id, name=TOOL_NAME, is_error=True, result_preview="Stopped"))
        raise
    except Exception as exc:  # noqa: BLE001 - fall back to the excerpt
        logger.exception("Summarizing {} failed", document.name)
        emit(
            ToolCompleted(
                call_id=call_id,
                name=TOOL_NAME,
                is_error=True,
                result_preview=f"Could not summarize: {type(exc).__name__}",
            )
        )
        return None
    await asyncio.to_thread(cache.put, digest)
    emit(
        ToolCompleted(
            call_id=call_id,
            name=TOOL_NAME,
            is_error=False,
            result_preview=summarize_result(digest.root),
        )
    )
    return digest


async def stream_with_attachments(
    prepare: Callable[[Emit], Awaitable[PreparedAttachments]],
    run: Callable[[PreparedAttachments], AsyncIterator[Event]],
    *,
    prompt: str,
) -> AsyncIterator[Event]:
    """Run ``prepare`` (forwarding what it emits as events), then ``run``.

    A failed preparation never fails the Turn: it runs on the plain prompt."""

    queue: asyncio.Queue[Any] = asyncio.Queue()
    task = asyncio.create_task(prepare(queue.put_nowait))
    sequence = 0
    try:
        while True:
            getter = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({task, getter}, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                sequence += 1
                yield Event(id=f"attachments-{sequence}", msg=getter.result())
                continue
            getter.cancel()
            break
        while not queue.empty():
            sequence += 1
            yield Event(id=f"attachments-{sequence}", msg=queue.get_nowait())
        try:
            prepared = task.result()
        except Exception:  # noqa: BLE001
            logger.exception("Preparing the attached files failed")
            prepared = PreparedAttachments.unchanged(prompt)
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    async for event in run(prepared):
        yield event


__all__ = [
    "PreparedAttachments",
    "PreparedFile",
    "ProviderDigestLLM",
    "list_prices",
    "prepare_attachments",
    "stream_with_attachments",
]
