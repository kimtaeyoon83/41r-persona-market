import { pgTable, text, timestamp, integer, real, boolean, jsonb, uuid, varchar } from 'drizzle-orm/pg-core';

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
    expertise: string[];
    experience_level: string;
    preferred_domains: string[];
    ui_preference: string;
    languages: string[];
    device_types: string[];
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
});

// ─── Personas ────────────────────────────────────────
export const personas = pgTable('personas', {
  id: uuid('id').defaultRandom().primaryKey(),
  testerAddr: varchar('tester_addr', { length: 64 }).notNull().references(() => testers.walletAddress),
  vector: jsonb('vector').$type<{
    test_style: { thoroughness: number; speed: number; ux_focus: number; bug_detection: number; creativity: number };
    expertise: { defi: number; nft: number; gaming: number; ai_tools: number; general_web: number };
    feedback_pattern: { ui_critical: number; security_aware: number; performance_sensitive: number; accessibility_focus: number; detail_oriented: number };
    reliability: { quality_score: number; consistency: number; response_rate: number };
    voice_sample: string;
  }>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sasAttestId: text('sas_attest_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
  txSignature: text('tx_signature'),
  settlementType: varchar('settlement_type', { length: 20 }).notNull().default('usdc'), // usdc | 41r
  settledAt: timestamp('settled_at').defaultNow().notNull(),
});
