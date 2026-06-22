-- Team workspaces (2026-06-22) — invite teammates to VIEW a site's analyses.
-- A site_workspace is per-owner; site_members grants read-only access to that
-- workspace to other users (invited by email, claimed on their first login).
-- Idempotent (empty prod journal — applied via apply-prod-console-migrations).

CREATE TABLE IF NOT EXISTS "site_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "site_workspaces"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'viewer',
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- one invite per (workspace, email); case-insensitive on email
CREATE UNIQUE INDEX IF NOT EXISTS "site_members_ws_email_uniq"
  ON "site_members" ("workspace_id", lower("email"));

-- fast lookup of "which workspaces is this user a member of"
CREATE INDEX IF NOT EXISTS "site_members_user_idx" ON "site_members" ("user_id");
