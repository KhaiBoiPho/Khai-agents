"""Index-time enrichment: which optional model calls an indexing run makes.

Both features reuse the OpenRouter credential of the embedder the run was
started with (the user's OpenRouter connection, or ``OPENROUTER_API_KEY``):

* contextual retrieval (:mod:`core.rag.contextual`), on unless
  ``KHAI_RAG_CONTEXTUAL`` is false; model ``KHAI_RAG_CONTEXT_MODEL``;
* page vision for PDF figures and scans (:mod:`core.rag.visual`), on unless
  ``KHAI_RAG_VISION`` is false; model ``KHAI_RAG_VISION_MODEL``.

Both default to Luna 6 (``openai/gpt-6-luna``). Without a key, or when a
feature is switched off or cannot be set up, indexing behaves exactly as
before (logged once).
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from core.rag.contextual import CONTEXT_MODEL_ENV, CONTEXTUAL_ENV, Contextualizer
from core.rag.llm import (
    DEFAULT_ENRICHMENT_MODEL,
    EnrichmentError,
    OpenRouterChat,
    env_flag,
    env_float,
    log_once,
)
from core.rag.visual import (
    DEFAULT_TIMEOUT_S,
    TIMEOUT_ENV,
    VISION_ENV,
    VISION_MODEL_ENV,
    VisualReader,
)


@dataclass(slots=True)
class Enrichment:
    contextualizer: Contextualizer | None = None
    visual: VisualReader | None = None

    @property
    def active(self) -> bool:
        return self.contextualizer is not None or self.visual is not None


def configured_context_model() -> str:
    return (os.environ.get(CONTEXT_MODEL_ENV) or "").strip() or DEFAULT_ENRICHMENT_MODEL


def configured_vision_model() -> str:
    return (os.environ.get(VISION_MODEL_ENV) or "").strip() or DEFAULT_ENRICHMENT_MODEL


def default_enrichment(embedder: object) -> Enrichment | None:
    """Enrichment over the embedder's OpenRouter connection, if it has one."""

    api_key = getattr(embedder, "api_key", None)
    if not isinstance(api_key, str) or not api_key.strip():
        return None
    api_base = getattr(embedder, "api_base", None)
    enrichment = Enrichment()
    if env_flag(CONTEXTUAL_ENV):
        try:
            enrichment.contextualizer = Contextualizer(
                OpenRouterChat(api_key, configured_context_model(), api_base=api_base)
            )
        except EnrichmentError as exc:
            log_once("RAG contextual retrieval unavailable: {}", exc)
    if env_flag(VISION_ENV):
        try:
            enrichment.visual = VisualReader(
                OpenRouterChat(
                    api_key,
                    configured_vision_model(),
                    api_base=api_base,
                    timeout=env_float(TIMEOUT_ENV, DEFAULT_TIMEOUT_S, minimum=5.0),
                    max_retries=2,
                )
            )
        except EnrichmentError as exc:
            log_once("RAG page vision unavailable: {}", exc)
    return enrichment if enrichment.active else None


__all__ = [
    "Enrichment",
    "configured_context_model",
    "configured_vision_model",
    "default_enrichment",
]
