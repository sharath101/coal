-- Insert-only tables (docs/data-model.md#conventions): rows can be added, never changed or removed.
-- Later insert-only tables (signatures, decisions, milestones, send_backs, deviations, ai_requests,
-- ai_tool_calls) attach the same guard in their own migrations.
CREATE FUNCTION coal_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is insert-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_insert_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
-- Wakes the outbox dispatchers when events are written. Sent when the transaction commits.
CREATE FUNCTION coal_outbox_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('coal_outbox', '');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_notify
  AFTER INSERT ON outbox_events
  FOR EACH STATEMENT EXECUTE FUNCTION coal_outbox_notify();
