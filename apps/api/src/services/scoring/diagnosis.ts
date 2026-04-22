/**
 * Final diagnosis synthesiser — takes every test_reports row for a test
 * (persona + human) and produces a Jupiter-style UX diagnosis in Korean
 * markdown. The shape is modelled on
 * 41r/experiments/public_analysis/JUPITER_UX_DIAGNOSIS.md so companies
 * who have read one of those will find the layout familiar.
 *
 * Two-stage pipeline:
 *
 *   1. aggregateForDiagnosis() — deterministic preprocessing. Rolls
 *      each persona report into completion stats, pain-point frequency,
 *      per-item pass/fail, quality distribution. No LLM. Keeps the
 *      numbers trustworthy (the Jupiter report's "수치 감사" depends
 *      on this layer being honest).
 *
 *   2. synthesizeDiagnosis() — single Sonnet call. Takes the
 *      aggregate + representative excerpts and writes narrative. Runs
 *      on review_proposer tier because this is the company's final
 *      artefact — using Haiku here produces mechanical list-output
 *      where Sonnet writes in the journalistic voice the reference
 *      report uses.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { client, withRoute } from '../anthropic_client.js';
import { SCORING_MODELS } from '../llm.js';

// ── Aggregate shapes ────────────────────────────────────────────────

interface PainPointCitation {
  severity: 'high' | 'medium' | 'low';
  description: string;
  personaTester: string; // tester addr prefix for attribution
}

interface PersonaSummary {
  testerAddr: string;
  isPersona: boolean;
  qualityScore: number | null;
  outcome: string;               // from quality_breakdown or fallback
  checklistPassed: number;
  checklistFailed: number;
  checklistBlocked: number;
  questionnaireFreeText: Array<{ id: string; question?: string; answer: string }>;
  uxScores?: Record<string, number>;
  painPoints: Array<{ severity: string; description: string }>;
  positiveSignals: string[];
  recommendations: string[];
  profile?: Record<string, unknown>; // tester.profile for demographics
  voiceSample?: string;              // persona voice snippet, if any
  reportId: string;
  source: string; // 'stagehand_hybrid' | 'text' | 'manual' | ...
}

interface ChecklistItemStats {
  id: string;
  task: string;
  passed: number;
  failed: number;
  blocked: number;
  total: number;
  passRate: number; // passed / (total - blocked)
}

export interface DiagnosisAggregate {
  testId: string;
  targetUrl: string;
  requirements: string;
  reportCount: number;
  personaCount: number;
  humanCount: number;
  generatedAt: string;
  qualityStats: {
    min: number;
    max: number;
    avg: number;
    distribution: number[]; // quality scores in order
  };
  checklistStats: ChecklistItemStats[];
  perPersona: PersonaSummary[];
  painPointFrequency: Array<{ description: string; count: number; citations: PainPointCitation[] }>;
  allPositiveSignals: string[];
  allRecommendations: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseSentinelJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeStr(s: string): string {
  // Crude normalisation for pain-point dedup. Strip whitespace + lower.
  // Real NLP similarity would be nicer; for MVP this catches obvious
  // duplicates like "로그인 벽 접근 불가" vs "로그인 벽 접근 불가 " .
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Aggregation (deterministic, no LLM) ─────────────────────────────

export async function aggregateForDiagnosis(testId: string): Promise<DiagnosisAggregate> {
  const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, testId));
  if (!test) throw new Error(`test ${testId} not found`);

  const reports = await db.select().from(schema.testReports).where(eq(schema.testReports.testId, testId));
  if (reports.length === 0) {
    return {
      testId,
      targetUrl: test.targetUrl,
      requirements: test.requirements ?? '',
      reportCount: 0,
      personaCount: 0,
      humanCount: 0,
      generatedAt: new Date().toISOString(),
      qualityStats: { min: 0, max: 0, avg: 0, distribution: [] },
      checklistStats: [],
      perPersona: [],
      painPointFrequency: [],
      allPositiveSignals: [],
      allRecommendations: [],
    };
  }

  // Checklist item metadata from test_cases for richer stats (task text).
  const cases = await db.select().from(schema.testCases).where(
    and(eq(schema.testCases.testId, testId), eq(schema.testCases.type, 'checklist')),
  );
  const checklistById = new Map<string, { task: string }>();
  for (const c of cases) {
    const content = c.content as { id?: string; task?: string };
    if (content?.id) checklistById.set(content.id, { task: content.task ?? content.id });
  }

  // Questionnaire metadata for question text lookup
  const qcases = await db.select().from(schema.testCases).where(
    and(eq(schema.testCases.testId, testId), eq(schema.testCases.type, 'questionnaire')),
  );
  const questionById = new Map<string, { question: string; type?: string }>();
  for (const c of qcases) {
    const content = c.content as { id?: string; question?: string; type?: string };
    if (content?.id) questionById.set(content.id, {
      question: content.question ?? content.id,
      type: content.type,
    });
  }

  // Persona metadata (voice_sample, vector) — one row per tester_addr
  // that owns a persona. Manual (human) reports won't hit this lookup.
  const allPersonas = await db.select().from(schema.personas);
  const personaByTester = new Map<string, typeof allPersonas[0]>();
  for (const p of allPersonas) personaByTester.set(p.testerAddr, p);

  // Tester profile lookup for demographics
  const allTesters = await db.select().from(schema.testers);
  const testerByAddr = new Map<string, typeof allTesters[0]>();
  for (const t of allTesters) testerByAddr.set(t.walletAddress, t);

  const perPersona: PersonaSummary[] = [];
  const checklistAgg = new Map<string, ChecklistItemStats>();
  const painPointMap = new Map<string, { count: number; citations: PainPointCitation[] }>();
  const allPositiveSignals = new Set<string>();
  const allRecommendations = new Set<string>();
  const quality: number[] = [];

  for (const r of reports) {
    const cl = (r.checklistResults as Array<{ id: string; status: string; memo: string }> | null) ?? [];
    let passed = 0, failed = 0, blocked = 0;
    for (const c of cl) {
      if (!checklistAgg.has(c.id)) {
        checklistAgg.set(c.id, {
          id: c.id,
          task: checklistById.get(c.id)?.task ?? c.id,
          passed: 0, failed: 0, blocked: 0, total: 0,
          passRate: 0,
        });
      }
      const stats = checklistAgg.get(c.id)!;
      stats.total += 1;
      if (c.status === 'passed') { passed += 1; stats.passed += 1; }
      else if (c.status === 'failed') { failed += 1; stats.failed += 1; }
      else if (c.status === 'blocked') { blocked += 1; stats.blocked += 1; }
    }

    const answers = (r.questionnaireAnswers as Array<{ id: string; answer: string | number }> | null) ?? [];
    const structured = parseSentinelJson<{
      summary?: string;
      ux_scores?: Record<string, number>;
      pain_points?: Array<{ severity: string; description: string; evidence_turn?: number | null }>;
      positive_signals?: string[];
      recommendations?: string[];
    }>(answers.find((a) => a.id === '_structured_report')?.answer);
    const qb = parseSentinelJson<{ outcome_weight?: number }>(
      answers.find((a) => a.id === '_quality_breakdown')?.answer,
    );
    const source = String(answers.find((a) => a.id === '_source')?.answer ?? (r.isPersonaTest ? 'persona' : 'manual'));

    // Outcome reconstruction from outcome_weight — not perfect, but
    // gives the synth prompt a label. Weight → outcome inverse lookup:
    const outcomeWeightToLabel: Array<[number, string]> = [
      [1.0, 'task_complete'],
      [0.65, 'partial'],
      [0.5, 'max_turns_hit'],
      [0.35, 'abandoned/patience_exceeded'],
      [0.15, 'error'],
    ];
    let outcome = 'unknown';
    if (qb?.outcome_weight != null) {
      const match = outcomeWeightToLabel.find(([w]) => Math.abs(w - qb.outcome_weight!) < 0.01);
      if (match) outcome = match[1];
    }

    const freeText = answers
      .filter((a) => !a.id.startsWith('_') && typeof a.answer === 'string' && a.answer.length > 10)
      .map((a) => ({
        id: a.id,
        question: questionById.get(a.id)?.question,
        answer: String(a.answer),
      }));

    const persona = personaByTester.get(r.testerAddr);
    const tester = testerByAddr.get(r.testerAddr);

    // Roll pain points into the frequency map with persona attribution.
    if (structured?.pain_points) {
      for (const pp of structured.pain_points) {
        if (!pp.description) continue;
        const key = normalizeStr(pp.description);
        if (!painPointMap.has(key)) painPointMap.set(key, { count: 0, citations: [] });
        const entry = painPointMap.get(key)!;
        entry.count += 1;
        entry.citations.push({
          severity: (pp.severity === 'high' || pp.severity === 'medium' || pp.severity === 'low')
            ? pp.severity : 'low',
          description: pp.description,
          personaTester: r.testerAddr.slice(0, 10),
        });
      }
    }
    for (const s of structured?.positive_signals ?? []) allPositiveSignals.add(s);
    for (const s of structured?.recommendations ?? []) allRecommendations.add(s);

    if (typeof r.qualityScore === 'number') quality.push(r.qualityScore);

    perPersona.push({
      testerAddr: r.testerAddr,
      isPersona: !!r.isPersonaTest,
      qualityScore: r.qualityScore,
      outcome,
      checklistPassed: passed,
      checklistFailed: failed,
      checklistBlocked: blocked,
      questionnaireFreeText: freeText,
      uxScores: structured?.ux_scores,
      painPoints: (structured?.pain_points ?? []).map((p) => ({
        severity: String(p.severity),
        description: String(p.description ?? ''),
      })).filter((p) => p.description),
      positiveSignals: structured?.positive_signals ?? [],
      recommendations: structured?.recommendations ?? [],
      profile: (tester?.profile ?? undefined) as Record<string, unknown> | undefined,
      voiceSample: persona?.vector
        ? (persona.vector as { voice_sample?: string }).voice_sample
        : undefined,
      reportId: r.id,
      source,
    });
  }

  // Compute checklist pass rates (excluding blocked from denom)
  for (const stats of checklistAgg.values()) {
    const denom = stats.total - stats.blocked;
    stats.passRate = denom > 0 ? stats.passed / denom : 0;
  }

  const qMin = quality.length > 0 ? Math.min(...quality) : 0;
  const qMax = quality.length > 0 ? Math.max(...quality) : 0;
  const qAvg = quality.length > 0 ? quality.reduce((a, b) => a + b, 0) / quality.length : 0;

  // Sort pain points by frequency desc, checklist by pass rate asc (worst first)
  const painPointFrequency = [...painPointMap.entries()]
    .map(([_, v]) => ({
      description: v.citations[0].description, // first-seen variant as canonical
      count: v.count,
      citations: v.citations,
    }))
    .sort((a, b) => b.count - a.count);

  const checklistStats = [...checklistAgg.values()].sort((a, b) => a.passRate - b.passRate);

  return {
    testId,
    targetUrl: test.targetUrl,
    requirements: test.requirements ?? '',
    reportCount: reports.length,
    personaCount: reports.filter((r) => r.isPersonaTest).length,
    humanCount: reports.filter((r) => !r.isPersonaTest).length,
    generatedAt: new Date().toISOString(),
    qualityStats: {
      min: Number(qMin.toFixed(2)),
      max: Number(qMax.toFixed(2)),
      avg: Number(qAvg.toFixed(2)),
      distribution: quality.map((q) => Number(q.toFixed(2))),
    },
    checklistStats,
    perPersona,
    painPointFrequency,
    allPositiveSignals: [...allPositiveSignals],
    allRecommendations: [...allRecommendations],
  };
}

// ── LLM synthesis ───────────────────────────────────────────────────

const SYNTH_SYSTEM = `당신은 UX 리서치 분석가입니다. 여러 AI 페르소나 + 인간 테스터의 개별 리포트를 종합해, 회사 의사결정자에게 전달할 **단일 UX 진단 리포트** 를 한국어 마크다운으로 작성합니다.

## 참고 모델
이미 공개 사례가 있는 "Jupiter UX 진단" 포맷을 따르세요. 구조:
1. 헤더 (대상 URL · 요청 맥락 · 표본 수 · 생성 날짜)
2. **한 문장 결론** — bold 한 줄로 핵심 verdict
3. 페르소나/테스터 표본 테이블 (누가 참여했나)
4. 도달률 / 품질 분포 테이블
5. **어디서 막히는가** — 1순위, 2순위, 3순위 (pain_point 빈도 기반). 각 항목마다 페르소나 인용문 1~2개
6. **개선 권고** R1, R2, R3, ... — 현재 / 변경 / 임팩트 형식
7. 신뢰도 섹션 — "이 리포트에서 믿을 수 있는 것 / 믿지 말아야 할 것"
8. 수치 감사표 (제공되는 숫자가 원본 데이터와 일치하는지)
9. 부록 A (생성 과정) · 부록 B (원본 데이터 위치)

## 원칙
- **숫자는 제공된 aggregate 데이터에서만 사용.** 인구통계·표본 수·체크리스트 통과율 등은 aggregate 필드 그대로 인용. 새 숫자를 만들지 마세요.
- **인용문은 questionnaireFreeText 필드에서만.** 다른 persona 가 한 말을 섞지 마세요. 페르소나 정체성(직업·연령)을 같이 표기.
- **페르소나 voice_sample** 이 있으면 해당 persona 성향을 보존한 언어로 인용 해석.
- **'session_limited' 카테고리를 숨기지 마세요.** 어떤 persona 가 세션 중도 이탈했다면 그것도 진단의 일부.
- severity=high 는 태스크 실패를 유발한 마찰만.
- **검증 불가한 A/B 수치 약속 금지** — "R1 적용 시 +X% 개선" 같은 문장 만들지 마세요.

## 출력 형식
\`\`\`markdown
# {대상 URL} UX 진단 리포트

> **대상**: {targetUrl}
> **요청사항**: {requirements}
> **표본**: 페르소나 N + 인간 M = 총 K회 세션
> **생성일**: {date}

---

## 한 문장 결론
...
\`\`\`

전체 출력은 마크다운 한 덩어리로, 코드펜스 없이 바로 출력하세요. 헤더 레벨은 \`#\` (최상위) / \`##\` (섹션) / \`###\` (서브섹션) 으로 통일.
`;

export async function synthesizeDiagnosis(
  aggregate: DiagnosisAggregate,
): Promise<string> {
  if (aggregate.reportCount === 0) {
    return '# 진단 불가\n\n아직 이 테스트에 제출된 리포트가 없습니다. 최소 3건의 리포트가 쌓인 뒤 다시 시도하세요.';
  }

  // Prepare trimmed aggregate for the prompt — the full persona list
  // with all free-text answers is too verbose, so we send a lighter
  // view with top 5 pain points and per-persona highlights.
  const trimmed = {
    testId: aggregate.testId,
    targetUrl: aggregate.targetUrl,
    requirements: aggregate.requirements,
    generatedAt: aggregate.generatedAt,
    sampleCounts: {
      total: aggregate.reportCount,
      persona: aggregate.personaCount,
      human: aggregate.humanCount,
    },
    qualityStats: aggregate.qualityStats,
    checklistStats: aggregate.checklistStats.map((c) => ({
      id: c.id,
      task: c.task.slice(0, 200),
      passed: c.passed,
      failed: c.failed,
      blocked: c.blocked,
      total: c.total,
      passRate: Number(c.passRate.toFixed(2)),
    })),
    perPersona: aggregate.perPersona.map((p) => ({
      testerAddrShort: p.testerAddr.slice(0, 10),
      isPersona: p.isPersona,
      source: p.source,
      qualityScore: p.qualityScore,
      outcome: p.outcome,
      checklist: { passed: p.checklistPassed, failed: p.checklistFailed, blocked: p.checklistBlocked },
      uxScores: p.uxScores,
      profile: p.profile ? {
        age_range: (p.profile as { age_range?: string }).age_range,
        occupation: (p.profile as { occupation?: string }).occupation,
        region: (p.profile as { region?: string }).region,
        crypto_experience: (p.profile as { crypto_experience?: string }).crypto_experience,
      } : undefined,
      voiceSample: p.voiceSample?.slice(0, 160),
      freeText: p.questionnaireFreeText.slice(0, 4).map((q) => ({
        id: q.id,
        q: q.question?.slice(0, 120),
        a: q.answer.slice(0, 350),
      })),
      painPoints: p.painPoints.slice(0, 4),
      topRecommendations: p.recommendations.slice(0, 3),
    })),
    painPointFrequency: aggregate.painPointFrequency.slice(0, 10).map((pp) => ({
      description: pp.description.slice(0, 280),
      count: pp.count,
      samplePersonas: pp.citations.slice(0, 3).map((c) => c.personaTester),
    })),
    commonPositiveSignals: aggregate.allPositiveSignals.slice(0, 10),
    commonRecommendations: aggregate.allRecommendations.slice(0, 15),
  };

  const userMsg = `다음 aggregate 데이터로 UX 진단 리포트를 작성하세요.\n\n` +
    `## Aggregate\n\`\`\`json\n${JSON.stringify(trimmed, null, 2)}\n\`\`\`\n\n` +
    `위 데이터에서만 수치 / 인용문을 끌어오고, Jupiter 스타일 리포트를 한국어로 출력하세요.`;

  const resp = await withRoute('diagnosis', () =>
    client.messages.create({
      model: SCORING_MODELS.sonnet,
      max_tokens: 8000,
      temperature: 0.4,
      system: SYNTH_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    }),
  );

  const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
  // Strip any wrapping code fences the model added despite instructions.
  const fenceMatch = raw.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/);
  return (fenceMatch ? fenceMatch[1] : raw).trim();
}

// ── Convenience: full generation + persist ──────────────────────────

export async function generateAndStoreDiagnosis(testId: string): Promise<{
  markdown: string;
  reportCount: number;
  generatedAt: Date;
}> {
  const aggregate = await aggregateForDiagnosis(testId);
  const markdown = await synthesizeDiagnosis(aggregate);
  const now = new Date();
  await db.update(schema.tests).set({
    diagnosisMd: markdown,
    diagnosisGeneratedAt: now,
    diagnosisReportCount: aggregate.reportCount,
  }).where(eq(schema.tests.id, testId));
  return { markdown, reportCount: aggregate.reportCount, generatedAt: now };
}
