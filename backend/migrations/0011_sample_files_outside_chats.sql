ALTER TABLE "ai_chats" ADD COLUMN "has_outside_text" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "derived_from" uuid;