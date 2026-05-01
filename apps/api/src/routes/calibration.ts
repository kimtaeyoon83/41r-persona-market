// /api/calibration — Phase 2-C-1.
//
// GET /api/calibration/current
//   Returns the aggregated correlation report for the current
//   quarter (last 90 days). The frontend Calibration page renders
//   this directly: per-dimension Pearson r + confidence band +
//   delta from the prior quarter, plus track counts and the
//   weight-version timeline.

import { Router, type Router as RouterType } from 'express';
import { and, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import {
  aggregateCalibration,
  type CalibrationRecord,
} from '../services/calibration/aggregator.js';
import { runTrackA } from '../services/calibration/track_a.js';
import { logger } from '../logger.js';

const router: RouterType = Router();

const QUARTER_DAYS = 90;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

router.get('/current', async (_req, res) => {
  const now = new Date();
  const currStart = new Date(now.getTime() - QUARTER_DAYS * 24 * 60 * 60 * 1000);
  const priorStart = new Date(
    now.getTime() - QUARTER_DAYS * 2 * 24 * 60 * 60 * 1000,
  );

  const currRows = await db
    .select()
    .from(schema.calibrationRecords)
    .where(gte(schema.calibrationRecords.date, isoDate(currStart)));

  const priorRows = await db
    .select()
    .from(schema.calibrationRecords)
    .where(
      and(
        gte(schema.calibrationRecords.date, isoDate(priorStart)),
        lt(schema.calibrationRecords.date, isoDate(currStart)),
      ),
    );

  // Postgres `date` column hands back a 'YYYY-MM-DD' string via the
  // driver; defensive cast in case some environments return a Date.
  const shape = (
    r: typeof schema.calibrationRecords.$inferSelect,
  ): CalibrationRecord => ({
    date: typeof r.date === 'string' ? r.date : isoDate(new Date(r.date)),
    siteUrl: r.siteUrl,
    personaId: r.personaId,
    dimension: r.dimension,
    llmInference: r.llmInference,
    groundTruth: r.groundTruth,
    delta: r.delta,
    source: r.source,
  });

  const aggregate = aggregateCalibration(
    currRows.map(shape),
    priorRows.map(shape),
  );

  res.json({
    period_start: isoDate(currStart),
    period_end: isoDate(now),
    ...aggregate,
  });
});

// ─── POST /api/calibration/run-track-a ────────────────────────────
// Manual trigger for the weekly Track A automation. Accepts
// {limit?: number} (default 5 sites). Synchronous — waits for the
// browser runs to complete before responding (typical run is
// ~5 sites × 5s = 25s with chromium boot overhead).
//
// Phase 2-D will add admin auth gate. For now any caller can trigger
// (the endpoint only writes calibration_records — no PII or
// destructive ops).
const runTrackABody = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

const trackLog = logger.child({ service: 'calibration_route' });

router.post('/run-track-a', async (req, res) => {
  const parsed = runTrackABody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  try {
    const result = await runTrackA(parsed.data);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    trackLog.error({ err: msg }, 'Track A run threw');
    res.status(500).json({ error: 'track_a_failed', message: msg });
  }
});

export default router;
