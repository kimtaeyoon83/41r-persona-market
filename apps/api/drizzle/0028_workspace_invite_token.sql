-- Invite links (2026-06-24) — share a copyable link instead of email.
-- A per-workspace random token: anyone with the link who logs in joins as a
-- read-only viewer (no email match needed). Owner can reset to invalidate.
-- Idempotent (empty prod journal — applied via apply-prod-console-migrations).

ALTER TABLE "site_workspaces" ADD COLUMN IF NOT EXISTS "invite_token" text;

CREATE UNIQUE INDEX IF NOT EXISTS "site_workspaces_invite_token_uniq"
  ON "site_workspaces" ("invite_token")
  WHERE "invite_token" IS NOT NULL;
