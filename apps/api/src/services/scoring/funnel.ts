/**
 * Auto-extracted funnel for a test.
 *
 * Two-pass Haiku pipeline:
 *   1. extractFurthestStep(report) — given a single persona session's
 *      structured_report + last actions, the LLM emits a freeform
 *      "the persona reached X before stopping" string.
 *   2. clusterFunnelSteps(strings[]) — semantic clustering across all
 *      sessions to canonicalize step labels (the "Connect Wallet" /
 *      "지갑 연결" / "wallet popup" trio collapses into one cluster).
 *      Reuses the same prompt pattern as scoring/diagnosis.ts:
 *      clusterPainPointDescriptions().
 *
 * Result is shaped for direct UI rendering:
 *   { steps: [{label, count, percentage}, ...], totalSessions }
 *
 * Design notes:
 *   - Sorted by reach order: the cluster the most personas reached
 *     comes first (≈ Step 1 of the journey). Drop-off is implicit
 *     in the percentage gradient (100% → ... → 12%).
 *   - Identity-map fallback when LLM clustering fails — still ships a
 *     funnel, just with one cluster per unique extraction string.
 *   - Cost: ~$0.005 per session (extraction) + ~$0.003 per test
 *     (clustering) → 100-persona test ≈ $0.50.
 *   - Cached in tests.funnelJson; route handler decides when to
 *     regenerate based on funnel_report_count vs current persona count.
 */
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { client, withRoute } from '../anthropic_client.js';
import { SCORING_MODELS } from '../llm.js';

export interface FunnelStep {
  /** Canonical step label (e.g. "지갑 연결 단계") */
  label: string;
  /** Number of distinct persona sessions that reached this step */
  count: number;
  /** count / totalSessions × 100, rounded to integer */
  percentage: number;
}

export interface FunnelResult {
  steps: FunnelStep[];
  totalSessions: number;
  /** Per-session raw extractions kept for audit / regeneration debugging.
   *  UI doesn't need to render these; the route can omit from the
   *  response payload if size becomes an issue. */
  rawExtractions: Array<{ reportId: string; furthestStep: string }>;
  generatedAt: string;
}

/**
 * Pure clustering helper — given freeform "furthest step reached"
 * strings, return canonical-label → list of source indices.
 * Mirrors scoring/diagnosis.ts:clusterPainPointDescriptions exactly,
 * with a funnel-specific prompt.
 */
export async function clusterFunnelSteps(
  descriptions: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(descriptions.map((d) => d.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();
  if (unique.length === 1) return new Map([[unique[0], unique[0]]]);

  const system = `당신은 UX 리서치 애널리스트입니다. 페르소나가 "어디까지 도달했는지" 설명한 문장들을 의미적으로 같은 단계끼리 묶으세요.

## 원칙
- 같은 사이트 단계(예: "지갑 연결 모달까지" / "Connect Wallet 클릭" / "wallet popup")는 하나의 cluster.
- 표현은 다르지만 같은 UI 흐름의 같은 위치를 가리키면 같은 cluster.
- 애매하면 분리 (false merge가 false split보다 해롭습니다).
- 각 cluster에 짧은 canonical 한국어 라벨(최대 30자) 부여.
- 라벨은 "어디까지 도달" 형태가 아닌 그 step 자체 ("지갑 연결" / "결제 모달" / "체크아웃").

## 출력 (JSON object 만)
{
  "clusters": [
    {"canonical": "지갑 연결", "members": [0, 2, 5]},
    {"canonical": "결제 모달", "members": [1, 4]},
    ...
  ]
}
모든 index가 정확히 한 cluster에 속해야 합니다.`;

  const user = `## 도달 단계 설명\n${unique.map((d, i) => `${i}: ${d}`).join('\n')}`;

  try {
    const resp = await withRoute('funnel.cluster_steps', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 2000,
        temperature: 0.1,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    );
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) throw new Error('no JSON object');
    const parsed = JSON.parse(raw.slice(start, end)) as {
      clusters?: Array<{ canonical?: string; members?: number[] }>;
    };

    const map = new Map<string, string>();
    const seen = new Set<number>();
    for (const c of parsed.clusters ?? []) {
      const canonical = String(c.canonical ?? '').trim();
      if (!canonical) continue;
      for (const idx of c.members ?? []) {
        if (typeof idx !== 'number' || idx < 0 || idx >= unique.length) continue;
        if (seen.has(idx)) continue;
        seen.add(idx);
        map.set(unique[idx], canonical);
      }
    }
    // Index left out by the LLM falls back to its raw string as its own
    // cluster — better to under-merge than drop a session.
    for (let i = 0; i < unique.length; i += 1) {
      if (!seen.has(i)) map.set(unique[i], unique[i]);
    }
    return map;
  } catch (err) {
    console.warn('[funnel] step clustering failed; falling back to identity map:',
      err instanceof Error ? err.message : err);
    return new Map(unique.map((d) => [d, d]));
  }
}

/**
 * Pure aggregation helper — bucket extractions into canonical clusters
 * + sort by reach count descending. Exported for unit testing without
 * spinning up DB or LLM.
 */
export function buildFunnelFromExtractions(
  extractions: Array<{ reportId: string; furthestStep: string }>,
  clusterMap: Map<string, string>,
): FunnelResult {
  const counts = new Map<string, number>();
  for (const ex of extractions) {
    const canonical = clusterMap.get(ex.furthestStep.trim()) ?? ex.furthestStep.trim();
    if (!canonical) continue;
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }
  const totalSessions = extractions.length;
  const steps: FunnelStep[] = [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percentage: totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
  return {
    steps,
    totalSessions,
    rawExtractions: extractions,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Per-session LLM extraction. Inspects the structured report (when
 * present — that's where pain points + summary live) to determine the
 * furthest step the persona reached. Falls back to a literal "분석 불가"
 * string if extraction fails — that string forms its own cluster, and
 * the UI will see it as a low-percentage trailing bar (visible but
 * clearly low-confidence).
 */
async function extractFurthestStep(args: {
  structuredReportJson: string | null;
  qualityScore: number | null;
  source: string;
}): Promise<string> {
  if (!args.structuredReportJson) {
    // Without a structured_report sentinel we have nothing structured
    // to feed the LLM — bail with the lowest-confidence label.
    return '분석 불가 (structured report 없음)';
  }

  const system = `당신은 UX 분석가입니다. 페르소나의 테스트 세션 결과를 보고, 그 페르소나가 사이트의 어느 흐름 단계까지 도달했는지 한 문장으로 요약하세요.

## 출력 형식
"<단계 이름>까지 도달, <짧은 사유>"

예시:
- "지갑 연결 모달까지 도달, 서명 단계에서 멈춤"
- "결제 페이지까지 도달, 카드 정보 입력 못함"
- "랜딩 페이지에서 멈춤, CTA 클릭 안 함"

## 원칙
- 단계 이름은 사이트의 명시적 UI 요소 기반 (모달/페이지/섹션).
- 한국어 한 문장 (최대 50자).
- "task_complete" 라면 "최종 단계 완료" 류로 표현.`;

  const user = `## 구조화 리포트\n${args.structuredReportJson.slice(0, 2000)}\n\nquality_score=${args.qualityScore ?? 'n/a'}, source=${args.source}`;

  try {
    const resp = await withRoute('funnel.extract_step', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 200,
        temperature: 0.1,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    );
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const cleaned = raw.trim().replace(/^["']|["']$/g, '').slice(0, 200);
    return cleaned || '분석 불가 (빈 응답)';
  } catch (err) {
    console.warn('[funnel] step extraction failed:',
      err instanceof Error ? err.message : err);
    return '분석 불가 (LLM 오류)';
  }
}

/**
 * Top-level entry: compute funnel for a test from its persona reports.
 * Reads test_reports rows where isPersonaTest=true, extracts per-session
 * furthest step (parallel Haiku), clusters, builds FunnelResult.
 *
 * Caller is responsible for caching the result on tests.funnelJson +
 * gating regeneration on stale (current persona_count > funnelReportCount).
 */
export async function generateFunnelForTest(testId: string): Promise<FunnelResult> {
  const reports = await db
    .select({
      id: schema.testReports.id,
      qualityScore: schema.testReports.qualityScore,
      questionnaireAnswers: schema.testReports.questionnaireAnswers,
      sourceMode: schema.testReports.sourceMode,
    })
    .from(schema.testReports)
    .where(and(
      eq(schema.testReports.testId, testId),
      eq(schema.testReports.isPersonaTest, true),
    ));

  if (reports.length === 0) {
    return {
      steps: [],
      totalSessions: 0,
      rawExtractions: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Per-session extraction — parallelized. Each call is one Haiku
  // request. Throttling is handled by the SDK; on a 100-session test
  // expect ~5-10s wall-clock for this stage.
  const extractions = await Promise.all(
    reports.map(async (r) => {
      const answers = (r.questionnaireAnswers as Array<{ id: string; answer: string | number }> | null) ?? [];
      const structuredReportRaw = answers.find((a) => a.id === '_structured_report')?.answer;
      const structuredReportJson = typeof structuredReportRaw === 'string' ? structuredReportRaw : null;
      const furthestStep = await extractFurthestStep({
        structuredReportJson,
        qualityScore: r.qualityScore,
        source: r.sourceMode,
      });
      return { reportId: r.id, furthestStep };
    }),
  );

  const clusterMap = await clusterFunnelSteps(extractions.map((e) => e.furthestStep));
  return buildFunnelFromExtractions(extractions, clusterMap);
}
