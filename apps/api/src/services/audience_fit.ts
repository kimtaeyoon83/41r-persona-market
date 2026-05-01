// Audience-Fit synthesis — Option A formula (decided 2026-05-01).
//
// Replaces the spec's v1.0 "PMF Survival Score" composite, which had
// three structural flaws: (1) cohort_diversity penalised niche-PMF
// wins; (2) retention_d7 weighted 0.20 contradicted §4.2's "Very Low"
// confidence rating for retention; (3) task_success weighted 0.10
// contradicted §4.2's "High" confidence rating.
//
// Final formula:
//
//   audience_fit_score =
//       0.40 × best_cohort_fit_score
//     + 0.30 × median_cohort_fit_score
//     + 0.20 × global_task_success_avg
//     + 0.10 × global_sentiment_avg
//
// where each cohort_fit_score is itself a §4.2-weighted aggregate of
// the 5 dimensions. retention is included in the per-cohort aggregate
// at its honest §4.2 weight (0.05) but is NOT given a hero seat in the
// top-level composite — calibration confidence is too low (r=0.18).
//
// All inputs are 0-100. All outputs are 0-100. Pure functions only —
// no DB, no LLM, no I/O. Locked by audience_fit.test.ts.

// ─── Per-dimension weights (spec §4.2 v1.0) ────────────────────────
// Sum = 1.00. Confidence-ordered: high-confidence dimensions get the
// largest weight, low-confidence dimensions are measured but
// down-weighted. retention stays at 0.05 — data accumulates for
// calibration but doesn't drive the score yet.
export const DIMENSION_WEIGHTS_V1 = {
  engagement: 0.30,
  task_success: 0.30,
  happiness: 0.25,
  adoption: 0.10,
  retention: 0.05,
} as const;

// ─── Top-level Audience-Fit weights (Option A) ─────────────────────
export const AUDIENCE_FIT_WEIGHTS = {
  best: 0.40,
  median: 0.30,
  task_success_global: 0.20,
  sentiment_global: 0.10,
} as const;

// ─── Engagement category → score (spec §4.1, time bands) ──────────
export const ENGAGEMENT_BAND_TO_SCORE = {
  abandon: 10,   // <15s
  skim: 30,      // <1min
  browse: 55,    // 1-5min
  engage: 75,    // 5-15min
  extended: 90,  // >15min
} as const;

export type EngagementBand = keyof typeof ENGAGEMENT_BAND_TO_SCORE;

// ─── Retention category → D-curve (spec §4.1) ─────────────────────
// Persona returns a category; the D-curve is then a deterministic
// mapping. v1.0 baseline numbers; calibration target per spec §4.1.
export type RetentionBand = 'no_return' | 'weak' | 'moderate' | 'strong';

export const RETENTION_BAND_TO_DCURVE: Record<
  RetentionBand,
  { d1: number; d3: number; d7: number; d30: number }
> = {
  no_return: { d1: 5,  d3: 1,  d7: 0,  d30: 0 },
  weak:      { d1: 40, d3: 15, d7: 5,  d30: 1 },
  moderate:  { d1: 70, d3: 50, d7: 30, d30: 10 },
  strong:    { d1: 85, d3: 70, d7: 55, d30: 30 },
};

// ─── SUS-10 scoring (Brooke 1986) ─────────────────────────────────
// 10 Likert responses 1-5 in canonical SUS order:
//   Q1 use_freq, Q2 unnec_complex, Q3 ease_of_use, Q4 need_support,
//   Q5 well_integrated, Q6 inconsistency, Q7 quick_to_learn,
//   Q8 cumbersome, Q9 confident, Q10 needed_to_learn_first.
// Odd-numbered items (Q1,Q3,Q5,Q7,Q9 — array indices 0,2,4,6,8) score
//   = response - 1.
// Even-numbered items (Q2,Q4,Q6,Q8,Q10 — array indices 1,3,5,7,9) score
//   = 5 - response.
// Sum × 2.5 = SUS 0-100.
export function computeSusScore(responses: readonly number[]): number {
  if (responses.length !== 10) {
    throw new Error(`SUS expects exactly 10 responses, got ${responses.length}`);
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const r = responses[i]!;
    if (r < 1 || r > 5 || !Number.isFinite(r)) {
      throw new Error(`SUS response ${i + 1} out of range [1,5]: ${r}`);
    }
    // i is 0-indexed; odd Likert positions (Q1, Q3, ...) are at i % 2 === 0
    sum += i % 2 === 0 ? r - 1 : 5 - r;
  }
  return sum * 2.5;
}

// ─── Per-persona dimension scores ─────────────────────────────────
export type PersonaDimensionScores = {
  happiness: number;     // 0-100, from SUS
  engagement: number;    // 0-100, from band mapping
  adoption: number;      // 0-100, from signup_likelihood × 100
  retention_d7: number;  // 0-100, headline retention = D-7 from D-curve
  task_success: number;  // 0-100, from completion_likelihood × 100
};

// ─── Cohort aggregate ─────────────────────────────────────────────
export type CohortFit = {
  cohort_id: string;
  cohort_label: string;
  n_completed: number;
  // Per-dimension means across the cohort's personas
  dimension_means: PersonaDimensionScores;
  // Weighted §4.2 aggregate of dimension_means
  cohort_fit_score: number;
};

// ─── Top-level scan result ────────────────────────────────────────
export type AudienceFitResult = {
  audience_fit_score: number;     // 0-100 — the headline gauge value
  best: CohortFit;
  worst: CohortFit;
  median_score: number;
  global_task_success_avg: number;
  global_sentiment_avg: number;
  weights_used: typeof AUDIENCE_FIT_WEIGHTS;
};

// ─── Helpers ──────────────────────────────────────────────────────
export function median(xs: readonly number[]): number {
  if (xs.length === 0) {
    throw new Error('median: empty array');
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) {
    throw new Error('mean: empty array');
  }
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

// ─── Cohort-fit aggregator ────────────────────────────────────────
// Given dimension means for one cohort, produce its weighted §4.2
// aggregate. This is what the spec calls the "audience_fit_score per
// cohort" in §3.5.
export function computeCohortFitScore(d: PersonaDimensionScores): number {
  return (
    d.engagement * DIMENSION_WEIGHTS_V1.engagement +
    d.task_success * DIMENSION_WEIGHTS_V1.task_success +
    d.happiness * DIMENSION_WEIGHTS_V1.happiness +
    d.adoption * DIMENSION_WEIGHTS_V1.adoption +
    d.retention_d7 * DIMENSION_WEIGHTS_V1.retention
  );
}

// ─── Bootstrap CI on cohort_fit_score ────────────────────────────
// Resample the per-persona scores within a cohort with replacement
// `iterations` times, recompute cohort_fit_score on each sample,
// take the [alpha/2, 1-alpha/2] percentiles. Default n=1000,
// alpha=0.05 → 95% CI.
//
// Skips when n<3 (CI is meaningless on tiny samples) — returns the
// point estimate as both bounds in that case so the report can still
// render without conditional logic.
export function bootstrapCohortFitCI(
  personaScores: readonly PersonaDimensionScores[],
  opts: { iterations?: number; alpha?: number } = {},
): { low: number; high: number } {
  const n = personaScores.length;
  if (n === 0) {
    throw new Error('bootstrapCohortFitCI: empty cohort');
  }
  const point = computeCohortFitScore(meanDimensions(personaScores));
  if (n < 3) {
    return { low: point, high: point };
  }
  const iterations = opts.iterations ?? 1000;
  const alpha = opts.alpha ?? 0.05;
  const samples: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const resample: PersonaDimensionScores[] = [];
    for (let i = 0; i < n; i++) {
      // Math.random is fine — bootstrap noise dominates RNG quality.
      resample.push(personaScores[Math.floor(Math.random() * n)]!);
    }
    samples.push(computeCohortFitScore(meanDimensions(resample)));
  }
  samples.sort((a, b) => a - b);
  const lo = Math.floor((alpha / 2) * iterations);
  const hi = Math.floor((1 - alpha / 2) * iterations) - 1;
  return {
    low: samples[lo]!,
    high: samples[Math.min(hi, samples.length - 1)]!,
  };
}

function meanDimensions(xs: readonly PersonaDimensionScores[]): PersonaDimensionScores {
  const n = xs.length;
  return {
    happiness: xs.reduce((s, x) => s + x.happiness, 0) / n,
    engagement: xs.reduce((s, x) => s + x.engagement, 0) / n,
    adoption: xs.reduce((s, x) => s + x.adoption, 0) / n,
    retention_d7: xs.reduce((s, x) => s + x.retention_d7, 0) / n,
    task_success: xs.reduce((s, x) => s + x.task_success, 0) / n,
  };
}

// ─── Top-level synthesis (Option A) ───────────────────────────────
// Takes the per-cohort aggregates and returns the headline score plus
// the diagnostic context (best / worst / median / global cross-checks)
// the report UI needs.
//
// Throws if `cohorts` is empty — callers must guard for the
// no-completion case at the route level (return a "scan_failed"
// status rather than a synthetic 0).
export function computeAudienceFit(cohorts: readonly CohortFit[]): AudienceFitResult {
  if (cohorts.length === 0) {
    throw new Error('computeAudienceFit: no cohorts to aggregate');
  }
  const sorted = [...cohorts].sort((a, b) => b.cohort_fit_score - a.cohort_fit_score);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;

  const cohortScores = cohorts.map((c) => c.cohort_fit_score);
  const median_score = median(cohortScores);

  // Global cross-checks: weighted by cohort completion size so an
  // under-quota cohort doesn't dominate the average.
  const totalN = cohorts.reduce((s, c) => s + c.n_completed, 0) || 1;
  const global_task_success_avg =
    cohorts.reduce(
      (s, c) => s + c.dimension_means.task_success * c.n_completed,
      0
    ) / totalN;
  const global_sentiment_avg =
    cohorts.reduce(
      (s, c) => s + c.dimension_means.happiness * c.n_completed,
      0
    ) / totalN;

  const audience_fit_score =
    AUDIENCE_FIT_WEIGHTS.best * best.cohort_fit_score +
    AUDIENCE_FIT_WEIGHTS.median * median_score +
    AUDIENCE_FIT_WEIGHTS.task_success_global * global_task_success_avg +
    AUDIENCE_FIT_WEIGHTS.sentiment_global * global_sentiment_avg;

  return {
    audience_fit_score,
    best,
    worst,
    median_score,
    global_task_success_avg,
    global_sentiment_avg,
    weights_used: AUDIENCE_FIT_WEIGHTS,
  };
}
