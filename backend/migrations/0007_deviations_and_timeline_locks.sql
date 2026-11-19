-- Deviations, their reviews and comments are insert-only (docs/data-model.md#conventions).
CREATE TRIGGER deviations_insert_only
  BEFORE UPDATE OR DELETE ON deviations
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER deviations_no_truncate
  BEFORE TRUNCATE ON deviations
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER deviation_reviews_insert_only
  BEFORE UPDATE OR DELETE ON deviation_reviews
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER deviation_reviews_no_truncate
  BEFORE TRUNCATE ON deviation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER deviation_comments_insert_only
  BEFORE UPDATE OR DELETE ON deviation_comments
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER deviation_comments_no_truncate
  BEFORE TRUNCATE ON deviation_comments
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
-- A signed baseline and every later date change stay as they were. Only the plan being written
-- (a draft) can be replaced or removed.
CREATE FUNCTION coal_lock_timeline_items() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind <> 'draft' THEN
    RAISE EXCEPTION 'timeline_items rows of kind % cannot be changed or deleted', OLD.kind
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER timeline_items_lock
  BEFORE UPDATE OR DELETE ON timeline_items
  FOR EACH ROW EXECUTE FUNCTION coal_lock_timeline_items();
--> statement-breakpoint
CREATE TRIGGER timeline_items_no_truncate
  BEFORE TRUNCATE ON timeline_items
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
