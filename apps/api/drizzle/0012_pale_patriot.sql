ALTER TABLE "partner_behavior_events" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_behavior_events" ADD COLUMN IF NOT EXISTS "anon_id" text;