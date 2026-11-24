CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"role_key" text NOT NULL,
	"reports_to_key" text,
	"per_product_line" boolean DEFAULT false NOT NULL,
	"seats" integer,
	"self_service" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_org_key" UNIQUE("org_id","key")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "switched_by_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "position_key" text;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_role_fk" FOREIGN KEY ("org_id","role_key") REFERENCES "public"."roles"("org_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_switched_by_id_users_id_fk" FOREIGN KEY ("switched_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_position_fk" FOREIGN KEY ("org_id","position_key") REFERENCES "public"."positions"("org_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "reports_to_key";--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "needs_product_line";