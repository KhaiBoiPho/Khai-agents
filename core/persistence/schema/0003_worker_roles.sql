-- Per-user database roles for the hosted deployment.
--
-- Each user's backend runs in that user's own container and connects as a
-- role of its own, u_<user id hex>, which is a member of khai_worker. For
-- those roles the tenant comes from the role name itself (current_user), not
-- from the settable app.user_id: a user who reads the credentials out of
-- their container still sees only their own rows, and can never reach system
-- scope. app.user_id and app.system keep working only for the gateway's own
-- role (khai), which never runs user code. Any role named u_* is treated
-- as a worker, so no other role may use that prefix.
--
-- The gateway creates and drops u_* roles (core/auth/provisioning.py); the
-- application role therefore holds CREATEROLE, which on PostgreSQL 16+ only
-- reaches roles it created itself.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khai_worker') THEN
        CREATE ROLE khai_worker NOLOGIN;
    END IF;
END
$$;

CREATE FUNCTION app_role_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN current_user ~ '^u_[0-9a-f]{32}$' THEN substr(current_user, 3)::uuid
    END
$$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN current_user ~ '^u_' THEN app_role_user_id()
        ELSE nullif(current_setting('app.user_id', true), '')::uuid
    END
$$;

CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT current_user !~ '^u_'
        AND coalesce(current_setting('app.system', true), '') = 'on'
$$;

DO $$
DECLARE
    name text;
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO khai_worker', current_schema());
    -- A worker reads and writes its user's rows (row-level security does the
    -- rest), reads its own account row, and may read the schema version.
    FOREACH name IN ARRAY ARRAY[
        'projects', 'threads', 'turns', 'items', 'approvals', 'approval_grants',
        'workflow_runs', 'artifacts', 'event_log', 'legacy_imports',
        'usage_records', 'automations', 'automation_revisions',
        'automation_occurrences', 'automation_runs', 'runtime_workers',
        'resource_leases', 'rag_documents', 'rag_chunks'
    ] LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO khai_worker', name
        );
    END LOOP;
END
$$;

GRANT SELECT (id, username, display_name, role, status, can_execute, created_at)
    ON users TO khai_worker;
GRANT SELECT ON schema_migrations TO khai_worker;
GRANT EXECUTE ON FUNCTION app_user_id(), app_is_system(), app_role_user_id(),
    app_utc_now_text() TO khai_worker;
