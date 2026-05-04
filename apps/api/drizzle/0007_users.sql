-- Phase 4 §1 — Privy single-auth users table.
-- One row per Privy-authenticated user. privy_id is the canonical
-- identity (DID format like did:privy:c0123...). email + wallet are
-- denormalized from Privy's linked-accounts list for quick display
-- and may be null until the user links them.
--
-- The users table replaces the old testers/companies dichotomy from
-- the autotest era — Phase 4 has a single "user" concept that owns
-- audience_fit_scans (no role split, no 41R-specific addr tracking).
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_id" text NOT NULL UNIQUE,
	"email" text,
	"wallet_address" text,
	"display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Future: link audience_fit_scans.user_id → users.id so My Analyses
-- can filter scans by owner. Added in a follow-up migration once the
-- API actually starts setting it (Phase 4 P4-3+).
