CREATE TABLE "deviation_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"deviation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviation_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"deviation_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"corrected_by_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"run_step_id" uuid,
	"step_key" text,
	"task_id" uuid,
	"kind" text NOT NULL,
	"planned_date" date,
	"new_date" date,
	"reason_code" text NOT NULL,
	"reason_text" text NOT NULL,
	"cause_type" text NOT NULL,
	"cause_user_id" uuid,
	"cause_role" text,
	"cause_party" text,
	"recorded_by" uuid NOT NULL,
	"corrects_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"project_id" uuid,
	"step_key" text,
	"channels" jsonb DEFAULT '["in_app"]'::jsonb NOT NULL,
	"dedupe_key" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "timeline_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"baseline_no" integer DEFAULT 0 NOT NULL,
	"step_key" text NOT NULL,
	"role_key" text NOT NULL,
	"planned_start" date NOT NULL,
	"planned_end" date NOT NULL,
	"reason" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_calendar" (
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"is_working_day" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "work_calendar_org_id_date_pk" PRIMARY KEY("org_id","date")
);
--> statement-breakpoint
ALTER TABLE "process_runs" ADD COLUMN "planned_launch" date;--> statement-breakpoint
ALTER TABLE "process_runs" ADD COLUMN "forecast_launch" date;--> statement-breakpoint
ALTER TABLE "process_runs" ADD COLUMN "health" text;--> statement-breakpoint
ALTER TABLE "process_runs" ADD COLUMN "health_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "process_runs" ADD COLUMN "baseline_no" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "process_runs" ADD COLUMN "scheduled_on" date;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "planned_start" date;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "planned_end" date;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "forecast_start" date;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "forecast_end" date;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "health" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "first_due_on" date;--> statement-breakpoint
ALTER TABLE "deviation_comments" ADD CONSTRAINT "deviation_comments_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reviews" ADD CONSTRAINT "deviation_reviews_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reviews" ADD CONSTRAINT "deviation_reviews_corrected_by_id_deviations_id_fk" FOREIGN KEY ("corrected_by_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_items" ADD CONSTRAINT "timeline_items_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deviation_comments_deviation" ON "deviation_comments" USING btree ("deviation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deviation_reviews_one" ON "deviation_reviews" USING btree ("deviation_id");--> statement-breakpoint
CREATE INDEX "deviations_run" ON "deviations" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "deviations_task" ON "deviations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "deviations_step" ON "deviations" USING btree ("run_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deviations_one_correction" ON "deviations" USING btree ("corrects_id") WHERE "deviations"."corrects_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "timeline_items_run" ON "timeline_items" USING btree ("run_id","step_key");--> statement-breakpoint
CREATE INDEX "timeline_items_drafts" ON "timeline_items" USING btree ("run_id") WHERE "timeline_items"."kind" = 'draft';--> statement-breakpoint
CREATE INDEX "tasks_due" ON "tasks" USING btree ("org_id","due_on");