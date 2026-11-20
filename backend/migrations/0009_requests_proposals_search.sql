CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"for_user_id" uuid NOT NULL,
	"chat_id" uuid,
	"prepared_by_ai" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"actions" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "decline_reason" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_for_user_id_users_id_fk" FOREIGN KEY ("for_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_user" ON "proposals" USING btree ("org_id","for_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "document_versions_search" ON "document_versions" USING gin (to_tsvector('english', "search_text"));--> statement-breakpoint
CREATE INDEX "tasks_assigned_by" ON "tasks" USING btree ("org_id","assigned_by","status");