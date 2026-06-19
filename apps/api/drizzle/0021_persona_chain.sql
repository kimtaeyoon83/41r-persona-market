-- Persona on-chain anchor (chain wiring, 2026-06-19). Real Sui object id +
-- Seal-encrypted Walrus memory blob per persona, populated by
-- scripts/anchor-personas.ts. Idempotent ADD COLUMN — manual prod apply via
-- scripts/apply-prod-console-migrations.ts (empty drizzle journal, see CLAUDE.md).
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "sui_object_id" text;
--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "walrus_blob_id" text;
--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "seal_id" text;
--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "anchored_at" timestamp;
