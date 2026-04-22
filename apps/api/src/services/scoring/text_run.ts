/**
 * Text-mode persona run — no browser, no Stagehand, no Playwright.
 * The persona imagines what the site would be like based on its voice
 * + expertise + the URL + task description, and produces a full report
 * (checklist predictions, questionnaire answers in persona voice,
 * structured pain-point forecast). This is the "simulation" axis in
 * the Jupiter-style diagnosis — paired with the "actual browsing"
 * stagehand_hybrid axis, the diagnosis can show where prediction and
 * reality diverge.
 *
 * A single Sonnet call emits the whole payload as one JSON object.
 * We then normalise it into the existing test_reports shape with
 * sentinel questionnaire rows (_structured_report / _quality_breakdown /
 * _source='text') so downstream consumers — diagnosis aggregator, UI
 * report page, comparison dashboard — don't need any schema change.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { client, withRoute, withRequestId } from '../anthropic_client.js';
import { SCORING_MODELS, parseJsonSafe } from '../llm.js';
import { computeQualityScore } from './quality.js';
import { buildPersonaSoul } from './persona_soul.js';
import type {
  ChecklistItem,
  ChecklistResult,
  ChecklistStatus,
  PainPoint,
  QuestionnaireAnswer,
  QuestionnaireItem,
  QuestionnaireType,
  SessionLog,
  StructuredReport,
  UxScores,
} from './types.js';

const SYSTEM_PROMPT = `당신은 주어진 AI 페르소나의 "예측 시뮬레이션" 을 수행합니다.
이 페르소나가 실제로 해당 웹사이트를 방문하지 않고, 자신의 전문성·voice·성향 만으로
"이 사이트에서 어떤 경험을 할 것 같다" 를 예측해서 체크리스트 판정 · 설문 답변 ·
구조화 리포트를 한 번에 출력합니다.

## 원칙
1. **페르소나 soul (직업·전문성·feedback_pattern·voice_sample) 을 완전히 내재화.** 답변 문체가 persona voice 와 일치해야 합니다.
2. **해당 URL 에 대한 일반 지식 + 페르소나 관점** 을 조합. 해당 도메인을 모른다면 "추측" 임을 memo 에 명시.
3. **과장/날조 금지.** 스크린샷을 본 것처럼 구체적 UI 요소 ("X 버튼 위치") 를 단언하지 마세요. 대신 "일반적으로 이런 사이트는...", "내 경험상..." 의 추론적 어조.
4. **이것은 시뮬레이션.** outcome 은 "실제로 테스트해보면 어떻게 끝날 것 같은가" 의 예측.
5. 체크리스트 memo 는 **예측 근거** 를 persona voice 로 1-2 문장. 설문 free_text 는 persona 의 예상 반응.

## 출력 (JSON object 만, 코드펜스 없이)

\`\`\`typescript
{
  "outcome": "task_complete" | "partial" | "abandoned" | "patience_exceeded" | "error",
  "narrative_summary": "3-5문장, 페르소나가 이 사이트에서 어떤 경험을 할 것으로 예측",
  "checklist_predictions": [
    {"id": "CL01", "status": "passed"|"failed"|"blocked", "memo": "예측 근거 1-2문장 (persona voice)", "matched_turn_idx": null}
  ],
  "questionnaire_answers": [
    {"id": "Q01", "answer": 정수 또는 문자열}
  ],
  "structured_report": {
    "summary": "2-4문장 예측 요약",
    "ux_scores": {"clarity": 0.0~1.0, "trust": 0.0~1.0, "efficiency": 0.0~1.0, "overall": 0.0~1.0},
    "pain_points": [{"severity": "high"|"medium"|"low", "description": "...", "evidence_turn": null}],
    "positive_signals": ["예측 강점 1", ...],
    "recommendations": ["개선 제안 1", ...]
  }
}
\`\`\`

## 규칙
- 체크리스트 각 item 에 대해 **반드시** prediction 생성 (누락 금지).
- 설문 각 item 에 대해 **반드시** 답변.
  * rating_1_5: 정수 1~5. 극단값(1·5) 은 강한 근거가 있을 때만.
  * rating_1_10: 정수 1~10. 5~8 범위 주 사용.
  * free_text: 1-3문장 한국어, persona voice, 추론적 어조.
- evidence_turn 은 text 모드에서 항상 null (실제 turn 이 없음).
- quality_score 는 시스템이 자동 계산하므로 출력 불필요.
`;

interface TextModeLLMOutput {
  outcome: SessionLog['outcome'];
  narrative_summary: string;
  checklist_predictions: Array<{
    id: string;
    status: string;
    memo: string;
    matched_turn_idx?: number | null;
  }>;
  questionnaire_answers: Array<{ id: string; answer: string | number }>;
  structured_report: {
    summary?: string;
    ux_scores?: Partial<UxScores>;
    pain_points?: Array<{ severity?: string; description?: string; evidence_turn?: number | null }>;
    positive_signals?: string[];
    recommendations?: string[];
  };
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 0.0;
  return Math.max(0.0, Math.min(1.0, n));
}

function coerceRating(type: QuestionnaireType, raw: unknown): string | number {
  if (type === 'free_text') return raw == null ? '' : String(raw);
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return type === 'rating_1_5' ? 3 : 5;
  if (type === 'rating_1_5') return Math.max(1, Math.min(5, Math.trunc(n)));
  if (type === 'rating_1_10') return Math.max(1, Math.min(10, Math.trunc(n)));
  return n;
}

export async function runTextModeAndPersist(args: {
  testId: string;
  personaId: string;
}): Promise<{
  reportId: string;
  outcome: string;
  qualityScore: number | null;
  screenshotUrls: string[];
  sessionId: string;
}> {
  const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, args.testId));
  if (!test) throw new Error(`test ${args.testId} not found`);

  const [persona] = await db.select().from(schema.personas).where(eq(schema.personas.id, args.personaId));
  if (!persona) throw new Error(`persona ${args.personaId} not found`);

  const [tester] = await db.select().from(schema.testers).where(eq(schema.testers.walletAddress, persona.testerAddr));

  const cases = await db.select().from(schema.testCases).where(eq(schema.testCases.testId, args.testId));
  const checklist = cases
    .filter((c) => c.type === 'checklist')
    .map((c) => c.content as ChecklistItem);
  const questionnaire = cases
    .filter((c) => c.type === 'questionnaire')
    .map((c) => c.content as QuestionnaireItem);

  const soulText = buildPersonaSoul({ persona: { id: persona.id, vector: persona.vector }, tester });

  const sessionId = `tx_${Math.random().toString(36).slice(2, 10)}`;
  const started = Date.now();

  const userMsg =
    '## 페르소나\n' + soulText + '\n\n' +
    '## 대상\n' +
    `URL: ${test.targetUrl}\n` +
    `요구사항/태스크: ${test.requirements || '(없음) — 일반 UX 평가'}\n\n` +
    '## 체크리스트 (JSON)\n' + JSON.stringify(
      checklist.map((c) => ({ id: c.id, task: c.task, expected: c.expected })),
      null, 2,
    ) + '\n\n' +
    '## 설문 (JSON)\n' + JSON.stringify(
      questionnaire.map((q) => ({ id: q.id, question: q.question, type: q.type })),
      null, 2,
    ) + '\n\n' +
    '위 페르소나가 해당 사이트를 방문하지 않고 예측 시뮬레이션을 수행하세요.';

  let parsed: TextModeLLMOutput;
  try {
    const resp = await withRoute('text_run', () =>
      withRequestId(`text:${args.testId.slice(0, 8)}:${args.personaId.slice(0, 8)}`, () =>
        client.messages.create({
          model: SCORING_MODELS.sonnet,
          max_tokens: 4000,
          temperature: 0.6, // slightly higher — persona voice shouldn't flatten
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMsg }],
        }),
      ),
    );
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const obj = parseJsonSafe(raw);
    if (!obj || typeof obj !== 'object') throw new Error('LLM did not return a JSON object');
    parsed = obj as TextModeLLMOutput;
  } catch (err) {
    throw new Error(
      `text_run LLM failed for persona ${args.personaId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Normalise checklist predictions — fill missing ids with failed/no evidence.
  const predById = new Map<string, TextModeLLMOutput['checklist_predictions'][number]>();
  for (const p of parsed.checklist_predictions ?? []) {
    if (p?.id) predById.set(String(p.id), p);
  }
  const checklistResults: ChecklistResult[] = checklist.map((it) => {
    const p = predById.get(it.id);
    const statusRaw = p?.status;
    const status: ChecklistStatus =
      statusRaw === 'passed' || statusRaw === 'failed' || statusRaw === 'blocked'
        ? statusRaw
        : 'failed';
    return {
      id: it.id,
      status,
      memo: String(p?.memo ?? '예측 데이터 없음').slice(0, 500),
      matched_turn_idx: null,
    };
  });

  // Normalise questionnaire answers — coerce per declared type.
  const ansById = new Map<string, string | number>();
  for (const a of parsed.questionnaire_answers ?? []) {
    if (a?.id) ansById.set(String(a.id), a.answer);
  }
  const questionnaireAnswers: QuestionnaireAnswer[] = questionnaire.map((q) => ({
    id: q.id,
    answer: coerceRating(q.type, ansById.get(q.id)),
  }));

  // Structured report — clamp/validate.
  const sr = parsed.structured_report ?? {};
  const ux: UxScores = {
    clarity: clamp01(sr.ux_scores?.clarity),
    trust: clamp01(sr.ux_scores?.trust),
    efficiency: clamp01(sr.ux_scores?.efficiency),
    overall: clamp01(sr.ux_scores?.overall),
  };
  const painPoints: PainPoint[] = (sr.pain_points ?? [])
    .map((pp): PainPoint | null => {
      const description = String(pp?.description ?? '').trim();
      if (!description) return null;
      const sev = pp?.severity;
      const severity = sev === 'high' || sev === 'medium' || sev === 'low' ? sev : 'low';
      return { severity, description, evidence_turn: null };
    })
    .filter((p): p is PainPoint => p !== null);
  const structuredReport: StructuredReport = {
    summary: String(sr.summary ?? '').trim() || parsed.narrative_summary || '',
    ux_scores: ux,
    pain_points: painPoints,
    positive_signals: (sr.positive_signals ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20),
    recommendations: (sr.recommendations ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20),
    persona_id: args.personaId,
    session_id: sessionId,
  };

  // Synthetic session_log — one narrative turn so scoring-style consumers
  // that walk turns[] don't trip on an empty array. No screenshots.
  const sessionLog: SessionLog = {
    session_id: sessionId,
    persona_id: args.personaId,
    url: test.targetUrl,
    task: test.requirements || `Predict UX at ${test.targetUrl}`,
    mode: 'text',
    outcome: parsed.outcome ?? 'task_complete',
    total_turns: 1,
    start_time: new Date(started).toISOString(),
    end_time: new Date().toISOString(),
    duration_sec: Number(((Date.now() - started) / 1000).toFixed(3)),
    turns: [
      {
        turn: 0,
        observation: {
          summary: `[text-mode 예측] ${parsed.narrative_summary ?? ''}`.slice(0, 800),
        },
        decision: {
          action: 'predict',
          reasoning: parsed.narrative_summary ?? '',
          done: true,
        },
        tool: null,
      },
    ],
    screenshot_paths: [],
  };

  const qualityBreakdown = computeQualityScore({
    sessionLog,
    checklistResults,
  });

  const enrichedAnswers = [
    ...questionnaireAnswers,
    { id: '_structured_report', answer: JSON.stringify(structuredReport) },
    { id: '_quality_breakdown', answer: JSON.stringify(qualityBreakdown) },
    { id: '_source', answer: 'text' },
  ];

  const [inserted] = await db
    .insert(schema.testReports)
    .values({
      testerAddr: persona.testerAddr,
      testId: args.testId,
      checklistResults: checklistResults.map((r) => ({
        id: r.id,
        status: r.status,
        memo: r.memo,
      })),
      scenarioLog: [],
      questionnaireAnswers: enrichedAnswers,
      qualityScore: qualityBreakdown.quality_score,
      isPersonaTest: true,
      sourceMode: 'text',
      screenshots: [],
    })
    .onConflictDoNothing({
      target: [
        schema.testReports.testerAddr,
        schema.testReports.testId,
        schema.testReports.isPersonaTest,
        schema.testReports.sourceMode,
      ],
    })
    .returning();

  if (!inserted) {
    throw new Error(
      `persona ${args.personaId} already has a text-mode report for test ${args.testId}`,
    );
  }

  return {
    reportId: inserted.id,
    outcome: sessionLog.outcome,
    qualityScore: qualityBreakdown.quality_score,
    screenshotUrls: [],
    sessionId,
  };
}
