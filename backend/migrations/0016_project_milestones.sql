CREATE TABLE "run_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text,
	"title" text,
	"target_date" date,
	"reached_at" timestamp with time zone,
	"reached_by" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_milestones_kind" CHECK (("run_milestones"."step_key" is null) <> ("run_milestones"."title" is null))
);
--> statement-breakpoint
ALTER TABLE "run_milestones" ADD CONSTRAINT "run_milestones_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_milestones_run" ON "run_milestones" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_milestones_step" ON "run_milestones" USING btree ("run_id","step_key") WHERE "run_milestones"."removed_at" is null and "run_milestones"."step_key" is not null;