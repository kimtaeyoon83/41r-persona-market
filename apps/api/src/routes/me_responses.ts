// /api/me/survey-responses — Phase 5.1.
//
// Authenticated viewer's personal survey-response surface. Two routes:
//
//   GET /api/me/survey-responses
//     List of scans the current Privy user has submitted to. Each entry
//     carries the scan target_url + category + submitted_at so the
//     /me/responses page can render a list of "your survey history".
//
//   GET /api/me/survey-responses/:scanId
//     Detailed view of the user's submission to one scan, plus the AI-
//     side weighted dimension means + per-dimension Δ (Human − AI). The
//     /me/responses/[scanId] page renders this for the "your answers
//     vs. the AI's prediction" comparison.
//
// Both routes are gated by `requirePrivyAuth`. The user only ever sees
// their own rows — the WHERE filter on `user_id = req.privyUser.id`
// makes that an enforced data isolation boundary, not a UI convention.

import { Router, type Router as RouterType } from 'express';
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requirePrivyAuth } from '../middleware/privy_auth.js';

const router: RouterType = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Dimension score mapping (mirror /survey handler + human_aggregate) ──
const ENGAGEMENT_TO_SCORE: Record<string, number> = {
  abandon: 10, skim: 30, browse: 55, engage: 75, extended: 90,
};
const RETENTION_TO_D7: Record<string, number> = {
  no_return: 0, weak: 5, moderate: 30, strong: 55,
};
function susScore(responses: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const r = responses[i] ?? 3;
    sum += i % 2 === 0 ? r - 1 : 5 - r;
  }
  return sum * 2.5;
}

// ─── List ──────────────────────────────────────────────────────────
router.get('/survey-responses', requirePrivyAuth, async (req, res) => {
  const userId = req.privyUser!.id;
  const rows = await db
    .select({
      scanId: schema.surveyResponses.scanId,
      submittedAt: schema.surveyResponses.submittedAt,
      targetUrl: schema.audienceFitScans.targetUrl,
      category: schema.audienceFitScans.category,
      onLinePitch: schema.audienceFitScans.oneLinePitch,
      scanStatus: schema.audienceFitScans.status,
      audienceFitScore: schema.audienceFitScans.audienceFitScore,
    })
    .from(schema.surveyResponses)
    .innerJoin(
      schema.audienceFitScans,
      eq(schema.audienceFitScans.id, schema.surveyResponses.scanId),
    )
    .where(eq(schema.surveyResponses.userId, userId))
    .orderBy(desc(schema.surveyResponses.submittedAt));

  res.json({
    responses: rows.map((r) => ({
      scan_id: r.scanId,
      submitted_at: r.submittedAt.toISOString(),
      target_url: r.targetUrl,
      category: r.category,
      one_line_pitch: r.onLinePitch,
      scan_status: r.scanStatus,
      ai_audience_fit_score: r.audienceFitScore,
    })),
  });
});

// ─── Detail (AI vs Me) ─────────────────────────────────────────────
router.get('/survey-responses/:scanId', requirePrivyAuth, async (req, res) => {
  const userId = req.privyUser!.id;
  const scanId = String(req.params.scanId ?? '');
  if (!UUID_RE.test(scanId)) {
    res.status(404).json({ error: 'response_not_found' });
    return;
  }

  const [row] = await db
    .select()
    .from(schema.surveyResponses)
    .where(
      and(
        eq(schema.surveyResponses.scanId, scanId),
        eq(schema.surveyResponses.userId, userId),
      ),
    );
  if (!row) {
    res.status(404).json({ error: 'response_not_found' });
    return;
  }

  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, scanId));
  if (!scan) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }

  // Human (me) dimension scores — same recipe as POST /survey + human_aggregate.
  const di = row.dimensionInputs;
  const meScores = {
    happiness: susScore(row.susResponses),
    task_success: di.completion_likelihood * 100,
    adoption: di.signup_likelihood * 100,
    retention_d7: RETENTION_TO_D7[di.retention_category] ?? 0,
    engagement: ENGAGEMENT_TO_SCORE[di.engagement_category] ?? 30,
  };

  // AI dimension means weighted by n_completed across cohorts. Mirrors
  // the wAvg() pattern in /api/scan/:id/compare.
  const cohortRows = await db
    .select()
    .from(schema.scanCohortResults)
    .where(eq(schema.scanCohortResults.scanId, scanId));
  const totalN = cohortRows.reduce((s, c) => s + c.nCompleted, 0) || 1;
  const wAvg = (
    key:
      | 'happinessMean'
      | 'engagementMean'
      | 'adoptionMean'
      | 'retentionMean'
      | 'taskSuccessMean',
  ) =>
    cohortRows.reduce((s, c) => s + (c[key] ?? 0) * c.nCompleted, 0) / totalN;
  const aiScores = {
    happiness: wAvg('happinessMean'),
    task_success: wAvg('taskSuccessMean'),
    adoption: wAvg('adoptionMean'),
    retention_d7: wAvg('retentionMean'),
    engagement: wAvg('engagementMean'),
  };

  const dimDeltas = {
    happiness: meScores.happiness - aiScores.happiness,
    task_success: meScores.task_success - aiScores.task_success,
    adoption: meScores.adoption - aiScores.adoption,
    retention_d7: meScores.retention_d7 - aiScores.retention_d7,
    engagement: meScores.engagement - aiScores.engagement,
  };

  res.json({
    scan: {
      id: scan.id,
      target_url: scan.targetUrl,
      category: scan.category,
      one_line_pitch: scan.oneLinePitch,
      mode: scan.mode,
      status: scan.status,
      ai_audience_fit_score: scan.audienceFitScore,
      custom_questions: scan.customQuestions ?? null,
    },
    response: {
      submitted_at: row.submittedAt.toISOString(),
      sus_responses: row.susResponses,
      dimension_inputs: row.dimensionInputs,
      voice: row.voice,
      custom_answers: row.customAnswers,
      demographics: row.demographics,
    },
    me_scores: meScores,
    ai_scores: aiScores,
    dimension_deltas: dimDeltas,
  });
});

// ─── Points (partner pilot, 2026-06-10) ─────────────────────────
// Balance + ledger for the current user. Rows arrive via the partner
// S2S channel keyed by email and get user_id backfilled on login
// (privy_auth claim pass), so by the time this runs the user_id
// filter is the complete view. Same data-isolation boundary as the
// survey-responses routes above.
router.get('/points', requirePrivyAuth, async (req, res) => {
  const userId = req.privyUser!.id;
  const rows = await db
    .select({
      amount: schema.pointTransactions.amount,
      reason: schema.pointTransactions.reason,
      source: schema.pointTransactions.source,
      createdAt: schema.pointTransactions.createdAt,
    })
    .from(schema.pointTransactions)
    .where(eq(schema.pointTransactions.userId, userId))
    .orderBy(desc(schema.pointTransactions.createdAt));
  res.json({
    balance: rows.reduce((s, r) => s + r.amount, 0),
    transactions: rows.map((r) => ({
      amount: r.amount,
      reason: r.reason,
      source: r.source,
      created_at: r.createdAt.toISOString(),
    })),
  });
});

// ─── Credits (Console Sprint 1) ──────────────────────────────────
// Balance + ledger for the founder-side credit currency. Same
// data-isolation boundary as everything above. Balance is SUM over
// the append-only ledger; expiry is recorded but unenforced during
// the pilot (console-ia-redesign.md §12 decision 3).
router.get('/credits', requirePrivyAuth, async (req, res) => {
  const userId = req.privyUser!.id;
  const rows = await db
    .select({
      amountCents: schema.creditTransactions.amountCents,
      reason: schema.creditTransactions.reason,
      refId: schema.creditTransactions.refId,
      expiresAt: schema.creditTransactions.expiresAt,
      createdAt: schema.creditTransactions.createdAt,
    })
    .from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.userId, userId))
    .orderBy(desc(schema.creditTransactions.createdAt));
  res.json({
    balance_cents: rows.reduce((s, r) => s + r.amountCents, 0),
    transactions: rows.map((r) => ({
      amount_cents: r.amountCents,
      reason: r.reason,
      ref_id: r.refId,
      expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
    })),
  });
});

export default router;
