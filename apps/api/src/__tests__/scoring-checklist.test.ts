import { describe, it, expect } from 'vitest';
import { scoreChecklist } from '../services/scoring/checklist.js';

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
