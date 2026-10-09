"""Token usage reporting over the provider-reported usage ledger."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from core.domain.common import utc_now
from core.persistence.database import Database
from core.persistence.serde import dump_datetime
from core.persistence.usage_repository import UsageRepository, UsageTokens
from core.providers.catalog import resolve_model_info

MAX_SUMMARY_DAYS = 90
#: Catalog rungs whose prices belong to this exact model. A ``family:`` match
#: borrows another model's numbers and a ``default`` has none, so neither is
#: shown as a cost.
_PRICED_SOURCES = frozenset({"seed", "snapshot"})


def model_prices(model_id: str | None) -> tuple[float, float] | None:
    """USD per 1M ``(input, output)`` tokens, when the catalog knows them."""

    if not model_id:
        return None
    info = resolve_model_info(model_id)
    if info.source not in _PRICED_SOURCES:
        return None
    if info.input_cost_per_1m is None or info.output_cost_per_1m is None:
        return None
    return float(info.input_cost_per_1m), float(info.output_cost_per_1m)


@dataclass(slots=True)
class _Totals:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    requests: int = 0
    cost_usd: float = 0.0
    unpriced_requests: int = 0

    def add(
        self,
        tokens: UsageTokens,
        prices: tuple[float, float] | None,
        *,
        requests: int = 1,
    ) -> None:
        self.input_tokens += tokens.input_tokens
        self.output_tokens += tokens.output_tokens
        self.cached_input_tokens += tokens.cached_input_tokens
        self.requests += requests
        if prices is None:
            self.unpriced_requests += requests
        else:
            # List price: cache-read discounts differ per vendor and the
            # catalog does not carry them, so cached input is priced in full.
            self.cost_usd += (
                tokens.input_tokens * prices[0] + tokens.output_tokens * prices[1]
            ) / 1_000_000

    def view(self) -> dict[str, Any]:
        return {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "cachedInputTokens": self.cached_input_tokens,
            "requests": self.requests,
            "costUsd": round(self.cost_usd, 6),
            "unpricedRequests": self.unpriced_requests,
        }


class UsageService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def summary(
        self,
        *,
        days: int = 30,
        utc_offset_minutes: int = 0,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Daily, today/7-day/all-time, and per-model token usage.

        Days are calendar days in the caller's UTC offset so "today" matches
        the viewer's clock rather than UTC midnight.
        """

        if not 1 <= days <= MAX_SUMMARY_DAYS:
            raise ValueError(f"days must be between 1 and {MAX_SUMMARY_DAYS}")
        if not -14 * 60 <= utc_offset_minutes <= 14 * 60:
            raise ValueError("utcOffsetMinutes must be within ±14 hours")
        moment = now or utc_now()
        zone = timezone(timedelta(minutes=utc_offset_minutes))
        today = moment.astimezone(zone).date()
        first_day = today - timedelta(days=days - 1)
        week_start = today - timedelta(days=6)
        since = datetime.combine(min(first_day, week_start), time(0), zone)

        with self.database.read() as connection:
            repository = UsageRepository(connection)
            records = repository.list_since(since)
            by_model = repository.totals_by_model()

        daily: dict[date, _Totals] = {
            first_day + timedelta(days=offset): _Totals() for offset in range(days)
        }
        today_totals = _Totals()
        week_totals = _Totals()
        price_cache: dict[str | None, tuple[float, float] | None] = {}

        def prices_for(model_id: str | None) -> tuple[float, float] | None:
            if model_id not in price_cache:
                price_cache[model_id] = model_prices(model_id)
            return price_cache[model_id]

        for record in records:
            prices = prices_for(record.model_id)
            day = record.recorded_at.astimezone(zone).date()
            bucket = daily.get(day)
            if bucket is not None:
                bucket.add(record.tokens, prices)
            if day >= week_start:
                week_totals.add(record.tokens, prices)
            if day == today:
                today_totals.add(record.tokens, prices)

        all_time = _Totals()
        models: list[dict[str, Any]] = []
        for model_id, provider_name, requests, inputs, outputs, cached in by_model:
            prices = prices_for(model_id)
            totals = _Totals()
            totals.add(UsageTokens(inputs, outputs, cached), prices, requests=requests)
            all_time.add(UsageTokens(inputs, outputs, cached), prices, requests=requests)
            models.append(
                {
                    "modelId": model_id,
                    "providerName": provider_name,
                    **totals.view(),
                    "inputPricePerMillion": prices[0] if prices else None,
                    "outputPricePerMillion": prices[1] if prices else None,
                }
            )
        models.sort(
            key=lambda entry: entry["inputTokens"] + entry["outputTokens"],
            reverse=True,
        )
        return {
            "generatedAt": dump_datetime(moment),
            "utcOffsetMinutes": utc_offset_minutes,
            "days": [
                {"date": day.isoformat(), **totals.view()}
                for day, totals in sorted(daily.items())
            ],
            "today": today_totals.view(),
            "week": week_totals.view(),
            "allTime": all_time.view(),
            "models": models,
        }

    def thread(self, thread_id: str) -> dict[str, Any]:
        """One conversation's token use and cost, per connection.

        A response's cost is what the provider reported charging (OpenRouter)
        when it did, otherwise the catalog list price; ``unpricedRequests``
        counts responses with neither.
        """

        with self.database.read() as connection:
            records = UsageRepository(connection).list_for_thread(thread_id)
        total = _Totals()
        connections: dict[tuple[str | None, str | None], _Totals] = {}
        for record in records:
            prices = model_prices(record.model_id)
            key = (record.connection_id, record.provider_name)
            for bucket in (total, connections.setdefault(key, _Totals())):
                if record.cost_usd is not None:
                    bucket.add(record.tokens, None)
                    bucket.unpriced_requests -= 1
                    bucket.cost_usd += record.cost_usd
                else:
                    bucket.add(record.tokens, prices)
        return {
            "threadId": thread_id,
            **total.view(),
            "connections": [
                {"connectionId": connection_id, "providerName": provider, **totals.view()}
                for (connection_id, provider), totals in connections.items()
            ],
        }
