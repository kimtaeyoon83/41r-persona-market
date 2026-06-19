// /api/scan — Audience-Fit Validator entry point.
//
// POST /api/scan         — create a pending scan, return scanId.
// GET  /api/scan/:id/report — return shaped report for the validator UI.
//
// Phase 1A.5 ships the route surface + demo fixture. Real LLM
// processing (per-persona vision call → dimension scores → cohort
// aggregate → audience_fit synthesis) lands in Phase 1B, at which
// point this file's GET branch hydrates from scan_persona_responses
// + scan_cohort_results instead of returning `result: null` for
// pending rows.

import { Router, type Router as RouterType } from 'express';
import { and, eq, asc, desc, sql, isNotNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { COHORT_BY_ID, getAcquisitionPriorsFor } from '@41rpm/shared';
import { db, schema } from '../db/index.js';
import {
  AUDIENCE_FIT_WEIGHTS,
  DIMENSION_WEIGHTS_V1,
  applyAcquisitionWeights,
  computeWeightedAudienceFit,
  type CohortFit,
} from '../services/audience_fit.js';
import { startScanWorker } from '../services/scan_pipeline.js';
import { recomputeHumanAggregate } from '../services/human_aggregate.js';
import { computeScanFidelity } from '../services/fidelity/index.js';
import { getCategoryBenchmark } from '../services/benchmark.js';
import {
  computeAarrr,
  computeAarrrWeightedFromRows,
  type AarrrWeightedInputRow,
} from '../services/aarrr.js';
import { requirePrivyAuth, optionalPrivyAuth } from '../middleware/privy_auth.js';
import {
  scanCreateIpLimiter,
  scanCreateUserLimiter,
  mutationLimiter,
} from '../middleware/rate_limit.js';
import { isAdminRequest } from '../middleware/admin.js';
import { debitScan, getCreditBalance, SCAN_PRICE_CENTS } from '../services/credits.js';
import { findWorkspaceByHost } from '../services/workspaces.js';
import { validateTargetUrl } from '../services/url_guard.js';
import { awardSurveyPoints, isRewardAvailable } from '../services/rewards.js';
import { notifySurveyMilestone } from '../services/notify.js';
import { suiObjectUrl } from '../services/sui/anchor.js';
import { walrusBlobUrl } from '../services/walrus.js';
import { getSuiSigner, requirePackageId } from '../services/sui/client.js';
import { usdcAmountFromCents, verifyCampaignCreation } from '../services/sui/escrow.js';
import { env } from '../config/env.js';

const router: RouterType = Router();

// ─── Anonymous demo guard (Console Sprint 1 — §3/§12 decisions) ────
// Anonymous scans cost real LLM money (~$0.15 Mode A) with no credit
// ledger behind them, so they're a demo: 1 fresh scan per IP per day,
// and a repeat request for the same URL within 24h returns the
// existing scan instead of burning a new pipeline run (decision §12-8
// — the UI shows "analyzed n hours ago" from created_at).
const DEMO_WINDOW_MS = 24 * 60 * 60 * 1000;
const demoIpLastScanAt = new Map<string, number>();

function pruneDemoIpMap(): void {
  if (demoIpLastScanAt.size < 10_000) return;
  const cutoff = Date.now() - DEMO_WINDOW_MS;
  for (const [ip, at] of demoIpLastScanAt) {
    if (at < cutoff) demoIpLastScanAt.delete(ip);
  }
}

/** Exported for tests. */
export function checkDemoIpAllowance(
  ip: string,
  now: number = Date.now(),
): boolean {
  const last = demoIpLastScanAt.get(ip);
  return last === undefined || now - last >= DEMO_WINDOW_MS;
}

/** Exported for tests. */
export function recordDemoIpScan(ip: string, now: number = Date.now()): void {
  pruneDemoIpMap();
  demoIpLastScanAt.set(ip, now);
}

const createScanBody = z.object({
  target_url: z.string().min(1).max(500),
  mode: z.enum(['A', 'B']).default('A'),
  target_audience_text: z.string().max(500).optional(),
  hypothesis: z.string().max(1000).optional(),
  // Mode A optional — restricts the analysis to a subset of the 8
  // standard cohorts. Empty array or absent → all 8 run.
  target_cohorts: z.array(z.string().min(1).max(40)).max(8).optional(),
  // Payment rail (chain wiring §4.3). Default 'credits' (off-chain ledger,
  // unchanged). 'usdc' → two-step USDC escrow: this returns pending_payment +
  // the escrow envelope; the client funds a Campaign<USDC> then calls
  // POST /:id/pay. Requires an authenticated user.
  payment_method: z.enum(['credits', 'usdc']).optional(),
});

const payBody = z.object({
  sui_digest: z.string().min(1).max(120),
  campaign_object_id: z.string().min(3).max(80),
  cap_id: z.string().min(3).max(80),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/', scanCreateIpLimiter, optionalPrivyAuth, scanCreateUserLimiter, async (req, res) => {
  const parsed = createScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const { target_url, mode, target_audience_text, hypothesis, target_cohorts } =
    parsed.data;

  // ── Security gate (2026-06-15) ──
  // The target URL is navigated to by a headless browser (SSRF) and
  // echoed into reports/prompts. Reject hostile / non-public values
  // BEFORE the cache lookup, credit debit, or pipeline kickoff. Store
  // the normalized canonical form so a `javascript:`/internal host
  // never lands in the DB.
  const guard = validateTargetUrl(target_url);
  if (!guard.ok) {
    res.status(400).json({ error: 'invalid_url', reason: guard.reason });
    return;
  }
  const safeUrl = guard.url;

  // ── Anonymous path: demo limits (Sprint 1, decision §12-8) ──
  if (!req.privyUser) {
    // 24h cache — same URL recently scanned → return that scan instead
    // of burning a new pipeline run. Reports are unlisted-public, so
    // handing back an existing scanId leaks nothing new.
    const windowStart = new Date(Date.now() - DEMO_WINDOW_MS);
    const [cached] = await db
      .select()
      .from(schema.audienceFitScans)
      .where(
        and(
          eq(schema.audienceFitScans.targetUrl, safeUrl),
          sql`${schema.audienceFitScans.createdAt} >= ${windowStart}`,
          sql`${schema.audienceFitScans.status} != 'failed'`,
        ),
      )
      .orderBy(desc(schema.audienceFitScans.createdAt))
      .limit(1);
    if (cached) {
      res.json({
        scanId: cached.id,
        status: cached.status,
        cached: true,
        created_at: cached.createdAt.toISOString(),
      });
      return;
    }

    const ip = req.ip ?? 'unknown';
    if (!checkDemoIpAllowance(ip)) {
      res.status(429).json({
        error: 'demo_limit',
        message:
          'Anonymous demo is limited to 1 scan per day. Sign in to get $30 in free credits.',
      });
      return;
    }
    recordDemoIpScan(ip);
  }

  // Payment rail. USDC escrow requires an authed user (the cap + refund bind
  // to their identity); anonymous demos stay credit/free only.
  const paymentMethod = parsed.data.payment_method ?? 'credits';
  if (paymentMethod === 'usdc' && !req.privyUser) {
    res.status(401).json({ error: 'auth_required', message: 'USDC payment requires sign-in' });
    return;
  }
  const usdcAmount = usdcAmountFromCents(SCAN_PRICE_CENTS[mode]);

  // Console S2 — auto-link to the user's workspace for this host
  // (when one exists). Anonymous scans stay unlinked forever.
  const workspace = req.privyUser
    ? await findWorkspaceByHost(req.privyUser.id, safeUrl)
    : null;

  const [scan] = await db
    .insert(schema.audienceFitScans)
    .values({
      targetUrl: safeUrl,
      mode,
      targetAudienceText: target_audience_text ?? null,
      hypothesis: hypothesis ?? null,
      // Empty array → null so the pipeline reads "no restriction" cleanly.
      targetCohorts:
        target_cohorts && target_cohorts.length > 0 ? target_cohorts : null,
      // Phase 4 §1 — claim ownership when the requester is logged in.
      // Anonymous requests still allowed (legacy / pre-login demos).
      userId: req.privyUser?.id ?? null,
      workspaceId: workspace?.id ?? null,
      status: paymentMethod === 'usdc' ? 'pending_payment' : 'pending',
      paymentMethod,
      escrowStatus: paymentMethod === 'usdc' ? 'pending_payment' : null,
      escrowCoinType: paymentMethod === 'usdc' ? env.SUI_USDC_COIN_TYPE : null,
      escrowAmount: paymentMethod === 'usdc' ? Number(usdcAmount) : null,
      weightsVersion: 'v1.0',
    })
    .returning();

  if (!scan) {
    res.status(500).json({ error: 'insert_failed' });
    return;
  }

  // ── USDC escrow path: two-step. Don't debit/run yet — return the escrow
  // envelope so the client funds a Campaign<USDC>, then calls POST /:id/pay.
  if (paymentMethod === 'usdc') {
    res.json({
      scanId: scan.id,
      status: 'pending_payment',
      escrow: {
        usdc_amount: usdcAmount.toString(),
        coin_type: env.SUI_USDC_COIN_TYPE,
        cap_recipient: getSuiSigner().toSuiAddress(),
        package_id: requirePackageId(),
        target: safeUrl,
        criteria: JSON.stringify(target_cohorts ?? []),
      },
    });
    return;
  }

  // ── Authed path: credit debit before the pipeline starts ──
  // Price: Mode A $2 / Mode B $1 (console-ia-redesign.md §12 decision 1).
  // Insufficient balance → remove the pending row (nothing started yet)
  // and 402 with the numbers the UI needs for the "충전/소진" state.
  if (req.privyUser) {
    const ok = await debitScan(req.privyUser.id, scan.id, mode);
    if (!ok) {
      await db
        .delete(schema.audienceFitScans)
        .where(eq(schema.audienceFitScans.id, scan.id));
      res.status(402).json({
        error: 'insufficient_credits',
        price_cents: SCAN_PRICE_CENTS[mode],
        balance_cents: await getCreditBalance(req.privyUser.id),
      });
      return;
    }
  }

  // Kick off the pipeline on the next tick. Errors are caught inside
  // startScanWorker; the response returns immediately.
  startScanWorker(scan.id);

  res.json({ scanId: scan.id, status: scan.status });
});

// POST /api/scan/:id/pay — step 2 of the USDC escrow flow (§4.3).
// The client has funded a Campaign<USDC> on Sui; verify it on-chain, then
// flip the scan to pending + start the worker. The create digest is recorded
// on payment_tx_signature (partial UNIQUE → one digest pays one scan).
router.post('/:id/pay', requirePrivyAuth, mutationLimiter, async (req, res) => {
  // requirePrivyAuth widens req.params.id typing to string|string[] — coerce
  // (same pattern as the survey/human-aggregate authed routes below).
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const parsed = payBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const { sui_digest, campaign_object_id, cap_id } = parsed.data;

  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, id));
  if (!scan) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }
  if (scan.userId !== req.privyUser!.id) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (scan.status !== 'pending_payment' || scan.escrowStatus !== 'pending_payment') {
    res.status(409).json({ error: 'not_awaiting_payment', status: scan.status });
    return;
  }

  const verdict = await verifyCampaignCreation({
    digest: sui_digest,
    campaignObjectId: campaign_object_id,
    capId: cap_id,
    expectedAmount: BigInt(scan.escrowAmount ?? 0),
  });
  if (!verdict.ok) {
    res.status(402).json({ error: 'payment_unverified', reason: verdict.reason });
    return;
  }

  // The partial UNIQUE on payment_tx_signature is the anti-replay net: a digest
  // already claimed by another scan makes this UPDATE throw → 409.
  try {
    await db
      .update(schema.audienceFitScans)
      .set({
        paymentTxSignature: sui_digest,
        campaignObjectId: campaign_object_id,
        campaignCapId: cap_id,
        escrowStatus: 'escrowed',
        status: 'pending',
      })
      .where(eq(schema.audienceFitScans.id, id));
  } catch {
    res.status(409).json({ error: 'digest_already_used' });
    return;
  }

  startScanWorker(id);
  res.json({ scanId: id, status: 'pending', escrow_status: 'escrowed' });
});

// ─── Public homepage feeds (Phase 2 §8.1, P2-4) ──────────────────
// Lightweight read endpoints powering the new main page Recent /
// Top / Live feeds. No auth, no payment — every completed scan is
// publicly browsable per the v1.0 decision doc §8.1.
//
// Wallet/email exposure is wallet-prefix-only; full addresses /
// per-persona detail still require the persona drill-down which
// has its own gate decisions in Phase 4 / 5.

const ACTIVE_STATUSES = ['capturing', 'sampling', 'responding', 'aggregating'] as const;

function shapeScanSummary(
  scan: typeof schema.audienceFitScans.$inferSelect,
  bestCohortLabel: string | null,
) {
  return {
    id: scan.id,
    target_url: scan.targetUrl,
    category: scan.category,
    one_line_pitch: scan.oneLinePitch,
    audience_fit_score: scan.audienceFitScore,
    best_cohort_id: scan.bestCohortId,
    best_cohort_label: bestCohortLabel,
    best_cohort_score: scan.bestCohortScore,
    mode: scan.mode,
    status: scan.status,
    personas_completed: scan.personasCompleted,
    created_at: scan.createdAt.toISOString(),
    completed_at: scan.completedAt ? scan.completedAt.toISOString() : null,
  };
}

async function attachBestCohortLabels(
  scans: ReadonlyArray<typeof schema.audienceFitScans.$inferSelect>,
): Promise<Array<ReturnType<typeof shapeScanSummary>>> {
  const ids = scans
    .map((s) => s.id)
    .filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return [];

  // Pull just the best-cohort row for each scan in one query.
  const rows = await db
    .select({
      scanId: schema.scanCohortResults.scanId,
      cohortId: schema.scanCohortResults.cohortId,
      cohortLabel: schema.scanCohortResults.cohortLabel,
    })
    .from(schema.scanCohortResults)
    .where(inArray(schema.scanCohortResults.scanId, ids));

  const byScanId = new Map<string, Map<string, string>>();
  for (const r of rows) {
    if (!byScanId.has(r.scanId)) byScanId.set(r.scanId, new Map());
    byScanId.get(r.scanId)!.set(r.cohortId, r.cohortLabel);
  }

  return scans.map((s) => {
    const cohortMap = byScanId.get(s.id);
    const label = cohortMap && s.bestCohortId ? cohortMap.get(s.bestCohortId) ?? null : null;
    return shapeScanSummary(s, label);
  });
}

router.get('/recent', async (_req, res) => {
  // Last 20 completed scans, newest first.
  const scans = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.status, 'completed'))
    .orderBy(desc(schema.audienceFitScans.completedAt))
    .limit(20);
  res.json({ scans: await attachBestCohortLabels(scans) });
});

router.get('/top', async (_req, res) => {
  // Top 10 by audience_fit_score (descending).
  const scans = await db
    .select()
    .from(schema.audienceFitScans)
    .where(
      and(
        eq(schema.audienceFitScans.status, 'completed'),
        isNotNull(schema.audienceFitScans.audienceFitScore),
      )
    )
    .orderBy(desc(schema.audienceFitScans.audienceFitScore))
    .limit(10);
  res.json({ scans: await attachBestCohortLabels(scans) });
});

router.get('/live', async (_req, res) => {
  // Currently in-flight scans (capturing / sampling / responding /
  // aggregating). Used by the homepage "Live Now" strip.
  const scans = await db
    .select()
    .from(schema.audienceFitScans)
    .where(inArray(schema.audienceFitScans.status, [...ACTIVE_STATUSES]))
    .orderBy(desc(schema.audienceFitScans.createdAt))
    .limit(20);
  res.json({ scans: await attachBestCohortLabels(scans) });
});

// ─── My Analyses (Phase 4 §1 / P4-5) ─────────────────────────────
// Auth-gated list of scans owned by the current Privy user.
// (Solana payment receipts were removed in the Sui migration — the
//  payment_tx_signature column is retained in the DB for historical
//  rows but no longer surfaced.)
router.get('/me', requirePrivyAuth, async (req, res) => {
  const u = req.privyUser!;
  const scans = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.userId, u.id))
    .orderBy(desc(schema.audienceFitScans.createdAt))
    .limit(50);
  const summaries = await attachBestCohortLabels(scans);
  // Console S2 — workspace linkage so the console can split
  // assigned vs Unassigned scans without a second round-trip.
  const wsByScan = new Map<string, string | null>();
  for (const s of scans) wsByScan.set(s.id, s.workspaceId ?? null);
  res.json({
    scans: summaries.map((s) => ({
      ...s,
      workspace_id: wsByScan.get(s.id) ?? null,
    })),
  });
});

router.get('/:id/report', async (req, res) => {
  const { id } = req.params;

  // Demo fixture lives in code so the prototype tour through the
  // validator (TopBar Report → /validator/report/demo) never depends
  // on a populated DB.
  if (id === 'demo') {
    res.json(buildDemoReport());
    return;
  }

  if (!UUID_RE.test(id ?? '')) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }

  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, id));

  if (!scan) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }

  // Read whatever rows exist right now — progressive data flows in
  // as the worker writes scan_persona_responses + scan_cohort_results
  // mid-pipeline. The polling client picks up partial state and
  // re-renders.
  const cohortRows = await db
    .select()
    .from(schema.scanCohortResults)
    .where(eq(schema.scanCohortResults.scanId, id));

  // Live persona completion count — the scan row's
  // personas_completed only gets set at synthesis time, but we want
  // the polling client to see "X of Y personas analyzed" while the
  // responding step is still inserting rows. Counts non-flagged
  // rows only, matching the post-synthesis stored semantic.
  const [liveCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.scanPersonaResponses)
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false)
      )
    );
  const livePersonasCompleted = liveCount?.n ?? 0;

  // Phase 5 — survey response count drives the "Compare with humans
  // (n=X)" footer button label on the report page. Cheap COUNT
  // alongside the existing live counts so we don't need a separate
  // round-trip from the client.
  const [surveyCountRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.surveyResponses)
    .where(eq(schema.surveyResponses.scanId, id));
  const surveyResponseCount = surveyCountRow?.n ?? 0;

  // Composite per-persona score for fit/non-fit ranking. Cheap proxy
  // for the §4.2 weighted aggregate; using the same dimensions keeps
  // partial-state ordering consistent with the final cohort_fit_score.
  // 'desc' = top fit candidates, 'asc' = bottom non-fit candidates.
  const [fitRows, nonFitRows] = await Promise.all([
    buildPersonaCardQuery(id, 'desc'),
    buildPersonaCardQuery(id, 'asc'),
  ]);

  // Most-recent persona responses for the processing screen feed.
  // Pulled live so the polling UI shows the latest reactions as the
  // worker writes them. Capped at 8 — newest first.
  const recentRows = await db
    .select({
      personaId: schema.scanPersonaResponses.personaId,
      cohortId: schema.scanPersonaResponses.cohortId,
      voiceFirstImpression: schema.scanPersonaResponses.voiceFirstImpression,
      voiceBiggestFriction: schema.scanPersonaResponses.voiceBiggestFriction,
      happiness: schema.scanPersonaResponses.happinessScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      voiceSample: schema.personas.vector,
      createdAt: schema.scanPersonaResponses.createdAt,
    })
    .from(schema.scanPersonaResponses)
    .innerJoin(
      schema.personas,
      eq(schema.personas.id, schema.scanPersonaResponses.personaId)
    )
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false),
        isNotNull(schema.scanPersonaResponses.voiceFirstImpression)
      )
    )
    .orderBy(desc(schema.scanPersonaResponses.createdAt))
    .limit(8);

  // Per-cohort live completion count for the processing screen's
  // cohort progress strip. Derived from scanPersonaResponses (not
  // scanCohortResults) so it updates row-by-row mid-pipeline.
  const cohortProgressRows = await db
    .select({
      cohortId: schema.scanPersonaResponses.cohortId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.scanPersonaResponses)
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false)
      )
    )
    .groupBy(schema.scanPersonaResponses.cohortId);

  const completed = scan.status === 'completed';

  // Override personas_completed with the live row count for the
  // polling client. Once the scan completes, scan.personasCompleted
  // matches livePersonasCompleted exactly, so the override is a no-op.
  const scanShape = shapeScanMeta(scan);
  scanShape.personas_completed = livePersonasCompleted;
  if (!completed && scanShape.personas_attempted === 0) {
    scanShape.personas_attempted = livePersonasCompleted;
  }

  // Acquisition Layer (Phase B1 v1.1) — compute weighted view alongside
  // the cached "research panel" view. Both surfaces are exposed; the
  // UI toggles between them. Mode A only — Mode B's single-bucket
  // doesn't have inter-cohort acquisition dynamics to weight.
  let weightedView: ReturnType<typeof computeWeightedAudienceFit> | null = null;
  if (completed && scan.mode === 'A' && cohortRows.length > 0) {
    const priors = getAcquisitionPriorsFor(
      scan.category,
      scan.categoryConfidence,
    );
    const cohortFits: CohortFit[] = cohortRows.map((c) => ({
      cohort_id: c.cohortId,
      cohort_label: c.cohortLabel,
      n_completed: c.nCompleted,
      dimension_means: {
        happiness: c.happinessMean ?? 0,
        engagement: c.engagementMean ?? 0,
        adoption: c.adoptionMean ?? 0,
        retention_d7: c.retentionMean ?? 0,
        task_success: c.taskSuccessMean ?? 0,
      },
      cohort_fit_score: c.cohortFitScore ?? 0,
    }));
    weightedView = computeWeightedAudienceFit(
      applyAcquisitionWeights(cohortFits, priors),
    );
  }

  res.json({
    scan: scanShape,
    result: completed
      ? {
          audience_fit_score: scan.audienceFitScore ?? 0,
          best: {
            cohort_id: scan.bestCohortId ?? '',
            cohort_label:
              cohortRows.find((c) => c.cohortId === scan.bestCohortId)?.cohortLabel ?? '',
            cohort_fit_score: scan.bestCohortScore ?? 0,
          },
          worst: {
            cohort_id: scan.worstCohortId ?? '',
            cohort_label:
              cohortRows.find((c) => c.cohortId === scan.worstCohortId)?.cohortLabel ?? '',
            cohort_fit_score: scan.worstCohortScore ?? 0,
          },
          median_score: scan.medianCohortScore ?? 0,
          global_task_success_avg: scan.globalTaskSuccessAvg ?? 0,
          global_sentiment_avg: scan.globalSentimentAvg ?? 0,
          weights_used: AUDIENCE_FIT_WEIGHTS,
          dimension_weights: DIMENSION_WEIGHTS_V1,
          // Acquisition Layer v1.1 — visitor-weighted parallel view.
          // Null on Mode B / no cohorts. Same `dimension_weights` apply.
          weighted: weightedView
            ? {
                audience_fit_score: weightedView.audience_fit_score_weighted,
                best: {
                  cohort_id: weightedView.best_weighted.cohort_id,
                  cohort_label: weightedView.best_weighted.cohort_label,
                  cohort_fit_score: weightedView.best_weighted.weighted_cohort_fit_score,
                  arrival_share: weightedView.best_weighted.arrival_share,
                  abandon_rate: weightedView.best_weighted.abandon_rate,
                },
                worst: {
                  cohort_id: weightedView.worst_weighted.cohort_id,
                  cohort_label: weightedView.worst_weighted.cohort_label,
                  cohort_fit_score: weightedView.worst_weighted.weighted_cohort_fit_score,
                  arrival_share: weightedView.worst_weighted.arrival_share,
                  abandon_rate: weightedView.worst_weighted.abandon_rate,
                },
                median_score: weightedView.median_score_weighted,
                global_task_success_avg: weightedView.global_task_success_weighted,
                global_sentiment_avg: weightedView.global_sentiment_weighted,
                priors_source: scan.category ?? 'Other',
                priors_confidence: scan.categoryConfidence ?? 0,
              }
            : null,
        }
      : null,
    cohorts: cohortRows.map(shapeCohort),
    fit_personas: fitRows.map((r) => shapePersonaCard(r, 'fit')),
    non_fit_personas: nonFitRows.map((r) => shapePersonaCard(r, 'non_fit')),
    // These three are computed at synthesis time; show them only when
    // the scan completes so partial state never displays misleading
    // pseudo-frictions or formula rows.
    frictions: completed ? buildFrictionsForReport(scan, cohortRows) : [],
    retention_curve: completed ? buildRetentionCurve(cohortRows) : [],
    formula_rows: completed ? buildFormulaRows(scan, cohortRows) : [],
    dimension_breakdown: completed ? buildDimensionBreakdown(cohortRows) : [],
    kpis: completed ? await buildKpis(scan, cohortRows) : [],
    // Live progressive fields — populated during scan + after.
    recent_responses: recentRows.map(shapeRecentResponse),
    cohort_progress: shapeCohortProgress(cohortProgressRows),
    // Phase 5 — drives the "Compare with humans (n=X)" footer button.
    // Live count of survey_responses; resets to 0 when no submissions.
    survey_response_count: surveyResponseCount,
    // Console S2 — pre-answer reward disclosure (§12 decision 7): the
    // survey page must tell respondents BEFORE they answer when the
    // per-scan reward budget (30) is exhausted.
    survey_reward_available: completed ? await isRewardAvailable(id) : true,
    /** Whether human_aggregate has been computed at least once. The
     *  report page uses this to decide whether the Compare button
     *  goes straight to the comparison page or first triggers a
     *  recompute. */
    human_aggregate_computed: scan.humanAggregate !== null,
    // Pro tier: AARRR funnel — Mode A only (Mode B is single-audience).
    aarrr: completed && scan.mode === 'A' ? await computeAarrr(id) : null,
    // Acquisition Layer v1.1 — weighted (visitor-level) AARRR. Same
    // gating as `aarrr` above. Computed inline; persona rows joined
    // with cohort_id so the per-cohort pass rates can be priors-weighted.
    aarrr_weighted:
      completed && scan.mode === 'A'
        ? await computeWeightedAarrrFor(id, scan.category, scan.categoryConfidence)
        : null,
    // Chain wiring Phase 2 — Seal-encrypted report blob on Walrus, anchored
    // at completion (fire-and-forget). Null until anchored; the report page
    // hides the strip when absent.
    report_anchor: scan.reportWalrusBlobId
      ? {
          walrus_blob_id: scan.reportWalrusBlobId,
          walrus_url: walrusBlobUrl(scan.reportWalrusBlobId),
          anchored_at: scan.reportAnchoredAt ? scan.reportAnchoredAt.toISOString() : null,
        }
      : null,
  });
});

// GET /api/scan/:id/report.md
//
// Plain-markdown export of the scan report so an LLM (ChatGPT,
// Claude, etc.) can fetch a single URL and analyse the run without
// the user pasting a giant blob. The validator/report page is
// client-rendered Next.js, so a direct fetch by an external LLM
// would only see a "Loading…" stub — this endpoint solves that by
// emitting fully-rendered markdown server-side.
//
// Public, no auth — same access posture as the JSON /report
// endpoint above. Caching headers favour LLM re-fetches.
router.get('/:id/report.md', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id ?? '')) {
    res.status(404).type('text/plain').send('scan not found');
    return;
  }

  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, id));
  if (!scan) {
    res.status(404).type('text/plain').send('scan not found');
    return;
  }

  const cohortRows = await db
    .select()
    .from(schema.scanCohortResults)
    .where(eq(schema.scanCohortResults.scanId, id));

  // Top voice quotes — pull a handful of the strongest responses so
  // the LLM can see actual persona language, not just aggregates.
  const voiceRows = await db
    .select({
      cohortId: schema.scanPersonaResponses.cohortId,
      voiceFirstImpression: schema.scanPersonaResponses.voiceFirstImpression,
      voiceBiggestFriction: schema.scanPersonaResponses.voiceBiggestFriction,
      voiceWouldReturnBecause: schema.scanPersonaResponses.voiceWouldReturnBecause,
      happiness: schema.scanPersonaResponses.happinessScore,
    })
    .from(schema.scanPersonaResponses)
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false),
        isNotNull(schema.scanPersonaResponses.voiceBiggestFriction),
      ),
    )
    .orderBy(desc(schema.scanPersonaResponses.happinessScore))
    .limit(12);

  const completed = scan.status === 'completed';
  const aarrr =
    completed && scan.mode === 'A' ? await computeAarrr(id) : null;

  const md = renderReportMarkdown({ scan, cohortRows, voiceRows, aarrr });
  res
    .status(200)
    .type('text/markdown; charset=utf-8')
    .setHeader('Cache-Control', 'public, max-age=60')
    .send(md);
});

// Pure render. No DB / network. Takes the rows the route handler
// already fetched and produces a chat-friendly markdown document.
function renderReportMarkdown(args: {
  scan: typeof schema.audienceFitScans.$inferSelect;
  cohortRows: Array<typeof schema.scanCohortResults.$inferSelect>;
  voiceRows: Array<{
    cohortId: string;
    voiceFirstImpression: string | null;
    voiceBiggestFriction: string | null;
    voiceWouldReturnBecause: string | null;
    happiness: number | null;
  }>;
  aarrr: Awaited<ReturnType<typeof computeAarrr>>;
}): string {
  const { scan, cohortRows, voiceRows, aarrr } = args;
  const completed = scan.status === 'completed';
  const lines: string[] = [];

  const fmt = (n: number | null | undefined, digits = 1): string =>
    n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits);

  // Header
  lines.push(`# Audience-Fit Report — ${scan.targetUrl}`);
  lines.push('');
  lines.push(`> Scan ID: \`${scan.id}\``);
  lines.push(`> Mode: **${scan.mode}** (${scan.mode === 'A' ? 'Discovery' : 'Verify'})`);
  lines.push(`> Status: \`${scan.status}\``);
  lines.push(
    `> Personas: ${scan.personasCompleted}/${scan.personasAttempted} valid` +
      (scan.personasFlagged > 0 ? ` · ${scan.personasFlagged} flagged` : ''),
  );
  lines.push(`> Created: ${scan.createdAt.toISOString()}`);
  if (scan.completedAt) {
    lines.push(`> Completed: ${scan.completedAt.toISOString()}`);
  }
  lines.push('');

  // How to read this
  lines.push('## How to read this report');
  lines.push('');
  lines.push(
    'This is a **synthetic-persona-based audience-fit analysis**.',
  );
  lines.push(
    `~${scan.personasCompleted} simulated personas reacted to a screenshot of ${scan.targetUrl}. ` +
      'The numbers measure **intent** ("would I sign up / stay / come back"), NOT real conversion. ' +
      'Treat absolute %s as relative ranking signals across sites — they overshoot real GA4 ' +
      'reality by ~5-30× because that intent-action gap is fundamental to persona simulation. ' +
      'Use the friction list + AARRR drop-offs for diagnosis, not as forecasts.',
  );
  lines.push('');
  lines.push(
    'Methodology: https://app.project-rpm.xyz/validator/how-it-works',
  );
  lines.push('');

  // Site classification
  if (scan.category) {
    lines.push('## Site classification');
    lines.push('');
    lines.push(
      `- Category: **${scan.category}** (confidence ${fmt(scan.categoryConfidence, 2)})`,
    );
    if (scan.oneLinePitch) {
      lines.push(`- One-line pitch: ${scan.oneLinePitch}`);
    }
    lines.push('');
  }

  // Headline (Mode A)
  if (completed && scan.mode === 'A') {
    const best = cohortRows.find((c) => c.cohortId === scan.bestCohortId);
    const worst = cohortRows.find((c) => c.cohortId === scan.worstCohortId);
    lines.push('## Headline (Mode A composite)');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|---|---|');
    lines.push(`| Audience-Fit Score | **${fmt(scan.audienceFitScore)} / 100** |`);
    lines.push(
      `| Best cohort | ${best?.cohortLabel ?? '—'} · ${fmt(scan.bestCohortScore)} |`,
    );
    lines.push(`| Median cohort | ${fmt(scan.medianCohortScore)} |`);
    lines.push(
      `| Worst cohort | ${worst?.cohortLabel ?? '—'} · ${fmt(scan.worstCohortScore)} |`,
    );
    lines.push(
      `| Global task-success | ${fmt(scan.globalTaskSuccessAvg)} |`,
    );
    lines.push(
      `| Global sentiment | ${fmt(scan.globalSentimentAvg)} |`,
    );
    lines.push('');
    lines.push(
      '> Formula: `0.40 × best_cohort_fit + 0.30 × median_cohort_fit + 0.20 × global_task_success + 0.10 × global_sentiment`',
    );
    lines.push('');
  }

  // Mode B verdict
  if (scan.mode === 'B') {
    lines.push('## Verification verdict (Mode B)');
    lines.push('');
    if (scan.targetAudienceText) {
      lines.push(`- Audience: "${scan.targetAudienceText}"`);
    }
    if (scan.modeBVerdict) {
      lines.push(`- Verdict: **${scan.modeBVerdict.toUpperCase()}**`);
    }
    if (completed) {
      lines.push(`- Score: ${fmt(scan.audienceFitScore)} / 100`);
      lines.push('  - ≥60 Pass · 40-60 Conditional · <40 Fail');
    }
    lines.push('');
  }

  // Cohorts
  if (cohortRows.length > 0) {
    lines.push('## Cohort breakdown');
    lines.push('');
    lines.push(
      '| Cohort | n | Fit | Engagement | Task | Happiness | Adoption | Retention D-7 |',
    );
    lines.push('|---|---|---|---|---|---|---|---|');
    const sorted = [...cohortRows].sort(
      (a, b) => (b.cohortFitScore ?? 0) - (a.cohortFitScore ?? 0),
    );
    for (const c of sorted) {
      lines.push(
        `| ${c.cohortLabel} | ${c.nCompleted} | **${fmt(c.cohortFitScore)}** | ` +
          `${fmt(c.engagementMean)} | ${fmt(c.taskSuccessMean)} | ` +
          `${fmt(c.happinessMean)} | ${fmt(c.adoptionMean)} | ${fmt(c.retentionMean)} |`,
      );
    }
    lines.push('');
  }

  // AARRR funnel
  if (aarrr) {
    lines.push('## AARRR funnel (panel view — engaged-persona intent)');
    lines.push('');
    lines.push('| Stage | Score | Passing | Threshold |');
    lines.push('|---|---|---|---|');
    for (const s of aarrr.stages) {
      lines.push(
        `| ${s.label} | ${fmt(s.score)}% | ${s.n_passing} / ${s.total} | ${s.threshold} |`,
      );
    }
    lines.push('');
    let biggestDropIdx = 1;
    let biggestDrop = 0;
    for (let i = 1; i < aarrr.stages.length; i++) {
      const drop = aarrr.stages[i - 1]!.score - aarrr.stages[i]!.score;
      if (drop > biggestDrop) {
        biggestDrop = drop;
        biggestDropIdx = i;
      }
    }
    if (biggestDrop >= 5) {
      lines.push(
        `> **Biggest leak**: ${aarrr.stages[biggestDropIdx]!.label} — ${biggestDrop.toFixed(0)}pt drop from previous stage. Fix this stage first.`,
      );
      lines.push('');
    }
  }

  // Friction clusters
  const frictions = (scan.frictionsJson ?? []) as Array<{
    rank: number;
    title: string;
    summary?: string;
    where: string;
    impact: string;
    quote: string;
    n: number;
  }>;
  if (frictions.length > 0) {
    lines.push('## Friction & bottleneck clusters');
    lines.push('');
    for (const f of frictions) {
      lines.push(`### #${f.rank} — ${f.title}`);
      lines.push('');
      lines.push(`- **Severity**: ${f.n} personas · ${f.impact}`);
      lines.push(`- **Where**: ${f.where}`);
      if (f.summary) {
        lines.push(`- **Detail**: ${f.summary}`);
      }
      lines.push(`- **Persona voice**: "${f.quote}"`);
      lines.push('');
    }
  }

  // Persona voice samples
  if (voiceRows.length > 0) {
    lines.push('## Persona voice samples (top by happiness)');
    lines.push('');
    for (const v of voiceRows.slice(0, 8)) {
      const cohort = COHORT_BY_ID[v.cohortId]?.label ?? v.cohortId;
      lines.push(`**${cohort}** (happiness ${fmt(v.happiness)})`);
      if (v.voiceFirstImpression) {
        lines.push(`- First impression: "${v.voiceFirstImpression}"`);
      }
      if (v.voiceBiggestFriction) {
        lines.push(`- Biggest friction: "${v.voiceBiggestFriction}"`);
      }
      if (v.voiceWouldReturnBecause) {
        lines.push(`- Would return because: "${v.voiceWouldReturnBecause}"`);
      }
      lines.push('');
    }
  }

  // Suggested questions
  lines.push('## Suggested questions to ask the AI');
  lines.push('');
  lines.push('1. Which friction cluster is the most actionable for our team to address first?');
  lines.push('2. Are there contradictions between the persona voice samples and the aggregate scores?');
  lines.push('3. Which cohort gap (best vs worst) is most surprising and what does it suggest?');
  lines.push('4. If we could change one thing on the site to lift the score, what would have the highest leverage?');
  lines.push('5. What signals here would warrant deeper qualitative research with real users?');
  lines.push('');
  lines.push('---');
  lines.push(`Generated: ${new Date().toISOString()}`);

  return lines.join('\n');
}

// Helper — fetch persona rows + cohortId for the weighted AARRR
// compute. Lifted out of the route handler so the inline call site
// stays readable; the handler is already 130+ lines.
async function computeWeightedAarrrFor(
  scanId: string,
  category: string | null,
  confidence: number | null,
): Promise<ReturnType<typeof computeAarrrWeightedFromRows>> {
  const priors = getAcquisitionPriorsFor(category, confidence);
  const rows: AarrrWeightedInputRow[] = await db
    .select({
      cohortId: schema.scanPersonaResponses.cohortId,
      isFlagged: schema.scanPersonaResponses.isFlagged,
      happiness: schema.scanPersonaResponses.happinessScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      adoption: schema.scanPersonaResponses.adoptionScore,
      retentionD7: schema.scanPersonaResponses.retentionD7,
    })
    .from(schema.scanPersonaResponses)
    .where(eq(schema.scanPersonaResponses.scanId, scanId));
  return computeAarrrWeightedFromRows(rows, priors);
}

// ─── GET /api/scan/:scanId/persona/:personaId ─────────────────────
// Persona drill-down endpoint — returns the persona's vector +
// their response in this scan + scan meta. Drives the per-persona
// detail page. 404 when scan or persona-row absent.
// ─── Human survey (Phase 2 D3, P2-5) ─────────────────────────────
// A human takes the same §11.1 survey as the AI personas for the
// SAME url, then we drop one calibration_records row per dimension
// (source='human_baseline'). Track A aggregator picks these up and
// computes LLM-vs-human deltas.
//
// No auth in Phase 2 — email field is for traceability only. Phase 4
// promotes this to Privy login.

// Exported for routes/partner.ts (geulbat S2S ingest) — the partner
// channel reuses the exact same answer schema, plus its own
// email/consent envelope. Do NOT add identity fields here (CLAUDE.md
// Do-NOT on surveyBody email).
export const surveyBody = z.object({
  // Phase 5.1 — identity comes from Privy (req.privyUser.id), not the
  // body. The legacy `email` field was dropped here when the route
  // became authenticated; existing pre-Phase-5.1 rows keep their email
  // values in the DB but new submissions don't carry them.
  // SUS-10 (Q1..Q10), 1-5 Likert.
  sus_responses: z.array(z.number().int().min(1).max(5)).length(10),
  // Engagement band — same enum as the AI persona schema.
  engagement_category: z.enum(['abandon', 'skim', 'browse', 'engage', 'extended']),
  // Adoption — likelihood to sign up (0-1).
  signup_likelihood: z.number().min(0).max(1),
  // Retention band — same enum as AI persona schema.
  retention_category: z.enum(['no_return', 'weak', 'moderate', 'strong']),
  // Task success — likelihood of completing the core action (0-1).
  completion_likelihood: z.number().min(0).max(1),
  // Voice quotes — required even if short.
  voice: z.object({
    first_impression: z.string().max(800).optional().default(''),
    biggest_friction: z.string().max(400).optional().default(''),
    would_return_because: z.string().max(400).optional().default(''),
    if_could_change_one_thing: z.string().max(400).optional().default(''),
  }),
  // Self-reported demographics (cohort axes).
  demographics: z.object({
    age_group: z.enum(['teen', 'young_adult', 'adult', 'senior']),
    tech_literacy: z.number().min(0).max(1),
    crypto_experience: z.number().min(0).max(1),
    mobile_first: z.boolean(),
  }),
  // Per-scan custom-question answers. Keys are the question ids on
  // audience_fit_scans.custom_questions; values are 1-5 ints (Likert)
  // or strings (text). Optional/empty when the scan has no custom
  // questions or the respondent skipped them.
  custom_answers: z
    .record(z.string(), z.union([z.number().int().min(1).max(5), z.string().max(2000)]))
    .optional()
    .default({}),
});

// Map human-side enum answers into the same 0-100 dimension scores
// the AI persona pipeline produces. Mirrors mapLLMResponseToSimulated
// in services/dimensions/llm.ts so LLM vs human are directly
// comparable.
export const HUMAN_ENGAGEMENT_TO_SCORE: Record<string, number> = {
  abandon: 10, skim: 30, browse: 55, engage: 75, extended: 90,
};
export const HUMAN_RETENTION_TO_D7: Record<string, number> = {
  no_return: 0, weak: 5, moderate: 30, strong: 55,
};

export function computeSusScoreLocal(responses: readonly number[]): number {
  // Same canonical SUS-10 calc as services/audience_fit.ts.
  // Inlined to avoid pulling cross-module imports here.
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const r = responses[i]!;
    sum += i % 2 === 0 ? r - 1 : 5 - r;
  }
  return sum * 2.5;
}

router.post('/:id/survey', requirePrivyAuth, mutationLimiter, async (req, res) => {
  // Note: with `requirePrivyAuth` chained, Express's req.params.id typing
  // widens to string | string[] | undefined. Coerce to string explicitly.
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }

  const parsed = surveyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  const userId = req.privyUser!.id;

  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, id));
  if (!scan) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }
  if (scan.status !== 'completed') {
    res.status(409).json({ error: 'scan_not_completed', status: scan.status });
    return;
  }

  // Compute the human-side dimension scores (0-100) — same shape as
  // the AI per-persona scores so calibration_records rows compare apples-to-apples.
  const human = {
    happiness: computeSusScoreLocal(body.sus_responses),
    engagement: HUMAN_ENGAGEMENT_TO_SCORE[body.engagement_category]!,
    adoption: body.signup_likelihood * 100,
    retention: HUMAN_RETENTION_TO_D7[body.retention_category]!,
    task_success: body.completion_likelihood * 100,
  };

  // Pull the LLM-side dimension means from scan_cohort_results,
  // weighted by n_completed. Same recipe as services/audience_fit
  // global_*_avg fields.
  const cohortRows = await db
    .select()
    .from(schema.scanCohortResults)
    .where(eq(schema.scanCohortResults.scanId, id));
  const totalN = cohortRows.reduce((s, c) => s + c.nCompleted, 0) || 1;
  const wAvg = (
    key: 'happinessMean' | 'engagementMean' | 'adoptionMean' | 'retentionMean' | 'taskSuccessMean',
  ) =>
    cohortRows.reduce((s, c) => s + (c[key] ?? 0) * c.nCompleted, 0) / totalN;
  const llm = {
    happiness: wAvg('happinessMean'),
    engagement: wAvg('engagementMean'),
    adoption: wAvg('adoptionMean'),
    retention: wAvg('retentionMean'),
    task_success: wAvg('taskSuccessMean'),
  };

  // One calibration_records row per dimension. groundTruth = human,
  // llmInference = scan-level avg. Track A reads these to compute
  // correlation per dimension.
  const dateStr = new Date().toISOString().slice(0, 10);
  const dims: Array<keyof typeof human> = [
    'happiness', 'engagement', 'adoption', 'retention', 'task_success',
  ];
  for (const d of dims) {
    await db.insert(schema.calibrationRecords).values({
      date: dateStr,
      siteUrl: scan.targetUrl,
      personaId: null,
      dimension: d,
      llmInference: llm[d],
      groundTruth: human[d],
      delta: llm[d] - human[d],
      source: 'human_baseline',
    });
  }

  // Phase 5 — persist the raw per-respondent submission so the
  // human-aggregate pipeline (POST /:id/human-aggregate) can re-cluster
  // voice quotes + recompute dimension means using the same code paths
  // as the AI pipeline. calibration_records keeps only the 5 dimension
  // numerics; survey_responses keeps everything verbatim.
  //
  // Phase 5.1 — upsert on (scan_id, user_id) so a respondent can edit
  // their answer. Re-submitting overwrites all jsonb fields, but the
  // `id` and `submitted_at` (re-bumped to NOW) are kept consistent so
  // the recompute pipeline reads the latest state. The 5 calibration_records
  // rows above are append-only — re-edits append a new tuple per dimension
  // (calibration aggregator dedupes by date+site+dim+source for its
  // analysis, so duplicates don't double-count).
  const surveyValues = {
    susResponses: body.sus_responses,
    dimensionInputs: {
      engagement_category: body.engagement_category,
      signup_likelihood: body.signup_likelihood,
      retention_category: body.retention_category,
      completion_likelihood: body.completion_likelihood,
    },
    voice: body.voice,
    customAnswers: body.custom_answers,
    demographics: body.demographics,
  };
  // Upsert via select-then-insert/update — Drizzle's onConflictDoUpdate
  // composite-target typing is awkward and the unique index runs at
  // the DB layer either way. The (scan_id, user_id) UNIQUE constraint
  // still enforces uniqueness if a race lands two requests in flight.
  const [existing] = await db
    .select({ id: schema.surveyResponses.id })
    .from(schema.surveyResponses)
    .where(
      and(
        eq(schema.surveyResponses.scanId, id),
        eq(schema.surveyResponses.userId, userId),
      ),
    );
  let pointsAwarded = 0;
  if (existing) {
    await db
      .update(schema.surveyResponses)
      .set({ ...surveyValues, submittedAt: new Date() })
      .where(eq(schema.surveyResponses.id, existing.id));
  } else {
    await db.insert(schema.surveyResponses).values({
      scanId: id,
      userId,
      ...surveyValues,
    });
    // Console S2 — direct (self-distributed) responses earn the same
    // reward as partner-channel ones: every response is calibration
    // fuel, 41R pays (console-ia-redesign.md §4.1). First submission
    // only; per-scan cap 30 with a transparent 0pt row beyond it.
    pointsAwarded = await awardSurveyPoints({
      scanId: id,
      source: '41r',
      userId,
      email: req.privyUser!.email,
    });
    // Retention loop #2 (S3) — milestone-batched owner notification.
    notifySurveyMilestone(id);
  }

  res.json({
    ok: true,
    scanId: id,
    rows_created: dims.length,
    points_awarded: pointsAwarded,
    summary: {
      llm,
      human,
      delta: dims.reduce((acc, d) => ({ ...acc, [d]: llm[d] - human[d] }), {} as Record<string, number>),
    },
  });
});

// ─── Human aggregate (Phase 5) ────────────────────────────────────
// Triggered manually by the operator (Compare button on the report
// page) once N survey responses have piled up. Reads survey_responses,
// runs the same aggregation primitives the AI pipeline uses, and
// writes the like-for-like report into audience_fit_scans.human_aggregate.
//
// Idempotent — re-runnable any time. Each call overwrites in-place
// so the latest n_respondents is always the source of truth.
//
// Console Sprint 1 (console-ia-redesign.md §3.2): gated by scan
// ownership — the requester must be the Privy user that created the
// scan. Operator override via x-admin-key (covers legacy scans whose
// user_id is NULL — those have no owner to ask).
router.post('/:id/human-aggregate', optionalPrivyAuth, mutationLimiter, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }
  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, id));
  if (!scan) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }
  // Operator (x-admin-key) bypasses ownership — also the only path for
  // legacy scans whose user_id is NULL. Everyone else must be logged in
  // AND own the scan.
  if (!isAdminRequest(req)) {
    if (!req.privyUser) {
      res.status(401).json({ error: 'auth_required' });
      return;
    }
    if (scan.userId === null || scan.userId !== req.privyUser.id) {
      res.status(403).json({ error: 'not_scan_owner' });
      return;
    }
  }
  try {
    const aggregate = await recomputeHumanAggregate(id);
    if (!aggregate) {
      res.status(409).json({ error: 'no_responses', message: 'No survey responses for this scan yet.' });
      return;
    }
    res.json({ ok: true, aggregate });
  } catch (err) {
    res.status(500).json({
      error: 'aggregate_failed',
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
});

// ─── Compare AI vs Human (Phase 5) ─────────────────────────────────
// Single endpoint backing /validator/compare/[scanId]. Returns the
// already-cached human_aggregate (or null when the operator hasn't
// triggered POST /human-aggregate yet) plus the AI side's headline
// dimension means + audience_fit_score + frictions, plus a `diff`
// block computing per-dimension Δ and friction-overlap stats.
router.get('/:id/compare', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id ?? '')) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }
  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, id));
  if (!scan) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }

  // Live response count — what the report-page button shows next to
  // "Compare with humans (n=X)". Distinct from n_respondents in the
  // cached aggregate because the operator may not have re-aggregated
  // since the last submission landed.
  const [respondentCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.surveyResponses)
    .where(eq(schema.surveyResponses.scanId, id));

  // AI-side dimension means — same recipe as the /survey handler's
  // wAvg() weighting. Pulled once here so the diff math doesn't depend
  // on the report-builder running first.
  const cohortRows = await db
    .select()
    .from(schema.scanCohortResults)
    .where(eq(schema.scanCohortResults.scanId, id));
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

  const aiDimMeans = {
    happiness: wAvg('happinessMean'),
    task_success: wAvg('taskSuccessMean'),
    adoption: wAvg('adoptionMean'),
    retention_d7: wAvg('retentionMean'),
    engagement: wAvg('engagementMean'),
  };

  // Human aggregate — null when the operator hasn't run POST
  // /human-aggregate yet OR when there are no responses.
  type HumanAggregateShape = {
    n_respondents: number;
    audience_fit_score: number;
    dimension_means: typeof aiDimMeans;
    frictions: Array<{ rank: number; title: string; n: number; quote: string }> | null;
    aarrr: { stages: Array<{ key: string; score: number; n_passing: number; total: number }>; total_personas: number } | null;
    custom_question_rollup: Record<string, { likert?: { mean: number; n_answered: number }; quotes?: string[] }>;
    computed_at: string;
  };
  const human = (scan.humanAggregate as HumanAggregateShape | null) ?? null;

  // Friction overlap — match by lowercased title substring. Cheap
  // heuristic; real semantic matching would need an embedding step.
  // The UI side just needs to know "which AI clusters have a human
  // analog" to color them, not the exact mapping.
  const aiFrictions = (scan.frictionsJson ?? []) as Array<{
    rank: number;
    title: string;
    n: number;
  }>;
  const humanFrictions = human?.frictions ?? [];

  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);

  function frictionOverlap(
    a: ReadonlyArray<{ title: string }>,
    b: ReadonlyArray<{ title: string }>,
  ): number {
    if (a.length === 0 || b.length === 0) return 0;
    let matches = 0;
    for (const x of a) {
      const xt = new Set(norm(x.title));
      const hit = b.some((y) => {
        const yt = norm(y.title);
        return yt.some((w) => xt.has(w));
      });
      if (hit) matches += 1;
    }
    return matches / Math.max(a.length, b.length);
  }

  const diff = human
    ? {
        audience_fit_delta:
          human.audience_fit_score - (scan.audienceFitScore ?? 0),
        dimension_deltas: {
          happiness: human.dimension_means.happiness - aiDimMeans.happiness,
          task_success:
            human.dimension_means.task_success - aiDimMeans.task_success,
          adoption: human.dimension_means.adoption - aiDimMeans.adoption,
          retention_d7:
            human.dimension_means.retention_d7 - aiDimMeans.retention_d7,
          engagement: human.dimension_means.engagement - aiDimMeans.engagement,
        },
        friction_overlap: frictionOverlap(aiFrictions, humanFrictions),
        ai_only_frictions: aiFrictions
          .filter((af) => {
            const at = new Set(norm(af.title));
            return !humanFrictions.some((hf) =>
              norm(hf.title).some((w) => at.has(w)),
            );
          })
          .slice(0, 3)
          .map((f) => ({ rank: f.rank, title: f.title, n: f.n })),
        human_only_frictions: humanFrictions
          .filter((hf) => {
            const ht = new Set(norm(hf.title));
            return !aiFrictions.some((af) =>
              norm(af.title).some((w) => ht.has(w)),
            );
          })
          .slice(0, 3)
          .map((f) => ({ rank: f.rank, title: f.title, n: f.n })),
      }
    : null;

  // Per-cohort AI↔human fidelity (Stage 1/T0 PoC). Surfaces by-cohort
  // |Δ| so the operator sees fidelity build as surveys arrive — never a
  // single mixed-cohort number (§8 honesty contract). cohorts carry a
  // null delta until a cohort has BOTH AI personas and matched humans.
  const fidelity = await computeScanFidelity(id);

  res.json({
    scan: {
      id: scan.id,
      target_url: scan.targetUrl,
      category: scan.category,
      one_line_pitch: scan.oneLinePitch,
      mode: scan.mode,
      status: scan.status,
      custom_questions: scan.customQuestions ?? null,
    },
    ai: {
      audience_fit_score: scan.audienceFitScore,
      dimension_means: aiDimMeans,
      frictions: aiFrictions,
      n_personas: scan.personasCompleted,
    },
    human, // null when not yet aggregated
    diff,  // null when human is null
    survey_response_count: respondentCount?.n ?? 0,
    fidelity, // per-cohort |Δ| (camelCase service shape)
  });
});

// (Sponsored 0-USDC Solana payment routes removed in the Sui migration.
//  Scans are gated by the credit ledger — debitScan in POST /api/scan.
//  The payment_tx_signature column is retained for historical rows.)

router.get('/:scanId/persona/:personaId', async (req, res) => {
  const { scanId, personaId } = req.params;
  if (!UUID_RE.test(scanId) || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: 'invalid_id' });
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

  const [row] = await db
    .select({
      personaId: schema.scanPersonaResponses.personaId,
      cohortId: schema.scanPersonaResponses.cohortId,
      happiness: schema.scanPersonaResponses.happinessScore,
      engagement: schema.scanPersonaResponses.engagementScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      retentionD7: schema.scanPersonaResponses.retentionD7,
      adoption: schema.scanPersonaResponses.adoptionScore,
      retentionDCurve: schema.scanPersonaResponses.retentionDCurve,
      rawResponse: schema.scanPersonaResponses.rawResponse,
      voiceFirstImpression: schema.scanPersonaResponses.voiceFirstImpression,
      voiceFriction: schema.scanPersonaResponses.voiceFriction,
      voiceBiggestFriction: schema.scanPersonaResponses.voiceBiggestFriction,
      voiceWouldReturnBecause:
        schema.scanPersonaResponses.voiceWouldReturnBecause,
      isFlagged: schema.scanPersonaResponses.isFlagged,
      flagReason: schema.scanPersonaResponses.flagReason,
      personaVector: schema.personas.vector,
      displayName: schema.testers.displayName,
      testerAddr: schema.personas.testerAddr,
      suiObjectId: schema.personas.suiObjectId,
      walrusBlobId: schema.personas.walrusBlobId,
      sealId: schema.personas.sealId,
      anchoredAt: schema.personas.anchoredAt,
    })
    .from(schema.scanPersonaResponses)
    .innerJoin(
      schema.personas,
      eq(schema.personas.id, schema.scanPersonaResponses.personaId)
    )
    .innerJoin(
      schema.testers,
      eq(schema.testers.walletAddress, schema.personas.testerAddr)
    )
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, scanId),
        eq(schema.scanPersonaResponses.personaId, personaId)
      )
    );

  if (!row) {
    res.status(404).json({ error: 'persona_response_not_found' });
    return;
  }

  res.json(shapePersonaDetailResponse(scan, row));
});

// Persona-detail rawResponse hides behind Drizzle's `unknown` jsonb
// type. Both the simulator (`sim.raw`) and LLM (`SimulatedResponse.raw`)
// paths produce the same 4-field SUS shape; errored rows store
// `{error: '...'}` (no SUS fields). safeParse extracts the typed
// fields when present, returns null on schema mismatch, and lets
// `?? null` carry through unknown shapes so the response stays
// well-formed even if a future writer drifts.
const detailRawSchema = z
  .object({
    sus_responses: z.array(z.number()).optional(),
    sus_raw_score: z.number().optional(),
    signup_likelihood: z.number().optional(),
    completion_likelihood: z.number().optional(),
  })
  .passthrough();

type DetailRawResponse = {
  sus_responses?: number[];
  sus_raw_score?: number;
  signup_likelihood?: number;
  completion_likelihood?: number;
};

function parseDetailRawResponse(raw: unknown): DetailRawResponse | null {
  if (raw === null || raw === undefined) return null;
  const parsed = detailRawSchema.safeParse(raw);
  if (!parsed.success) return null;
  // Strip non-typed passthrough fields — only the 4 SUS keys reach
  // the response shape. Keeps the consumer contract narrow.
  const { sus_responses, sus_raw_score, signup_likelihood, completion_likelihood } =
    parsed.data;
  return { sus_responses, sus_raw_score, signup_likelihood, completion_likelihood };
}

export function shapePersonaDetailResponse(
  scan: typeof schema.audienceFitScans.$inferSelect,
  row: {
    personaId: string;
    cohortId: string;
    happiness: number | null;
    engagement: number | null;
    taskSuccess: number | null;
    retentionD7: number | null;
    adoption: number | null;
    retentionDCurve:
      | { d1: number; d3: number; d7: number; d30: number }
      | null;
    rawResponse: unknown;
    voiceFirstImpression: string | null;
    voiceFriction: string | null;
    voiceBiggestFriction: string | null;
    voiceWouldReturnBecause: string | null;
    isFlagged: boolean;
    flagReason: string | null;
    personaVector: typeof schema.personas.$inferSelect.vector;
    displayName: string;
    testerAddr: string;
    suiObjectId?: string | null;
    walrusBlobId?: string | null;
    sealId?: string | null;
    anchoredAt?: Date | null;
  }
) {
  const cohort = COHORT_BY_ID[row.cohortId];
  const ageGroup = row.personaVector.demographics?.age_group ?? 'adult';
  const age = personaAgeFromGroup(ageGroup);

  // Flatten the persona vector axes the detail screen renders. Keep
  // names matching the design's VECTOR_AXES list — the screen pairs
  // them with progress bars.
  const v = row.personaVector;
  const vectorAxes = [
    { k: 'tech_literacy', v: v.demographics?.tech_literacy ?? null },
    { k: 'crypto_experience', v: v.demographics?.crypto_experience ?? null },
    { k: 'patience_level', v: v.demographics?.patience_level ?? null },
    {
      k: 'mobile_first',
      v: v.ux_preferences?.mobile_first ? 1 : 0,
    },
    { k: 'design_sensitivity', v: v.demographics?.design_sensitivity ?? null },
    { k: 'expertise_defi', v: v.expertise?.defi ?? null },
  ].filter((a): a is { k: string; v: number } => a.v != null);

  const raw = parseDetailRawResponse(row.rawResponse);

  return {
    scan: {
      id: scan.id,
      target_url: scan.targetUrl,
      mode: scan.mode,
      status: scan.status,
    },
    persona: {
      id: row.personaId,
      display_name: personaDisplayName(
        row.displayName ?? 'Synthetic',
        cohort?.label ?? row.cohortId,
        row.personaId
      ),
      tester_addr: row.testerAddr,
      age,
      age_group: ageGroup,
      cohort_id: row.cohortId,
      cohort_label: cohort?.label ?? row.cohortId,
      voice_sample: v.voice_sample ?? null,
      vector_axes: vectorAxes,
      // On-chain anchor (chain wiring). Null until the persona is anchored
      // via scripts/anchor-personas.ts — the UI hides the card when null.
      chain: row.suiObjectId
        ? {
            sui_object_id: row.suiObjectId,
            walrus_blob_id: row.walrusBlobId ?? null,
            seal_id: row.sealId ?? null,
            anchored_at: row.anchoredAt ? row.anchoredAt.toISOString() : null,
            object_url: suiObjectUrl(row.suiObjectId),
            walrus_url: row.walrusBlobId ? walrusBlobUrl(row.walrusBlobId) : null,
          }
        : null,
    },
    response: {
      happiness: row.happiness,
      engagement: row.engagement,
      task_success: row.taskSuccess,
      retention_d7: row.retentionD7,
      adoption: row.adoption,
      retention_d_curve: row.retentionDCurve,
      sus_responses: raw?.sus_responses ?? null,
      sus_raw_score: raw?.sus_raw_score ?? null,
      signup_likelihood: raw?.signup_likelihood ?? null,
      completion_likelihood: raw?.completion_likelihood ?? null,
      voice_first_impression: row.voiceFirstImpression,
      voice_friction: row.voiceFriction,
      voice_biggest_friction: row.voiceBiggestFriction,
      voice_would_return_because: row.voiceWouldReturnBecause,
      is_flagged: row.isFlagged,
      flag_reason: row.flagReason,
    },
  };
}

// ─── Name helpers ────────────────────────────────────────────────
// First × last pools combine into 30 × 30 = 900 unique pairs, vastly
// reducing collisions inside one report (a 6-card render hits a
// duplicate ~2% of the time vs ~30% with a 50-pair pool). Used only
// to override the synthetic seed displayNames ("Crypto Native #9");
// real tester wallets keep their stored displayName.
const FIRST_NAMES: readonly string[] = [
  'Alex', 'Sora', 'Mateo', 'Ines', 'Yuki', 'Noah', 'Aisha', 'Liam',
  'Ravi', 'Eun-jin', 'Maya', 'Chen', 'Kofi', 'Priya', 'Lukas',
  'Sara', 'Jakub', 'Hana', 'Diego', 'Claire', 'Emil', 'Layla',
  'Tom', 'Mei', 'Ananya', 'Felipe', 'Anya', 'Jonas', 'Yara', 'Wei',
];
const LAST_NAMES: readonly string[] = [
  'Park', 'Tanaka', 'García', 'Almeida', 'Sato', 'Bauer', 'Khan',
  'O’Brien', 'Mehta', 'Lee', 'Cohen', 'Wei', 'Mensah', 'Iyer',
  'Schmidt', 'Lindberg', 'Nowak', 'Rojas', 'Dubois', 'Andersen',
  'Hassan', 'Becker', 'Lin', 'Rao', 'Souza', 'Volkov', 'Nielsen',
  'Saab', 'Chen', 'Romano',
];

// Detect synthetic seed names like "Crypto Native #9" so we know when
// to substitute. Real tester displayNames ("Alice Chen") pass through.
// Exported so the card shaper can also flag the card as synthetic
// (UI surfaces a "synth" marker so stakeholders don't read pool names
// like "Jonas Bauer" as actual users).
export function isSyntheticSeedName(displayName: string, roleLabel: string): boolean {
  return displayName.toLowerCase().startsWith(roleLabel.toLowerCase() + ' #');
}

export function personaDisplayName(
  rawDisplayName: string,
  roleLabel: string,
  personaId: string
): string {
  if (!isSyntheticSeedName(rawDisplayName, roleLabel)) return rawDisplayName;
  const h = hash32(personaId);
  // Two independent indices from the same hash via different bit
  // shifts so the first/last picks are uncorrelated.
  const first = FIRST_NAMES[h % FIRST_NAMES.length]!;
  const last = LAST_NAMES[(h >>> 8) % LAST_NAMES.length]!;
  return `${first} ${last}`;
}

// ─── Age helpers ─────────────────────────────────────────────────
// FNV-1a 32-bit. Stable across processes, no crypto cost. Used only
// by the name pool below for deterministic first/last picks — never
// for security/randomness.
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// age_group bucket → bucket-center age. Spec only stores the
// categorical age_group (teen / young_adult / adult / senior); we
// don't synthesise an exact age inside the bucket. Identical ages
// across a cohort honestly signal that the bucket granularity is
// what we measure (the prior personaId-hash jitter invented data
// that wasn't in the persona vector).
export function personaAgeFromGroup(ageGroup: string | undefined): number {
  switch (ageGroup) {
    case 'teen':
      return 16;
    case 'young_adult':
      return 25;
    case 'senior':
      return 58;
    default:
      return 35;
  }
}

// ─── Persona-card query (fit + non-fit share this shape) ─────────
// Top/bottom 3 by composite (happiness + engagement + task_success).
// Same column list, same joins, same filter — only the orderBy
// direction differs. Direct asc/desc in the orderBy lets Drizzle
// type-narrow the column expression so we don't lose typing on the
// returned shape.
function buildPersonaCardQuery(scanId: string, order: 'asc' | 'desc') {
  const sumExpr = sql<number>`(
    coalesce(${schema.scanPersonaResponses.happinessScore}, 0)
    + coalesce(${schema.scanPersonaResponses.engagementScore}, 0)
    + coalesce(${schema.scanPersonaResponses.taskSuccessScore}, 0)
  )`;
  return db
    .select({
      personaId: schema.scanPersonaResponses.personaId,
      cohortId: schema.scanPersonaResponses.cohortId,
      happiness: schema.scanPersonaResponses.happinessScore,
      engagement: schema.scanPersonaResponses.engagementScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      voiceFirstImpression: schema.scanPersonaResponses.voiceFirstImpression,
      voiceBiggestFriction: schema.scanPersonaResponses.voiceBiggestFriction,
      voiceWouldReturnBecause:
        schema.scanPersonaResponses.voiceWouldReturnBecause,
      voiceSample: schema.personas.vector,
      displayName: schema.testers.displayName,
      ageGroup: schema.personas.vector,
    })
    .from(schema.scanPersonaResponses)
    .innerJoin(
      schema.personas,
      eq(schema.personas.id, schema.scanPersonaResponses.personaId)
    )
    .innerJoin(
      schema.testers,
      eq(schema.testers.walletAddress, schema.personas.testerAddr)
    )
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, scanId),
        eq(schema.scanPersonaResponses.isFlagged, false),
        isNotNull(schema.scanPersonaResponses.happinessScore)
      )
    )
    .orderBy(order === 'desc' ? desc(sumExpr) : asc(sumExpr))
    .limit(3);
}

// ─── Per-persona card shaping ─────────────────────────────────────
export function shapePersonaCard(
  r: {
    personaId: string;
    cohortId: string;
    happiness: number | null;
    engagement: number | null;
    taskSuccess: number | null;
    voiceFirstImpression?: string | null;
    voiceBiggestFriction?: string | null;
    voiceWouldReturnBecause?: string | null;
    voiceSample: typeof schema.personas.$inferSelect.vector;
    displayName: string;
  },
  intent: 'fit' | 'non_fit' = 'fit'
) {
  // Average the dimensions we have. If all three are null (response
  // is mid-flight or was filtered upstream), return null so the UI
  // can render a placeholder rather than a misleading 0.
  const present = [r.happiness, r.engagement, r.taskSuccess].filter(
    (v): v is number => v != null
  );
  const score =
    present.length === 0
      ? null
      : Math.round(present.reduce((a, b) => a + b, 0) / present.length);
  const cohort = COHORT_BY_ID[r.cohortId];
  const ageGroup = r.voiceSample.demographics?.age_group;
  const age = personaAgeFromGroup(ageGroup);
  // Prefer the LLM-generated quote that matches the card's intent —
  // fit cards get the persona's "would_return_because" reason (positive
  // tone, matches the high score), non-fit cards get "biggest_friction"
  // (the why-it-failed). Both fall back to first_impression then the
  // persona's static voice_sample so simulator/legacy rows still render.
  const quote =
    intent === 'fit'
      ? r.voiceWouldReturnBecause ||
        r.voiceFirstImpression ||
        r.voiceBiggestFriction ||
        r.voiceSample.voice_sample ||
        ''
      : r.voiceBiggestFriction ||
        r.voiceFirstImpression ||
        r.voiceWouldReturnBecause ||
        r.voiceSample.voice_sample ||
        '';
  // Dedupe tags — cohort_id (e.g. "senior") can collide with
  // age_group bucket of the same name.
  const tagSet = new Set([r.cohortId, ageGroup ?? 'unknown']);
  const role = cohort?.label ?? r.cohortId;
  const rawName = r.displayName ?? 'Synthetic';
  return {
    id: r.personaId,
    name: personaDisplayName(rawName, role, r.personaId),
    age,
    role,
    score,
    quote,
    tags: Array.from(tagSet),
    // Flagged when the displayed name comes from the pool (synthetic
    // seed) rather than a real tester. UI prints a "synth" marker so
    // stakeholders don't read "Jonas Bauer" as an actual user.
    is_synthetic: isSyntheticSeedName(rawName, role),
  };
}

// ─── Live processing-feed shaping ────────────────────────────────
// Sentiment classifier — bands the per-persona reaction into
// positive | mixed | friction so the processing feed can paint a
// coloured tag without having to re-render numeric scores.
export function classifySentiment(
  happiness: number | null,
  taskSuccess: number | null
): 'positive' | 'mixed' | 'friction' {
  const h = happiness ?? 50;
  const t = taskSuccess ?? 50;
  const avg = (h + t) / 2;
  if (avg >= 65) return 'positive';
  if (avg >= 40) return 'mixed';
  return 'friction';
}

export function shapeRecentResponse(r: {
  personaId: string;
  cohortId: string;
  voiceFirstImpression: string | null;
  voiceBiggestFriction: string | null;
  happiness: number | null;
  taskSuccess: number | null;
  voiceSample: typeof schema.personas.$inferSelect.vector;
  createdAt: Date;
}) {
  const cohort = COHORT_BY_ID[r.cohortId];
  const ageGroup = r.voiceSample.demographics?.age_group ?? 'adult';
  return {
    persona_id: r.personaId,
    cohort_id: r.cohortId,
    cohort_label: cohort?.label ?? r.cohortId,
    age_group: ageGroup,
    voice: r.voiceFirstImpression ?? r.voiceBiggestFriction ?? '',
    sentiment: classifySentiment(r.happiness, r.taskSuccess),
    created_at: r.createdAt.toISOString(),
  };
}

export function shapeCohortProgress(rows: Array<{ cohortId: string; n: number }>) {
  // Target = 14 personas per standard cohort (Mode A). Mode B uses a
  // single custom_audience row whose target floats with how many
  // matched the selector — we report the live count as both n and
  // target so the bar reads "X / X" once any rows arrive. This
  // matches the worker's own targeting (selectPersonasForAudience).
  return rows.map((r) => {
    const cohort = COHORT_BY_ID[r.cohortId];
    const target = cohort?.target_n ?? r.n;
    return {
      cohort_id: r.cohortId,
      cohort_label: cohort?.label ?? r.cohortId,
      n_completed: r.n,
      n_target: target,
    };
  });
}

// ─── Synthesis-tied builders (only meaningful when status='completed') ──
function buildFrictionsForReport(
  scan: typeof schema.audienceFitScans.$inferSelect,
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Prefer the LLM-clustered frictions persisted by
  // services/dimensions/frictions.ts at end of pipeline. Falls back
  // to a cohort-derived placeholder when null (simulator path or
  // clustering failed).
  const clusters = scan.frictionsJson;
  if (clusters && clusters.length > 0) {
    return clusters.map((c) => ({
      rank: c.rank,
      title: c.title,
      detail: c.summary,
      n: c.n,
      where: c.where,
      impact: c.impact,
      quote: c.quote,
    }));
  }

  // Placeholder fallback — surface worst cohorts as friction rows.
  const ranked = [...rows]
    .filter((c) => c.cohortFitScore != null)
    .sort((a, b) => (a.cohortFitScore ?? 0) - (b.cohortFitScore ?? 0))
    .slice(0, 3);
  return ranked.map((c, i) => ({
    rank: i + 1,
    title: `Low resonance: ${c.cohortLabel}`,
    detail: `${c.cohortLabel} cohort scored ${(c.cohortFitScore ?? 0).toFixed(0)}/100 — well below average.`,
    n: c.nCompleted,
    where: c.cohortLabel,
    impact: `+${Math.round((50 - (c.cohortFitScore ?? 0)) * 0.3)} fit est.`,
    quote: 'Voice clustering not run yet — using cohort placeholder.',
  }));
}

function buildRetentionCurve(
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  const valid = rows.filter((r) => r.retentionDCurve != null);
  if (valid.length === 0) return [];
  const sum = { d1: 0, d3: 0, d7: 0, d30: 0 };
  for (const r of valid) {
    const c = r.retentionDCurve!;
    sum.d1 += c.d1;
    sum.d3 += c.d3;
    sum.d7 += c.d7;
    sum.d30 += c.d30;
  }
  const n = valid.length;
  return [
    { d: 'D-1', v: Math.round(sum.d1 / n) },
    { d: 'D-3', v: Math.round(sum.d3 / n) },
    { d: 'D-7', v: Math.round(sum.d7 / n) },
    { d: 'D-30', v: Math.round(sum.d30 / n) },
  ];
}

function buildFormulaRows(
  scan: typeof schema.audienceFitScans.$inferSelect,
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Best-cohort dimension means → formula rows. This is the per-
  // dimension breakdown that drove that cohort's cohort_fit_score.
  const best = rows.find((c) => c.cohortId === scan.bestCohortId);
  if (!best) return [];
  const w = DIMENSION_WEIGHTS_V1;
  return [
    { d: 'Engagement', s: Math.round(best.engagementMean ?? 0), w: w.engagement, c: 0.78 },
    { d: 'Task Success', s: Math.round(best.taskSuccessMean ?? 0), w: w.task_success, c: 0.71 },
    { d: 'Happiness', s: Math.round(best.happinessMean ?? 0), w: w.happiness, c: 0.65 },
    { d: 'Adoption', s: Math.round(best.adoptionMean ?? 0), w: w.adoption, c: 0.38 },
    { d: 'Retention', s: Math.round(best.retentionMean ?? 0), w: w.retention, c: 0.18 },
  ];
}

function buildDimensionBreakdown(
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Cross-cohort dimension means weighted by n_completed — same shape
  // as the engagement breakdown card on the report.
  const valid = rows.filter((r) => r.cohortFitScore != null);
  if (valid.length === 0) return [];
  const totalN = valid.reduce((s, r) => s + r.nCompleted, 0) || 1;
  const wAvg = (key: 'engagementMean' | 'happinessMean' | 'taskSuccessMean' | 'adoptionMean' | 'retentionMean') =>
    Math.round(
      valid.reduce((s, r) => s + (r[key] ?? 0) * r.nCompleted, 0) / totalN
    );
  const eng = wAvg('engagementMean');
  const hap = wAvg('happinessMean');
  const tsk = wAvg('taskSuccessMean');
  const ado = wAvg('adoptionMean');
  const ret = wAvg('retentionMean');
  const tone = (v: number) => (v < 40 ? 'bad' : v < 60 ? 'warn' : 'ok');
  return [
    { l: 'Onboarding Completion', v: ado, sub: 'Sign-up likelihood', tone: tone(ado) },
    { l: 'Time to Aha', v: tsk, sub: 'Task completion proxy', tone: tone(tsk) },
    { l: 'Sentiment Resonance', v: hap, sub: 'SUS aggregate', tone: tone(hap) },
    { l: 'Feature Discovery', v: eng, sub: 'Session depth', tone: tone(eng) },
    { l: 'Return Intent', v: ret, sub: 'D-7 retention', tone: tone(ret) },
  ];
}

async function buildKpis(
  scan: typeof schema.audienceFitScans.$inferSelect,
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Mode B is a single-audience verdict scan — best == worst == median
  // by construction. Showing those as 3 different cards is misleading.
  // Surface verdict + audience definition instead.
  if (scan.mode === 'B') {
    // Floor to 1 decimal so the Audience fit value reads consistently
    // with the verdict band next to it (e.g. 39.9 reads as <40 → FAIL,
    // not 40.0 reads as <40 — toFixed/round on 39.99 produced 40.0).
    const rawScore = scan.audienceFitScore ?? 0;
    const score = Math.floor(rawScore * 10) / 10;
    const verdict = scan.modeBVerdict ?? 'pending';
    const audience =
      scan.targetAudienceText && scan.targetAudienceText.length > 36
        ? `${scan.targetAudienceText.slice(0, 36)}…`
        : scan.targetAudienceText ?? '—';
    const verdictTone =
      verdict === 'pass' ? 'ok' : verdict === 'conditional' ? 'warn' : 'bad';
    return [
      {
        l: 'Audience fit',
        v: score.toFixed(1),
        sub: scan.targetAudienceText
          ? `${rows[0]?.nCompleted ?? 0} matching personas`
          : '—',
        tone: rawScore >= 60 ? 'ok' : rawScore >= 40 ? 'warn' : 'bad',
      },
      {
        l: 'Verdict',
        v: verdict.toUpperCase(),
        sub:
          verdict === 'pass'
            ? '≥60'
            : verdict === 'conditional'
            ? '40-60'
            : '<40',
        tone: verdictTone,
      },
      {
        l: 'Personas analyzed',
        v: String(scan.personasCompleted),
        sub: `${scan.personasFlagged ?? 0} flagged`,
        tone: 'faint',
      },
      {
        l: 'Audience definition',
        v: audience,
        sub: scan.category ? `category: ${scan.category}` : '—',
        tone: 'faint',
      },
    ];
  }

  const best = rows.find((c) => c.cohortId === scan.bestCohortId);
  const worst = rows.find((c) => c.cohortId === scan.worstCohortId);

  // Industry benchmark — null when n<3 same-category scans (Phase 2-D
  // dev threshold; will move to 50 per spec §6.6 in production).
  const benchmark = scan.category
    ? await getCategoryBenchmark(scan.category)
    : null;

  return [
    {
      l: 'Best cohort fit',
      v: String(Math.round(scan.bestCohortScore ?? 0)),
      sub: best?.cohortLabel ?? '—',
      tone: 'ok',
    },
    {
      l: 'Worst cohort fit',
      v: String(Math.round(scan.worstCohortScore ?? 0)),
      sub: worst?.cohortLabel ?? '—',
      tone: 'bad',
    },
    {
      l: 'Personas analyzed',
      v: String(scan.personasCompleted),
      sub: `${scan.personasFlagged ?? 0} flagged`,
      tone: 'faint',
    },
    benchmark
      ? {
          l: 'Industry benchmark',
          v: String(Math.round(benchmark.avg)),
          sub: `${benchmark.category} · n=${benchmark.n}`,
          tone:
            benchmark.avg >= 60 ? 'ok' : benchmark.avg >= 40 ? 'warn' : 'bad',
        }
      : {
          l: 'Industry benchmark',
          v: '—',
          sub: 'coming soon',
          tone: 'faint',
        },
  ];
}

function shapeScanMeta(s: typeof schema.audienceFitScans.$inferSelect) {
  return {
    id: s.id,
    target_url: s.targetUrl,
    category: s.category,
    category_confidence: s.categoryConfidence,
    one_line_pitch: s.oneLinePitch,
    mode: s.mode,
    status: s.status,
    personas_attempted: s.personasAttempted,
    personas_completed: s.personasCompleted,
    personas_flagged: s.personasFlagged,
    weights_version: s.weightsVersion,
    target_audience_text: s.targetAudienceText,
    // Mode B fields — null on Mode A scans.
    mode_b_verdict: s.modeBVerdict as
      | 'pass'
      | 'conditional'
      | 'fail'
      | null,
    mode_b_parsed_selector: s.modeBParsedSelector,
    // Phase 5 — exposed so the survey page can render site-specific
    // questions and the report page can show "n custom questions"
    // without a separate fetch.
    custom_questions: s.customQuestions ?? null,
    /** Ch1 objective page facts measured at capture (no LLM). Null on
     *  legacy scans — the report's "measured" strip hides itself. */
    capture_signals: s.captureSignals ?? null,
    created_at: s.createdAt.toISOString(),
    completed_at: s.completedAt ? s.completedAt.toISOString() : null,
  };
}

function shapeCohort(c: typeof schema.scanCohortResults.$inferSelect) {
  return {
    cohort_id: c.cohortId,
    cohort_label: c.cohortLabel,
    n_target: c.nTarget,
    n_completed: c.nCompleted,
    n_flagged: c.nFlagged,
    cohort_fit_score: c.cohortFitScore,
    cohort_fit_ci_low: c.cohortFitCiLow,
    cohort_fit_ci_high: c.cohortFitCiHigh,
    dimension_means: {
      happiness: c.happinessMean,
      engagement: c.engagementMean,
      adoption: c.adoptionMean,
      retention: c.retentionMean,
      task_success: c.taskSuccessMean,
    },
    retention_d_curve: c.retentionDCurve,
  };
}

// ─── Demo fixture ────────────────────────────────────────────────
// Mirrors the Phase 0 mock data baked into
// apps/web/app/validator/report/[scanId]/page.tsx. Frontend can now
// fetch this via the API instead of branching on scanId — the
// fallback path simplifies once frontend hydration lands next.
function buildDemoReport() {
  return {
    scan: {
      id: 'demo',
      target_url: 'yoursite.com',
      category: 'DeFi',
      category_confidence: 0.91,
      one_line_pitch:
        'DeFi swap aggregator on Solana — minimal slippage + MEV protection.',
      mode: 'A' as const,
      status: 'completed' as const,
      personas_attempted: 113,
      personas_completed: 113,
      personas_flagged: 0,
      weights_version: 'v1.3',
      // Phase 5 — null in the demo (no human survey for demo scan).
      custom_questions: null,
      created_at: '2026-04-30T14:22:00.000Z',
      completed_at: '2026-04-30T14:28:00.000Z',
    },
    result: {
      audience_fit_score: 45,
      best: {
        cohort_id: 'crypto_native',
        cohort_label: 'Crypto Native',
        cohort_fit_score: 84,
      },
      worst: {
        cohort_id: 'teen_newcomer',
        cohort_label: 'Teen newcomer',
        cohort_fit_score: 21,
      },
      median_score: 35,
      global_task_success_avg: 50,
      global_sentiment_avg: 58,
      weights_used: AUDIENCE_FIT_WEIGHTS,
      dimension_weights: DIMENSION_WEIGHTS_V1,
    },
    kpis: [
      { l: 'Best cohort fit', v: '84', sub: 'Crypto Native', tone: 'ok' },
      { l: 'Worst cohort fit', v: '21', sub: 'Teen student', tone: 'bad' },
      { l: 'Hottest drop-off', v: '67%', sub: 'Wallet step', tone: 'bad' },
      { l: 'Industry benchmark', v: '—', sub: 'coming soon', tone: 'faint' },
    ],
    fit_personas: [
      {
        id: 'p_alex',
        name: 'Alex K.',
        age: 31,
        role: '30s DeFi pro',
        score: 84,
        quote:
          "Explicit MEV protection earns trust. Slippage controls feel precise — I'd use this as my main driver.",
        tags: ['crypto_native', 'mobile_first', 'high_freq'],
      },
      {
        id: 'p_june',
        name: 'June P.',
        age: 28,
        role: 'Designer (20s)',
        score: 71,
        quote:
          'Consistent tone, balanced information density. Path to first swap was unobstructed.',
        tags: ['design_lit', 'curious', 'medium_tech'],
      },
      {
        id: 'p_marco',
        name: 'Marco S.',
        age: 34,
        role: 'Web3 pro',
        score: 68,
        quote:
          'Technically solid. Missing power-user shortcuts is the only friction.',
        tags: ['power_user', 'crypto_native', 'desktop'],
      },
    ],
    non_fit_personas: [
      {
        id: 'p_jiwon',
        name: 'Jiwon L.',
        age: 16,
        role: 'Teen student',
        score: 21,
        quote:
          'I have no idea what this site does. Too much English, too many unfamiliar words.',
        tags: ['low_crypto', 'price_sens', 'mobile'],
      },
      {
        id: 'p_youngja',
        name: 'Youngja H.',
        age: 58,
        role: 'Senior (50+)',
        score: 24,
        quote: 'Buttons are too small to tap. It feels intimidating to use.',
        tags: ['low_tech', 'risk_averse', 'desktop'],
      },
      {
        id: 'p_ben',
        name: 'Ben K.',
        age: 33,
        role: 'DeFi beginner',
        score: 31,
        quote:
          "I don't know what slippage means and I can't find an explanation.",
        tags: ['low_crypto', 'curious', 'first_time'],
      },
    ],
    frictions: [
      {
        rank: 1,
        title: 'Wallet selection ambiguity',
        detail: 'No guidance on which wallet to connect.',
        n: 21,
        where: 'Connect wallet',
        impact: '+12 PMF est.',
        quote: 'Which wallet should I use? Phantom? MetaMask?',
      },
      {
        rank: 2,
        title: 'Jargon barrier',
        detail: '12 specialized terms surface without definitions.',
        n: 14,
        where: 'Hero / Features',
        impact: '+9 PMF est.',
        quote: 'Slippage? AMM? These words feel scary.',
      },
      {
        rank: 3,
        title: 'Mobile hit-target',
        detail: 'Mobile buttons fall under minimum tap-target size.',
        n: 8,
        where: 'Mobile Swap',
        impact: '+5 PMF est.',
        quote: 'Buttons are too small to press with a finger.',
      },
    ],
    retention_curve: [
      { d: 'D-1', v: 80 },
      { d: 'D-3', v: 65 },
      { d: 'D-7', v: 40 },
      { d: 'D-30', v: 18 },
    ],
    dimension_breakdown: [
      { l: 'Onboarding Completion', v: 42, sub: 'Wallet + profile', tone: 'bad' },
      {
        l: 'Time to Aha',
        v: 68,
        sub: 'Smoothness to first swap',
        tone: 'warn',
        suffix: 's',
        invert: true,
      },
      { l: 'Sentiment Resonance', v: 58, sub: 'Post first-touch', tone: 'warn' },
      { l: 'Feature Discovery', v: 34, sub: 'Adjacent feature exploration', tone: 'bad' },
      { l: 'Return Intent', v: 46, sub: 'Likelihood to come back', tone: 'warn' },
    ],
    formula_rows: [
      { d: 'Engagement', s: 42, w: 0.3, c: 0.78 },
      { d: 'Onboarding', s: 42, w: 0.2, c: 0.71 },
      { d: 'Sentiment', s: 58, w: 0.2, c: 0.65 },
      { d: 'Discovery', s: 34, w: 0.15, c: 0.38 },
      { d: 'Retention', s: 46, w: 0.15, c: 0.18 },
    ],
    cohorts: null,
    aarrr: {
      total_personas: 113,
      stages: [
        { key: 'acquisition', label: 'Acquisition', score: 100, n_passing: 113, total: 113, threshold: 'Reached the URL (baseline)' },
        { key: 'activation', label: 'Activation', score: 42, n_passing: 47, total: 113, threshold: 'task_success ≥ 50' },
        { key: 'retention', label: 'Retention', score: 28, n_passing: 32, total: 113, threshold: 'retention_d7 ≥ 30' },
        { key: 'referral', label: 'Referral', score: 21, n_passing: 24, total: 113, threshold: 'happiness ≥ 70' },
        { key: 'revenue', label: 'Revenue', score: 38, n_passing: 43, total: 113, threshold: 'adoption ≥ 50' },
      ],
    },
    // Phase 5 — keep the demo response shape in sync with ScanReport.
    // The function is untyped (the route just `res.json`s it), so
    // tsc won't catch missing fields, but the Compare button reads
    // these directly and renders "(n=)" if undefined.
    survey_response_count: 0,
    survey_reward_available: true,
    human_aggregate_computed: false,
  };
}

export default router;
