-- Persona mint-to-user transfer (chain wiring, 2026-06-20). The "소유는 유저"
-- (§4.1 sovereignty) pillar: an anchored persona (operator-minted) can be
-- transferred to its owner's Sui address via persona::transfer_to. These
-- columns record that the operator-owned object has been handed to a user —
-- populated by scripts/transfer-personas.ts → services/sui/anchor.ts.
-- Idempotent ADD COLUMN — manual prod apply via
-- scripts/apply-prod-console-migrations.ts (empty drizzle journal, see CLAUDE.md).
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "transferred_to" text;
--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "transferred_at" timestamp;
