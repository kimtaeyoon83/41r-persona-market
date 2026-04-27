import fs from 'node:fs';
import path from 'node:path';
import { Router, type Router as RouterType } from 'express';
import { eq } from 'drizzle-orm';
import { Connection } from '@solana/web3.js';
import { db, schema } from '../db/index.js';
import { startAutoTest, getAutoTestStatus } from '../services/autotest.js';
import { withRequestId } from '../services/anthropic_client.js';
import {
  isEngineEnabled,
  runAutoTestWithEngine,
} from '../services/persona_engine.js';
import { raceWithTimeout, runStagehandHybrid } from '../services/stagehand_hybrid.js';
import { uploadToR2 } from '../services/r2.js';
import { skipPaymentVerify } from '../config/env.js';
import { autotestRunBodySchema, validateBody } from '../schemas/index.js';
import { autotestRunLimiter } from '../middleware/rate-limit.js';
import { scoreChecklist } from '../services/scoring/checklist.js';
import { answerQuestionnaire } from '../services/scoring/questionnaire.js';
import { generateStructuredReport } from '../services/scoring/report.js';
import { computeQualityScore } from '../services/scoring/quality.js';
import { buildPersonaSoul } from '../services/scoring/persona_soul.js';
import type {
  ChecklistResult,
  SessionLog,
} from '../services/scoring/types.js';

const router: RouterType = Router();

const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PLATFORM_WALLET = process.env.X402_RESOURCE_WALLET || '8Vm3ys3kwLSy2qThejn56E2j6fptwSE2qcLkEeiLrdB8';
const AUTOTEST_PRICE_USDC = 0.10;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Verify a USDC transfer on-chain
async function verifyUsdcPayment(txSignature: string): Promise<{ verified: boolean; error?: string }> {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const tx = await connection.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { verified: false, error: 'Transaction not found on-chain' };
    }

    if (tx.meta?.err) {
      return { verified: false, error: 'Transaction failed on-chain' };
    }

    // Check token balance changes for USDC transfer to platform wallet
    const postTokenBalances = tx.meta?.postTokenBalances || [];
    const preTokenBalances = tx.meta?.preTokenBalances || [];

    const platformReceived = postTokenBalances.some((post) => {
      if (post.mint !== USDC_MINT) return false;
      if (post.owner !== PLATFORM_WALLET) return false;

      const pre = preTokenBalances.find(
        (p) => p.accountIndex === post.accountIndex,
      );
      const preAmount = pre ? Number(pre.uiTokenAmount.amount) : 0;
      const postAmount = Number(post.uiTokenAmount.amount);
      const diff = postAmount - preAmount;
      // $0.10 USDC = 100000 smallest units (6 decimals)
      return diff >= AUTOTEST_PRICE_USDC * 1_000_000;
    });

    if (!platformReceived) {
      return { verified: false, error: 'No qualifying USDC transfer to platform wallet found' };
    }

    return { verified: true };
  } catch (err) {
    console.warn('[autotest] Payment verification error:', err instanceof Error ? err.message : err);
    return { verified: false, error: 'Verification failed' };
  }
}

// POST /api/autotest/run — Start an auto test job (x402-gated: $0.10 USDC)
router.post('/run', autotestRunLimiter, validateBody(autotestRunBodySchema), async (req, res) => {
  try {
    const { test_id, persona_id, payment_tx } = req.body;

    // x402-style payment gate
    if (!payment_tx) {
      res.status(402).json({
        error: 'Payment Required',
        x402Version: 1,
        description: 'AI Auto Test requires USDC micropayment',
        accepts: [{
          scheme: 'exact',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          price: `$${AUTOTEST_PRICE_USDC}`,
          currency: 'USDC',
          payTo: PLATFORM_WALLET,
          usdcMint: USDC_MINT,
        }],
      });
      return;
    }

    // Verify payment on-chain (skip in local dev only — forced on in production)
    if (!skipPaymentVerify) {
      const { verified, error: verifyError } = await verifyUsdcPayment(payment_tx);
      if (!verified) {
        res.status(402).json({
          error: 'Payment verification failed',
          details: verifyError,
        });
        return;
      }
    } else {
      console.log(`[autotest] Payment verification skipped (demo mode): ${payment_tx}`);
    }

    console.log(`[autotest] Payment verified: ${payment_tx}`);

    // Mode routing (2026-04-19 default):
    //
    //   mode="browser" | "stagehand_hybrid" | "hybrid" | undefined
    //     → Node-side Stagehand drives the session, persona-engine only
    //       runs the scoring adapters (checklist / questionnaire /
    //       structured_report). Promoted to the default browser path
    //       because it produces noticeably richer pain-point evidence
    //       on complex SPAs where persona_agent's patience budget
    //       trips mid-flow. See comparison notes in the
    //       feature/event-hardening branch.
    //
    //   mode="text"
    //     → persona-engine text mode (LLM-only prediction, no browser).
    //
    //   mode="persona_agent" | "persona_agent_browser"
    //     → legacy persona_agent browser mode kept for persona-fidelity
    //       research (patience budget, soul-driven abandonment). Use
    //       explicitly when the experiment needs that behaviour.
    //
    //   fallback (USE_PERSONA_ENGINE=0)
    //     → legacy startAutoTest pipeline from services/autotest.ts.
    const rawMode = req.body.mode as string | undefined;
    const hybridModeAliases = new Set<string>(['stagehand_hybrid', 'hybrid', 'browser']);
    const personaAgentAliases = new Set<string>(['persona_agent', 'persona_agent_browser']);
    const isHybridMode = rawMode === undefined || hybridModeAliases.has(rawMode);

    if (isHybridMode) {
      try {
        const result = await withRequestId(
          `hybrid:${test_id.slice(0, 8)}:${persona_id.slice(0, 8)}`,
          () => runStagehandHybridAndPersist({ testId: test_id, personaId: persona_id }),
        );
        // Build a `result` nested field that matches the UI's expected
        // shape (AutoTestResult in apps/web/app/autotest/page.tsx). The
        // UI's legacy async path produced this shape via GET /status;
        // the synchronous hybrid path has to return it inline.
        res.json({
          job_id: result.reportId,
          status: 'completed',
          payment_tx,
          engine: true,
          mode: 'stagehand_hybrid',
          report_id: result.reportId,
          outcome: result.outcome,
          quality_score: result.qualityScore,
          screenshots: result.screenshotUrls,
          session_id: result.sessionId,
          result: {
            screenshots: result.screenshotUrls,
            actionLog: [],
            textReport: result.outcome,
            uxFeedback: {},
            steps: [],
            txSignature: payment_tx || '',
          },
        });
        return;
      } catch (hybridErr) {
        console.error('[autotest] stagehand_hybrid failed:', hybridErr);
        res.status(500).json({
          error: 'hybrid_run_failed',
          details: hybridErr instanceof Error ? hybridErr.message : String(hybridErr),
        });
        return;
      }
    }

    if (isEngineEnabled()) {
      // text mode or explicit persona_agent opt-in go through the
      // persona-engine path. Everything else (undefined / "browser")
      // never lands here — the hybrid branch above already returned.
      const mode: 'text' | 'browser' = rawMode === 'text'
        ? 'text'
        : rawMode !== undefined && personaAgentAliases.has(rawMode)
          ? 'browser'
          : 'text';
      try {
        const result = await withRequestId(
          `autotest:${test_id.slice(0, 8)}:${persona_id.slice(0, 8)}`,
          () => runAutoTestAndPersist({ testId: test_id, personaId: persona_id, mode }),
        );
        res.json({
          job_id: result.reportId,
          status: 'completed',
          payment_tx,
          engine: true,
          mode,
          report_id: result.reportId,
          outcome: result.outcome,
          quality_score: result.qualityScore,
          screenshots: result.screenshotUrls,
          session_id: result.sessionId,
          result: {
            screenshots: result.screenshotUrls,
            actionLog: [],
            textReport: result.outcome,
            uxFeedback: {},
            steps: [],
            txSignature: payment_tx || '',
          },
        });
        return;
      } catch (engineErr) {
        console.error('[autotest] engine run failed:', engineErr);
        res.status(500).json({
          error: 'engine_run_failed',
          details: engineErr instanceof Error ? engineErr.message : String(engineErr),
        });
        return;
      }
    }

    const job = await startAutoTest(test_id, persona_id);
    res.json({
      job_id: job.id,
      status: job.status,
      payment_tx,
      message: 'Auto test started. Poll /api/autotest/status/:jobId for updates.',
    });
  } catch (error) {
    console.error('[POST /api/autotest/run]', error);
    res.status(500).json({ error: 'Failed to start auto test' });
  }
});

/**
 * Run a persona-engine-backed autotest and persist the result to
 * ``test_reports``. Mirrors the Stagehand path's write shape so
 * ``/api/reports/compare/:testId`` can treat both sources
 * interchangeably for the AI-vs-human comparison dashboard.
 */
export async function runAutoTestAndPersist(args: {
  testId: string;
  personaId: string;
  mode: 'text' | 'browser';
}): Promise<{
  reportId: string;
  outcome: string;
  qualityScore: number | null;
  screenshotUrls: string[];
  sessionId: string | null;
}> {
  const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, args.testId));
  if (!test) throw new Error(`test ${args.testId} not found`);

  const [persona] = await db.select().from(schema.personas)
    .where(eq(schema.personas.id, args.personaId));
  if (!persona) throw new Error(`persona ${args.personaId} not found`);

  const [tester] = await db.select().from(schema.testers)
    .where(eq(schema.testers.walletAddress, persona.testerAddr));

  // Load the checklist + questionnaire the humans saw, so both paths
  // evaluate the same items (crucial for the dashboard comparison).
  const cases = await db.select().from(schema.testCases)
    .where(eq(schema.testCases.testId, args.testId));
  const checklist = cases
    .filter((c) => c.type === 'checklist')
    .map((c) => c.content as { id: string; task: string; expected?: string });
  const questionnaire = cases
    .filter((c) => c.type === 'questionnaire')
    .map((c) => c.content as {
      id: string;
      question: string;
      type?: 'rating_1_5' | 'rating_1_10' | 'free_text';
    });

  const engineResult = await runAutoTestWithEngine({
    personaId: args.personaId,
    testerProfile: (tester?.profile ?? {}) as Record<string, unknown>,
    url: test.targetUrl,
    task: test.requirements || `Evaluate the UX at ${test.targetUrl}`,
    mode: args.mode,
    checklist,
    questionnaire,
    generateReport: true,
  });

  // Persist to test_reports with isPersonaTest=true so the compare
  // endpoint can partition manual vs persona runs. structured_report +
  // quality_breakdown live in questionnaireAnswers-adjacent jsonb —
  // we store them in scenarioLog.uxFeedback-style convention pending
  // a dedicated column. For MVP, append structured_report into the
  // questionnaire_answers free-text slot under a sentinel id.
  const enrichedAnswers = [
    ...engineResult.questionnaireAnswers,
    ...(Object.keys(engineResult.structuredReport).length > 0
      ? [{ id: '_structured_report', answer: JSON.stringify(engineResult.structuredReport) }]
      : []),
    ...(Object.keys(engineResult.qualityBreakdown).length > 0
      ? [{ id: '_quality_breakdown', answer: JSON.stringify(engineResult.qualityBreakdown) }]
      : []),
  ];

  const [inserted] = await db.insert(schema.testReports).values({
    testerAddr: persona.testerAddr,
    testId: args.testId,
    checklistResults: engineResult.checklistResults.map((r) => ({
      id: r.id, status: r.status, memo: r.memo,
    })),
    scenarioLog: [],
    questionnaireAnswers: enrichedAnswers,
    qualityScore: engineResult.qualityScore,
    isPersonaTest: true,
    screenshots: engineResult.screenshotUrls,
  }).onConflictDoNothing({
    target: [
      schema.testReports.testerAddr,
      schema.testReports.testId,
      schema.testReports.isPersonaTest,
    ],
  }).returning();

  if (!inserted) {
    throw new Error(
      `persona ${args.personaId} already has a report for test ${args.testId}` +
      ` — /reports/compare uses (testerAddr, testId) pairs, pick a different persona`,
    );
  }

  return {
    reportId: inserted.id,
    outcome: engineResult.outcome,
    qualityScore: engineResult.qualityScore,
    screenshotUrls: engineResult.screenshotUrls,
    sessionId: engineResult.sessionId,
  };
}

/**
 * Stagehand-hybrid variant. The browser session itself runs Node-side
 * through Stagehand's agent loop (cheaper than persona_agent's vision
 * pipeline) and we POST the resulting SessionLog to persona-engine's
 * /analyses/score endpoint to get the same
 * {checklist, quality, questionnaire, report} bundle the normal path
 * produces. Net result lands in test_reports with the same shape, so
 * /compare sees hybrid runs uniformly.
 */
/** Belt-and-suspenders ceiling on the whole persist chain. The inner
 *  stagehand has its own 5-min hardcut; each of the 3 scoring LLM calls
 *  is wrapped in 90s (F-B); but R2 upload + DB insert + any unforeseen
 *  await have no individual cap. 12 min is loose enough that a
 *  legitimately slow run (large session log, retried Anthropic 429) can
 *  finish without us mistakenly killing it, but tight enough that a
 *  truly wedged run releases the chain.then() before the operator gives
 *  up and ctrl-Cs the API. */
const PERSIST_HARDCUT_MS = 12 * 60 * 1000;

export async function runStagehandHybridAndPersist(args: {
  testId: string;
  personaId: string;
}): Promise<{
  reportId: string;
  outcome: string;
  qualityScore: number | null;
  screenshotUrls: string[];
  sessionId: string | null;
}> {
  return raceWithTimeout(
    runStagehandHybridAndPersistInner(args),
    PERSIST_HARDCUT_MS,
    `runStagehandHybridAndPersist(${args.personaId.slice(0, 8)})`,
  );
}

async function runStagehandHybridAndPersistInner(args: {
  testId: string;
  personaId: string;
}): Promise<{
  reportId: string;
  outcome: string;
  qualityScore: number | null;
  screenshotUrls: string[];
  sessionId: string | null;
}> {
  const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, args.testId));
  if (!test) throw new Error(`test ${args.testId} not found`);

  const [persona] = await db.select().from(schema.personas)
    .where(eq(schema.personas.id, args.personaId));
  if (!persona) throw new Error(`persona ${args.personaId} not found`);

  const [tester] = await db.select().from(schema.testers)
    .where(eq(schema.testers.walletAddress, persona.testerAddr));

  const cases = await db.select().from(schema.testCases)
    .where(eq(schema.testCases.testId, args.testId));
  const checklist = cases
    .filter((c) => c.type === 'checklist')
    .map((c) => c.content as { id: string; task: string; expected?: string });
  const questionnaire = cases
    .filter((c) => c.type === 'questionnaire')
    .map((c) => c.content as {
      id: string;
      question: string;
      type?: 'rating_1_5' | 'rating_1_10' | 'free_text';
    });

  // Build a terse persona one-liner for Stagehand's systemPrompt —
  // we don't send the whole soul here, the evaluation stage (which
  // runs on persona_agent's side) is where the full persona detail
  // kicks in.
  const profile = (tester?.profile ?? {}) as Record<string, unknown>;
  const personaOneliner = [
    profile.age_range && `${profile.age_range} age`,
    profile.occupation,
    profile.region,
    profile.crypto_experience && `${profile.crypto_experience} crypto`,
    profile.primary_device && `on ${profile.primary_device}`,
  ].filter(Boolean).join(', ') || 'a typical end-user';

  const screenshotsDir = path.resolve(
    process.env.STAGEHAND_SCREENSHOTS_DIR
      || `/tmp/stagehand-shots/${args.testId.slice(0, 8)}-${args.personaId.slice(0, 8)}-${Date.now()}`,
  );

  const { sessionLog, screenshotPaths, framesDir } = await runStagehandHybrid({
    personaId: args.personaId,
    personaOneliner,
    url: test.targetUrl,
    task: test.requirements || `Evaluate the UX at ${test.targetUrl}`,
    screenshotsDir,
    // Phase-based runner: checklist items drive Phase C (one act+screenshot
    // each), persona vector drives Phase D (generated persona-specific
    // exploration). Both are optional; omitting them shrinks the session
    // to discovery + scroll + final.
    checklist,
    personaVector: persona.vector,
  });

  // ── Video replay pipeline (best-effort, non-fatal) ──
  // CDP screencast wrote /tmp/stagehand-frames/<sid>/*.jpg. ffmpeg encodes
  // → 854×480 @ 5fps webm → R2. Failure at any step (no ffmpeg, zero
  // frames, R2 down) just skips the sentinel — the report still ships.
  let videoSentinel: { id: string; answer: string } | undefined;
  if (framesDir) {
    try {
      const { transcodeFramesToWebm } = await import('../services/video.js');
      const localWebm = `/tmp/stagehand-videos/${sessionLog.session_id}.webm`;
      const encoded = await transcodeFramesToWebm(framesDir, localWebm);
      if (encoded) {
        const bytes = fs.readFileSync(encoded);
        const key = `replays/stagehand_${sessionLog.session_id}.webm`;
        const url = await uploadToR2(key, bytes, 'video/webm');
        videoSentinel = {
          id: '_session_video',
          answer: JSON.stringify({
            url,
            sizeBytes: bytes.length,
            durationSec: sessionLog.duration_sec,
            width: 854,
            height: 480,
            fps: 5,
          }),
        };
        // Cleanup local webm — already uploaded.
        try { fs.unlinkSync(encoded); } catch { /* non-fatal */ }
      }
    } catch (err) {
      console.warn(`[hybrid] video pipeline failed for ${sessionLog.session_id}:`,
        err instanceof Error ? err.message : err);
    }
  }

  // Best-effort screenshot upload to R2. If that fails we still
  // record the local fs paths so the report is at least inspectable
  // locally.
  const screenshotUrls: string[] = [];
  for (const p of screenshotPaths) {
    try {
      const bytes = fs.readFileSync(p);
      const key = `screenshots/stagehand_${sessionLog.session_id}_${path.basename(p)}`;
      const url = await uploadToR2(key, bytes);
      screenshotUrls.push(url);
    } catch (err) {
      console.warn(`[hybrid] r2 upload failed for ${p}:`, err instanceof Error ? err.message : err);
      screenshotUrls.push(p);
    }
  }

  // In-process scoring (previously: POST /analyses/score to persona-engine
  // Python service). The adapters + quality math live at services/scoring/*
  // now — see 2026-04-22 TS port. This removes the cross-language boundary
  // that produced schema-contract drift and lets us iterate on the prompts
  // alongside the browser runner.
  const soulText = buildPersonaSoul({ persona: { id: persona.id, vector: persona.vector }, tester });

  const typedSessionLog = sessionLog as unknown as SessionLog;
  // Each scoring step is a single LLM call (Sonnet/Haiku). The SDK
  // does its own retries on transient 429/503, but a hung connection
  // or stalled stream has no upper bound — observed indirectly today
  // when the example.com chain didn't progress past structured_report
  // for one persona. 90s comfortably covers a 16k-token Sonnet output;
  // anything longer is almost certainly a hang and the run should
  // fail-fast so the next persona in the chain can proceed.
  const SCORING_TIMEOUT_MS = 90_000;
  const checklistResults: ChecklistResult[] = checklist.length > 0
    ? await raceWithTimeout(
        scoreChecklist({ checklist, sessionLog: typedSessionLog }),
        SCORING_TIMEOUT_MS,
        `scoreChecklist(${args.personaId.slice(0, 8)})`,
      )
    : [];
  const questionnaireAnswers = questionnaire.length > 0
    ? await raceWithTimeout(
        answerQuestionnaire({ questionnaire, sessionLog: typedSessionLog, soulText }),
        SCORING_TIMEOUT_MS,
        `answerQuestionnaire(${args.personaId.slice(0, 8)})`,
      )
    : [];
  const structuredReport = await raceWithTimeout(
    generateStructuredReport({
      sessionLog: typedSessionLog,
      personaId: args.personaId,
      checklistResults,
    }),
    SCORING_TIMEOUT_MS,
    `generateStructuredReport(${args.personaId.slice(0, 8)})`,
  );
  const qualityBreakdown = computeQualityScore({
    sessionLog: typedSessionLog,
    checklistResults,
  });

  const enrichedAnswers = [
    ...questionnaireAnswers,
    { id: '_structured_report', answer: JSON.stringify(structuredReport) },
    { id: '_quality_breakdown', answer: JSON.stringify(qualityBreakdown) },
    { id: '_source', answer: 'stagehand_hybrid' },
    // Browser-quirk hits from the run — auth_wall, cookie_consent, etc.
    // Stored as a JSON sentinel so the diagnosis aggregator can sum
    // across sessions without a schema change. See browser_quirks/.
    ...((sessionLog as { quirks?: Record<string, number> }).quirks
      ? [{ id: '_quirks', answer: JSON.stringify((sessionLog as { quirks: Record<string, number> }).quirks) }]
      : []),
    // Captured error from a session-terminating throw (or zero-turn
    // collapse). Lets RCA queries group failures by phase / last_action
    // / message without re-running the persona. Pattern mirrors _quirks.
    ...((sessionLog as { session_error?: unknown }).session_error
      ? [{ id: '_session_error', answer: JSON.stringify((sessionLog as { session_error: unknown }).session_error) }]
      : []),
    // CDP screencast → ffmpeg → R2 webm URL. Only present when the full
    // video pipeline succeeded (ffmpeg installed, frames captured, R2 up).
    // Front-end gates on `_session_video` to render the <video> player.
    ...(videoSentinel ? [videoSentinel] : []),
  ];

  const [inserted] = await db.insert(schema.testReports).values({
    testerAddr: persona.testerAddr,
    testId: args.testId,
    checklistResults: checklistResults.map((r) => ({
      id: r.id, status: r.status, memo: r.memo,
    })),
    scenarioLog: [],
    questionnaireAnswers: enrichedAnswers,
    qualityScore: qualityBreakdown.quality_score,
    isPersonaTest: true,
    sourceMode: 'stagehand_hybrid',
    screenshots: screenshotUrls,
  }).onConflictDoNothing({
    target: [
      schema.testReports.testerAddr,
      schema.testReports.testId,
      schema.testReports.isPersonaTest,
      schema.testReports.sourceMode,
    ],
  }).returning();

  if (!inserted) {
    throw new Error(
      `persona ${args.personaId} already has a stagehand_hybrid report for test ${args.testId}`,
    );
  }

  return {
    reportId: inserted.id,
    outcome: sessionLog.outcome,
    qualityScore: qualityBreakdown.quality_score,
    screenshotUrls,
    sessionId: sessionLog.session_id,
  };
}

// GET /api/autotest/status/:jobId — Get job status
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = getAutoTestStatus(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      report_id: job.reportId,
      error: job.error,
      result: job.status === 'completed' ? job.result : undefined,
    });
  } catch (error) {
    console.error('[GET /api/autotest/status]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
