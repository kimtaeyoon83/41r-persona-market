-- Site workspaces + scan linkage + point ref (Console Sprint 2, 2026-06-11).
-- Written idempotent so it can be applied manually against prod (drizzle
-- journal there is empty — see CLAUDE.md "DB migrations").
CREATE TABLE IF NOT EXISTS "site_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"url_host" text NOT NULL,
	"name" text,
	"site_key" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_last4" text NOT NULL,
	"last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "site_workspaces_site_key_unique" UNIQUE("site_key")
);
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD COLUMN IF NOT EXISTS "ref_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "site_workspaces" ADD CONSTRAINT "site_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_workspaces_user_host_uniq" ON "site_workspaces" USING btree ("user_id","url_host");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_fit_scans" ADD CONSTRAINT "audience_fit_scans_workspace_id_site_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."site_workspaces"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
