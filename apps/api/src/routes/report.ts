import { Router, type Router as RouterType } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { calculateQualityScore, type QualityResult } from '../services/llm.js';
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

    // Duplicate submission guard
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

    // Calculate quality score + reward via LLM
    let quality: QualityResult;
    try {
      quality = await calculateQualityScore({
        checklist_results,
        scenario_log,
        questionnaire_answers,
      });
    } catch {
      // Fallback: simple heuristic — should not happen since heuristic is built-in
      quality = { score: 2.0, rewardUsdc: 2, reason: 'Fallback scoring', rejected: false };
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

    // Create report (even if rejected, for record)
    const [report] = await db.insert(schema.testReports).values({
      testerAddr: tester_addr,
      testId: test_id,
      checklistResults: checklist_results || [],
      scenarioLog: scenario_log || [],
      questionnaireAnswers: questionnaire_answers || [],
      qualityScore: quality.score,
      isPersonaTest: false,
      screenshots: screenshots || [],
    }).returning();

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

    // Attempt USDC transfer
    let txSignature = `pending_${Date.now()}`;
    try {
      const { solanaService } = await import('../services/solana.js');
      const txResult = await solanaService.transferUsdc(tester_addr, quality.rewardUsdc);
      txSignature = txResult.txSignature;
    } catch (solanaErr) {
      console.warn('[Report] USDC transfer failed (recording pending):', solanaErr instanceof Error ? solanaErr.message : solanaErr);
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

// GET /api/reports/compare/:testId — Compare manual vs persona reports for a test
router.get('/compare/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const allReports = await db.select().from(schema.testReports).where(eq(schema.testReports.testId, testId));

    // Exclude rejected reports (qualityScore < 1.5) from comparison
    const reports = allReports.filter(r => (r.qualityScore ?? 0) >= 1.5);

    if (reports.length === 0) {
      res.status(404).json({ error: 'No valid reports found for this test' });
      return;
    }

    const manual = reports.filter(r => !r.isPersonaTest);
    const persona = reports.filter(r => r.isPersonaTest);

    // Aggregate stats
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const manualScores = manual.map(r => r.qualityScore || 0);
    const personaScores = persona.map(r => r.qualityScore || 0);

    // Count checklist issues
    const countIssues = (reports: typeof manual) => {
      let passed = 0, failed = 0, blocked = 0;
      for (const r of reports) {
        const results = r.checklistResults as Array<{ status: string }> || [];
        for (const c of results) {
          if (c.status === 'passed') passed++;
          else if (c.status === 'failed') failed++;
          else blocked++;
        }
      }
      return { passed, failed, blocked };
    };

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
    });
  } catch (error) {
    console.error('[GET /api/reports/compare/:testId]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
