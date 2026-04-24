import { describe, expect, it } from 'vitest';
import {
  computeFidelityBand,
  validateAuditCitations,
  type DiagnosisAggregate,
} from '../services/scoring/diagnosis.js';

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
  allPositiveSignals: [],
  allRecommendations: [],
  quirksEncountered: {},
  fidelity: { itemAgreementRate: null, pairedCount: 0, spearman: null, band: 'n/a' },
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
