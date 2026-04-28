/**
 * services/scoring/funnel.ts — auto-extracted funnel for a test.
 *
 * Tests the deterministic parts (buildFunnelFromExtractions) and
 * mocks the Anthropic client to exercise clusterFunnelSteps without
 * burning real LLM tokens. extractFurthestStep is private so it's
 * exercised indirectly through generateFunnelForTest in integration
 * tests later.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the Anthropic client so cluster tests can control LLM responses.
vi.mock('../services/anthropic_client.js', () => {
  const mockCreate = vi.fn();
  return {
    client: { messages: { create: mockCreate } },
    withRoute: <T>(_route: string, fn: () => Promise<T>) => fn(),
    withRequestId: <T>(_id: string, fn: () => Promise<T>) => fn(),
  };
});

import {
  buildFunnelFromExtractions,
  clusterFunnelSteps,
} from '../services/scoring/funnel.js';
import { client } from '../services/anthropic_client.js';

const mockCreate = (client.messages.create as unknown) as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCreate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── buildFunnelFromExtractions — pure, no LLM ────────────────────────

describe('buildFunnelFromExtractions', () => {
  it('aggregates per-cluster counts and percentages', () => {
    const extractions = [
      { reportId: 'r1', furthestStep: '지갑 연결 모달까지' },
      { reportId: 'r2', furthestStep: 'Connect Wallet' },
      { reportId: 'r3', furthestStep: '결제 모달' },
      { reportId: 'r4', furthestStep: '랜딩 페이지에서 멈춤' },
    ];
    // Cluster the first 2 together, leave others as own clusters
    const clusterMap = new Map<string, string>([
      ['지갑 연결 모달까지', '지갑 연결'],
      ['Connect Wallet', '지갑 연결'],
      ['결제 모달', '결제 모달'],
      ['랜딩 페이지에서 멈춤', '랜딩'],
    ]);
    const result = buildFunnelFromExtractions(extractions, clusterMap);
    expect(result.totalSessions).toBe(4);
    expect(result.steps).toHaveLength(3);
    // Sorted by count desc: 지갑 연결(2), then ties for 1
    expect(result.steps[0].label).toBe('지갑 연결');
    expect(result.steps[0].count).toBe(2);
    expect(result.steps[0].percentage).toBe(50);
  });

  it('returns empty result for empty extractions', () => {
    const result = buildFunnelFromExtractions([], new Map());
    expect(result.steps).toEqual([]);
    expect(result.totalSessions).toBe(0);
  });

  it('preserves rawExtractions for audit', () => {
    const extractions = [{ reportId: 'r1', furthestStep: 'A' }];
    const result = buildFunnelFromExtractions(extractions, new Map([['A', 'A']]));
    expect(result.rawExtractions).toEqual(extractions);
  });

  it('falls back to raw string when cluster map missing entry', () => {
    const extractions = [
      { reportId: 'r1', furthestStep: 'unmapped step' },
    ];
    const result = buildFunnelFromExtractions(extractions, new Map());
    expect(result.steps[0].label).toBe('unmapped step');
    expect(result.steps[0].percentage).toBe(100);
  });

  it('rounds percentages to integers', () => {
    // 1 of 3 sessions in a cluster → 33%, not 33.333
    const extractions = [
      { reportId: 'r1', furthestStep: 'A' },
      { reportId: 'r2', furthestStep: 'B' },
      { reportId: 'r3', furthestStep: 'C' },
    ];
    const map = new Map([['A', 'A'], ['B', 'B'], ['C', 'C']]);
    const result = buildFunnelFromExtractions(extractions, map);
    expect(result.steps.every((s) => Number.isInteger(s.percentage))).toBe(true);
  });
});

// ─── clusterFunnelSteps — mocked LLM ───────────────────────────────

describe('clusterFunnelSteps', () => {
  it('returns empty map for empty input', async () => {
    const result = await clusterFunnelSteps([]);
    expect(result.size).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('passes through single-input case without LLM call', async () => {
    const result = await clusterFunnelSteps(['지갑 연결']);
    expect(result.get('지갑 연결')).toBe('지갑 연결');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('clusters semantically similar steps via LLM', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          clusters: [
            { canonical: '지갑 연결', members: [0, 1] },
            { canonical: '결제', members: [2] },
          ],
        }),
      }],
    });
    const result = await clusterFunnelSteps([
      '지갑 연결 모달까지',
      'Connect Wallet 클릭',
      '결제 페이지 도달',
    ]);
    expect(result.get('지갑 연결 모달까지')).toBe('지갑 연결');
    expect(result.get('Connect Wallet 클릭')).toBe('지갑 연결');
    expect(result.get('결제 페이지 도달')).toBe('결제');
  });

  it('falls back to identity map when LLM throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('network blip'));
    const inputs = ['step A', 'step B', 'step C'];
    const result = await clusterFunnelSteps(inputs);
    expect(result.size).toBe(3);
    inputs.forEach((s) => expect(result.get(s)).toBe(s));
  });

  it('falls back to identity map when LLM returns malformed JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json at all' }],
    });
    const result = await clusterFunnelSteps(['A', 'B']);
    expect(result.get('A')).toBe('A');
    expect(result.get('B')).toBe('B');
  });

  it('handles indices the LLM left out by falling back per-input', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          clusters: [{ canonical: '지갑 연결', members: [0] }],
          // index 1 is left out — should fall back to its own raw string
        }),
      }],
    });
    const result = await clusterFunnelSteps(['Connect Wallet', '결제 모달']);
    expect(result.get('Connect Wallet')).toBe('지갑 연결');
    expect(result.get('결제 모달')).toBe('결제 모달');
  });

  it('rejects same index assigned to multiple clusters (keeps first)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          clusters: [
            { canonical: 'cluster A', members: [0, 1] },
            { canonical: 'cluster B', members: [0] }, // duplicate of index 0 — should be ignored
          ],
        }),
      }],
    });
    const result = await clusterFunnelSteps(['step one', 'step two']);
    // index 0 should land in cluster A (first match), not cluster B
    expect(result.get('step one')).toBe('cluster A');
    expect(result.get('step two')).toBe('cluster A');
  });

  it('dedupes whitespace/duplicate inputs before clustering', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          clusters: [
            { canonical: 'X', members: [0] },
            { canonical: 'Y', members: [1] },
          ],
        }),
      }],
    });
    // Five inputs but only two unique after trim/dedupe ('step' and 'other')
    const result = await clusterFunnelSteps(['  step  ', 'step', '  step ', 'other', '  other  ']);
    expect(result.size).toBe(2);
    expect(result.get('step')).toBe('X');
    expect(result.get('other')).toBe('Y');
  });
});
