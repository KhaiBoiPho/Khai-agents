"""Append-only thread event log."""

from __future__ import annotations

from dataclasses import replace

from core.persistence.database import Connection, Row

from core.domain.common import JsonObject
from core.domain.event import DomainEvent
from core.persistence.serde import (
    dump_datetime,
    dump_json,
    load_json,
    load_required_datetime,
)


class EventRepository:
    def __init__(self, connection: Connection) -> None:
        self.connection = connection

    def append(
        self,
        *,
        thread_id: str,
        type: str,
        payload: JsonObject,
        turn_id: str | None = None,
        item_id: str | None = None,
    ) -> DomainEvent:
        # Validate before writing; the real sequence is assigned in the INSERT
        # itself, saving the separate MAX(sequence) round trip.
        provisional = DomainEvent(
            sequence=1,
            type=type,
            thread_id=thread_id,
            turn_id=turn_id,
            item_id=item_id,
            payload=payload,
        )
        row = self.connection.execute(
            "INSERT INTO event_log (id, thread_id, sequence, type, turn_id, item_id, "
            "timestamp, payload_json) "
            "SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ?, ?, ? "
            "FROM event_log WHERE thread_id = ? "
            "RETURNING sequence",
            (
                provisional.id,
                provisional.thread_id,
                provisional.type,
                provisional.turn_id,
                provisional.item_id,
                dump_datetime(provisional.timestamp),
                dump_json(provisional.payload),
                provisional.thread_id,
            ),
        ).fetchone()
        return replace(provisional, sequence=int(row[0]))

    def replay(
        self,
        thread_id: str,
        *,
        after: int = 0,
        limit: int = 500,
        through: int | None = None,
    ) -> list[DomainEvent]:
        upper_bound = " AND sequence <= ?" if through is not None else ""
        parameters = (
            (thread_id, after, through, limit)
            if through is not None
            else (thread_id, after, limit)
        )
        rows = self.connection.execute(
            "SELECT * FROM event_log WHERE thread_id = ? AND sequence > ?"
            f"{upper_bound} "
            "ORDER BY sequence LIMIT ?",
            parameters,
        ).fetchall()
        return [self._from_row(row) for row in rows]

    def sequence_heads(self) -> dict[str, int]:
        """Return each durable event stream's current contiguous head."""

        rows = self.connection.execute(
            "SELECT thread_id, MAX(sequence) AS sequence "
            "FROM event_log GROUP BY thread_id"
        ).fetchall()
        return {str(row["thread_id"]): int(row["sequence"]) for row in rows}

    def snapshot_xmin(self) -> int:
        """Return the oldest transaction id still running right now.

        Every event committed after this call carries ``tx_id`` at or above
        the returned value (see schema 0005), whatever order its transaction
        commits in.
        """

        row = self.connection.execute(
            "SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin"
        ).fetchone()
        return int(row["xmin"])

    def sequence_heads_since(self, tx_floor: int) -> dict[str, int]:
        """Return stream heads of Threads with events from ``tx_floor`` on.

        Uses the ``tx_id`` index, so an idle log costs one index probe instead
        of grouping every row as :meth:`sequence_heads` does.
        """

        rows = self.connection.execute(
            "SELECT thread_id, MAX(sequence) AS sequence FROM event_log "
            "WHERE tx_id >= CAST(? AS xid8) GROUP BY thread_id",
            (str(tx_floor),),
        ).fetchall()
        return {str(row["thread_id"]): int(row["sequence"]) for row in rows}

    def sequence_head(self, thread_id: str) -> int:
        """Return one stream head without scanning unrelated Threads."""

        row = self.connection.execute(
            "SELECT COALESCE(MAX(sequence), 0) AS sequence "
            "FROM event_log WHERE thread_id = ?",
            (thread_id,),
        ).fetchone()
        return int(row["sequence"]) if row is not None else 0

    def list_for_turn(
        self,
        thread_id: str,
        turn_id: str,
        *,
        event_type: str | None = None,
    ) -> list[DomainEvent]:
        parameters: list[object] = [thread_id, turn_id]
        type_filter = ""
        if event_type is not None:
            type_filter = " AND type = ?"
            parameters.append(event_type)
        rows = self.connection.execute(
            "SELECT * FROM event_log WHERE thread_id = ? AND turn_id = ?"
            f"{type_filter} ORDER BY sequence",
            parameters,
        ).fetchall()
        return [self._from_row(row) for row in rows]

    def has_type(self, thread_id: str, event_type: str) -> bool:
        row = self.connection.execute(
            "SELECT 1 FROM event_log WHERE thread_id = ? AND type = ? LIMIT 1",
            (thread_id, event_type),
        ).fetchone()
        return row is not None

    @staticmethod
    def _from_row(row: Row) -> DomainEvent:
        return DomainEvent(
            id=row["id"],
            thread_id=row["thread_id"],
            sequence=row["sequence"],
            type=row["type"],
            turn_id=row["turn_id"],
            item_id=row["item_id"],
            timestamp=load_required_datetime(row["timestamp"]),
            payload=load_json(row["payload_json"]),
        )
