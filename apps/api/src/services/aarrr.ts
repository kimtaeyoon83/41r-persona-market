// AARRR funnel — Phase 2-E (Pro tier).
//
// Derived purely from existing scan_persona_responses rows — no new
// pipeline, no extra LLM calls. Funnel is CUMULATIVE: each stage's
// passing personas are a subset of the previous stage's, so the bar
// chart is monotonically non-increasing and reads as a real funnel.
//
// Per spec §1.5 + §6.2:
//   Acquisition  — reached the URL (baseline 100%).
//   Activation   — Aha moment reached. Adds: task_success >= 30.
//   Retention    — Returns by D-7. Adds: retention_d7 >= 30.
//   Referral     — Would recommend. Adds: happiness >= 60.
//   Revenue      — Conversion likely. Adds: adoption >= 65.
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
  retention: '+ retention_d7 ≥ 30',
  referral: '+ happiness ≥ 60',
  revenue: '+ adoption ≥ 65',
} as const;

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
  const retentionSet = activationSet.filter((r) => (r.retentionD7 ?? 0) >= 30);
  const referralSet = retentionSet.filter((r) => (r.happiness ?? 0) >= 60);
  const revenueSet = referralSet.filter((r) => (r.adoption ?? 0) >= 65);

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
