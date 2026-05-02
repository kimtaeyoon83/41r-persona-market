#!/usr/bin/env npx tsx
/**
 * Backfill bootstrap CI for legacy scan_cohort_results rows whose
 * cohort_fit_ci_low/high are NULL but cohort_fit_score is populated.
 *
 * Why: bootstrapCohortFitCI() landed mid-development; cohort rows
 * written before that produced cohort_fit_score without CI bounds.
 * The report screen renders the CI band as "—" for those rows.
 *
 * What this does: for each affected cohort, re-pull the persona
 * dimension scores from scan_persona_responses (non-flagged only),
 * recompute the bootstrap CI via the same helper used by the live
 * pipeline, and UPDATE the row in place.
 *
 * Idempotent: only touches rows where ci_low IS NULL AND
 * cohort_fit_score IS NOT NULL. Re-running is a no-op once backfilled.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/backfill-cohort-ci.ts
 *   DATABASE_URL=... pnpm tsx scripts/backfill-cohort-ci.ts --dry-run
 */

import pg from 'pg';
import {
  bootstrapCohortFitCI,
  type PersonaDimensionScores,
} from '../apps/api/src/services/audience_fit.js';

const { Client } = pg;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Find the cohort rows needing CI: have a fit score but no bounds.
  const toBackfill = await client.query<{
    scan_id: string;
    cohort_id: string;
    cohort_fit_score: number;
  }>(
    `SELECT scan_id::text, cohort_id, cohort_fit_score
       FROM scan_cohort_results
      WHERE cohort_fit_ci_low IS NULL
        AND cohort_fit_score  IS NOT NULL`,
  );
  if (toBackfill.rows.length === 0) {
    console.log('Nothing to backfill — all cohort rows already have CI.');
    await client.end();
    return;
  }
  console.log(
    `Found ${toBackfill.rows.length} cohort rows missing CI` +
      (dryRun ? ' (dry-run)' : ''),
  );

  let ok = 0;
  let skip = 0;
  for (const row of toBackfill.rows) {
    const scores = await client.query<{
      happiness: number | null;
      engagement: number | null;
      adoption: number | null;
      retention_d7: number | null;
      task_success: number | null;
    }>(
      `SELECT happiness_score    AS happiness,
              engagement_score   AS engagement,
              adoption_score     AS adoption,
              retention_d7,
              task_success_score AS task_success
         FROM scan_persona_responses
        WHERE scan_id  = $1
          AND cohort_id = $2
          AND NOT is_flagged
          AND happiness_score IS NOT NULL`,
      [row.scan_id, row.cohort_id],
    );
    const valid: PersonaDimensionScores[] = scores.rows
      .filter(
        (r): r is Required<typeof r> =>
          r.happiness !== null &&
          r.engagement !== null &&
          r.adoption !== null &&
          r.retention_d7 !== null &&
          r.task_success !== null,
      )
      .map((r) => ({
        happiness: r.happiness,
        engagement: r.engagement,
        adoption: r.adoption,
        retention_d7: r.retention_d7,
        task_success: r.task_success,
      }));
    if (valid.length === 0) {
      console.log(
        `  skip ${row.scan_id.slice(0, 8)}/${row.cohort_id} — no non-flagged personas`,
      );
      skip++;
      continue;
    }
    const ci = bootstrapCohortFitCI(valid);
    if (dryRun) {
      console.log(
        `  ${row.scan_id.slice(0, 8)}/${row.cohort_id} n=${valid.length} ` +
          `ci=${ci.low.toFixed(2)}–${ci.high.toFixed(2)} (point ${row.cohort_fit_score.toFixed(2)})`,
      );
    } else {
      await client.query(
        `UPDATE scan_cohort_results
            SET cohort_fit_ci_low  = $1,
                cohort_fit_ci_high = $2
          WHERE scan_id  = $3
            AND cohort_id = $4`,
        [ci.low, ci.high, row.scan_id, row.cohort_id],
      );
    }
    ok++;
  }

  console.log(
    `Done — ${ok} ${dryRun ? 'would update' : 'updated'}, ${skip} skipped (no data).`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
