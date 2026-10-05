"""Load ``KEY=VALUE`` pairs from ``.env`` files into ``os.environ``.

Two files are read, both optional: the user-level ``$DEEPCODE_HOME/.env``
(``~/.deepcode/.env``) and the ``.env`` at the checkout root. Variables that
are already set in the process environment always win, so a shell export or
a platform secret overrides either file, and the home file overrides the
checkout file.
"""

from __future__ import annotations

import os
from pathlib import Path

_CHECKOUT_ROOT = Path(__file__).resolve().parents[1]


def _parse(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        name, sep, value = line.partition("=")
        name = name.strip()
        if not sep or not name.isidentifier():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[name] = value
    return values


def dotenv_paths() -> list[Path]:
    home = os.environ.get("DEEPCODE_HOME")
    home_dir = Path(home).expanduser() if home else Path.home() / ".deepcode"
    return [home_dir / ".env", _CHECKOUT_ROOT / ".env"]


def load_dotenv() -> list[Path]:
    """Apply every readable ``.env`` file; return the ones that were loaded."""

    loaded: list[Path] = []
    for path in dotenv_paths():
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for name, value in _parse(text).items():
            if value and name not in os.environ:
                os.environ[name] = value
        loaded.append(path)
    return loaded
