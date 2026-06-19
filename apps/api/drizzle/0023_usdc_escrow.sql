-- USDC escrow campaigns (pay-per-scan, §4.3, 2026-06-19). The reward is locked
-- in an on-chain rpm::campaign Campaign<USDC>; the server verifies the create
-- tx, then settles/closes the escrow at scan completion. Idempotent ADD COLUMN
-- — manual prod apply via scripts/apply-prod-console-migrations.ts.
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "payment_method" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "campaign_object_id" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "campaign_cap_id" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "escrow_coin_type" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "escrow_amount" bigint;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "escrow_status" text;
--> statement-breakpoint
-- One create-tx digest pays exactly one scan (anti-replay). Partial so the
-- many credit-paid rows (NULL digest) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS "audience_fit_scans_payment_tx_unique"
  ON "audience_fit_scans" ("payment_tx_signature")
  WHERE "payment_tx_signature" IS NOT NULL;
