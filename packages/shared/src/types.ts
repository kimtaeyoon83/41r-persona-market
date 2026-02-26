// ─── Company ─────────────────────────────────────────
export interface Company {
  wallet_address: string;
  company_name: string;
  domain?: string;
  created_at: string;
}

// ─── Test ────────────────────────────────────────────
export type TestStatus = 'pending' | 'active' | 'completed';

export interface Test {
  id: string;
  company_addr: string;
  target_url: string;
  requirements?: string;
  budget_usdc: number;
  status: TestStatus;
  escrow_pda?: string;
  screenshot_urls?: string[];
  created_at: string;
}

// ─── Test Cases ──────────────────────────────────────
export type TestCaseType = 'checklist' | 'scenario' | 'questionnaire';

export interface ChecklistItem {
  id: string;
  task: string;
  expected: string;
}

export interface ScenarioItem {
  id: string;
  persona_type: string;
  narrative: string;
  evaluation_points: string[];
}

export interface QuestionnaireItem {
  id: string;
  question: string;
  type: 'rating_1_5' | 'rating_1_10' | 'free_text';
}

export interface TestCase {
  id: string;
  test_id: string;
  type: TestCaseType;
  content: ChecklistItem | ScenarioItem | QuestionnaireItem;
  order: number;
}

export interface GeneratedTestCases {
  checklist: ChecklistItem[];
  scenarios: ScenarioItem[];
  questionnaire: QuestionnaireItem[];
}

// ─── Tester ──────────────────────────────────────────
export interface TesterProfile {
  expertise: string[];
  experience_level: string;
  preferred_domains: string[];
  ui_preference: string;
  languages: string[];
  device_types: string[];
}

export interface Tester {
  wallet_address: string;
  display_name: string;
  profile?: TesterProfile;
  tests_done: number;
  persona_id?: string;
  created_at: string;
}

// ─── Test Report ─────────────────────────────────────
export interface ChecklistResult {
  id: string;
  status: 'passed' | 'failed' | 'blocked';
  memo: string;
}

export interface ScenarioLogEntry {
  time: string;
  action: string;
  screenshot?: string;
}

export interface ScenarioLog {
  id: string;
  timeline: ScenarioLogEntry[];
}

export interface QuestionnaireAnswer {
  id: string;
  answer: string | number;
}

export interface TestReport {
  id: string;
  tester_addr: string;
  test_id: string;
  checklist_results?: ChecklistResult[];
  scenario_log?: ScenarioLog[];
  questionnaire_answers?: QuestionnaireAnswer[];
  quality_score?: number;
  is_persona_test: boolean;
  screenshots?: string[];
  created_at: string;
}

// ─── Persona ─────────────────────────────────────────
export interface TestStyle {
  thoroughness: number;
  speed: number;
  ux_focus: number;
  bug_detection: number;
  creativity: number;
}

export interface Expertise {
  defi: number;
  nft: number;
  gaming: number;
  ai_tools: number;
  general_web: number;
}

export interface FeedbackPattern {
  ui_critical: number;
  security_aware: number;
  performance_sensitive: number;
  accessibility_focus: number;
  detail_oriented: number;
}

export interface Reliability {
  quality_score: number;
  consistency: number;
  response_rate: number;
}

export interface PersonaVector {
  test_style: TestStyle;
  expertise: Expertise;
  feedback_pattern: FeedbackPattern;
  reliability: Reliability;
  voice_sample: string;
}

export interface Persona {
  id: string;
  tester_addr: string;
  vector: PersonaVector;
  is_active: boolean;
  sas_attest_id?: string;
  created_at: string;
  updated_at: string;
}

// ─── Settlement ──────────────────────────────────────
export type SettlementType = 'usdc' | '41r';

export interface Settlement {
  id: string;
  test_id: string;
  report_id?: string;
  payer_addr: string;
  payee_addr: string;
  amount_token: number;
  fee_collected?: number;
  hook_tx_sig?: string;
  tx_signature?: string;
  settlement_type: SettlementType;
  settled_at: string;
}

// ─── API Request/Response types ──────────────────────
export interface RegisterTestRequest {
  target_url: string;
  requirements?: string;
  budget_usdc: number;
  company_wallet: string;
}

export interface RegisterTestResponse {
  test: Test;
  test_cases: GeneratedTestCases;
}

export interface SubmitReportRequest {
  tester_addr: string;
  test_id: string;
  checklist_results: ChecklistResult[];
  scenario_log: ScenarioLog[];
  questionnaire_answers: QuestionnaireAnswer[];
  screenshots?: string[];
}

export interface SubmitReportResponse {
  report: TestReport;
  quality_score: number;
  reward_amount: number;
  tx_signature: string;
  persona_triggered: boolean;
}

export interface AutoTestRequest {
  test_id: string;
  persona_id: string;
}

export interface AutoTestStatus {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number;
  report_id?: string;
  error?: string;
}
