CREATE TABLE "research_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"year" text,
	"url" text NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"kept_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_results_run_ref" UNIQUE("run_id","ref"),
	CONSTRAINT "research_results_run_item" UNIQUE("run_id","source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"terms" jsonb NOT NULL,
	"source_ids" jsonb NOT NULL,
	"since" integer,
	"project_id" uuid,
	"step_key" text,
	"proposal_id" uuid,
	"chat_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"stop_asked" boolean DEFAULT false NOT NULL,
	"brief" text,
	"searches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"request_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"seed_key" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"settings" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_sources_org_name" UNIQUE("org_id","name"),
	CONSTRAINT "research_sources_org_seed" UNIQUE("org_id","seed_key")
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "research_result_id" uuid;--> statement-breakpoint
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_source_id_research_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_runs_user" ON "research_runs" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "research_runs_status" ON "research_runs" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_research_result_id_research_results_id_fk" FOREIGN KEY ("research_result_id") REFERENCES "public"."research_results"("id") ON DELETE no action ON UPDATE no action;