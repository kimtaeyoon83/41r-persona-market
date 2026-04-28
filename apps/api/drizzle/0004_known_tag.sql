ALTER TABLE "tests" ADD COLUMN "compare_with_test_id" uuid;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "monthly_visitors" integer;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "conversion_value" real;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "current_conversion_rate" real;