import { pgTable, text, timestamp, date, integer, real, boolean, jsonb, uuid, varchar, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
  /** HD derivation index for synthetic-cohort personas (Phase 2 §D2).
   *  Null for legacy wallet-based personas (real testers). When set,
   *  the persona's wallet is m/44'/501'/<hd_index>'/0' under the
   *  PERSONA_MASTER_MNEMONIC. UNIQUE so one slot maps to one wallet. */
  hdIndex: integer('hd_index').unique(),
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
  /** Mode A optional — list of cohort IDs to restrict the analysis to.
   *  null means run all 8 STANDARD_COHORTS. Set from /validator/detail
   *  Q1 (Target users multi-select). When narrowing, the per-cohort
   *  bootstrap CIs widen as fewer personas land per cohort. */
  targetCohorts: jsonb('target_cohorts').$type<string[]>(),
  /** pending | capturing | sampling | responding | aggregating |
   *  completed | failed. The Phase 0 frontend Processing screen
   *  polls/streams against transitions of this column. */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  /** Console S2 — owning workspace. Set automatically on create when
   *  the authed user has a workspace matching the URL host; legacy /
   *  anonymous scans stay NULL (the console's "Unassigned" bucket).
   *  ON DELETE SET NULL: deleting a workspace unlinks, never destroys
   *  scan data. */
  workspaceId: uuid('workspace_id').references(() => siteWorkspaces.id, {
    onDelete: 'set null',
  }),

  // Site capture (Stagehand-driven, Phase 1B)
  captureScreenshotUrls: jsonb('capture_screenshot_urls').$type<string[]>(),
  captureCompletedAt: timestamp('capture_completed_at'),
  /** Ch1-style objective page facts measured at capture time (no LLM).
   *  Behavior-sim spike transfer (2026-06-10): grounds persona prompts
   *  and renders the report's "measured" strip. Null on legacy scans. */
  captureSignals: jsonb('capture_signals').$type<{
    visible_word_count: number;
    link_count: number;
    cta_count: number;
    nav_menu_labels: string[];
    popup_detected: boolean;
    login_wall: boolean;
  }>(),

  // Authenticated multi-screen capture (Phase 1, 2026-06-16) — populated
  // when the scan's workspace has a stored auth session. Holds the
  // post-login key screens + their structure (actions/nav from the
  // accessibility tree) so personas and the report see the real product
  // behind the gate, not just the login wall. null on ordinary scans.
  authCapture: jsonb('auth_capture').$type<{
    screens: {
      path: string;
      url: string;
      title: string;
      screenshotUrl: string;
      actions: string[];
      nav: string[];
    }[];
  }>(),

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

  /** Friction clustering cache (Phase 1C-B). Populated by
   *  services/dimensions/frictions.ts::clusterFrictions(scanId)
   *  after the persona response loop completes. Null until clustered. */
  frictionsJson: jsonb('frictions_json').$type<Array<{
    rank: number;
    title: string;
    summary: string;
    n: number;
    where: string;
    impact: string;
    quote: string;
    affected_cohorts: string[];
  }>>(),

  /** Mode B pass/fail verdict (Phase 2-A). 'pass' if cohort_fit_score
   *  ≥60, 'conditional' if 40-60, 'fail' if <40. Null for Mode A
   *  scans (no single audience to verdict against). */
  modeBVerdict: varchar('mode_b_verdict', { length: 20 }),

  /** Mode B parsed selector (Phase 2-A). Result of
   *  audience_parser.ts on `targetAudienceText`. Surfaced in the
   *  GET response so the operator can see what selector axes the
   *  scan actually used. Null for Mode A. */
  modeBParsedSelector: jsonb('mode_b_parsed_selector'),

  /** Phase 5 — Site-specific custom survey questions. Generated by
   *  services/dimensions/custom_questions.ts via a Haiku call right
   *  after site_classifier in the scan pipeline. 3-5 questions per
   *  scan, mixing Likert (1-5) and free-text. The survey UI renders
   *  these in addition to the fixed §11.1 question set; survey_responses.
   *  custom_answers stores the per-respondent values keyed by question id.
   *  Null until the pipeline writes them; empty array if generation
   *  failed (caller doesn't block scan progress on this). */
  customQuestions: jsonb('custom_questions').$type<Array<{
    id: string;
    type: 'likert' | 'text';
    question: string;
    dimension_hint?: 'engagement' | 'task_success' | 'happiness' | 'adoption' | 'retention';
  }>>(),

  /** Phase 5 — Cached human-aggregate report. Populated by the
   *  POST /:id/human-aggregate handler when the operator clicks
   *  "Compare with humans" on the report page. Same shape as the
   *  AI report's aggregate fields but computed from survey_responses
   *  rows. Null until first compute; recomputed in place when the
   *  handler is called again (idempotent overwrite). */
  humanAggregate: jsonb('human_aggregate'),

  /** Privy-authed user that requested this scan (Phase 4 §1).
   *  Null for legacy/anonymous scans. FK → users.id with ON DELETE
   *  SET NULL so deleting a user preserves their public scans. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

  /** Solana base58 sig of the sponsored 0 USDC payment tx (D6).
   *  Set after the user signs + the tx confirms. Null until paid.
   *  Used by /me/analyses for Solscan link rendering and by Phase 5
   *  reward distribution to verify payment. */
  paymentTxSignature: text('payment_tx_signature'),

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

// ─── Users (Phase 4 §1 — Privy single-auth) ─────────
// One row per Privy-authenticated user. privy_id is the canonical
// identity (DID format like did:privy:c0123...). email + wallet are
// denormalized from Privy linked accounts for quick display and may
// be null until the user links them. Replaces the autotest-era
// testers/companies dichotomy with a single user concept.
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  privyId: text('privy_id').notNull().unique(),
  email: text('email'),
  walletAddress: text('wallet_address'),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Survey Responses (Phase 5 — Human comparison) ──
// Raw per-respondent storage for the human survey. Mirrors the AI
// side's scan_persona_responses but for human submissions, so the
// AI-shape aggregate pipeline (dimensions → cohort → friction
// clustering → AARRR) can be re-run against human data and produce
// a like-for-like human report.
//
// The /api/scan/:id/survey handler writes 5 rows to calibration_records
// (legacy operator-team aggregation) AND one raw row here per
// submission. Voice quotes, demographics, and per-scan custom-question
// answers are preserved verbatim — calibration_records loses all of
// those.
//
// Phase 5.1 — Privy auth required. user_id stamps the submission so a
// respondent can list / re-edit their own answers. The (scan_id,
// user_id) UNIQUE constraint enforces one row per (scan, user) for
// authenticated submissions; user_id IS NULL legacy rows are exempt
// (Postgres treats NULLs as distinct in UNIQUE), so the 3 pre-Privy
// email-only test rows survive.
export const surveyResponses = pgTable('survey_responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  scanId: uuid('scan_id')
    .notNull()
    .references(() => audienceFitScans.id, { onDelete: 'cascade' }),
  /** Phase 5.1 — Privy-authed user that submitted. NULL for legacy
   *  pre-auth submissions. UNIQUE with scan_id (see migration). */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Phase 5 (legacy) — anonymous email field. Nullable since Phase 5.1
   *  takes identity from Privy instead. Kept for backward-compat with
   *  the 3 pre-auth test rows. New submissions don't write this. */
  email: text('email'),
  /** SUS-10 raw responses (10 ints, 1-5). Same shape as the AI
   *  persona's sus_responses array. */
  susResponses: jsonb('sus_responses').$type<number[]>().notNull(),
  /** Categorical / numeric inputs that map to the 5 dimensions —
   *  identical key set to the AI persona JSON contract so the
   *  aggregator can treat humans like a 9th cohort. */
  dimensionInputs: jsonb('dimension_inputs').$type<{
    engagement_category: 'abandon' | 'skim' | 'browse' | 'engage' | 'extended';
    signup_likelihood: number; // 0-1
    retention_category: 'no_return' | 'weak' | 'moderate' | 'strong';
    completion_likelihood: number; // 0-1
  }>().notNull(),
  /** Free-text quotes — feed clusterFrictions() input alongside AI
   *  voice_biggest_friction strings. */
  voice: jsonb('voice').$type<{
    first_impression?: string;
    biggest_friction?: string;
    would_return_because?: string;
    if_could_change_one_thing?: string;
  }>().notNull(),
  /** Per-scan custom question answers. Keys are the question ids
   *  from audience_fit_scans.custom_questions; values are either
   *  ints 1-5 (Likert) or strings (text). Empty object when the
   *  scan has no custom questions. */
  customAnswers: jsonb('custom_answers').$type<Record<string, number | string>>().notNull().default({}),
  /** Self-reported demographics — same axes as personas.vector. Used
   *  for cohort matching when slicing human data. */
  demographics: jsonb('demographics').$type<{
    age_group: 'teen' | 'young_adult' | 'adult' | 'senior';
    tech_literacy: number; // 0-1
    crypto_experience: number; // 0-1
    mobile_first: boolean;
  }>().notNull(),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
}, (t) => ({
  // One row per (scan, authenticated user). Postgres treats NULL as
  // distinct, so legacy rows where user_id IS NULL stay exempt and
  // the 3 pre-Phase-5.1 anonymous rows survive.
  uniqScanUser: uniqueIndex('survey_responses_scan_user_uniq')
    .on(t.scanId, t.userId),
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

// ─── Partner pilot — point ledger (geulbat, 2026-06-10) ─────────────
// Internal points credited for partner-channel survey submissions.
// `email` is the provisional key for rows that arrive before the
// person ever logs into 41R; the privy_auth claim flow backfills
// `user_id` on first verified-email login. Currency/redemption policy
// is intentionally undecided — this is an append-only ledger so any
// future policy can be applied retroactively.
export const pointTransactions = pgTable('point_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Linked 41R user. NULL until the email is claimed via Privy login. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Provisional identity key (Google-verified on the partner side). */
  email: text('email'),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(), // e.g. 'survey' | 'reward_cap_reached'
  source: text('source').notNull(), // e.g. 'geulbat' | '41r'
  /** Console S2 — resource that earned the row (scan id for survey
   *  rewards). Backs the per-scan reward cap COUNT (30/scan, §12-7:
   *  cap state is disclosed BEFORE answering). Nullable — legacy rows
   *  predate it. */
  refId: uuid('ref_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Partner pilot — person profile (geulbat, 2026-06-10) ───────────
// Stream ① of the partner data model (profile / behavior / evaluation).
// One row per (source, email); the profile body is deliberately a
// flexible jsonb — the partner decides its own field vocabulary
// (recommended keys mirror the legacy testers.profile shape:
// age_range, region, occupation, expertise[], crypto_experience,
// ui_preference, languages[], device_types[], ...). This is the
// demographics raw material for persona-twin generation.
export const partnerProfiles = pgTable('partner_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  source: text('source').notNull(), // e.g. 'geulbat'
  email: text('email').notNull(),
  /** Linked 41R user — NULL until claimed on Privy login. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  profile: jsonb('profile').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqSourceEmail: uniqueIndex('partner_profiles_source_email_uniq').on(t.source, t.email),
}));

// ─── Partner pilot — behavior events (geulbat, 2026-06-10) ──────────
// Stream ② — usage tracking, batch-synced from the partner's own
// store. Event vocabulary is partner-defined (event_type + payload);
// 41R aggregates later (dwell, paths, return visits → behavioral
// traits for persona twins v2 + Mode C calibration ground truth).
export const partnerBehaviorEvents = pgTable('partner_behavior_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  source: text('source').notNull(),
  /** NULL for anonymous snippet events (GA-style device-only). When
   *  the same anon_id later identifies (data-uid token), new events
   *  carry the email; old anon rows can be joined retroactively via
   *  anon_id. */
  email: text('email'),
  /** Snippet device id (localStorage uuid) — present on snippet
   *  events, NULL on server-side S2S batches. */
  anonId: text('anon_id'),
  /** Linked 41R user — NULL until claimed on Privy login. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  sessionId: text('session_id'),
  eventType: text('event_type').notNull(), // e.g. 'pageview' | 'dwell' | 'leave'
  payload: jsonb('payload'),
  occurredAt: timestamp('occurred_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Site workspaces (Console Sprint 2, 2026-06-11) ─────────────────
// Registration ≠ ownership: a workspace is one user's analysis space
// for a URL host (GA-property model, console-ia-redesign.md §1.1).
// UNIQUE is (user_id, url_host) — deliberately NOT a global host
// unique: N users can each register the same site, fully isolated.
// Domain verification is permanently out of scope; being able to
// install the t.js snippet (site_key) is the natural ownership gate.
// Tier is emergent, not chosen: last_event_at IS NULL → LITE,
// otherwise TRACKED.
export const siteWorkspaces = pgTable('site_workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Normalized host — scheme + www stripped, lowercased. */
  urlHost: text('url_host').notNull(),
  name: text('name'),
  /** Public tracking key (GA measurement-id semantics) — routes
   *  beacons only, grants NO read access. */
  siteKey: text('site_key').notNull().unique(),
  /** S2S + HMAC handoff secret — sha256 hex only; plaintext is shown
   *  exactly once at issue/rotation. No read access either: a leaked
   *  secret can only inject fake data, never exfiltrate (§3.3). */
  secretHash: text('secret_hash').notNull(),
  secretLast4: text('secret_last4').notNull(),
  /** Last beacon received through this workspace's site_key —
   *  TRACKED-tier flag + the "Last event: 2m ago" settings display. */
  lastEventAt: timestamp('last_event_at'),
  /** Anchor scan — the canonical 41R analysis of this site that partner
   *  surveys attach to (the AI↔human compare pair). Set automatically to
   *  the FIRST completed scan linked to this workspace and then left
   *  stable, so partners never pass a scanId and re-scans don't move
   *  where human responses land.
   *  NOTE: the FK (audience_fit_scans.id, ON DELETE SET NULL) lives in
   *  migration 0016, NOT a Drizzle `.references()` — a `.references()`
   *  here would create a circular table reference with
   *  audienceFitScans.workspaceId and break TS type inference (TS7022). */
  anchorScanId: uuid('anchor_scan_id'),
  /** Authenticated-capture session (Phase 1, 2026-06-16) — AES-256-GCM
   *  encrypted Playwright storageState (services/crypto_box.ts). Lets the
   *  scanner reach login-gated screens by reusing a human's session.
   *  Bearer-equivalent secret: never returned to a client. null = none. */
  authSessionEnc: text('auth_session_enc'),
  authSessionUpdatedAt: timestamp('auth_session_updated_at'),
  /** Key screens to capture for this site (paths or absolute URLs). When
   *  null, capture falls back to the start URL + a bounded nav crawl. */
  capturePaths: jsonb('capture_paths').$type<string[]>(),
  /** Capture at a mobile viewport (phone frame). Mobile-first apps render
   *  a centered phone on a blurred desktop background, which a desktop
   *  capture mis-reads as a modal (geulbat, 2026-06-16). null/false =
   *  desktop 1280×800. */
  captureMobile: boolean('capture_mobile'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqUserHost: uniqueIndex('site_workspaces_user_host_uniq').on(t.userId, t.urlHost),
}));

// ─── Credit ledger (Console Sprint 1, 2026-06-11) ───────────────────
// Founder-side spend currency — separate from point_transactions
// (tester-side earn currency); the two stay distinct on purpose so
// each policy can move independently (docs/console-ia-redesign.md §4.3).
// Append-only, same contract as point_transactions: never UPDATE or
// DELETE a row; corrections/refunds/expiry are new rows. Balance is
// SUM(amount_cents).
//
// Reasons in use: 'signup_bonus' (+3000, verified identity) |
// 'signup_bonus_wallet' (+500, wallet-only signup) |
// 'signup_bonus_upgrade' (+2500, wallet-only later links email/social)
// | 'scan_mode_a' (-200) | 'scan_mode_b' (-100) | 'scan_refund'
// (pipeline failed — positive, mirrors the debit) | 'manual_grant'
// (operator top-up) | 'expiry'.
export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** USD cents. Grants positive, debits negative. */
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  /** Resource that caused the row — scan id for debits/refunds. */
  refId: uuid('ref_id'),
  /** Grant rows only. Recorded from day one (90-day policy) but NOT
   *  enforced during the pilot — the expiry batch ships together with
   *  top-up billing (v2). console-ia-redesign.md §12 decision 3. */
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  byUser: index('credit_transactions_user_idx').on(t.userId),
  // Debit/refund lookups by scan (refund idempotency check).
  byRef: index('credit_transactions_ref_idx').on(t.refId),
  // One signup-bonus grant of each kind per user. The append-only ledger
  // has many rows per user, so this is a PARTIAL unique index scoped to
  // the three bonus reasons only — the DB backstop against the
  // ensureSignupBonus concurrency race (allows signup_bonus_wallet +
  // signup_bonus_upgrade to coexist; blocks a second signup_bonus).
  signupUnique: uniqueIndex('credit_transactions_signup_unique')
    .on(t.userId, t.reason)
    .where(
      sql`${t.reason} IN ('signup_bonus','signup_bonus_wallet','signup_bonus_upgrade')`,
    ),
}));
