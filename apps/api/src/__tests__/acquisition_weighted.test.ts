import { describe, it, expect } from 'vitest';
import {
  applyAcquisitionWeights,
  computeWeightedAudienceFit,
  computeAudienceFit,
  type CohortFit,
  type PersonaDimensionScores,
} from '../services/audience_fit.js';
import {
  computeAarrrWeightedFromRows,
  computeAarrrFromRows,
  type AarrrWeightedInputRow,
  type AarrrInputRow,
} from '../services/aarrr.js';
import { ACQUISITION_PRIORS } from '@41rpm/shared';

// ─── Test fixtures ────────────────────────────────────────────────
function dim(
  partial: Partial<PersonaDimensionScores> = {},
): PersonaDimensionScores {
  return {
    happiness: 70,
    engagement: 60,
    adoption: 50,
    retention_d7: 30,
    task_success: 65,
    ...partial,
  };
}

function cohort(
  id: string,
  label: string,
  fit: number,
  means: PersonaDimensionScores,
  n = 14,
): CohortFit {
  return {
    cohort_id: id,
    cohort_label: label,
    n_completed: n,
    dimension_means: means,
    cohort_fit_score: fit,
  };
}

const SAMPLE_COHORTS_8: readonly CohortFit[] = [
  cohort('crypto_native', 'Crypto Native', 50, dim()),
  cohort('defi_beginner', 'DeFi Beginner', 50, dim()),
  cohort('designer_20s', 'Designer (20s)', 50, dim()),
  cohort('senior', 'Senior (50+)', 50, dim()),
  cohort('teen_newcomer', 'Teen Newcomer', 50, dim()),
  cohort('mobile_power', 'Mobile Power', 50, dim()),
  cohort('web3_pro', 'Web3 Pro', 50, dim()),
  cohort('non_tech_30s', 'Non-tech 30s', 50, dim()),
];

// ─── applyAcquisitionWeights ──────────────────────────────────────

describe('applyAcquisitionWeights', () => {
  it('attaches arrival_share + abandon_rate from priors per cohort', () => {
    const out = applyAcquisitionWeights(
      SAMPLE_COHORTS_8,
      ACQUISITION_PRIORS.DeFi,
    );
    const byId = new Map(out.map((c) => [c.cohort_id, c]));
    expect(byId.get('crypto_native')!.arrival_share).toBe(0.30);
    expect(byId.get('crypto_native')!.abandon_rate).toBe(0.20);
    expect(byId.get('senior')!.arrival_share).toBe(0.01);
    expect(byId.get('senior')!.abandon_rate).toBe(0.90);
  });

  it('weighted dimension means = engaged means × (1 - abandon_rate)', () => {
    const out = applyAcquisitionWeights(
      SAMPLE_COHORTS_8,
      ACQUISITION_PRIORS.DeFi,
    );
    const seniorOut = out.find((c) => c.cohort_id === 'senior')!;
    // senior abandon_rate = 0.90 → survival = 0.10
    expect(seniorOut.weighted_dimension_means.engagement).toBeCloseTo(6, 5);
    expect(seniorOut.weighted_dimension_means.task_success).toBeCloseTo(
      65 * 0.10,
      5,
    );
  });

  it('weighted cohort_fit_score ≤ unweighted (since survival ≤ 1)', () => {
    const out = applyAcquisitionWeights(
      SAMPLE_COHORTS_8,
      ACQUISITION_PRIORS.DeFi,
    );
    for (const c of out) {
      expect(c.weighted_cohort_fit_score).toBeLessThanOrEqual(
        c.cohort_fit_score + 0.0001,
      );
    }
  });

  it('cohort id missing from priors → arrival 0, abandon 0.5 (neutral)', () => {
    const cohorts: CohortFit[] = [
      cohort('unknown_cohort', 'Unknown', 50, dim()),
    ];
    const out = applyAcquisitionWeights(cohorts, ACQUISITION_PRIORS.DeFi);
    expect(out[0]!.arrival_share).toBe(0);
    expect(out[0]!.abandon_rate).toBe(0.5);
  });
});

// ─── computeWeightedAudienceFit ──────────────────────────────────

describe('computeWeightedAudienceFit', () => {
  it('weighted top-line ≤ unweighted top-line (survival ≤ 1)', () => {
    const unweighted = computeAudienceFit(SAMPLE_COHORTS_8);
    const weighted = computeWeightedAudienceFit(
      applyAcquisitionWeights(SAMPLE_COHORTS_8, ACQUISITION_PRIORS.DeFi),
    );
    expect(weighted.audience_fit_score_weighted).toBeLessThanOrEqual(
      unweighted.audience_fit_score + 0.0001,
    );
  });

  it('best_weighted ranks by weighted_cohort_fit_score, not unweighted', () => {
    // Senior on DeFi: high engaged means but high abandon (0.90)
    // Crypto Native on DeFi: lower engaged means but low abandon (0.20)
    const cohorts: CohortFit[] = [
      cohort('senior', 'Senior', 90, dim({ engagement: 90, task_success: 90 })),
      cohort(
        'crypto_native',
        'Crypto Native',
        50,
        dim({ engagement: 50, task_success: 50 }),
      ),
    ];
    const out = computeWeightedAudienceFit(
      applyAcquisitionWeights(cohorts, ACQUISITION_PRIORS.DeFi),
    );
    expect(out.best_weighted.cohort_id).toBe('crypto_native');
    expect(out.worst_weighted.cohort_id).toBe('senior');
  });

  it('global_task_success_weighted uses arrival_share, not n_completed', () => {
    // crypto_native arrival 0.30, senior 0.01 (DeFi)
    const cohorts: CohortFit[] = [
      cohort('crypto_native', 'Crypto Native', 50, dim({ task_success: 100 }), 14),
      cohort('senior', 'Senior', 50, dim({ task_success: 0 }), 14),
    ];
    const w = applyAcquisitionWeights(cohorts, ACQUISITION_PRIORS.DeFi);
    const out = computeWeightedAudienceFit(w);
    // weighted_task crypto_native = 100 × 0.80 = 80; senior = 0 × 0.10 = 0
    // global = (0.30×80 + 0.01×0) / 0.31 ≈ 77.4
    expect(out.global_task_success_weighted).toBeGreaterThan(70);
  });

  it('throws on empty input', () => {
    expect(() => computeWeightedAudienceFit([])).toThrow();
  });
});

// ─── computeAarrrWeightedFromRows ────────────────────────────────

function row(
  cohortId: string,
  scores: { task: number; ret: number; hap: number; ado: number },
): AarrrWeightedInputRow {
  return {
    cohortId,
    isFlagged: false,
    happiness: scores.hap,
    taskSuccess: scores.task,
    adoption: scores.ado,
    retentionD7: scores.ret,
  };
}

describe('computeAarrrWeightedFromRows', () => {
  it('acquisition stays at 100%, later stages drop below unweighted', () => {
    const rows: AarrrWeightedInputRow[] = [];
    const cohorts = Object.keys(ACQUISITION_PRIORS.DeFi);
    for (const cId of cohorts) {
      for (let i = 0; i < 10; i++) {
        rows.push(row(cId, { task: 90, ret: 90, hap: 90, ado: 90 }));
      }
    }
    const w = computeAarrrWeightedFromRows(rows, ACQUISITION_PRIORS.DeFi);
    expect(w).not.toBeNull();
    expect(w!.stages[0]!.key).toBe('acquisition');
    expect(w!.stages[0]!.score).toBe(100);
    // Phase B-followup: weighted activation now also × INTENT_ACTION
    // factor (0.5 for activation), so the previous 50-80 range halves
    // to ~25-40. Still well below the 100% panel baseline.
    expect(w!.stages[1]!.score).toBeLessThan(40);
    expect(w!.stages[1]!.score).toBeGreaterThan(25);
  });

  it('weighted funnel monotonic non-increasing', () => {
    const rows: AarrrWeightedInputRow[] = [];
    const cohorts = Object.keys(ACQUISITION_PRIORS.DeFi);
    for (const cId of cohorts) {
      for (let i = 0; i < 10; i++) {
        rows.push(row(cId, { task: 70, ret: 50, hap: 65, ado: 70 }));
      }
    }
    const w = computeAarrrWeightedFromRows(rows, ACQUISITION_PRIORS.DeFi);
    expect(w).not.toBeNull();
    for (let i = 1; i < w!.stages.length; i++) {
      expect(w!.stages[i]!.score).toBeLessThanOrEqual(
        w!.stages[i - 1]!.score + 0.0001,
      );
    }
  });

  it('weighted activation < unweighted activation (DeFi audience)', () => {
    const rows: AarrrWeightedInputRow[] = [];
    const cohorts = Object.keys(ACQUISITION_PRIORS.DeFi);
    for (const cId of cohorts) {
      for (let i = 0; i < 10; i++) {
        rows.push(row(cId, { task: 70, ret: 50, hap: 65, ado: 70 }));
      }
    }
    const unweightedRows: AarrrInputRow[] = rows.map((r) => ({
      isFlagged: r.isFlagged,
      happiness: r.happiness,
      taskSuccess: r.taskSuccess,
      adoption: r.adoption,
      retentionD7: r.retentionD7,
    }));
    const u = computeAarrrFromRows(unweightedRows);
    const w = computeAarrrWeightedFromRows(rows, ACQUISITION_PRIORS.DeFi);
    expect(u).not.toBeNull();
    expect(w).not.toBeNull();
    expect(u!.stages[1]!.score).toBe(100);
    expect(w!.stages[1]!.score).toBeLessThan(u!.stages[1]!.score);
  });

  it('returns null on empty / all-flagged input', () => {
    expect(computeAarrrWeightedFromRows([], ACQUISITION_PRIORS.DeFi)).toBeNull();
    const allFlagged: AarrrWeightedInputRow[] = [
      {
        cohortId: 'web3_pro',
        isFlagged: true,
        happiness: 50,
        taskSuccess: 50,
        adoption: 50,
        retentionD7: 50,
      },
    ];
    expect(
      computeAarrrWeightedFromRows(allFlagged, ACQUISITION_PRIORS.DeFi),
    ).toBeNull();
  });
});
