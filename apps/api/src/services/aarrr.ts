// AARRR funnel — Phase 2-E (Pro tier).
//
// Derived purely from existing scan_persona_responses rows — no new
// pipeline, no extra LLM calls. Funnel is CUMULATIVE: each stage's
// passing personas are a subset of the previous stage's, so the bar
// chart is monotonically non-increasing and reads as a real funnel.
//
// Per spec §1.5 + §6.2 — see THRESHOLDS const below for the
// authoritative values (also surfaced in the report UI as the
// per-stage `threshold` string):
//   Acquisition  — reached the URL (baseline 100%).
//   Activation   — Aha moment reached. Adds: task_success >= 30.
//   Retention    — Returns by D-7. Adds: retention_d7 >= 5.
//   Referral     — Would recommend. Adds: happiness >= 60.
//   Revenue      — Conversion likely. Adds: adoption >= 30.
// (Retention + Revenue thresholds were retuned 2026-05-06 from the
//  v1.0 baseline of 30 / 65; rationale documented in the comment
//  next to THRESHOLDS below.)
//
// Thresholds re-derived from the percentile distribution across all
// scans (audit 2026-05-02): they were previously independent filters
// at flat values (50/30/70/50) which clustered around ~25-28% on
// uniswap.org and didn't read as a funnel. The new combo + cumulative
// semantics produce a proper 100 → 33 → 25 → 25 → 18 shape on the
// same scan.
//
// Mode A only — Mode B is a single-audience verdict scan and
// "funnel" semantics don't apply.

import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type AarrrStage = {
  key: 'acquisition' | 'activation' | 'retention' | 'referral' | 'revenue';
  label: string;
  score: number; // 0-100, % of total personas passing
  n_passing: number;
  total: number;
  threshold: string; // human-readable threshold descriptor
};

export type AarrrFunnel = {
  stages: AarrrStage[];
  total_personas: number;
};

const THRESHOLDS = {
  acquisition: 'Reached the URL (baseline)',
  activation: '+ task_success ≥ 30',
  retention: '+ retention_d7 ≥ 5',
  referral: '+ happiness ≥ 60',
  revenue: '+ adoption ≥ 30',
} as const;

// v1.1 threshold tuning (2026-05-06):
//   retention 30 → 5 — observed persona distribution puts ~85% in
//                       weak band (D7=5), only ~3% in moderate (≥30),
//                       so the old gate killed the funnel post-activation.
//                       Lowered to ≥5 = "any return signal at all"
//                       (no_return still excluded).
//   revenue 65 → 30  — observed adoption distribution is mostly 0-50;
//                       65 was unreachable. 30 = "meaningful purchase
//                       intent", still strict enough to drop the funnel.

export type AarrrInputRow = {
  isFlagged: boolean;
  happiness: number | null;
  taskSuccess: number | null;
  adoption: number | null;
  retentionD7: number | null;
};

// Pure compute — exported for unit tests so the cumulative semantics
// + threshold boundaries can be locked without spinning up the DB.
// computeAarrr() is a thin wrapper that just adds the DB read.
export function computeAarrrFromRows(
  rows: readonly AarrrInputRow[],
): AarrrFunnel | null {
  const valid = rows.filter((r) => !r.isFlagged);
  const total = valid.length;
  if (total === 0) return null;

  // Cumulative funnel — each stage filters the personas that passed
  // every previous stage. This guarantees a monotonic non-increasing
  // shape, which is what "funnel" semantically means. Independent
  // filters (the previous implementation) could produce non-funnel
  // shapes like 100→28→25→27→28 where Referral exceeded Activation.
  const acqSet = valid;
  const activationSet = acqSet.filter((r) => (r.taskSuccess ?? 0) >= 30);
  const retentionSet = activationSet.filter((r) => (r.retentionD7 ?? 0) >= 5);
  const referralSet = retentionSet.filter((r) => (r.happiness ?? 0) >= 60);
  const revenueSet = referralSet.filter((r) => (r.adoption ?? 0) >= 30);

  const stages: AarrrStage[] = [
    {
      key: 'acquisition',
      label: 'Acquisition',
      score: 100,
      n_passing: acqSet.length,
      total,
      threshold: THRESHOLDS.acquisition,
    },
    {
      key: 'activation',
      label: 'Activation',
      score: (activationSet.length / total) * 100,
      n_passing: activationSet.length,
      total,
      threshold: THRESHOLDS.activation,
    },
    {
      key: 'retention',
      label: 'Retention',
      score: (retentionSet.length / total) * 100,
      n_passing: retentionSet.length,
      total,
      threshold: THRESHOLDS.retention,
    },
    {
      key: 'referral',
      label: 'Referral',
      score: (referralSet.length / total) * 100,
      n_passing: referralSet.length,
      total,
      threshold: THRESHOLDS.referral,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      score: (revenueSet.length / total) * 100,
      n_passing: revenueSet.length,
      total,
      threshold: THRESHOLDS.revenue,
    },
  ];

  return { stages, total_personas: total };
}

// Thin DB → pure-compute wrapper. The route handler calls this; the
// business rules are tested via computeAarrrFromRows above.
export async function computeAarrr(scanId: string): Promise<AarrrFunnel | null> {
  const rows = await db
    .select({
      isFlagged: schema.scanPersonaResponses.isFlagged,
      happiness: schema.scanPersonaResponses.happinessScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      adoption: schema.scanPersonaResponses.adoptionScore,
      retentionD7: schema.scanPersonaResponses.retentionD7,
    })
    .from(schema.scanPersonaResponses)
    .where(eq(schema.scanPersonaResponses.scanId, scanId));
  return computeAarrrFromRows(rows);
}

// ─── Acquisition Layer (Phase B1 v1.1) — weighted AARRR ──────────
// Stage 2 weighted funnel. Each persona row carries cohort_id; the
// priors map (CategoryPriors from @41rpm/shared) gives per-cohort
// arrival_share + abandon_rate.
//
// Math (per stage X != acquisition):
//   pct_X_weighted = Σ_cohorts( arrival_share × (1 - abandon_rate)
//                              × within_cohort_pass_rate_X )
//
// Acquisition stage stays at 100% (baseline = "reached the URL");
// the abandon mass is deducted starting at Activation. This produces
// a real visitor-level funnel shape vs the persona-conditional one.
//
// Returns null on empty / all-flagged input (matches unweighted).

export type AarrrWeightedInputRow = AarrrInputRow & {
  cohortId: string;
};

type CategoryPriorsType = import('@41rpm/shared').CategoryPriors;
type CohortIdType = import('@41rpm/shared').CohortId;

export function computeAarrrWeightedFromRows(
  rows: readonly AarrrWeightedInputRow[],
  priors: CategoryPriorsType,
): AarrrFunnel | null {
  const valid = rows.filter((r) => !r.isFlagged);
  if (valid.length === 0) return null;

  // Group rows by cohort_id so we can compute within-cohort pass
  // rates before applying acquisition weights.
  const byCohort = new Map<string, AarrrWeightedInputRow[]>();
  for (const r of valid) {
    const list = byCohort.get(r.cohortId) ?? [];
    list.push(r);
    byCohort.set(r.cohortId, list);
  }

  type CohortPassRates = {
    cohortId: string;
    n: number;
    arrival_share: number;
    survival: number; // = 1 - abandon_rate
    activationRate: number;
    retentionRate: number;
    referralRate: number;
    revenueRate: number;
  };
  const perCohort: CohortPassRates[] = [];
  for (const [cohortId, cohortRows] of byCohort) {
    const n = cohortRows.length;
    const acqSet = cohortRows;
    const activationSet = acqSet.filter(
      (r) => (r.taskSuccess ?? 0) >= 30,
    );
    const retentionSet = activationSet.filter(
      (r) => (r.retentionD7 ?? 0) >= 5,
    );
    const referralSet = retentionSet.filter(
      (r) => (r.happiness ?? 0) >= 60,
    );
    const revenueSet = referralSet.filter(
      (r) => (r.adoption ?? 0) >= 30,
    );
    const p = priors[cohortId as CohortIdType];
    const arrival_share = p?.arrival_share ?? 0;
    const survival = 1 - (p?.abandon_rate ?? 0.5);
    perCohort.push({
      cohortId,
      n,
      arrival_share,
      survival,
      activationRate: activationSet.length / n,
      retentionRate: retentionSet.length / n,
      referralRate: referralSet.length / n,
      revenueRate: revenueSet.length / n,
    });
  }

  const totalArrival =
    perCohort.reduce((s, c) => s + c.arrival_share, 0) || 1;
  const weightedPct = (rateKey: keyof CohortPassRates): number => {
    const wsum = perCohort.reduce((s, c) => {
      const rate = c[rateKey] as number;
      return s + c.arrival_share * c.survival * rate;
    }, 0);
    return (wsum / totalArrival) * 100;
  };

  // Intent-action multipliers (Phase B-followup, 2026-05-06).
  // Personas predict INTENT ("would I do X?"). GA4 measures ACTION
  // ("did X happen?"). The intent-action gap is well-known in
  // consumer research and grows with each stage of the funnel:
  // signing up is harder than browsing; converting is harder than
  // signing up. These factors collapse persona intent toward
  // action-realistic rates. Acquisition stays at 100% (baseline).
  // Calibrated against Merch Store GA4 (n=1) — Phase B-followup
  // step 3 will validate generalization to other categories.
  const INTENT_ACTION = {
    activation: 0.50,
    retention: 0.20,
    referral: 0.10,
    revenue: 0.05,
  } as const;

  const totalPersonas = valid.length;
  // `n_passing` for weighted stages is an *estimated* visitor-equivalent
  // count, derived from `score% × totalPersonas`. The score itself is
  // a visitor-traffic-weighted projection; it has no exact integer
  // count (no real visitors were measured), but rendering "0 / 111"
  // in the UI made the funnel look broken (2026-05-07 user report).
  // The estimate keeps panel/visitor cards visually consistent and
  // reads naturally as "~25 of 111 (visitor-weighted)" in the UI.
  const estCount = (score: number): number =>
    Math.round((score / 100) * totalPersonas);
  const activationScore = weightedPct('activationRate') * INTENT_ACTION.activation;
  const retentionScore = weightedPct('retentionRate') * INTENT_ACTION.retention;
  const referralScore = weightedPct('referralRate') * INTENT_ACTION.referral;
  const revenueScore = weightedPct('revenueRate') * INTENT_ACTION.revenue;
  const stages: AarrrStage[] = [
    {
      key: 'acquisition',
      label: 'Acquisition',
      score: 100,
      n_passing: totalPersonas,
      total: totalPersonas,
      threshold: THRESHOLDS.acquisition,
    },
    {
      key: 'activation',
      label: 'Activation',
      score: activationScore,
      n_passing: estCount(activationScore),
      total: totalPersonas,
      threshold: THRESHOLDS.activation,
    },
    {
      key: 'retention',
      label: 'Retention',
      score: retentionScore,
      n_passing: estCount(retentionScore),
      total: totalPersonas,
      threshold: THRESHOLDS.retention,
    },
    {
      key: 'referral',
      label: 'Referral',
      score: referralScore,
      n_passing: estCount(referralScore),
      total: totalPersonas,
      threshold: THRESHOLDS.referral,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      score: revenueScore,
      n_passing: estCount(revenueScore),
      total: totalPersonas,
      threshold: THRESHOLDS.revenue,
    },
  ];

  return { stages, total_personas: totalPersonas };
}
