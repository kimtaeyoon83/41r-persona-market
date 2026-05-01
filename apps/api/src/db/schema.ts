import { pgTable, text, timestamp, date, integer, real, boolean, jsonb, uuid, varchar, uniqueIndex } from 'drizzle-orm/pg-core';

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
  // Final synthesis report generated on demand from all persona +
  // human reports for this test. Populated by POST /api/test/:id/diagnosis.
  // Stored so regeneration is an explicit user action (costs an LLM call)
  // and the company can re-read without re-billing.
  diagnosisMd: text('diagnosis_md'),
  diagnosisGeneratedAt: timestamp('diagnosis_generated_at'),
  /** Number of reports the stored diagnosis was generated from.
   *  Lets the UI show "out of date — N new reports since" without
   *  re-parsing the markdown to compare. */
  diagnosisReportCount: integer('diagnosis_report_count'),
  /** Auto-extracted funnel cache. services/scoring/funnel.ts runs a
   *  two-pass Haiku extraction (per-session "furthest step" + semantic
   *  clustering) and stores the result here. Same staleness pattern as
   *  diagnosisReportCount — UI compares against current persona report
   *  count to decide if regeneration is needed.
   *  Shape: { steps: [{label, count, percentage}, ...], totalSessions }. */
  funnelJson: jsonb('funnel_json'),
  funnelGeneratedAt: timestamp('funnel_generated_at'),
  funnelReportCount: integer('funnel_report_count'),
  /** Optional A/B comparison target — points to another test in the
   *  same project. UI renders side-by-side when set. Self-reference
   *  not enforced as FK to avoid migration ordering pain; route
   *  validates existence at write time. */
  compareWithTestId: uuid('compare_with_test_id'),
  /** Optional revenue baseline inputs — all three needed for the
   *  Revenue Impact card to render. Without them the card is hidden. */
  monthlyVisitors: integer('monthly_visitors'),
  conversionValue: real('conversion_value'),       // $ per conversion
  currentConversionRate: real('current_conversion_rate'),  // 0–1
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
  /** Which runner produced this report. Previously tracked only via the
   *  _source sentinel inside questionnaire_answers. Hoisted to a column
   *  so the unique index can distinguish the same persona running in
   *  browser vs text mode (the "simulation vs actual" pair the
   *  diagnosis synthesis depends on). Values:
   *    'stagehand_hybrid' — browser-mode persona run (Playwright)
   *    'text'             — prediction-only persona run (no browser)
   *    'manual'           — human tester submission
   *    legacy rows are back-filled from the sentinel in the 0002 migration.
   */
  sourceMode: varchar('source_mode', { length: 24 }).notNull().default('manual'),
  screenshots: jsonb('screenshots').$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  // Prevents a tester submitting the same test twice per source mode.
  // Widened from (tester, test, isPersona) to (tester, test, isPersona,
  // sourceMode) so one persona can carry both a browser run and a text
  // run for the same test — that pair is what lets the diagnosis report
  // contrast prediction with actual browsing.
  uniqTesterTestMode: uniqueIndex('test_reports_tester_test_mode_uniq')
    .on(t.testerAddr, t.testId, t.isPersonaTest, t.sourceMode),
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

// ─── Audience-Fit Scans ─────────────────────────────
// Mode A (URL-only Discovery) + Mode B (URL + target audience).
// One row per scan. Synthesis fields are filled at completion by the
// computeAudienceFit() pipeline; stay null until then.
export const audienceFitScans = pgTable('audience_fit_scans', {
  id: uuid('id').defaultRandom().primaryKey(),
  targetUrl: text('target_url').notNull(),
  category: text('category'),                      // 'DeFi' | 'SaaS' | …
  categoryConfidence: real('category_confidence'), // 0-1
  oneLinePitch: text('one_line_pitch'),
  mode: varchar('mode', { length: 8 }).notNull().default('A'), // 'A' | 'B'
  targetAudienceText: text('target_audience_text'),  // Mode B only
  hypothesis: text('hypothesis'),                    // Optional probe (§1.2)
  /** pending | capturing | sampling | responding | aggregating |
   *  completed | failed. The Phase 0 frontend Processing screen
   *  polls/streams against transitions of this column. */
  status: varchar('status', { length: 20 }).notNull().default('pending'),

  // Site capture (Stagehand-driven, Phase 1B)
  captureScreenshotUrls: jsonb('capture_screenshot_urls').$type<string[]>(),
  captureCompletedAt: timestamp('capture_completed_at'),

  // Synthesis output — filled at completion. All 0-100 unless noted.
  audienceFitScore: real('audience_fit_score'),
  bestCohortId: text('best_cohort_id'),
  bestCohortScore: real('best_cohort_score'),
  medianCohortScore: real('median_cohort_score'),
  worstCohortId: text('worst_cohort_id'),
  worstCohortScore: real('worst_cohort_score'),
  globalTaskSuccessAvg: real('global_task_success_avg'),
  globalSentimentAvg: real('global_sentiment_avg'),

  // Aggregate metadata
  personasAttempted: integer('personas_attempted').notNull().default(0),
  personasCompleted: integer('personas_completed').notNull().default(0),
  /** Personas whose self_consistency_check.happiness_retention_aligned
   *  came back FALSE (per spec §11.1 prompt schema). Excluded from
   *  cohort means but voice_quotes still surface for review. */
  personasFlagged: integer('personas_flagged').notNull().default(0),

  /** Total LLM spend for this scan in USD. Sum of llm_cost_usd across
   *  all scan_persona_responses + capture cost + synthesis cost. */
  totalCostUsd: real('total_cost_usd'),

  /** Audience-Fit weight version applied at synthesis time
   *  (e.g. 'v1.0', 'v1.3'). Locks reproducibility — re-running with
   *  newer calibration weights produces a NEW row, not an in-place
   *  update. */
  weightsVersion: varchar('weights_version', { length: 8 }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// ─── Scan Persona Responses ─────────────────────────
// One row per (scan, persona). Stores the raw single-vision-call JSON
// AND the post-processed dimension scores so we can re-aggregate
// without re-running the LLM.
export const scanPersonaResponses = pgTable('scan_persona_responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  scanId: uuid('scan_id').notNull().references(() => audienceFitScans.id, { onDelete: 'cascade' }),
  personaId: uuid('persona_id').notNull().references(() => personas.id),
  /** Cohort assignment. References STANDARD_COHORTS[].id in
   *  packages/shared/src/cohorts.ts — not a FK because cohort defs
   *  live in code, not in the DB. Renaming a cohort id requires a
   *  data migration on this column. */
  cohortId: text('cohort_id').notNull(),

  // Raw LLM output (full §11.1 schema)
  rawResponse: jsonb('raw_response'),

  // Post-processed dimension scores (0-100)
  happinessScore: real('happiness_score'),
  engagementScore: real('engagement_score'),
  adoptionScore: real('adoption_score'),
  retentionD7: real('retention_d7'),
  taskSuccessScore: real('task_success_score'),

  // Full D-curve (per-persona retention category mapped to 4 numbers
  // via RETENTION_BAND_TO_DCURVE in services/audience_fit.ts)
  retentionDCurve: jsonb('retention_d_curve').$type<{
    d1: number; d3: number; d7: number; d30: number;
  }>(),

  // Voice quotes (extracted to columns for fast cohort-card rendering)
  voiceFirstImpression: text('voice_first_impression'),
  voiceFriction: text('voice_friction'),
  voiceBiggestFriction: text('voice_biggest_friction'),
  voiceWouldReturnBecause: text('voice_would_return_because'),

  // Self-consistency check (§11.1 prompt schema)
  isFlagged: boolean('is_flagged').notNull().default(false),
  flagReason: text('flag_reason'),

  // Cost / timing
  llmCostUsd: real('llm_cost_usd'),
  llmLatencyMs: integer('llm_latency_ms'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqScanPersona: uniqueIndex('scan_persona_responses_scan_persona_uniq')
    .on(t.scanId, t.personaId),
}));

// ─── Scan Cohort Results ────────────────────────────
// One row per (scan, cohort). Pre-computed at synthesis time so report
// reads are a single SELECT instead of re-aggregating on every fetch.
export const scanCohortResults = pgTable('scan_cohort_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  scanId: uuid('scan_id').notNull().references(() => audienceFitScans.id, { onDelete: 'cascade' }),
  cohortId: text('cohort_id').notNull(),
  cohortLabel: text('cohort_label').notNull(),

  nTarget: integer('n_target').notNull(),
  nCompleted: integer('n_completed').notNull(),
  nFlagged: integer('n_flagged').notNull().default(0),

  // Cohort-level dimension means (mean across the cohort's personas,
  // excluding flagged ones). All 0-100.
  happinessMean: real('happiness_mean'),
  engagementMean: real('engagement_mean'),
  adoptionMean: real('adoption_mean'),
  retentionMean: real('retention_mean'),
  taskSuccessMean: real('task_success_mean'),

  /** Weighted §4.2 aggregate of dimension means. Equal to
   *  computeCohortFitScore(dimension_means) at the time of synthesis. */
  cohortFitScore: real('cohort_fit_score'),

  // Bootstrap 95% CI on cohort_fit_score (Phase 1B fills these)
  cohortFitCiLow: real('cohort_fit_ci_low'),
  cohortFitCiHigh: real('cohort_fit_ci_high'),

  // Cohort-level D-curve aggregate (mean across personas)
  retentionDCurve: jsonb('retention_d_curve').$type<{
    d1: number; d3: number; d7: number; d30: number;
  }>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqScanCohort: uniqueIndex('scan_cohort_results_scan_cohort_uniq')
    .on(t.scanId, t.cohortId),
}));

// ─── Calibration Records (spec §5) ──────────────────
// One row per (LLM inference, ground truth) pair. Track A is auto-
// populated by the weekly Stagehand cron. Tracks B and C are manual
// inserts. Used quarterly to recompute DIMENSION_WEIGHTS_V1.
export const calibrationRecords = pgTable('calibration_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Calibration date (YYYY-MM-DD). Separate from `created_at` so a
   *  back-filled record can be tagged with its true measurement date. */
  date: date('date').notNull(),
  siteUrl: text('site_url').notNull(),
  personaId: uuid('persona_id').references(() => personas.id),
  /** 'happiness' | 'engagement' | 'adoption' | 'retention' | 'task_success'. */
  dimension: varchar('dimension', { length: 20 }).notNull(),
  llmInference: real('llm_inference').notNull(),
  groundTruth: real('ground_truth').notNull(),
  delta: real('delta').notNull(),
  /** 'stagehand' | 'human_baseline' | 'analytics'. */
  source: varchar('source', { length: 20 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
