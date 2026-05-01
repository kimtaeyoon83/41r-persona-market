// Track A runner — Phase 2-C-2.
//
// Per spec §5.2: weekly comparison of LLM persona inference vs
// Stagehand actual measurement. Site-level (not persona-level) —
// Stagehand measures the SITE'S properties; LLM persona predictions
// are averaged across all personas that scanned the site → "LLM
// site avg". Pearson r between the two over time tells us how well
// the LLM is calibrated for each dimension.
//
// Per run:
//   1. Pick up to N (default 5) recent unique completed scans.
//   2. For each, average scan_cohort_results dim means weighted
//      by n_completed → "LLM site avg".
//   3. Run measureSite() for Stagehand ground truth.
//   4. Insert calibration_records row per (site, dimension).
//
// Phase 2-C-2 covers engagement + task_success only (the two
// dimensions the spec §5.1 says Stagehand can measure). Happiness /
// adoption / retention require human SUS responses or longitudinal
// data — Track B / C territory.

import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { logger } from '../../logger.js';
import { measureSite, type SiteMeasurement } from './site_measurement.js';

const log = logger.child({ service: 'calibration_track_a' });

const DEFAULT_SITES_PER_RUN = 5;
const MEASURABLE_DIMENSIONS: Array<{
  dim: 'engagement' | 'task_success';
  measurementKey: keyof Pick<SiteMeasurement, 'engagementScore' | 'taskSuccessScore'>;
  scanColumn: 'engagementMean' | 'taskSuccessMean';
}> = [
  { dim: 'engagement', measurementKey: 'engagementScore', scanColumn: 'engagementMean' },
  { dim: 'task_success', measurementKey: 'taskSuccessScore', scanColumn: 'taskSuccessMean' },
];

export type TrackARunResult = {
  sites_attempted: number;
  sites_succeeded: number;
  sites_failed: number;
  records_inserted: number;
  failures: Array<{ url: string; error: string }>;
};

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// Pick up to `limit` distinct completed scans, most-recent first.
async function pickRecentSites(limit: number): Promise<Array<{ scanId: string; targetUrl: string }>> {
  // Drizzle doesn't expose DISTINCT ON cleanly, so use raw SQL.
  const rows = await db.execute<{ id: string; target_url: string }>(sql`
    SELECT DISTINCT ON (target_url) id, target_url
    FROM audience_fit_scans
    WHERE status = 'completed'
    ORDER BY target_url, completed_at DESC NULLS LAST
    LIMIT ${limit}
  `);
  return rows.rows.map((r) => ({ scanId: r.id, targetUrl: r.target_url }));
}

// LLM site-level dim avg = mean of cohort dim means weighted by
// n_completed. Mirrors the global_*_avg computation in audience_fit
// synthesis.
async function computeLlmSiteAvg(
  scanId: string,
): Promise<{ engagement: number | null; task_success: number | null }> {
  const cohortRows = await db
    .select()
    .from(schema.scanCohortResults)
    .where(eq(schema.scanCohortResults.scanId, scanId));

  const valid = cohortRows.filter((c) => c.cohortFitScore != null);
  if (valid.length === 0) return { engagement: null, task_success: null };

  const totalN = valid.reduce((s, c) => s + c.nCompleted, 0) || 1;
  const eng = valid.reduce((s, c) => s + (c.engagementMean ?? 0) * c.nCompleted, 0) / totalN;
  const tsk = valid.reduce((s, c) => s + (c.taskSuccessMean ?? 0) * c.nCompleted, 0) / totalN;
  return { engagement: eng, task_success: tsk };
}

export async function runTrackA(opts: { limit?: number } = {}): Promise<TrackARunResult> {
  const limit = opts.limit ?? DEFAULT_SITES_PER_RUN;
  log.info({ limit }, 'Track A run starting');

  const sites = await pickRecentSites(limit);
  log.info({ count: sites.length }, 'sites selected');

  const result: TrackARunResult = {
    sites_attempted: sites.length,
    sites_succeeded: 0,
    sites_failed: 0,
    records_inserted: 0,
    failures: [],
  };

  for (const { scanId, targetUrl } of sites) {
    try {
      const llmAvg = await computeLlmSiteAvg(scanId);
      if (llmAvg.engagement === null || llmAvg.task_success === null) {
        result.sites_failed += 1;
        result.failures.push({ url: targetUrl, error: 'no llm avg available' });
        continue;
      }

      const measurement = await measureSite(targetUrl);
      const date = isoDate();

      for (const { dim, measurementKey } of MEASURABLE_DIMENSIONS) {
        const llmValue =
          dim === 'engagement' ? llmAvg.engagement : llmAvg.task_success;
        const groundTruth = measurement[measurementKey];
        await db.insert(schema.calibrationRecords).values({
          date,
          siteUrl: targetUrl,
          personaId: null,
          dimension: dim,
          llmInference: llmValue,
          groundTruth,
          delta: groundTruth - llmValue,
          source: 'stagehand',
        });
        result.records_inserted += 1;
      }

      result.sites_succeeded += 1;
      log.info(
        {
          scanId,
          url: targetUrl,
          llm_eng: llmAvg.engagement.toFixed(2),
          gt_eng: measurement.engagementScore.toFixed(2),
          llm_tsk: llmAvg.task_success.toFixed(2),
          gt_tsk: measurement.taskSuccessScore.toFixed(2),
        },
        'Track A site recorded',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      result.sites_failed += 1;
      result.failures.push({ url: targetUrl, error: msg.slice(0, 200) });
      log.warn({ url: targetUrl, err: msg }, 'Track A site failed');
    }
  }

  log.info(result, 'Track A run complete');
  return result;
}
