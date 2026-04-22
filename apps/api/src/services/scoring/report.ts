/**
 * Structured UX report generator — single Haiku call per session.
 *
 * Port of apps/persona-engine/report_generator.py. Schema matches the
 * wire format produced by /analyses/score so existing UI consumers
 * (report detail page, experiment dashboard) keep rendering unchanged.
 *
 * Cost note: Haiku 4.5 with max_tokens=1400. Pre-port cost bench on a
 * 5-run batch was ~$0.14/run for this call alone when on Sonnet; Haiku
 * drops that to <20% at the same 1400-token cap, which comfortably
 * fits a 4-pain-points / 5-recommendations payload with headroom.
 */
import { client, withRoute } from '../anthropic_client.js';
import { SCORING_MODELS, parseJsonSafe } from '../llm.js';
import { sessionSummary } from './session_summary.js';
import type {
  ChecklistResult,
  PainPoint,
  SessionLog,
  Severity,
  StructuredReport,
  UxScores,
} from './types.js';

const SYSTEM_PROMPT = `당신은 UX 리서치 애널리스트입니다.
AI 페르소나의 세션 로그(행동/관찰) + 체크리스트 결과를 근거로 제품의 UX를 평가하는 구조화 리포트를 작성하세요.

## 원칙
- 세션에 없는 사실을 날조하지 마세요 (관찰 기반 근거만 사용)
- ux_scores는 사이트/제품 품질 평가 (페르소나가 얼마나 캐릭터에 충실했는지가 아님)
- pain_points의 evidence_turn은 turns[]의 turn 번호 (근거가 된 턴). 불분명하면 null
- severity=high는 태스크 실패를 유발한 마찰만

## 출력 (JSON object만)
{
  "summary": "2~4문장, 한국어",
  "ux_scores": {
    "clarity": 0.0~1.0,      // 정보 구조/라벨의 명확성
    "trust": 0.0~1.0,        // 신뢰 신호 (보안, 약관, 리뷰 등)
    "efficiency": 0.0~1.0,   // 태스크 완료까지의 단계 수·마찰
    "overall": 0.0~1.0       // 가중 평균 또는 종합 판단
  },
  "pain_points": [
    {"severity": "high|medium|low", "description": "...", "evidence_turn": 정수|null}
  ],
  "positive_signals": ["잘 된 점 1", "..."],
  "recommendations": ["개선 제안 1", "..."]
}`;

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 0.0;
  return Math.max(0.0, Math.min(1.0, n));
}

function emptyReport(personaId: string, sessionId: string): StructuredReport {
  return {
    summary: '(리포트 생성 실패 또는 off-line 경로)',
    ux_scores: { clarity: 0, trust: 0, efficiency: 0, overall: 0 },
    pain_points: [],
    positive_signals: [],
    recommendations: [],
    persona_id: personaId,
    session_id: sessionId,
  };
}

function parsePainPoint(raw: unknown): PainPoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const sevRaw = r.severity;
  const severity: Severity =
    sevRaw === 'high' || sevRaw === 'medium' || sevRaw === 'low' ? sevRaw : 'low';
  const description = String(r.description ?? '').trim();
  if (!description) return null;
  const et = r.evidence_turn;
  const evidence_turn =
    typeof et === 'number' && Number.isInteger(et) ? et : null;
  return { severity, description, evidence_turn };
}

function strList(raw: unknown, cap = 20): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw.slice(0, cap)) {
    const s = String(v).trim();
    if (s) out.push(s);
  }
  return out;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = parseJsonSafe(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start < 0 || end <= start) return null;
  try {
    const parsed = parseJsonSafe(text.slice(start, end));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface GenerateStructuredReportArgs {
  sessionLog: Partial<SessionLog> | Record<string, unknown>;
  personaId: string;
  checklistResults?: ChecklistResult[] | null;
  useLlm?: boolean;
}

export async function generateStructuredReport(
  args: GenerateStructuredReportArgs,
): Promise<StructuredReport> {
  const sessionId = String(
    (args.sessionLog as { session_id?: unknown }).session_id ?? '',
  );

  if (args.useLlm === false) return emptyReport(args.personaId, sessionId);

  const summary = sessionSummary(args.sessionLog as Parameters<typeof sessionSummary>[0]);
  let checklistSummary = '';
  if (args.checklistResults && args.checklistResults.length > 0) {
    checklistSummary =
      '\n## 체크리스트 결과\n' +
      args.checklistResults
        .map((r) => `- [${r.status}] ${r.id}: ${r.memo}`)
        .join('\n');
  }

  const userMsg = '## 세션 요약\n' + summary + checklistSummary;

  try {
    // max_tokens=2000 (Python used 1400). With 20-turn session logs the
    // summary + pain_points + recommendations output can stretch past
    // 1400 and truncate mid-JSON. 2000 fits comfortably; Haiku at that
    // cap is still <20% the Sonnet cost.
    const resp = await withRoute('structured_report', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      }),
    );
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const parsed = extractJsonObject(raw);
    if (!parsed) throw new Error('no JSON object in LLM response');

    const scoresRaw =
      typeof parsed.ux_scores === 'object' && parsed.ux_scores !== null
        ? (parsed.ux_scores as Record<string, unknown>)
        : {};
    const ux: UxScores = {
      clarity: Number(clamp01(scoresRaw.clarity).toFixed(3)),
      trust: Number(clamp01(scoresRaw.trust).toFixed(3)),
      efficiency: Number(clamp01(scoresRaw.efficiency).toFixed(3)),
      overall: Number(clamp01(scoresRaw.overall).toFixed(3)),
    };

    const painPointsRaw = parsed.pain_points;
    const pain_points: PainPoint[] = [];
    if (Array.isArray(painPointsRaw)) {
      for (const p of painPointsRaw.slice(0, 20)) {
        const pp = parsePainPoint(p);
        if (pp) pain_points.push(pp);
      }
    }

    return {
      summary: String(parsed.summary ?? '').trim(),
      ux_scores: ux,
      pain_points,
      positive_signals: strList(parsed.positive_signals),
      recommendations: strList(parsed.recommendations),
      persona_id: args.personaId,
      session_id: sessionId,
    };
  } catch (err) {
    console.warn(
      `[scoring.report] LLM failed (${err instanceof Error ? err.message : String(err)}); returning empty skeleton`,
    );
    return emptyReport(args.personaId, sessionId);
  }
}

// Exported for testing.
export const _internal = { clamp01, parsePainPoint, strList, emptyReport };
