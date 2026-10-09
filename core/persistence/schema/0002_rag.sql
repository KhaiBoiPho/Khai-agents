-- Document index (core/rag/pgstore.py): metadata and chunk text here, vectors
-- in Qdrant. Rows are per user like everything else; the Qdrant points carry
-- the same user_id and every search filters on it.

CREATE TABLE rag_documents (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    workspace text NOT NULL,
    path text NOT NULL,
    size bigint NOT NULL,
    mtime_ns bigint NOT NULL,
    sha256 text NOT NULL,
    status text NOT NULL,
    error text,
    chunk_count integer NOT NULL DEFAULT 0,
    model text,
    indexed_at double precision,
    PRIMARY KEY (user_id, workspace, path)
);

CREATE TABLE rag_chunks (
    user_id uuid NOT NULL DEFAULT app_user_id(),
    workspace text NOT NULL,
    path text NOT NULL,
    ordinal integer NOT NULL,
    locator text NOT NULL,
    heading text NOT NULL,
    text text NOT NULL,
    dims integer NOT NULL,
    point_id uuid NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(heading, '')), 'A')
        || to_tsvector('simple', text)
    ) STORED,
    PRIMARY KEY (user_id, workspace, path, ordinal),
    FOREIGN KEY (user_id, workspace, path)
        REFERENCES rag_documents (user_id, workspace, path) ON DELETE CASCADE
);
CREATE INDEX rag_chunks_tsv ON rag_chunks USING GIN (tsv);
CREATE UNIQUE INDEX rag_chunks_point ON rag_chunks (point_id);

DO $$
DECLARE
    name text;
BEGIN
    FOREACH name IN ARRAY ARRAY['rag_documents', 'rag_chunks'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I '
            'USING (app_is_system() OR user_id = app_user_id()) '
            'WITH CHECK (app_is_system() OR user_id = app_user_id())',
            name
        );
    END LOOP;
END
$$;
