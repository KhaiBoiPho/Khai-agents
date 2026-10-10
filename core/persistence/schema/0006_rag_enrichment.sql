-- Index-time enrichment of the document index (core/rag/contextual.py,
-- core/rag/visual.py).
--
-- * rag_chunks.context: the short model-written context that situates a
--   chunk in its document (contextual retrieval). It is embedded with the
--   chunk and searched by the full-text half (weighted like the body, below
--   the heading), but search results still show the chunk's own text. The
--   generated tsvector is rebuilt to include it.
-- * rag_chunks.visual: the chunk is a vision-model transcription of a PDF
--   page (a figure, chart, table image or scanned page).
-- * rag_documents: per-document counters of that enrichment.
-- * rag_llm_cache: enrichment answers keyed by a hash of exactly what was
--   asked (model, prompt version, document/page/chunk content), so
--   re-indexing unchanged content never pays for the same call twice.

ALTER TABLE rag_documents
    ADD COLUMN visual_pages integer NOT NULL DEFAULT 0,
    ADD COLUMN visual_failed integer NOT NULL DEFAULT 0,
    ADD COLUMN contextualized integer NOT NULL DEFAULT 0;

ALTER TABLE rag_chunks
    ADD COLUMN context text NOT NULL DEFAULT '',
    ADD COLUMN visual boolean NOT NULL DEFAULT false;

DROP INDEX rag_chunks_tsv;
ALTER TABLE rag_chunks DROP COLUMN tsv;
ALTER TABLE rag_chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(heading, '')), 'A')
    || to_tsvector('simple', coalesce(context, ''))
    || to_tsvector('simple', text)
) STORED;
CREATE INDEX rag_chunks_tsv ON rag_chunks USING GIN (tsv);

CREATE TABLE rag_llm_cache (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    key text NOT NULL,
    model text NOT NULL,
    value text NOT NULL,
    created_at double precision NOT NULL,
    PRIMARY KEY (user_id, kind, key)
);

ALTER TABLE rag_llm_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_llm_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rag_llm_cache
    USING (app_is_system() OR user_id = app_user_id())
    WITH CHECK (app_is_system() OR user_id = app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON rag_llm_cache TO khai_worker;
