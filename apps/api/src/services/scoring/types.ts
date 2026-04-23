/**
 * Shared types for the in-process scoring pipeline.
 *
 * Ported from apps/persona-engine's pydantic/dataclass definitions so the
 * Node autotest path can run checklist + questionnaire + structured_report
 * without crossing the Python HTTP boundary. Field names match the
 * upstream wire format produced by /analyses/score so existing consumers
 * (test_reports.checklist_results, test_reports.questionnaire_answers,
 * dashboards, scripts/usage-summary.ts) keep working unchanged.
 *
 * See apps/persona-engine/{adapters,scorers,report_generator,questionnaire_generator}.py
 * for the reference implementation.
 */

// ─── Session Log ────────────────────────────────────────────────────

export type SessionOutcome =
  | 'task_complete'
  | 'partial'
  | 'max_turns_hit'
  | 'abandoned'
  | 'patience_exceeded'
  | 'error';

export interface SessionTurn {
  turn: number;
  observation: {
    summary: string;
    /** Full page text snippet captured per-step. Optional for back-compat
     *  with the thin session log Stagehand TS initially produced. */
    page_text?: string;
    url?: string;
    title?: string;
    /** Accessibility tree snippet (interesting-only, truncated). */
    a11y?: string;
  };
  decision: {
    action?: string;
    reasoning?: string;
    instruction?: string;
    done?: boolean;
    key_behaviors?: string;
    frustration_points?: string;
  };
  tool: {
    tool: string;
    target?: string;
    selector?: string;
  } | null;
  result?: {
    ok?: boolean;
    duration_ms?: number;
  };
}

export interface SessionLog {
  session_id: string;
  persona_id: string;
  url: string;
  task: string;
  mode: 'browser' | 'text';
  outcome: SessionOutcome | string;
  total_turns: number;
  start_time: string; // ISO 8601
  end_time: string;   // ISO 8601
  duration_sec: number;
  turns: SessionTurn[];
  screenshot_paths: string[];
  /** Environmental obstacles (auth walls, cookie banners, etc.)
   *  registered by the browser-quirk harness during the run. Keyed by
   *  quirk name → hit count. The diagnosis aggregator surfaces this
   *  so synthesis prompts can tell "low coverage caused by X banner"
   *  apart from "low coverage because product is genuinely broken". */
  quirks?: Record<string, number>;
}

// ─── Checklist ──────────────────────────────────────────────────────

export type ChecklistStatus = 'passed' | 'failed' | 'blocked';

export interface ChecklistItem {
  id: string;
  task: string;
  expected?: string;
}

export interface ChecklistResult {
  id: string;
  status: ChecklistStatus;
  memo: string;
  matched_turn_idx: number | null;
}

// ─── Questionnaire ──────────────────────────────────────────────────

export type QuestionnaireType = 'rating_1_5' | 'rating_1_10' | 'free_text';

export interface QuestionnaireItem {
  id: string;
  question: string;
  type: QuestionnaireType;
}

export interface QuestionnaireAnswer {
  id: string;
  answer: string | number;
}

// ─── Structured Report ──────────────────────────────────────────────

export type Severity = 'high' | 'medium' | 'low';

export interface PainPoint {
  severity: Severity;
  description: string;
  evidence_turn: number | null;
}

export interface UxScores {
  clarity: number;     // 0.0..1.0
  trust: number;
  efficiency: number;
  overall: number;
}

export interface StructuredReport {
  summary: string;
  ux_scores: UxScores;
  pain_points: PainPoint[];
  positive_signals: string[];
  recommendations: string[];
  persona_id: string;
  session_id: string;
}

// ─── Quality Breakdown ──────────────────────────────────────────────

export interface QualityWeights {
  faithfulness: number;
  outcome: number;
  checklist: number;
}

export interface QualityBreakdown {
  quality_score: number;          // 1.05..4.95 (Phase F float, clamped)
  raw_score: number;              // 0.0..1.0 (blended)
  persona_faithfulness: number;   // 0.0..1.0 (always 0 until predicate scorer lands)
  outcome_weight: number;         // 0.0..1.0
  checklist_pass_rate: number;    // 0.0..1.0 (passed / (total - blocked))
  has_predicates: boolean;
  weights: QualityWeights;
}

// ─── Persona Soul (derived from DB, replaces persona_agent's markdown) ─

export interface PersonaSoulContext {
  persona_id: string;
  /** Plain-text "soul" the questionnaire LLM ingests. Built from the
   *  persona row's vector + the linked tester's profile. See
   *  services/scoring/persona_soul.ts. */
  soul_text: string;
}
