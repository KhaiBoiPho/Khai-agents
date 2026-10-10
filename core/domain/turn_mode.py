"""How one Turn is executed: the normal agent loop or a DeepThink research run."""

from __future__ import annotations

from enum import StrEnum

#: Key under which a non-default mode is persisted on the Turn's initial
#: user-message Item payload. The Item is durable with the Turn, so the mode
#: survives restart recovery and is replayed by retry.
TURN_MODE_PAYLOAD_KEY = "mode"


class TurnMode(StrEnum):
    NORMAL = "normal"
    DEEPTHINK = "deepthink"


def parse_turn_mode(value: object) -> TurnMode:
    """Decode a requested/persisted mode; absent or unknown means normal."""

    if isinstance(value, TurnMode):
        return value
    if isinstance(value, str):
        try:
            return TurnMode(value.strip().lower())
        except ValueError:
            return TurnMode.NORMAL
    return TurnMode.NORMAL


__all__ = ["TURN_MODE_PAYLOAD_KEY", "TurnMode", "parse_turn_mode"]
