"""KhaiDocs: the wiki behind the "KhaiDocs" tab, stored in Khai's Postgres.

Public interface (everything else in this package is internal):

``KhaiDocsStore(database)``  (core.khaidocs.store)
    ``database`` is a user-bound :class:`core.persistence.database.Database`
    (``Database.for_user(user_id)``, or a worker's own). Row-level security
    scopes every call to that user; methods take no user argument. They are
    synchronous; async code wraps them in ``asyncio.to_thread``. Rows are dicts
    with snake_case keys (page: id, slug_id, space_id, parent_page_id,
    position, title, icon, cover_photo, version, is_locked, updated_by,
    created_at, updated_at, deleted_at, has_children[, content, text_content]).

    Spaces     ensure_default_space, list_spaces, get_space(id|slug),
               create_space, update_space, delete_space
    Pages      create_page(space_id?, title?, parent_page_id?, content?, ...),
               get_page(id|slug_id), children(space_id|parent_page_id, cursor),
               all_pages, update_page (title/icon/cover/lock),
               set_content(ref, prosemirror_json)  <- agents write here,
               trash_page, restore_page, delete_page, trash, move_page,
               move_to_space, duplicate_page, breadcrumbs, recent
    History    snapshot_page, history, history_entry
    Search     search(query, space_id?, title_only?) (diacritic-insensitive),
               search_attachments
    Favorites  add_favorite, remove_favorite, favorite_ids, list_favorites
    Files      save_attachment, get_attachment, read_attachment,
               page_attachments, remove_icon
    Settings   get_settings, update_settings
    Realtime   load_ydoc, persist_ydoc (used by app_server.khaidocs.collab)

``core.khaidocs.pm_yjs``  ProseMirror JSON <-> Yjs (y-prosemirror encoding)
``core.khaidocs.text``    fold() search normalisation, plain_text(), ids
``core.khaidocs.fractional``  sibling-order keys
``core.khaidocs.errors``  NotFound / Invalid / TooLarge / Conflict (HTTP-mapped)

Content model: ``kd_pages.ydoc`` is the truth for a page open in the editor;
``content`` (ProseMirror JSON) and ``text_content`` are derived from it on
every persist. Writers that are not the editor (agents, import) call
``set_content``, which edits the Yjs document, so the change merges with
concurrent typing instead of overwriting it.
"""

from core.khaidocs.errors import Conflict, Invalid, KhaiDocsError, NotFound, TooLarge
from core.khaidocs.store import KhaiDocsStore

__all__ = [
    "Conflict", "Invalid", "KhaiDocsError", "KhaiDocsStore", "NotFound", "TooLarge",
]
