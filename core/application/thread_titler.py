"""Summarize a Session's first exchange into a short title.

After a Thread's first Turn completes, one small non-agentic model call turns
the opening prompt plus the final answer into a ChatGPT-style title and applies
it through :meth:`ThreadService.rename` (which emits ``thread.renamed`` so every
client refreshes live). The work runs on a daemon thread so it can never delay,
fail, or block the Turn; any error simply keeps the existing title.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING

from core.domain.execution_profile import ExecutionProfile, ExecutionSelection
from core.domain.item import ItemKind, ItemStatus
from core.domain.turn import Turn, TurnStatus
from core.persistence.execution_repository import ItemRepository
from core.persistence.thread_repository import ThreadRepository

if TYPE_CHECKING:
    from core.application.llm_configuration_service import LLMConfigurationService
    from core.application.thread_service import ThreadService
    from core.persistence.database import Database

logger = logging.getLogger(__name__)

TITLE_TIMEOUT_SECONDS = 15.0
MAX_TITLE_CHARS = 60
_MAX_PROMPT_CHARS = 2000
_MAX_ANSWER_CHARS = 3000

# Titles clients assign before any user content exists.
_PLACEHOLDER_TITLES = frozenset({"", "New task", "New Paper2Code run"})

_TITLE_INSTRUCTIONS = (
    "Write a concise title (at most 6 words) for this conversation, "
    "summarizing what the user asked and what was answered. "
    "Use the same language as the user's message. "
    "Reply with the title only: no quotes, no markdown, no trailing punctuation."
)

TitleGenerator = Callable[[ExecutionProfile, str, str, str], str]
"""``(profile, workspace_path, user_text, answer_text) -> raw title``."""


def is_automatic_title(title: str, first_prompt: str) -> bool:
    """True while ``title`` is still a placeholder or derived from the prompt.

    There is no stored "title source" flag: clients title new Sessions by
    renaming them to the prompt's first line (Desktop, CLI) or the store does
    it in ``Session._title_from``. Any other title was chosen by a person or by
    an earlier generated title, so it must not be overwritten. Matching is a
    prefix test so 60-char truncation (with or without "…", UTF-16 vs code
    points) still counts as automatic.
    """

    clean = title.strip().removesuffix("…").strip()
    if clean in _PLACEHOLDER_TITLES:
        return True
    stripped = first_prompt.strip()
    first_line = stripped.splitlines()[0].strip() if stripped else ""
    if not first_line or not first_line.startswith(clean):
        return False
    return len(clean) >= min(len(first_line), MAX_TITLE_CHARS - 4)


def clean_title(raw: str) -> str:
    """Normalize model output to one short line without quotes/punctuation."""

    lines = [line.strip() for line in (raw or "").splitlines() if line.strip()]
    if not lines:
        return ""
    text = lines[0]
    if text.lower().startswith("title:"):
        text = text[len("title:") :].strip()
    text = text.strip("*#`\"'“”‘’«»「」 ").strip()
    text = text.rstrip(".。!！?？:：;；,，、…").strip()
    if len(text) > MAX_TITLE_CHARS:
        text = text[:MAX_TITLE_CHARS].rstrip() + "…"
    return text


def _truncate(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[:limit] + "…"


class ThreadTitler:
    """Turn-settled listener that titles a Thread after its first Turn."""

    def __init__(
        self,
        database: Database,
        threads: ThreadService,
        llm: LLMConfigurationService,
        *,
        generate: TitleGenerator | None = None,
        spawn: Callable[[Callable[[], None]], None] | None = None,
    ) -> None:
        self.database = database
        self.threads = threads
        self.llm = llm
        self._generate = generate or self._generate_with_model
        self._spawn = spawn or self._spawn_daemon
        self._closed = False

    def close(self) -> None:
        self._closed = True

    def on_turn_settled(self, turn: Turn) -> None:
        # Cheap filters only; everything else happens off the Turn's path.
        if self._closed or turn.ordinal != 1 or turn.status is not TurnStatus.COMPLETED:
            return
        self._spawn(lambda: self._retitle(turn))

    @staticmethod
    def _spawn_daemon(work: Callable[[], None]) -> None:
        threading.Thread(target=work, name="thread-titler", daemon=True).start()

    def _retitle(self, turn: Turn) -> None:
        try:
            with self.database.read() as connection:
                thread = ThreadRepository(connection).get(turn.thread_id)
                items = ItemRepository(connection).list_for_turn(turn.id)
            if thread is None:
                return
            user_text = next(
                (
                    str(item.payload.get("text") or "")
                    for item in items
                    if item.kind is ItemKind.USER_MESSAGE
                ),
                turn.prompt,
            )
            answers = [
                str(item.payload.get("text") or "")
                for item in items
                if item.kind is ItemKind.ASSISTANT_MESSAGE
                and item.status is ItemStatus.COMPLETED
                and str(item.payload.get("text") or "").strip()
            ]
            if not user_text.strip() or not is_automatic_title(thread.title, user_text):
                return
            profile = turn.execution_profile or self.llm.resolve(
                thread.workspace_path,
                ExecutionSelection(
                    connection_id=thread.connection_id,
                    model_id=thread.model,
                    reasoning_effort=thread.reasoning_effort,
                    context_window=thread.context_window,
                ),
            )
            title = clean_title(
                self._generate(
                    profile,
                    thread.workspace_path,
                    _truncate(user_text, _MAX_PROMPT_CHARS),
                    _truncate(answers[-1] if answers else "", _MAX_ANSWER_CHARS),
                )
            )
            if not title or self._closed:
                return
            # Re-check: the user may have renamed while the model was answering.
            current = self.threads.read(turn.thread_id)
            if is_automatic_title(current.title, user_text) and current.title != title:
                self.threads.rename(turn.thread_id, title)
        except Exception:
            logger.warning(
                "could not generate a title for thread %s",
                turn.thread_id,
                exc_info=True,
            )

    def _generate_with_model(
        self,
        profile: ExecutionProfile,
        workspace_path: str,
        user_text: str,
        answer_text: str,
    ) -> str:
        provider = self.llm.build_provider(workspace_path, profile)
        content = f"User message:\n{user_text}"
        if answer_text:
            content += f"\n\nAssistant answer:\n{answer_text}"

        async def call() -> str:
            try:
                response = await asyncio.wait_for(
                    provider.chat(
                        messages=[
                            {"role": "system", "content": _TITLE_INSTRUCTIONS},
                            {"role": "user", "content": content},
                        ],
                        model=profile.model_id,
                        # Headroom for models that spend output tokens thinking.
                        max_tokens=min(1024, profile.max_output_tokens),
                        temperature=0.2,
                        reasoning_effort=None,
                    ),
                    timeout=TITLE_TIMEOUT_SECONDS,
                )
            finally:
                await provider.aclose()
            if response.finish_reason == "error":
                raise RuntimeError(f"title request failed: {response.content!r:.200}")
            return response.content or ""

        # Always called on the titler's own thread, which has no running loop.
        return asyncio.run(call())
