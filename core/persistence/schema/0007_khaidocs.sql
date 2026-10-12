-- KhaiDocs: the wiki the desktop and web client show in the "KhaiDocs" tab,
-- served natively by Khai (core/khaidocs, app_server/khaidocs) instead of a
-- separate wiki container.
--
-- One schema for every KhaiDocs feature, so the later modules (comments,
-- labels, notifications, import/export, templates, agent tools, search for
-- agents) need no migration of their own. Phase 1 (pages, spaces, history,
-- favorites, attachments, search, realtime) uses kd_spaces, kd_pages,
-- kd_page_history, kd_favorites, kd_attachments, kd_attachment_blobs,
-- kd_user_settings; the rest is created here, empty, for those modules.
--
-- Identity: a KhaiDocs row belongs to a Khai user (user_id, filled from the
-- session like every other table). There are no KhaiDocs users, groups,
-- members, sessions or tokens: a space is private to its owner.
--
-- Tenancy: every table has ENABLE + FORCE ROW LEVEL SECURITY with the
-- tenant_isolation policy, and every child references its parent through
-- (user_id, id) so a row can never point into another user's data.
--
-- Search: to_tsvector('simple', ...) over title_norm / text_norm, which the
-- application fills with the diacritic-free lowercase form (core/khaidocs
-- search.fold: NFD without combining marks, d-stroke to d), so
-- "tiếng việt" and "tieng viet" meet. Done in the application rather than
-- with the unaccent extension, which needs a schema per search_path and a
-- privileged CREATE EXTENSION.
--
-- Page text and Yjs state: pages.ydoc is the document's merged Yjs update
-- (what the realtime server loads); pages.content / text_content are
-- derived from it on every persist, so reads and search never decode Yjs.
-- A page has content from either side: ydoc NULL means "never opened in the
-- editor", and the realtime server then builds the Yjs doc from content.

-- ---------------------------------------------------------------------------
-- Spaces

CREATE TABLE kd_spaces (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    slug text NOT NULL CHECK (slug ~ '^[a-zA-Z0-9]{2,100}$'),
    description text,
    icon text,
    visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'open')),
    default_role text NOT NULL DEFAULT 'writer',
    -- The user's own "Private" space, created on first access and never
    -- deletable; at most one per user.
    is_default boolean NOT NULL DEFAULT false,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    PRIMARY KEY (id),
    UNIQUE (user_id, id),
    UNIQUE (user_id, slug)
);
CREATE UNIQUE INDEX kd_spaces_one_default ON kd_spaces (user_id) WHERE is_default;

-- ---------------------------------------------------------------------------
-- Pages

CREATE TABLE kd_pages (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    -- The short id in page URLs (/s/<space>/p/<title>-<slug_id>).
    slug_id text NOT NULL CHECK (slug_id ~ '^[a-zA-Z0-9]{6,32}$'),
    space_id uuid NOT NULL,
    parent_page_id uuid,
    -- Fractional index among siblings; compared bytewise (COLLATE "C").
    position text COLLATE "C",
    title text,
    icon text,
    cover_photo text,
    content jsonb,
    text_content text NOT NULL DEFAULT '',
    ydoc bytea,
    -- Bumped whenever content changes; page_history rows carry the version
    -- they snapshot.
    version bigint NOT NULL DEFAULT 0,
    is_locked boolean NOT NULL DEFAULT false,
    -- Who made the last change: 'user' (editor / UI) or 'agent' (tools).
    updated_by text NOT NULL DEFAULT 'user' CHECK (updated_by IN ('user', 'agent', 'import')),
    title_norm text NOT NULL DEFAULT '',
    text_norm text NOT NULL DEFAULT '',
    tsv tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', title_norm), 'A')
        || to_tsvector('simple', text_norm)
    ) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Trash: the page and, with it, every descendant (deleted_root_id names
    -- the page the user actually deleted, so restore brings back the subtree
    -- and nothing deleted earlier).
    deleted_at timestamptz,
    deleted_root_id uuid,
    PRIMARY KEY (id),
    UNIQUE (user_id, id),
    UNIQUE (user_id, slug_id),
    FOREIGN KEY (user_id, space_id) REFERENCES kd_spaces (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, parent_page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE,
    CHECK (parent_page_id IS NULL OR parent_page_id <> id)
);
CREATE INDEX kd_pages_tree ON kd_pages (user_id, space_id, parent_page_id, position)
    WHERE deleted_at IS NULL;
CREATE INDEX kd_pages_recent ON kd_pages (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX kd_pages_trash ON kd_pages (user_id, space_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;
CREATE INDEX kd_pages_tsv ON kd_pages USING GIN (tsv);

-- Snapshots of a page taken while it is edited (a capped number per page,
-- trimmed by the application).
CREATE TABLE kd_page_history (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    page_id uuid NOT NULL,
    title text,
    icon text,
    cover_photo text,
    content jsonb,
    text_content text NOT NULL DEFAULT '',
    version bigint NOT NULL DEFAULT 0,
    created_by text NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'agent', 'import')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE
);
CREATE INDEX kd_page_history_page ON kd_page_history (user_id, page_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Favorites, labels, watches, backlinks

CREATE TABLE kd_favorites (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('page', 'space', 'template')),
    page_id uuid,
    space_id uuid,
    template_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, space_id) REFERENCES kd_spaces (user_id, id) ON DELETE CASCADE,
    CHECK (
        (type = 'page' AND page_id IS NOT NULL AND space_id IS NULL AND template_id IS NULL) OR
        (type = 'space' AND space_id IS NOT NULL AND page_id IS NULL AND template_id IS NULL) OR
        (type = 'template' AND template_id IS NOT NULL AND page_id IS NULL AND space_id IS NULL)
    )
);
CREATE UNIQUE INDEX kd_favorites_page ON kd_favorites (user_id, page_id) WHERE type = 'page';
CREATE UNIQUE INDEX kd_favorites_space ON kd_favorites (user_id, space_id) WHERE type = 'space';
CREATE UNIQUE INDEX kd_favorites_template ON kd_favorites (user_id, template_id) WHERE type = 'template';

CREATE TABLE kd_labels (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    type text NOT NULL DEFAULT 'page' CHECK (type IN ('page', 'space')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (user_id, id),
    UNIQUE (user_id, type, name)
);

CREATE TABLE kd_page_labels (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    page_id uuid NOT NULL,
    label_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, page_id, label_id),
    FOREIGN KEY (user_id, page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, label_id) REFERENCES kd_labels (user_id, id) ON DELETE CASCADE
);
CREATE INDEX kd_page_labels_label ON kd_page_labels (user_id, label_id);

CREATE TABLE kd_space_labels (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    space_id uuid NOT NULL,
    label_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, space_id, label_id),
    FOREIGN KEY (user_id, space_id) REFERENCES kd_spaces (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, label_id) REFERENCES kd_labels (user_id, id) ON DELETE CASCADE
);

-- "Watch" a page or space: notify on its changes (notifications module).
CREATE TABLE kd_watches (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    page_id uuid,
    space_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id, page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, space_id) REFERENCES kd_spaces (user_id, id) ON DELETE CASCADE,
    CHECK ((page_id IS NULL) <> (space_id IS NULL))
);
CREATE UNIQUE INDEX kd_watches_page ON kd_watches (user_id, page_id) WHERE page_id IS NOT NULL;
CREATE UNIQUE INDEX kd_watches_space ON kd_watches (user_id, space_id) WHERE space_id IS NOT NULL;

-- Page-to-page links found in page content (backlinks count and list).
CREATE TABLE kd_backlinks (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    source_page_id uuid NOT NULL,
    target_page_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source_page_id, target_page_id),
    FOREIGN KEY (user_id, source_page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, target_page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE
);
CREATE INDEX kd_backlinks_target ON kd_backlinks (user_id, target_page_id);

-- ---------------------------------------------------------------------------
-- Comments

CREATE TABLE kd_comments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    page_id uuid NOT NULL,
    parent_comment_id uuid,
    -- The comment body (ProseMirror JSON as text, as the client sends it) and
    -- the text of the page selection it is anchored to.
    content text NOT NULL DEFAULT '',
    selection text,
    type text,
    yjs_selection jsonb,
    -- 'user' or 'agent'.
    author text NOT NULL DEFAULT 'user' CHECK (author IN ('user', 'agent')),
    resolved_at timestamptz,
    edited_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, parent_comment_id) REFERENCES kd_comments (user_id, id) ON DELETE CASCADE
);
CREATE INDEX kd_comments_page ON kd_comments (user_id, page_id, created_at);

-- ---------------------------------------------------------------------------
-- Notifications

CREATE TABLE kd_notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL,
    -- Who caused it: 'user', 'agent' or a display name.
    actor text,
    page_id uuid,
    space_id uuid,
    comment_id uuid,
    data jsonb,
    read_at timestamptz,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id, page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, space_id) REFERENCES kd_spaces (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, comment_id) REFERENCES kd_comments (user_id, id) ON DELETE CASCADE
);
CREATE INDEX kd_notifications_inbox ON kd_notifications (user_id, created_at DESC)
    WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Attachments: metadata here, bytes in kd_attachment_blobs (one transaction,
-- covered by the database's own backup and row-level security).

CREATE TABLE kd_attachments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    file_name text NOT NULL,
    file_path text NOT NULL DEFAULT '',
    file_size bigint NOT NULL CHECK (file_size >= 0),
    file_ext text NOT NULL DEFAULT '',
    mime_type text NOT NULL DEFAULT 'application/octet-stream',
    -- file | avatar | space-icon | workspace-icon
    type text NOT NULL DEFAULT 'file',
    page_id uuid,
    space_id uuid,
    -- Extracted text, for attachment search (import/RAG modules fill it).
    text_content text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    PRIMARY KEY (id),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, page_id) REFERENCES kd_pages (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, space_id) REFERENCES kd_spaces (user_id, id) ON DELETE CASCADE
);
CREATE INDEX kd_attachments_page ON kd_attachments (user_id, page_id) WHERE deleted_at IS NULL;

CREATE TABLE kd_attachment_blobs (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    attachment_id uuid NOT NULL,
    data bytea NOT NULL,
    PRIMARY KEY (user_id, attachment_id),
    FOREIGN KEY (user_id, attachment_id) REFERENCES kd_attachments (user_id, id) ON DELETE CASCADE
);
ALTER TABLE kd_attachment_blobs ALTER COLUMN data SET STORAGE EXTERNAL;

-- ---------------------------------------------------------------------------
-- Templates, file tasks, settings

CREATE TABLE kd_templates (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL DEFAULT '',
    description text,
    icon text,
    content jsonb,
    markdown text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (user_id, id)
);

-- Import / export jobs; the produced or uploaded file lives in data.
CREATE TABLE kd_file_tasks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('import', 'export')),
    source text,
    status text NOT NULL DEFAULT 'pending',
    file_name text NOT NULL DEFAULT '',
    file_ext text NOT NULL DEFAULT '',
    file_size bigint NOT NULL DEFAULT 0,
    options jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_message text,
    data bytea,
    space_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    PRIMARY KEY (id),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, space_id) REFERENCES kd_spaces (user_id, id) ON DELETE CASCADE
);

-- Per-user KhaiDocs preferences ({preferences, notifications} as the client
-- keeps them) and the workspace-level settings the UI shows.
CREATE TABLE kd_user_settings (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    workspace jsonb NOT NULL DEFAULT '{}'::jsonb,
    locale text,
    timezone text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id)
);

-- ---------------------------------------------------------------------------
-- Row-level security and grants

DO $$
DECLARE
    name text;
BEGIN
    FOREACH name IN ARRAY ARRAY[
        'kd_spaces', 'kd_pages', 'kd_page_history', 'kd_favorites', 'kd_labels',
        'kd_page_labels', 'kd_space_labels', 'kd_watches', 'kd_backlinks',
        'kd_comments', 'kd_notifications', 'kd_attachments',
        'kd_attachment_blobs', 'kd_templates', 'kd_file_tasks',
        'kd_user_settings'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I '
            'USING (app_is_system() OR user_id = app_user_id()) '
            'WITH CHECK (app_is_system() OR user_id = app_user_id())',
            name
        );
        -- A user's worker (agent tools) reads and writes its user's rows.
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO khai_worker', name
        );
    END LOOP;
END
$$;
