import { describe, it, expect, vi } from 'vitest';

// Stub so we can assert the harness-failure guard skips the LLM path.
vi.mock('../services/anthropic_client.js', () => {
  const mockCreate = vi.fn();
  return {
    client: { messages: { create: mockCreate } },
    withRoute: <T>(_route: string, fn: () => Promise<T>) => fn(),
    __mockCreate: mockCreate,
  };
});

import { scoreChecklist } from '../services/scoring/checklist.js';

async function getMockCreate() {
  const mod = (await import('../services/anthropic_client.js')) as unknown as {
    __mockCreate: ReturnType<typeof vi.fn>;
  };
  return mod.__mockCreate;
}

// Mirrors apps/persona-engine/tests/test_checklist_adapter.py for the
// offline (useLlm=false) rule-based fallback path. The LLM path is
// covered in integration tests because it requires ANTHROPIC_API_KEY.

describe('scoreChecklist (rule-based fallback)', () => {
  it('empty checklist returns empty', async () => {
    const results = await scoreChecklist({
      checklist: [],
      sessionLog: { outcome: 'task_complete', turns: [] },
      useLlm: false,
    });
    expect(results).toEqual([]);
  });

  it('keyword match marks passed', async () => {
    const results = await scoreChecklist({
      checklist: [{ id: 'c1', task: 'click signup button', expected: '' }],
      sessionLog: {
        outcome: 'task_complete',
        mode: 'browser',
        turns: [
          {
            turn: 0,
            observation: { summary: 'user clicked the signup button on the page' },
            decision: { action: 'click' },
            tool: { tool: 'click' },
          },
        ],
      },
      useLlm: false,
    });
    expect(results[0].status).toBe('passed');
    expect(results[0].memo).toContain('키워드 매칭');
  });

  it('abandoned session blocks unmatched items', async () => {
    const results = await scoreChecklist({
      checklist: [{ id: 'c1', task: 'navigate checkout flow', expected: '' }],
      sessionLog: {
        outcome: 'abandoned',
        mode: 'browser',
        turns: [{ turn: 0, observation: { summary: 'homepage loaded' }, decision: {}, tool: { tool: 'goto' } }],
      },
      useLlm: false,
    });
    expect(results[0].status).toBe('blocked');
    expect(results[0].memo).toContain('abandoned');
  });

  it('task_complete without evidence → failed', async () => {
    const results = await scoreChecklist({
      checklist: [{ id: 'c1', task: 'fill registration form', expected: '' }],
      sessionLog: {
        outcome: 'task_complete',
        mode: 'browser',
        turns: [
          { turn: 0, observation: { summary: 'homepage with news articles' }, decision: {}, tool: { tool: 'read' } },
        ],
      },
      useLlm: false,
    });
    expect(results[0].status).toBe('failed');
    expect(results[0].memo).toContain('증거');
  });

  it('error outcome also blocks', async () => {
    const results = await scoreChecklist({
      checklist: [{ id: 'c1', task: 'zzz unmatched', expected: '' }],
      sessionLog: { outcome: 'error', mode: 'browser', turns: [] },
      useLlm: false,
    });
    expect(results[0].status).toBe('blocked');
  });

  it('dict input accepted', async () => {
    const results = await scoreChecklist({
      checklist: [{ id: 'c1', task: 'open menu' } as unknown as Record<string, unknown>],
      sessionLog: {
        outcome: 'task_complete',
        mode: 'browser',
        turns: [{ turn: 0, observation: { summary: 'menu opened' }, decision: {}, tool: { tool: 'click' } }],
      },
      useLlm: false,
    });
    expect(results[0].id).toBe('c1');
    expect(results[0].status).toBe('passed');
  });

  it('short keywords (<3 chars) are not matched', async () => {
    // "in" and "on" shouldn't match even if the summary contains them
    const results = await scoreChecklist({
      checklist: [{ id: 'c1', task: 'in on', expected: '' }],
      sessionLog: {
        outcome: 'task_complete',
        mode: 'browser',
        turns: [{ turn: 0, observation: { summary: 'clicked the on button inside the menu' }, decision: {}, tool: null }],
      },
      useLlm: false,
    });
    expect(results[0].status).toBe('failed'); // no 3+ char keywords to match
  });
});

describe('scoreChecklist · empty-session harness-failure guard', () => {
  // Mirror of the report.ts guard (P1). When Stagehand crashes before
  // capturing real observations, Sonnet was being asked to judge
  // checklist items against an empty log. It dutifully invented
  // item-by-item failure narratives ("모바일 뷰포트 테스트 중 drop",
  // "선행 지갑 연결 단계 미완으로 blocked") — textually plausible but
  // not grounded in any observation. Bypass the LLM on empty-session
  // input so every blocked memo is the generic rule-based one instead.

  it('outcome=error with zero turns bypasses LLM and marks items blocked (no fabrication)', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockClear();

    const results = await scoreChecklist({
      checklist: [
        { id: 'cl-1', task: 'Connect Phantom wallet', expected: '' },
        { id: 'cl-2', task: 'Execute SOL→USDC swap', expected: '' },
      ],
      sessionLog: { outcome: 'error', mode: 'browser', turns: [] },
      // useLlm default (true) — production default
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe('blocked');
      // Memo must be the generic rule-based one, not a narrative.
      expect(r.memo).toMatch(/세션 error|시도 불가/);
      // Explicit negative — anti-regression guard against known LLM
      // hallucinations that leaked through to the jup.ag diagnosis.
      expect(r.memo).not.toMatch(/모바일 뷰포트|JSON 파싱|selection viewport/i);
    }
  });

  it('outcome=error with a single turn still bypasses LLM', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockClear();

    const results = await scoreChecklist({
      checklist: [{ id: 'cl-1', task: 'any task', expected: '' }],
      sessionLog: {
        outcome: 'error',
        mode: 'browser',
        turns: [
          { turn: 0, observation: { summary: 'initial' }, decision: {}, tool: null },
        ],
      },
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(results[0].status).toBe('blocked');
  });

  it('outcome=error with ≥2 turns still reaches the LLM (real partial run)', async () => {
    // When the persona actually got somewhere before crashing, let the
    // LLM read the observations it DID capture — those turns are real
    // evidence and should drive per-item verdicts.
    const mockCreate = await getMockCreate();
    mockCreate.mockClear();
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { id: 'cl-1', status: 'passed', memo: 'wallet modal visible at turn 1', matched_turn_idx: 1 },
          ]),
        },
      ],
    });

    const results = await scoreChecklist({
      checklist: [{ id: 'cl-1', task: 'Connect wallet', expected: '' }],
      sessionLog: {
        outcome: 'error',
        mode: 'browser',
        turns: [
          { turn: 0, observation: { summary: 'homepage' }, decision: {}, tool: { tool: 'goto' } },
          { turn: 1, observation: { summary: 'wallet modal open' }, decision: {}, tool: { tool: 'click' } },
        ],
      },
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(results[0].status).toBe('passed');
  });
});
