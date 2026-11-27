CREATE TABLE "ai_web_lookups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"web_request_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"follow_up_of" uuid,
	"brief" jsonb NOT NULL,
	"searches" jsonb NOT NULL,
	"pages" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_chats" ADD COLUMN "web_on" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_chats" ADD COLUMN "used_web" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "from_web" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_web_lookups" ADD CONSTRAINT "ai_web_lookups_chat_id_ai_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."ai_chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_web_lookups_chat" ON "ai_web_lookups" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_web_lookups_request" ON "ai_web_lookups" USING btree ("request_id");--> statement-breakpoint
-- Insert-only (docs/data-model.md#conventions): what left COAL for the web, and what came back, is a log, never edited.
CREATE TRIGGER ai_web_lookups_insert_only
  BEFORE UPDATE OR DELETE ON ai_web_lookups
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER ai_web_lookups_no_truncate
  BEFORE TRUNCATE ON ai_web_lookups
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
