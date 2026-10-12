# KhaiDocs

KhaiDocs is the wiki inside Khai, under the **KhaiDocs** sidebar entry. Its
browser client is derived from an AGPL-3.0 open-source wiki client (see
`LICENSE`, `UPSTREAM_COMMIT` and `THIRD_PARTY_NOTICES.md`); its server is Khai's own, written in Python: `core/khaidocs`
(storage, importers/exporters, Yjs) and `app_server/khaidocs` (REST under
`/api`, Hocuspocus-compatible `/collab`, `/socket.io`). Pages live in the
user's own `kd_*` tables in Khai's PostgreSQL database. There is no upstream
server, and KhaiDocs has no login of its own: the signed-in Khai account is
the only identity. See `app_server/khaidocs/README.md` and `INTERFACE.md`.

## What is here

| Path | What | License |
|---|---|---|
| `client/` | The upstream web client (`apps/client/src`), core only | AGPL-3.0 (see `LICENSE`) |
| `editor-ext/` | The upstream editor extensions (`packages/editor-ext/src`) | AGPL-3.0 |
| `client/ee/` | Original stand-ins for the imports of the upstream's enterprise tier — **not** that code | MIT |
| `KhaiDocsApp.tsx`, `mantine.css`, `khaidocs-baseline.css`, `notion/theme.ts`, `notion/host-scheme.ts` | The host side: providers, scoped Mantine styles. No palette of its own: colours, fonts, radii and shadows come from the host tokens (`src/styles/tokens.css`), so every host theme applies live | MIT |
| `templates/` | KhaiDocs page templates: built-in Markdown templates, gallery, "Save as template" — **not** the upstream enterprise template feature | MIT |
| `client/lib/khaidocs-mode.ts`, `client/components/khaidocs/` | Single-user mode flag and default-space helpers | MIT |
| `notion/` | The Notion-style look: sidebar, home, page cover/icon, line-icon set and picker, folders | MIT |

Upstream commit: see `UPSTREAM_COMMIT` (0.96.0). The upstream Enterprise
Edition (`packages/ee`, `apps/client/src/ee`) is under a separate commercial
licence and is deliberately not included; every Enterprise feature
reports as unavailable.

**Licensing note.** Distributing the desktop app with this folder makes the
distributed work subject to the AGPL-3.0, including its source-offer terms.

## Running it

The Khai gateway (hosted) and the single-user service (`python -m
app_server.service`) both serve the KhaiDocs backend directly, behind the Khai
session; the built web client (`npm run build:web`) talks to it on its own
origin. For development:

1. Start Khai's server (gateway or service) and sign in to it in this browser.
2. `npm run dev` in `desktop/` — Vite proxies `/api`, `/socket.io` and
   `/collab` to it (`KHAIDOCS_SERVER_URL`, default `http://localhost:8080`;
   the service listens on 3081 by default).
3. Open **KhaiDocs** in the sidebar.

## Language

English (`en-US`) and Vietnamese (`vi-VN`) only, from
`public/khaidocs/locales/<lng>/translation.json`. KhaiDocs follows Khai's
interface language (`KhaiDocsApp.tsx`); the language picker in KhaiDocs'
account preferences changes Khai's language too. English strings are the
keys, so a missing Vietnamese key falls back to English.

Type-check with `npm run typecheck:khaidocs` (TypeScript 5.9, loose settings); the app's own `tsc` sees only `src/khaidocs-app.d.ts`.

## Modifications to the client (2026-10-06)

Made so the client runs embedded instead of owning the whole page:

- `main.tsx` — no longer renders into `#root`; keeps only the shared
  `queryClient` (providers moved to `KhaiDocsApp.tsx`).
- `i18n.ts` — a private i18next instance, without `initReactI18next`, loading
  locales from `/khaidocs/locales`; dropped `showSupportNotice` (not in i18next 26).
- `theme.ts` — Mantine portals target `.khaidocs-root`.
- `lib/config.ts` — app name "KhaiDocs"; config from the build
  (`__KHAIDOCS_CONFIG__`); collaboration on the same origin.
- `lib/khaidocs-navigation.ts` (new) — routes hard navigations through the
  in-memory router.
- `lib/api-client.ts`, `lib/app-route.ts`, `features/auth/hooks/use-auth.ts`,
  `features/editor/title-editor.tsx`, `features/editor/readonly-page-editor.tsx`,
  `features/editor/hooks/use-editor-scroll.ts` — `window.location` reads and
  redirects go through `khaidocs-navigation`.
- `features/editor/styles/core.css`, `features/editor/styles/editor.module.css`,
  `features/page-history/components/css/history-mobile.module.css`,
  `features/page-history/components/history-modal.tsx`,
  `features/editor/components/drawio/drawio-menu.tsx`,
  `features/editor/components/drawio/drawio-view.tsx`,
  `features/notification/components/notification-popover.tsx` — viewport units
  (`vh`/`dvh`/`vw`) replaced with container units of the KhaiDocs area.
- `features/auth/components/auth-layout.tsx`,
  `components/layouts/global/app-header.tsx` — icon paths under `/khaidocs/`.
- `features/editor/components/embed/embed-view.tsx` — uses the private i18n
  instance.
- `components/ui/document-title.test.tsx` — expects the "KhaiDocs" name.

### Single-user mode and templates (2026-10-06)

KhaiDocs is used by one person, so `SINGLE_USER` in
`client/lib/khaidocs-mode.ts` (new, MIT) hides everything about other people
and choosing between spaces. Nothing is deleted on the server. The oldest
space is the "default space"; `/home` lands on it, and the hidden routes
(`/spaces`, `/settings/members`, `/settings/groups[/:id]`, `/settings/spaces`,
`/settings/sharing`) redirect there. `client/components/khaidocs/default-space.tsx`
(new, MIT) holds `useDefaultSpace` and the redirect.

Templates are original KhaiDocs code in `templates/` (MIT): eight built-in
Markdown templates (`templates/builtin/*.md`, listed in `manifest.ts`), a
gallery (search, categories, preview), "New page from template" through the
core Markdown import (`POST /api/pages/import`), and "Save as template" from a
page's menu, kept in localStorage under "My templates". an enterprise tier's
template code is not used; its stand-ins in `client/ee/template/` are no
longer routed to.

Changed the client files (each change marked `KhaiDocs:`):

- `App.tsx` — `/home` redirects to the default space; the hidden routes
  above redirect; `/templates` is the KhaiDocs gallery page and
  `/templates/:id` goes back to it.
- `components/layouts/global/global-app-shell.tsx` — the default space's
  sidebar is shown on every non-settings route (the global sidebar remains
  only while no space exists).
- `components/layouts/global/global-sidebar.tsx` — no "Spaces", "Favorite
  spaces" or "Invite People"; "Templates" opens the KhaiDocs gallery.
- `components/layouts/global/top-menu.tsx` — no "Manage members".
- `components/settings/settings-sidebar.tsx` — no Members, Groups, Spaces,
  Public sharing or Billing, and no greyed-out Enterprise entries.
- `pages/settings/workspace/workspace-settings.tsx` — drops the dividers of
  the (empty) member-templates and personal-spaces settings.
- `features/space/components/sidebar/space-sidebar.tsx` — falls back to the
  default space outside `/s/…`; space name instead of the space switcher;
  "Favorites" and "Templates" entries; space menu without favorite/watch and
  with "New from template" instead of the Enterprise template picker.
- `features/space/components/settings-modal.tsx` — only the space's own
  Settings tab (no Members, Publish or Security/sharing tabs).
- `features/page/components/header/page-header-menu.tsx` — no Share button or
  "Watch page"; adds "Save as template".


### Notion-style look, line icons, covers and folders (2026-10-06)

Original KhaiDocs code in `notion/` (MIT):

- **Page icons.** `pages.icon` is a free string on the server, so besides
  emoji it stores line icons from a curated set of ~150 Tabler icons
  (`@tabler/icons-react`, MIT) as `ti:<name>:<colour>` — e.g.
  `ti:notebook:blue`; colours are Notion's palette (`default`, `gray`,
  `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`).
  `page-icon-codec.ts` parses/encodes them, `icon-set.ts` is the set,
  `PageIcon.tsx` renders either kind, `IconPicker.tsx` is the picker
  ("Icons" tab — search, colours, grid — next to the client's emoji picker).
  The built-in templates use these icons.
- **Folders.** A folder is a page whose icon is `ti:folder:<colour>`; it nests
  pages through the upstream parent/child pages. Folders sort before pages
  on every level, open to a list of their contents (`FolderView.tsx`), and
  "Move to folder…" (`MoveToFolderModal.tsx`, `tree-actions.ts`) replaces
  the client's move-to-space in single-user mode. "Turn into folder/page" just
  changes the icon.
- **Covers** (`covers.ts`, `PageTop.tsx`). The cover choice is
  stored on this device (localStorage, `khaidocs:cover:<pageId>`): built-in
  CSS gradients/colours written for KhaiDocs, or an image uploaded as an
  attachment of the page.
- **Recents** (`recents.ts`): recently visited pages, on this device.
- **Sidebar / home / theme**: `Sidebar.tsx`, `SidebarTreeRow.tsx`,
  `SidebarOpener.tsx`, `Home.tsx`, `theme.ts`, `notion.css` and the CSS
  modules.

Changed the client files (each change marked `KhaiDocs:`):

- `theme.ts` — Notion-like neutral palette, text colour and font stack
  (`notion/theme.ts`).
- `components/layouts/global/global-app-shell.tsx` — no top header beside the
  single-user sidebar; a "»" button reopens a closed sidebar.
- `features/space/components/sidebar/space-sidebar.tsx` — renders
  `notion/Sidebar.tsx` in single-user mode.
- `features/page/tree/components/space-tree.tsx` — Notion-style rows, 28px
  row height, folders first.
- `features/page/tree/hooks/use-tree-mutation.ts` — moves are computed in the
  folders-first order; dropping onto a node loads its children first.
- `features/page/tree/components/space-tree-node-menu.tsx` — "…" menu: new
  page/folder inside, turn into folder/page, "Move to folder…".
- `features/page/tree/components/space-tree-row.tsx`,
  `components/common/page-list-icon.tsx`, `lib/utils.tsx` (`getPageIcon`),
  `pages/favorites/favorites-page.tsx`,
  `features/label/components/label-page-row.tsx`,
  `features/editor/components/subpages/subpages-view.tsx`,
  `features/editor/components/mention/mention-view.tsx`,
  `features/editor/components/mention/mention-list.tsx`,
  `features/editor/components/link/link-editor-panel.tsx`,
  `components/ui/destination-picker/destination-picker.tsx`,
  `components/ui/destination-picker/page-row.tsx`,
  `features/notification/components/notification-item.tsx`,
  `features/transclusion/components/sync-block-references-dropdown.tsx` —
  page icons through `PageIcon`.
- `features/page/components/breadcrumbs/breadcrumb.tsx`,
  `breadcrumb.module.css` — icon + name crumbs.
- `features/page/components/header/page-header-menu.tsx` — "Edited …" and a
  favorite star instead of the edit-mode switch; table of contents, "Move to
  folder…" and "Turn into folder/page" in the "…" menu.
- `pages/page/page.tsx` — cover band, folder view, Recents, text-only window
  title.
- `features/editor/full-editor.tsx` — ~720px text column, big icon and "Add
  icon / Add cover" above the title, no byline in single-user mode.
- `features/editor/title-editor.tsx` — no `getText()` on a destroyed title
  editor (threw when leaving a page right after renaming it).
- `pages/space/space-home.tsx` — the Notion-style home in single-user mode.

### KhaiDocs settings in the app's Settings window (2026-10-06)

- The sidebar's workspace menu is gone (`notion/WorkspaceBadge.tsx` shows the
  name only); workspace, profile and preferences open from Settings →
  KhaiDocs (`notion/SettingsPanel.tsx`, `KhaiDocsApp` `view="settings"`).
- `pages/settings/account/account-settings.tsx` — no login email, password,
  MFA or sessions in single-user mode.
- `pages/settings/account/account-preferences.tsx` — no theme picker in
  single-user mode; the theme follows the app.
- `features/page/queries/page-query.ts` — trashing or deleting a page removes
  it from Recents.
- `features/page/trash/components/deleted-page-banner.tsx` — "You", not
  "Someone", in single-user mode.
