CREATE TABLE "audience_fit_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_url" text NOT NULL,
	"category" text,
	"category_confidence" real,
	"one_line_pitch" text,
	"mode" varchar(8) DEFAULT 'A' NOT NULL,
	"target_audience_text" text,
	"hypothesis" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"capture_screenshot_urls" jsonb,
	"capture_completed_at" timestamp,
	"audience_fit_score" real,
	"best_cohort_id" text,
	"best_cohort_score" real,
	"median_cohort_score" real,
	"worst_cohort_id" text,
	"worst_cohort_score" real,
	"global_task_success_avg" real,
	"global_sentiment_avg" real,
	"personas_attempted" integer DEFAULT 0 NOT NULL,
	"personas_completed" integer DEFAULT 0 NOT NULL,
	"personas_flagged" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" real,
	"weights_version" varchar(8),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "calibration_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"site_url" text NOT NULL,
	"persona_id" uuid,
	"dimension" varchar(20) NOT NULL,
	"llm_inference" real NOT NULL,
	"ground_truth" real NOT NULL,
	"delta" real NOT NULL,
	"source" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_cohort_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"cohort_id" text NOT NULL,
	"cohort_label" text NOT NULL,
	"n_target" integer NOT NULL,
	"n_completed" integer NOT NULL,
	"n_flagged" integer DEFAULT 0 NOT NULL,
	"happiness_mean" real,
	"engagement_mean" real,
	"adoption_mean" real,
	"retention_mean" real,
	"task_success_mean" real,
	"cohort_fit_score" real,
	"cohort_fit_ci_low" real,
	"cohort_fit_ci_high" real,
	"retention_d_curve" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_persona_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"cohort_id" text NOT NULL,
	"raw_response" jsonb,
	"happiness_score" real,
	"engagement_score" real,
	"adoption_score" real,
	"retention_d7" real,
	"task_success_score" real,
	"retention_d_curve" jsonb,
	"voice_first_impression" text,
	"voice_friction" text,
	"voice_biggest_friction" text,
	"voice_would_return_because" text,
	"is_flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"llm_cost_usd" real,
	"llm_latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_cohort_results" ADD CONSTRAINT "scan_cohort_results_scan_id_audience_fit_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."audience_fit_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_persona_responses" ADD CONSTRAINT "scan_persona_responses_scan_id_audience_fit_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."audience_fit_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_persona_responses" ADD CONSTRAINT "scan_persona_responses_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_cohort_results_scan_cohort_uniq" ON "scan_cohort_results" USING btree ("scan_id","cohort_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_persona_responses_scan_persona_uniq" ON "scan_persona_responses" USING btree ("scan_id","persona_id");