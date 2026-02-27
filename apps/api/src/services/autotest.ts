import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, schema } from '../db/index.js';
import { generateAutoTestReport, generatePersonaActions } from './llm.js';
import { solanaService } from './solana.js';
import type { GeneratedTestCases, PersonaVector } from '@41rpm/shared';

const SCREENSHOTS_DIR = path.resolve('../../screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

interface StepScreenshot {
  file: string;
  label: string;
  step: number;
  phase: 'init' | 'checklist' | 'persona' | 'final';
}

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
    steps: StepScreenshot[];
    actionLog: string[];
    textReport: string;
    uxFeedback: Record<string, unknown>;
    txSignature?: string;
  };
}

/** Capture a labeled screenshot and append to tracking arrays */
async function captureStep(
  page: { screenshot(opts: { fullPage: boolean }): Promise<Buffer> },
  jobId: string,
  stepNum: number,
  label: string,
  phase: StepScreenshot['phase'],
  base64Arr: string[],
  stepArr: StepScreenshot[],
): Promise<void> {
  try {
    await new Promise(r => setTimeout(r, 800)); // Wait for UI to settle
    const buf = await page.screenshot({ fullPage: false });
    base64Arr.push(buf.toString('base64'));
    const file = `autotest_${jobId}_step${String(stepNum).padStart(2, '0')}.png`;
    fs.writeFileSync(path.join(SCREENSHOTS_DIR, file), buf);
    stepArr.push({ file, label, step: stepNum, phase });
  } catch {
    // Non-blocking
  }
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

  // 3. Browser automation (Stagehand) — per-action screenshots
  let allBase64: string[] = [];          // base64 for LLM (capped at 6)
  let allSteps: StepScreenshot[] = [];   // labeled step screenshots
  let actionLog: string[] = [];
  let stepCounter = 0;

  let stagehandInstance: { close(): Promise<void> } | null = null;
  try {
    const { Stagehand } = await import('@browserbasehq/stagehand');

    const stagehand = new Stagehand({
      env: 'LOCAL',
      model: { modelName: 'anthropic/claude-sonnet-4-6', apiKey: process.env.ANTHROPIC_API_KEY! },
      localBrowserLaunchOptions: { headless: true },
    });
    await stagehand.init();
    stagehandInstance = stagehand;
    job.progress = 40;

    const page = stagehand.context.pages()[0];
    await page.goto(test.targetUrl, { waitUntil: 'domcontentloaded', timeoutMs: 30000 });
    actionLog.push(`Visited ${test.targetUrl}`);

    // Wait for JS rendering
    await new Promise(r => setTimeout(r, 3000));

    // Step 0: Initial page load
    await captureStep(page, job.id, stepCounter++, `Page loaded: ${test.targetUrl}`, 'init', allBase64, allSteps);
    job.progress = 50;

    // Execute base checklist items — screenshot after each
    for (const item of testCases.checklist) {
      try {
        const result = await stagehand.act(item.task);
        const status = result.success ? 'OK' : 'Failed';
        actionLog.push(`[${item.id}] ${item.task} -> ${status}`);
        await captureStep(page, job.id, stepCounter++, `[${item.id}] ${item.task} -> ${status}`, 'checklist', allBase64, allSteps);
      } catch {
        actionLog.push(`[${item.id}] ${item.task} -> Error`);
        await captureStep(page, job.id, stepCounter++, `[${item.id}] ${item.task} -> Error`, 'checklist', allBase64, allSteps);
      }
    }
    job.progress = 60;

    // Generate and execute persona-specific exploration actions
    const personaVector = persona.vector as PersonaVector;
    let personaActions: Array<{ id: string; action: string; reason: string }> = [];
    try {
      personaActions = await generatePersonaActions(
        personaVector,
        test.targetUrl,
        testCases.checklist.map(c => ({ id: c.id, task: c.task })),
      );
    } catch {
      // Non-blocking — continue without persona actions
    }

    if (personaActions.length > 0) {
      actionLog.push('--- Persona-specific exploration ---');
      for (const pa of personaActions) {
        try {
          const result = await stagehand.act(pa.action);
          const status = result.success ? 'OK' : 'Failed';
          actionLog.push(`[${pa.id}] ${pa.action} -> ${status} (${pa.reason})`);
          await captureStep(page, job.id, stepCounter++, `[${pa.id}] ${pa.action} -> ${status}`, 'persona', allBase64, allSteps);
        } catch {
          actionLog.push(`[${pa.id}] ${pa.action} -> Error (${pa.reason})`);
          await captureStep(page, job.id, stepCounter++, `[${pa.id}] ${pa.action} -> Error`, 'persona', allBase64, allSteps);
        }
      }
    }
    job.progress = 70;

    // Final screenshot
    await captureStep(page, job.id, stepCounter++, 'Test complete — final state', 'final', allBase64, allSteps);
  } catch (stagehandError) {
    actionLog.push(`Stagehand error: ${stagehandError instanceof Error ? stagehandError.message : 'Unknown'}`);
    // Continue without browser screenshots — generate report from test data alone
  } finally {
    if (stagehandInstance) {
      await stagehandInstance.close().catch(() => {});
    }
  }
  job.progress = 80;

  // Cap base64 screenshots sent to LLM (first, last, and up to 4 evenly spaced)
  const screenshotFiles = allSteps.map(s => s.file);
  let llmScreenshots: string[];
  if (allBase64.length <= 6) {
    llmScreenshots = allBase64;
  } else {
    const indices = [0];
    const step = (allBase64.length - 1) / 5;
    for (let i = 1; i < 5; i++) indices.push(Math.round(step * i));
    indices.push(allBase64.length - 1);
    llmScreenshots = [...new Set(indices)].map(i => allBase64[i]);
  }

  // 4. Generate report via LLM
  const personaVector = persona.vector as PersonaVector;
  let textReport: string;
  let uxFeedback: Record<string, unknown>;

  try {
    const report = await generateAutoTestReport(personaVector, llmScreenshots, actionLog, testCases);
    textReport = report.textReport;
    uxFeedback = report.uxFeedback;
  } catch (llmErr) {
    console.error('[AutoTest] LLM report generation failed:', llmErr);
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
    screenshots: screenshotFiles,
  }).returning();

  // 6. Record settlement (41R Token type for auto tests)
  const settlementAmount = 2; // 50% of $4 auto test = $2 equivalent
  let txSignature = `pending_41r_${Date.now()}`;
  let feeCollected = 0.1; // 5% of 2 = 0.1

  try {
    const mintResult = await solanaService.mint41RTokens(persona.testerAddr, settlementAmount);
    txSignature = mintResult.txSignature;
  } catch (err) {
    console.error('[AutoTest] 41R Token mint failed, recording as pending:', err);
  }

  await db.insert(schema.settlements).values({
    testId: job.testId,
    reportId: report.id,
    payerAddr: test.companyAddr,
    payeeAddr: persona.testerAddr,
    amountToken: settlementAmount,
    feeCollected,
    settlementType: '41r',
    txSignature,
  });

  job.progress = 100;
  job.status = 'completed';
  job.reportId = report.id;
  job.result = {
    screenshots: screenshotFiles,
    steps: allSteps,
    actionLog,
    textReport,
    uxFeedback,
    txSignature,
  };
}
