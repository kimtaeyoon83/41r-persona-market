-- Authenticated multi-screen capture result (Phase 1, 2026-06-16).
-- Post-login key screens + per-screen structure (actions/nav) so
-- personas and the report see the real product behind the gate.
-- Idempotent (ADD COLUMN IF NOT EXISTS) for manual prod apply — see
-- CLAUDE.md "DB migrations".
ALTER TABLE "audience_fit_scans" ADD COLUMN IF NOT EXISTS "auth_capture" jsonb;
