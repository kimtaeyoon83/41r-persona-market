-- Workspace anchor scan (2026-06-15). The canonical 41R analysis a
-- partner's surveys attach to — set automatically to the first completed
-- scan linked to the workspace, so partners no longer pass a scanId.
-- Idempotent (IF NOT EXISTS / guarded constraint) for manual prod apply
-- against the empty drizzle journal — see CLAUDE.md "DB migrations".
ALTER TABLE "site_workspaces" ADD COLUMN IF NOT EXISTS "anchor_scan_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "site_workspaces" ADD CONSTRAINT "site_workspaces_anchor_scan_id_audience_fit_scans_id_fk" FOREIGN KEY ("anchor_scan_id") REFERENCES "public"."audience_fit_scans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
