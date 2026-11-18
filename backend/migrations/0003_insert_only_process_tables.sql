-- Insert-only tables of the route (docs/data-model.md#conventions): rows can be added, never
-- changed or removed. Uses the guard function from 0001.
CREATE TRIGGER decisions_insert_only
  BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER decisions_no_truncate
  BEFORE TRUNCATE ON decisions
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER milestones_insert_only
  BEFORE UPDATE OR DELETE ON milestones
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER milestones_no_truncate
  BEFORE TRUNCATE ON milestones
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER send_backs_insert_only
  BEFORE UPDATE OR DELETE ON send_backs
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER send_backs_no_truncate
  BEFORE TRUNCATE ON send_backs
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();