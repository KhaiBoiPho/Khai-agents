"""Per-response cost estimate and the optional spend guard.

Cost comes from the provider when it reports one (OpenRouter puts what it
charged in ``usage.cost``; adapters carry it as ``USAGE_COST_KEY`` in nano-USD)
and otherwise from the catalog list price of the model, the same rule the usage
report uses. A model with neither has an unknown cost, and the guard cannot
act on it (it never guesses).
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import lru_cache

from core.providers.base import NANO_USD, USAGE_COST_KEY

#: Catalog rungs whose prices belong to this exact model (see usage_service).
_PRICED_SOURCES = frozenset({"seed", "snapshot"})


@lru_cache(maxsize=128)
def _list_prices(model: str) -> tuple[float, float] | None:
    try:
        from core.providers.catalog import resolve_model_info

        info = resolve_model_info(model)
    except Exception:  # noqa: BLE001 - pricing is best effort
        return None
    if info.source not in _PRICED_SOURCES:
        return None
    if info.input_cost_per_1m is None or info.output_cost_per_1m is None:
        return None
    return float(info.input_cost_per_1m), float(info.output_cost_per_1m)


def _count(usage: Mapping[str, object], *keys: str) -> int:
    for key in keys:
        value = usage.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
    return 0


def response_cost_usd(model: str | None, usage: Mapping[str, object]) -> float | None:
    """USD one model response cost, or ``None`` when it cannot be known."""

    reported = usage.get(USAGE_COST_KEY)
    if isinstance(reported, int) and not isinstance(reported, bool) and reported >= 0:
        return reported / NANO_USD
    prompt = _count(usage, "prompt_tokens", "input_tokens")
    completion = _count(usage, "completion_tokens", "output_tokens")
    if not (prompt or completion) or not model:
        return 0.0 if not (prompt or completion) else None
    prices = _list_prices(model)
    if prices is None:
        return None
    # List price, cached input in full: conservative, so the guard trips no
    # later than the real bill would.
    return (prompt * prices[0] + completion * prices[1]) / 1_000_000


def spend_limit_message(
    *,
    scope: str,
    spent_usd: float,
    limit_usd: float,
    setting: str,
) -> str:
    if scope == "session":
        follow_up = "Start a new chat to continue."
    else:
        follow_up = "Send a message to continue from here."
    return (
        f"Stopped: this {scope} has used about ${spent_usd:.4f} of model calls, "
        f"over the ${limit_usd:.4f} limit set by the host ({setting}). "
        f"{follow_up}"
    )
