-- Authenticated capture (Phase 1, 2026-06-16). Per-workspace encrypted
-- auth session (reused across scans of a login-gated site) + the key
-- screens to capture. Idempotent (ADD COLUMN IF NOT EXISTS) for manual
-- prod apply against the empty drizzle journal — see CLAUDE.md.
ALTER TABLE "site_workspaces" ADD COLUMN IF NOT EXISTS "auth_session_enc" text;
--> statement-breakpoint
ALTER TABLE "site_workspaces" ADD COLUMN IF NOT EXISTS "auth_session_updated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "site_workspaces" ADD COLUMN IF NOT EXISTS "capture_paths" jsonb;
