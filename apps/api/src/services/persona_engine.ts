/**
 * services/persona_engine.ts — apps/api ↔ apps/persona-engine 브릿지.
 *
 * 기존 services/autotest.ts (Stagehand)가 자체 브라우저를 돌리는 것과 달리,
 * 이 서비스는 Python persona_agent를 감싼 persona-engine HTTP 서비스를
 * 호출합니다. 스크린샷은 engine이 디스크에 저장 → 이 서비스가 HTTP로 fetch
 * → 기존 r2.ts로 업로드 → DB 저장.
 *
 * 전환 전략: 새 autotest 요청은 env flag (`USE_PERSONA_ENGINE=1`)일 때 이
 * 서비스로 라우팅. 기본은 기존 Stagehand 경로 유지.
 */
import {
  PersonaEngineClient,
  type AnalysisRequest,
  type ChecklistInput,
  type ChecklistResult,
  type JobResult,
  type QualityBreakdown,
  type QuestionnaireAnswer,
  type QuestionnaireInput,
  type StructuredReport,
  type TesterProfile,
} from '@41rpm/persona-client';
import { uploadToR2 } from './r2.js';

const ENGINE_URL = process.env.PERSONA_ENGINE_URL ?? 'http://persona-engine:4200';

let _client: PersonaEngineClient | null = null;

function client(): PersonaEngineClient {
  if (!_client) {
    _client = new PersonaEngineClient({
      baseUrl: ENGINE_URL,
      timeoutMs: 60_000,
      authToken: process.env.PERSONA_ENGINE_AUTH_TOKEN,
    });
  }
  return _client;
}

export interface RunAutoTestArgs {
  /** Tester wallet address or any stable unique ID, used as persona_id. */
  personaId: string;
  /** Profile to build soul from if persona not yet registered. */
  testerProfile: TesterProfile;
  /** Target URL for the test (from the company's `tests` row). */
  url: string;
  /** Natural-language task for the persona to perform. */
  task: string;
  /** Max wait before giving up. Defaults 10min. */
  maxWaitMs?: number;
  /**
   * browser: real Playwright session with screenshots (~2min, expensive).
   * text: LLM-only prediction (~10s, no screenshots).
   */
  mode?: 'browser' | 'text';
  /** Checklist items to have the persona evaluate. */
  checklist?: ChecklistInput[];
  /** Questionnaire items for the persona to answer in character. */
  questionnaire?: QuestionnaireInput[];
  /** Ask the engine to also produce a structured UX report. */
  generateReport?: boolean;
}

export interface AutoTestResult {
  /** task_complete | abandoned | partial */
  outcome: string;
  totalTurns: number;
  durationSec: number | null;
  sessionId: string | null;
  /** R2 URLs after upload (ready for test_reports.screenshots[]). */
  screenshotUrls: string[];
  /** Per-item checklist verdict (empty when no checklist was submitted). */
  checklistResults: ChecklistResult[];
  /** 1..5 aggregate score. */
  qualityScore: number | null;
  /** Sub-metrics that fed qualityScore. */
  qualityBreakdown: QualityBreakdown | Record<string, never>;
  /** Persona-voiced questionnaire answers. */
  questionnaireAnswers: QuestionnaireAnswer[];
  /** Full UX report (pain_points, recommendations, ux_scores). */
  structuredReport: StructuredReport | Record<string, never>;
  /** Raw engine response for audit. */
  raw: JobResult;
}

/**
 * Run a single-persona browser autotest via persona-engine.
 *
 * Flow:
 *   1. Ensure persona exists in engine (create if missing)
 *   2. Submit analysis → job_id
 *   3. Poll until completed
 *   4. Fetch screenshots via HTTP
 *   5. Upload each to R2 (existing r2.ts)
 *   6. Return outcome + screenshot URLs
 *
 * Caller (routes/autotest.ts) is responsible for USDC verification,
 * DB writes (test_reports), and reward settlement — same as the existing
 * Stagehand path.
 */
export async function runAutoTestWithEngine(
  args: RunAutoTestArgs,
): Promise<AutoTestResult> {
  const c = client();

  // 1. Register persona if not already there
  const { personas } = await c.listPersonas();
  if (!personas.includes(args.personaId)) {
    await c.createPersona({
      persona_id: args.personaId,
      profile: args.testerProfile,
    });
  }

  // 2. Submit + wait. Forward checklist/questionnaire/generate_report
  // so the engine returns scoring + structured report in the same job.
  const analysisReq: AnalysisRequest = {
    persona_id: args.personaId,
    url: args.url,
    task: args.task,
    mode: args.mode ?? 'browser',
    checklist: args.checklist,
    questionnaire: args.questionnaire,
    generate_report: args.generateReport ?? false,
  };
  const { job_id } = await c.submitAnalysis(analysisReq);
  const result = await c.waitForResult(job_id, {
    maxWaitMs: args.maxWaitMs ?? 10 * 60_000,
    pollIntervalMs: 3_000,
  });

  // 3. Fetch + upload screenshots (engine host → R2). Only browser mode
  // produces screenshots; text mode returns [] and we skip the loop.
  const screenshotUrls: string[] = [];
  if (result.session_id && (args.mode ?? 'browser') === 'browser') {
    const { filenames } = await c.listSessionScreenshots(result.session_id);
    for (const fn of filenames) {
      try {
        const bytes = await c.fetchScreenshot(result.session_id, fn);
        const key = `screenshots/autotest_${result.session_id}_${fn}`;
        const url = await uploadToR2(key, Buffer.from(bytes));
        screenshotUrls.push(url);
      } catch (err) {
        console.warn(`[persona_engine] screenshot upload failed: ${fn}`, err);
      }
    }
  }

  return {
    outcome: result.outcome ?? 'unknown',
    totalTurns: result.total_turns ?? 0,
    durationSec: result.duration_sec,
    sessionId: result.session_id,
    screenshotUrls,
    checklistResults: result.checklist_results ?? [],
    qualityScore: result.quality_score,
    qualityBreakdown: result.quality_breakdown ?? {},
    questionnaireAnswers: result.questionnaire_answers ?? [],
    structuredReport: result.structured_report ?? {},
    raw: result,
  };
}

/**
 * Whether new autotest requests should be routed through the engine.
 * Set `USE_PERSONA_ENGINE=1` in Railway env after engine is deployed.
 */
export function isEngineEnabled(): boolean {
  return process.env.USE_PERSONA_ENGINE === '1';
}
