ALTER TABLE "tests" ADD COLUMN "diagnosis_md" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "diagnosis_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "diagnosis_report_count" integer;