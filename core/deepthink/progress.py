"""Step progress for one DeepThink run, published as full snapshots."""

from __future__ import annotations

import time
from collections.abc import Callable
from copy import deepcopy
from typing import Any

PROGRESS_VERSION = 1

STEP_IDS = ("plan", "search", "check", "summarize")
#: Replaces ``summarize`` when the agent builds a deliverable.
DELIVER_STEP_ID = "deliver"
_LABELS = {
    "plan": "Plan",
    "search": "Search",
    "check": "Check",
    "summarize": "Summarize",
    DELIVER_STEP_ID: "Create",
}
_MAX_ITEMS = 8
_MAX_SOURCES = 24
#: The live feed keeps only its tail and publishes at most this often.
_LIVE_CHARS = 1500
_LIVE_INTERVAL_S = 0.25

ProgressSink = Callable[[dict[str, Any]], None]


class DeepThinkProgress:
    """Owns the progress document; every change publishes a snapshot.

    Step status is one of ``pending``, ``running``, ``completed``,
    ``skipped`` or ``failed``; the run status is ``running``, ``completed``,
    ``failed`` or ``interrupted``.
    """

    def __init__(self, sink: ProgressSink) -> None:
        self._sink = sink
        self._doc: dict[str, Any] = {
            "version": PROGRESS_VERSION,
            "status": "running",
            "round": 0,
            "steps": [
                {
                    "id": step_id,
                    "label": _LABELS[step_id],
                    "status": "pending",
                    "detail": None,
                    "items": [],
                }
                for step_id in STEP_IDS
            ],
            "sources": [],
            "notes": [],
            # What the running research step is doing right now: the model's
            # reasoning and findings as they arrive. Answer text never goes
            # here; it streams as the reply below the card.
            "live": {"step": None, "text": ""},
        }
        self._last_publish = 0.0
        self._dirty = False

    @property
    def snapshot(self) -> dict[str, Any]:
        return deepcopy(self._doc)

    def _step(self, step_id: str) -> dict[str, Any]:
        return next(step for step in self._doc["steps"] if step["id"] == step_id)

    def status_of(self, step_id: str) -> str:
        return str(self._step(step_id)["status"])

    def _publish(self) -> None:
        self._last_publish = time.monotonic()
        self._dirty = False
        self._sink(self.snapshot)

    def stream(self, step_id: str, text: str) -> None:
        """Append to the running step's live feed (publishing throttled)."""

        if not text:
            return
        live = self._doc["live"]
        if live["step"] != step_id:
            live["step"], live["text"] = step_id, ""
        live["text"] = (live["text"] + text)[-_LIVE_CHARS:]
        if time.monotonic() - self._last_publish >= _LIVE_INTERVAL_S:
            self._publish()
        else:
            self._dirty = True

    def flush(self) -> None:
        """Publish a live feed update the throttle held back."""

        if self._dirty:
            self._publish()

    def update(
        self,
        step_id: str,
        status: str,
        *,
        detail: str | None = None,
        items: list[str] | None = None,
        publish: bool = True,
    ) -> None:
        step = self._step(step_id)
        step["status"] = status
        if detail is not None:
            step["detail"] = detail[:200]
        if items is not None:
            step["items"] = [str(item)[:300] for item in items[:_MAX_ITEMS]]
        if publish:
            self._publish()

    def start(self, step_id: str, detail: str | None = None) -> None:
        self._doc["live"] = {"step": step_id, "text": ""}
        self.update(step_id, "running", detail=detail)

    def complete(
        self, step_id: str, detail: str | None = None, items: list[str] | None = None
    ) -> None:
        self.update(step_id, "completed", detail=detail, items=items)

    def skip(self, step_id: str, detail: str) -> None:
        self.update(step_id, "skipped", detail=detail)

    def fail(self, step_id: str, detail: str) -> None:
        self.update(step_id, "failed", detail=detail)

    def use_deliver_step(self) -> None:
        """Swap the final ``summarize`` step for ``deliver`` (agent phase)."""

        steps = self._doc["steps"]
        if any(step["id"] == DELIVER_STEP_ID for step in steps):
            return
        for index, step in enumerate(steps):
            if step["id"] == "summarize":
                steps[index] = {
                    "id": DELIVER_STEP_ID,
                    "label": _LABELS[DELIVER_STEP_ID],
                    "status": "pending",
                    "detail": None,
                    "items": [],
                }
                return

    def set_round(self, round_number: int) -> None:
        self._doc["round"] = round_number

    def set_sources(self, sources: list[dict[str, Any]]) -> None:
        self._doc["sources"] = [
            {
                "id": source["id"],
                "title": str(source.get("title") or source["url"])[:200],
                "url": source["url"],
            }
            for source in sources[:_MAX_SOURCES]
        ]

    def note(self, text: str) -> None:
        if text not in self._doc["notes"]:
            self._doc["notes"].append(text[:240])

    def finish(self, status: str) -> None:
        self._doc["status"] = status
        self._doc["live"] = {"step": None, "text": ""}
        for step in self._doc["steps"]:
            if step["status"] == "pending":
                step["status"] = "skipped"
            elif step["status"] == "running":
                step["status"] = "failed" if status != "completed" else "completed"
        self._publish()


__all__ = ["DELIVER_STEP_ID", "PROGRESS_VERSION", "STEP_IDS", "DeepThinkProgress"]
