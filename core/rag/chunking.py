"""Split extracted sections into overlapping, embedding-sized chunks.

Sizes are counted in estimated tokens (≈4 characters per token, the usual
English average for BPE vocabularies) so no tokenizer dependency is needed.
A chunk never spans two sections: the page/sheet/slide locator of every
chunk stays exact. Within a section, paragraphs are packed greedily up to the
target and the next chunk starts with the tail of the previous one so a fact
straddling the boundary is still retrievable from either side.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from core.rag.extract import Section

CHARS_PER_TOKEN = 4
DEFAULT_CHUNK_TOKENS = 800
DEFAULT_OVERLAP_TOKENS = 100


@dataclass(frozen=True, slots=True)
class Chunk:
    ordinal: int
    text: str
    locator: str = ""
    heading: str = ""
    # Contextual retrieval: a short text situating the chunk in its document.
    # Embedded and keyword-searched with the chunk, never shown as its text.
    context: str = ""
    # Transcribed from a PDF page image by the vision model.
    visual: bool = False


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN)


_SENTENCE_END = re.compile(r"(?<=[.!?。！？])\s+")


def _pieces(text: str, limit: int) -> list[str]:
    """Paragraphs no longer than ``limit`` characters.

    An oversized paragraph is split at sentence ends, then at line breaks,
    then at whitespace, and only as a last resort mid-word.
    """

    pieces: list[str] = []
    for paragraph in re.split(r"\n\s*\n", text):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) <= limit:
            pieces.append(paragraph)
            continue
        units = [unit for unit in _SENTENCE_END.split(paragraph) if unit]
        if len(units) == 1:
            units = paragraph.split("\n")
        current = ""
        for unit in units:
            while len(unit) > limit:
                cut = unit.rfind(" ", 0, limit)
                cut = cut if cut > limit // 2 else limit
                head, unit = unit[:cut].strip(), unit[cut:].strip()
                if current:
                    pieces.append(current)
                    current = ""
                pieces.append(head)
            joined = f"{current} {unit}".strip() if current else unit
            if len(joined) > limit and current:
                pieces.append(current)
                current = unit
            else:
                current = joined
        if current:
            pieces.append(current)
    return pieces


def _overlap_tail(text: str, size: int) -> str:
    if size <= 0 or len(text) <= size:
        return ""
    tail = text[-size:]
    space = tail.find(" ")
    return tail[space + 1 :] if 0 <= space < len(tail) // 2 else tail


def chunk_sections(
    sections: Iterable[Section],
    *,
    chunk_tokens: int = DEFAULT_CHUNK_TOKENS,
    overlap_tokens: int = DEFAULT_OVERLAP_TOKENS,
) -> list[Chunk]:
    if chunk_tokens < 16:
        raise ValueError("chunk_tokens must be at least 16")
    overlap_tokens = max(0, min(overlap_tokens, chunk_tokens // 2))
    limit = chunk_tokens * CHARS_PER_TOKEN
    overlap = overlap_tokens * CHARS_PER_TOKEN
    chunks: list[Chunk] = []

    for section in sections:
        current = ""
        emitted_here = False

        def emit(text: str) -> None:
            nonlocal emitted_here
            chunks.append(
                Chunk(
                    len(chunks),
                    text.strip(),
                    section.locator,
                    section.heading,
                    visual=section.visual,
                )
            )
            emitted_here = True

        for piece in _pieces(section.text, limit - overlap if overlap else limit):
            candidate = f"{current}\n\n{piece}" if current else piece
            if len(candidate) <= limit:
                current = candidate
                continue
            emit(current)
            tail = _overlap_tail(current, overlap)
            current = f"{tail}\n\n{piece}" if tail else piece
        if current.strip() and (not emitted_here or current.strip() != chunks[-1].text):
            emit(current)
    return chunks


__all__ = [
    "CHARS_PER_TOKEN",
    "DEFAULT_CHUNK_TOKENS",
    "DEFAULT_OVERLAP_TOKENS",
    "Chunk",
    "chunk_sections",
    "estimate_tokens",
]
