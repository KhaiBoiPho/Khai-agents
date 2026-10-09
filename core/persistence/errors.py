"""Infrastructure errors translated at the persistence boundary."""


class PersistenceConflictError(RuntimeError):
    """A uniqueness or consistency constraint rejected a write."""


class DatabaseError(RuntimeError):
    """The database rejected or failed a statement."""


class IntegrityError(DatabaseError):
    """A constraint, foreign key or integrity trigger rejected a write."""


class OperationalError(DatabaseError):
    """The database could not run the statement (connection, lock, timeout)."""


class UserScopeError(RuntimeError):
    """A query ran without the user scope that multi-user mode requires."""
