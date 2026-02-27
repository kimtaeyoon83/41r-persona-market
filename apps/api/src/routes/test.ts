import { Router, type Router as RouterType } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateTestCases } from '../services/llm.js';
import type { RegisterTestRequest } from '@41rpm/shared';

const router: RouterType = Router();

// POST /api/test/register — Create a new test with AI-generated test cases
router.post('/register', async (req, res) => {
  try {
    const { target_url, requirements, budget_usdc, company_wallet } = req.body as RegisterTestRequest;

    if (!target_url || !company_wallet) {
      res.status(400).json({ error: 'target_url and company_wallet are required' });
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
          { id: 'CL01', task: 'Load the main page', expected: 'Page loads without errors' },
          { id: 'CL02', task: 'Check navigation links', expected: 'All links work correctly' },
          { id: 'CL03', task: 'Test responsive layout', expected: 'Layout adapts to mobile' },
          { id: 'CL04', task: 'Check form submissions', expected: 'Forms submit successfully' },
        ],
        scenarios: [
          { id: 'SC01', persona_type: 'New User', narrative: 'As a first-time visitor, navigate the site and complete the main user flow.', evaluation_points: ['Onboarding clarity', 'Navigation ease', 'Error handling'] },
        ],
        questionnaire: [
          { id: 'Q01', question: 'Overall UI intuitiveness', type: 'rating_1_5' as const },
          { id: 'Q02', question: 'Most confusing part of the experience', type: 'free_text' as const },
          { id: 'Q03', question: 'Would you use this product again? (1-10)', type: 'rating_1_10' as const },
          { id: 'Q04', question: 'Suggestions for improvement', type: 'free_text' as const },
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

    res.json({ test: { ...test, status: 'active' }, test_cases: testCasesData });
  } catch (error) {
    console.error('[POST /api/test/register]', error);
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
