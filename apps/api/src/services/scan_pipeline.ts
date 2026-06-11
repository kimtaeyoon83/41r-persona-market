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
import { refundScanDebit } from './credits.js';
import { sendScanCompleteEmail } from './email.js';
import { logger } from '../logger.js';
import {
  type CohortFit,
  type PersonaDimensionScores,
  bootstrapCohortFitCI,
  computeAudienceFit,
  computeCohortFitScore,
  meanDimensions,
} from './audience_fit.js';
import {
  selectPersonasForAudience,
  selectPersonasForCohorts,
  type PersonaRow,
} from './cohort_selection.js';
import { parseAudience } from './dimensions/audience_parser.js';
import { simulatePersonaResponse, type SimulatedResponse } from './dimension_simulator.js';
import {
  runPersonaResponseLLM,
  extractVoiceQuotes,
  type SiteContext,
} from './dimensions/llm.js';
import { clusterFrictions } from './dimensions/frictions.js';
import { captureSite } from './site_capture.js';
import { classifySite } from './site_classifier.js';
import { generateCustomQuestions } from './dimensions/custom_questions.js';

const log = logger.child({ service: 'scan_pipeline' });

// Per-persona artificial delay so the simulator pipeline streams
// visibly to the polling client. Phase 1C (real Sonnet vision call)
// will replace this with the natural ~3-5s LLM latency per persona.
//
// In dev: defaults to 50ms (~5-6s for a 100+ persona scan) so the
// /validator/report polling client visibly fills in cohort cards as
// rows land. In production: defaults to 0 — Phase 1C's LLM latency
// is the real source of streaming once that ships.
//
// Override with SIM_PERSONA_DELAY_MS=<n> in the env if needed.
const SIM_PERSONA_DELAY_MS = (() => {
  const explicit = process.env.SIM_PERSONA_DELAY_MS;
  if (explicit !== undefined && explicit !== '') return Number(explicit);
  return process.env.NODE_ENV === 'production' ? 0 : 50;
})();

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

// ─── Dispatch: simulator vs real LLM ──────────────────────────────
// USE_SIMULATOR=1 → deterministic stub (no LLM cost, ~6s end-to-end)
// USE_SIMULATOR=0 → real Haiku call (~$0.001/persona, ~$0.11/scan)
//
// Defaults: dev → simulator (cheap iteration); prod → real LLM.
// Override per-process via env. Per-scan override is a Phase 1C-B
// concern (ScanRequest.engine field).
const USE_SIMULATOR = (() => {
  const explicit = process.env.USE_SIMULATOR;
  if (explicit !== undefined && explicit !== '') return explicit !== '0';
  return process.env.NODE_ENV !== 'production';
})();

// Concurrent persona requests for the LLM path. Sequential simulator
// stays single-threaded (it's faster than connection setup overhead).
const SCAN_CONCURRENCY = Math.max(
  1,
  Number(process.env.SCAN_CONCURRENCY ?? 5)
);

// Vision mode — when true, capture the site once and pass screenshot
// URLs to runPersonaResponseLLM (Sonnet vision, ~$0.05/persona).
// When false, persona LLM stays on Haiku text (~$0.001/persona).
// Capture itself always runs when not in simulator mode (cheap, ~5¢)
// so the URLs are available for opt-in vision later.
const USE_VISION = (() => {
  const explicit = process.env.USE_VISION;
  if (explicit !== undefined && explicit !== '') return explicit !== '0';
  return false; // default off — vision is the expensive opt-in
})();

// Promise pool — runs `fn(item)` for each item with at most
// `concurrency` in flight. Maintains insertion order for results
// when present, but here we don't need the return values (each
// callback writes to DB and updates running counters by closure).
async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (next === undefined) break;
          await fn(next);
        }
      })()
    );
  }
  await Promise.all(workers);
}

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
      await refundScanDebit(scanId);
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

  // Step 0 — capturing. Only runs on real-LLM path (simulator
  // doesn't need screenshots). Failure is non-fatal; pipeline
  // continues without screenshots and falls back to text-only.
  let screenshotUrls: string[] = [];
  if (!USE_SIMULATOR) {
    await setStatus(scanId, 'capturing');
    try {
      const cap = await captureSite(targetUrl);
      screenshotUrls = cap.urls;
      await db
        .update(schema.audienceFitScans)
        .set({
          captureScreenshotUrls: screenshotUrls,
          captureCompletedAt: cap.capturedAt,
          captureSignals: cap.signals ?? null,
        })
        .where(eq(schema.audienceFitScans.id, scanId));
      // Refresh local copy (same pattern as category below) so the
      // Mode A/B persona handlers can thread pageFacts into prompts.
      scan.captureSignals = cap.signals ?? null;
      log.info(
        { scanId, urls: screenshotUrls.length, fromCache: cap.fromCache },
        'site capture complete'
      );

      // Classify the captured page once, persist immediately so the
      // report header shows real category + pitch even while the
      // persona-response loop is still running. Null result leaves
      // the row's existing nulls — the report card hides empty pitch
      // and the benchmark card hides when category is null.
      const cls = await classifySite(targetUrl, screenshotUrls);
      if (cls) {
        await db
          .update(schema.audienceFitScans)
          .set({
            category: cls.category,
            categoryConfidence: cls.category_confidence,
            oneLinePitch: cls.one_line_pitch,
          })
          .where(eq(schema.audienceFitScans.id, scanId));
        // Refresh local copy so downstream Mode A/B branches see the
        // values they just persisted (pipeline reads `scan` from the
        // top-level query, never re-fetched).
        scan.category = cls.category;
        scan.categoryConfidence = cls.category_confidence;
        scan.oneLinePitch = cls.one_line_pitch;
        log.info(
          { scanId, category: cls.category, conf: cls.category_confidence },
          'site classified',
        );
      }

      // Phase 5 — Generate site-specific human-survey questions.
      // Independent of cls success: even when classification was
      // null we can still draft questions from screenshot + URL,
      // they just won't include category context. Failure path
      // leaves the column null and the survey UI skips the section.
      const customQs = await generateCustomQuestions({
        targetUrl,
        category: scan.category,
        oneLinePitch: scan.oneLinePitch,
        screenshotUrls,
      });
      if (customQs && customQs.length > 0) {
        await db
          .update(schema.audienceFitScans)
          .set({ customQuestions: customQs })
          .where(eq(schema.audienceFitScans.id, scanId));
        log.info(
          { scanId, n: customQs.length },
          'custom survey questions generated',
        );
      }
    } catch (err) {
      log.warn(
        { scanId, err: err instanceof Error ? err.message : 'unknown' },
        'site capture failed — falling back to text-only',
      );
    }
  }

  // Step 1 — sampling.
  await setStatus(scanId, 'sampling');
  const personas = await db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.isActive, true));

  // Mode B branch — single audience, no cohort distribution.
  if (scan.mode === 'B') {
    return runModeBPipeline({
      scanId,
      scan,
      personas,
      targetUrl,
      hypothesis,
      screenshotUrls,
    });
  }

  // Mode A optional cohort restriction — filter STANDARD_COHORTS to
  // the user-selected subset before assignment. Unknown ids are
  // dropped silently. Empty filter (or null) = run all 8.
  const cohortFilter = scan.targetCohorts;
  const cohortDefs =
    cohortFilter && cohortFilter.length > 0
      ? STANDARD_COHORTS.filter((c) => cohortFilter.includes(c.id))
      : STANDARD_COHORTS;
  if (cohortDefs.length === 0) {
    await setStatus(scanId, 'failed');
    log.warn(
      { scanId, requested: cohortFilter },
      'target_cohorts filter matched zero standard cohorts',
    );
    return;
  }

  const { assignments, unassigned } = selectPersonasForCohorts(
    personas,
    cohortDefs,
  );
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
      cohortsRunning: cohortDefs.map((c) => c.id),
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
  let totalErrored = 0;
  let totalCostUsd = 0;

  log.info(
    {
      scanId,
      engine: USE_SIMULATOR
        ? 'simulator'
        : USE_VISION && screenshotUrls.length > 0
          ? 'sonnet-vision'
          : 'haiku-text',
      concurrency: SCAN_CONCURRENCY,
      screenshots: screenshotUrls.length,
    },
    'starting persona responses'
  );

  // Build the flat work list with cohort tags + initialise buckets.
  type WorkItem = { persona: PersonaRow; cohortId: string };
  const work: WorkItem[] = [];
  for (const [cohortId, cohortPersonas] of assignments) {
    if (cohortPersonas.length === 0) continue;
    cohortBuckets.set(cohortId, []);
    for (const persona of cohortPersonas) work.push({ persona, cohortId });
  }
  totalAttempted = work.length;

  // Per-persona handler. runPersonaAndPersist swallows LLM errors
  // (recorded as a flagged row) so one bad persona doesn't sink the
  // entire scan. We update counters + cohort buckets from its result.
  // personas_completed = produced a VALID (non-flagged) response so
  // the invariant `attempted = completed + flagged` holds.
  const handle = async ({ persona, cohortId }: WorkItem): Promise<void> => {
    const r = await runPersonaAndPersist({
      scanId,
      persona,
      cohortId,
      targetUrl,
      hypothesis,
      screenshotUrls,
      siteContext: {
        category: scan.category,
        categoryConfidence: scan.categoryConfidence,
        oneLinePitch: scan.oneLinePitch,
        pageFacts: pageFactsFrom(scan.captureSignals),
      },
    });
    if (r.errored) totalErrored += 1;
    if (r.flagged) totalFlagged += 1;
    if (r.bucketEntry) {
      cohortBuckets.get(cohortId)!.push(r.bucketEntry);
      if (!r.bucketEntry.flagged) totalCompleted += 1;
    }
    totalCostUsd += r.costUsd;
  };

  if (USE_SIMULATOR) {
    // Sequential — simulator is faster than connection setup overhead
    // and we want the artificial delay to space writes evenly.
    for (const item of work) await handle(item);
  } else {
    // Real LLM — parallel batched.
    await runWithConcurrency(work, SCAN_CONCURRENCY, handle);
  }

  log.info(
    {
      scanId,
      attempted: totalAttempted,
      completed: totalCompleted,
      flagged: totalFlagged,
      errored: totalErrored,
      costUsd: totalCostUsd.toFixed(4),
    },
    'persona responses done'
  );

  // Step 3 — aggregating.
  await setStatus(scanId, 'aggregating');
  const cohortFits: CohortFit[] = [];

  // Aggregate only the cohorts the scan actually ran. When a target
  // filter is set, the un-selected standard cohorts have no rows and
  // should not appear in the cohort_results table at all.
  for (const cohortDef of cohortDefs) {
    const bucket = cohortBuckets.get(cohortDef.id) ?? [];
    const agg = await persistCohortAggregate({
      scanId,
      cohortId: cohortDef.id,
      cohortLabel: cohortDef.label,
      nTarget: cohortDef.target_n,
      bucket,
    });
    if (agg) {
      cohortFits.push({
        cohort_id: agg.cohortId,
        cohort_label: agg.cohortLabel,
        n_completed: agg.nCompleted,
        dimension_means: agg.dimMeans,
        cohort_fit_score: agg.cohortFitScore,
      });
    }
  }

  if (cohortFits.length === 0) {
    await setStatus(scanId, 'failed');
    log.warn({ scanId }, 'no cohort produced valid scores');
    return;
  }

  const result = computeAudienceFit(cohortFits);

  // Step 3.5 — friction clustering (real-LLM path only). Simulator
  // doesn't write voice columns, so there's nothing to cluster.
  // Failure is non-fatal: report falls back to the placeholder
  // cohort-derived frictions in routes/scan.ts.
  await tryClusterFrictions(scanId);

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
      totalCostUsd: totalCostUsd,
      // category/categoryConfidence/oneLinePitch are written during
      // the 'capturing' step by classifySite() and intentionally NOT
      // overwritten here — that earlier write is the source of truth.
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
  notifyScanComplete(scanId, result.best.cohort_label, result.audience_fit_score);
}

// ─── Mode B: single-audience pipeline ────────────────────────────
// Skips the 8-cohort distribution. Parses the audience text into a
// CohortSelector, picks up to MODE_B_TARGET_N personas matching it,
// runs the same per-persona LLM, persists ONE scan_cohort_results
// row tagged "custom_audience", computes pass/fail verdict from the
// resulting cohort_fit_score.
const MODE_B_TARGET_N = 50;

async function runModeBPipeline(args: {
  scanId: string;
  scan: typeof schema.audienceFitScans.$inferSelect;
  personas: PersonaRow[];
  targetUrl: string;
  hypothesis: string | undefined;
  screenshotUrls: string[];
}): Promise<void> {
  const { scanId, scan, personas, targetUrl, hypothesis, screenshotUrls } = args;
  const audienceText = scan.targetAudienceText ?? '';

  // Parse natural-language audience → selector.
  const parsed = await parseAudience(audienceText);
  log.info(
    { scanId, audience: parsed.label, isFallback: parsed.isFallback },
    'audience parsed'
  );

  const picked = selectPersonasForAudience(personas, parsed.selector, MODE_B_TARGET_N);
  log.info(
    { scanId, pool: personas.length, picked: picked.length, target: MODE_B_TARGET_N },
    'mode B persona pick complete'
  );

  if (picked.length === 0) {
    await db
      .update(schema.audienceFitScans)
      .set({
        status: 'failed',
        modeBParsedSelector: parsed.selector,
      })
      .where(eq(schema.audienceFitScans.id, scanId));
    log.warn({ scanId }, 'mode B: no personas matched parsed selector');
    return;
  }

  // Step 2 — responding (single bucket).
  await setStatus(scanId, 'responding');
  const bucket: Array<{
    persona: PersonaRow;
    scores: PersonaDimensionScores;
    flagged: boolean;
  }> = [];
  let attempted = 0;
  let completed = 0;
  let flagged = 0;
  let errored = 0;
  let totalCostUsd = 0;
  const cohortId = 'custom_audience';

  log.info(
    {
      scanId,
      engine: USE_SIMULATOR
        ? 'simulator'
        : USE_VISION && screenshotUrls.length > 0
          ? 'sonnet-vision'
          : 'haiku-text',
      concurrency: SCAN_CONCURRENCY,
    },
    'mode B starting persona responses'
  );

  const handle = async (persona: PersonaRow): Promise<void> => {
    attempted += 1;
    const r = await runPersonaAndPersist({
      scanId,
      persona,
      cohortId,
      targetUrl,
      hypothesis,
      screenshotUrls,
      siteContext: {
        category: scan.category,
        categoryConfidence: scan.categoryConfidence,
        oneLinePitch: scan.oneLinePitch,
        pageFacts: pageFactsFrom(scan.captureSignals),
      },
    });
    if (r.errored) errored += 1;
    if (r.flagged) flagged += 1;
    if (r.bucketEntry) {
      bucket.push(r.bucketEntry);
      // Same invariant as Mode A — completed counts only non-flagged.
      if (!r.bucketEntry.flagged) completed += 1;
    }
    totalCostUsd += r.costUsd;
  };

  if (USE_SIMULATOR) {
    for (const p of picked) await handle(p);
  } else {
    await runWithConcurrency(picked, SCAN_CONCURRENCY, handle);
  }

  log.info(
    { scanId, attempted, completed, flagged, errored, costUsd: totalCostUsd.toFixed(4) },
    'mode B persona responses done'
  );

  // Step 3 — aggregating (single bucket).
  await setStatus(scanId, 'aggregating');
  const agg = await persistCohortAggregate({
    scanId,
    cohortId,
    cohortLabel: parsed.label,
    nTarget: MODE_B_TARGET_N,
    bucket,
  });

  if (!agg) {
    await db
      .update(schema.audienceFitScans)
      .set({
        status: 'failed',
        modeBParsedSelector: parsed.selector,
      })
      .where(eq(schema.audienceFitScans.id, scanId));
    log.warn({ scanId }, 'mode B: no valid scores');
    return;
  }

  const { dimMeans, cohortFitScore } = agg;

  // Step 3.5 — friction clustering (LLM path only).
  await tryClusterFrictions(scanId);

  // Pass/Fail verdict per spec §1.3:
  //   ≥60 = pass | 40-60 = conditional | <40 = fail
  const verdict =
    cohortFitScore >= 60 ? 'pass' : cohortFitScore >= 40 ? 'conditional' : 'fail';

  // Step 4 — completed.
  await db
    .update(schema.audienceFitScans)
    .set({
      status: 'completed',
      // Mode B: audience_fit_score = cohort_fit_score (single bucket).
      audienceFitScore: cohortFitScore,
      bestCohortId: cohortId,
      bestCohortScore: cohortFitScore,
      medianCohortScore: cohortFitScore,
      worstCohortId: cohortId,
      worstCohortScore: cohortFitScore,
      globalTaskSuccessAvg: dimMeans.task_success,
      globalSentimentAvg: dimMeans.happiness,
      personasAttempted: attempted,
      personasCompleted: completed,
      personasFlagged: flagged,
      totalCostUsd,
      category: scan.category,
      categoryConfidence: scan.categoryConfidence,
      weightsVersion: 'v1.0',
      modeBVerdict: verdict,
      modeBParsedSelector: parsed.selector,
      completedAt: new Date(),
    })
    .where(eq(schema.audienceFitScans.id, scanId));

  log.info(
    { scanId, cohortFitScore: cohortFitScore.toFixed(2), verdict, audience: parsed.label },
    'mode B scan completed'
  );
  notifyScanComplete(scanId, parsed.label ?? null, cohortFitScore);
}

// Scan-complete notification (Console S2, retention loop #1 — §6).
// Fire-and-forget: looks up the owner's email and sends the report
// link. Anonymous scans (userId null) and users without an email are
// silently skipped; email.ts itself no-ops without RESEND_API_KEY.
function notifyScanComplete(
  scanId: string,
  bestCohortLabel: string | null,
  audienceFitScore: number | null,
): void {
  void (async () => {
    try {
      const [scan] = await db
        .select({
          userId: schema.audienceFitScans.userId,
          targetUrl: schema.audienceFitScans.targetUrl,
        })
        .from(schema.audienceFitScans)
        .where(eq(schema.audienceFitScans.id, scanId));
      if (!scan?.userId) return;
      const [user] = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, scan.userId));
      if (!user?.email) return;
      await sendScanCompleteEmail({
        to: user.email,
        targetUrl: scan.targetUrl,
        scanId,
        bestCohortLabel,
        audienceFitScore,
      });
    } catch (err) {
      log.warn({ scanId, err }, 'scan-complete notify failed (non-fatal)');
    }
  })();
}

async function setStatus(scanId: string, status: string): Promise<void> {
  await db
    .update(schema.audienceFitScans)
    .set({ status })
    .where(eq(schema.audienceFitScans.id, scanId));
  // Failed scan → give the credits back (idempotent, no-op for
  // anonymous demo scans that never had a debit). All pipeline failure
  // paths call setStatus('failed'), so this is the single choke point;
  // the worker crash handler in startScanWorker covers the rest.
  if (status === 'failed') await refundScanDebit(scanId);
}

type DCurve = { d1: number; d3: number; d7: number; d30: number };

// Reverse-map a D-7 score back to its source band's full D-curve so
// the cohort aggregate D-curve has all four numbers, not just D-7.
// Phase 1C will pass the full D-curve through directly.
function simulateRetentionDCurveFromD7(d7: number): DCurve {
  if (d7 >= 55) return { d1: 85, d3: 70, d7: 55, d30: 30 };
  if (d7 >= 30) return { d1: 70, d3: 50, d7: 30, d30: 10 };
  if (d7 >= 5) return { d1: 40, d3: 15, d7: 5, d30: 1 };
  return { d1: 5, d3: 1, d7: 0, d30: 0 };
}

// Snake-case DB jsonb → camelCase SiteContext.pageFacts. Null-safe so
// legacy scans (capture_signals = null) keep the pre-2026-06-10
// prompt byte-identical.
function pageFactsFrom(
  sig: (typeof schema.audienceFitScans.$inferSelect)['captureSignals'],
): SiteContext['pageFacts'] {
  if (!sig) return null;
  return {
    visibleWordCount: sig.visible_word_count,
    linkCount: sig.link_count,
    ctaCount: sig.cta_count,
    navMenuLabels: sig.nav_menu_labels ?? [],
    popupDetected: sig.popup_detected,
    loginWall: sig.login_wall,
  };
}

function avgDCurve(curves: readonly DCurve[]): DCurve {
  const n = curves.length || 1;
  return {
    d1: curves.reduce((s, c) => s + c.d1, 0) / n,
    d3: curves.reduce((s, c) => s + c.d3, 0) / n,
    d7: curves.reduce((s, c) => s + c.d7, 0) / n,
    d30: curves.reduce((s, c) => s + c.d30, 0) / n,
  };
}

// Wraps the friction-clustering call so both Mode A and Mode B share
// one error-handling path. Real-LLM only — simulator doesn't write
// voice columns. Failure is non-fatal: caller continues with the
// placeholder cohort-derived frictions in routes/scan.ts.
async function tryClusterFrictions(scanId: string): Promise<void> {
  if (USE_SIMULATOR) return;
  try {
    await clusterFrictions(scanId);
  } catch (err) {
    log.warn(
      { scanId, err: err instanceof Error ? err.message : 'unknown' },
      'friction clustering threw — continuing',
    );
  }
}

// ─── Per-persona LLM/simulator + DB write ────────────────────────
// Catches LLM/simulator errors so one bad persona doesn't sink the
// scan. Returns the bucket entry (or null on error) plus accounting
// fields so the caller updates its counters correctly.
type VoiceQuotes = {
  voiceFirstImpression: string | null;
  voiceFriction: string | null;
  voiceBiggestFriction: string | null;
  voiceWouldReturnBecause: string | null;
};

type PersonaBucketEntry = {
  persona: PersonaRow;
  scores: PersonaDimensionScores;
  flagged: boolean;
};

type PersonaPersistResult = {
  bucketEntry: PersonaBucketEntry | null; // null when LLM errored
  costUsd: number;
  errored: boolean;
  flagged: boolean; // true when errored OR sim.is_flagged
};

async function runPersonaAndPersist(args: {
  scanId: string;
  persona: PersonaRow;
  cohortId: string;
  targetUrl: string;
  hypothesis: string | undefined;
  screenshotUrls: string[];
  siteContext: SiteContext;
}): Promise<PersonaPersistResult> {
  const { scanId, persona, cohortId, targetUrl, hypothesis, screenshotUrls, siteContext } = args;
  let sim: SimulatedResponse | null = null;
  let voice: VoiceQuotes = {
    voiceFirstImpression: null,
    voiceFriction: null,
    voiceBiggestFriction: null,
    voiceWouldReturnBecause: null,
  };
  let costUsd = 0;
  let latencyMs = 0;
  let llmErr: string | null = null;

  try {
    if (USE_SIMULATOR) {
      sim = simulatePersonaResponse(persona, targetUrl, hypothesis);
      await sleep(SIM_PERSONA_DELAY_MS);
    } else {
      // Pass screenshots only when vision is enabled — otherwise stay
      // on cheap Haiku text path even if capture succeeded.
      const result = await runPersonaResponseLLM(
        persona,
        targetUrl,
        hypothesis,
        USE_VISION ? screenshotUrls : undefined,
        siteContext,
      );
      sim = result.sim;
      voice = extractVoiceQuotes(result.parsed);
      costUsd = result.llmCostUsd;
      latencyMs = result.llmLatencyMs;
    }
  } catch (e) {
    llmErr = e instanceof Error ? e.message.slice(0, 400) : 'unknown';
    log.warn({ scanId, personaId: persona.id, err: llmErr }, 'persona response failed');
  }

  if (!sim) {
    // LLM error or schema rejection — record a flagged row so we
    // don't silently lose the persona. Cohort aggregator skips
    // flagged rows.
    await db.insert(schema.scanPersonaResponses).values({
      scanId,
      personaId: persona.id,
      cohortId,
      rawResponse: { error: llmErr },
      happinessScore: null,
      engagementScore: null,
      adoptionScore: null,
      retentionD7: null,
      taskSuccessScore: null,
      retentionDCurve: null,
      voiceFirstImpression: null,
      voiceFriction: null,
      voiceBiggestFriction: null,
      voiceWouldReturnBecause: null,
      isFlagged: true,
      flagReason: llmErr ?? 'no response',
      llmCostUsd: 0,
      llmLatencyMs: latencyMs,
    });
    return { bucketEntry: null, costUsd: 0, errored: true, flagged: true };
  }

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
    voiceFirstImpression: voice.voiceFirstImpression,
    voiceFriction: voice.voiceFriction,
    voiceBiggestFriction: voice.voiceBiggestFriction,
    voiceWouldReturnBecause: voice.voiceWouldReturnBecause,
    isFlagged: sim.is_flagged,
    flagReason: sim.flag_reason,
    llmCostUsd: costUsd,
    llmLatencyMs: latencyMs,
  });

  return {
    bucketEntry: { persona, scores: sim.scores, flagged: sim.is_flagged },
    costUsd,
    errored: false,
    flagged: sim.is_flagged,
  };
}

// ─── Cohort aggregation + DB row ─────────────────────────────────
// Both Mode A (per-cohort loop) and Mode B (single bucket) compute
// the same shape: dim means → cohort_fit_score → bootstrap CI →
// D-curve mean → INSERT scan_cohort_results. Returns null when the
// bucket has no valid (non-flagged) scores — caller skips that
// cohort from synthesis input.
type CohortAggregate = {
  cohortId: string;
  cohortLabel: string;
  nCompleted: number;
  dimMeans: PersonaDimensionScores;
  cohortFitScore: number;
};

async function persistCohortAggregate(args: {
  scanId: string;
  cohortId: string;
  cohortLabel: string;
  nTarget: number;
  bucket: readonly PersonaBucketEntry[];
}): Promise<CohortAggregate | null> {
  const { scanId, cohortId, cohortLabel, nTarget, bucket } = args;
  const validScores = bucket.filter((b) => !b.flagged).map((b) => b.scores);

  if (validScores.length === 0) {
    // Empty / fully flagged cohort: persist a row showing under-quota
    // for the UI but skip from synthesis input.
    await db.insert(schema.scanCohortResults).values({
      scanId,
      cohortId,
      cohortLabel,
      nTarget,
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
    return null;
  }

  const dimMeans = meanDimensions(validScores);
  const cohortFitScore = computeCohortFitScore(dimMeans);
  const bootstrapCi = bootstrapCohortFitCI(validScores);
  const dMean = avgDCurve(
    validScores.map((s) => simulateRetentionDCurveFromD7(s.retention_d7)),
  );

  await db.insert(schema.scanCohortResults).values({
    scanId,
    cohortId,
    cohortLabel,
    nTarget,
    nCompleted: validScores.length,
    nFlagged: bucket.length - validScores.length,
    happinessMean: dimMeans.happiness,
    engagementMean: dimMeans.engagement,
    adoptionMean: dimMeans.adoption,
    retentionMean: dimMeans.retention_d7,
    taskSuccessMean: dimMeans.task_success,
    cohortFitScore,
    cohortFitCiLow: bootstrapCi.low,
    cohortFitCiHigh: bootstrapCi.high,
    retentionDCurve: dMean,
  });

  return {
    cohortId,
    cohortLabel,
    nCompleted: validScores.length,
    dimMeans,
    cohortFitScore,
  };
}
