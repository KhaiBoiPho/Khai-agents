"""Process-wide document-search service: background indexing + search.

One :class:`RagService` per user owns that user's index stores and at most
one indexing job per workspace root. Everything that touches an index (the
``rag/*`` RPCs, the upload hook and the agent's ``search_documents`` tool)
goes through it, so concurrent triggers coalesce into the running job
instead of embedding the same files twice.

Indexing never blocks its caller: :meth:`RagService.start` launches a daemon
thread and returns. A caller that wants fresh results (the agent tool) waits
for the job with a bounded timeout and searches whatever is indexed by then.
"""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from core.rag.embeddings import (
    Embedder,
    EmbeddingError,
    EmbeddingNotConfigured,
    OpenRouterEmbedder,
    OPENROUTER_KEY_ENV,
    configured_embedding_model,
    not_configured_message,
)
from core.rag.index import (
    STATUS_FAILED,
    STATUS_INDEXED,
    STATUS_PENDING,
    DocumentIndex,
    IndexReport,
)
from core.persistence.database import Database
from core.rag.store import DocumentStore, SearchHit, workspace_key
from loguru import logger

EmbedderFactory = Callable[[], Embedder]
RAG_API_BASE_ENV = "KHAI_RAG_API_BASE"
# After a failed run (service down, bad key) lazy triggers wait this long
# before trying again, so every search does not re-pay the retry budget.
ERROR_COOLDOWN_S = 60.0


@dataclass(slots=True)
class _Job:
    thread: threading.Thread | None = None
    done: int = 0
    total: int = 0
    current: str | None = None
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    error: str | None = None
    report: IndexReport | None = None
    stop: threading.Event = field(default_factory=threading.Event)

    @property
    def running(self) -> bool:
        return self.thread is not None and self.thread.is_alive()


@dataclass(frozen=True, slots=True)
class SearchOutcome:
    hits: list[SearchHit]
    indexed: int
    pending: int
    failed: int
    indexing: bool
    error: str | None = None


def qdrant_url() -> str:
    return os.environ.get("KHAI_QDRANT_URL", "").strip() or "http://127.0.0.1:6353"


def qdrant_api_key() -> str | None:
    return os.environ.get("KHAI_QDRANT_API_KEY", "").strip() or None


StoreFactory = Callable[[str], DocumentStore]


class RagService:
    def __init__(
        self,
        *,
        database: Database | None = None,
        store_factory: StoreFactory | None = None,
    ) -> None:
        self._database = database
        self._store_factory = store_factory
        self._lock = threading.RLock()
        self._indexes: dict[str, DocumentIndex] = {}
        self._jobs: dict[str, _Job] = {}

    # -- plumbing ---------------------------------------------------------

    @staticmethod
    def _key(root: str | Path) -> str:
        return str(Path(root).expanduser().resolve())

    def index_for(self, root: str | Path) -> DocumentIndex:
        key = self._key(root)
        with self._lock:
            index = self._indexes.get(key)
            if index is None:
                store = self._open_store(key)
                index = DocumentIndex(key, store)
                self._indexes[key] = index
            return index

    def _open_store(self, key: str) -> DocumentStore:
        if self._store_factory is not None:
            return self._store_factory(key)
        from core.rag.pgstore import PgQdrantStore

        if self._database is None:
            self._database = Database()
        return PgQdrantStore(
            workspace_key(key),
            database=self._database,
            qdrant_url=qdrant_url(),
            qdrant_api_key=qdrant_api_key(),
        )

    def close(self) -> None:
        with self._lock:
            for job in self._jobs.values():
                job.stop.set()
            jobs = list(self._jobs.values())
        for job in jobs:
            if job.thread is not None:
                job.thread.join(timeout=5)
        with self._lock:
            for index in self._indexes.values():
                index.store.close()
            self._indexes.clear()
            self._jobs.clear()

    # -- indexing ---------------------------------------------------------

    def running(self, root: str | Path) -> bool:
        with self._lock:
            job = self._jobs.get(self._key(root))
            return bool(job and job.running)

    def start(
        self,
        root: str | Path,
        factory: EmbedderFactory,
        *,
        force: bool = False,
        only: set[str] | None = None,
        respect_cooldown: bool = False,
    ) -> bool:
        """Start (or join) background indexing. Returns ``True`` when a job is
        running afterwards. Raises :class:`EmbeddingNotConfigured` at once when
        there is no credential, so callers can report it without a thread."""

        key = self._key(root)
        with self._lock:
            job = self._jobs.get(key)
            if job is not None and job.running:
                return True
            if (
                respect_cooldown
                and job is not None
                and job.error
                and job.finished_at is not None
                and time.time() - job.finished_at < ERROR_COOLDOWN_S
            ):
                return False
            embedder = factory()
            index = self.index_for(key)
            job = _Job()
            self._jobs[key] = job

            def progress(done: int, total: int, current: str | None) -> None:
                job.done, job.total, job.current = done, total, current

            def run() -> None:
                try:
                    job.report = index.index(
                        embedder,
                        force=force,
                        only=only,
                        progress=progress,
                        should_stop=job.stop.is_set,
                    )
                    job.error = job.report.error
                except EmbeddingError as exc:
                    job.error = str(exc)
                except Exception as exc:  # noqa: BLE001 - surface, never crash the host
                    logger.exception("document indexing failed for {}", key)
                    job.error = f"indexing failed: {type(exc).__name__}"
                finally:
                    job.current = None
                    job.finished_at = time.time()

            job.thread = threading.Thread(
                target=run, name="rag-index", daemon=True
            )
            job.thread.start()
            return True

    def wait(self, root: str | Path, timeout: float) -> bool:
        """Wait up to ``timeout`` seconds; ``True`` when no job is running."""

        with self._lock:
            job = self._jobs.get(self._key(root))
        if job is None or job.thread is None:
            return True
        job.thread.join(timeout=max(0.0, timeout))
        return not job.thread.is_alive()

    # -- reading ----------------------------------------------------------

    def status(
        self,
        root: str | Path,
        *,
        configured: bool,
        model: str | None = None,
    ) -> dict:
        model = model or configured_embedding_model()
        index = self.index_for(root)
        documents, truncated = index.document_statuses(model)
        with self._lock:
            job = self._jobs.get(self._key(root))
        counts = {
            "total": len(documents),
            "indexed": sum(1 for d in documents if d["status"] == STATUS_INDEXED),
            "pending": sum(1 for d in documents if d["status"] == STATUS_PENDING),
            "failed": sum(1 for d in documents if d["status"] == STATUS_FAILED),
        }
        running = bool(job and job.running)
        error = job.error if job is not None and not running else None
        if not configured:
            error = not_configured_message()
        state = "indexing" if running else ("error" if error and counts["pending"] else "idle")
        if not configured:
            state = "unconfigured"
        indexed_at = [d["indexedAt"] for d in documents if d["indexedAt"] is not None]
        return {
            "state": state,
            "configured": configured,
            "embeddingModel": model,
            "documents": documents,
            "counts": counts,
            "progress": (
                {"done": job.done, "total": job.total, "current": job.current}
                if running and job is not None
                else None
            ),
            "error": error,
            "truncated": truncated,
            "lastIndexedAt": max(indexed_at) if indexed_at else None,
        }

    def search(
        self,
        root: str | Path,
        factory: EmbedderFactory,
        query: str,
        *,
        k: int = 6,
        paths: list[str] | None = None,
        wait_s: float = 20.0,
    ) -> SearchOutcome:
        """Bring the index up to date within ``wait_s`` and search it."""

        embedder = factory()  # raises EmbeddingNotConfigured
        index = self.index_for(root)
        plan = index.plan(embedder.model)
        error: str | None = None
        if plan.to_index or plan.to_remove:
            if self.start(root, lambda: embedder, respect_cooldown=True):
                self.wait(root, wait_s)
        with self._lock:
            job = self._jobs.get(self._key(root))
            if job is not None and not job.running:
                error = job.error
        hits = index.search(embedder, query, k=k, paths=paths)
        documents, _truncated = index.document_statuses(embedder.model)
        return SearchOutcome(
            hits=hits,
            indexed=sum(1 for d in documents if d["status"] == STATUS_INDEXED),
            pending=sum(1 for d in documents if d["status"] == STATUS_PENDING),
            failed=sum(1 for d in documents if d["status"] == STATUS_FAILED),
            indexing=self.running(root),
            error=error,
        )


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------


def openrouter_embedder_factory(
    resolve_key: Callable[[], str | None],
    *,
    api_base: str | None = None,
) -> EmbedderFactory:
    """Factory for the OpenRouter embedder; the key is resolved per call so a
    key saved after startup is picked up without a restart."""

    def factory() -> Embedder:
        key = None
        try:
            key = resolve_key()
        except Exception:  # noqa: BLE001 - an unreadable store means "no key"
            key = None
        key = key or os.environ.get(OPENROUTER_KEY_ENV)
        return OpenRouterEmbedder(
            key, api_base=os.environ.get(RAG_API_BASE_ENV) or api_base
        )

    return factory


def embedder_configured(factory: EmbedderFactory) -> bool:
    try:
        factory()
    except EmbeddingNotConfigured:
        return False
    except EmbeddingError:
        return True
    return True


_SERVICE: RagService | None = None
_SERVICE_LOCK = threading.Lock()


def get_rag_service() -> RagService:
    global _SERVICE
    with _SERVICE_LOCK:
        if _SERVICE is None:
            _SERVICE = RagService()
        return _SERVICE


def reset_rag_service(service: RagService | None = None) -> None:
    """Swap the process-wide service (tests)."""

    global _SERVICE
    with _SERVICE_LOCK:
        previous, _SERVICE = _SERVICE, service
    if previous is not None and previous is not service:
        previous.close()


__all__ = [
    "EmbedderFactory",
    "RagService",
    "SearchOutcome",
    "embedder_configured",
    "get_rag_service",
    "openrouter_embedder_factory",
    "reset_rag_service",
]
