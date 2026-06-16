-- Partial unique index: one signup-bonus grant of each kind per user
-- (2026-06-15). DB-layer backstop against the ensureSignupBonus
-- concurrency race that duplicated the $30 grant on the first authed
-- request burst after a process restart. See services/credits.ts.
--
-- Written idempotent (IF NOT EXISTS) so it can be applied manually
-- against prod, whose drizzle journal is empty — see CLAUDE.md
-- "DB migrations". Any pre-existing duplicates must be cleaned first
-- (scripts/fix-signup-bonus-dupes.ts) or this index creation errors.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_transactions_signup_unique"
  ON "credit_transactions" ("user_id", "reason")
  WHERE "reason" IN ('signup_bonus','signup_bonus_wallet','signup_bonus_upgrade');
