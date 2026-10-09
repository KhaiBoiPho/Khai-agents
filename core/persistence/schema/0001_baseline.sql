-- Khai-Agents application schema, baseline for PostgreSQL.
--
-- Tenancy: every user-owned row carries user_id, filled from the session
-- setting app.user_id (see core/persistence/database.py), and every such
-- table has FORCE ROW LEVEL SECURITY with one policy: a row is visible and
-- writable only when its user_id is the session's user, or when the session
-- runs in system scope (app.system = 'on', set only by server code for
-- cross-user work: sign-in, scheduling, execution coordination).
--
-- The application role (khai) owns these tables but is neither superuser nor
-- BYPASSRLS, so FORCE makes the policies bind it as well.
--
-- Timestamps are ISO-8601 UTC text written by core/persistence/serde.py, as
-- before; JSON documents are text holding JSON.

-- ---------------------------------------------------------------------------
-- Session scope helpers

CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT coalesce(current_setting('app.system', true), '') = 'on'
$$;

CREATE FUNCTION app_utc_now_text() RETURNS text
LANGUAGE sql VOLATILE AS $$
    SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE FUNCTION app_abort() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- 23000 integrity_constraint_violation: callers treat it like a failed
    -- constraint, as they did SQLite's RAISE(ABORT).
    RAISE EXCEPTION USING ERRCODE = '23000', MESSAGE = TG_ARGV[0];
END
$$;

-- ---------------------------------------------------------------------------
-- Users and sign-in

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE
        CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
    display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
    -- argon2id PHC string, set at registration.
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'member')),
    -- Self-registration creates 'pending'; only an admin's approval makes an
    -- account 'active', and only active accounts may sign in.
    status text NOT NULL CHECK (status IN ('pending', 'active', 'rejected', 'disabled')),
    can_execute boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    password_changed_at timestamptz,
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz
);
CREATE INDEX idx_users_pending ON users(created_at) WHERE status = 'pending';

-- One-time password-reset links an admin issues; only a SHA-256 digest of
-- the token is stored.
CREATE TABLE user_tokens (
    token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('password_reset')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);
CREATE INDEX idx_user_tokens_user ON user_tokens(user_id);

-- ---------------------------------------------------------------------------
-- Runtime coordination: each user's backend registers its own workers and
-- leases; another user's are invisible like any other row.

CREATE TABLE runtime_workers (
    id text NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    pid integer NOT NULL CHECK (pid > 0),
    surface text NOT NULL CHECK (length(trim(surface)) > 0),
    started_at text NOT NULL,
    heartbeat_at text NOT NULL,
    stopped_at text,
    CHECK (heartbeat_at >= started_at),
    CHECK (stopped_at IS NULL OR stopped_at >= heartbeat_at)
);
CREATE INDEX idx_runtime_workers_liveness ON runtime_workers(stopped_at, heartbeat_at);

-- ---------------------------------------------------------------------------
-- Projects and threads

CREATE TABLE projects (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    canonical_path text NOT NULL,
    display_name text NOT NULL,
    trust_state text NOT NULL CHECK (trust_state IN ('untrusted', 'trusted')),
    settings_json text NOT NULL DEFAULT '{}',
    created_at text NOT NULL,
    updated_at text NOT NULL,
    last_opened_at text NOT NULL,
    UNIQUE (user_id, canonical_path)
);

CREATE TABLE threads (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_thread_id text REFERENCES threads(id) ON DELETE SET NULL,
    title text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('code', 'paper', 'brief', 'review', 'goal')),
    status text NOT NULL CHECK (status IN ('idle', 'running', 'waiting', 'failed', 'archived')),
    model text,
    workspace_path text NOT NULL,
    worktree_path text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    archived_at text,
    connection_id text,
    reasoning_effort text,
    access_preset_override text CHECK (
        access_preset_override IS NULL OR
        access_preset_override IN ('ask', 'read_only', 'full_access')
    ),
    context_window integer CHECK (
        context_window IS NULL OR context_window BETWEEN 4096 AND 10000000
    ),
    CHECK (
        (status = 'archived' AND archived_at IS NOT NULL) OR
        (status <> 'archived' AND archived_at IS NULL)
    )
);
CREATE INDEX idx_threads_project_updated ON threads(project_id, updated_at DESC);
CREATE INDEX idx_threads_user_updated ON threads(user_id, updated_at DESC);

CREATE TABLE turns (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    ordinal integer NOT NULL CHECK (ordinal > 0),
    prompt text NOT NULL,
    status text NOT NULL CHECK (
        status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'interrupted')
    ),
    stop_reason text,
    error_code text,
    error_message text,
    started_at text,
    completed_at text,
    skill_ids_json text NOT NULL DEFAULT '[]',
    execution_profile_json text,
    goal_id text,
    goal_definition_revision integer,
    goal_attempt_id text,
    enqueued_at text NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    execution_class text NOT NULL DEFAULT 'interactive' CHECK (execution_class IN (
        'interactive', 'manual_automation', 'goal_continuation',
        'event_automation', 'scheduled_automation', 'backfill'
    )),
    home_worker_id text REFERENCES runtime_workers(id) ON DELETE RESTRICT,
    execution_owner_id text REFERENCES runtime_workers(id) ON DELETE RESTRICT,
    execution_epoch integer NOT NULL DEFAULT 0 CHECK (execution_epoch >= 0),
    cancel_requested_at text,
    executor text NOT NULL DEFAULT 'agent' CHECK (executor IN ('agent', 'workflow')),
    execution_permission_mode text CHECK (
        execution_permission_mode IS NULL OR
        execution_permission_mode IN ('default', 'plan', 'full_auto')
    ),
    execution_security_profile_json text CHECK (
        execution_security_profile_json IS NULL OR
        length(trim(execution_security_profile_json)) > 0
    ),
    UNIQUE (thread_id, ordinal),
    UNIQUE (id, thread_id),
    CHECK (
        (status IN ('completed', 'failed', 'interrupted') AND completed_at IS NOT NULL) OR
        (status NOT IN ('completed', 'failed', 'interrupted') AND completed_at IS NULL)
    ),
    CHECK (
        (status = 'failed' AND error_code IS NOT NULL) OR
        (status <> 'failed' AND error_code IS NULL AND error_message IS NULL)
    ),
    CHECK (
        execution_owner_id IS NULL OR (
            execution_epoch >= 1 AND
            status NOT IN ('completed', 'failed', 'interrupted')
        )
    )
);
CREATE UNIQUE INDEX idx_turns_execution_fence ON turns(id, execution_epoch);
CREATE INDEX idx_turns_thread ON turns(thread_id, ordinal);
CREATE INDEX idx_turns_coordination_queue ON turns(
    status, home_worker_id, execution_owner_id, enqueued_at, thread_id, ordinal, id
);
CREATE INDEX idx_turns_executor_queue ON turns(
    executor, status, home_worker_id, execution_owner_id, enqueued_at, thread_id, ordinal, id
);
CREATE INDEX idx_turns_execution_owner ON turns(execution_owner_id, status)
    WHERE execution_owner_id IS NOT NULL;
CREATE UNIQUE INDEX idx_turns_goal_attempt ON turns(goal_attempt_id)
    WHERE goal_attempt_id IS NOT NULL;

CREATE FUNCTION turns_initialize_enqueued_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.enqueued_at = '1970-01-01T00:00:00Z' THEN
        NEW.enqueued_at := app_utc_now_text();
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER initialize_turn_enqueued_at BEFORE INSERT ON turns
    FOR EACH ROW EXECUTE FUNCTION turns_initialize_enqueued_at();

CREATE TABLE items (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    turn_id text NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal > 0),
    kind text NOT NULL CHECK (kind IN (
        'user_message', 'assistant_message', 'reasoning_summary', 'plan',
        'tool_call', 'command_execution', 'file_change', 'diff', 'test_result',
        'approval_request', 'workflow_stage', 'artifact', 'error', 'completion'
    )),
    status text NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'declined')),
    summary text NOT NULL,
    payload_json text NOT NULL DEFAULT '{}',
    created_at text NOT NULL,
    updated_at text NOT NULL,
    UNIQUE (turn_id, ordinal),
    UNIQUE (id, thread_id, turn_id),
    FOREIGN KEY (turn_id, thread_id) REFERENCES turns(id, thread_id) ON DELETE CASCADE
);
CREATE INDEX idx_items_thread ON items(thread_id, created_at, ordinal);
-- items.find_user_message looks messages up by payload messageId.
CREATE INDEX idx_items_user_message ON items(thread_id, ((payload_json::jsonb ->> 'messageId')))
    WHERE kind = 'user_message';

CREATE TABLE approvals (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    turn_id text NOT NULL,
    item_id text NOT NULL,
    category text NOT NULL CHECK (category IN ('command', 'file_write', 'network', 'external_tool', 'destructive')),
    status text NOT NULL CHECK (status IN ('pending', 'approved_once', 'approved_session', 'denied', 'cancelled', 'expired')),
    request_json text NOT NULL,
    decision_json text,
    requested_at text NOT NULL,
    resolved_at text,
    UNIQUE (id, thread_id),
    FOREIGN KEY (turn_id, thread_id) REFERENCES turns(id, thread_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, thread_id, turn_id)
        REFERENCES items(id, thread_id, turn_id) ON DELETE CASCADE,
    CHECK (
        (status = 'pending' AND decision_json IS NULL AND resolved_at IS NULL) OR
        (status <> 'pending' AND decision_json IS NOT NULL AND resolved_at IS NOT NULL)
    )
);
CREATE INDEX idx_approvals_pending ON approvals(thread_id, status);

CREATE TABLE approval_grants (
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    tool_name text NOT NULL CHECK (length(trim(tool_name)) > 0),
    source_approval_id text NOT NULL UNIQUE,
    granted_at text NOT NULL,
    PRIMARY KEY (thread_id, tool_name),
    FOREIGN KEY (source_approval_id, thread_id)
        REFERENCES approvals(id, thread_id) ON DELETE CASCADE
);

CREATE TABLE workflow_runs (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    turn_id text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
    current_stage text,
    progress_current integer NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
    progress_total integer,
    checkpoint_json text NOT NULL DEFAULT '{}',
    created_at text NOT NULL,
    updated_at text NOT NULL,
    completed_at text,
    input_json text NOT NULL DEFAULT '{}',
    result_json text NOT NULL DEFAULT '{}',
    attempt integer NOT NULL DEFAULT 1,
    retry_of text REFERENCES workflow_runs(id) ON DELETE SET NULL,
    started_at text,
    error_code text,
    error_message text,
    UNIQUE (id, thread_id),
    FOREIGN KEY (turn_id, thread_id) REFERENCES turns(id, thread_id) ON DELETE CASCADE,
    CHECK (progress_total IS NULL OR (progress_total >= 0 AND progress_current <= progress_total)),
    CHECK (
        (status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL) OR
        (status NOT IN ('completed', 'failed', 'cancelled') AND completed_at IS NULL)
    )
);
CREATE INDEX idx_workflows_thread ON workflow_runs(thread_id, updated_at DESC);
CREATE INDEX idx_workflows_status ON workflow_runs(status, updated_at DESC);
CREATE INDEX idx_workflows_retry ON workflow_runs(retry_of, attempt);

CREATE TABLE artifacts (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    turn_id text REFERENCES turns(id) ON DELETE SET NULL,
    workflow_run_id text REFERENCES workflow_runs(id) ON DELETE SET NULL,
    kind text NOT NULL,
    name text NOT NULL,
    media_type text NOT NULL,
    storage_path text NOT NULL,
    byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
    metadata_json text NOT NULL DEFAULT '{}',
    created_at text NOT NULL
);
CREATE INDEX idx_artifacts_thread ON artifacts(thread_id, created_at DESC);

CREATE FUNCTION artifacts_check_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.turn_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM turns WHERE id = NEW.turn_id AND thread_id = NEW.thread_id))
       OR (NEW.workflow_run_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM workflow_runs WHERE id = NEW.workflow_run_id AND thread_id = NEW.thread_id))
    THEN
        RAISE EXCEPTION USING ERRCODE = '23000', MESSAGE = 'artifact references a different thread';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER enforce_artifact_scope_insert BEFORE INSERT ON artifacts
    FOR EACH ROW EXECUTE FUNCTION artifacts_check_scope();

CREATE TABLE event_log (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    sequence integer NOT NULL CHECK (sequence > 0),
    type text NOT NULL,
    turn_id text REFERENCES turns(id) ON DELETE SET NULL,
    item_id text REFERENCES items(id) ON DELETE SET NULL,
    timestamp text NOT NULL,
    payload_json text NOT NULL,
    UNIQUE (thread_id, sequence)
);

CREATE FUNCTION event_log_check_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.turn_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM turns WHERE id = NEW.turn_id AND thread_id = NEW.thread_id))
       OR (NEW.item_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM items WHERE id = NEW.item_id AND thread_id = NEW.thread_id))
    THEN
        RAISE EXCEPTION USING ERRCODE = '23000', MESSAGE = 'event references a different thread';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER enforce_event_scope_insert BEFORE INSERT ON event_log
    FOR EACH ROW EXECUTE FUNCTION event_log_check_scope();

CREATE TABLE legacy_imports (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    source_key text NOT NULL,
    source_session_id text NOT NULL,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    imported_at text NOT NULL,
    PRIMARY KEY (user_id, source_key)
);

CREATE TABLE usage_records (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    thread_id text NOT NULL,
    turn_id text,
    response_ordinal integer,
    source text NOT NULL CHECK (source IN ('turn', 'compaction')),
    connection_id text,
    provider_name text,
    model_id text,
    input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    cached_input_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    recorded_at text NOT NULL,
    UNIQUE (turn_id, response_ordinal)
);
CREATE INDEX idx_usage_records_thread ON usage_records(thread_id, recorded_at);
CREATE INDEX idx_usage_records_user_time ON usage_records(user_id, recorded_at);
CREATE INDEX idx_usage_records_time ON usage_records(recorded_at);

-- ---------------------------------------------------------------------------
-- Automations

CREATE TABLE automations (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    thread_id text NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
    name text NOT NULL,
    current_revision_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('enabled', 'paused', 'retired')),
    schedule_kind text NOT NULL CHECK (schedule_kind IN ('manual', 'interval')),
    interval_seconds integer,
    next_run_at text,
    last_run_at text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CHECK (
        (schedule_kind = 'manual' AND interval_seconds IS NULL AND next_run_at IS NULL) OR
        (
            schedule_kind = 'interval' AND interval_seconds >= 60 AND
            (status <> 'enabled' OR next_run_at IS NOT NULL)
        )
    ),
    CHECK (status <> 'retired' OR next_run_at IS NULL)
);
CREATE INDEX idx_automations_due ON automations(status, schedule_kind, next_run_at);
CREATE INDEX idx_automations_project ON automations(project_id, updated_at DESC);

CREATE TABLE automation_revisions (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    automation_id text NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal > 0),
    instruction text NOT NULL CHECK (length(trim(instruction)) > 0),
    created_at text NOT NULL,
    UNIQUE (automation_id, ordinal),
    UNIQUE (id, automation_id),
    FOREIGN KEY (automation_id) REFERENCES automations(id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_automation_revisions_definition ON automation_revisions(automation_id, ordinal DESC);

ALTER TABLE automations ADD CONSTRAINT automations_current_revision_fk
    FOREIGN KEY (current_revision_id, id)
    REFERENCES automation_revisions(id, automation_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE automation_occurrences (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    automation_id text NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('manual', 'scheduled')),
    occurrence_key text NOT NULL CHECK (length(trim(occurrence_key)) > 0),
    nominal_at text NOT NULL,
    observed_at text NOT NULL,
    UNIQUE (automation_id, kind, occurrence_key),
    UNIQUE (id, automation_id)
);
CREATE INDEX idx_automation_occurrences_nominal
    ON automation_occurrences(automation_id, nominal_at DESC);

CREATE TABLE automation_runs (
    id text PRIMARY KEY,
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    automation_id text NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    revision_id text NOT NULL,
    occurrence_id text NOT NULL UNIQUE,
    goal_id text,
    thread_id text NOT NULL REFERENCES threads(id) ON DELETE NO ACTION,
    turn_id text REFERENCES turns(id) ON DELETE SET NULL,
    trigger text NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
    status text NOT NULL CHECK (status IN (
        'queued', 'running', 'waiting', 'blocked', 'completed',
        'failed', 'interrupted', 'skipped'
    )),
    scheduled_for text NOT NULL,
    detail text NOT NULL DEFAULT '',
    created_at text NOT NULL,
    updated_at text NOT NULL,
    started_at text,
    completed_at text,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    FOREIGN KEY (revision_id, automation_id)
        REFERENCES automation_revisions(id, automation_id) ON DELETE NO ACTION,
    FOREIGN KEY (occurrence_id, automation_id)
        REFERENCES automation_occurrences(id, automation_id) ON DELETE NO ACTION,
    CHECK (
        (status IN ('completed', 'failed', 'interrupted', 'skipped') AND completed_at IS NOT NULL) OR
        (status NOT IN ('completed', 'failed', 'interrupted', 'skipped') AND completed_at IS NULL)
    )
);
CREATE INDEX idx_automation_runs_active ON automation_runs(status, updated_at DESC);
CREATE UNIQUE INDEX idx_automation_runs_goal ON automation_runs(goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX idx_automation_runs_job ON automation_runs(automation_id, created_at DESC);
CREATE UNIQUE INDEX idx_automation_runs_one_open ON automation_runs(automation_id)
    WHERE status IN ('queued', 'running', 'waiting', 'blocked');
CREATE INDEX idx_automation_runs_turn ON automation_runs(turn_id);

CREATE FUNCTION automations_check_thread_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM threads WHERE id = NEW.thread_id AND project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23000', MESSAGE = 'automation references a different project';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER enforce_automation_thread_scope_insert BEFORE INSERT ON automations
    FOR EACH ROW EXECUTE FUNCTION automations_check_thread_scope();
CREATE TRIGGER enforce_automation_thread_scope_update
    BEFORE UPDATE OF project_id, thread_id ON automations
    FOR EACH ROW EXECUTE FUNCTION automations_check_thread_scope();

CREATE TRIGGER prevent_automation_revision_update BEFORE UPDATE ON automation_revisions
    FOR EACH ROW EXECUTE FUNCTION app_abort('automation revisions are immutable');
CREATE TRIGGER prevent_automation_occurrence_update BEFORE UPDATE ON automation_occurrences
    FOR EACH ROW EXECUTE FUNCTION app_abort('automation occurrences are immutable');

CREATE FUNCTION automation_runs_check_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
            SELECT 1 FROM automations
            WHERE id = NEW.automation_id AND thread_id = NEW.thread_id)
       OR NOT EXISTS (
            SELECT 1 FROM automation_occurrences
            WHERE id = NEW.occurrence_id AND automation_id = NEW.automation_id
              AND kind = NEW.trigger AND nominal_at = NEW.scheduled_for)
       OR (NEW.turn_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM turns
            WHERE id = NEW.turn_id AND thread_id = NEW.thread_id
              AND (NEW.goal_id IS NULL OR goal_id = NEW.goal_id)))
    THEN
        RAISE EXCEPTION USING ERRCODE = '23000',
            MESSAGE = 'automation run references inconsistent execution scope';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER enforce_automation_run_scope_insert BEFORE INSERT ON automation_runs
    FOR EACH ROW EXECUTE FUNCTION automation_runs_check_scope();

CREATE FUNCTION automation_runs_check_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IN ('completed', 'failed', 'interrupted', 'skipped') THEN
        RAISE EXCEPTION USING ERRCODE = '23000', MESSAGE = 'terminal automation runs are immutable';
    END IF;
    IF OLD.automation_id IS DISTINCT FROM NEW.automation_id
       OR OLD.revision_id IS DISTINCT FROM NEW.revision_id
       OR OLD.occurrence_id IS DISTINCT FROM NEW.occurrence_id
       OR OLD.goal_id IS DISTINCT FROM NEW.goal_id
       OR OLD.thread_id IS DISTINCT FROM NEW.thread_id
       OR OLD.trigger IS DISTINCT FROM NEW.trigger
       OR OLD.scheduled_for IS DISTINCT FROM NEW.scheduled_for
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
       OR OLD.user_id IS DISTINCT FROM NEW.user_id
    THEN
        RAISE EXCEPTION USING ERRCODE = '23000', MESSAGE = 'automation run identity is immutable';
    END IF;
    IF OLD.turn_id IS DISTINCT FROM NEW.turn_id AND (
        OLD.turn_id IS NOT NULL OR NEW.turn_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23000', MESSAGE = 'automation run Turn ownership is immutable';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23000',
            MESSAGE = 'automation run version must advance exactly once';
    END IF;
    IF NEW.turn_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM turns
        WHERE id = NEW.turn_id AND thread_id = NEW.thread_id
          AND (NEW.goal_id IS NULL OR goal_id = NEW.goal_id)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23000',
            MESSAGE = 'automation run references inconsistent execution scope';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER enforce_automation_run_update BEFORE UPDATE ON automation_runs
    FOR EACH ROW EXECUTE FUNCTION automation_runs_check_update();

-- ---------------------------------------------------------------------------
-- Resource leases (coordination across workers)

CREATE TABLE resource_leases (
    user_id uuid NOT NULL DEFAULT app_user_id() REFERENCES users(id) ON DELETE CASCADE,
    resource_key text NOT NULL CHECK (
        length(trim(resource_key)) > 0 AND length(resource_key) <= 512
    ),
    epoch integer NOT NULL CHECK (epoch > 0),
    holder_worker_id text REFERENCES runtime_workers(id) ON DELETE RESTRICT,
    holder_turn_id text,
    holder_turn_epoch integer,
    acquired_at text NOT NULL,
    heartbeat_at text NOT NULL,
    released_at text,
    release_reason text,
    PRIMARY KEY (user_id, resource_key),
    FOREIGN KEY (holder_turn_id, holder_turn_epoch)
        REFERENCES turns(id, execution_epoch) ON DELETE RESTRICT,
    CHECK (heartbeat_at >= acquired_at),
    CHECK (
        (holder_turn_id IS NULL AND holder_turn_epoch IS NULL) OR
        (holder_worker_id IS NOT NULL AND holder_turn_id IS NOT NULL AND holder_turn_epoch > 0)
    ),
    CHECK (
        (holder_worker_id IS NOT NULL AND released_at IS NULL AND release_reason IS NULL) OR
        (
            holder_worker_id IS NULL AND holder_turn_id IS NULL AND
            holder_turn_epoch IS NULL AND released_at IS NOT NULL AND
            release_reason IS NOT NULL AND length(trim(release_reason)) > 0 AND
            released_at >= heartbeat_at
        )
    )
);
CREATE INDEX idx_resource_leases_holder ON resource_leases(holder_worker_id, holder_turn_id)
    WHERE holder_worker_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Same-owner references
--
-- Foreign-key checks run beneath row-level security, so a plain FK would let
-- one user attach rows to another user's ids (and have them cascade away with
-- the other user's data). Every parent therefore exposes (id, user_id) and
-- every child also references its parent through (parent_id, user_id): a row
-- can only point at rows of its own owner. MATCH SIMPLE skips the check while
-- the child column is NULL, and the original FKs keep their CASCADE/SET NULL
-- behavior, which settles before these NO ACTION checks run.

ALTER TABLE projects ADD CONSTRAINT projects_owner_key UNIQUE (id, user_id);
ALTER TABLE threads ADD CONSTRAINT threads_owner_key UNIQUE (id, user_id);
ALTER TABLE turns ADD CONSTRAINT turns_owner_key UNIQUE (id, user_id);
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_owner_key UNIQUE (id, user_id);
ALTER TABLE automations ADD CONSTRAINT automations_owner_key UNIQUE (id, user_id);

DO $$
DECLARE
    reference text[];
BEGIN
    FOREACH reference SLICE 1 IN ARRAY ARRAY[
        -- child table, child column, parent table
        ['threads', 'project_id', 'projects'],
        ['threads', 'parent_thread_id', 'threads'],
        ['turns', 'thread_id', 'threads'],
        ['items', 'thread_id', 'threads'],
        ['approvals', 'thread_id', 'threads'],
        ['approval_grants', 'thread_id', 'threads'],
        ['workflow_runs', 'thread_id', 'threads'],
        ['workflow_runs', 'retry_of', 'workflow_runs'],
        ['artifacts', 'thread_id', 'threads'],
        ['event_log', 'thread_id', 'threads'],
        ['legacy_imports', 'project_id', 'projects'],
        ['legacy_imports', 'thread_id', 'threads'],
        ['automations', 'project_id', 'projects'],
        ['automations', 'thread_id', 'threads'],
        ['automation_revisions', 'automation_id', 'automations'],
        ['automation_occurrences', 'automation_id', 'automations'],
        ['automation_runs', 'automation_id', 'automations'],
        ['automation_runs', 'thread_id', 'threads'],
        ['automation_runs', 'turn_id', 'turns']
    ] LOOP
        -- Revisions are written before their automation (the pair references
        -- each other), so that check waits for commit like the original FK.
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, user_id) '
            'REFERENCES %I (id, user_id) DEFERRABLE INITIALLY %s',
            reference[1],
            reference[1] || '_' || reference[2] || '_owner_fkey',
            reference[2],
            reference[3],
            CASE WHEN reference[1] = 'automation_revisions' THEN 'DEFERRED' ELSE 'IMMEDIATE' END
        );
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Row-level security

DO $$
DECLARE
    name text;
BEGIN
    FOREACH name IN ARRAY ARRAY[
        'projects', 'threads', 'turns', 'items', 'approvals', 'approval_grants',
        'workflow_runs', 'artifacts', 'event_log', 'legacy_imports',
        'usage_records', 'automations', 'automation_revisions',
        'automation_occurrences', 'automation_runs', 'runtime_workers',
        'resource_leases'
    ] LOOP
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

-- A user sees only their own account; sign-in and administration run in
-- system scope.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY self_or_system ON users
    USING (app_is_system() OR id = app_user_id())
    WITH CHECK (app_is_system());

ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY system_only ON user_tokens
    USING (app_is_system()) WITH CHECK (app_is_system());
