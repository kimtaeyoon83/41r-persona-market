-- Survey Responses (Phase 5 — Human comparison).
--
-- One row per human submission to the per-scan survey URL. Mirrors
-- scan_persona_responses for the AI side so the same aggregation
-- pipeline (dimensions → friction clustering → AARRR) can re-run
-- against this table to produce a like-for-like human report.
--
-- Note: the previous catch-up migration auto-generator emitted
-- additional ALTER TABLE / CREATE TABLE statements for objects that
-- were applied to the live DB earlier via `db:push` and never
-- backfilled into _journal.json. Those have been stripped — this
-- migration only contains the genuinely new survey_responses table.
CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"email" text NOT NULL,
	"sus_responses" jsonb NOT NULL,
	"dimension_inputs" jsonb NOT NULL,
	"voice" jsonb NOT NULL,
	"custom_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"demographics" jsonb NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_scan_id_audience_fit_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."audience_fit_scans"("id") ON DELETE cascade ON UPDATE no action;
