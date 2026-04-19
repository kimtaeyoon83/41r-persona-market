/**
 * Stagehand-hybrid autotest runner.
 *
 * Uses Browserbase Stagehand (LOCAL env) to execute the browser
 * session — action selection + Playwright execution are handled
 * inside Stagehand's agent. We wrap the result into a
 * persona-engine-compatible ``SessionLog`` dict and hand it to
 * ``POST /analyses/score`` so the downstream evaluation (checklist,
 * questionnaire, structured_report) stays centralised in Python.
 *
 * Why hybrid:
 *   - Stagehand's agent loop is significantly cheaper per action than
 *     persona_agent's custom vision+page_summarizer+decision_judge
 *     pipeline (internal benchmarks: ~2-3¢/turn vs ~5.5¢).
 *   - persona_agent still owns the parts that actually express the
 *     persona — checklist judgment, questionnaire answers, and the
 *     structured report — so the persona voice is preserved.
 */
import fs from 'node:fs';
import path from 'node:path';

const USAGE_LOG_PATH = process.env.USAGE_LOG_PATH || '/tmp/llm-usage.jsonl';

// Log Stagehand's own Anthropic usage (not captured by anthropic_client.ts,
// which wraps @anthropic-ai/sdk — Stagehand uses @ai-sdk/anthropic internally).
// Numbers come from the stagehand.metrics accessor post-run.
function logStagehandUsage(
  sessionId: string,
  metrics: Record<string, number>,
): void {
  const rows = [
    { route: 'stagehand.agent', prompt: metrics.agentPromptTokens, completion: metrics.agentCompletionTokens, cached: metrics.agentCachedInputTokens, ms: metrics.agentInferenceTimeMs },
    { route: 'stagehand.act',   prompt: metrics.actPromptTokens,   completion: metrics.actCompletionTokens,   cached: metrics.actCachedInputTokens,   ms: metrics.actInferenceTimeMs },
    { route: 'stagehand.extract', prompt: metrics.extractPromptTokens, completion: metrics.extractCompletionTokens, cached: metrics.extractCachedInputTokens, ms: metrics.extractInferenceTimeMs },
    { route: 'stagehand.observe', prompt: metrics.observePromptTokens, completion: metrics.observeCompletionTokens, cached: metrics.observeCachedInputTokens, ms: metrics.observeInferenceTimeMs },
  ];
  for (const r of rows) {
    if (!r.prompt && !r.completion) continue; // skip routes not used this run
    const entry = {
      ts: Date.now() / 1000,
      service: 'stagehand',
      route: r.route,
      request_id: sessionId,
      model: 'claude-sonnet-4-6', // Stagehand is configured for this
      input_tokens: r.prompt || 0,
      output_tokens: r.completion || 0,
      cache_read_tokens: r.cached || 0,
      cache_creation_tokens: 0,
      duration_ms: r.ms || 0,
      prompt_hash: 'stagehand-aggregate',
      prompt_preview: `Stagehand ${r.route} (aggregate over session)`,
    };
    try {
      fs.appendFileSync(USAGE_LOG_PATH, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      /* non-fatal */
    }
  }
}

// Minimal shape the persona-engine adapter tolerates. Mirrors
// persona_agent's SessionLog dataclass serialised to dict.
export interface HybridSessionLog {
  session_id: string;
  persona_id: string;
  url: string;
  task: string;
  mode: 'browser';
  outcome: string;
  total_turns: number;
  start_time: string;
  end_time: string;
  duration_sec: number;
  turns: Array<{
    turn: number;
    observation: { summary: string };
    decision: {
      action?: string;
      reasoning?: string;
      instruction?: string;
      done?: boolean;
    };
    tool: { tool: string; target?: string } | null;
  }>;
  screenshot_paths: string[];
}

export interface RunHybridArgs {
  personaId: string;
  personaOneliner: string;       // short persona voice prefix, e.g. "a cautious 40yo banker in India"
  url: string;
  task: string;
  /** absolute dir for saving per-turn screenshot PNGs — written for parity
   *  with persona_agent's layout so R2 upload logic works unchanged */
  screenshotsDir: string;
  maxSteps?: number;
}

export interface RunHybridResult {
  sessionLog: HybridSessionLog;
  screenshotPaths: string[];     // absolute fs paths, in turn order
}

/**
 * Map Stagehand's agent result into our SessionLog shape.
 * Stagehand emits an ``actions[]`` array where each action has
 * ``type``, ``reasoning``, ``instruction``, ``pageUrl`` etc. We split
 * each action into a ``turn`` with observation + decision + tool.
 */
function actionsToTurns(
  actions: Array<Record<string, unknown>>,
): HybridSessionLog['turns'] {
  return actions.map((a, idx) => {
    const action = String(a.action ?? a.type ?? 'read');
    const instruction = typeof a.instruction === 'string' ? a.instruction : undefined;
    const reasoning = typeof a.reasoning === 'string' ? a.reasoning : '';
    const pageUrl = typeof a.pageUrl === 'string' ? a.pageUrl : '';
    const pageText = typeof a.pageText === 'string' ? a.pageText : '';

    return {
      turn: idx,
      observation: {
        summary: pageText
          ? pageText.slice(0, 500)
          : pageUrl
            ? `visited ${pageUrl}`
            : 'stagehand observation',
      },
      decision: {
        action,
        reasoning,
        instruction,
        done: Boolean(a.taskCompleted),
      },
      tool: { tool: action, target: instruction ?? '' },
    };
  });
}

export async function runStagehandHybrid(
  args: RunHybridArgs,
): Promise<RunHybridResult> {
  const { Stagehand } = await import('@browserbasehq/stagehand');

  const started = Date.now();
  const sessionId = `sh_${Math.random().toString(36).slice(2, 10)}`;
  fs.mkdirSync(args.screenshotsDir, { recursive: true });

  const stagehand = new Stagehand({
    env: 'LOCAL',
    model: {
      modelName: 'anthropic/claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    localBrowserLaunchOptions: {
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      viewport: { width: 1280, height: 800 },
    },
  });

  await stagehand.init();
  const screenshotPaths: string[] = [];
  const actions: Array<Record<string, unknown>> = [];
  let outcome = 'task_complete';
  let endIso = '';

  try {
    const page = stagehand.context.pages()[0];
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeoutMs: 30_000 });

    // Capture an initial screenshot before the agent takes any action
    const initialShot = path.join(args.screenshotsDir, `turn_00.png`);
    try {
      const buf = await page.screenshot({ fullPage: false, type: 'png' });
      fs.writeFileSync(initialShot, buf);
      screenshotPaths.push(initialShot);
    } catch {
      /* non-blocking */
    }

    // Persona-flavoured instructions guide the agent's action choices.
    // The agent itself handles its own multi-step reasoning loop; we
    // don't loop on our side — Stagehand's action selection is what
    // we're trying to benchmark.
    const agent = stagehand.agent({
      model: 'anthropic/claude-sonnet-4-6',
      systemPrompt: [
        `You are testing a website as ${args.personaOneliner}.`,
        `Focus on real UX issues a human tester would flag.`,
        `If you can't complete the task in a few steps, explain why.`,
        `Be efficient — do the task, don't explore tangents.`,
      ].join(' '),
    });

    const result = await agent.execute({
      instruction: args.task,
      maxSteps: args.maxSteps ?? 8,
    });

    // Non-streaming agent returns AgentResult whose shape includes
    // actions[]; the typed union also allows AgentStreamResult so we
    // cast through unknown.
    const r = result as unknown as { actions?: unknown; completed?: boolean };
    if (Array.isArray(r.actions)) {
      actions.push(...(r.actions as Array<Record<string, unknown>>));
    }

    // Post-run screenshot
    try {
      const finalShot = path.join(args.screenshotsDir, `turn_${String(screenshotPaths.length).padStart(2, '0')}.png`);
      const buf = await page.screenshot({ fullPage: false, type: 'png' });
      fs.writeFileSync(finalShot, buf);
      screenshotPaths.push(finalShot);
    } catch {
      /* non-blocking */
    }

    if (r.completed === false) outcome = 'partial';

    // Pull Stagehand's own metrics so the unified usage log reflects
    // both sides of the hybrid cost (Stagehand + persona-engine).
    try {
      const m = (await stagehand.metrics) as unknown as Record<string, number>;
      if (m) logStagehandUsage(sessionId, m);
    } catch {
      /* metrics fetch is best-effort */
    }
  } catch (err) {
    outcome = 'error';
    console.warn('[stagehand_hybrid] run failed:', err instanceof Error ? err.message : err);
  } finally {
    try { await stagehand.close(); } catch { /* ignore */ }
    endIso = new Date().toISOString();
  }

  const turns = actionsToTurns(actions);
  const durationSec = Math.max(0.001, (Date.now() - started) / 1000);

  const sessionLog: HybridSessionLog = {
    session_id: sessionId,
    persona_id: args.personaId,
    url: args.url,
    task: args.task,
    mode: 'browser',
    outcome,
    total_turns: turns.length,
    start_time: new Date(started).toISOString(),
    end_time: endIso,
    duration_sec: Number(durationSec.toFixed(3)),
    turns,
    screenshot_paths: screenshotPaths,
  };

  return { sessionLog, screenshotPaths };
}
