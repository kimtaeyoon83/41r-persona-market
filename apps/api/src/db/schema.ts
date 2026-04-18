import { pgTable, text, timestamp, integer, real, boolean, jsonb, uuid, varchar, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Companies ───────────────────────────────────────
export const companies = pgTable('companies', {
  walletAddress: varchar('wallet_address', { length: 64 }).primaryKey(),
  companyName: text('company_name').notNull(),
  domain: text('domain'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Tests ───────────────────────────────────────────
export const tests = pgTable('tests', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyAddr: varchar('company_addr', { length: 64 }).notNull().references(() => companies.walletAddress),
  targetUrl: text('target_url').notNull(),
  requirements: text('requirements'),
  budgetUsdc: real('budget_usdc').notNull().default(0),
  rewardPerTester: real('reward_per_tester').notNull().default(3),
  depositTxSignature: text('deposit_tx_signature'),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | active | completed
  escrowPda: varchar('escrow_pda', { length: 64 }),
  screenshotUrls: jsonb('screenshot_urls').$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Test Cases ──────────────────────────────────────
export const testCases = pgTable('test_cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  testId: uuid('test_id').notNull().references(() => tests.id),
  type: varchar('type', { length: 20 }).notNull(), // checklist | scenario | questionnaire
  content: jsonb('content').notNull(), // ChecklistItem | ScenarioItem | QuestionnaireItem
  order: integer('order').notNull().default(0),
});

// ─── Testers ─────────────────────────────────────────
export const testers = pgTable('testers', {
  walletAddress: varchar('wallet_address', { length: 64 }).primaryKey(),
  displayName: text('display_name').notNull(),
  profile: jsonb('profile').$type<{
    // Basic demographics
    age_range?: '10s' | '20s' | '30s' | '40s' | '50s' | '60+';
    region?: string;
    occupation?: string;

    // Tech & crypto background
    expertise: string[];
    experience_level: string;
    crypto_experience?: 'none' | 'beginner' | 'intermediate' | 'advanced';

    // Testing preferences
    preferred_domains: string[];
    ui_preference: string;
    languages: string[];
    device_types: string[];
    primary_device?: 'mobile' | 'desktop';

    // Design & UX sensitivity
    design_matters?: boolean;
    frustration_triggers?: string[];
  }>(),
  testsDone: integer('tests_done').notNull().default(0),
  personaId: uuid('persona_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Test Reports ────────────────────────────────────
export const testReports = pgTable('test_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  testerAddr: varchar('tester_addr', { length: 64 }).notNull().references(() => testers.walletAddress),
  testId: uuid('test_id').notNull().references(() => tests.id),
  checklistResults: jsonb('checklist_results').$type<Array<{
    id: string;
    status: 'passed' | 'failed' | 'blocked';
    memo: string;
  }>>(),
  scenarioLog: jsonb('scenario_log').$type<Array<{
    id: string;
    timeline: Array<{ time: string; action: string; screenshot?: string }>;
  }>>(),
  questionnaireAnswers: jsonb('questionnaire_answers').$type<Array<{
    id: string;
    answer: string | number;
  }>>(),
  qualityScore: real('quality_score'), // 0.0 ~ 5.0
  isPersonaTest: boolean('is_persona_test').notNull().default(false),
  screenshots: jsonb('screenshots').$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  // Prevents a tester submitting the same test twice (and closes the
  // SELECT→INSERT race in routes/report.ts). ``is_persona_test`` is in
  // the key so the same wallet can carry both a manual report and a
  // persona-generated report for the same test — that pair is the
  // basis of the AI-vs-human comparison dashboard.
  uniqTesterTest: uniqueIndex('test_reports_tester_test_kind_uniq')
    .on(t.testerAddr, t.testId, t.isPersonaTest),
}));

// ─── Personas ────────────────────────────────────────
export const personas = pgTable('personas', {
  id: uuid('id').defaultRandom().primaryKey(),
  testerAddr: varchar('tester_addr', { length: 64 }).notNull().references(() => testers.walletAddress),
  vector: jsonb('vector').$type<{
    test_style: { thoroughness: number; speed: number; ux_focus: number; bug_detection: number; creativity: number };
    expertise: { defi: number; nft: number; gaming: number; ai_tools: number; general_web: number };
    feedback_pattern: { ui_critical: number; security_aware: number; performance_sensitive: number; accessibility_focus: number; detail_oriented: number };
    reliability: { quality_score: number; consistency: number; response_rate: number };
    demographics?: {
      age_group: 'teen' | 'young_adult' | 'adult' | 'senior';
      tech_literacy: number;
      crypto_experience: number;
      design_sensitivity: number;
      patience_level: number;
    };
    ux_preferences?: {
      visual_style: 'minimal' | 'rich' | 'playful' | 'professional';
      font_size_preference: number;
      information_density: number;
      animation_tolerance: number;
      color_contrast_need: number;
      mobile_first: boolean;
    };
    voice_sample: string;
  }>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sasAttestId: text('sas_attest_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Persona Versions (append-only history) ─────────
// Every time a persona is (re)computed from a fresh report set, we
// append a row here with the resulting vector and the reports it was
// built from. ``personas`` keeps the current snapshot for fast lookups;
// ``persona_versions`` provides the audit trail needed for the
// calibration-flywheel hypothesis (see docs/pivot-strategy.md §3.1).
export const personaVersions = pgTable('persona_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  personaId: uuid('persona_id').notNull().references(() => personas.id),
  testerAddr: varchar('tester_addr', { length: 64 }).notNull().references(() => testers.walletAddress),
  versionNum: integer('version_num').notNull(), // 1, 2, 3, ... per personaId
  vector: jsonb('vector').notNull(), // same shape as personas.vector
  sourceReportIds: jsonb('source_report_ids').$type<string[]>().notNull().default([]),
  qualityScoreAvg: real('quality_score_avg'), // avg of sourceReports at time of computation
  trigger: varchar('trigger', { length: 32 }).notNull().default('manual'), // 'manual' | 'report_submit' | 'admin'
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  // Look-up "give me the history for persona X in order" is the common
  // read pattern; a composite index is cheaper than two separate ones.
  personaVersionIdx: uniqueIndex('persona_versions_persona_version_uniq').on(t.personaId, t.versionNum),
}));

// ─── Settlements ─────────────────────────────────────
export const settlements = pgTable('settlements', {
  id: uuid('id').defaultRandom().primaryKey(),
  testId: uuid('test_id').notNull().references(() => tests.id),
  reportId: uuid('report_id').references(() => testReports.id),
  payerAddr: varchar('payer_addr', { length: 64 }).notNull(),
  payeeAddr: varchar('payee_addr', { length: 64 }).notNull(),
  amountToken: real('amount_token').notNull(),
  feeCollected: real('fee_collected').default(0),
  hookTxSig: text('hook_tx_sig'),
  // txSignature uses string prefixes as state: 'pending_<ts>' for
  // queued retries, 'failed_<ts>' once retries are exhausted, any other
  // value is the real Solana signature. The background worker
  // (services/settlement-worker.ts) scans for 'pending_' rows.
  txSignature: text('tx_signature'),
  retryCount: integer('retry_count').notNull().default(0),
  lastRetryAt: timestamp('last_retry_at'),
  settlementType: varchar('settlement_type', { length: 20 }).notNull().default('usdc'), // usdc | 41r
  settledAt: timestamp('settled_at').defaultNow().notNull(),
});
