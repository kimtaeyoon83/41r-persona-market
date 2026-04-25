import { describe, expect, it, vi } from 'vitest';
import {
  clusterPainPointDescriptions,
  computeFidelityBand,
  isHarnessErrorOutcome,
  validateAuditCitations,
  type DiagnosisAggregate,
} from '../services/scoring/diagnosis.js';

// Stub the Anthropic client at module level so we can control what
// the clusterer "sees" without making real API calls.
vi.mock('../services/anthropic_client.js', () => {
  const mockCreate = vi.fn();
  return {
    client: { messages: { create: mockCreate } },
    withRoute: <T>(_route: string, fn: () => Promise<T>) => fn(),
    __mockCreate: mockCreate,
  };
});

const makeAggregate = (reportIds: string[]): DiagnosisAggregate => ({
  testId: 'test-uuid',
  targetUrl: 'https://example.com',
  requirements: '',
  reportCount: reportIds.length,
  personaCount: 0,
  humanCount: reportIds.length,
  generatedAt: '2026-04-24T00:00:00.000Z',
  qualityStats: { min: 0, max: 0, avg: 0, distribution: [] },
  checklistStats: [],
  perPersona: reportIds.map((id) => ({
    testerAddr: 'w'.repeat(44),
    isPersona: false,
    qualityScore: 4,
    outcome: 'task_complete',
    checklistPassed: 0, checklistFailed: 0, checklistBlocked: 0,
    questionnaireFreeText: [],
    painPoints: [],
    positiveSignals: [],
    recommendations: [],
    reportId: id,
    source: 'manual',
  })),
  painPointFrequency: [],
  harnessErrorReports: [],
  allPositiveSignals: [],
  allRecommendations: [],
  quirksEncountered: {},
  fidelity: { itemAgreementRate: null, pairedCount: 0, spearman: null, band: 'n/a' },
});

describe('clusterPainPointDescriptions', () => {
  it('returns empty map for empty input', async () => {
    const out = await clusterPainPointDescriptions([]);
    expect(out.size).toBe(0);
  });

  it('returns identity for a single description (no LLM call needed)', async () => {
    const out = await clusterPainPointDescriptions(['wallet 연결 차단']);
    expect(out.get('wallet 연결 차단')).toBe('wallet 연결 차단');
  });

  it('uses LLM output to merge similar descriptions into one canonical key', async () => {
    const mod = await import('../services/anthropic_client.js') as unknown as {
      __mockCreate: ReturnType<typeof vi.fn>;
    };
    mod.__mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          clusters: [
            { canonical: '지갑 연결 벽에 의한 진입 차단', members: [0, 1, 2] },
            { canonical: '트랜잭션 내역 미제공', members: [3] },
          ],
        }),
      }],
    });

    const out = await clusterPainPointDescriptions([
      '로그인 벽 접근 불가',
      '지갑 연결 시 진입 차단',
      'Cannot proceed without wallet',
      '인앱 트랜잭션 내역 부재',
    ]);
    expect(out.get('로그인 벽 접근 불가')).toBe('지갑 연결 벽에 의한 진입 차단');
    expect(out.get('지갑 연결 시 진입 차단')).toBe('지갑 연결 벽에 의한 진입 차단');
    expect(out.get('Cannot proceed without wallet')).toBe('지갑 연결 벽에 의한 진입 차단');
    expect(out.get('인앱 트랜잭션 내역 부재')).toBe('트랜잭션 내역 미제공');
  });

  it('falls back to identity map when LLM throws', async () => {
    const mod = await import('../services/anthropic_client.js') as unknown as {
      __mockCreate: ReturnType<typeof vi.fn>;
    };
    mod.__mockCreate.mockRejectedValueOnce(new Error('network blip'));

    const out = await clusterPainPointDescriptions(['A', 'B', 'C']);
    expect(out.get('A')).toBe('A');
    expect(out.get('B')).toBe('B');
    expect(out.get('C')).toBe('C');
  });

  it('fills in unassigned indices with their own canonical (under-merge, not drop)', async () => {
    const mod = await import('../services/anthropic_client.js') as unknown as {
      __mockCreate: ReturnType<typeof vi.fn>;
    };
    // LLM only clusters the first 2 of 3 — index 2 is omitted
    mod.__mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          clusters: [{ canonical: 'merged', members: [0, 1] }],
        }),
      }],
    });
    const out = await clusterPainPointDescriptions(['x', 'y', 'z']);
    expect(out.get('x')).toBe('merged');
    expect(out.get('y')).toBe('merged');
    expect(out.get('z')).toBe('z');
  });
});

describe('computeFidelityBand', () => {
  it('returns n/a with no paired data', () => {
    expect(computeFidelityBand(0.8, 0)).toBe('n/a');
    expect(computeFidelityBand(null, 10)).toBe('n/a');
  });

  it('returns high for ≥5 paired + ≥60% agreement', () => {
    expect(computeFidelityBand(0.6, 5)).toBe('high');
    expect(computeFidelityBand(0.85, 20)).toBe('high');
  });

  it('returns medium when paired is enough but agreement is mid', () => {
    expect(computeFidelityBand(0.5, 8)).toBe('medium');
    expect(computeFidelityBand(0.4, 5)).toBe('medium');
  });

  it('returns low for weak agreement or tiny paired samples', () => {
    // Paired=20 but only 0% agreement — the local jup.ag reality.
    expect(computeFidelityBand(0, 20)).toBe('low');
    // Has paired data (>=1) but <5 and below the high/mid thresholds.
    expect(computeFidelityBand(0.3, 2)).toBe('low');
  });
});

describe('validateAuditCitations', () => {
  it('returns empty sets when the markdown has no citations', () => {
    const agg = makeAggregate(['ab12cd34-aaaa-bbbb-cccc-000000000000']);
    const { known, unknown } = validateAuditCitations('# diagnosis\n\nno citations here.', agg);
    expect(known).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it('accepts citations whose 8-char prefix is in the aggregate', () => {
    const agg = makeAggregate([
      'ab12cd34-aaaa-bbbb-cccc-000000000000',
      '9f3ac0e2-aaaa-bbbb-cccc-000000000000',
    ]);
    const md = '로그인 벽 접근 불가 [ab12cd34·t7, 9f3ac0e2·t3].';
    const { known, unknown } = validateAuditCitations(md, agg);
    expect(known.sort()).toEqual(['9f3ac0e2', 'ab12cd34']);
    expect(unknown).toEqual([]);
  });

  it('flags a hallucinated id that is not in the aggregate', () => {
    const agg = makeAggregate(['ab12cd34-aaaa-bbbb-cccc-000000000000']);
    const md = '문제 [deadbeef·t1].';
    const { known, unknown } = validateAuditCitations(md, agg);
    expect(known).toEqual([]);
    expect(unknown).toEqual(['deadbeef']);
  });

  it('does not flag hex colour codes or stray hex strings outside brackets', () => {
    // Regression guard for an earlier regex that picked up any 6+-hex
    // substring globally — hex colours like 14F195 (Solana brand) were
    // flagged as hallucinated report IDs.
    const agg = makeAggregate(['ab12cd34-aaaa-bbbb-cccc-000000000000']);
    const md = 'Button color #14F195 in the primary state. See [ab12cd34·t1].';
    const { known, unknown } = validateAuditCitations(md, agg);
    expect(unknown).toEqual([]);
    expect(known).toEqual(['ab12cd34']);
  });

  it('is case-insensitive on the id match (LLM might upper-case)', () => {
    const agg = makeAggregate(['ab12cd34-aaaa-bbbb-cccc-000000000000']);
    const md = 'issue [AB12CD34·t0]';
    const { known, unknown } = validateAuditCitations(md, agg);
    expect(known).toEqual(['ab12cd34']);
    expect(unknown).toEqual([]);
  });
});

describe('isHarnessErrorOutcome', () => {
  // Used by buildDiagnosisAggregate to separate "stagehand never
  // captured observations" (our infra failure) from real persona
  // judgments. Reports in the former bucket get their pain_points
  // moved to harnessErrorReports so the top-N rank isn't polluted
  // with plausible-but-fabricated narratives about the product.

  it('flags the reconstructed "error" label', () => {
    expect(isHarnessErrorOutcome('error')).toBe(true);
  });

  it('does not flag legitimate session outcomes', () => {
    expect(isHarnessErrorOutcome('task_complete')).toBe(false);
    expect(isHarnessErrorOutcome('partial')).toBe(false);
    expect(isHarnessErrorOutcome('abandoned')).toBe(false);
    expect(isHarnessErrorOutcome('patience_exceeded')).toBe(false);
    expect(isHarnessErrorOutcome('abandoned/patience_exceeded')).toBe(false);
    expect(isHarnessErrorOutcome('max_turns_hit')).toBe(false);
  });

  it('does not flag unknown (outcome_weight missing) — conservative', () => {
    // "unknown" means _quality_breakdown sentinel was missing, not that
    // the run crashed. Don't steal its pain points — humans often leave
    // qb blank when the report was filed manually.
    expect(isHarnessErrorOutcome('unknown')).toBe(false);
    expect(isHarnessErrorOutcome('')).toBe(false);
  });

  it('tolerates null / undefined input', () => {
    expect(isHarnessErrorOutcome(null)).toBe(false);
    expect(isHarnessErrorOutcome(undefined)).toBe(false);
  });
});
