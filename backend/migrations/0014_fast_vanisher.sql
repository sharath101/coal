ALTER TABLE "templates" ALTER COLUMN "spec" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "form_file_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_form_file_id_files_id_fk" FOREIGN KEY ("form_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;