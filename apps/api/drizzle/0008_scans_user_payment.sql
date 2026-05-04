-- Phase 4 §1 + D6 — link scans to Privy users + record sponsored
-- 0 USDC payment tx signature.
--
-- user_id              — Privy-authed user that requested the scan.
--                        Null for legacy/anonymous scans (pre-Phase 4).
-- payment_tx_signature — Solana base58 sig of the sponsored 0 USDC
--                        transfer that "paid" for the scan. Used by
--                        /me/analyses to show Solscan link + by Phase 5
--                        reward distribution to verify payment exists.
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "payment_tx_signature" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audience_fit_scans_user_id_idx" ON "audience_fit_scans"("user_id");
