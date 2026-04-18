import { Router, type Router as RouterType } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { calculateQualityScore, QualityScoreTimeout, type QualityResult } from '../services/llm.js';
import {
  buildConfusionMatrix,
  computePerItemAgreement,
  convergenceCurve,
  ksStatistic,
  pearson,
  spearman,
  type ChecklistStatus,
} from '../services/comparison.js';
import type { SubmitReportRequest } from '@41rpm/shared';

const router: RouterType = Router();

// POST /api/report/submit — Submit a test report
router.post('/submit', async (req, res) => {
  try {
    const body = req.body as SubmitReportRequest;
    const { tester_addr, test_id, checklist_results, scenario_log, questionnaire_answers, screenshots } = body;

    if (!tester_addr || !test_id) {
      res.status(400).json({ error: 'tester_addr and test_id are required' });
      return;
    }

    // Reject empty reports up-front so the LLM scoring path doesn't get
    // hit by spam. An empty submission previously fell through to the
    // fallback score=2.0 branch and still paid ~25% of the reward.
    const hasChecklist = Array.isArray(checklist_results) && checklist_results.length > 0;
    const hasQuestionnaire = Array.isArray(questionnaire_answers) && questionnaire_answers.length > 0;
    const hasScenario = Array.isArray(scenario_log) && scenario_log.length > 0;
    if (!hasChecklist && !hasQuestionnaire && !hasScenario) {
      res.status(400).json({
        error: 'Empty report',
        message: 'At least one of checklist_results, questionnaire_answers, or scenario_log must be non-empty.',
      });
      return;
    }

    // Verify tester exists
    const [tester] = await db.select().from(schema.testers).where(eq(schema.testers.walletAddress, tester_addr));
    if (!tester) {
      res.status(404).json({ error: 'Tester not found. Register first.' });
      return;
    }

    // Verify test exists and is active
    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, test_id));
    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }
    if (test.status !== 'active') {
      res.status(400).json({ error: 'Test is not active' });
      return;
    }

    // Fast-path duplicate guard — avoids wasting an LLM call when a
    // non-concurrent duplicate is submitted. The real safety net is the
    // UNIQUE (tester_addr, test_id) index enforced at INSERT time below.
    const [existingReport] = await db.select({ id: schema.testReports.id })
      .from(schema.testReports)
      .where(and(
        eq(schema.testReports.testerAddr, tester_addr),
        eq(schema.testReports.testId, test_id),
      ));
    if (existingReport) {
      res.status(409).json({ error: 'Report already submitted for this test' });
      return;
    }

    // Calculate quality score + reward via LLM. Two failure modes:
    //  - QualityScoreTimeout: transient (Anthropic slow/network). Return
    //    503 so the tester can retry without the duplicate-index blocking
    //    them (no report row was inserted yet).
    //  - Other errors: shouldn't happen — calculateQualityScore falls
    //    back to a deterministic heuristic internally. A thrown error
    //    means something deeper is wrong; surface it so it doesn't
    //    silently pay out a bogus reward.
    let quality: QualityResult;
    try {
      quality = await calculateQualityScore({
        checklist_results,
        scenario_log,
        questionnaire_answers,
      });
    } catch (scoringErr) {
      if (scoringErr instanceof QualityScoreTimeout) {
        console.warn(`[Report] scoring timeout (${scoringErr.elapsedMs}ms), asking client to retry`);
        res.status(503).json({
          error: 'scoring_timeout',
          message: 'Scoring service is slow. Please retry in a moment.',
          retryable: true,
        });
        return;
      }
      console.error('[Report] unexpected scoring failure:', scoringErr);
      res.status(500).json({
        error: 'scoring_failed',
        message: 'Could not score report. Please retry.',
      });
      return;
    }

    // Override reward using test's rewardPerTester and quality score
    // Power curve (score^1.5) for dramatic differentiation:
    //   5.0→100%, 4.0→72%, 3.0→46%, 2.0→25%, 1.5→16%
    const baseReward = test.rewardPerTester;
    let rewardTier: string;
    if (!quality.rejected) {
      const ratio = quality.score / 5.0;
      const curved = Math.pow(ratio, 1.5);
      const calculated = baseReward * curved;
      // No fixed floor — reward scales proportionally to baseReward
      // e.g., baseReward $0.1 with score 1.5 → $0.016
      quality.rewardUsdc = Math.round(Math.min(baseReward, calculated) * 1000000) / 1000000;

      if (quality.score >= 4.5) rewardTier = 'exceptional';
      else if (quality.score >= 3.5) rewardTier = 'good';
      else if (quality.score >= 2.5) rewardTier = 'average';
      else rewardTier = 'below_average';
    } else {
      quality.rewardUsdc = 0;
      rewardTier = 'rejected';
    }

    // Check budget before proceeding
    if (!quality.rejected && test.budgetUsdc < quality.rewardUsdc) {
      res.status(400).json({ error: 'Test budget exhausted' });
      return;
    }

    console.log(`[Report] Quality: ${quality.score}/5.0 (${rewardTier}), Reward: $${quality.rewardUsdc}/${baseReward}, Rejected: ${quality.rejected}, Reason: ${quality.reason}`);

    // Create report (even if rejected, for record). onConflictDoNothing
    // catches the SELECT→INSERT race: if a concurrent request already
    // inserted, inserted.length === 0 and we return 409 without charging
    // anyone or decrementing budget.
    const inserted = await db.insert(schema.testReports).values({
      testerAddr: tester_addr,
      testId: test_id,
      checklistResults: checklist_results || [],
      scenarioLog: scenario_log || [],
      questionnaireAnswers: questionnaire_answers || [],
      qualityScore: quality.score,
      isPersonaTest: false,
      screenshots: screenshots || [],
    })
      .onConflictDoNothing({
        target: [
          schema.testReports.testerAddr,
          schema.testReports.testId,
          schema.testReports.isPersonaTest,
        ],
      })
      .returning();

    if (inserted.length === 0) {
      res.status(409).json({ error: 'Report already submitted for this test' });
      return;
    }
    const [report] = inserted;

    // If rejected → no payment, no testsDone increment
    if (quality.rejected) {
      res.status(200).json({
        report,
        quality_score: quality.score,
        quality_reason: quality.reason,
        reward_tier: 'rejected',
        reward_amount: 0,
        reward_max: baseReward,
        tx_signature: null,
        rejected: true,
        rejection_message: `Report rejected: ${quality.reason}. Please provide more detailed testing with specific notes, observations, and thorough answers to earn a reward.`,
        persona_triggered: false,
      });
      return;
    }

    // Accepted — update testsDone
    const newTestsDone = tester.testsDone + 1;
    await db.update(schema.testers)
      .set({ testsDone: newTestsDone })
      .where(eq(schema.testers.walletAddress, tester_addr));

    // Attempt USDC transfer. InsufficientFundsError is a hard event-level
    // problem (whole payer wallet is dry) — log at ERROR level so ops
    // sees it immediately. Other errors remain transient and recorded
    // as `pending_` until C3's retry worker is in place.
    let txSignature = `pending_${Date.now()}`;
    try {
      const { solanaService } = await import('../services/solana.js');
      const txResult = await solanaService.transferUsdc(tester_addr, quality.rewardUsdc);
      txSignature = txResult.txSignature;
    } catch (solanaErr) {
      const { InsufficientFundsError } = await import('../services/solana.js');
      if (solanaErr instanceof InsufficientFundsError) {
        console.error(
          `[Report] PAYER_DRY needed=${solanaErr.needed} available=${solanaErr.available} mint=${solanaErr.mint}`,
        );
      } else {
        console.warn(
          '[Report] USDC transfer failed (recording pending):',
          solanaErr instanceof Error ? solanaErr.message : solanaErr,
        );
      }
    }

    // Record settlement
    const [settlement] = await db.insert(schema.settlements).values({
      testId: test_id,
      reportId: report.id,
      payerAddr: test.companyAddr,
      payeeAddr: tester_addr,
      amountToken: quality.rewardUsdc,
      settlementType: 'usdc',
      txSignature,
    }).returning();

    // Deduct reward from test budget
    await db.update(schema.tests)
      .set({ budgetUsdc: test.budgetUsdc - quality.rewardUsdc })
      .where(eq(schema.tests.id, test_id));

    // Check if persona should be triggered (3 tests completed)
    const personaTriggered = newTestsDone >= 3 && !tester.personaId;

    res.json({
      report,
      quality_score: quality.score,
      quality_reason: quality.reason,
      reward_tier: rewardTier,
      reward_amount: quality.rewardUsdc,
      reward_max: baseReward,
      tx_signature: settlement.txSignature,
      persona_triggered: personaTriggered,
      rejected: false,
    });

    // Fire-and-forget persona recompute. Response is already sent, so
    // the tester doesn't wait on the LLM call; failures only land in
    // logs. recomputePersona no-ops when testsDone < 3 so early reports
    // are free. See services/persona.ts for the full pipeline.
    if (newTestsDone >= 3) {
      setImmediate(() => {
        (async () => {
          try {
            const { recomputePersona } = await import('../services/persona.js');
            const result = await recomputePersona(tester_addr, 'report_submit');
            if (result) {
              console.log(
                `[persona] recomputed ${tester_addr.slice(0, 8)}… → v${result.versionNum}` +
                `${result.isFirstVersion ? ' (first)' : ''}${result.sasOnChain ? ' on-chain' : ' demo'}`,
              );
            }
          } catch (err) {
            console.error('[persona] async recompute failed:', err instanceof Error ? err.message : err);
          }
        })();
      });
    }
  } catch (error) {
    console.error('[POST /api/report/submit]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/report/:reportId — Get a specific report with settlement info
router.get('/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const [report] = await db.select().from(schema.testReports).where(eq(schema.testReports.id, reportId));

    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    // Fetch all settlements for this report (USDC + 41R)
    const settlements = await db.select().from(schema.settlements).where(eq(schema.settlements.reportId, reportId));

    res.json({ ...report, settlements });
  } catch (error) {
    console.error('[GET /api/report/:reportId]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/tester/:wallet — Get all reports for a tester (with test info + settlements)
router.get('/tester/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const reports = await db.select().from(schema.testReports).where(eq(schema.testReports.testerAddr, wallet));

    if (reports.length === 0) {
      res.json([]);
      return;
    }

    // Fetch related tests and settlements
    const testIds = [...new Set(reports.map(r => r.testId))];
    const allTests = await db.select().from(schema.tests);
    const testsMap = new Map(allTests.filter(t => testIds.includes(t.id)).map(t => [t.id, t]));

    const reportIds = reports.map(r => r.id);
    const allSettlements = await db.select().from(schema.settlements);
    const settlementsByReport = new Map<string, typeof allSettlements>();
    for (const s of allSettlements) {
      if (s.reportId && reportIds.includes(s.reportId)) {
        const arr = settlementsByReport.get(s.reportId) || [];
        arr.push(s);
        settlementsByReport.set(s.reportId, arr);
      }
    }

    const enrichedReports = reports.map(r => {
      const test = testsMap.get(r.testId);
      return {
        ...r,
        test: test ? { id: test.id, targetUrl: test.targetUrl, requirements: test.requirements, status: test.status } : null,
        settlements: settlementsByReport.get(r.id) || [],
      };
    });

    res.json(enrichedReports);
  } catch (error) {
    console.error('[GET /api/reports/tester/:wallet]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/test/:testId — Get all reports for a test (with settlements)
router.get('/test/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const reports = await db.select().from(schema.testReports).where(eq(schema.testReports.testId, testId));
    const settlements = await db.select().from(schema.settlements).where(eq(schema.settlements.testId, testId));

    // Attach settlements to each report (may have multiple: USDC + 41R)
    const reportsWithSettlement = reports.map(r => ({
      ...r,
      settlements: settlements.filter(s => s.reportId === r.id),
    }));

    res.json(reportsWithSettlement);
  } catch (error) {
    console.error('[GET /api/reports/test/:testId]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/compare/:testId — AI persona vs human comparison
// powering the investor dashboard (docs/persona-engine-integration-
// gaps.md context). Returns per-item checklist agreement, quality-score
// correlation, questionnaire-rating distribution similarity, and the
// N-based convergence curve that shows persona means approaching
// human means as sample size grows.
router.get('/compare/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const reports = await db.select().from(schema.testReports).where(eq(schema.testReports.testId, testId));

    // The comparison endpoint used to filter reports with quality_score
    // < 1.5 ("rejected"), which made sense for a "show me useful
    // reports" view but hides persona runs whose whole story is a low
    // score. The experiment dashboard needs every sample from both
    // sides — low scores are a legitimate datapoint for "does persona
    // give up where humans give up?". Callers who want a curated view
    // should filter client-side.
    if (reports.length === 0) {
      res.status(404).json({ error: 'No reports found for this test' });
      return;
    }

    const manual = reports.filter(r => !r.isPersonaTest);
    const persona = reports.filter(r => r.isPersonaTest);

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const round3 = (v: number) => Math.round(v * 1000) / 1000;

    // ─── Aggregate headline numbers (unchanged; dashboard keeps using these) ──
    const manualScores = manual.map(r => r.qualityScore || 0);
    const personaScores = persona.map(r => r.qualityScore || 0);

    const countIssues = (rs: typeof manual) => {
      let passed = 0, failed = 0, blocked = 0;
      for (const r of rs) {
        const results = (r.checklistResults as Array<{ status: string }> | null) || [];
        for (const c of results) {
          if (c.status === 'passed') passed++;
          else if (c.status === 'failed') failed++;
          else blocked++;
        }
      }
      return { passed, failed, blocked };
    };

    // ─── Per-item checklist agreement + confusion matrix ───────────────
    const manualChecklists = manual.map((r) =>
      (r.checklistResults as Array<{ id: string; status: ChecklistStatus }> | null) || [],
    );
    const personaChecklists = persona.map((r) =>
      (r.checklistResults as Array<{ id: string; status: ChecklistStatus }> | null) || [],
    );
    const { items: itemAgreement, overallAgreementRate } =
      computePerItemAgreement(manualChecklists, personaChecklists);
    const confusion = buildConfusionMatrix(itemAgreement);

    // ─── Quality-score correlation ────────────────────────────────────
    // Pair by tester_addr so a persona run is compared to the same
    // tester's manual run (both sides ideally evaluated the same site).
    const manualByTester = new Map<string, number>();
    for (const r of manual) manualByTester.set(r.testerAddr, r.qualityScore ?? 0);
    const pairedManual: number[] = [];
    const pairedPersona: number[] = [];
    for (const p of persona) {
      const m = manualByTester.get(p.testerAddr);
      if (typeof m === 'number') {
        pairedManual.push(m);
        pairedPersona.push(p.qualityScore ?? 0);
      }
    }
    const correlation = {
      pearson: round3(pearson(pairedManual, pairedPersona)),
      spearman: round3(spearman(pairedManual, pairedPersona)),
      paired_count: pairedManual.length,
    };

    // ─── Rating distribution (rating_1_5 questionnaire items) ─────────
    // We sample a numeric rating from each report's first rating answer
    // and compute a KS statistic. For N<10 this is noisy but still a
    // useful direction indicator.
    const extractRatings = (rs: typeof manual): number[] => {
      const out: number[] = [];
      for (const r of rs) {
        const answers = (r.questionnaireAnswers as Array<{ id: string; answer: string | number }> | null) || [];
        for (const a of answers) {
          if (typeof a.answer === 'number' && a.answer >= 1 && a.answer <= 10) {
            out.push(a.answer);
            break; // only first numeric rating per report
          }
        }
      }
      return out;
    };
    const manualRatings = extractRatings(manual);
    const personaRatings = extractRatings(persona);
    const ratingDistribution = {
      ks_statistic: round3(ksStatistic(manualRatings, personaRatings)),
      manual_count: manualRatings.length,
      persona_count: personaRatings.length,
      manual_mean: round3(avg(manualRatings)),
      persona_mean: round3(avg(personaRatings)),
    };

    // ─── Convergence curve ────────────────────────────────────────────
    // "As N grows, persona mean approaches human mean." Samples reports
    // in chronological order so the curve mirrors a live event.
    const manualSorted = [...manualScores].slice(0, Math.min(manualScores.length, personaScores.length));
    const personaSorted = [...personaScores].slice(0, Math.min(manualScores.length, personaScores.length));
    const convergence = convergenceCurve(manualSorted, personaSorted);

    res.json({
      test_id: testId,
      manual: {
        count: manual.length,
        reports: manual,
        avg_quality: Math.round(avg(manualScores) * 10) / 10,
        issues: countIssues(manual),
      },
      persona: {
        count: persona.length,
        reports: persona,
        avg_quality: Math.round(avg(personaScores) * 10) / 10,
        issues: countIssues(persona),
      },
      comparison: {
        item_agreement_rate: round3(overallAgreementRate),
        item_agreement: itemAgreement,
        confusion_matrix: confusion,
        correlation,
        rating_distribution: ratingDistribution,
        convergence,
      },
    });
  } catch (error) {
    console.error('[GET /api/reports/compare/:testId]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
