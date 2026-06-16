-- Per-workspace mobile-viewport capture (2026-06-16). Mobile-first apps
-- (e.g. geulbat) render a centered phone frame on a blurred desktop
-- background, which a desktop capture mis-reads as a blocking modal.
-- Idempotent ADD COLUMN — manual prod apply, see CLAUDE.md.
ALTER TABLE "site_workspaces" ADD COLUMN IF NOT EXISTS "capture_mobile" boolean;
