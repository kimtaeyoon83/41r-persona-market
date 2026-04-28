ALTER TABLE "tests" ADD COLUMN "funnel_json" jsonb;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "funnel_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "funnel_report_count" integer;