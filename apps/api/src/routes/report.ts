import { Router, type Router as RouterType } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { calculateQualityScore } from '../services/llm.js';
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

    // Calculate quality score via LLM
    let qualityScore: number;
    try {
      qualityScore = await calculateQualityScore({
        checklist_results,
        scenario_log,
        questionnaire_answers,
      });
    } catch {
      // Fallback: simple heuristic
      const checklistCompleteness = checklist_results
        ? checklist_results.filter(c => c.status === 'passed').length / checklist_results.length
        : 0.5;
      qualityScore = Math.round((checklistCompleteness * 5) * 10) / 10;
    }

    // Create report
    const [report] = await db.insert(schema.testReports).values({
      testerAddr: tester_addr,
      testId: test_id,
      checklistResults: checklist_results || [],
      scenarioLog: scenario_log || [],
      questionnaireAnswers: questionnaire_answers || [],
      qualityScore,
      isPersonaTest: false,
      screenshots: screenshots || [],
    }).returning();

    // Update tester's testsDone count
    const newTestsDone = tester.testsDone + 1;
    await db.update(schema.testers)
      .set({ testsDone: newTestsDone })
      .where(eq(schema.testers.walletAddress, tester_addr));

    // Calculate USDC reward based on quality ($3-$5)
    const rewardAmount = 3 + (qualityScore / 5) * 2; // $3 base + up to $2 bonus

    // Attempt USDC transfer via Solana service
    let txSignature = `pending_${Date.now()}`;
    try {
      const { solanaService } = await import('../services/solana.js');
      const txResult = await solanaService.transferUsdc(tester_addr, rewardAmount);
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
      amountToken: rewardAmount,
      settlementType: 'usdc',
      txSignature,
    }).returning();

    // Check if persona should be triggered (3 tests completed)
    const personaTriggered = newTestsDone >= 3 && !tester.personaId;

    res.json({
      report,
      quality_score: qualityScore,
      reward_amount: rewardAmount,
      tx_signature: settlement.txSignature,
      persona_triggered: personaTriggered,
    });
  } catch (error) {
    console.error('[POST /api/report/submit]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/report/:reportId — Get a specific report
router.get('/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const [report] = await db.select().from(schema.testReports).where(eq(schema.testReports.id, reportId));

    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    res.json(report);
  } catch (error) {
    console.error('[GET /api/report/:reportId]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/tester/:wallet — Get all reports for a tester
router.get('/tester/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const reports = await db.select().from(schema.testReports).where(eq(schema.testReports.testerAddr, wallet));
    res.json(reports);
  } catch (error) {
    console.error('[GET /api/reports/tester/:wallet]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/test/:testId — Get all reports for a test
router.get('/test/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const reports = await db.select().from(schema.testReports).where(eq(schema.testReports.testId, testId));
    res.json(reports);
  } catch (error) {
    console.error('[GET /api/reports/test/:testId]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
