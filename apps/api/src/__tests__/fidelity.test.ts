import { describe, expect, it } from 'vitest';
import {
  computeCohortFidelity,
  computeRankingFidelity,
  matchHumanToCohort,
  meanScores,
  rank,
  type DimensionScores,
  type HumanDemographics,
} from '../services/fidelity/metrics.js';

// Helper: build a full DimensionScores with a fill value + overrides.
function scores(
  fill: number,
  over: Partial<DimensionScores> = {},
): DimensionScores {
  return {
    happiness: fill,
    engagement: fill,
    adoption: fill,
    retentionD7: fill,
    taskSuccess: fill,
    ...over,
  };
}

describe('matchHumanToCohort', () => {
  it('maps a low-tech desktop senior to the senior cohort', () => {
    const demo: HumanDemographics = {
      age_group: 'senior',
      tech_literacy: 0.2,
      crypto_experience: 0.0,
      mobile_first: false,
    };
    const m = matchHumanToCohort(demo);
    expect(m?.cohortId).toBe('senior');
    // senior selector: age_group, tech_literacy, mobile_first → all 3
    // evaluable and satisfied. No unreported axes, so confidence 1.
    expect(m?.evaluableConstraints).toBe(3);
    expect(m?.confidence).toBe(1);
  });

  it('maps a young crypto-novice to defi_beginner', () => {
    const demo: HumanDemographics = {
      age_group: 'young_adult',
      tech_literacy: 0.6,
      crypto_experience: 0.1,
      mobile_first: false,
    };
    const m = matchHumanToCohort(demo);
    expect(m?.cohortId).toBe('defi_beginner');
    // selector has age_group + crypto_experience (evaluable) + patience
    // (not evaluable) → 2 evaluable satisfied, confidence 2/3.
    expect(m?.evaluableConstraints).toBe(2);
    expect(m?.confidence).toBeCloseTo(2 / 3, 6);
  });

  it('returns null when no cohort fully satisfies an evaluable constraint', () => {
    // A teen with high crypto experience: teen_newcomer needs crypto≤0.2,
    // and every other cohort excludes age_group=teen. No full match.
    const demo: HumanDemographics = {
      age_group: 'teen',
      tech_literacy: 0.9,
      crypto_experience: 0.9,
      mobile_first: true,
    };
    expect(matchHumanToCohort(demo)).toBeNull();
  });

  it('is deterministic: prefers more evaluable constraints on ties', () => {
    // Two synthetic cohorts both fully satisfied (score 1). The one with
    // MORE evaluable constraints wins (more of the human was checked).
    const cohorts = [
      { id: 'loose', selector: { age_group: ['adult'] } },
      {
        id: 'tight',
        selector: { age_group: ['adult'], crypto_experience: [0, 0.3] },
      },
    ];
    const demo: HumanDemographics = {
      age_group: 'adult',
      tech_literacy: 0.5,
      crypto_experience: 0.1,
      mobile_first: false,
    };
    expect(matchHumanToCohort(demo, cohorts)?.cohortId).toBe('tight');
  });
});

describe('meanScores', () => {
  it('returns null on empty input', () => {
    expect(meanScores([])).toBeNull();
  });
  it('averages per dimension', () => {
    const m = meanScores([scores(40), scores(60)]);
    expect(m).not.toBeNull();
    for (const v of Object.values(m!)) expect(v).toBe(50);
  });
});

describe('computeCohortFidelity', () => {
  it('computes ai-human delta and mean |Δ| only where both sides exist', () => {
    const aiByCohort = new Map<string, DimensionScores[]>([
      ['senior', [scores(70), scores(80)]], // ai mean 75
      ['crypto_native', [scores(50)]], // ai only, no humans
    ]);
    const humans = [
      {
        scores: scores(60),
        match: {
          cohortId: 'senior',
          confidence: 1,
          evaluableConstraints: 3,
          totalConstraints: 3,
        },
      },
    ];
    const rows = computeCohortFidelity({ aiByCohort, humans });

    const senior = rows.find((r) => r.cohortId === 'senior')!;
    expect(senior.nAi).toBe(2);
    expect(senior.nHuman).toBe(1);
    // ai mean 75 - human 60 = 15 on every dim → |Δ| mean 15.
    expect(senior.delta!.happiness).toBe(15);
    expect(senior.absDeltaMean).toBe(15);
    expect(senior.matchConfidenceMean).toBe(1);

    const crypto = rows.find((r) => r.cohortId === 'crypto_native')!;
    expect(crypto.nHuman).toBe(0);
    expect(crypto.delta).toBeNull();
    expect(crypto.absDeltaMean).toBeNull();
  });

  it('orders canonical cohorts first and resolves labels', () => {
    const aiByCohort = new Map<string, DimensionScores[]>([
      ['senior', [scores(50)]],
    ]);
    const rows = computeCohortFidelity({ aiByCohort, humans: [] });
    expect(rows[0]!.cohortLabel).toBe('Senior (50+)');
  });
});

describe('computeRankingFidelity', () => {
  it('perfect agreement → spearman 1, pairwise 1, top picks agree', () => {
    const r = computeRankingFidelity([
      { variantId: 'A', aiFit: 30, humanFit: 25 },
      { variantId: 'B', aiFit: 50, humanFit: 40 },
      { variantId: 'C', aiFit: 70, humanFit: 90 },
    ]);
    expect(r.spearman).toBeCloseTo(1, 6);
    expect(r.kendallTau).toBeCloseTo(1, 6);
    expect(r.pairwiseAgreement).toBe(1);
    expect(r.topPick).toEqual({ aiTop: 'C', humanTop: 'C', agree: true });
  });

  it('reversed ranking → spearman -1, top picks disagree', () => {
    const r = computeRankingFidelity([
      { variantId: 'A', aiFit: 10, humanFit: 90 },
      { variantId: 'B', aiFit: 50, humanFit: 50 },
      { variantId: 'C', aiFit: 90, humanFit: 10 },
    ]);
    expect(r.spearman).toBeCloseTo(-1, 6);
    expect(r.pairwiseAgreement).toBe(0);
    expect(r.topPick!.agree).toBe(false);
  });

  it('one variant → ranking nulls but top pick still reported', () => {
    const r = computeRankingFidelity([
      { variantId: 'only', aiFit: 42, humanFit: 99 },
    ]);
    expect(r.nVariants).toBe(1);
    expect(r.spearman).toBeNull();
    expect(r.pairwiseAgreement).toBeNull();
    expect(r.topPick).toEqual({
      aiTop: 'only',
      humanTop: 'only',
      agree: true,
    });
  });

  it('empty → all null', () => {
    const r = computeRankingFidelity([]);
    expect(r).toEqual({
      nVariants: 0,
      spearman: null,
      kendallTau: null,
      pairwiseAgreement: null,
      topPick: null,
    });
  });

  it('one swapped pair out of three → pairwise agreement 2/3', () => {
    // AI order A<B<C; humans order A<C<B (B and C swapped).
    const r = computeRankingFidelity([
      { variantId: 'A', aiFit: 10, humanFit: 10 },
      { variantId: 'B', aiFit: 20, humanFit: 30 },
      { variantId: 'C', aiFit: 30, humanFit: 20 },
    ]);
    // pairs: (A,B) concordant, (A,C) concordant, (B,C) discordant → 2/3.
    expect(r.pairwiseAgreement).toBeCloseTo(2 / 3, 6);
    expect(r.kendallTau).toBeCloseTo((2 - 1) / 3, 6);
  });
});

describe('rank (average-tie ranks)', () => {
  it('assigns average ranks to ties', () => {
    // values 5,5,9 → the two 5s share ranks 1,2 → 1.5 each; 9 → 3.
    expect(rank([5, 5, 9])).toEqual([1.5, 1.5, 3]);
  });
  it('ranks ascending with no ties', () => {
    expect(rank([30, 10, 20])).toEqual([3, 1, 2]);
  });
});
