"""One JSON document per planner page and user, with optimistic versions.

The browser owns the documents' shapes (desktop/src/features/planner) and
normalizes whatever it reads, so this store only keeps them, bounds their
size, and refuses a write based on a stale version. The agent's tools change
a document through :meth:`PlannerStore.mutate`, which reads and writes under
one row lock.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from psycopg.types.json import Jsonb

from core.persistence.database import Database

PLANNER_KEYS = ("tasks", "calendar", "schedule", "notes")
MAX_DOCUMENT_BYTES = 2 * 1024 * 1024


class PlannerError(Exception):
    """A request the store cannot satisfy (unknown key, oversized document)."""


class PlannerConflict(PlannerError):
    """The document changed since the version the writer read."""

    def __init__(self, key: str, current: dict[str, Any]) -> None:
        super().__init__(f"{key} changed since it was read (now version {current['version']})")
        self.key = key
        self.current = current


def _check_key(key: str) -> str:
    if key not in PLANNER_KEYS:
        raise PlannerError(f"unknown planner document {key!r} (one of: {', '.join(PLANNER_KEYS)})")
    return key


def _check_size(value: Any) -> None:
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > MAX_DOCUMENT_BYTES:
        raise PlannerError("planner document is larger than 2 MB")


def _row(row: Any) -> dict[str, Any]:
    updated = row["updated_at"]
    return {
        "value": row["value"],
        "version": int(row["version"]),
        "updatedBy": row["updated_by"],
        "updatedAt": updated.isoformat() if hasattr(updated, "isoformat") else str(updated),
    }


class PlannerStore:
    """The planner documents of the user ``database`` is bound to."""

    def __init__(self, database: Database) -> None:
        self.database = database

    def read(self, keys: tuple[str, ...] | list[str] = PLANNER_KEYS) -> dict[str, dict[str, Any]]:
        """``{key: {value, version, updatedBy, updatedAt}}`` for stored keys only."""

        wanted = [_check_key(key) for key in keys]
        with self.database.read() as c:
            rows = c.execute(
                "SELECT key, value, version, updated_by, updated_at FROM planner_documents"
                " WHERE key = ANY(?)",
                (wanted,),
            ).fetchall()
        return {row["key"]: _row(row) for row in rows}

    def versions(self) -> dict[str, int]:
        """Each stored document's version: what an open tab polls."""

        with self.database.read() as c:
            rows = c.execute("SELECT key, version FROM planner_documents").fetchall()
        return {row["key"]: int(row["version"]) for row in rows}

    def write(
        self,
        key: str,
        value: Any,
        *,
        base_version: int | None,
        by: str = "user",
    ) -> dict[str, Any]:
        """Store ``value``. ``base_version`` is the version it was based on, or
        None for a document the writer believes does not exist yet."""

        _check_key(key)
        _check_size(value)
        with self.database.transaction() as c:
            row = c.execute(
                "SELECT key, value, version, updated_by, updated_at FROM planner_documents"
                " WHERE key = ? FOR UPDATE",
                (key,),
            ).fetchone()
            current = _row(row) if row else None
            if current is not None and base_version != current["version"]:
                raise PlannerConflict(key, current)
            if current is None and base_version not in (None, 0):
                raise PlannerConflict(key, {"value": None, "version": 0})
            saved = c.execute(
                "INSERT INTO planner_documents (key, value, version, updated_by)"
                " VALUES (?, ?, 1, ?)"
                " ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value,"
                " version = planner_documents.version + 1,"
                " updated_by = EXCLUDED.updated_by, updated_at = now()"
                " RETURNING key, value, version, updated_by, updated_at",
                (key, Jsonb(value), by),
            ).fetchone()
            return _row(saved)

    def mutate(
        self,
        key: str,
        change: Callable[[Any], tuple[Any, Any]],
        *,
        by: str = "agent",
    ) -> tuple[dict[str, Any], Any]:
        """Apply ``change(current_value_or_None) -> (new_value, result)`` under
        the row lock; returns the stored document and ``result``."""

        _check_key(key)
        with self.database.transaction() as c:
            row = c.execute(
                "SELECT value FROM planner_documents WHERE key = ? FOR UPDATE", (key,)
            ).fetchone()
            value, result = change(row["value"] if row else None)
            _check_size(value)
            saved = c.execute(
                "INSERT INTO planner_documents (key, value, version, updated_by)"
                " VALUES (?, ?, 1, ?)"
                " ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value,"
                " version = planner_documents.version + 1,"
                " updated_by = EXCLUDED.updated_by, updated_at = now()"
                " RETURNING key, value, version, updated_by, updated_at",
                (key, Jsonb(value), by),
            ).fetchone()
            return _row(saved), result
