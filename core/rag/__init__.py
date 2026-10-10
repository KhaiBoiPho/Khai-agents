"""Retrieval over a workspace's documents (PDF, Office, CSV, Markdown, HTML).

Pipeline: :mod:`~core.rag.extract` (text + page/sheet/slide locators) →
:mod:`~core.rag.chunking` (~800-token overlapping chunks) →
:mod:`~core.rag.embeddings` (OpenRouter, OpenAI-compatible) →
:mod:`~core.rag.pgstore` (Postgres + Qdrant, hybrid search), driven
incrementally by :mod:`~core.rag.index` and coordinated per process by
:mod:`~core.rag.service`. Optional index-time enrichment
(:mod:`~core.rag.enrich`) adds contextual-retrieval chunk contexts
(:mod:`~core.rag.contextual`) and vision transcriptions of PDF figure and
scanned pages (:mod:`~core.rag.visual`).
"""

from core.rag.extract import SUPPORTED_EXTENSIONS, is_supported

__all__ = ["SUPPORTED_EXTENSIONS", "is_supported"]
