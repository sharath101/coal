CREATE TABLE "ai_chats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"channel" text DEFAULT 'website' NOT NULL,
	"context" jsonb NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_feedback_message_user" UNIQUE("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"parts" jsonb NOT NULL,
	"request_id" uuid,
	"stopped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"chat_id" uuid,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tool_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"endpoint" text NOT NULL,
	"tier" text NOT NULL,
	"allowed" boolean NOT NULL,
	"denial_reason" text,
	"input" jsonb,
	"records_returned" jsonb NOT NULL,
	"proposal_id" uuid,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_chat_id_ai_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."ai_chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chats_user" ON "ai_chats" USING btree ("org_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_chats_run" ON "ai_chats" USING btree ("org_id","user_id","run_id");--> statement-breakpoint
CREATE INDEX "ai_messages_chat" ON "ai_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_user_day" ON "ai_requests" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_request" ON "ai_tool_calls" USING btree ("request_id");--> statement-breakpoint
-- Insert-only (docs/data-model.md#conventions): what the AI cost and what it looked at is a log, never edited.
CREATE TRIGGER ai_requests_insert_only
  BEFORE UPDATE OR DELETE ON ai_requests
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER ai_requests_no_truncate
  BEFORE TRUNCATE ON ai_requests
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER ai_tool_calls_insert_only
  BEFORE UPDATE OR DELETE ON ai_tool_calls
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER ai_tool_calls_no_truncate
  BEFORE TRUNCATE ON ai_tool_calls
  FOR EACH STATEMENT EXECUTE FUNCTION coal_refuse_change();
