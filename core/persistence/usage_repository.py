"""Provider-reported token usage ledger (one row per billed model response)."""

from __future__ import annotations

from core.persistence.database import Connection, Row
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from core.domain.common import new_id, utc_now
from core.providers.base import NANO_USD, USAGE_COST_KEY
from core.persistence.serde import dump_datetime, load_json, load_required_datetime


def _counter(usage: Mapping[str, object], *keys: str) -> int:
    for key in keys:
        value = usage.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return 0


@dataclass(frozen=True, slots=True)
class UsageTokens:
    """Input/output/cached counts normalized across provider vocabularies."""

    input_tokens: int
    output_tokens: int
    cached_input_tokens: int

    @classmethod
    def from_usage(cls, usage: Mapping[str, object]) -> "UsageTokens":
        prompt = _counter(usage, "prompt_tokens", "input_tokens")
        completion = _counter(usage, "completion_tokens", "output_tokens")
        total = _counter(usage, "total_tokens")
        # Reasoning models (Gemini thinking, o-series) bill hidden thinking as
        # output but leave it out of ``completion_tokens``; ``total_tokens``
        # still carries it.
        output = max(completion, total - prompt) if total else completion
        cached = _counter(usage, "cached_tokens", "cache_read_input_tokens")
        return cls(prompt, max(0, output), min(cached, prompt) if prompt else cached)

    @property
    def empty(self) -> bool:
        return not (self.input_tokens or self.output_tokens)


@dataclass(frozen=True, slots=True)
class UsageRecord:
    thread_id: str
    turn_id: str | None
    response_ordinal: int | None
    source: str
    connection_id: str | None
    provider_name: str | None
    model_id: str | None
    tokens: UsageTokens
    recorded_at: datetime
    #: What the provider reported charging, when it reports that (OpenRouter).
    cost_usd: float | None = None


@dataclass(frozen=True, slots=True)
class ModelTotals:
    model_id: str | None
    provider_name: str | None
    requests: int
    tokens: UsageTokens
    #: Summed provider-reported charges, and how many responses had one.
    reported_cost_usd: float
    reported_requests: int
    #: Tokens of the responses without a reported charge (priced by list).
    unreported_tokens: UsageTokens


class UsageRepository:
    def __init__(self, connection: Connection) -> None:
        self.connection = connection

    def record(
        self,
        *,
        thread_id: str,
        usage: Mapping[str, object],
        source: str = "turn",
        turn_id: str | None = None,
        response_ordinal: int | None = None,
        connection_id: str | None = None,
        provider_name: str | None = None,
        model_id: str | None = None,
        recorded_at: datetime | None = None,
    ) -> bool:
        """Insert one billed response; duplicates of a Turn ordinal are ignored.

        When the model identity is not given and a Turn is, it is read from the
        Turn's immutable execution profile (falling back to the Thread model).
        """

        tokens = UsageTokens.from_usage(usage)
        if tokens.empty:
            return False
        cost = usage.get(USAGE_COST_KEY)
        cost_usd = (
            cost / NANO_USD
            if isinstance(cost, int) and not isinstance(cost, bool) and cost >= 0
            else None
        )
        if turn_id is not None and model_id is None:
            connection_id, provider_name, model_id = self._turn_identity(
                turn_id, thread_id
            )
        cursor = self.connection.execute(
            "INSERT INTO usage_records (id, thread_id, turn_id, "
            "response_ordinal, source, connection_id, provider_name, model_id, "
            "input_tokens, output_tokens, cached_input_tokens, recorded_at, "
            "cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT DO NOTHING",
            (
                new_id("usage"),
                thread_id,
                turn_id,
                response_ordinal,
                source,
                connection_id,
                provider_name,
                model_id,
                tokens.input_tokens,
                tokens.output_tokens,
                tokens.cached_input_tokens,
                dump_datetime(recorded_at or utc_now()),
                cost_usd,
            ),
        )
        return cursor.rowcount > 0

    def _turn_identity(
        self, turn_id: str, thread_id: str
    ) -> tuple[str | None, str | None, str | None]:
        row = self.connection.execute(
            "SELECT t.execution_profile_json, th.model FROM turns AS t "
            "LEFT JOIN threads AS th ON th.id = t.thread_id WHERE t.id = ?",
            (turn_id,),
        ).fetchone()
        if row is None:
            row = self.connection.execute(
                "SELECT NULL, model FROM threads WHERE id = ?", (thread_id,)
            ).fetchone()
        if row is None:
            return None, None, None
        try:
            profile = load_json(row[0]) if row[0] else {}
        except ValueError:
            profile = {}

        def text(key: str) -> str | None:
            value = profile.get(key)
            return value if isinstance(value, str) and value else None

        return (
            text("connectionId"),
            text("providerName"),
            text("modelId") or (row[1] if isinstance(row[1], str) else None),
        )

    def list_since(self, since: datetime | None = None) -> list[UsageRecord]:
        """Rows recorded at or after ``since`` (every row when ``None``)."""

        if since is None:
            rows = self.connection.execute(
                "SELECT * FROM usage_records ORDER BY recorded_at"
            ).fetchall()
        else:
            rows = self.connection.execute(
                "SELECT * FROM usage_records WHERE recorded_at >= ? "
                "ORDER BY recorded_at",
                (dump_datetime(since),),
            ).fetchall()
        return [self._from_row(row) for row in rows]

    def list_for_thread(self, thread_id: str) -> list[UsageRecord]:
        rows = self.connection.execute(
            "SELECT * FROM usage_records WHERE thread_id = ? ORDER BY recorded_at",
            (thread_id,),
        ).fetchall()
        return [self._from_row(row) for row in rows]

    def totals_by_model(self) -> list[ModelTotals]:
        """Per model and provider, over all time."""

        rows = self.connection.execute(
            "SELECT model_id, provider_name, COUNT(*), SUM(input_tokens), "
            "SUM(output_tokens), SUM(cached_input_tokens), "
            "COALESCE(SUM(cost_usd), 0), COUNT(cost_usd), "
            "COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN input_tokens END), 0), "
            "COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN output_tokens END), 0) "
            "FROM usage_records GROUP BY model_id, provider_name"
        ).fetchall()
        return [
            ModelTotals(
                model_id=row[0],
                provider_name=row[1],
                requests=int(row[2]),
                tokens=UsageTokens(int(row[3]), int(row[4]), int(row[5])),
                reported_cost_usd=float(row[6]),
                reported_requests=int(row[7]),
                unreported_tokens=UsageTokens(int(row[8]), int(row[9]), 0),
            )
            for row in rows
        ]

    @staticmethod
    def _from_row(row: Row) -> UsageRecord:
        return UsageRecord(
            thread_id=row["thread_id"],
            turn_id=row["turn_id"],
            response_ordinal=row["response_ordinal"],
            source=row["source"],
            connection_id=row["connection_id"],
            provider_name=row["provider_name"],
            model_id=row["model_id"],
            tokens=UsageTokens(
                int(row["input_tokens"]),
                int(row["output_tokens"]),
                int(row["cached_input_tokens"]),
            ),
            recorded_at=load_required_datetime(row["recorded_at"]),
            cost_usd=float(row["cost_usd"]) if row["cost_usd"] is not None else None,
        )
