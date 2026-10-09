"""One-time import of a pre-PostgreSQL install into one account.

Reads the old SQLite database read-only (schema version 18, the last SQLite
release) and writes its projects, Sessions, Turns, items, approvals,
workflows, artifacts, events, usage and automations into PostgreSQL as the
given user. Runtime coordination (workers, leases) is not carried over: it
describes processes that no longer exist.

    # Stop the old service first so its database is at rest.
    python scripts/import_sqlite_state.py --user khai \\
        --sqlite ~/.deepcode/state/deepcode.sqlite3 \\
        [--rewrite-path /Users/me/.deepcode=/data/home ...] [--dry-run]

``--rewrite-path OLD=NEW`` rewrites path prefixes (project roots, Session
workspaces) for a hosted worker whose files live elsewhere; copy the old
home's files (sessions/, deepcode_config.json, credentials.json, skills/)
into the account's home yourself. The import is one transaction: it either
lands completely or not at all, and it refuses to run if the account
already has projects.

This is the only code that still opens SQLite, and only to read the past.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.auth.users import normalize_username  # noqa: E402
from core.persistence.database import Database  # noqa: E402

SUPPORTED_VERSION = 18

# Parents before children. Self references (threads.parent_thread_id,
# workflow_runs.retry_of) are filled in a second pass.
TABLES = (
    "projects",
    "threads",
    "turns",
    "items",
    "approvals",
    "approval_grants",
    "workflow_runs",
    "artifacts",
    "event_log",
    "legacy_imports",
    "usage_records",
    "automations",
    "automation_revisions",
    "automation_occurrences",
    "automation_runs",
)
SECOND_PASS = {"threads": "parent_thread_id", "workflow_runs": "retry_of"}
# References to runtime workers of the old process; meaningless here.
CLEARED = {"turns": ("home_worker_id", "execution_owner_id")}
PATH_COLUMNS = {
    "projects": ("canonical_path",),
    "threads": ("workspace_path", "worktree_path"),
    "artifacts": ("storage_path",),
}


def _rewrite(value, rewrites: list[tuple[str, str]]):
    if not isinstance(value, str):
        return value
    for old, new in rewrites:
        if value == old or value.startswith(old.rstrip("/") + "/"):
            return new.rstrip("/") + value[len(old.rstrip("/")) :]
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--user", required=True, help="the receiving account's username")
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--rewrite-path", action="append", default=[], metavar="OLD=NEW")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    rewrites = []
    for item in args.rewrite_path:
        old, separator, new = item.partition("=")
        if not separator or not old or not new:
            parser.error(f"--rewrite-path expects OLD=NEW, got {item!r}")
        rewrites.append((old, new))

    # immutable: the old service is stopped, so the file is at rest.
    source = sqlite3.connect(
        f"file:{args.sqlite.expanduser()}?mode=ro&immutable=1", uri=True
    )
    source.row_factory = sqlite3.Row
    version = source.execute("SELECT max(version) FROM schema_migrations").fetchone()[0]
    if version != SUPPORTED_VERSION:
        print(
            f"The SQLite database is at schema {version}; open it once with the last "
            f"SQLite release to bring it to {SUPPORTED_VERSION}, then import.",
            file=sys.stderr,
        )
        return 2

    database = Database()
    database.initialize()
    with database.system().read() as connection:
        row = connection.execute(
            "SELECT id, status FROM users WHERE username = ?",
            (normalize_username(args.user),),
        ).fetchone()
    if row is None or row["status"] != "active":
        print(f"No active account named {args.user!r}; register it first.", file=sys.stderr)
        return 2
    target = database.for_user(str(row["id"]))

    counts: dict[str, int] = {}
    with target.transaction() as connection:
        if connection.execute("SELECT 1 FROM projects LIMIT 1").fetchone():
            print("This account already has projects; refusing to merge.", file=sys.stderr)
            return 2
        connection.execute("SET CONSTRAINTS ALL DEFERRED")
        for table in TABLES:
            rows = source.execute(f"SELECT * FROM {table}").fetchall()
            counts[table] = len(rows)
            if not rows:
                continue
            columns = list(rows[0].keys())
            deferred = SECOND_PASS.get(table)
            values = []
            for record in rows:
                item = dict(record)
                for column in CLEARED.get(table, ()):
                    item[column] = None
                for column in PATH_COLUMNS.get(table, ()):
                    item[column] = _rewrite(item[column], rewrites)
                if deferred:
                    item[deferred] = None
                values.append(tuple(item[column] for column in columns))
            placeholders = ", ".join("?" for _ in columns)
            connection.executemany(
                f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
            if deferred:
                connection.executemany(
                    f"UPDATE {table} SET {deferred} = ? WHERE id = ?",
                    [
                        (record[deferred], record["id"])
                        for record in rows
                        if record[deferred] is not None
                    ],
                )
        if args.dry_run:
            raise _DryRun()
    _report(counts, args.user, dry_run=False)
    return 0


class _DryRun(Exception):
    pass


def _report(counts: dict[str, int], user: str, *, dry_run: bool) -> None:
    verb = "Would import" if dry_run else "Imported"
    print(f"{verb} into {user}:")
    for table, count in counts.items():
        if count:
            print(f"  {table}: {count}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except _DryRun:
        print("Dry run: everything checked and rolled back.")
        raise SystemExit(0) from None
