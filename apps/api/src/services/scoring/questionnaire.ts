/**
 * Questionnaire answer generator — persona roleplays answering UX survey.
 *
 * Port of apps/persona-engine/adapters/questionnaire_generator.py. Korean
 * system prompt is copied verbatim. Call site supplies the persona
 * "soul text" (see services/scoring/persona_soul.ts) instead of going
 * through the Python persona_store — in this project, personas live in
 * the DB, not markdown files.
 */
import { client, withRoute } from '../anthropic_client.js';
import { SCORING_MODELS, parseJsonSafe } from '../llm.js';
import { sessionSummary } from './session_summary.js';
import type {
  QuestionnaireAnswer,
  QuestionnaireItem,
  QuestionnaireType,
  SessionLog,
} from './types.js';

const SYSTEM_PROMPT = `당신은 주어진 AI 페르소나의 관점에서 UX 설문에 답변합니다.
페르소나의 성향(soul)과 세션 중 실제로 관찰된 행동을 근거로, 과장·날조 없이 답변하세요.

## 중요 원칙 — "서비스 품질"과 "세션 결과"를 분리

세션이 abandoned/error/partial로 끝났어도, 그 원인이 무엇인지 먼저 구분하세요.

(A) 서비스 자체의 결함 때문에 세션이 실패 → 낮은 점수 정당
    예: 페이지 로딩 실패, 링크 깨짐, 폼 제출 오류

(B) 환경 제약(지갑 없음, 트랜잭션 서명 불가, 외부 플랫폼 의존)으로 완료 불가
    → 이건 서비스 탓이 아님. 관찰 가능했던 범위의 UX만 평가하고
       평균~평균 이상(3~4)으로 답변

(C) 테스트 에이전트의 능력 한계 (SPA 탐색 부족, 동적 UI 해석 실패)
    → 이 또한 서비스 평가에 반영 금지. 관찰된 부분만 평가

결과가 partial/abandoned라도 서비스 자체의 품질이 평균 이상이었다면
당당히 3~4점을 주세요. 1점은 "서비스에 명백한 결함이 있다"고 증거가 있을 때만.

## 출력 (JSON array만, 다른 텍스트 없음)
[
  {"id": "q1", "answer": 정수 또는 문자열}
]

## 규칙
- type=rating_1_5: 정수 1~5 (1=매우 나쁨, 3=보통, 5=매우 좋음).
  * 극단값(1, 5)은 관찰된 근거가 매우 강할 때만. 평범한 세션은 2~4 사이에 자리잡아야 함.
  * 세션이 실패했어도 관찰 범위가 너무 좁다면 "판단 보류" 의미로 3을 기본.
- type=rating_1_10: 정수 1~10. 5~8 범위를 주로 사용, 극단은 강한 근거가 있을 때만.
- type=free_text: 1-3문장 한국어 서술. 세션에서 관찰된 구체적 근거를 1개 이상 언급.
  * 세션이 환경 제약으로 완료 불가였다면 그 사실을 명시하고, 관찰 가능했던 UX는 별도로 평가.
- 모든 질문에 반드시 답변 (누락 금지).
`;

function ratingDefault(t: QuestionnaireType): number {
  if (t === 'rating_1_5') return 3;
  if (t === 'rating_1_10') return 5;
  return 0;
}

function coerce(t: QuestionnaireType, raw: unknown): string | number {
  if (t === 'free_text') return raw == null ? '' : String(raw);
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return ratingDefault(t);
  if (t === 'rating_1_5') return Math.max(1, Math.min(5, Math.trunc(n)));
  if (t === 'rating_1_10') return Math.max(1, Math.min(10, Math.trunc(n)));
  return n;
}

function neutralFallback(items: QuestionnaireItem[]): QuestionnaireAnswer[] {
  return items.map((it) => ({
    id: it.id,
    answer: it.type === 'free_text' ? '' : ratingDefault(it.type),
  }));
}

function normalizeItems(
  questionnaire: (QuestionnaireItem | Record<string, unknown>)[],
): QuestionnaireItem[] {
  const out: QuestionnaireItem[] = [];
  for (const q of questionnaire) {
    if (typeof q !== 'object' || q === null) continue;
    const id = String((q as { id?: unknown }).id ?? '');
    const question = String((q as { question?: unknown }).question ?? '');
    const typeRaw = String((q as { type?: unknown }).type ?? 'free_text');
    const type: QuestionnaireType =
      typeRaw === 'rating_1_5' || typeRaw === 'rating_1_10' || typeRaw === 'free_text'
        ? typeRaw
        : 'free_text';
    if (!id) continue;
    out.push({ id, question, type });
  }
  return out;
}

function extractJsonArray(text: string): unknown[] | null {
  try {
    const parsed = parseJsonSafe(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']') + 1;
  if (start < 0 || end <= start) return null;
  try {
    const parsed = parseJsonSafe(text.slice(start, end));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface AnswerQuestionnaireArgs {
  questionnaire: (QuestionnaireItem | Record<string, unknown>)[];
  sessionLog: Partial<SessionLog> | Record<string, unknown>;
  soulText: string;
  useLlm?: boolean;
}

export async function answerQuestionnaire(
  args: AnswerQuestionnaireArgs,
): Promise<QuestionnaireAnswer[]> {
  const items = normalizeItems(args.questionnaire);
  if (items.length === 0) return [];

  if (args.useLlm === false) return neutralFallback(items);

  const summary = sessionSummary(args.sessionLog as Parameters<typeof sessionSummary>[0]);
  const userMsg =
    '## 페르소나\n' +
    (args.soulText || '(soul 불러오기 실패)') +
    '\n\n## 세션 요약\n' +
    summary +
    '\n\n## 설문 (JSON)\n' +
    JSON.stringify(
      items.map((i) => ({ id: i.id, question: i.question, type: i.type })),
      null,
      2,
    );

  try {
    // max_tokens=2500: free_text answers run 1-3 sentences of Korean per
    // question and tests frequently ship 6-8 questionnaire items, so the
    // Python-era 1024 cap truncated full runs.
    const resp = await withRoute('questionnaire', () =>
      client.messages.create({
        model: SCORING_MODELS.sonnet,
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      }),
    );
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const parsed = extractJsonArray(raw);
    if (!parsed) throw new Error('no JSON array in LLM response');

    const byId = new Map<string, Record<string, unknown>>();
    for (const p of parsed) {
      if (typeof p === 'object' && p !== null) {
        const id = (p as { id?: unknown }).id;
        if (id) byId.set(String(id), p as Record<string, unknown>);
      }
    }

    return items.map((it) => {
      const p = byId.get(it.id);
      if (!p) {
        return {
          id: it.id,
          answer: it.type === 'free_text' ? '' : ratingDefault(it.type),
        };
      }
      return { id: it.id, answer: coerce(it.type, p.answer) };
    });
  } catch (err) {
    console.warn(
      `[scoring.questionnaire] LLM failed (${err instanceof Error ? err.message : String(err)}); returning neutral defaults`,
    );
    return neutralFallback(items);
  }
}

// Exported for testing.
export const _internal = { coerce, ratingDefault, neutralFallback };
