// Contract tests for the Audience-Fit synthesis formula (Option A).
//
// These lock the design decisions made on 2026-05-01 against the
// spec's flawed v1.0 PMF formula:
//
//   1. Niche-PMF must NOT be penalised (Linear/Cursor-shaped products
//      with one strong cohort and weak others are PMF wins).
//   2. Uniform-mediocre products must NOT score equal to a niche-win.
//   3. Median (not variance/diversity) is the breadth signal.
//   4. Retention is excluded from the top-level composite — included
//      only at its honest §4.2 weight (0.05) inside per-cohort scores.
//   5. Task-success is the heaviest cross-check (0.20 in top-level)
//      because §4.2 rates it "High" confidence.
//
// If a future PR tries to reintroduce cohort_diversity or push
// retention into the top-level composite, these tests fail.

import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_FIT_WEIGHTS,
  DIMENSION_WEIGHTS_V1,
  ENGAGEMENT_BAND_TO_SCORE,
  RETENTION_BAND_TO_DCURVE,
  bootstrapCohortFitCI,
  computeAudienceFit,
  computeCohortFitScore,
  computeSusScore,
  median,
  type CohortFit,
  type PersonaDimensionScores,
} from '../services/audience_fit';

function dims(overrides: Partial<PersonaDimensionScores> = {}): PersonaDimensionScores {
  return {
    happiness: 50,
    engagement: 50,
    adoption: 50,
    retention_d7: 50,
    task_success: 50,
    ...overrides,
  };
}

function cohort(id: string, fit: number, n = 14, d?: Partial<PersonaDimensionScores>): CohortFit {
  const base = dims({
    happiness: fit,
    engagement: fit,
    adoption: fit,
    retention_d7: fit,
    task_success: fit,
    ...d,
  });
  return {
    cohort_id: id,
    cohort_label: id,
    n_completed: n,
    dimension_means: base,
    cohort_fit_score: fit,
  };
}

describe('weight constants', () => {
  it('DIMENSION_WEIGHTS_V1 sums to 1.0', () => {
    const sum = Object.values(DIMENSION_WEIGHTS_V1).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it('AUDIENCE_FIT_WEIGHTS sums to 1.0', () => {
    const sum = Object.values(AUDIENCE_FIT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it('§4.2 confidence ordering: high-confidence dimensions weight more', () => {
    // engagement & task_success ("High") >= happiness ("Medium")
    expect(DIMENSION_WEIGHTS_V1.engagement).toBeGreaterThanOrEqual(
      DIMENSION_WEIGHTS_V1.happiness
    );
    expect(DIMENSION_WEIGHTS_V1.task_success).toBeGreaterThanOrEqual(
      DIMENSION_WEIGHTS_V1.happiness
    );
    expect(DIMENSION_WEIGHTS_V1.adoption).toBeLessThanOrEqual(
      DIMENSION_WEIGHTS_V1.happiness
    );
    expect(DIMENSION_WEIGHTS_V1.retention).toBeLessThanOrEqual(
      DIMENSION_WEIGHTS_V1.adoption
    );
  });

  it('top-level: task_success cross-check outweighs sentiment cross-check', () => {
    expect(AUDIENCE_FIT_WEIGHTS.task_success_global).toBeGreaterThan(
      AUDIENCE_FIT_WEIGHTS.sentiment_global
    );
  });

  it('top-level has NO direct retention or cohort_diversity seat (Option A lock)', () => {
    const keys = Object.keys(AUDIENCE_FIT_WEIGHTS);
    expect(keys).not.toContain('retention_d7');
    expect(keys).not.toContain('retention_global');
    expect(keys).not.toContain('cohort_diversity');
  });
});

describe('median', () => {
  it('odd length', () => expect(median([1, 5, 3])).toBe(3));
  it('even length averages middle two', () => expect(median([1, 2, 3, 4])).toBe(2.5));
  it('robust to one zero outlier', () => {
    expect(median([50, 50, 50, 50, 50, 50, 50, 0])).toBe(50);
  });
  it('throws on empty', () => expect(() => median([])).toThrow());
});

describe('computeSusScore', () => {
  it('all 5s on odd, all 1s on even → score 100', () => {
    expect(computeSusScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
  });

  it('all 1s on odd, all 5s on even → score 0', () => {
    expect(computeSusScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
  });

  it('all 3s (neutral) → score 50', () => {
    expect(computeSusScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
  });

  it('rejects wrong length', () => {
    expect(() => computeSusScore([5, 5, 5])).toThrow();
  });

  it('rejects out-of-range Likert', () => {
    expect(() => computeSusScore([6, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toThrow();
    expect(() => computeSusScore([0, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toThrow();
  });
});

describe('computeCohortFitScore', () => {
  it('uniform 50 → 50', () => {
    expect(computeCohortFitScore(dims())).toBeCloseTo(50, 6);
  });

  it('engagement at 100, others 0 → 30 (engagement weight)', () => {
    expect(
      computeCohortFitScore(
        dims({ engagement: 100, happiness: 0, task_success: 0, adoption: 0, retention_d7: 0 })
      )
    ).toBeCloseTo(30, 6);
  });

  it('retention at 100 (others 0) contributes only 5 — by §4.2 design', () => {
    // The §4.2 lock: retention has Very Low confidence so it CAN be
    // measured without dominating the cohort score.
    expect(
      computeCohortFitScore(
        dims({ retention_d7: 100, engagement: 0, happiness: 0, task_success: 0, adoption: 0 })
      )
    ).toBeCloseTo(5, 6);
  });
});

describe('computeAudienceFit · niche-PMF case', () => {
  // Linear/Cursor-shape: one strong cohort, others weak.
  const niche: CohortFit[] = [
    cohort('crypto_native', 84),
    cohort('defi_beginner', 28),
    cohort('designer_20s', 25),
    cohort('senior', 22),
    cohort('teen_newcomer', 24),
    cohort('mobile_power', 26),
    cohort('web3_pro', 71),
    cohort('non_tech_30s', 27),
  ];

  it('niche-win still scores at least 40 (not the spec v1.0 ~33)', () => {
    const r = computeAudienceFit(niche);
    expect(r.audience_fit_score).toBeGreaterThan(40);
  });

  it('best cohort surfaces correctly', () => {
    const r = computeAudienceFit(niche);
    expect(r.best.cohort_id).toBe('crypto_native');
    expect(r.best.cohort_fit_score).toBe(84);
  });

  it('worst cohort surfaces correctly', () => {
    const r = computeAudienceFit(niche);
    expect(r.worst.cohort_id).toBe('senior');
    expect(r.worst.cohort_fit_score).toBe(22);
  });
});

describe('computeAudienceFit · niche-win beats uniform-mediocre', () => {
  const uniform: CohortFit[] = Array.from({ length: 8 }, (_, i) =>
    cohort(`uniform_${i}`, 50)
  );
  const niche: CohortFit[] = [
    cohort('crypto_native', 84),
    ...Array.from({ length: 7 }, (_, i) => cohort(`weak_${i}`, 25)),
  ];

  it('niche-win scores higher than uniform-50 (the failure mode of cohort_diversity)', () => {
    const rUniform = computeAudienceFit(uniform);
    const rNiche = computeAudienceFit(niche);
    expect(rNiche.audience_fit_score).toBeGreaterThan(rUniform.audience_fit_score);
  });
});

describe('computeAudienceFit · median robustness', () => {
  const oneZeroOutlier: CohortFit[] = [
    ...Array.from({ length: 7 }, (_, i) => cohort(`stable_${i}`, 50)),
    cohort('outlier', 0),
  ];

  it('median ignores single-cohort collapse', () => {
    const r = computeAudienceFit(oneZeroOutlier);
    expect(r.median_score).toBe(50);
    expect(r.worst.cohort_id).toBe('outlier');
  });
});

describe('computeAudienceFit · global avgs are completion-weighted', () => {
  const cohorts: CohortFit[] = [
    cohort('full_quota_50', 50, 14),
    cohort('under_quota_extreme', 100, 2),
    // weighted: (50*14 + 100*2) / 16 = 56.25
    // unweighted would be 75 — this lock catches that bug
  ];

  it('completion-weighted global task_success', () => {
    const r = computeAudienceFit(cohorts);
    expect(r.global_task_success_avg).toBeCloseTo(56.25, 4);
  });

  it('completion-weighted global sentiment', () => {
    const r = computeAudienceFit(cohorts);
    expect(r.global_sentiment_avg).toBeCloseTo(56.25, 4);
  });
});

describe('computeAudienceFit · empty cohorts', () => {
  it('throws rather than returning 0 (callers must handle scan_failed)', () => {
    expect(() => computeAudienceFit([])).toThrow();
  });
});

describe('band mappings are monotonic', () => {
  it('engagement bands strictly increasing abandon→extended', () => {
    const order: Array<keyof typeof ENGAGEMENT_BAND_TO_SCORE> = [
      'abandon', 'skim', 'browse', 'engage', 'extended',
    ];
    for (let i = 1; i < order.length; i++) {
      expect(ENGAGEMENT_BAND_TO_SCORE[order[i]!]).toBeGreaterThan(
        ENGAGEMENT_BAND_TO_SCORE[order[i - 1]!]
      );
    }
  });

  it('retention D-curve monotonic decreasing within each band', () => {
    for (const band of ['no_return', 'weak', 'moderate', 'strong'] as const) {
      const c = RETENTION_BAND_TO_DCURVE[band];
      expect(c.d1).toBeGreaterThanOrEqual(c.d3);
      expect(c.d3).toBeGreaterThanOrEqual(c.d7);
      expect(c.d7).toBeGreaterThanOrEqual(c.d30);
    }
  });

  it('retention bands strictly increasing at D-7', () => {
    expect(RETENTION_BAND_TO_DCURVE.no_return.d7).toBeLessThan(
      RETENTION_BAND_TO_DCURVE.weak.d7
    );
    expect(RETENTION_BAND_TO_DCURVE.weak.d7).toBeLessThan(
      RETENTION_BAND_TO_DCURVE.moderate.d7
    );
    expect(RETENTION_BAND_TO_DCURVE.moderate.d7).toBeLessThan(
      RETENTION_BAND_TO_DCURVE.strong.d7
    );
  });
});

describe('bootstrapCohortFitCI', () => {
  function score(v: number): PersonaDimensionScores {
    return {
      happiness: v,
      engagement: v,
      adoption: v,
      retention_d7: v,
      task_success: v,
    };
  }

  it('throws on empty cohort', () => {
    expect(() => bootstrapCohortFitCI([])).toThrow();
  });

  it('returns point estimate as both bounds when n<3', () => {
    const ci = bootstrapCohortFitCI([score(70), score(70)]);
    expect(ci.low).toBeCloseTo(70, 6);
    expect(ci.high).toBeCloseTo(70, 6);
  });

  it('CI brackets the point estimate', () => {
    // n=14 cohort with values around 60. CI should bracket ~60 with
    // some spread.
    const xs = Array.from({ length: 14 }, (_, i) => score(50 + i * 1.5));
    const ci = bootstrapCohortFitCI(xs, { iterations: 500 });
    const point = 50 + 6.5 * 1.5; // mean of 50..69.5 = 59.75
    expect(ci.low).toBeLessThanOrEqual(point);
    expect(ci.high).toBeGreaterThanOrEqual(point);
  });

  it('CI shrinks as n grows', () => {
    const small = bootstrapCohortFitCI(
      Array.from({ length: 5 }, () => score(50 + (Math.random() * 30 - 15))),
      { iterations: 500 },
    );
    const large = bootstrapCohortFitCI(
      Array.from({ length: 100 }, () => score(50 + (Math.random() * 30 - 15))),
      { iterations: 500 },
    );
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('uniform sample → tight CI', () => {
    const xs = Array.from({ length: 14 }, () => score(50));
    const ci = bootstrapCohortFitCI(xs);
    expect(ci.low).toBeCloseTo(50, 4);
    expect(ci.high).toBeCloseTo(50, 4);
  });
});
