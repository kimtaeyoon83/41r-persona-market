-- Scan report on-chain anchor (chain wiring Phase 2, 2026-06-19). The shaped
-- AI report is Seal-encrypted → stored on Walrus at scan completion
-- (fire-and-forget). Idempotent ADD COLUMN — manual prod apply via
-- scripts/apply-prod-console-migrations.ts (empty drizzle journal, see CLAUDE.md).
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "report_walrus_blob_id" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "report_seal_id" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "report_anchored_at" timestamp;
