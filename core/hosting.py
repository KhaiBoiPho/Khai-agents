"""Facts a hosted worker learns from its gateway through the environment.

* ``KHAI_ALLOW_COMMANDS`` — "0" when the administrator has not allowed this
  user to run commands: no shell tool, no terminals, no local (stdio) MCP
  servers and no test runs. Unset (single-user installs) means allowed.
* The infrastructure variables in :data:`INFRASTRUCTURE_ENV` configure the
  worker itself and never reach anything it spawns.
"""

from __future__ import annotations

import os

INFRASTRUCTURE_ENV = frozenset(
    {
        "KHAI_WORKER_TOKEN",
        "KHAI_DATABASE_URL",
        "KHAI_DATABASE_SCHEMA",
        "KHAI_REDIS_URL",
        "KHAI_QDRANT_API_KEY",
        "KHAI_QDRANT_URL",
        "KHAI_QDRANT_COLLECTION_PREFIX",
        "KHAI_USER_ID",
        "KHAI_ALLOW_COMMANDS",
    }
)


def commands_allowed() -> bool:
    return os.environ.get("KHAI_ALLOW_COMMANDS", "1").strip() != "0"


COMMANDS_DISABLED_MESSAGE = (
    "Running commands is not enabled for this account. Ask an administrator "
    "to allow it in Settings → Users."
)
