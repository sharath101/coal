CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text,
	"document_id" uuid,
	"task_id" uuid,
	"file_id" uuid NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text,
	"document_id" uuid,
	"task_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"file_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"run_step_id" uuid NOT NULL,
	"iteration" integer NOT NULL,
	"version_no" integer NOT NULL,
	"rev_label" text,
	"status" text NOT NULL,
	"content" jsonb,
	"content_sha256" text NOT NULL,
	"file_id" uuid,
	"pdf_file_id" uuid,
	"pdf_sha256" text,
	"search_text" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"via_ai" boolean DEFAULT false NOT NULL,
	"ai_request_id" uuid,
	"carried_from_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_doc_no" UNIQUE("document_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"document_type_id" uuid NOT NULL,
	"template_id" uuid,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"signature_plan" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_number" UNIQUE("org_id","number")
);
--> statement-breakpoint
CREATE TABLE "signature_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"meaning" text NOT NULL,
	"role_keys" jsonb NOT NULL,
	"assignee_id" uuid,
	"order_index" integer NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"returned_by" uuid,
	"return_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"content_sha256" text NOT NULL,
	"pdf_sha256" text,
	"user_id" uuid NOT NULL,
	"printed_name" text NOT NULL,
	"role_key" text NOT NULL,
	"role_name" text NOT NULL,
	"meaning" text NOT NULL,
	"decision" text,
	"reason" text,
	"method" text DEFAULT 'click' NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department_code" text,
	"kind" text NOT NULL,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"step_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"numbering_pattern" text NOT NULL,
	"signature_plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_types_org_code" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"placeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"docx_file_id" uuid NOT NULL,
	"sample_pdf_file_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"added_by" uuid,
	"activated_by" uuid,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_type_version" UNIQUE("document_type_id","version")
);
--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "uploaded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_pdf_file_id_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_run_id_process_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."process_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_request_id_signature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_docx_file_id_files_id_fk" FOREIGN KEY ("docx_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_sample_pdf_file_id_files_id_fk" FOREIGN KEY ("sample_pdf_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_run" ON "attachments" USING btree ("run_id","step_key");--> statement-breakpoint
CREATE INDEX "sources_run" ON "sources" USING btree ("run_id","step_key");--> statement-breakpoint
CREATE INDEX "document_versions_step" ON "document_versions" USING btree ("run_step_id");--> statement-breakpoint
CREATE INDEX "documents_run_step" ON "documents" USING btree ("run_id","step_key");--> statement-breakpoint
CREATE INDEX "signature_requests_version" ON "signature_requests" USING btree ("version_id","order_index");--> statement-breakpoint
CREATE INDEX "signature_requests_pending" ON "signature_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "signatures_subject" ON "signatures" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_one_active" ON "templates" USING btree ("document_type_id") WHERE "templates"."status" = 'active';--> statement-breakpoint
CREATE INDEX "templates_status" ON "templates" USING btree ("org_id","status");