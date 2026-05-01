// AARRR funnel — Phase 2-E (Pro tier).
//
// Derived purely from existing scan_persona_responses rows — no new
// pipeline, no extra LLM calls. Each stage represents the % of
// non-flagged personas that pass that stage's threshold.
//
// Per spec §1.5 + §6.2:
//   Acquisition  — how they reached you (assumed 100% — they're
//                  on the URL by definition).
//   Activation   — Aha moment reached. Proxy: task_success >= 50.
//   Retention    — Returns by D-7. Proxy: retention_d7 >= 30.
//   Referral     — Would recommend. Proxy: happiness >= 70.
//   Revenue      — Conversion likely. Proxy: adoption >= 50.
//
// Visualised as a classic AARRR funnel: each successive bar is a
// subset of the previous one, tightening as personas drop off.
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
  activation: 'task_success ≥ 50',
  retention: 'retention_d7 ≥ 30',
  referral: 'happiness ≥ 70',
  revenue: 'adoption ≥ 50',
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

  const countWhere = (predicate: (r: (typeof valid)[number]) => boolean): number =>
    valid.filter(predicate).length;

  const acquisitionN = total;
  const activationN = countWhere((r) => (r.taskSuccess ?? 0) >= 50);
  const retentionN = countWhere((r) => (r.retentionD7 ?? 0) >= 30);
  const referralN = countWhere((r) => (r.happiness ?? 0) >= 70);
  const revenueN = countWhere((r) => (r.adoption ?? 0) >= 50);

  const stages: AarrrStage[] = [
    {
      key: 'acquisition',
      label: 'Acquisition',
      score: 100,
      n_passing: acquisitionN,
      total,
      threshold: THRESHOLDS.acquisition,
    },
    {
      key: 'activation',
      label: 'Activation',
      score: (activationN / total) * 100,
      n_passing: activationN,
      total,
      threshold: THRESHOLDS.activation,
    },
    {
      key: 'retention',
      label: 'Retention',
      score: (retentionN / total) * 100,
      n_passing: retentionN,
      total,
      threshold: THRESHOLDS.retention,
    },
    {
      key: 'referral',
      label: 'Referral',
      score: (referralN / total) * 100,
      n_passing: referralN,
      total,
      threshold: THRESHOLDS.referral,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      score: (revenueN / total) * 100,
      n_passing: revenueN,
      total,
      threshold: THRESHOLDS.revenue,
    },
  ];

  return { stages, total_personas: total };
}
