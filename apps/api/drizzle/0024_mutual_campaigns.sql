-- Mutual-sealed campaigns (design doc v0.4 §4.5, 2026-06-20). Two-way sealed
-- exchange: a company seals a pre-release asset (Walrus blob + Seal policy) and
-- a persona seals its session evidence; an escrow-backed state machine + a
-- slashable stake stand in for the impossible atomic reveal (§4.5.3).
--
-- This table is the off-chain mirror of the on-chain rpm::mutual::MutualCampaign
-- (state + Walrus/Seal refs). The Sui object/cap ids are populated only when
-- MUTUAL_ONCHAIN_ENABLED — the sealed asset blob is the real artifact; the Sui
-- mint is the optional anchor (same honesty contract as scan-report anchoring).
--
-- Idempotent CREATE — manual prod apply via scripts/apply-prod-console-migrations.ts.
CREATE TABLE IF NOT EXISTS "mutual_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requester_user_id" uuid NOT NULL,
  "persona_user_id" uuid,
  "title" text NOT NULL,
  "description" text,
  -- SealedAsset (company → persona, §4.5.1 A)
  "asset_hash" text NOT NULL,
  "asset_blob_id" text,
  "asset_seal_id" text,
  "asset_sandbox_only" boolean DEFAULT true NOT NULL,
  -- SealedEvidence (persona → company, §4.5.1 B)
  "evidence_hash" text,
  "evidence_blob_id" text,
  "evidence_seal_id" text,
  -- Escrow + bond (base units; notional when off-chain)
  "reward_amount" bigint DEFAULT 0 NOT NULL,
  "stake_amount" bigint DEFAULT 0 NOT NULL,
  -- State machine (§4.5.2): asset_sealed → persona_opted_in → asset_revealed
  -- → evidence_committed → evidence_revealed → settled; aborted via slash.
  "state" text DEFAULT 'asset_sealed' NOT NULL,
  -- On-chain anchor (null until MUTUAL_ONCHAIN_ENABLED mints the object).
  "sui_object_id" text,
  "sui_cap_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "settled_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mutual_campaigns_requester_idx" ON "mutual_campaigns" ("requester_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mutual_campaigns_persona_idx" ON "mutual_campaigns" ("persona_user_id");
--> statement-breakpoint
-- FKs as ALTER (idempotent guard) so a re-run never errors on an existing constraint.
DO $$ BEGIN
  ALTER TABLE "mutual_campaigns" ADD CONSTRAINT "mutual_campaigns_requester_fk"
    FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mutual_campaigns" ADD CONSTRAINT "mutual_campaigns_persona_fk"
    FOREIGN KEY ("persona_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
