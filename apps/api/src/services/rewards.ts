// Survey reward policy (Console Sprint 2 — console-ia-redesign.md §4.1).
//
// Self-distributed survey responses are FREE for the founder; 41R pays
// the tester reward because every response is calibration fuel for the
// persona engine (the v0.5 repositioning made that the explicit deal).
// The liability is bounded by a per-scan cap: the first
// SURVEY_REWARD_CAP_PER_SCAN rewarded submissions earn
// SURVEY_REWARD_POINTS; later submissions are still accepted (the
// calibration data is still wanted) but append a transparent 0pt
// 'reward_cap_reached' row — the /me/points ledger shows the reason
// instead of silently dropping it, and the survey page discloses the
// cap state BEFORE the respondent answers (§12 decision 7).
//
// Ledger contract: point_transactions is append-only; ref_id = scan id
// backs the cap COUNT.

import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';

const log = logger.child({ service: 'rewards' });

export const SURVEY_REWARD_POINTS = 100;
export const SURVEY_REWARD_CAP_PER_SCAN = 30;

/** Rewarded (amount > 0) submissions so far for a scan. */
export async function countRewardedForScan(scanId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.pointTransactions)
    .where(
      and(
        eq(schema.pointTransactions.refId, scanId),
        gt(schema.pointTransactions.amount, 0),
      ),
    );
  return row?.n ?? 0;
}

/** True while the scan still has reward budget left — drives the
 *  pre-answer disclosure on the survey page. */
export async function isRewardAvailable(scanId: string): Promise<boolean> {
  return (await countRewardedForScan(scanId)) < SURVEY_REWARD_CAP_PER_SCAN;
}

/**
 * Award points for a FIRST survey submission (edits never re-earn —
 * callers gate on first-submission). Returns the awarded amount:
 * SURVEY_REWARD_POINTS normally, 0 once the per-scan cap is reached
 * (a 0pt 'reward_cap_reached' row is still appended for transparency).
 * Never throws — reward bookkeeping must not fail a survey submission.
 */
export async function awardSurveyPoints(opts: {
  scanId: string;
  source: string; // 'geulbat' | '41r' | future partners
  userId?: string | null;
  email?: string | null;
}): Promise<number> {
  try {
    const capped = !(await isRewardAvailable(opts.scanId));
    const amount = capped ? 0 : SURVEY_REWARD_POINTS;
    await db.insert(schema.pointTransactions).values({
      userId: opts.userId ?? null,
      email: opts.email ?? null,
      amount,
      reason: capped ? 'reward_cap_reached' : 'survey',
      source: opts.source,
      refId: opts.scanId,
    });
    return amount;
  } catch (err) {
    log.warn(
      { scanId: opts.scanId, err: err instanceof Error ? err.message : 'unknown' },
      'survey reward bookkeeping failed (non-fatal)',
    );
    return 0;
  }
}
