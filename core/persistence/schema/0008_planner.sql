-- Planner: the Calendar, Tasks, Schedule and Notes pages of the web client.
--
-- Each page keeps one JSON document per user (the shapes in
-- desktop/src/features/planner/*); the client normalizes what it reads, so the
-- server stores the document as-is. Until now these lived only in the
-- browser's localStorage, out of reach of the agent and lost with the browser.
--
-- version is bumped on every write; a writer passes the version it read and a
-- mismatch is a conflict, so the agent and an open tab never silently
-- overwrite each other.

CREATE TABLE planner_documents (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    key text NOT NULL CHECK (key IN ('tasks', 'calendar', 'schedule', 'notes')),
    value jsonb NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    -- Who made the last change: 'user' (a browser tab) or 'agent' (tools).
    updated_by text NOT NULL DEFAULT 'user' CHECK (updated_by IN ('user', 'agent')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);

ALTER TABLE planner_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE planner_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON planner_documents
    USING (app_is_system() OR user_id = app_user_id())
    WITH CHECK (app_is_system() OR user_id = app_user_id());
-- A user's worker (agent tools) reads and writes its user's documents.
GRANT SELECT, INSERT, UPDATE, DELETE ON planner_documents TO khai_worker;
