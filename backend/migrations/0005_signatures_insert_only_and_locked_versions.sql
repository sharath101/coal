-- Signatures are insert-only, like the audit trail (docs/data-model.md#conventions).
CREATE TRIGGER signatures_insert_only
  BEFORE UPDATE OR DELETE ON signatures
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER signatures_no_truncate
  BEFORE TRUNCATE ON signatures
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
-- A saved version's content, files and hashes never change, and an approved version is only ever
-- superseded: only its status and revision letter move, and only forwards.
CREATE FUNCTION coal_lock_document_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document_versions rows cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.run_step_id IS DISTINCT FROM OLD.run_step_id
    OR NEW.version_no IS DISTINCT FROM OLD.version_no
    OR NEW.iteration IS DISTINCT FROM OLD.iteration
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
    OR NEW.file_id IS DISTINCT FROM OLD.file_id
    OR NEW.pdf_file_id IS DISTINCT FROM OLD.pdf_file_id
    OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
    OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a saved document version cannot be changed: save a new version instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.rev_label IS NOT NULL AND NEW.rev_label IS DISTINCT FROM OLD.rev_label THEN
    RAISE EXCEPTION 'a revision letter cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('approved', 'superseded') AND NEW.status NOT IN (OLD.status, 'superseded') THEN
    RAISE EXCEPTION 'an approved document version cannot go back to a draft'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_versions_locked
  BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION coal_lock_document_version();