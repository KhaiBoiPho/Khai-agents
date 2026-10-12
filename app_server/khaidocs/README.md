# KhaiDocs native backend (phase 1)

Native Python backend for the vendored client in
`desktop/src/features/khaidocs`. Written from the API contract the client
uses (its call sites and types), not from any server source.

* Identity: only the Khai session (`ctx.authenticate`). KhaiDocs has no login,
  signup, reset, invite, setup, MFA, SSO, session, API-key or token
  endpoints; none exist on the server and the client routes to them are
  removed (they redirect home). The `/collab` token the client still passes is
  ignored.
* Storage: `core/persistence/schema/0007_khaidocs.sql`, tenant-scoped by RLS.
  Files are bytea in Postgres (limit `KHAIDOCS_MAX_UPLOAD_MB`, default 50).
* Wire format: see `api.py` (envelope `{data, success, status}`, errors
  `{message, error, statusCode}`, lists `{items, meta}`). File uploads
  (`files/upload`, `attachments/upload-image`) answer the bare attachment JSON.
* Realtime: `/collab` (collab.py, Hocuspocus 4.x protocol), `/socket.io/`
  (socketio.py, Engine.IO v4 websocket transport only, as the client requests).
* One gateway process is assumed (live Yjs documents are in memory).

## Endpoint coverage (everything the client calls)

I = implemented (store-backed), R = read-only view of the Khai account,
S = stub (empty/disabled, returns what the UI needs to render),
N = 501 "not available yet" (phase 2), X = does not exist (removed).

| Area | Endpoints | |
|---|---|---|
| pages | create, info, update, delete (trash or permanent), restore, remove, move, move-to-space, duplicate, breadcrumbs, sidebar-pages, recent, created-by-user, trash, history, history/info, attachments | I |
| pages | backlinks-count, backlinks | S (0 / empty; kd_backlinks ready) |
| pages | watch, unwatch, watch-status, labels, labels/add, labels/remove, transclusion/* | S / N (phase 2) |
| pages | export, import, import-zip, docx-export | N (phase 2) |
| spaces | list, info, create, update, delete | I |
| spaces | members | R (the owner), members/add\|remove\|change-role -> 400 |
| spaces | watch, unwatch, watch-status, watched-ids | S; export N |
| favorites | add, remove, ids, list | I |
| search | search, search/suggest, search-attachments | I (diacritic-insensitive) |
| search | share-search, public-space-search | S (disabled) |
| files | files/upload, files/info, GET files/{id}/{name}, attachments/upload-image, remove-icon, GET attachments/img/{type}/{name} | I |
| users / workspace | users/me, users/update (preferences only), workspace/info, workspace/public, workspace/update (name/description), version, health | R / I |
| workspace | members | R; members/*, invites/*, create -> 400/404 | S |
| groups, shares, public-spaces | all | S (empty lists / disabled; workspace reports sharing and public spaces off) |
| comments | list, create, update, resolve, delete, info | S / N (phase 2; kd_comments ready) |
| labels | labels, labels/info, labels/pages | S (phase 2) |
| notifications | list, unread-count, mark-read, mark-all-read | S (phase 2) |
| file-tasks | list, info | S / N (phase 2) |
| bases | create, export-csv | S (disabled; the client has no Base UI) |
| auth/\*, sessions/\*, API keys, MFA, SSO, invitations accept | | X |

Socket.IO events the client listens for (`message`: invalidate, updateOne,
addTreeNode, moveTreeNode, deleteTreeNode, refetchRootTreeNodeEvent,
comment*): the server relays the client's own `message` events to the same
user's other tabs and `call.publish()` can emit them from REST handlers.

Not used: `bases` tables, SCIM/billing/audit/AI, verification, personal
spaces, templates API (the client keeps templates in localStorage; kd_templates
is ready for phase 2).
