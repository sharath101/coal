CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" uuid,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision NOT NULL,
	"ms" integer NOT NULL,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"project_id" uuid,
	"step_key" text,
	"title" text NOT NULL,
	"template" text,
	"model" text NOT NULL,
	"content" jsonb NOT NULL,
	"gaps" jsonb NOT NULL,
	"docx" "bytea" NOT NULL,
	"pdf" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"display" jsonb,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"actions" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"href" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_chat_id_ai_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."ai_chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_user_day" ON "ai_calls" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_chats_user" ON "ai_chats" USING btree ("org_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_messages_chat" ON "ai_messages" USING btree ("chat_id","seq");--> statement-breakpoint
-- A chat is replayed to the model exactly as it happened, so its messages are never edited.
CREATE TRIGGER ai_messages_insert_only
  BEFORE UPDATE OR DELETE ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
--> statement-breakpoint
CREATE TRIGGER ai_calls_insert_only
  BEFORE UPDATE OR DELETE ON ai_calls
  FOR EACH ROW EXECUTE FUNCTION coal_refuse_change();
