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
// persona_agent's SessionLog dataclass serialised to dict. Optional
// page_text/url/title/a11y fields populate when the runner captures
// bookend page state (2026-04-22 enrichment — without them the
// scoring adapter falls back to keyword matching).
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
    observation: {
      summary: string;
      page_text?: string;
      url?: string;
      title?: string;
      a11y?: string;
    };
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
 * Capture rich page state for a session_log turn. Runs Playwright reads
 * (url/title/innerText/a11y snapshot) so the scoring adapters have real
 * evidence instead of "visited URL" one-liners. All reads are wrapped
 * in try/catch — page can navigate away mid-call and we'd rather ship
 * a partial snapshot than drop the whole turn.
 */
async function capturePageState(page: unknown): Promise<{
  url: string;
  title: string;
  text: string;
  a11y: string;
}> {
  const p = page as {
    url(): string;
    title(): Promise<string>;
    innerText(sel: string, opts?: unknown): Promise<string>;
    accessibility: { snapshot(opts?: { interestingOnly?: boolean }): Promise<unknown> };
  };
  let url = '';
  let title = '';
  let text = '';
  let a11y = '';
  try { url = p.url(); } catch { /* ignore */ }
  try { title = await p.title(); } catch { /* ignore */ }
  try {
    const t = await p.innerText('body', { timeout: 2000 } as unknown as Record<string, unknown>);
    text = String(t).slice(0, 1500);
  } catch { /* ignore */ }
  try {
    const tree = await p.accessibility.snapshot({ interestingOnly: true });
    a11y = JSON.stringify(tree).slice(0, 4000);
  } catch { /* ignore */ }
  return { url, title, text, a11y };
}

/**
 * Map Stagehand's agent result into our SessionLog shape.
 *
 * Stagehand v3 non-streaming ``agent.execute()`` returns ``actions[]``
 * with reasoning + instruction per step, but does NOT surface mid-run
 * page state. To get evidence-based scoring we bookend the session
 * with rich snapshots (turn 0 = pre-agent, final turn = post-agent)
 * and preserve per-action reasoning in between.
 */
function actionsToTurns(
  actions: Array<Record<string, unknown>>,
  bookends: { initial: { url: string; title: string; text: string; a11y: string }; final: { url: string; title: string; text: string; a11y: string } },
): HybridSessionLog['turns'] {
  const turns: HybridSessionLog['turns'] = [];

  // Turn 0: pre-agent page state. Gives the scoring LLM a baseline of
  // what the persona saw when they landed on the page.
  turns.push({
    turn: 0,
    observation: {
      summary: bookends.initial.text
        ? `초기 페이지 상태 — ${bookends.initial.title || bookends.initial.url}: ${bookends.initial.text.slice(0, 400)}`
        : `visited ${bookends.initial.url || '(unknown)'}`,
      page_text: bookends.initial.text,
      url: bookends.initial.url,
      title: bookends.initial.title,
      a11y: bookends.initial.a11y,
    },
    decision: { action: 'goto', reasoning: 'initial navigation', done: false },
    tool: { tool: 'goto', target: bookends.initial.url },
  });

  // Middle turns: one per agent action. observation stays thin because
  // Stagehand doesn't give us per-step page state, but decision carries
  // the reasoning + instruction so the LLM can follow the agent's path.
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const action = String(a.action ?? a.type ?? 'read');
    const instruction = typeof a.instruction === 'string' ? a.instruction : undefined;
    const reasoning = typeof a.reasoning === 'string' ? a.reasoning : '';
    const pageUrl = typeof a.pageUrl === 'string' ? a.pageUrl : '';
    const pageText = typeof a.pageText === 'string' ? a.pageText : '';

    turns.push({
      turn: turns.length,
      observation: {
        summary: pageText
          ? pageText.slice(0, 500)
          : reasoning
            ? `[에이전트 판단] ${reasoning.slice(0, 300)}${instruction ? ` / instruction=${instruction.slice(0, 120)}` : ''}`
            : pageUrl
              ? `visited ${pageUrl}`
              : `action=${action}${instruction ? ` (${instruction.slice(0, 80)})` : ''}`,
        page_text: pageText,
        url: pageUrl,
      },
      decision: { action, reasoning, instruction, done: Boolean(a.taskCompleted) },
      tool: { tool: action, target: instruction ?? '' },
    });
  }

  // Final turn: post-agent page state. This is where the scoring LLM
  // finds the real evidence — if the agent ended on a checkout page,
  // this turn's text/a11y will reflect that.
  turns.push({
    turn: turns.length,
    observation: {
      summary: bookends.final.text
        ? `최종 페이지 상태 — ${bookends.final.title || bookends.final.url}: ${bookends.final.text.slice(0, 400)}`
        : `ended at ${bookends.final.url || '(unknown)'}`,
      page_text: bookends.final.text,
      url: bookends.final.url,
      title: bookends.final.title,
      a11y: bookends.final.a11y,
    },
    decision: { action: 'observe', reasoning: 'post-agent final state', done: true },
    tool: { tool: 'observe', target: bookends.final.url },
  });

  return turns;
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

  let initialState = { url: args.url, title: '', text: '', a11y: '' };
  let finalState = { url: args.url, title: '', text: '', a11y: '' };

  try {
    const page = stagehand.context.pages()[0];
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeoutMs: 30_000 });

    // Capture initial page state (url/title/text/a11y) for turn 0 —
    // gives the scoring adapter a real baseline to compare against the
    // post-agent state.
    initialState = await capturePageState(page);

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

    // Capture final page state for the last turn. Same motivation as
    // initialState — without this the scoring adapter only sees the
    // thin decision reasoning, not the actual UI that ended the run.
    finalState = await capturePageState(page);

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

  const turns = actionsToTurns(actions, { initial: initialState, final: finalState });
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
