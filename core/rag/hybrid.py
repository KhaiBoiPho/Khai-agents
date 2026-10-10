"""Hybrid (keyword + vector) re-ranking, after RAGFlow's retrieval.

RAGFlow (Apache-2.0, ``internal/service/nlp/retrieval.go`` and
``reranker.go``) gathers candidates from a full-text match and a kNN search,
then scores each one as

    sim = 0.7 * token_similarity + 0.3 * cosine

where token similarity is the weighted share of the query's terms that the
chunk contains (title terms counted with the body), and drops candidates
below a 0.2 threshold. The same formula is used here for both stores; term
weights are an IDF over the candidate set, standing in for RAGFlow's corpus
term-weight dictionary.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

TOKEN_WEIGHT = 0.7
VECTOR_WEIGHT = 0.3
SIMILARITY_THRESHOLD = 0.2
CANDIDATES = 64
# A candidate this close in embedding space is kept even when it shares no
# words with the query (another language, paraphrase), which a strict
# keyword-weighted threshold would otherwise throw away.
SEMANTIC_KEEP = 0.55

_WORD = re.compile(r"\w+", re.UNICODE)
_CJK = re.compile(r"[぀-ヿ㐀-䶿一-鿿가-힯]")
_STOPWORDS = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the "
    "this to was were what when where which who why with how do does did can "
    "là và của có cho các những một được trong không với này đó thì như".split()
)


def tokenize(text: str) -> list[str]:
    """Lower-cased words; CJK runs split into characters; stopwords dropped."""
    tokens: list[str] = []
    for word in _WORD.findall(text.lower()):
        if _CJK.search(word):
            tokens.extend(char for char in word if not char.isspace())
        elif word not in _STOPWORDS and (len(word) > 1 or word.isdigit()):
            tokens.append(word)
    return tokens


@dataclass(slots=True)
class Candidate:
    key: object
    path: str
    ordinal: int
    locator: str
    heading: str
    text: str
    cosine: float
    score: float = 0.0
    # Contextual-retrieval context: matched like the text, never displayed.
    context: str = ""
    visual: bool = False


def _document_terms(candidate: Candidate) -> set[str]:
    stem = candidate.path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return (
        set(tokenize(candidate.text))
        | set(tokenize(candidate.heading))
        | set(tokenize(candidate.context))
        | set(tokenize(stem.replace("_", " ").replace("-", " ")))
    )


def rerank(
    query: str | None, candidates: Iterable[Candidate], k: int
) -> list[Candidate]:
    candidates = list(candidates)
    if not candidates:
        return []
    terms = list(dict.fromkeys(tokenize(query or "")))
    if not terms:
        for candidate in candidates:
            candidate.score = candidate.cosine
        return sorted(candidates, key=lambda c: c.score, reverse=True)[: max(1, k)]

    documents = [_document_terms(candidate) for candidate in candidates]
    total = len(documents)
    weights = {}
    for term in terms:
        frequency = sum(1 for document in documents if term in document)
        weights[term] = math.log(1 + (total - frequency + 0.5) / (frequency + 0.5))
    weight_sum = sum(weights.values()) or 1.0

    kept = []
    for candidate, document in zip(candidates, documents, strict=True):
        token_sim = sum(weights[term] for term in terms if term in document) / weight_sum
        candidate.score = TOKEN_WEIGHT * token_sim + VECTOR_WEIGHT * candidate.cosine
        if candidate.score >= SIMILARITY_THRESHOLD or candidate.cosine >= SEMANTIC_KEEP:
            kept.append(candidate)
    if not kept:
        # Nothing clears the bar: still answer with the closest chunks (their
        # low scores say how weak they are) rather than nothing at all.
        kept = candidates
    kept.sort(key=lambda c: c.score, reverse=True)
    return kept[: max(1, k)]


def keyword_overlap(query_terms: Sequence[str], text_terms: set[str]) -> int:
    return sum(1 for term in query_terms if term in text_terms)


__all__ = [
    "CANDIDATES",
    "SIMILARITY_THRESHOLD",
    "TOKEN_WEIGHT",
    "VECTOR_WEIGHT",
    "Candidate",
    "keyword_overlap",
    "rerank",
    "tokenize",
]
