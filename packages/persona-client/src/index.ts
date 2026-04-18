/**
 * @41rpm/persona-client — Typed client for persona-engine HTTP service.
 *
 * Usage (from apps/api):
 *   import { PersonaEngineClient } from '@41rpm/persona-client';
 *   const engine = new PersonaEngineClient({ baseUrl: process.env.PERSONA_ENGINE_URL });
 *   const { job_id } = await engine.submitAnalysis({
 *     persona_id: 'tester_abc', url, task, mode: 'browser',
 *   });
 */

export type RunMode = 'text' | 'browser';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TesterProfile {
  age_range?: '10s' | '20s' | '30s' | '40s' | '50s' | '60+';
  region?: string;
  occupation?: string;
  expertise?: string[];
  experience_level?: 'beginner' | 'intermediate' | 'expert';
  crypto_experience?: 'none' | 'beginner' | 'intermediate' | 'advanced';
  preferred_domains?: string[];
  ui_preference?: string;
  languages?: string[];
  device_types?: string[];
  primary_device?: 'mobile' | 'desktop';
  display_name?: string;
}

export interface HealthResponse {
  status: 'ok';
  persona_agent_version: string;
  workspace: string;
}

export interface JobResponse {
  job_id: string;
  status: JobStatus;
  progress: number;
}

export interface ChecklistInput {
  id: string;
  task: string;
  expected?: string;
}

export interface QuestionnaireInput {
  id: string;
  question: string;
  type?: 'rating_1_5' | 'rating_1_10' | 'free_text';
}

export interface ChecklistResult {
  id: string;
  status: 'passed' | 'failed' | 'blocked';
  memo: string;
  matched_turn_idx: number | null;
}

export interface QuestionnaireAnswer {
  id: string;
  answer: string | number;
}

export interface UxScores {
  clarity: number;
  trust: number;
  efficiency: number;
  overall: number;
}

export interface PainPoint {
  severity: 'high' | 'medium' | 'low';
  description: string;
  evidence_turn: number | null;
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

export interface QualityBreakdown {
  quality_score: number;
  raw_score: number;
  persona_faithfulness: number;
  outcome_weight: number;
  checklist_pass_rate: number;
  has_predicates: boolean;
  weights: { faithfulness: number; outcome: number; checklist: number };
}

export interface JobResult {
  job_id: string;
  status: JobStatus;
  outcome: string | null;
  total_turns: number | null;
  duration_sec: number | null;
  report_id: string | null;
  report_path: string | null;
  error: string | null;
  new_observations: number;
  session_id: string | null;
  /**
   * Absolute filesystem paths to per-turn screenshot PNGs on the engine
   * host. The caller (apps/api) is responsible for uploading these to R2
   * or any other object store and translating to public URLs. The engine
   * itself does not upload.
   */
  screenshot_paths: string[];
  /** Per-checklist-item verdict — empty when no checklist was submitted. */
  checklist_results: ChecklistResult[];
  /** 1..5 aggregate derived from outcome + checklist + persona faithfulness. */
  quality_score: number | null;
  /** Sub-metrics that fed quality_score (for persistence / debugging). */
  quality_breakdown: QualityBreakdown | Record<string, never>;
  /** Persona-voiced answers for each questionnaire item. */
  questionnaire_answers: QuestionnaireAnswer[];
  /** Full UX report (ux_scores + pain_points + recommendations). */
  structured_report: StructuredReport | Record<string, never>;
}

export interface AnalysisRequest {
  persona_id: string;
  url: string;
  task: string;
  mode?: RunMode;
  /**
   * Checklist items the persona should evaluate against the session.
   * Results come back as ``JobResult.checklist_results``.
   */
  checklist?: ChecklistInput[];
  /**
   * Questionnaire items for the persona to answer in character.
   * Answers come back as ``JobResult.questionnaire_answers``.
   */
  questionnaire?: QuestionnaireInput[];
  /**
   * When true, the engine additionally produces a StructuredReport.
   */
  generate_report?: boolean;
}

export interface CohortAnalysisRequest {
  cohort_run_id: string;
  url: string;
  task: string;
  mode?: RunMode;
  max_workers?: number;
}

export interface CreatePersonaRequest {
  persona_id: string;
  profile: TesterProfile;
}

export interface ClientOptions {
  baseUrl: string;
  /** Request timeout in ms. Default 30s (health/status). Submit is async; no timeout concern. */
  timeoutMs?: number;
  /** Optional bearer token if you put the engine behind an auth gateway. */
  authToken?: string;
  /** Override fetch (for tests / edge). Default globalThis.fetch. */
  fetch?: typeof fetch;
}

export class PersonaEngineError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'PersonaEngineError';
  }
}

export class PersonaEngineClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly authToken?: string;
  private readonly _fetch: typeof fetch;

  constructor(opts: ClientOptions) {
    if (!opts.baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.authToken = opts.authToken;
    this._fetch = opts.fetch ?? globalThis.fetch;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health');
  }

  async listPersonas(): Promise<{ personas: string[] }> {
    return this.request('GET', '/personas');
  }

  async createPersona(req: CreatePersonaRequest): Promise<{ persona_id: string; status: string }> {
    return this.request('POST', '/personas', req);
  }

  async submitAnalysis(req: AnalysisRequest): Promise<JobResponse> {
    // Default mode is "browser" to match the engine (previously defaulted
    // to "text" here, causing a silent mismatch: callers that wanted a
    // real Playwright session got LLM-only predictions unless they set
    // mode explicitly). checklist/questionnaire/generate_report are
    // forwarded as-is; engine treats missing arrays as empty.
    return this.request('POST', '/analyses', { mode: 'browser', ...req });
  }

  async submitCohort(req: CohortAnalysisRequest): Promise<JobResponse> {
    return this.request('POST', '/cohort-analyses', { mode: 'text', max_workers: 5, ...req });
  }

  async getStatus(jobId: string): Promise<JobResponse> {
    return this.request('GET', `/analyses/${encodeURIComponent(jobId)}`);
  }

  async getResult(jobId: string): Promise<JobResult> {
    return this.request('GET', `/analyses/${encodeURIComponent(jobId)}/result`);
  }

  async listSessionScreenshots(
    sessionId: string,
  ): Promise<{ session_id: string; count: number; filenames: string[] }> {
    return this.request('GET', `/sessions/${encodeURIComponent(sessionId)}/screenshots`);
  }

  /**
   * Fetch a single screenshot PNG. Returns raw bytes so the caller can pipe
   * to R2 / local disk / elsewhere.
   */
  async fetchScreenshot(sessionId: string, filename: string): Promise<Uint8Array> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this._fetch(
        `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/screenshots/${encodeURIComponent(filename)}`,
        {
          method: 'GET',
          headers: this.authToken ? { authorization: `Bearer ${this.authToken}` } : {},
          signal: ctl.signal,
        },
      );
      if (!res.ok) {
        throw new PersonaEngineError(
          `fetchScreenshot ${filename} → ${res.status}`,
          res.status,
        );
      }
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Convenience: poll until job completes or errors out.
   * `pollIntervalMs` defaults to 3s, `maxWaitMs` to 10min.
   */
  async waitForResult(
    jobId: string,
    opts?: { pollIntervalMs?: number; maxWaitMs?: number },
  ): Promise<JobResult> {
    const interval = opts?.pollIntervalMs ?? 3_000;
    const deadline = Date.now() + (opts?.maxWaitMs ?? 10 * 60 * 1000);

    while (Date.now() < deadline) {
      const st = await this.getStatus(jobId);
      if (st.status === 'completed') return this.getResult(jobId);
      if (st.status === 'failed') {
        const final = await this.getResult(jobId).catch(() => null);
        throw new PersonaEngineError(
          `job ${jobId} failed: ${final?.error ?? 'unknown'}`,
          500,
          final,
        );
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new PersonaEngineError(`job ${jobId} timed out`, 408);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this._fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const text = await res.text();
      const parsed: unknown = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new PersonaEngineError(
          `persona-engine ${method} ${path} → ${res.status}`,
          res.status,
          parsed,
        );
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
