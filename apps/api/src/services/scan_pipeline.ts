// Scan pipeline + fire-and-forget worker.
//
// Flow:
//   POST /api/scan → INSERT audience_fit_scans (status=pending)
//                  → startScanWorker(scanId)
//   ↓
//   runScan(scanId) — runs in setImmediate (next tick)
//     1. status='sampling'    — load active personas, run cohort selection
//     2. status='responding'  — for each assigned persona, simulate
//                                response + write scan_persona_responses
//     3. status='aggregating' — compute cohort means, write
//                                scan_cohort_results, computeAudienceFit(),
//                                update audience_fit_scans
//     4. status='completed'   — set completedAt, persist synthesis fields
//
// On error at any step: status='failed' so the report endpoint
// returns the error state. Phase 1C will add a `failure_reason`
// column.
//
// Concurrency: Phase 1B runs personas serially per scan. With the
// deterministic simulator a 113-persona scan completes in <100ms.
// Phase 1C will need a concurrency cap when swapping in real Sonnet.

import { eq } from 'drizzle-orm';
import { STANDARD_COHORTS } from '@41rpm/shared';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';
import {
  type CohortFit,
  type PersonaDimensionScores,
  computeAudienceFit,
  computeCohortFitScore,
} from './audience_fit.js';
import {
  selectPersonasForCohorts,
  type PersonaRow,
} from './cohort_selection.js';
import { simulatePersonaResponse } from './dimension_simulator.js';

const log = logger.child({ service: 'scan_pipeline' });

// ─── Public entry: fire-and-forget ────────────────────────────────
export function startScanWorker(scanId: string): void {
  setImmediate(() => {
    runScan(scanId).catch(async (err) => {
      log.error({ err, scanId }, 'scan worker crashed');
      try {
        await db
          .update(schema.audienceFitScans)
          .set({ status: 'failed' })
          .where(eq(schema.audienceFitScans.id, scanId));
      } catch (markErr) {
        log.error({ err: markErr, scanId }, 'failed to mark scan as failed');
      }
    });
  });
}

// ─── Internal: full pipeline ──────────────────────────────────────
async function runScan(scanId: string): Promise<void> {
  // Idempotency guard — bail out if not in 'pending'.
  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, scanId));
  if (!scan) {
    log.warn({ scanId }, 'scan row vanished; aborting');
    return;
  }
  if (scan.status !== 'pending') {
    log.info({ scanId, status: scan.status }, 'scan not pending; skipping');
    return;
  }

  const targetUrl = scan.targetUrl;
  const hypothesis = scan.hypothesis ?? undefined;

  // Step 1 — sampling.
  await setStatus(scanId, 'sampling');
  const personas = await db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.isActive, true));

  const { assignments, unassigned } = selectPersonasForCohorts(personas);
  const assignedCount = Array.from(assignments.values()).reduce(
    (s, arr) => s + arr.length,
    0
  );
  log.info(
    {
      scanId,
      pool: personas.length,
      assigned: assignedCount,
      unassigned: unassigned.length,
    },
    'cohort selection complete'
  );

  if (assignedCount === 0) {
    await setStatus(scanId, 'failed');
    log.warn({ scanId }, 'no personas could be assigned to any cohort');
    return;
  }

  // Step 2 — responding.
  await setStatus(scanId, 'responding');
  const cohortBuckets = new Map<
    string,
    Array<{
      persona: PersonaRow;
      scores: PersonaDimensionScores;
      flagged: boolean;
    }>
  >();
  let totalAttempted = 0;
  let totalCompleted = 0;
  let totalFlagged = 0;

  for (const [cohortId, cohortPersonas] of assignments) {
    if (cohortPersonas.length === 0) continue;
    const bucket: Array<{
      persona: PersonaRow;
      scores: PersonaDimensionScores;
      flagged: boolean;
    }> = [];
    for (const persona of cohortPersonas) {
      totalAttempted += 1;
      const sim = simulatePersonaResponse(persona, targetUrl, hypothesis);
      bucket.push({
        persona,
        scores: sim.scores,
        flagged: sim.is_flagged,
      });
      totalCompleted += 1;
      if (sim.is_flagged) totalFlagged += 1;

      await db.insert(schema.scanPersonaResponses).values({
        scanId,
        personaId: persona.id,
        cohortId,
        rawResponse: sim.raw,
        happinessScore: sim.scores.happiness,
        engagementScore: sim.scores.engagement,
        adoptionScore: sim.scores.adoption,
        retentionD7: sim.scores.retention_d7,
        taskSuccessScore: sim.scores.task_success,
        retentionDCurve: sim.retention_d_curve,
        voiceFirstImpression: null,
        voiceFriction: null,
        voiceBiggestFriction: null,
        voiceWouldReturnBecause: null,
        isFlagged: sim.is_flagged,
        flagReason: sim.flag_reason,
        llmCostUsd: 0,
        llmLatencyMs: 0,
      });
    }
    cohortBuckets.set(cohortId, bucket);
  }

  // Step 3 — aggregating.
  await setStatus(scanId, 'aggregating');
  const cohortFits: CohortFit[] = [];

  for (const cohortDef of STANDARD_COHORTS) {
    const bucket = cohortBuckets.get(cohortDef.id) ?? [];
    const validScores = bucket.filter((b) => !b.flagged).map((b) => b.scores);

    if (validScores.length === 0) {
      // Empty / fully flagged cohort: persist a row showing under-quota
      // for the UI but skip from synthesis input.
      await db.insert(schema.scanCohortResults).values({
        scanId,
        cohortId: cohortDef.id,
        cohortLabel: cohortDef.label,
        nTarget: cohortDef.target_n,
        nCompleted: 0,
        nFlagged: bucket.length,
        happinessMean: null,
        engagementMean: null,
        adoptionMean: null,
        retentionMean: null,
        taskSuccessMean: null,
        cohortFitScore: null,
        cohortFitCiLow: null,
        cohortFitCiHigh: null,
        retentionDCurve: null,
      });
      continue;
    }

    const dimMeans: PersonaDimensionScores = {
      happiness: avg(validScores.map((s) => s.happiness)),
      engagement: avg(validScores.map((s) => s.engagement)),
      adoption: avg(validScores.map((s) => s.adoption)),
      retention_d7: avg(validScores.map((s) => s.retention_d7)),
      task_success: avg(validScores.map((s) => s.task_success)),
    };
    const cohortFitScore = computeCohortFitScore(dimMeans);

    const dCurves = bucket
      .filter((b) => !b.flagged)
      .map((b) => simulateRetentionDCurveFromD7(b.scores.retention_d7));
    const dMean = {
      d1: avg(dCurves.map((d) => d.d1)),
      d3: avg(dCurves.map((d) => d.d3)),
      d7: avg(dCurves.map((d) => d.d7)),
      d30: avg(dCurves.map((d) => d.d30)),
    };

    cohortFits.push({
      cohort_id: cohortDef.id,
      cohort_label: cohortDef.label,
      n_completed: validScores.length,
      dimension_means: dimMeans,
      cohort_fit_score: cohortFitScore,
    });

    await db.insert(schema.scanCohortResults).values({
      scanId,
      cohortId: cohortDef.id,
      cohortLabel: cohortDef.label,
      nTarget: cohortDef.target_n,
      nCompleted: validScores.length,
      nFlagged: bucket.length - validScores.length,
      happinessMean: dimMeans.happiness,
      engagementMean: dimMeans.engagement,
      adoptionMean: dimMeans.adoption,
      retentionMean: dimMeans.retention_d7,
      taskSuccessMean: dimMeans.task_success,
      cohortFitScore,
      cohortFitCiLow: null, // Phase 1C: bootstrap CI
      cohortFitCiHigh: null,
      retentionDCurve: dMean,
    });
  }

  if (cohortFits.length === 0) {
    await setStatus(scanId, 'failed');
    log.warn({ scanId }, 'no cohort produced valid scores');
    return;
  }

  const result = computeAudienceFit(cohortFits);

  // Step 4 — completed.
  await db
    .update(schema.audienceFitScans)
    .set({
      status: 'completed',
      audienceFitScore: result.audience_fit_score,
      bestCohortId: result.best.cohort_id,
      bestCohortScore: result.best.cohort_fit_score,
      medianCohortScore: result.median_score,
      worstCohortId: result.worst.cohort_id,
      worstCohortScore: result.worst.cohort_fit_score,
      globalTaskSuccessAvg: result.global_task_success_avg,
      globalSentimentAvg: result.global_sentiment_avg,
      personasAttempted: totalAttempted,
      personasCompleted: totalCompleted,
      personasFlagged: totalFlagged,
      // Auto-detect category not implemented in Phase 1B — Phase 1C
      // adds a Haiku call during the 'capturing' step.
      category: 'DeFi',
      categoryConfidence: 0.5,
      oneLinePitch: null,
      weightsVersion: 'v1.0',
      completedAt: new Date(),
    })
    .where(eq(schema.audienceFitScans.id, scanId));

  log.info(
    {
      scanId,
      score: result.audience_fit_score.toFixed(1),
      best: result.best.cohort_label,
      worst: result.worst.cohort_label,
    },
    'scan completed'
  );
}

async function setStatus(scanId: string, status: string): Promise<void> {
  await db
    .update(schema.audienceFitScans)
    .set({ status })
    .where(eq(schema.audienceFitScans.id, scanId));
}

function avg(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

// Reverse-map a D-7 score back to its source band's full D-curve so
// the cohort aggregate D-curve has all four numbers, not just D-7.
// Phase 1C will pass the full D-curve through directly.
function simulateRetentionDCurveFromD7(d7: number): {
  d1: number;
  d3: number;
  d7: number;
  d30: number;
} {
  if (d7 >= 55) return { d1: 85, d3: 70, d7: 55, d30: 30 };
  if (d7 >= 30) return { d1: 70, d3: 50, d7: 30, d30: 10 };
  if (d7 >= 5) return { d1: 40, d3: 15, d7: 5, d30: 1 };
  return { d1: 5, d3: 1, d7: 0, d30: 0 };
}
