import { describe, expect, it } from 'vitest';
import { deriveFindings } from '../services/findings.js';

function base() {
  return {
    manualCount: 20,
    personaCount: 20,
    itemAgreementRate: 0.5,
    itemAgreement: [],
    correlation: { pearson: 0, spearman: 0, pairedCount: 10 },
    ratingKs: 0.2,
    ratingManualMean: 3,
    ratingPersonaMean: 3,
    convergence: [],
  };
}

describe('deriveFindings', () => {
  it('flags small sample as neutral', () => {
    const f = deriveFindings({ ...base(), manualCount: 3, personaCount: 3 });
    expect(f.find((x) => x.id === 'sample-size')?.severity).toBe('neutral');
  });

  it('flags adequate sample as positive', () => {
    const f = deriveFindings(base());
    expect(f.find((x) => x.id === 'sample-size')?.severity).toBe('positive');
  });

  it('item-agreement thresholds', () => {
    const items = [
      { itemId: 'a', humanMajority: 'passed' as const, personaMajority: 'passed' as const, agree: true,
        humanVotes: { passed: 1, failed: 0, blocked: 0 }, personaVotes: { passed: 1, failed: 0, blocked: 0 } },
    ];
    expect(
      deriveFindings({ ...base(), itemAgreement: items, itemAgreementRate: 0.8 })
        .find((x) => x.id === 'item-agreement-high')?.severity,
    ).toBe('positive');
    expect(
      deriveFindings({ ...base(), itemAgreement: items, itemAgreementRate: 0.5 })
        .find((x) => x.id === 'item-agreement-mid')?.severity,
    ).toBe('neutral');
    expect(
      deriveFindings({ ...base(), itemAgreement: items, itemAgreementRate: 0.2 })
        .find((x) => x.id === 'item-agreement-low')?.severity,
    ).toBe('negative');
  });

  it('detects persona bailouts (persona blocked vs human passed)', () => {
    const items = [
      { itemId: 'a', humanMajority: 'passed' as const, personaMajority: 'blocked' as const, agree: false,
        humanVotes: { passed: 3, failed: 0, blocked: 0 }, personaVotes: { passed: 0, failed: 0, blocked: 3 } },
      { itemId: 'b', humanMajority: 'passed' as const, personaMajority: 'blocked' as const, agree: false,
        humanVotes: { passed: 3, failed: 0, blocked: 0 }, personaVotes: { passed: 0, failed: 0, blocked: 3 } },
    ];
    const f = deriveFindings({ ...base(), itemAgreement: items, itemAgreementRate: 0 });
    const bailout = f.find((x) => x.id === 'persona-bailout');
    expect(bailout).toBeDefined();
    expect(bailout!.headline).toContain('2 item');
  });

  it('spearman thresholds', () => {
    expect(
      deriveFindings({ ...base(), correlation: { pearson: 0, spearman: 0.7, pairedCount: 10 } })
        .find((x) => x.id === 'quality-correlation-pos')?.severity,
    ).toBe('positive');
    expect(
      deriveFindings({ ...base(), correlation: { pearson: 0, spearman: -0.5, pairedCount: 10 } })
        .find((x) => x.id === 'quality-correlation-neg')?.severity,
    ).toBe('negative');
  });

  it('surfaces the "items agree, magnitude disagrees" pattern', () => {
    const items = [
      { itemId: 'a', humanMajority: 'passed' as const, personaMajority: 'passed' as const, agree: true,
        humanVotes: { passed: 3, failed: 0, blocked: 0 }, personaVotes: { passed: 3, failed: 0, blocked: 0 } },
    ];
    const f = deriveFindings({
      ...base(),
      itemAgreement: items,
      itemAgreementRate: 0.75,
      correlation: { pearson: -0.7, spearman: -0.9, pairedCount: 10 },
    });
    expect(f.find((x) => x.id === 'items-agree-magnitude-disagree')).toBeDefined();
  });

  it('convergence shrinks headline when last.absDiff < first.absDiff * 0.6', () => {
    const conv = [
      { n: 1, humanMean: 4, personaMean: 1, absDiff: 3 },
      { n: 2, humanMean: 4, personaMean: 2, absDiff: 2 },
      { n: 10, humanMean: 4, personaMean: 3.5, absDiff: 0.5 },
    ];
    const f = deriveFindings({ ...base(), convergence: conv });
    expect(f.find((x) => x.id === 'convergence-good')?.severity).toBe('positive');
  });

  it('convergence widens is flagged negative', () => {
    const conv = [
      { n: 1, humanMean: 4, personaMean: 3, absDiff: 1 },
      { n: 5, humanMean: 4, personaMean: 1, absDiff: 3 },
    ];
    const f = deriveFindings({
      ...base(),
      convergence: [...conv, { n: 10, humanMean: 4, personaMean: 0.5, absDiff: 3.5 }],
    });
    expect(f.find((x) => x.id === 'convergence-diverges')?.severity).toBe('negative');
  });

  it('rating distribution: close means → positive', () => {
    const f = deriveFindings({
      ...base(),
      ratingKs: 0.1,
      ratingManualMean: 3.5,
      ratingPersonaMean: 3.4,
    });
    expect(f.find((x) => x.id === 'rating-close')?.severity).toBe('positive');
  });

  it('rating distribution: divergent → negative', () => {
    const f = deriveFindings({
      ...base(),
      ratingKs: 0.7,
      ratingManualMean: 4,
      ratingPersonaMean: 2,
    });
    expect(f.find((x) => x.id === 'rating-diverge')?.severity).toBe('negative');
  });
});
