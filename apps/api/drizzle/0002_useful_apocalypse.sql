DROP INDEX "test_reports_tester_test_kind_uniq";--> statement-breakpoint
ALTER TABLE "test_reports" ADD COLUMN "source_mode" varchar(24) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "test_reports_tester_test_mode_uniq" ON "test_reports" USING btree ("tester_addr","test_id","is_persona_test","source_mode");