-- Plaintext content-hash commitment (verifiable on-chain integrity, 2026-06-20).
-- The anchored Walrus blob is Seal-ENCRYPTED (private), so a viewer can prove it
-- EXISTS but cannot check its content. To make content integrity verifiable
-- WITHOUT decryption, we commit sha256(plaintext) in a PUBLIC Walrus manifest
-- blob that is add_memwal_ref'd onto the persona/report's Sui object — Walrus is
-- content-addressed, so the manifest's blob id (recorded on-chain) is a
-- tamper-evident commitment. A holder of the plaintext re-hashes it client-side
-- and compares against the public manifest. Method B (no Move republish).
-- Populated by services/sui/anchor.ts + scripts/backfill-content-hash.ts.
-- Idempotent ADD COLUMN — manual prod apply via apply-prod-console-migrations.ts.
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "content_hash" text;
--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "content_manifest_blob_id" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "report_content_hash" text;
--> statement-breakpoint
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "report_manifest_blob_id" text;
