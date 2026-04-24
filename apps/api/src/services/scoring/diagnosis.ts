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
import {
  computePerItemAgreement,
  pearson,
  spearman,
  type ChecklistItemResult,
  type ChecklistStatus,
} from '../comparison.js';

// ── Aggregate shapes ────────────────────────────────────────────────

interface PainPointCitation {
  severity: 'high' | 'medium' | 'low';
  description: string;
  personaTester: string;      // tester addr prefix for attribution
  reportId: string;           // audit chain: which report row spawned this pain point
  evidenceTurn: number | null; // session-log turn index from upstream structured_report
  isPersona: boolean;          // split "human-confirmed" vs "persona-only" at render time
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
  painPoints: Array<{ severity: string; description: string; evidenceTurn: number | null }>;
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
  /** Browser-quirk hits summed across every persona session that ran
   *  in browser mode. Keyed by quirk name; values are total hits.
   *  Feeds into the synthesis prompt so the LLM can contextualise
   *  low-coverage sessions ("12 auth_wall hits across 3 browser runs
   *  → the site's checklist coverage here reflects an automation
   *  limitation, not a product defect"). */
  quirksEncountered: Record<string, number>;
  /** Fidelity snapshot — agreement between persona and human reports.
   *  Drives the "trust this diagnosis" banner prepended to the
   *  synthesis output. `itemAgreementRate` / `pairedCount` are `null`
   *  when either side has zero reports (no comparison possible). */
  fidelity: {
    itemAgreementRate: number | null;
    pairedCount: number;
    spearman: number | null;
    /** Overall verdict: 'high' / 'medium' / 'low' / 'n/a'. Computed
     *  from the thresholds in `computeFidelityBand()`. */
    band: 'high' | 'medium' | 'low' | 'n/a';
  };
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
  // Crude fallback used only when semantic clustering is unavailable
  // (empty input, LLM failure). The production path in
  // clusterPainPointDescriptions() groups "로그인 벽 접근 불가" with
  // "지갑 연결 시 진입 차단" — something a whitespace-and-lowercase
  // match could never catch.
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Group pain-point descriptions into semantic clusters via a single
 * Haiku batch call. Returns a description → canonical-key map the
 * aggregate builder uses as the dedup key, so "로그인 벽 접근 불가"
 * (persona) and "지갑 연결 시 진입 차단" (human) collapse into one
 * frequency-map entry — which is the only way the "both" confirmation
 * label can fire in a corpus where humans and personas phrase the
 * same problem differently.
 *
 * Cost ~$0.0015/diagnosis (one batched call, negligible tokens).
 * Failure mode: each description is its own cluster (identity map),
 * matching the pre-Task-#13 behaviour so a transient LLM outage
 * doesn't lose us the diagnosis entirely.
 *
 * Exported so tests can exercise the parse path without DB fixtures.
 */
export async function clusterPainPointDescriptions(
  descriptions: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(descriptions.map((d) => d.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();
  if (unique.length === 1) return new Map([[unique[0], unique[0]]]);

  const system = `당신은 UX 리서치 애널리스트입니다. 제품 pain point 설명 문장들을 의미적으로 같은 문제끼리 묶으세요.

## 원칙
- 같은 근본 문제(예: "로그인 벽 접근 불가" / "지갑 연결 시 진입 차단" / "Cannot proceed without wallet")는 하나의 cluster 로.
- 표현은 다르지만 같은 UI 요소·같은 실패 mode 를 지칭하면 같은 cluster.
- 애매하면 분리 (false merge 가 false split 보다 해롭습니다).
- 각 cluster 에 짧은 canonical 한국어 라벨(최대 40자) 부여.

## 출력 (JSON object 만)
{
  "clusters": [
    {"canonical": "지갑 연결 벽에 의한 진입 차단", "members": [0, 2, 5]},
    {"canonical": "트랜잭션 내역 미제공", "members": [1, 4]},
    ...
  ]
}
모든 index 가 정확히 한 cluster 에 속해야 합니다.`;

  const user = `## Pain points\n${unique.map((d, i) => `${i}: ${d}`).join('\n')}`;

  try {
    const resp = await withRoute('diagnosis.cluster_pain_points', () =>
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
        if (seen.has(idx)) continue; // LLM assigned the same description to two clusters — keep the first
        seen.add(idx);
        map.set(unique[idx], canonical);
      }
    }
    // Any index the LLM left out falls back to its original string as
    // its own cluster — better to under-merge than drop a pain point.
    for (let i = 0; i < unique.length; i += 1) {
      if (!seen.has(i)) map.set(unique[i], unique[i]);
    }
    return map;
  } catch (err) {
    console.warn('[diagnosis] pain-point clustering failed; falling back to identity map:',
      err instanceof Error ? err.message : err);
    return new Map(unique.map((d) => [d, d]));
  }
}

/**
 * Fidelity bands — how much should a reader trust this diagnosis's
 * persona-derived findings? The thresholds intentionally match
 * services/findings.ts so the experiment dashboard and the diagnosis
 * give the same verdict for the same test.
 *   high   — paired ≥ 5, itemAgreementRate ≥ 0.6
 *   medium — paired ≥ 5, itemAgreementRate 0.4–0.6
 *   low    — everything else that has some paired data
 *   n/a    — no paired humans ↔ personas, so no fidelity to compute
 */
export function computeFidelityBand(
  itemAgreementRate: number | null,
  pairedCount: number,
): 'high' | 'medium' | 'low' | 'n/a' {
  if (pairedCount === 0 || itemAgreementRate === null) return 'n/a';
  if (pairedCount >= 5 && itemAgreementRate >= 0.6) return 'high';
  if (pairedCount >= 5 && itemAgreementRate >= 0.4) return 'medium';
  return 'low';
}

/**
 * Extract pain_points from a human manual report's free-text answers
 * via a single Haiku call. Human submissions have no `_structured_report`
 * sentinel (that's produced by persona-engine on persona runs), so
 * without this pass the diagnosis's confirmation labels would always
 * be "persona-only" — humans never get a seat at the table.
 *
 * Returns the extracted pain_points (empty on failure — we never
 * block diagnosis generation on an enrichment step). Cost is
 * ~$0.001/report at review_inspection tier.
 */
async function extractHumanPainPoints(args: {
  reportId: string;
  freeText: Array<{ id: string; question?: string; answer: string }>;
  checklistCounts: { passed: number; failed: number; blocked: number };
}): Promise<Array<{ severity: 'high' | 'medium' | 'low'; description: string }>> {
  if (args.freeText.length === 0) return [];

  const system = `당신은 UX 리서치 애널리스트입니다. 인간 테스터가 직접 작성한 설문 답변에서 제품의 UX 페인 포인트만 추출하세요.

## 원칙
- 답변에 실제로 언급된 문제만 추출. 없는 내용 지어내지 마세요.
- severity=high: 태스크 실패를 유발하거나 대안이 없을 정도의 마찰.
- severity=medium: 진행은 가능하지만 혼란/좌절 발생.
- severity=low: 개선 여지 수준의 사소한 관찰.
- 긍정적 소감·제안은 제외 — 페인 포인트만.

## 출력 (JSON object만)
{
  "pain_points": [
    {"severity": "high|medium|low", "description": "구체적 문제 한 문장"}
  ]
}`;

  const ftBody = args.freeText
    .slice(0, 8)
    .map((q) => `Q[${q.id}] ${q.question?.slice(0, 120) ?? ''}\nA: ${q.answer.slice(0, 500)}`)
    .join('\n\n');
  const user = `## 체크리스트 요약\npassed=${args.checklistCounts.passed} failed=${args.checklistCounts.failed} blocked=${args.checklistCounts.blocked}\n\n## 설문 답변\n${ftBody}`;

  try {
    const resp = await withRoute('diagnosis.human_pain_points', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 800,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    );
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) return [];
    const parsed = JSON.parse(raw.slice(start, end)) as {
      pain_points?: Array<{ severity?: string; description?: string }>;
    };
    const out: Array<{ severity: 'high' | 'medium' | 'low'; description: string }> = [];
    for (const p of parsed.pain_points ?? []) {
      const desc = String(p.description ?? '').trim();
      if (!desc) continue;
      const sev = p.severity === 'high' || p.severity === 'medium' || p.severity === 'low' ? p.severity : 'low';
      out.push({ severity: sev, description: desc });
      if (out.length >= 10) break; // cap so one chatty report can't dominate the frequency map
    }
    return out;
  } catch (err) {
    // Non-fatal — we still emit the diagnosis. The manual report just
    // contributes no pain_points this pass (same effective state as
    // before Task #12 existed).
    console.warn(`[diagnosis] human pain-point extraction failed for report=${args.reportId}:`,
      err instanceof Error ? err.message : err);
    return [];
  }
}

function fidelityBannerKor(f: DiagnosisAggregate['fidelity']): string {
  const pct = f.itemAgreementRate === null ? 'n/a' : `${Math.round(f.itemAgreementRate * 100)}%`;
  const sp = f.spearman === null ? 'n/a' : f.spearman.toFixed(2);
  const common = `체크리스트 일치율 ${pct} · 품질 Spearman ρ ${sp} · paired=${f.pairedCount}`;
  switch (f.band) {
    case 'high':
      return `> ✅ **신뢰도: 높음** — 페르소나와 인간의 판정이 강하게 일치. 이 리포트의 페르소나 기반 finding 들은 인간 관찰의 대리 지표로 사용 가능.\n> \`${common}\``;
    case 'medium':
      return `> 🟡 **신뢰도: 중간** — 페르소나가 일부 항목에서 인간과 어긋남. finding 은 "방향 지시자"로 읽고 중요한 결정은 인간 리포트로 교차 확인 권장.\n> \`${common}\``;
    case 'low':
      return `> ⚠️ **신뢰도: 낮음** — 페르소나와 인간의 판정이 크게 엇갈림. persona-only 로 라벨된 finding 은 제품 결함이 아닌 페르소나 아티팩트일 가능성이 높음. 인간 리포트 위주로 해석하세요.\n> \`${common}\``;
    case 'n/a':
      return `> ℹ️ **신뢰도: 측정 불가** — 이 테스트에서 동일 테스터의 manual+persona 페어가 없어 일치도를 계산할 수 없습니다. 진단은 단일 관점(페르소나 또는 인간)에 한정.\n> \`${common}\``;
  }
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
      quirksEncountered: {},
      fidelity: { itemAgreementRate: null, pairedCount: 0, spearman: null, band: 'n/a' },
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
  const quirksEncountered: Record<string, number> = {};

  // Pre-pass: for each manual report that has no `_structured_report`
  // sentinel yet, extract pain_points from its free-text with a single
  // Haiku call. Runs in parallel so a test with 20 humans adds ~2s,
  // not 20s. Keyed by reportId so the main loop can look them up.
  const humanPainPointsByReport = new Map<string, Array<{ severity: 'high' | 'medium' | 'low'; description: string }>>();
  const humanExtractionTasks: Promise<void>[] = [];
  for (const r of reports) {
    if (r.isPersonaTest) continue;
    const answers = (r.questionnaireAnswers as Array<{ id: string; answer: string | number }> | null) ?? [];
    if (answers.some((a) => a.id === '_structured_report')) continue;
    const freeText = answers
      .filter((a) => !a.id.startsWith('_') && typeof a.answer === 'string' && a.answer.length > 10)
      .map((a) => ({
        id: a.id,
        question: questionById.get(a.id)?.question,
        answer: String(a.answer),
      }));
    const cl = (r.checklistResults as Array<{ id: string; status: string }> | null) ?? [];
    let p = 0, f = 0, b = 0;
    for (const c of cl) {
      if (c.status === 'passed') p += 1;
      else if (c.status === 'failed') f += 1;
      else if (c.status === 'blocked') b += 1;
    }
    humanExtractionTasks.push(
      extractHumanPainPoints({
        reportId: r.id,
        freeText,
        checklistCounts: { passed: p, failed: f, blocked: b },
      }).then((pts) => {
        humanPainPointsByReport.set(r.id, pts);
      }),
    );
  }
  if (humanExtractionTasks.length > 0) {
    await Promise.all(humanExtractionTasks);
  }

  // Pre-pass: collect every pain-point description (persona-engine
  // sentinel + Task-#12 human extraction) and semantic-cluster them
  // in one Haiku call. The cluster canonical becomes the dedup key
  // for painPointMap — the only way "both"-confirmed pain points
  // emerge when humans and personas phrase the same issue differently.
  const descriptionsForClustering: string[] = [];
  for (const r of reports) {
    const answers = (r.questionnaireAnswers as Array<{ id: string; answer: string | number }> | null) ?? [];
    const structured = parseSentinelJson<{
      pain_points?: Array<{ description?: string }>;
    }>(answers.find((a) => a.id === '_structured_report')?.answer);
    const source = structured?.pain_points ?? humanPainPointsByReport.get(r.id) ?? [];
    for (const pp of source) {
      if (pp.description) descriptionsForClustering.push(String(pp.description));
    }
  }
  const clusterMap = await clusterPainPointDescriptions(descriptionsForClustering);

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

    // Sum _quirks sentinel into aggregate counter.
    const quirksSentinel = parseSentinelJson<Record<string, number>>(
      answers.find((a) => a.id === '_quirks')?.answer,
    );
    if (quirksSentinel) {
      for (const [k, v] of Object.entries(quirksSentinel)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          quirksEncountered[k] = (quirksEncountered[k] ?? 0) + v;
        }
      }
    }

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

    // Roll pain points into the frequency map with full audit-chain
    // attribution. Each citation points back to the exact row + session
    // turn that produced it — the synthesis prompt and downstream UI can
    // both use these to prove a claim isn't hallucinated.
    //
    // Source of truth priority:
    //   1. `structured?.pain_points` — persona-engine's LLM extraction
    //      on persona runs, or a sentinel-backed manual pipeline if one
    //      was ever added upstream.
    //   2. `humanPainPointsByReport` — Task-#12 Haiku pass we just
    //      ran for manual reports without a sentinel. Without this the
    //      confirmation label was always "persona-only" and both /
    //      human-only were dead code.
    const painSource = structured?.pain_points
      ?? humanPainPointsByReport.get(r.id)?.map((p) => ({
        severity: p.severity,
        description: p.description,
        evidence_turn: null as number | null,
      }))
      ?? [];
    for (const pp of painSource) {
      if (!pp.description) continue;
      // Semantic cluster canonical is the dedup key; falls back to
      // the normalised string when the clusterer had nothing to say
      // about this description (empty map / LLM failure path).
      const canonical = clusterMap.get(String(pp.description).trim());
      const key = canonical ? normalizeStr(canonical) : normalizeStr(pp.description);
      if (!painPointMap.has(key)) painPointMap.set(key, { count: 0, citations: [] });
      const entry = painPointMap.get(key)!;
      entry.count += 1;
      entry.citations.push({
        severity: (pp.severity === 'high' || pp.severity === 'medium' || pp.severity === 'low')
          ? pp.severity : 'low',
        description: pp.description,
        personaTester: r.testerAddr.slice(0, 10),
        reportId: r.id,
        evidenceTurn: typeof pp.evidence_turn === 'number' ? pp.evidence_turn : null,
        isPersona: !!r.isPersonaTest,
      });
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
      painPoints: (structured?.pain_points
        ?? humanPainPointsByReport.get(r.id)?.map((p) => ({
          severity: p.severity,
          description: p.description,
          evidence_turn: null as number | null,
        }))
        ?? [])
        .map((p) => ({
          severity: String(p.severity),
          description: String(p.description ?? ''),
          evidenceTurn: typeof p.evidence_turn === 'number' ? p.evidence_turn : null,
        }))
        .filter((p) => p.description),
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
  // Prefer the cluster's LLM-chosen canonical label when available so the
  // rollup title reads "지갑 연결 벽에 의한 진입 차단" rather than whichever
  // raw persona phrasing happened to arrive first.
  const clusterCanonicalByKey = new Map<string, string>();
  for (const canonical of new Set(clusterMap.values())) {
    clusterCanonicalByKey.set(normalizeStr(canonical), canonical);
  }
  const painPointFrequency = [...painPointMap.entries()]
    .map(([k, v]) => ({
      description: clusterCanonicalByKey.get(k) ?? v.citations[0].description,
      count: v.count,
      citations: v.citations,
    }))
    .sort((a, b) => b.count - a.count);

  const checklistStats = [...checklistAgg.values()].sort((a, b) => a.passRate - b.passRate);

  // ── Fidelity snapshot: matches the /api/reports/compare pairing
  // logic so the diagnosis banner and the experiment dashboard agree.
  const manualReports = reports.filter((r) => !r.isPersonaTest);
  const personaReports = reports.filter((r) => r.isPersonaTest);
  const manualChecklists = manualReports.map((r) =>
    (r.checklistResults as Array<{ id: string; status: ChecklistStatus }> | null) ?? [],
  ) as ChecklistItemResult[][];
  const personaChecklists = personaReports.map((r) =>
    (r.checklistResults as Array<{ id: string; status: ChecklistStatus }> | null) ?? [],
  ) as ChecklistItemResult[][];
  const { overallAgreementRate } = manualChecklists.length > 0 && personaChecklists.length > 0
    ? computePerItemAgreement(manualChecklists, personaChecklists)
    : { overallAgreementRate: null as number | null };

  const manualByTester = new Map<string, number>();
  for (const r of manualReports) manualByTester.set(r.testerAddr, r.qualityScore ?? 0);
  const pairedManual: number[] = [];
  const pairedPersona: number[] = [];
  for (const p of personaReports) {
    const m = manualByTester.get(p.testerAddr);
    if (typeof m === 'number') {
      pairedManual.push(m);
      pairedPersona.push(p.qualityScore ?? 0);
    }
  }
  const spearmanVal = pairedManual.length >= 2 ? spearman(pairedManual, pairedPersona) : null;
  const _unusedPearson = pairedManual.length >= 2 ? pearson(pairedManual, pairedPersona) : null;
  void _unusedPearson; // Spearman is enough for the banner; keep pearson available if we add it later.
  const fidelityBand = computeFidelityBand(overallAgreementRate, pairedManual.length);

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
    quirksEncountered,
    fidelity: {
      itemAgreementRate: overallAgreementRate === null ? null : Number(overallAgreementRate.toFixed(3)),
      pairedCount: pairedManual.length,
      spearman: spearmanVal === null ? null : Number(spearmanVal.toFixed(3)),
      band: fidelityBand,
    },
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
- **모든 pain_point 와 인용문 뒤에 audit chain 삽입**. painPointFrequency[i].humanEvidence / personaEvidence 필드에 \`<reportId8자>·t<turn>\` 형식 citation 이 들어있습니다. 진단서 pain_point 문장 끝에 \`[<reportId>·t<turn>]\` 으로 붙이세요. aggregate 에 없는 ID 는 절대 지어내지 마세요. 예: "로그인 벽 접근 불가 [ab12cd34·t7, 9f3ac0e2·t3]".
- **confirmation 라벨을 항상 표기**. 각 pain_point 의 confirmation 필드(\`both\` / \`human-only\` / \`persona-only\`)를 진단서에 명시. "persona-only" 는 **페르소나 아티팩트 가능성 → 수동 재현 필요** 라고 신뢰도 섹션에 적으세요.
- **fidelity.band 반영**: aggregate.fidelity.band 가 \`low\` 또는 \`n/a\` 이면 신뢰도 섹션에 "페르소나-인간 일치도가 낮음/미측정 → persona-derived finding 은 참고용으로만 읽으세요" 라고 명시. \`high\`/\`medium\` 이면 그 대신 "일치율 X%" 수치를 인용하여 독자가 reliance level 을 조정할 수 있게 하세요.
- **quirksEncountered 맥락화**: 이 필드가 비어있지 않다면 browser 자동화가 환경적 장애물(auth wall, cookie consent, captcha 등)을 만났다는 뜻. 관련 checklist 실패를 "제품 결함" 으로 해석하지 말고 "자동화 환경 한계" 로 구분해서 신뢰도 섹션에 명시하세요. 예: \`{"auth_wall": 4, "cookie_consent": 2}\` → "browser 세션의 6개 체크리스트 실패는 로그인/쿠키 배너 차단에 기인 — 실제 사용자는 이 장애물을 이미 통과한 상태이므로 별도 수동 검증 필요".

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
    painPointFrequency: aggregate.painPointFrequency.slice(0, 10).map((pp) => {
      // Split citations by source so the LLM can label each pain point
      // as human-confirmed, persona-confirmed, or both. Audit chain
      // (reportId · turn) is sent so the prompt can cite real rows.
      const humanCitations = pp.citations.filter((c) => !c.isPersona).slice(0, 3);
      const personaCitations = pp.citations.filter((c) => c.isPersona).slice(0, 3);
      const fmt = (c: PainPointCitation) =>
        c.evidenceTurn !== null ? `${c.reportId.slice(0, 8)}·t${c.evidenceTurn}` : c.reportId.slice(0, 8);
      return {
        description: pp.description.slice(0, 280),
        count: pp.count,
        humanCount: humanCitations.length,
        personaCount: personaCitations.length,
        confirmation:
          humanCitations.length > 0 && personaCitations.length > 0 ? 'both'
          : humanCitations.length > 0 ? 'human-only'
          : 'persona-only',
        humanEvidence: humanCitations.map(fmt),
        personaEvidence: personaCitations.map(fmt),
      };
    }),
    commonPositiveSignals: aggregate.allPositiveSignals.slice(0, 10),
    commonRecommendations: aggregate.allRecommendations.slice(0, 15),
    quirksEncountered: aggregate.quirksEncountered,
    fidelity: aggregate.fidelity,
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
  const markdown = (fenceMatch ? fenceMatch[1] : raw).trim();

  // Prepend the fidelity banner so a reader sees "can I trust this?"
  // before reading the findings. Keeps the LLM output unchanged so the
  // citation validator still scans the same text.
  const banner = fidelityBannerKor(aggregate.fidelity);
  const withBanner = `${banner}\n\n${markdown}`;

  // Validate every `[abcd1234·tN]` style citation in the output against
  // the actual reportIds in the aggregate. Any unknown id means the
  // model invented a source — we surface it in a footer so a reader
  // (and the test suite) can spot it rather than silently ship.
  const validation = validateAuditCitations(markdown, aggregate);
  if (validation.unknown.length > 0) {
    return `${withBanner}\n\n> ⚠ **Audit check**: ${validation.unknown.length} citation(s) reference report IDs not in this test's data: \`${validation.unknown.join(', ')}\`. Treat the surrounding claims as unverified.`;
  }
  return withBanner;
}

/**
 * Extract `[<reportId8>·t<turn>]` citations from the diagnosis markdown
 * and classify each as known (present in the aggregate) or unknown
 * (hallucinated by the model despite the prompt constraint). The
 * caller prepends a warning footer for unknown refs. Exported so
 * tests can exercise the validator without running the LLM.
 */
export function validateAuditCitations(
  markdown: string,
  aggregate: DiagnosisAggregate,
): { known: string[]; unknown: string[] } {
  const knownPrefixes = new Set(aggregate.perPersona.map((p) => p.reportId.slice(0, 8).toLowerCase()));
  const found = new Set<string>();
  // Only scan inside [...] brackets — matching bare hex across the
  // whole document catches hex color codes (#14F195 → "14f195") and
  // other false positives. Within a bracket we accept one or more
  // `<id>·t<turn>` entries separated by commas / spaces / semicolons.
  for (const bracket of markdown.matchAll(/\[([^\]]+)\]/g)) {
    const inner = bracket[1];
    for (const idMatch of inner.matchAll(/\b([0-9a-f]{8})(?:[·]t\d+)?\b/gi)) {
      found.add(idMatch[1].toLowerCase());
    }
  }
  const known: string[] = [];
  const unknown: string[] = [];
  for (const id of found) {
    (knownPrefixes.has(id) ? known : unknown).push(id);
  }
  return { known, unknown };
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
