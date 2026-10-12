# KhaiDocs native backend: interface for the next phases

Checkpoint document for agents building comments / labels / notifications /
import-export / templates (phase 2) and agent tools + RAG (phase 3). Phase 1
(this package's author) owns everything not listed under "yours".

## Schema (core/persistence/schema/0007_khaidocs.sql, already complete)

All tables are `kd_*`, have `user_id uuid NOT NULL DEFAULT app_user_id()`,
ENABLE + FORCE RLS (`tenant_isolation`), owner-composite FKs
`(user_id, x_id) -> (user_id, id)`, and are granted to `khai_worker`.
Do not add a migration for these features; if a column is truly missing,
tell the phase-1 owner.

| table | purpose | phase |
|---|---|---|
| kd_spaces | spaces (one default "Private" per user; `slug`, `icon`, `settings`) | 1 |
| kd_pages | pages: `slug_id`, `space_id`, `parent_page_id`, `position` (fractional, COLLATE "C"), `title/icon/cover_photo`, `content` jsonb (ProseMirror), `text_content`, `ydoc` bytea (Yjs state), `version`, `is_locked`, `updated_by` (user/agent/import), `title_norm/text_norm/tsv` (search), `deleted_at/deleted_root_id` (trash) | 1 |
| kd_page_history | snapshots (capped 100/page) | 1 |
| kd_favorites | `type` page/space/template + target id | 1 |
| kd_attachments / kd_attachment_blobs | metadata / bytes (bytea) | 1 |
| kd_user_settings | `settings`, `workspace` jsonb, `locale`, `timezone` | 1 |
| kd_comments | threaded (`parent_comment_id`), `content` text, `selection`, `yjs_selection`, `resolved_at`, `edited_at`, `deleted_at`, `author` user/agent | 2 yours |
| kd_labels, kd_page_labels, kd_space_labels | labels (`type` page/space; unique per name) | 2 yours |
| kd_notifications, kd_watches | inbox rows (`type`, `actor`, `data`, `read_at`, `archived_at`) / watched pages and spaces | 2 yours |
| kd_backlinks | page links (source, target) | 2 yours |
| kd_templates | `title, description, icon, content, markdown` | 2 yours |
| kd_file_tasks | import/export jobs (`type, status, options, data bytea, error_message`) | 2 yours |

Search columns: write `title_norm = fold(title)`, `text_norm = fold(text)`
(`core.khaidocs.text.fold`, length-preserving, diacritic-free lowercase); the
generated `tsv` follows.

## Python store (core/khaidocs, import `from core.khaidocs import KhaiDocsStore`)

`KhaiDocsStore(Database.for_user(user_id))` (a worker's own Database also
works). Synchronous; no user parameter. The full method list is the docstring of
`core/khaidocs/__init__.py`. For your modules:

* Pages: `get_page(id|slug_id)`, `create_page(...content=ProseMirror JSON...)`,
  `set_content(ref, json, updated_by="agent")` (the only way to change
  content outside the editor; merges with live editing), `search(query, ...)`,
  `all_pages`, `children`, `breadcrumbs`, `snapshot_page`.
* New tables: add your own repository module next to `store.py`
  (e.g. `core/khaidocs/comments.py` with `class CommentStore(database)`), using
  `database.transaction()` / `database.read()` exactly like `store.py`
  (`?` placeholders, `Jsonb(...)` for jsonb, dict rows, `str(uuid)`).
* ProseMirror <-> Yjs: `core.khaidocs.pm_yjs` (`json_to_update`,
  `update_to_json`, `replace_content`); text of a document: `text.plain_text`.
* Errors: raise `core.khaidocs.errors.NotFound/Invalid/TooLarge/Conflict`.

## HTTP (app_server/khaidocs)

* `api.py`: `Router`, `Call`, `ok`, `page_of`, `camelize`, `ApiError`.
  A route module is a file with a module-level `router = Router()`:

  ```python
  router = Router()

  @router.post("comments/create")          # mounted at /api/comments/create
  async def create(call: Call):
      row = await call.run(CommentStore(call.store.database).create, ...)
      call.publish({"operation": "commentCreated", "pageId": ..., "comment": ...})
      return camelize(row)                 # becomes {"data": ..., "success": true, "status": 200}
  ```

  `call.user` is the Khai account (`KhaiUser`: id, username, display_name,
  role); `call.store` the user's `KhaiDocsStore`; `call.body` the JSON body;
  `call.request` the aiohttp request (multipart uploads: stream
  `await call.request.multipart()` yourself, see `files.py`). Return a
  `web.StreamResponse`/`Raw` for non-enveloped responses (file downloads,
  uploads that the client reads raw).
* Registration: `routes.py` imports, if present, the modules
  `comments`, `labels`, `notifications`, `import_export`, `templates`,
  `agent_tools` (each exposing `router`) BEFORE `stubs.py`, so your routes
  replace the phase-1 stubs for the same path automatically (aiohttp
  matches the first registered route). Create the file and the endpoints
  exist; nothing else to edit. Remove the matching entries from `stubs.py`
  only to keep it tidy (optional).
* Endpoint list, shapes and which are stubs: `README.md`.
* Realtime: `call.publish(event)` pushes a Socket.IO `message` event (the
  union in `desktop/src/features/khaidocs/client/features/websocket/types`)
  to the user's other tabs. Page content edits go over `/collab` (Yjs);
  `set_content` changes reach open editors at the next persist (about 2 s).

## Yours vs. phase 1

Phase 1 keeps: migration 0007, `core/khaidocs/{store,pm_yjs,text,fractional}.py`,
`app_server/khaidocs/{api,context,routes,pages,spaces,files,search,workspace,stubs,collab,socketio}.py`,
gateway wiring, client auth removal. Anything else under
`core/khaidocs/` and `app_server/khaidocs/` with a new file name is yours.
