"""Contextual retrieval: situate each chunk in its document before indexing.

After Anthropic's "Contextual Retrieval" (claude-cookbooks,
``capabilities/contextual-embeddings``, MIT): a model writes a short context
for every chunk ("This section of ACME's Q2 2023 report covers ...") that is
prepended to the chunk for embedding and for the keyword side, so a chunk
that never names its subject can still be found. Search results show the
chunk's own text.

The cookbook asks once per chunk with the whole document. Here the cost is
bounded instead:

* up to :data:`DEFAULT_BATCH_SIZE` chunks of one document per request,
  answered as one JSON array;
* the document is sent truncated to a budget (its first ~6k tokens, sent
  first and identically for every batch so provider prefix caching applies),
  plus the text just before a batch that lies beyond that prefix; chunks that
  are inside the prefix are referenced by an excerpt instead of re-sent;
* low reasoning effort and a small ``max_tokens`` (:mod:`core.rag.llm`);
* answers cached by (model, prompt version, document prefix hash, chunk
  hash), so re-indexing unchanged chunks costs nothing;
* at most :data:`DEFAULT_MAX_CHUNKS` chunks per document get a context, the
  rest are indexed as they are;
* a failed batch is indexed without context; repeated failures or a rejected
  key turn contextualization off for the rest of the run.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor

from core.rag.chunking import CHARS_PER_TOKEN, Chunk
from core.rag.llm import (
    DEFAULT_CONCURRENCY,
    ChatClient,
    EnrichmentError,
    EnrichmentUnavailable,
    env_int,
    log_once,
)
from core.rag.store import read_cache, write_cache

CONTEXTUAL_ENV = "KHAI_RAG_CONTEXTUAL"
CONTEXT_MODEL_ENV = "KHAI_RAG_CONTEXT_MODEL"
MAX_CHUNKS_ENV = "KHAI_RAG_CONTEXT_MAX_CHUNKS"
BATCH_SIZE_ENV = "KHAI_RAG_CONTEXT_BATCH"
DOC_TOKENS_ENV = "KHAI_RAG_CONTEXT_DOC_TOKENS"

DEFAULT_BATCH_SIZE = 8
DEFAULT_MAX_CHUNKS = 200
DEFAULT_DOC_TOKENS = 6_000
# Text before a batch that lies past the document prefix.
NEIGHBOR_CHARS = 2_000
# A chunk past the prefix is sent at most this long: the gist is enough.
CHUNK_CHARS = 1_600
EXCERPT_HEAD = 160
EXCERPT_TAIL = 80
MAX_CONTEXT_CHARS = 400
TOKENS_PER_CONTEXT = 80
TOKENS_OVERHEAD = 300
# Consecutive failed batches after which the rest of the run goes without.
FAILURE_LIMIT = 3
PROMPT_VERSION = "ctx1"
CACHE_KIND = "context"

_INSTRUCTIONS = (
    "For each chunk, write a short succinct context (1-2 sentences, at most 50 "
    "words) that situates it within the overall document for the purposes of "
    "improving search retrieval of the chunk: name the document's subject and "
    "the section, entity, period or topic the chunk is about when the chunk "
    "does not say so itself. Write in the document's language. Answer only "
    'with a JSON array like [{"id": 1, "context": "..."}] and nothing else.'
)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class Contextualizer:
    def __init__(
        self,
        chat: ChatClient,
        *,
        batch_size: int | None = None,
        max_chunks: int | None = None,
        doc_tokens: int | None = None,
        concurrency: int = DEFAULT_CONCURRENCY,
    ) -> None:
        self.chat = chat
        self.batch_size = (
            env_int(BATCH_SIZE_ENV, DEFAULT_BATCH_SIZE, minimum=1)
            if batch_size is None
            else max(1, batch_size)
        )
        self.max_chunks = (
            env_int(MAX_CHUNKS_ENV, DEFAULT_MAX_CHUNKS) if max_chunks is None else max_chunks
        )
        self.doc_chars = CHARS_PER_TOKEN * (
            env_int(DOC_TOKENS_ENV, DEFAULT_DOC_TOKENS, minimum=256)
            if doc_tokens is None
            else doc_tokens
        )
        self.concurrency = max(1, concurrency)
        self.disabled = False
        self._failures = 0
        self._lock = threading.Lock()

    @property
    def model(self) -> str:
        return self.chat.model

    def contextualize(
        self,
        document: str,
        chunks: Sequence[Chunk],
        *,
        cache: object | None = None,
    ) -> list[str]:
        """One context per chunk (``""`` where none could be written)."""

        contexts = [""] * len(chunks)
        if self.disabled or not chunks or self.max_chunks <= 0:
            return contexts
        prefix = document[: self.doc_chars]
        truncated = len(document) > len(prefix)
        prefix_hash = _sha(prefix)
        limit = min(len(chunks), self.max_chunks)
        keys = [self._key(prefix_hash, chunk.text) for chunk in chunks[:limit]]
        cached = read_cache(cache, CACHE_KIND, keys)
        todo: list[int] = []
        for index, key in enumerate(keys):
            if key in cached:
                contexts[index] = cached[key]
            else:
                todo.append(index)
        if not todo:
            return contexts

        offsets = _offsets(document, chunks[:limit])
        # Consecutive uncached chunks, batch_size at a time.
        batches: list[list[int]] = []
        for index in todo:
            if batches and len(batches[-1]) < self.batch_size and batches[-1][-1] == index - 1:
                batches[-1].append(index)
            else:
                batches.append([index])

        head = (
            f"<document>\n{prefix}\n</document>"
            + (
                f"\n[The document continues; only its first ~{len(prefix) // CHARS_PER_TOKEN}"
                f" of ~{len(document) // CHARS_PER_TOKEN} tokens are shown.]"
                if truncated
                else ""
            )
        )

        def run(batch: list[int]) -> dict[int, str]:
            if self.disabled:
                return {}
            body = self._batch_prompt(batch, chunks, offsets, len(prefix))
            try:
                answer = self.chat.complete(
                    [{"type": "text", "text": head}, {"type": "text", "text": body}],
                    max_tokens=TOKENS_OVERHEAD + TOKENS_PER_CONTEXT * len(batch),
                )
                parsed = _parse(answer, len(batch))
            except EnrichmentUnavailable as exc:
                self.disabled = True
                log_once("RAG contextual retrieval disabled for this run: {}", exc)
                return {}
            except (EnrichmentError, ValueError) as exc:
                self._failed(str(exc) or type(exc).__name__)
                return {}
            except Exception as exc:  # noqa: BLE001 - never fail the document
                self._failed(type(exc).__name__)
                return {}
            with self._lock:
                self._failures = 0
            return {batch[number - 1]: text for number, text in parsed.items()}

        fresh: dict[str, str] = {}
        with ThreadPoolExecutor(
            max_workers=min(self.concurrency, len(batches)),
            thread_name_prefix="rag-context",
        ) as pool:
            for answers in pool.map(run, batches):
                for index, text in answers.items():
                    contexts[index] = text
                    fresh[keys[index]] = text
        write_cache(cache, CACHE_KIND, self.model, fresh)
        return contexts

    def _failed(self, reason: str) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= FAILURE_LIMIT and not self.disabled:
                self.disabled = True
                log_once(
                    "RAG contextual retrieval paused for this run after {} failed "
                    "requests (last: {})",
                    self._failures,
                    reason,
                )

    def _key(self, prefix_hash: str, text: str) -> str:
        return _sha(f"{PROMPT_VERSION}\0{self.model}\0{prefix_hash}\0{_sha(text)}")

    @staticmethod
    def _batch_prompt(
        batch: list[int],
        chunks: Sequence[Chunk],
        offsets: list[int],
        prefix_chars: int,
    ) -> str:
        parts: list[str] = []
        first = batch[0]
        if offsets[first] < 0 or offsets[first] >= prefix_chars:
            if first > 0:
                before = chunks[first - 1].text[-NEIGHBOR_CHARS:]
                parts.append(f"<preceding_text>\n{before}\n</preceding_text>")
        parts.append("Here are the chunks we want to situate within the whole document:")
        for number, index in enumerate(batch, start=1):
            chunk = chunks[index]
            where = f' location="{chunk.locator}"' if chunk.locator else ""
            inside = 0 <= offsets[index] and offsets[index] + len(chunk.text) <= prefix_chars
            if inside and len(chunk.text) > EXCERPT_HEAD + EXCERPT_TAIL + 40:
                # Already in the document above: point at it, do not resend it.
                parts.append(
                    f'<chunk id="{number}"{where} in_document="yes">\n'
                    f"starts: {chunk.text[:EXCERPT_HEAD]} …\n"
                    f"ends: … {chunk.text[-EXCERPT_TAIL:]}\n</chunk>"
                )
            else:
                text = chunk.text[:CHUNK_CHARS]
                parts.append(f'<chunk id="{number}"{where}>\n{text}\n</chunk>')
        parts.append(_INSTRUCTIONS)
        return "\n\n".join(parts)


def _offsets(document: str, chunks: Sequence[Chunk]) -> list[int]:
    """Approximate start of each chunk in ``document`` (-1 when not found)."""

    offsets: list[int] = []
    cursor = 0
    for chunk in chunks:
        probe = chunk.text[:80]
        found = document.find(probe, max(0, cursor - 4_000)) if probe else -1
        offsets.append(found)
        if found >= 0:
            cursor = found + 1
    return offsets


_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


def _parse(answer: str, count: int) -> dict[int, str]:
    """``{chunk number: context}`` from the model's JSON array."""

    text = _FENCE.sub("", answer.strip())
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("no JSON array in the answer")
    rows = json.loads(text[start : end + 1])
    if not isinstance(rows, list):
        raise ValueError("answer is not a JSON array")
    contexts: dict[int, str] = {}
    for position, row in enumerate(rows, start=1):
        if isinstance(row, dict):
            number, context = row.get("id", position), row.get("context")
        elif isinstance(row, str):
            number, context = position, row
        else:
            continue
        try:
            number = int(number)
        except (TypeError, ValueError):
            continue
        if not isinstance(context, str) or not 1 <= number <= count:
            continue
        context = " ".join(context.split())[:MAX_CONTEXT_CHARS]
        if context:
            contexts[number] = context
    if not contexts:
        raise ValueError("answer has no usable contexts")
    return contexts


__all__ = [
    "CONTEXTUAL_ENV",
    "CONTEXT_MODEL_ENV",
    "DEFAULT_BATCH_SIZE",
    "DEFAULT_MAX_CHUNKS",
    "Contextualizer",
]
