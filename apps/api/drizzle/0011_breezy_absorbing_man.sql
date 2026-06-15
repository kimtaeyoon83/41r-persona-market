CREATE TABLE IF NOT EXISTS "partner_behavior_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"session_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"profile" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_behavior_events_user_id_users_id_fk') THEN
    ALTER TABLE "partner_behavior_events" ADD CONSTRAINT "partner_behavior_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_profiles_user_id_users_id_fk') THEN
    ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_profiles_source_email_uniq" ON "partner_profiles" USING btree ("source","email");