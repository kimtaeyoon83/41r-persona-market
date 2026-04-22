/**
 * Checklist scorer — ChecklistItem[] + SessionLog → ChecklistResult[].
 *
 * Two-tier strategy, ported from apps/persona-engine/adapters/checklist_adapter.py:
 *   1. LLM scoring via Claude Sonnet 4.6 (single JSON-array output).
 *   2. Rule-based keyword fallback when the LLM is unreachable, returns
 *      malformed JSON, or when the caller passes useLlm=false.
 *
 * Korean system prompt is copied verbatim from the Python reference so
 * dashboards that compare manual vs persona reports don't see a regime
 * shift in memo wording between the two pipelines.
 */
import { client, withRoute } from '../anthropic_client.js';
import { SCORING_MODELS, repairJson } from '../llm.js';
import { BLOCKING_OUTCOMES, sessionSummary } from './session_summary.js';
import type {
  ChecklistItem,
  ChecklistResult,
  ChecklistStatus,
  SessionLog,
} from './types.js';

const SYSTEM_PROMPT = `당신은 UX 테스트 체크리스트 평가관입니다.
세션 로그(행동/관찰)를 보고 각 체크리스트 항목을 판정하세요.

## 판정 기준 — "수행 가능성"과 "UI 접근성"을 분리

(A) 일반 UI 항목 (페이지 로드, 링크 클릭, 폼 제출, 검색 등)
    → 시도된 결과 그대로 판정 (passed/failed).

(B) 환경 의존 항목 (실제 지갑 서명, 실물 NFT 보유, 결제, 외부 로그인 등)
    실제 완료가 환경 제약으로 불가능하더라도, "해당 기능의 UI가 존재하고
    접근 가능하며 flow가 명확히 보이는가"를 대신 평가해 passed로 처리.
    예: "NFT를 판매 등록" 체크리스트 → 실제 서명은 불가하지만
         판매 등록 버튼이 보이고 모달이 열리며 필드가 명확하면 passed.
    반드시 memo에 "실제 트랜잭션 불가 — UI 접근성만 평가" 같은 주석을 남기세요.

(C) blocked는 다음 경우에만:
    - 세션 자체가 error로 끝나 어떤 항목도 관찰 불가
    - 선행 단계 실패로 이 항목의 UI에 도달 자체가 불가능
    환경 제약만으로 blocked 처리하지 마세요 — 관찰 가능한 UI가 있다면 (B) 규칙 적용.

## 출력 (JSON array만)
[
  {"id": "...", "status": "passed|failed|blocked", "memo": "1-2문장", "matched_turn_idx": 정수|null}
]`;

function normalizeItems(
  checklist: (ChecklistItem | Record<string, unknown>)[],
): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const i of checklist) {
    if (typeof i !== 'object' || i === null) continue;
    const id = String((i as { id?: unknown }).id ?? '');
    const task = String((i as { task?: unknown }).task ?? '');
    const expected = String((i as { expected?: unknown }).expected ?? '');
    if (!id) continue;
    out.push({ id, task, expected });
  }
  return out;
}

function ruleBasedFallback(
  items: ChecklistItem[],
  summary: string,
  outcome: string,
): ChecklistResult[] {
  const blob = summary.toLowerCase();
  const blocking = BLOCKING_OUTCOMES.has(outcome);

  return items.map((it) => {
    const keywords = it.task
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    const hits = keywords.filter((k) => blob.includes(k));

    if (hits.length > 0) {
      return {
        id: it.id,
        status: 'passed' as ChecklistStatus,
        memo: `키워드 매칭 (${hits.join(', ')})`,
        matched_turn_idx: null,
      };
    }
    if (blocking) {
      return {
        id: it.id,
        status: 'blocked' as ChecklistStatus,
        memo: `세션 ${outcome}로 시도 불가`,
        matched_turn_idx: null,
      };
    }
    return {
      id: it.id,
      status: 'failed' as ChecklistStatus,
      memo: '관찰된 행동에서 태스크 증거 없음',
      matched_turn_idx: null,
    };
  });
}

/**
 * Extract a JSON array from an LLM response.
 *
 * We can't reuse parseJsonSafe from llm.ts here — its underlying
 * extractJson() only knows how to recognise objects (`{…}`) and code
 * fences, so an unwrapped array prefix/suffix would bomb. For arrays
 * we do two attempts:
 *   1. Strict JSON.parse on the slice from the first "[" to the last
 *      "]" — handles the common case where the LLM wraps or prefaces
 *      with prose.
 *   2. repairJson fallback — closes any unbalanced brackets left by
 *      max_tokens truncation so a partial response still yields the
 *      items that DID complete.
 */
function extractJsonArray(text: string): unknown[] | null {
  // Strip markdown code fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenceMatch ? fenceMatch[1] : text;

  const start = body.indexOf('[');
  const end = body.lastIndexOf(']') + 1;
  if (start < 0) return null;

  const sliced = end > start ? body.slice(start, end) : body.slice(start);

  try {
    const parsed = JSON.parse(sliced);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* try repair */
  }

  try {
    const parsed = JSON.parse(repairJson(sliced));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface ScoreChecklistArgs {
  checklist: (ChecklistItem | Record<string, unknown>)[];
  sessionLog: Partial<SessionLog> | Record<string, unknown>;
  useLlm?: boolean;
}

export async function scoreChecklist(
  args: ScoreChecklistArgs,
): Promise<ChecklistResult[]> {
  const items = normalizeItems(args.checklist);
  if (items.length === 0) return [];

  const summary = sessionSummary(args.sessionLog as Parameters<typeof sessionSummary>[0]);
  const outcome = String(
    (args.sessionLog as { outcome?: unknown }).outcome ?? '',
  );

  const useLlm = args.useLlm !== false;
  if (!useLlm) return ruleBasedFallback(items, summary, outcome);

  const userMsg =
    '## 세션 요약\n' +
    summary +
    '\n\n## 체크리스트 (JSON)\n' +
    JSON.stringify(
      items.map((i) => ({ id: i.id, task: i.task, expected: i.expected })),
      null,
      2,
    );

  try {
    // max_tokens=3000 lifts the hard Python-era 1024 ceiling that
    // truncated 10+ item checklists (per-item {id,status,memo,turn_idx}
    // costs ~80-120 tokens so 11 items easily hits 1300+). Truncation
    // there wasted an entire LLM call because the JSON array never
    // closed and we dropped to keyword fallback silently.
    const resp = await withRoute('checklist', () =>
      client.messages.create({
        model: SCORING_MODELS.sonnet,
        max_tokens: 3000,
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
      const p = byId.get(it.id) ?? {};
      const statusRaw = p.status;
      const status: ChecklistStatus =
        statusRaw === 'passed' || statusRaw === 'failed' || statusRaw === 'blocked'
          ? statusRaw
          : 'failed';
      const matchedTurnRaw = p.matched_turn_idx;
      const matched_turn_idx =
        typeof matchedTurnRaw === 'number' && Number.isInteger(matchedTurnRaw)
          ? matchedTurnRaw
          : null;
      return {
        id: it.id,
        status,
        memo: String(p.memo ?? ''),
        matched_turn_idx,
      };
    });
  } catch (err) {
    console.warn(
      `[scoring.checklist] LLM scoring failed (${err instanceof Error ? err.message : String(err)}); using rule-based fallback`,
    );
    return ruleBasedFallback(items, summary, outcome);
  }
}
