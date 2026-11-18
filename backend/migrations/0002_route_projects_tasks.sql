CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"run_step_id" uuid,
	"step_key" text,
	"iteration" integer,
	"decision" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"decided_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"milestone" text NOT NULL,
	"step_key" text,
	"iteration" integer,
	"note" text,
	"evidence_file_id" uuid,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"process_version_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"hold_reason" text,
	"drop_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"department_code" text NOT NULL,
	"definition" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_versions_org_key_version" UNIQUE("org_id","key","version")
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"iteration" integer NOT NULL,
	"status" text NOT NULL,
	"path" text,
	"signers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reset_by_send_back_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_steps_run_step_iteration" UNIQUE("run_id","step_key","iteration")
);
--> statement-breakpoint
CREATE TABLE "send_backs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"from_run_step_id" uuid NOT NULL,
	"from_step_key" text NOT NULL,
	"to_step_key" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_file_id" uuid,
	"decided_by" uuid NOT NULL,
	"reset_run_step_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"product_line_id" uuid NOT NULL,
	"process_run_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_org_code" UNIQUE("org_id","code"),
	CONSTRAINT "projects_run" UNIQUE("process_run_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid,
	"run_step_id" uuid,
	"step_key" text,
	"task_key" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"role_key" text,
	"assignee_id" uuid,
	"queue_role" text,
	"assigned_by" uuid,
	"via_ai" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"keep_on_reset" boolean DEFAULT false NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"subject_label" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_runs" ADD CONSTRAINT "process_runs_process_version_id_process_versions_id_fk" FOREIGN KEY ("process_version_id") REFERENCES "public"."process_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_backs" ADD CONSTRAINT "send_backs_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_backs" ADD CONSTRAINT "send_backs_from_run_step_id_run_steps_id_fk" FOREIGN KEY ("from_run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_process_run_id_process_runs_id_fk" FOREIGN KEY ("process_run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_run" ON "decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "milestones_run" ON "milestones" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "process_runs_status" ON "process_runs" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "run_steps_one_current" ON "run_steps" USING btree ("run_id","step_key") WHERE "run_steps"."status" <> 'reset';--> statement-breakpoint
CREATE INDEX "send_backs_run" ON "send_backs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_active" ON "project_members" USING btree ("project_id","user_id") WHERE "project_members"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "projects_created" ON "projects" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee" ON "tasks" USING btree ("org_id","assignee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_queue" ON "tasks" USING btree ("org_id","queue_role","status");--> statement-breakpoint
CREATE INDEX "tasks_run" ON "tasks" USING btree ("run_id","step_key");