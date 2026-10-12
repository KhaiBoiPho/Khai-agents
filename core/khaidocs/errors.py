"""Errors the store raises; the HTTP layer maps them to status codes."""

from __future__ import annotations


class KhaiDocsError(Exception):
    """Base class. ``status`` is the HTTP status the route layer answers with."""

    status = 400

    def __init__(self, message: str = "") -> None:
        super().__init__(message or self.__class__.__name__)


class NotFound(KhaiDocsError):
    status = 404


class Invalid(KhaiDocsError):
    status = 400


class TooLarge(KhaiDocsError):
    status = 413


class Conflict(KhaiDocsError):
    status = 409
