-- Capture planner wiring (Console S4, 2026-06-16). Per-workspace
-- intended journey stage to evaluate + per-scan stored planner verdict.
-- Idempotent ADD COLUMN — manual prod apply, see CLAUDE.md.
ALTER TABLE "site_workspaces" ADD COLUMN IF NOT EXISTS "intended_stage" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "capture_plan" jsonb;
