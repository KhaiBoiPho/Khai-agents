"""Retrieval over a workspace's documents (PDF, Office, CSV, Markdown, HTML).

Pipeline: :mod:`~core.rag.extract` (text + page/sheet/slide locators) →
:mod:`~core.rag.chunking` (~800-token overlapping chunks) →
:mod:`~core.rag.embeddings` (OpenRouter, OpenAI-compatible) →
:mod:`~core.rag.store` (per-workspace SQLite sidecar, cosine search), driven
incrementally by :mod:`~core.rag.index` and coordinated per process by
:mod:`~core.rag.service`.
"""

from core.rag.extract import SUPPORTED_EXTENSIONS, is_supported

__all__ = ["SUPPORTED_EXTENSIONS", "is_supported"]
