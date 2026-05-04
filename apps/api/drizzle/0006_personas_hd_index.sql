-- Phase 2 §D2 — HD-derived synthetic-cohort persona wallets.
-- Adds a derivation-index column to personas. Null for legacy wallet-
-- based personas (real testers). Set on synthetic personas by the
-- seed-validator-cohorts script; the wallet is then derivable from
-- PERSONA_MASTER_MNEMONIC + this index via the BIP-44 path
-- m/44'/501'/<hd_index>'/0'.
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "hd_index" integer;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_hd_index_unique" UNIQUE("hd_index");
