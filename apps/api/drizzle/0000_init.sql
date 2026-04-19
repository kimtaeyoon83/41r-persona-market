CREATE TABLE "companies" (
	"wallet_address" varchar(64) PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"domain" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"tester_addr" varchar(64) NOT NULL,
	"version_num" integer NOT NULL,
	"vector" jsonb NOT NULL,
	"source_report_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality_score_avg" real,
	"trigger" varchar(32) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tester_addr" varchar(64) NOT NULL,
	"vector" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sas_attest_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"report_id" uuid,
	"payer_addr" varchar(64) NOT NULL,
	"payee_addr" varchar(64) NOT NULL,
	"amount_token" real NOT NULL,
	"fee_collected" real DEFAULT 0,
	"hook_tx_sig" text,
	"tx_signature" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"settlement_type" varchar(20) DEFAULT 'usdc' NOT NULL,
	"settled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"content" jsonb NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tester_addr" varchar(64) NOT NULL,
	"test_id" uuid NOT NULL,
	"checklist_results" jsonb,
	"scenario_log" jsonb,
	"questionnaire_answers" jsonb,
	"quality_score" real,
	"is_persona_test" boolean DEFAULT false NOT NULL,
	"screenshots" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "testers" (
	"wallet_address" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"profile" jsonb,
	"tests_done" integer DEFAULT 0 NOT NULL,
	"persona_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_addr" varchar(64) NOT NULL,
	"target_url" text NOT NULL,
	"requirements" text,
	"budget_usdc" real DEFAULT 0 NOT NULL,
	"reward_per_tester" real DEFAULT 3 NOT NULL,
	"deposit_tx_signature" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"escrow_pda" varchar(64),
	"screenshot_urls" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_tester_addr_testers_wallet_address_fk" FOREIGN KEY ("tester_addr") REFERENCES "public"."testers"("wallet_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_tester_addr_testers_wallet_address_fk" FOREIGN KEY ("tester_addr") REFERENCES "public"."testers"("wallet_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_report_id_test_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."test_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_reports" ADD CONSTRAINT "test_reports_tester_addr_testers_wallet_address_fk" FOREIGN KEY ("tester_addr") REFERENCES "public"."testers"("wallet_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_reports" ADD CONSTRAINT "test_reports_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_company_addr_companies_wallet_address_fk" FOREIGN KEY ("company_addr") REFERENCES "public"."companies"("wallet_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "persona_versions_persona_version_uniq" ON "persona_versions" USING btree ("persona_id","version_num");--> statement-breakpoint
CREATE UNIQUE INDEX "test_reports_tester_test_kind_uniq" ON "test_reports" USING btree ("tester_addr","test_id","is_persona_test");