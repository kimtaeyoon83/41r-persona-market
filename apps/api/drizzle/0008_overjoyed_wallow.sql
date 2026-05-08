-- Phase 5.1 — survey_responses moves from email-anonymous to Privy-authed.
--
-- 1. user_id (FK→users.id, NULLABLE) so a respondent can list / re-edit
--    their own answers; legacy rows pre-Phase-5.1 stay user_id IS NULL.
-- 2. email DROP NOT NULL — new submissions don't carry email any more
--    (identity comes from Privy). Legacy 3 rows still hold their values.
-- 3. UNIQUE (scan_id, user_id) — one row per (scan, authenticated user).
--    Postgres treats NULLs as distinct in UNIQUE, so the legacy
--    user_id IS NULL rows are exempt and survive the constraint.
ALTER TABLE "survey_responses" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "survey_responses" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "survey_responses_scan_user_uniq" ON "survey_responses" USING btree ("scan_id","user_id");
