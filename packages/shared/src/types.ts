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
  // Basic demographics
  age_range?: '10s' | '20s' | '30s' | '40s' | '50s' | '60+';
  region?: string;              // e.g. "KR", "US", "JP"
  occupation?: string;          // e.g. "student", "developer", "designer", "marketer", "trader"

  // Tech & crypto background
  expertise: string[];          // e.g. ["defi", "nft", "web3"]
  experience_level: string;     // e.g. "beginner", "intermediate", "expert"
  crypto_experience?: 'none' | 'beginner' | 'intermediate' | 'advanced';

  // Testing preferences
  preferred_domains: string[];  // e.g. ["defi", "gaming", "saas"]
  ui_preference: string;        // e.g. "minimal", "rich", "dark_mode"
  languages: string[];          // e.g. ["ko", "en"]
  device_types: string[];       // e.g. ["mobile", "desktop", "tablet"]
  primary_device?: 'mobile' | 'desktop';

  // Design & UX sensitivity
  design_matters?: boolean;     // "디자인이 중요하다고 생각하시나요?"
  frustration_triggers?: string[]; // e.g. ["slow loading", "confusing navigation", "small text"]
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

export interface Demographics {
  age_group: 'teen' | 'young_adult' | 'adult' | 'senior';  // 10대, 20-30대, 30-50대, 50대+
  tech_literacy: number;       // 0=비기술, 1=개발자 수준
  crypto_experience: number;   // 0=처음, 1=전문 트레이더
  design_sensitivity: number;  // 0=기능만, 1=디자인 매우 중시
  patience_level: number;      // 0=즉시 이탈, 1=끝까지 탐색
}

export interface UxPreferences {
  visual_style: 'minimal' | 'rich' | 'playful' | 'professional'; // 선호 디자인 톤
  font_size_preference: number;   // 0=작은 글씨 OK, 1=큰 글씨 필요
  information_density: number;    // 0=심플, 1=데이터 많을수록 좋음
  animation_tolerance: number;    // 0=애니메이션 싫음, 1=좋아함
  color_contrast_need: number;    // 0=낮은 대비 OK, 1=높은 대비 필요
  mobile_first: boolean;          // 주로 모바일 사용자인지
}

export interface PersonaVector {
  test_style: TestStyle;
  expertise: Expertise;
  feedback_pattern: FeedbackPattern;
  reliability: Reliability;
  demographics?: Demographics;
  ux_preferences?: UxPreferences;
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
