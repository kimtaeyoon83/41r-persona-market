import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, schema } from '../db/index.js';
import { generateAutoTestReport, generatePersonaActions } from './llm.js';
import { solanaService } from './solana.js';
import { uploadToR2 } from './r2.js';
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
    // Upload to R2 (non-blocking), fall back to local fs
    const url = await uploadToR2(`screenshots/${file}`, buf);
    fs.writeFileSync(path.join(SCREENSHOTS_DIR, file), buf); // Local backup
    stepArr.push({ file: url, label, step: stepNum, phase });
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
      localBrowserLaunchOptions: {
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      },
    });
    await stagehand.init();
    stagehandInstance = stagehand;
    job.progress = 35;

    const page = stagehand.context.pages()[0];
    await page.goto(test.targetUrl, { waitUntil: 'domcontentloaded', timeoutMs: 30000 });
    actionLog.push(`Visited ${test.targetUrl}`);
    await new Promise(r => setTimeout(r, 3000));

    // Step 0: Initial page load
    await captureStep(page, job.id, stepCounter++, `Page loaded: ${test.targetUrl}`, 'init', allBase64, allSteps);
    job.progress = 40;

    // ─── Phase A: Site Discovery — find and visit different pages ───
    // Extract internal links from the current page
    const baseOrigin = new URL(test.targetUrl).origin;
    let discoveredLinks: string[] = [];
    try {
      discoveredLinks = await page.evaluate((origin: string) => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const hrefs = links
          .map(a => {
            try {
              const url = new URL((a as HTMLAnchorElement).href, origin);
              return url.origin === origin ? url.pathname : null;
            } catch { return null; }
          })
          .filter((p): p is string => p !== null && p !== '/' && p.length > 1);
        // Deduplicate and limit
        return [...new Set(hrefs)];
      }, baseOrigin);
    } catch {
      actionLog.push('[Discovery] Could not extract links from page');
    }

    // Also check for nav/menu items, buttons that might reveal more content
    let navLabels: string[] = [];
    try {
      navLabels = await page.evaluate(() => {
        const navItems = Array.from(document.querySelectorAll('nav a, [role="navigation"] a, header a, .nav a, .menu a, .sidebar a'));
        return navItems
          .map(el => (el as HTMLElement).textContent?.trim() || '')
          .filter(t => t.length > 1 && t.length < 30)
          .slice(0, 10);
      });
    } catch {
      // Non-blocking
    }

    // Visit up to 4 unique discovered pages (diverse screenshots)
    const visitedPaths = new Set<string>([new URL(test.targetUrl).pathname]);
    const pagesToVisit = discoveredLinks
      .filter(p => !visitedPaths.has(p))
      .filter(p => !p.includes('#') && !p.endsWith('.pdf') && !p.endsWith('.png') && !p.endsWith('.jpg'))
      .slice(0, 4);

    if (pagesToVisit.length > 0) {
      actionLog.push(`[Discovery] Found ${discoveredLinks.length} internal links, visiting ${pagesToVisit.length} pages`);
      for (const pagePath of pagesToVisit) {
        try {
          const fullUrl = `${baseOrigin}${pagePath}`;
          await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeoutMs: 15000 });
          await new Promise(r => setTimeout(r, 2000));
          visitedPaths.add(pagePath);
          actionLog.push(`[Discovery] Visited ${pagePath}`);
          await captureStep(page, job.id, stepCounter++, `Discovered page: ${pagePath}`, 'init', allBase64, allSteps);
        } catch {
          actionLog.push(`[Discovery] Failed to visit ${pagePath}`);
        }
      }
    } else if (navLabels.length > 0) {
      // No href links found (SPA) — try clicking nav items
      actionLog.push(`[Discovery] No link hrefs — trying ${navLabels.length} nav items via click`);
      const clickedLabels = new Set<string>();
      for (const label of navLabels.slice(0, 4)) {
        if (clickedLabels.has(label)) continue;
        try {
          const result = await stagehand.act(`Click the navigation item or link labeled "${label}"`);
          if (result.success) {
            await new Promise(r => setTimeout(r, 2000));
            clickedLabels.add(label);
            actionLog.push(`[Discovery] Clicked nav: "${label}"`);
            await captureStep(page, job.id, stepCounter++, `Nav: "${label}"`, 'init', allBase64, allSteps);
          }
        } catch {
          // Non-blocking
        }
      }
    }

    // Return to target URL for checklist execution
    if (pagesToVisit.length > 0 || navLabels.length > 0) {
      await page.goto(test.targetUrl, { waitUntil: 'domcontentloaded', timeoutMs: 15000 });
      await new Promise(r => setTimeout(r, 2000));
    }
    job.progress = 50;

    // ─── Phase B: Scroll-based exploration — capture different sections ───
    try {
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      if (pageHeight > viewportHeight * 2) {
        // Page is taller than 2 viewports — scroll and capture mid + bottom
        const scrollPositions = [
          { y: Math.round(pageHeight * 0.4), label: 'middle section' },
          { y: Math.round(pageHeight * 0.8), label: 'bottom section' },
        ];
        for (const pos of scrollPositions) {
          await page.evaluate((scrollY: number) => window.scrollTo(0, scrollY), pos.y);
          await new Promise(r => setTimeout(r, 1000));
          await captureStep(page, job.id, stepCounter++, `Scrolled to ${pos.label} (${pos.y}px)`, 'init', allBase64, allSteps);
          actionLog.push(`[Scroll] Captured ${pos.label} at ${pos.y}px`);
        }
        // Scroll back to top
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(r => setTimeout(r, 500));
      }
    } catch {
      // Non-blocking
    }
    job.progress = 55;

    // ─── Phase C: Execute checklist items with navigation context ───
    for (const item of testCases.checklist) {
      try {
        // Try the action — Stagehand may navigate as needed
        const result = await stagehand.act(item.task);
        const status = result.success ? 'OK' : 'Failed';
        actionLog.push(`[${item.id}] ${item.task} -> ${status}`);
        await captureStep(page, job.id, stepCounter++, `[${item.id}] ${item.task} -> ${status}`, 'checklist', allBase64, allSteps);
      } catch {
        actionLog.push(`[${item.id}] ${item.task} -> Error`);
        await captureStep(page, job.id, stepCounter++, `[${item.id}] ${item.task} -> Error`, 'checklist', allBase64, allSteps);
      }
    }
    job.progress = 65;

    // ─── Phase D: Persona-specific exploration with explicit navigation ───
    const personaVector = persona.vector as PersonaVector;
    let personaActions: Array<{ id: string; action: string; reason: string }> = [];
    try {
      personaActions = await generatePersonaActions(
        personaVector,
        test.targetUrl,
        testCases.checklist.map(c => ({ id: c.id, task: c.task })),
        discoveredLinks.slice(0, 8),
        navLabels.slice(0, 8),
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
    job.progress = 75;

    // Final screenshot (current state)
    await captureStep(page, job.id, stepCounter++, 'Test complete — final state', 'final', allBase64, allSteps);
  } catch (stagehandError) {
    const msg = stagehandError instanceof Error ? stagehandError.message : 'Unknown';
    actionLog.push(`Stagehand error: ${msg}`);
  } finally {
    if (stagehandInstance) {
      await stagehandInstance.close().catch(() => {});
    }
  }

  // If Stagehand never produced any screenshots, the browser never booted —
  // don't ask the LLM to fabricate "what the persona would have tested"
  // prose. Fail the job so the UI reports it honestly instead of surfacing
  // a glossy fake report with every checklist item "blocked, I would have…".
  if (allBase64.length === 0) {
    throw new Error(
      `autotest browser never booted (${actionLog.find((l) => l.startsWith('Stagehand error')) ?? 'no screenshots captured'})`,
    );
  }
  job.progress = 80;

  // Select diverse screenshots for LLM — pick from each phase, not just evenly spaced
  const screenshotFiles = allSteps.map(s => s.file);
  let llmScreenshots: string[];
  if (allBase64.length <= 8) {
    llmScreenshots = allBase64;
  } else {
    // Pick screenshots by phase to ensure diversity
    const byPhase = { init: [] as number[], checklist: [] as number[], persona: [] as number[], final: [] as number[] };
    allSteps.forEach((s, i) => byPhase[s.phase].push(i));

    const selected = new Set<number>();
    // Always include first (landing page) and last (final state)
    selected.add(0);
    if (allBase64.length > 1) selected.add(allBase64.length - 1);
    // Pick up to 2 discovery/scroll screenshots (different pages)
    for (const idx of byPhase.init.slice(1, 3)) selected.add(idx);
    // Pick 2 evenly-spaced checklist screenshots
    if (byPhase.checklist.length > 0) {
      selected.add(byPhase.checklist[0]);
      if (byPhase.checklist.length > 1) selected.add(byPhase.checklist[byPhase.checklist.length - 1]);
    }
    // Pick 1-2 persona screenshots
    for (const idx of byPhase.persona.slice(0, 2)) selected.add(idx);

    llmScreenshots = [...selected].sort((a, b) => a - b).slice(0, 8).map(i => allBase64[i]);
  }
  console.log(`[AutoTest] Total screenshots: ${allBase64.length}, sent to LLM: ${llmScreenshots.length}, phases: ${JSON.stringify(allSteps.reduce((acc, s) => { acc[s.phase] = (acc[s.phase] || 0) + 1; return acc; }, {} as Record<string, number>))}`);

  // 4. Generate report via LLM (with persona-specific analysis)
  const personaVector = persona.vector as PersonaVector;
  let textReport: string;
  let uxFeedback: Record<string, unknown>;
  let llmChecklistResults: Array<{ id: string; status: 'passed' | 'failed' | 'blocked'; memo: string }> = [];
  let llmQuestionnaireAnswers: Array<{ id: string; answer: string | number }> = [];
  let qualityScore = 3;

  try {
    const llmReport = await generateAutoTestReport(personaVector, llmScreenshots, actionLog, testCases);
    textReport = llmReport.textReport;
    uxFeedback = llmReport.uxFeedback;
    llmChecklistResults = llmReport.checklistResults;
    llmQuestionnaireAnswers = llmReport.questionnaireAnswers;
    qualityScore = llmReport.qualityScore;
  } catch (llmErr) {
    console.error('[AutoTest] LLM report generation failed:', llmErr);
    textReport = `Auto test completed for ${test.targetUrl}. Actions: ${actionLog.join('; ')}`;
    uxFeedback = { overall_score: 3, note: 'Generated without LLM — fallback report' };

    // Fallback: derive checklist status from action log
    llmChecklistResults = testCases.checklist.map(c => {
      const logEntry = actionLog.find(a => a.includes(`[${c.id}]`));
      let status: 'passed' | 'failed' | 'blocked' = 'blocked';
      if (logEntry) {
        status = logEntry.includes('-> OK') ? 'passed' : 'failed';
      }
      return { id: c.id, status, memo: logEntry || `Auto-tested by persona ${persona.id}` };
    });
  }
  job.progress = 90;

  // 5. Save report to DB (using LLM-generated persona-specific results)
  const [report] = await db.insert(schema.testReports).values({
    testerAddr: persona.testerAddr,
    testId: job.testId,
    checklistResults: llmChecklistResults.length > 0
      ? llmChecklistResults
      : testCases.checklist.map(c => {
          const logEntry = actionLog.find(a => a.includes(`[${c.id}]`));
          const status = logEntry?.includes('-> OK') ? 'passed' as const : 'failed' as const;
          return { id: c.id, status, memo: logEntry || c.task };
        }),
    scenarioLog: [{
      id: 'auto',
      timeline: actionLog.map(a => ({ time: new Date().toISOString(), action: a })),
    }],
    questionnaireAnswers: llmQuestionnaireAnswers.length > 0
      ? llmQuestionnaireAnswers
      : Object.entries(uxFeedback)
          .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
          .map(([k, v]) => ({ id: k, answer: typeof v === 'number' ? v : String(v) })),
    qualityScore,
    isPersonaTest: true,
    screenshots: screenshotFiles,
  }).returning();

  // 6. Settlement: USDC reward + 41R Token bonus
  const settlementAmount = test.rewardPerTester;
  const feeCollected = settlementAmount * 0.05; // 5% fee

  // 6a. Transfer USDC reward from company budget
  let usdcTxSignature = `pending_usdc_${Date.now()}`;
  try {
    const usdcResult = await solanaService.transferUsdc(persona.testerAddr, settlementAmount);
    usdcTxSignature = usdcResult.txSignature;
  } catch (err) {
    console.error('[AutoTest] USDC transfer failed, recording as pending:', err);
  }

  await db.insert(schema.settlements).values({
    testId: job.testId,
    reportId: report.id,
    payerAddr: test.companyAddr,
    payeeAddr: persona.testerAddr,
    amountToken: settlementAmount,
    feeCollected,
    settlementType: 'usdc',
    txSignature: usdcTxSignature,
  });

  // 6b. Mint 41R Token as performance bonus
  let tokenTxSignature = `pending_41r_${Date.now()}`;
  try {
    const mintResult = await solanaService.mint41RTokens(persona.testerAddr, settlementAmount);
    tokenTxSignature = mintResult.txSignature;
  } catch (err) {
    console.error('[AutoTest] 41R Token mint failed, recording as pending:', err);
  }

  await db.insert(schema.settlements).values({
    testId: job.testId,
    reportId: report.id,
    payerAddr: test.companyAddr,
    payeeAddr: persona.testerAddr,
    amountToken: settlementAmount,
    feeCollected: feeCollected,
    settlementType: '41r',
    txSignature: tokenTxSignature,
  });

  // Deduct from test budget
  await db.update(schema.tests)
    .set({ budgetUsdc: test.budgetUsdc - settlementAmount })
    .where(eq(schema.tests.id, job.testId));

  job.progress = 100;
  job.status = 'completed';
  job.reportId = report.id;
  job.result = {
    screenshots: screenshotFiles,
    steps: allSteps,
    actionLog,
    textReport,
    uxFeedback,
    txSignature: usdcTxSignature,
  };
}
