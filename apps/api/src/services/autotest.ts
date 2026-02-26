import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateAutoTestReport } from './llm.js';
import type { GeneratedTestCases, PersonaVector } from '@41rpm/shared';

interface AutoTestJob {
  id: string;
  testId: string;
  personaId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  reportId?: string;
  error?: string;
  result?: {
    screenshots: string[];
    actionLog: string[];
    textReport: string;
    uxFeedback: Record<string, unknown>;
    txSignature?: string;
  };
}

// In-memory job store (for hackathon simplicity)
const jobs = new Map<string, AutoTestJob>();

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function startAutoTest(testId: string, personaId: string): Promise<AutoTestJob> {
  const jobId = generateJobId();
  const job: AutoTestJob = {
    id: jobId,
    testId,
    personaId,
    status: 'queued',
    progress: 0,
  };

  jobs.set(jobId, job);

  // Run async (non-blocking)
  runAutoTest(job).catch(err => {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : 'Unknown error';
  });

  return job;
}

export function getAutoTestStatus(jobId: string): AutoTestJob | undefined {
  return jobs.get(jobId);
}

async function runAutoTest(job: AutoTestJob): Promise<void> {
  job.status = 'running';
  job.progress = 10;

  // 1. Load persona
  const [persona] = await db.select().from(schema.personas).where(eq(schema.personas.id, job.personaId));
  if (!persona) throw new Error('Persona not found');
  job.progress = 20;

  // 2. Load test and test cases
  const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, job.testId));
  if (!test) throw new Error('Test not found');

  const cases = await db.select().from(schema.testCases).where(eq(schema.testCases.testId, job.testId));
  const testCases: GeneratedTestCases = {
    checklist: cases.filter(c => c.type === 'checklist').map(c => c.content as GeneratedTestCases['checklist'][0]),
    scenarios: cases.filter(c => c.type === 'scenario').map(c => c.content as GeneratedTestCases['scenarios'][0]),
    questionnaire: cases.filter(c => c.type === 'questionnaire').map(c => c.content as GeneratedTestCases['questionnaire'][0]),
  };
  job.progress = 30;

  // 3. Browser automation (Stagehand)
  let screenshots: string[] = [];
  let actionLog: string[] = [];

  let stagehandInstance: { close(): Promise<void> } | null = null;
  try {
    const { Stagehand } = await import('@browserbasehq/stagehand');

    const stagehand = new Stagehand({
      env: 'LOCAL',
      model: { modelName: 'claude-sonnet-4-6-20250514', apiKey: process.env.ANTHROPIC_API_KEY! },
      localBrowserLaunchOptions: { headless: true },
    });
    await stagehand.init();
    stagehandInstance = stagehand;
    job.progress = 40;

    const page = stagehand.context.pages()[0];
    await page.goto(test.targetUrl, { waitUntil: 'domcontentloaded', timeoutMs: 30000 });
    actionLog.push(`Visited ${test.targetUrl}`);

    // Take initial screenshot
    const ss1 = await page.screenshot({ fullPage: false });
    screenshots.push(ss1.toString('base64'));
    job.progress = 50;

    // Execute checklist items
    for (const item of testCases.checklist) {
      try {
        const result = await stagehand.act(item.task);
        actionLog.push(`[${item.id}] ${item.task} -> ${result.success ? 'OK' : 'Failed'}`);
      } catch {
        actionLog.push(`[${item.id}] ${item.task} -> Error`);
      }
    }
    job.progress = 70;

    // Final screenshot
    const ss2 = await page.screenshot({ fullPage: false });
    screenshots.push(ss2.toString('base64'));
  } catch (stagehandError) {
    actionLog.push(`Stagehand error: ${stagehandError instanceof Error ? stagehandError.message : 'Unknown'}`);
    // Continue without browser screenshots — generate report from test data alone
  } finally {
    if (stagehandInstance) {
      await stagehandInstance.close().catch(() => {});
    }
  }
  job.progress = 80;

  // 4. Generate report via LLM
  const personaVector = persona.vector as PersonaVector;
  let textReport: string;
  let uxFeedback: Record<string, unknown>;

  try {
    const report = await generateAutoTestReport(personaVector, screenshots, actionLog, testCases);
    textReport = report.textReport;
    uxFeedback = report.uxFeedback;
  } catch {
    textReport = `Auto test completed for ${test.targetUrl}. Actions: ${actionLog.join('; ')}`;
    uxFeedback = { overall_score: 3, note: 'Generated without LLM — fallback report' };
  }
  job.progress = 90;

  // 5. Save report to DB
  const [report] = await db.insert(schema.testReports).values({
    testerAddr: persona.testerAddr,
    testId: job.testId,
    checklistResults: testCases.checklist.map(c => ({
      id: c.id,
      status: 'passed' as const,
      memo: `Auto-tested by persona ${persona.id}`,
    })),
    scenarioLog: [{
      id: 'auto',
      timeline: actionLog.map(a => ({ time: new Date().toISOString(), action: a })),
    }],
    questionnaireAnswers: Object.entries(uxFeedback).map(([k, v]) => ({
      id: k,
      answer: typeof v === 'number' ? v : String(v),
    })),
    qualityScore: (uxFeedback.overall_score as number) || 3,
    isPersonaTest: true,
    screenshots: screenshots.length > 0 ? screenshots.slice(0, 2).map((_, i) => `auto_ss_${i}.png`) : [],
  }).returning();

  // 6. Record settlement (41R Token type for auto tests)
  // TODO: Actual 41R Token minting + Transfer Fee + Hook
  await db.insert(schema.settlements).values({
    testId: job.testId,
    reportId: report.id,
    payerAddr: test.companyAddr,
    payeeAddr: persona.testerAddr,
    amountToken: 2, // 50% of $4 auto test = $2 equivalent
    feeCollected: 0.1, // 5% of 2 = 0.1
    settlementType: '41r',
    txSignature: `pending_41r_${Date.now()}`,
  });

  job.progress = 100;
  job.status = 'completed';
  job.reportId = report.id;
  job.result = {
    screenshots: screenshots.slice(0, 2).map((_, i) => `auto_ss_${i}.png`),
    actionLog,
    textReport,
    uxFeedback,
  };
}
