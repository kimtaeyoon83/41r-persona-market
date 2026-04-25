import { describe, it, expect, vi } from 'vitest';

// Stub the Anthropic client so we can both (a) assert LLM calls DON'T
// happen on the empty-session guard path and (b) simulate LLM returns
// for paths that legitimately do call the model.
vi.mock('../services/anthropic_client.js', () => {
  const mockCreate = vi.fn();
  return {
    client: { messages: { create: mockCreate } },
    withRoute: <T>(_route: string, fn: () => Promise<T>) => fn(),
    __mockCreate: mockCreate,
  };
});

import {
  generateStructuredReport,
  _internal,
} from '../services/scoring/report.js';

async function getMockCreate() {
  const mod = (await import('../services/anthropic_client.js')) as unknown as {
    __mockCreate: ReturnType<typeof vi.fn>;
  };
  return mod.__mockCreate;
}

// Port of apps/persona-engine/tests/test_report_generator.py offline +
// helper-function invariants.

describe('generateStructuredReport (offline)', () => {
  it('useLlm=false returns skeleton', async () => {
    const r = await generateStructuredReport({
      sessionLog: { session_id: 's_abc' },
      personaId: 'p1',
      useLlm: false,
    });
    expect(r.pain_points).toEqual([]);
    expect(r.ux_scores.overall).toBe(0);
    expect(r.session_id).toBe('s_abc');
    expect(r.persona_id).toBe('p1');
  });
});

describe('generateStructuredReport · empty-session harness-failure guard', () => {
  // When Stagehand crashes before capturing any real observations, the
  // Haiku call used to invent plausible-sounding failure narratives
  // ("mobile viewport drop", "JSON parse broken mid-session") that the
  // diagnosis pipeline then promoted to top-rank product findings. These
  // tests lock in the short-circuit: outcome=error with ≤1 turns must
  // skip the LLM and return zero pain_points.

  it('outcome=error with zero turns bypasses LLM and returns no pain_points', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockClear();

    const r = await generateStructuredReport({
      sessionLog: { session_id: 's_err0', outcome: 'error', turns: [] },
      personaId: 'p-empty',
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(r.pain_points).toEqual([]);
    expect(r.ux_scores.overall).toBe(0);
    expect(r.session_id).toBe('s_err0');
    expect(r.persona_id).toBe('p-empty');
    // Summary must name the failure explicitly so readers don't mistake
    // "no observations" for "observations said things are fine".
    expect(r.summary).toMatch(/error|수집되지 않|관찰 데이터/);
  });

  it('outcome=error with a single turn still bypasses LLM', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockClear();

    const r = await generateStructuredReport({
      sessionLog: {
        session_id: 's_err1',
        outcome: 'error',
        turns: [
          { turn: 0, observation: { summary: 'initial' }, decision: {}, tool: null },
        ],
      },
      personaId: 'p1',
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(r.pain_points).toEqual([]);
  });

  it('outcome=error with ≥2 turns still calls the LLM (partial observation path kept)', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockClear();
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: 'got partway before error',
            ux_scores: { clarity: 0.3, trust: 0.3, efficiency: 0.2, overall: 0.25 },
            pain_points: [
              { severity: 'medium', description: 'observed nav break', evidence_turn: 1 },
            ],
            positive_signals: [],
            recommendations: [],
          }),
        },
      ],
    });

    const r = await generateStructuredReport({
      sessionLog: {
        session_id: 's_err2',
        outcome: 'error',
        turns: [
          { turn: 0, observation: { summary: 'homepage' }, decision: {}, tool: { tool: 'goto' } },
          { turn: 1, observation: { summary: 'nav broke' }, decision: {}, tool: { tool: 'click' } },
        ],
      },
      personaId: 'p2',
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(r.pain_points).toHaveLength(1);
    expect(r.pain_points[0].description).toBe('observed nav break');
  });

  it('outcome=task_complete with zero turns does NOT bypass — trust the upstream signal', async () => {
    // Some text-mode paths legitimately produce a task_complete outcome
    // with a thin session log. The guard is intentionally scoped to the
    // error + no-observations combination; anything else stays on the
    // LLM path so we don't mask unusual-but-real success shapes.
    const mockCreate = await getMockCreate();
    mockCreate.mockClear();
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: 'quick task',
            ux_scores: { clarity: 0.9, trust: 0.9, efficiency: 0.9, overall: 0.9 },
            pain_points: [],
            positive_signals: ['fast'],
            recommendations: [],
          }),
        },
      ],
    });

    await generateStructuredReport({
      sessionLog: { session_id: 's_ok', outcome: 'task_complete', turns: [] },
      personaId: 'p-ok',
    });

    expect(mockCreate).toHaveBeenCalledOnce();
  });
});

describe('helpers', () => {
  const { clamp01, parsePainPoint, strList } = _internal;

  it('clamp01 bounds', () => {
    expect(clamp01(-1.0)).toBe(0.0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2.0)).toBe(1.0);
    expect(clamp01('not a number')).toBe(0.0);
    expect(clamp01(null)).toBe(0.0);
    expect(clamp01(undefined)).toBe(0.0);
  });

  it('parsePainPoint requires description', () => {
    expect(parsePainPoint({ severity: 'high', description: '' })).toBeNull();
    expect(parsePainPoint({ severity: 'high' })).toBeNull();
    expect(parsePainPoint(null)).toBeNull();
    expect(parsePainPoint('not obj')).toBeNull();
  });

  it('parsePainPoint valid', () => {
    const p = parsePainPoint({
      severity: 'high',
      description: 'broken nav',
      evidence_turn: 2,
    });
    expect(p).toEqual({ severity: 'high', description: 'broken nav', evidence_turn: 2 });
  });

  it('unknown severity becomes low', () => {
    const p = parsePainPoint({ severity: 'critical', description: 'x' });
    expect(p?.severity).toBe('low');
  });

  it('strList strips and caps', () => {
    expect(strList(['  a  ', '', 'b'], 5)).toEqual(['a', 'b']);
    expect(strList(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(strList('not an array')).toEqual([]);
  });
});
