-- Hot-path indexes and a commit-safe change cursor for the event relay.
--
-- Indexes lead with the looked-up column rather than user_id, matching the
-- baseline: the tenant_isolation policy (app_is_system() OR user_id = ...)
-- is an OR, so a user_id prefix could not be used as an index condition.

-- Deleting a Turn or Item sets these references to NULL; without an index
-- each delete scanned event_log. (turn_id, sequence) also serves
-- EventRepository.list_for_turn, which reads one Turn's events in order.
CREATE INDEX idx_event_log_turn ON event_log(turn_id, sequence)
    WHERE turn_id IS NOT NULL;
CREATE INDEX idx_event_log_item ON event_log(item_id)
    WHERE item_id IS NOT NULL;

-- Turn deletes cascade through these (turn_id, thread_id) foreign keys.
CREATE INDEX idx_approvals_turn ON approvals(turn_id, thread_id);
CREATE INDEX idx_workflows_turn ON workflow_runs(turn_id, thread_id);

-- The inserting transaction of each event. DurableEventRelay remembers the
-- oldest transaction still running when it last polled
-- (pg_snapshot_xmin(pg_current_snapshot())); every row committed since then
-- carries a tx_id at or above it, so the relay reads only new rows instead of
-- grouping the whole log on every poll. Rows written before this migration
-- keep NULL: the relay seeds its cursors from a full scan at startup.
-- Added without a default first so existing rows are not rewritten.
ALTER TABLE event_log ADD COLUMN tx_id xid8;
ALTER TABLE event_log ALTER COLUMN tx_id SET DEFAULT pg_current_xact_id();
CREATE INDEX idx_event_log_tx ON event_log(tx_id) WHERE tx_id IS NOT NULL;
