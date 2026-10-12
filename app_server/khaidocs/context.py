"""What every KhaiDocs module shares: the database, who the caller is, and
the realtime hubs."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from aiohttp import web

from app_server.khaidocs.api import KhaiUser
from app_server.khaidocs.socketio import SocketHub
from core.khaidocs import KhaiDocsStore
from core.persistence.database import Database

Authenticate = Callable[[web.Request], Awaitable[KhaiUser]]


class KhaiDocsContext:
    """``authenticate(request)`` returns the signed-in Khai account or raises
    ``web.HTTPUnauthorized``. It is the only identity source: nothing the
    client sends (body, headers, collab token) ever names a user."""

    def __init__(self, database: Database, authenticate: Authenticate) -> None:
        self.database = database
        self.authenticate = authenticate
        self.sockets = SocketHub()
        self.collab = None  # set by app_server.khaidocs.collab.install()
        self._stores: dict[str, KhaiDocsStore] = {}

    def store_for(self, user: KhaiUser) -> KhaiDocsStore:
        store = self._stores.get(user.id)
        if store is None:
            if len(self._stores) > 1024:
                self._stores.clear()
            store = self._stores[user.id] = KhaiDocsStore(self.database.for_user(user.id))
        return store
