import { Router, type Router as RouterType } from 'express';
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { PersonaVector } from '@41rpm/shared';
import { db, schema } from '../db/index.js';
import { generateTestCases } from '../services/llm.js';
import {
  registerTestBodySchema,
  retryAutotestBodySchema,
  generateDiagnosisBodySchema,
  validateBody,
} from '../schemas/index.js';
import { requireSignedRequest } from '../middleware/auth.js';
import { llmGenerateLimiter } from '../middleware/rate-limit.js';

const router: RouterType = Router();

// POST /api/test/register — Create a new test with AI-generated test cases
router.post('/register', llmGenerateLimiter, requireSignedRequest, validateBody(registerTestBodySchema), async (req, res) => {
  try {
    const { target_url, requirements, budget_usdc, reward_per_tester, company_wallet, deposit_tx_signature, enable_auto_test } = req.body;

    const signedWallet = (req as unknown as { signedWallet: string }).signedWallet;
    if (signedWallet !== company_wallet) {
      res.status(403).json({ error: 'signed wallet does not match company_wallet' });
      return;
    }

    // Ensure company exists (upsert)
    const existing = await db.select().from(schema.companies).where(eq(schema.companies.walletAddress, company_wallet));
    if (existing.length === 0) {
      await db.insert(schema.companies).values({
        walletAddress: company_wallet,
        companyName: `Company ${company_wallet.slice(0, 8)}`,
      });
    }

    // Create test
    const [test] = await db.insert(schema.tests).values({
      companyAddr: company_wallet,
      targetUrl: target_url,
      requirements: requirements || '',
      budgetUsdc: budget_usdc || 50,
      rewardPerTester: reward_per_tester ?? 3,
      depositTxSignature: deposit_tx_signature || null,
      status: 'pending',
    }).returning();

    // Generate test cases using LLM
    // TODO: Add screenshot capture via Stagehand before LLM call
    let testCasesData;
    try {
      testCasesData = await generateTestCases(target_url, requirements || '');
    } catch (llmError) {
      console.error('[LLM] Test case generation failed, using fallback:', llmError);
      // Fallback test cases
      testCasesData = {
        checklist: [
          { id: 'CL01', task: 'Load the main page and verify no console errors', expected: 'Page loads fully without errors within 3 seconds' },
          { id: 'CL02', task: 'Check all navigation links in header and footer', expected: 'All links navigate to correct pages without 404s' },
          { id: 'CL03', task: 'Test responsive layout at mobile viewport (375px)', expected: 'Content reflows properly, no horizontal scroll, tap targets are adequate' },
          { id: 'CL04', task: 'Submit the primary form with valid data', expected: 'Form submits successfully with confirmation feedback' },
          { id: 'CL05', task: 'Submit the primary form with empty/invalid data', expected: 'Validation errors shown clearly next to relevant fields' },
          { id: 'CL06', task: 'Check loading states during async operations', expected: 'Spinner or skeleton UI shown during data fetching' },
          { id: 'CL07', task: 'Navigate to a non-existent page', expected: 'Custom 404 page displayed with link back to home' },
          { id: 'CL08', task: 'Check visual consistency of typography and spacing', expected: 'Consistent font sizes, line heights, and padding throughout' },
        ],
        scenarios: [
          { id: 'SC01', persona_type: 'First-Time Visitor', narrative: 'As a first-time visitor with no context, land on the homepage and try to understand what this product does. Attempt to complete the main user flow without reading any documentation.', evaluation_points: ['Is the value proposition clear within 5 seconds?', 'Can the main flow be completed without confusion?', 'Are error states helpful or confusing?'] },
          { id: 'SC02', persona_type: 'Skeptical User', narrative: 'As someone evaluating this product for potential use, look for trust signals, security indicators, and professional quality. Try to find the team info, terms of service, and any red flags.', evaluation_points: ['Are trust signals visible (team, audits, reviews)?', 'Does the site feel professional and trustworthy?', 'Is sensitive data handled transparently?'] },
          { id: 'SC03', persona_type: 'Power User', narrative: 'As an experienced user, try to push the product to its limits. Test edge cases, try unusual inputs, check keyboard shortcuts, and explore advanced features.', evaluation_points: ['Does the product handle edge cases gracefully?', 'Are there keyboard shortcuts or power-user features?', 'How does performance hold under stress?'] },
        ],
        questionnaire: [
          { id: 'Q01', question: 'How intuitive was the overall user interface?', type: 'rating_1_5' as const },
          { id: 'Q02', question: 'Rate the visual design quality', type: 'rating_1_5' as const },
          { id: 'Q03', question: 'What was the most confusing part of the experience?', type: 'free_text' as const },
          { id: 'Q04', question: 'On a scale of 1-10, how likely would you recommend this to a friend?', type: 'rating_1_10' as const },
          { id: 'Q05', question: 'What feature or improvement would you most want to see added?', type: 'free_text' as const },
          { id: 'Q06', question: 'Rate the perceived performance and loading speed', type: 'rating_1_5' as const },
          { id: 'Q07', question: 'Describe the biggest pain point you encountered', type: 'free_text' as const },
          { id: 'Q08', question: 'What did the product do well? What should not change?', type: 'free_text' as const },
        ],
      };
    }

    // Store test cases in DB
    const allCases = [
      ...testCasesData.checklist.map((c, i) => ({ testId: test.id, type: 'checklist' as const, content: c, order: i })),
      ...testCasesData.scenarios.map((s, i) => ({ testId: test.id, type: 'scenario' as const, content: s, order: i })),
      ...testCasesData.questionnaire.map((q, i) => ({ testId: test.id, type: 'questionnaire' as const, content: q, order: i })),
    ];

    if (allCases.length > 0) {
      await db.insert(schema.testCases).values(allCases);
    }

    // Activate test
    await db.update(schema.tests).set({ status: 'active' }).where(eq(schema.tests.id, test.id));

    // Auto-test: match personas and queue
    const autoTestJobs: Array<{ persona_id: string; tester_addr: string; job_id: string }> = [];
    if (enable_auto_test) {
      try {
        // Load all active personas with their vectors
        const allPersonas = await db.select().from(schema.personas).where(eq(schema.personas.isActive, true));

        if (allPersonas.length > 0) {
          // Import matching service
          const { matchPersonas } = await import('../services/matching.js');
          const matches = await matchPersonas(
            requirements || '',
            target_url,
            allPersonas.map(p => ({
              id: p.id,
              testerAddr: p.testerAddr,
              vector: p.vector as PersonaVector,
            })),
            3, // max 3 personas
          );

          // Route through persona-engine when USE_PERSONA_ENGINE=1 so the
          // auto-queued runs land the same quality/voice_sample/narrative
          // as a manual /api/autotest/run (which we already route there).
          // Fallback to the legacy in-process Stagehand loop otherwise.
          const engineEnabled = process.env.USE_PERSONA_ENGINE === '1';
          if (engineEnabled) {
            const { runStagehandHybridAndPersist } = await import('./autotest.js');
            const { runTextModeAndPersist } = await import('../services/scoring/text_run.js');
            // Dual-mode auto-queue.
            //
            //   browser chain (sequential): each persona runs stagehand_hybrid
            //     one at a time — three concurrent Chromiums OOM the Railway
            //     api container (each headless Chrome eats 300-500MB).
            //
            //   text chain (parallel): each persona also runs text-mode
            //     simulation in parallel — text runs are just an LLM call,
            //     no browser contention, ~10-20s each.
            //
            // Total reports per test = matches × 2 (browser + text). The
            // "simulation vs actual" comparison is what the Final Diagnosis
            // aggregates into the verdict section.
            let browserChain: Promise<unknown> = Promise.resolve();
            for (const match of matches) {
              const jobId = `auto_${test.id.slice(0, 8)}_${match.persona.id.slice(0, 8)}_${Date.now().toString(36)}`;
              autoTestJobs.push({
                persona_id: match.persona.id,
                tester_addr: match.persona.testerAddr,
                job_id: jobId,
              });
              const personaId = match.persona.id;
              const testId = test.id;
              browserChain = browserChain.then(() =>
                runStagehandHybridAndPersist({ testId, personaId }).catch((err) => {
                  console.warn(`[AutoTest] stagehand_hybrid run failed for ${personaId}:`, err instanceof Error ? err.message : err);
                }),
              );
              // Text runs fire in parallel — no chain membership.
              void runTextModeAndPersist({ testId, personaId }).catch((err) => {
                console.warn(`[AutoTest] text run failed for ${personaId}:`, err instanceof Error ? err.message : err);
              });
            }
            void browserChain;
            console.log(`[AutoTest] Queued ${autoTestJobs.length} × 2 runs (browser sequential + text parallel) for test ${test.id}`);
          } else {
            // Legacy path — in-process Stagehand directly from api container
            const { startAutoTest } = await import('../services/autotest.js');
            for (const match of matches) {
              try {
                const job = await startAutoTest(test.id, match.persona.id);
                autoTestJobs.push({
                  persona_id: match.persona.id,
                  tester_addr: match.persona.testerAddr,
                  job_id: job.id,
                });
              } catch (e) {
                console.warn(`[AutoTest] Failed to queue for persona ${match.persona.id}:`, e);
              }
            }
            console.log(`[AutoTest] Queued ${autoTestJobs.length} legacy auto-tests for test ${test.id}`);
          }
        }
      } catch (autoErr) {
        console.warn('[AutoTest] Auto-test matching failed:', autoErr);
      }
    }

    res.json({
      test: { ...test, status: 'active' },
      test_cases: testCasesData,
      auto_tests: autoTestJobs,
    });
  } catch (error) {
    console.error('[POST /api/test/register]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/test/:id/retry-autotest — Re-queue persona runs for a test
// whose auto-queue got stuck or never completed. Typical causes are a
// hung stagehand session on a complex SPA, a Railway redeploy that
// killed the in-flight sequential chain, or genuine agent errors mid-run.
//
// Idempotent: personas that already have a test_report row with
// isPersonaTest=true are skipped (the DB unique index would reject the
// insert anyway, but checking here lets us report cleanly).
//
// No payment: the company already paid at /register. This is recovery
// from a transient runtime failure, not a new billable operation.
router.post('/:id/retry-autotest',
  llmGenerateLimiter,
  requireSignedRequest,
  validateBody(retryAutotestBodySchema),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const { company_wallet, max_personas, force_retry_low_quality, modes } = req.body;
      const retryModes: Array<'stagehand_hybrid' | 'text'> = modes ?? ['stagehand_hybrid', 'text'];

      const signedWallet = (req as unknown as { signedWallet: string }).signedWallet;
      if (signedWallet !== company_wallet) {
        res.status(403).json({ error: 'signed wallet does not match company_wallet' });
        return;
      }

      const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, id));
      if (!test) {
        res.status(404).json({ error: 'Test not found' });
        return;
      }
      // Devnet beta: any signed wallet may retry any test (was: owner-only).

      // Re-match personas deterministically (same path /register uses)
      const allPersonas = await db.select().from(schema.personas).where(eq(schema.personas.isActive, true));
      if (allPersonas.length === 0) {
        res.status(409).json({ error: 'no active personas available' });
        return;
      }
      const { matchPersonas } = await import('../services/matching.js');
      const matches = await matchPersonas(
        test.requirements || '',
        test.targetUrl,
        allPersonas.map((p) => ({ id: p.id, testerAddr: p.testerAddr, vector: p.vector as unknown as Parameters<typeof matchPersonas>[2][0]['vector'] })),
        max_personas ?? 3,
      );

      // When force_retry_low_quality is set we drop the session-limited
      // persona reports (quality < 1.5) + their settlements first, so
      // the matcher's picks aren't filtered out of toRun by the
      // "already has a report" skip below. Manual reports are left
      // untouched — the whole idea of "session limited" is persona-
      // specific.
      let forcedDeleted = 0;
      if (force_retry_low_quality) {
        const lowQuality = await db.select({ id: schema.testReports.id }).from(schema.testReports).where(
          and(
            eq(schema.testReports.testId, id),
            eq(schema.testReports.isPersonaTest, true),
            lt(schema.testReports.qualityScore, 1.5),
          ),
        );
        const lowIds = lowQuality.map((r) => r.id);
        if (lowIds.length > 0) {
          // Delete dependent settlement rows first (FK constraint).
          await db.delete(schema.settlements).where(inArray(schema.settlements.reportId, lowIds));
          await db.delete(schema.testReports).where(inArray(schema.testReports.id, lowIds));
          forcedDeleted = lowIds.length;
          console.log(`[AutoTest-retry] force_retry_low_quality=true — deleted ${forcedDeleted} session-limited reports for test ${id}`);
        }
      }

      // Build per-mode coverage: which (persona, mode) pairs already
      // have a row. Widened unique index means one persona can have
      // separate stagehand_hybrid and text rows — we skip each mode
      // independently so re-running only the missing side is cheap.
      const existingReports = await db.select().from(schema.testReports).where(
        and(
          eq(schema.testReports.testId, id),
          eq(schema.testReports.isPersonaTest, true),
        ),
      );
      const coveredKey = (addr: string, mode: string) => `${addr}::${mode}`;
      const covered = new Set(
        existingReports.map((r) => coveredKey(r.testerAddr, r.sourceMode)),
      );

      const autoTestJobs: Array<{ persona_id: string; tester_addr: string; mode: string; job_id: string }> = [];
      let skippedExisting = 0;

      const { runStagehandHybridAndPersist } = await import('./autotest.js');
      const { runTextModeAndPersist } = await import('../services/scoring/text_run.js');

      // browser chain stays sequential (Chromium ceiling), text runs
      // fire in parallel (pure LLM, no browser contention).
      let browserChain: Promise<unknown> = Promise.resolve();
      for (const match of matches) {
        const testId = id;
        const personaId = match.persona.id;
        const testerAddr = match.persona.testerAddr;

        if (retryModes.includes('stagehand_hybrid')) {
          if (covered.has(coveredKey(testerAddr, 'stagehand_hybrid'))) {
            skippedExisting += 1;
          } else {
            autoTestJobs.push({
              persona_id: personaId,
              tester_addr: testerAddr,
              mode: 'stagehand_hybrid',
              job_id: `retry_sh_${id.slice(0, 8)}_${personaId.slice(0, 8)}_${Date.now().toString(36)}`,
            });
            browserChain = browserChain.then(() =>
              runStagehandHybridAndPersist({ testId, personaId }).catch((err) => {
                console.warn(
                  `[AutoTest-retry] stagehand_hybrid run failed for ${personaId}:`,
                  err instanceof Error ? err.message : err,
                );
              }),
            );
          }
        }

        if (retryModes.includes('text')) {
          if (covered.has(coveredKey(testerAddr, 'text'))) {
            skippedExisting += 1;
          } else {
            autoTestJobs.push({
              persona_id: personaId,
              tester_addr: testerAddr,
              mode: 'text',
              job_id: `retry_tx_${id.slice(0, 8)}_${personaId.slice(0, 8)}_${Date.now().toString(36)}`,
            });
            void runTextModeAndPersist({ testId, personaId }).catch((err) => {
              console.warn(
                `[AutoTest-retry] text run failed for ${personaId}:`,
                err instanceof Error ? err.message : err,
              );
            });
          }
        }
      }
      void browserChain;

      if (autoTestJobs.length === 0) {
        res.json({
          test_id: id,
          queued: 0,
          skipped_existing: skippedExisting,
          deleted_low_quality: forcedDeleted,
          auto_tests: [],
          message: forcedDeleted > 0
            ? `${forcedDeleted} low-quality reports deleted, but no (persona, mode) pair needs retry`
            : `all matched (persona, mode) pairs already have reports (modes=${retryModes.join(',')})`,
        });
        return;
      }

      console.log(`[AutoTest-retry] Queued ${autoTestJobs.length} runs (modes=${retryModes.join(',')}) for test ${id}`);

      res.json({
        test_id: id,
        queued: autoTestJobs.length,
        skipped_existing: skippedExisting,
        deleted_low_quality: forcedDeleted,
        modes: retryModes,
        auto_tests: autoTestJobs,
      });
    } catch (error) {
      console.error('[POST /api/test/:id/retry-autotest]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

// GET /api/test/:id/diagnosis — Return the stored synthesis report if any.
// Unauthenticated (matches GET /api/test/:id) — the diagnosis is a
// summary over data the owner has anyway; companies who want to share
// a read link don't need a second signing round.
/**
 * Slim insights aggregate for the company test detail page.
 * Wraps services/scoring/diagnosis.aggregateForDiagnosis() — the same
 * deterministic preprocessor that the diagnosis Sonnet synthesis uses,
 * but without the LLM clustering pass (kept fast: ~50ms, no token cost).
 *
 * Powers two new dashboard sections (P1b):
 *   - Why Users Drop chat bubble: reads painPointFrequency
 *   - Persona Insights cards:    reads perPersona slice
 *
 * Returns 404 if the test doesn't exist; empty arrays if no reports.
 */
router.get('/:id/insights', async (req, res) => {
  try {
    const id = String(req.params.id);
    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, id));
    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }
    const { aggregateForDiagnosis } = await import('../services/scoring/diagnosis.js');
    const agg = await aggregateForDiagnosis(id);
    res.json({
      test_id: id,
      target_url: agg.targetUrl,
      report_count: agg.reportCount,
      persona_count: agg.personaCount,
      human_count: agg.humanCount,
      quality_stats: agg.qualityStats,
      // Top 10 most-cited pain points; chat bubble UI shows top 6
      pain_points: agg.painPointFrequency.slice(0, 10).map((pp) => ({
        description: pp.description,
        count: pp.count,
        // Citation severity (highest of any cited pain point) for color
        severity: pp.citations
          .map((c) => c.severity)
          .sort((a, b) => sevRank(b) - sevRank(a))[0] ?? 'medium',
        sample_evidence: pp.citations[0] ? {
          report_id: pp.citations[0].reportId,
          turn: pp.citations[0].evidenceTurn,
          is_persona: pp.citations[0].isPersona,
        } : null,
      })),
      // Top 3 personas by report relevance (persona reports first, then by quality)
      personas: agg.perPersona
        .filter((p) => p.isPersona)
        .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
        .slice(0, 3)
        .map((p) => ({
          report_id: p.reportId,
          tester_addr: p.testerAddr,
          quality_score: p.qualityScore,
          outcome: p.outcome,
          voice_sample: p.voiceSample,
          checklist: {
            passed: p.checklistPassed,
            failed: p.checklistFailed,
            blocked: p.checklistBlocked,
          },
          ux_scores: p.uxScores,
          top_pain_point: p.painPoints[0]?.description ?? null,
          source: p.source,
        })),
      fidelity: agg.fidelity,
    });
  } catch (error) {
    console.error('[GET /api/test/:id/insights]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Sort helper: high → 3, medium → 2, low → 1, anything else → 0. */
function sevRank(sev: string): number {
  return sev === 'high' ? 3 : sev === 'medium' ? 2 : sev === 'low' ? 1 : 0;
}

router.get('/:id/diagnosis', async (req, res) => {
  try {
    const id = String(req.params.id);
    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, id));
    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }
    const reports = await db.select({ id: schema.testReports.id })
      .from(schema.testReports)
      .where(eq(schema.testReports.testId, id));
    res.json({
      test_id: id,
      markdown: test.diagnosisMd,
      generated_at: test.diagnosisGeneratedAt,
      generated_for_report_count: test.diagnosisReportCount,
      current_report_count: reports.length,
      stale: !!test.diagnosisMd && (test.diagnosisReportCount ?? 0) < reports.length,
    });
  } catch (error) {
    console.error('[GET /api/test/:id/diagnosis]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/test/:id/diagnosis — (re)generate the synthesis report.
// Auth: signed request matching test.companyAddr. Triggers a Sonnet
// call so we rate-limit the same as LLM generation routes. Safe to
// re-call; each call overwrites the stored markdown.
router.post(
  '/:id/diagnosis',
  llmGenerateLimiter,
  requireSignedRequest,
  validateBody(generateDiagnosisBodySchema),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const { company_wallet } = req.body;

      const signedWallet = (req as unknown as { signedWallet: string }).signedWallet;
      if (signedWallet !== company_wallet) {
        res.status(403).json({ error: 'signed wallet does not match company_wallet' });
        return;
      }

      const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, id));
      if (!test) {
        res.status(404).json({ error: 'Test not found' });
        return;
      }
      // Devnet beta: any signed wallet may generate diagnosis (was: owner-only).

      const reports = await db.select({ id: schema.testReports.id })
        .from(schema.testReports)
        .where(eq(schema.testReports.testId, id));
      if (reports.length < 3) {
        res.status(409).json({
          error: 'not enough reports',
          detail: `need at least 3 reports to synthesise, have ${reports.length}`,
        });
        return;
      }

      const { generateAndStoreDiagnosis } = await import('../services/scoring/diagnosis.js');
      const { markdown, reportCount, generatedAt } = await generateAndStoreDiagnosis(id);
      res.json({
        test_id: id,
        markdown,
        generated_at: generatedAt.toISOString(),
        generated_for_report_count: reportCount,
      });
    } catch (error) {
      console.error('[POST /api/test/:id/diagnosis]', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
  },
);

// PATCH /api/test/:id/deposit — Update deposit tx signature
router.patch('/:id/deposit', async (req, res) => {
  try {
    const { id } = req.params;
    const { deposit_tx_signature } = req.body as { deposit_tx_signature: string };

    if (!deposit_tx_signature) {
      res.status(400).json({ error: 'deposit_tx_signature is required' });
      return;
    }

    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, id));
    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const [updated] = await db.update(schema.tests)
      .set({ depositTxSignature: deposit_tx_signature })
      .where(eq(schema.tests.id, id))
      .returning();

    res.json({ test: updated });
  } catch (error) {
    console.error('[PATCH /api/test/:id/deposit]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tests — List all tests
router.get('/', async (_req, res) => {
  try {
    const allTests = await db.select().from(schema.tests);
    res.json(allTests);
  } catch (error) {
    console.error('[GET /api/tests]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/test/:id — Get test details with test cases
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, id));
    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const cases = await db.select().from(schema.testCases).where(eq(schema.testCases.testId, id));

    const testCases = {
      checklist: cases.filter(c => c.type === 'checklist').map(c => c.content),
      scenarios: cases.filter(c => c.type === 'scenario').map(c => c.content),
      questionnaire: cases.filter(c => c.type === 'questionnaire').map(c => c.content),
    };

    res.json({ test, test_cases: testCases });
  } catch (error) {
    console.error('[GET /api/test/:id]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/test/:id/results — Get test results with reports (x402 gated: $0.05)
router.get('/:id/results', async (req, res) => {
  try {
    const { id } = req.params;
    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, id));
    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const reports = await db.select().from(schema.testReports).where(eq(schema.testReports.testId, id));
    const settlements = await db.select().from(schema.settlements).where(eq(schema.settlements.testId, id));

    res.json({
      test,
      reports,
      settlements,
      summary: {
        total_reports: reports.length,
        manual_reports: reports.filter(r => !r.isPersonaTest).length,
        persona_reports: reports.filter(r => r.isPersonaTest).length,
        avg_quality: reports.length > 0
          ? Math.round(reports.reduce((sum, r) => sum + (r.qualityScore || 0), 0) / reports.length * 10) / 10
          : 0,
        total_spent: settlements.reduce((sum, s) => sum + s.amountToken, 0),
      },
    });
  } catch (error) {
    console.error('[GET /api/test/:id/results]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
