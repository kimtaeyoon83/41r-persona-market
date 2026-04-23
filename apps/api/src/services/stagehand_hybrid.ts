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

/** Checklist item shape the hybrid runner accepts. Matches the upstream
 *  test_cases.content for ``type='checklist'`` — narrow copy so we don't
 *  depend on the drizzle schema from this services file. */
export interface HybridChecklistItem {
  id: string;
  task: string;
  expected?: string;
}

export interface RunHybridArgs {
  personaId: string;
  personaOneliner: string;       // short persona voice prefix, e.g. "a cautious 40yo banker in India"
  url: string;
  task: string;
  /** absolute dir for saving per-turn screenshot PNGs — written for parity
   *  with persona_agent's layout so R2 upload logic works unchanged */
  screenshotsDir: string;
  /** Checklist items the persona should try to verify one-by-one in Phase C.
   *  Each item becomes a dedicated ``stagehand.act(item.task)`` turn with its
   *  own screenshot — scoring adapters then have a direct per-item mapping
   *  rather than inferring checklist status from a blob of agent actions. */
  checklist?: HybridChecklistItem[];
  /** Persona vector used to generate persona-specific exploration actions
   *  in Phase D (e.g. a security-focused persona will inspect trust
   *  signals). Pass ``undefined`` to skip Phase D. Shape mirrors
   *  schema.personas.vector. Using ``unknown`` here to keep this module
   *  decoupled from the drizzle types. */
  personaVector?: unknown;
  /** DEPRECATED — left for back-compat with old callers. The new
   *  phase-based loop doesn't use a single agent.execute maxSteps cap;
   *  turn count is determined by checklist length + persona action count
   *  + discovery/scroll phases. */
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
  // Every Playwright read is raced against a short cap because on
  // wedged browsers these methods can block forever. iter1: previously
  // `p.title()` etc were awaited without a timeout, so a single stuck
  // page operation would hang the whole sequential chain (observed on
  // vercel.com test 243d289d).
  let url = '';
  let title = '';
  let text = '';
  let a11y = '';
  try { url = p.url(); } catch { /* ignore */ }
  try { title = await raceWithTimeout(p.title(), 3_000, 'page.title'); } catch { /* ignore */ }
  try {
    const t = await raceWithTimeout(
      p.innerText('body', { timeout: 2000 } as unknown as Record<string, unknown>),
      4_000,
      'page.innerText',
    );
    text = String(t).slice(0, 1500);
  } catch { /* ignore */ }
  try {
    const tree = await raceWithTimeout(
      p.accessibility.snapshot({ interestingOnly: true }),
      6_000,
      'accessibility.snapshot',
    );
    a11y = JSON.stringify(tree).slice(0, 4000);
  } catch { /* ignore */ }
  return { url, title, text, a11y };
}

/**
 * Phase-driven hybrid runner. We drive the browser loop ourselves
 * (rather than delegating to Stagehand's opaque ``agent.execute``) so
 * each turn maps 1:1 to a visible action and a persisted screenshot.
 *
 * Phases (inspired by the legacy services/autotest.ts pattern, commit
 * f6921ef "feat: per-action screenshot timeline in auto test"):
 *
 *   Phase A: Site discovery — crawl up to 4 internal links or nav
 *            items, one screenshot per page (bounded by MAX_DISCOVERY).
 *   Phase B: Scroll exploration — if the page is taller than ~2
 *            viewports, scroll to mid + bottom and capture each.
 *   Phase C: Checklist verification — for every checklist item, fire
 *            one ``stagehand.act(item.task)`` and snap the resulting
 *            state. This gives the scoring adapter an explicit per-item
 *            entry to judge instead of inferring from a blob of agent
 *            actions.
 *   Phase D: Persona-specific exploration — generatePersonaActions
 *            produces 3-5 actions tailored to the persona's feedback
 *            bias (security-aware → inspect trust signals, etc.) and
 *            we execute each via ``stagehand.act``.
 *
 * Expected turn/screenshot count: 1 (initial) + up to 4 (A) + 0-2 (B)
 * + N (C, one per checklist) + 0-5 (D) + 1 (final) = ~8-20.
 *
 * Bookend turns (initial + final) capture url/title/innerText/a11y so
 * the scoring LLM has a full-page baseline. Middle turns capture just
 * url + title (cheap) alongside the action log.
 */
async function capturePageStateLite(
  page: unknown,
): Promise<{ url: string; title: string }> {
  const p = page as { url(): string; title(): Promise<string> };
  let url = '';
  let title = '';
  try { url = p.url(); } catch { /* ignore */ }
  try { title = await raceWithTimeout(p.title(), 3_000, 'page.title (lite)'); } catch { /* ignore */ }
  return { url, title };
}

const MAX_DISCOVERY = 4;

/** Per-action cap. Stagehand v3 has no built-in act timeout, and on
 *  sites with aggressive redirects (together.ai → signin) we've seen
 *  individual stagehand.act() calls hang indefinitely. Wrapping each
 *  call with a 30s race gives the phase loop a chance to move on. */
const ACT_TIMEOUT_MS = 30_000;
/** Absolute session cap. If the whole run goes silent (browser wedged,
 *  Playwright CDP frozen) this ceiling lets the caller recover and the
 *  sequential chain's next persona still gets its turn. */
const RUN_TIMEOUT_MS = 5 * 60 * 1000;

class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`timeout after ${ms}ms: ${label}`);
    this.name = 'TimeoutError';
  }
}

function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(label, ms)), ms),
    ),
  ]);
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
  const turns: HybridSessionLog['turns'] = [];
  let outcome: string = 'task_complete';
  let endIso = '';

  // Absolute run-level deadline. If any phase hangs past this we bail
  // with outcome='patience_exceeded' and let the sequential chain's
  // next persona start. Before this, a single stuck act() could lock
  // the whole auto-queue (observed on together.ai test 5ea07fde).
  const runDeadline = Date.now() + RUN_TIMEOUT_MS;
  const deadlineExceeded = () => Date.now() > runDeadline;

  // Hard-cut safety net. The deadline checks above only fire at phase
  // boundaries; if a single stagehand.act() / page.screenshot hangs
  // INSIDE a phase, the in-flight await never unwinds. This timer
  // forcibly closes the browser context when the ceiling hits — any
  // pending page.* call then rejects with "browser has been closed",
  // which captures catches into the outer try block and the run exits
  // with outcome='patience_exceeded'. Iter1 fix for the vercel.com
  // test 243d289d chain-wedge.
  let hardCut = false;
  const hardCutTimer = setTimeout(() => {
    hardCut = true;
    outcome = 'patience_exceeded';
    console.warn(`[stagehand_hybrid] run hard-cut at ${RUN_TIMEOUT_MS}ms for persona ${args.personaId}`);
    stagehand.close().catch(() => { /* swallow — close errors during hard-cut are expected */ });
  }, RUN_TIMEOUT_MS);

  // Per-turn capture helper. Takes a screenshot, reads light page state
  // (url + title), and appends to turns[]. Rich state (innerText/a11y)
  // only captured when the caller passes captureRich=true, because
  // innerText + a11y snapshots together take ~300-800ms each and we
  // don't want that on every turn of a 20-turn session.
  async function captureTurn(opts: {
    page: unknown;
    action: string;
    reasoning: string;
    instruction?: string;
    target?: string;
    done?: boolean;
    captureRich?: boolean;
    outcomeTag?: 'ok' | 'failed' | 'error' | null;
  }) {
    const turnIdx = turns.length;
    // Screenshot — wrapped in raceWithTimeout because on wedged pages
    // (observed on together.ai + vercel.com after stagehand.act timeouts)
    // page.screenshot can hang indefinitely. 5s cap is enough for a
    // non-fullPage PNG; any longer means the renderer is stuck.
    try {
      const shot = path.join(
        args.screenshotsDir,
        `turn_${turnIdx.toString().padStart(2, '0')}.png`,
      );
      const buf = await raceWithTimeout(
        (opts.page as { screenshot(o: { fullPage: boolean; type: 'png' }): Promise<Buffer> })
          .screenshot({ fullPage: false, type: 'png' }),
        5_000,
        `page.screenshot turn_${turnIdx}`,
      );
      fs.writeFileSync(shot, buf);
      screenshotPaths.push(shot);
    } catch {
      /* non-blocking — the turn still gets logged with whatever state we have */
    }

    const obs = opts.captureRich
      ? await capturePageState(opts.page)
      : { ...(await capturePageStateLite(opts.page)), text: '', a11y: '' };

    const label = opts.instruction ?? opts.target ?? opts.action;
    const resultSuffix = opts.outcomeTag ? ` → ${opts.outcomeTag}` : '';
    const baseSummary = `[${opts.action}] ${label}${resultSuffix}`;
    const richSuffix = obs.text ? ` — ${obs.title || obs.url}: ${obs.text.slice(0, 300)}` : '';

    turns.push({
      turn: turnIdx,
      observation: {
        summary: baseSummary + richSuffix,
        page_text: obs.text || undefined,
        url: obs.url || undefined,
        title: obs.title || undefined,
        a11y: obs.a11y || undefined,
      },
      decision: {
        action: opts.action,
        reasoning: opts.reasoning,
        instruction: opts.instruction,
        done: opts.done ?? false,
      },
      tool: { tool: opts.action, target: opts.target ?? opts.instruction ?? '' },
    });
  }

  try {
    const page = stagehand.context.pages()[0];

    // ── Initial navigation (turn 0, rich capture) ──
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeoutMs: 30_000 });
    await new Promise((r) => setTimeout(r, 1_500));
    await captureTurn({
      page,
      action: 'goto',
      reasoning: 'initial navigation',
      instruction: args.url,
      target: args.url,
      captureRich: true,
    });

    // ── Phase A: Site discovery ──
    const baseOrigin = new URL(args.url).origin;
    let discoveredLinks: string[] = [];
    let navLabels: string[] = [];
    try {
      discoveredLinks = await page.evaluate((origin: string) => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const paths = links
          .map((a) => {
            try {
              const u = new URL((a as HTMLAnchorElement).href, origin);
              return u.origin === origin ? u.pathname : null;
            } catch {
              return null;
            }
          })
          .filter((p): p is string => p !== null && p !== '/' && p.length > 1);
        return [...new Set(paths)];
      }, baseOrigin);
    } catch {
      /* non-blocking */
    }
    try {
      navLabels = await page.evaluate(() => {
        const items = Array.from(
          document.querySelectorAll(
            'nav a, [role="navigation"] a, header a, .nav a, .menu a, .sidebar a',
          ),
        );
        return items
          .map((el) => (el as HTMLElement).textContent?.trim() || '')
          .filter((t) => t.length > 1 && t.length < 30)
          .slice(0, 10);
      });
    } catch {
      /* non-blocking */
    }

    const visitedPaths = new Set<string>([new URL(args.url).pathname]);
    const toVisit = discoveredLinks
      .filter((p) => !visitedPaths.has(p))
      .filter((p) => !p.includes('#') && !/\.(pdf|png|jpg|jpeg|gif|svg)$/i.test(p))
      .slice(0, MAX_DISCOVERY);

    if (toVisit.length > 0) {
      for (const pagePath of toVisit) {
        try {
          await page.goto(`${baseOrigin}${pagePath}`, {
            waitUntil: 'domcontentloaded',
            timeoutMs: 15_000,
          });
          await new Promise((r) => setTimeout(r, 1_500));
          visitedPaths.add(pagePath);
          await captureTurn({
            page,
            action: 'goto',
            reasoning: 'phase_a_discovery',
            instruction: pagePath,
            target: pagePath,
          });
        } catch {
          /* non-blocking, just log the skip in action log */
        }
      }
    } else if (navLabels.length > 0) {
      // No href-based discovery worked (likely an SPA) — click nav items instead.
      const clicked = new Set<string>();
      for (const label of navLabels.slice(0, MAX_DISCOVERY)) {
        if (clicked.has(label)) continue;
        try {
          const result = (await raceWithTimeout(
            stagehand.act(
              `Click the navigation item or link labeled "${label}"`,
            ),
            ACT_TIMEOUT_MS,
            `phase_a nav "${label}"`,
          )) as { success?: boolean };
          await new Promise((r) => setTimeout(r, 1_500));
          clicked.add(label);
          await captureTurn({
            page,
            action: 'act',
            reasoning: 'phase_a_discovery_nav',
            instruction: `Click nav "${label}"`,
            target: label,
            outcomeTag: result?.success ? 'ok' : 'failed',
          });
        } catch (err) {
          console.warn(
            `[stagehand_hybrid] phase_a nav "${label}" skipped:`,
            err instanceof Error ? err.message : err,
          );
          await captureTurn({
            page,
            action: 'act',
            reasoning: 'phase_a_discovery_nav (timed out)',
            instruction: `Click nav "${label}"`,
            target: label,
            outcomeTag: 'error',
          });
        }
      }
    }

    // Return to the target URL so Phase C starts clean.
    if (toVisit.length > 0 || navLabels.length > 0) {
      try {
        await page.goto(args.url, { waitUntil: 'domcontentloaded', timeoutMs: 15_000 });
        await new Promise((r) => setTimeout(r, 1_500));
      } catch {
        /* non-blocking */
      }
    }

    // ── Phase B: Scroll exploration ──
    try {
      const pageHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      if (pageHeight > viewportHeight * 2) {
        for (const pos of [
          { y: Math.round(pageHeight * 0.4), label: 'middle section' },
          { y: Math.round(pageHeight * 0.8), label: 'bottom section' },
        ]) {
          try {
            await page.evaluate((y: number) => window.scrollTo(0, y), pos.y);
            await new Promise((r) => setTimeout(r, 800));
            await captureTurn({
              page,
              action: 'scroll',
              reasoning: 'phase_b_scroll',
              instruction: pos.label,
              target: `${pos.y}px`,
            });
          } catch {
            /* non-blocking */
          }
        }
        try {
          await page.evaluate(() => window.scrollTo(0, 0));
          await new Promise((r) => setTimeout(r, 300));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* non-blocking */
    }

    // ── Phase C: Checklist verification ──
    // Each item gets its own stagehand.act call + dedicated screenshot.
    // If the checklist is empty the scoring adapter still gets bookend
    // + Phase A/B turns and will fall through to outcome-only scoring.
    if (deadlineExceeded()) {
      outcome = 'patience_exceeded';
      console.warn('[stagehand_hybrid] run deadline exceeded before Phase C');
    }
    for (const item of args.checklist ?? []) {
      if (deadlineExceeded()) {
        outcome = 'patience_exceeded';
        break;
      }
      try {
        const res = (await raceWithTimeout(
          stagehand.act(item.task),
          ACT_TIMEOUT_MS,
          `checklist ${item.id}`,
        )) as { success?: boolean };
        await captureTurn({
          page,
          action: 'act',
          reasoning: `checklist ${item.id}`,
          instruction: item.task,
          target: item.id,
          outcomeTag: res?.success ? 'ok' : 'failed',
        });
      } catch (err) {
        console.warn(
          `[stagehand_hybrid] checklist ${item.id} errored:`,
          err instanceof Error ? err.message : err,
        );
        await captureTurn({
          page,
          action: 'act',
          reasoning: `checklist ${item.id}`,
          instruction: item.task,
          target: item.id,
          outcomeTag: 'error',
        });
      }
    }

    // ── Phase D: Persona-specific exploration ──
    // Deferred import so the base runner stays decoupled from the
    // persona action generator (which itself does an LLM call).
    if (deadlineExceeded()) {
      outcome = 'patience_exceeded';
      console.warn('[stagehand_hybrid] run deadline exceeded before Phase D — skipping');
    }
    if (args.personaVector && !deadlineExceeded()) {
      try {
        const { generatePersonaActions } = await import('./llm.js');
        const personaActions = await generatePersonaActions(
          args.personaVector as Parameters<typeof generatePersonaActions>[0],
          args.url,
          (args.checklist ?? []).map((c) => ({ id: c.id, task: c.task })),
          discoveredLinks.slice(0, 8),
          navLabels.slice(0, 8),
        );
        for (const pa of personaActions) {
          if (deadlineExceeded()) {
            outcome = 'patience_exceeded';
            break;
          }
          try {
            const res = (await raceWithTimeout(
              stagehand.act(pa.action),
              ACT_TIMEOUT_MS,
              `phase_d ${pa.id}`,
            )) as { success?: boolean };
            await captureTurn({
              page,
              action: 'act',
              reasoning: `phase_d_persona ${pa.id}: ${pa.reason ?? ''}`,
              instruction: pa.action,
              target: pa.id,
              outcomeTag: res?.success ? 'ok' : 'failed',
            });
          } catch (err) {
            console.warn(
              `[stagehand_hybrid] persona action ${pa.id} errored:`,
              err instanceof Error ? err.message : err,
            );
            await captureTurn({
              page,
              action: 'act',
              reasoning: `phase_d_persona ${pa.id}`,
              instruction: pa.action,
              target: pa.id,
              outcomeTag: 'error',
            });
          }
        }
      } catch (err) {
        // Non-blocking — persona exploration is enrichment, not required.
        console.warn(
          '[stagehand_hybrid] generatePersonaActions failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ── Final capture (rich) ──
    await captureTurn({
      page,
      action: 'observe',
      reasoning: 'final state',
      instruction: 'end',
      done: true,
      captureRich: true,
    });

    // Stagehand usage metrics → shared JSONL so usage-summary.ts can
    // attribute tokens to the hybrid path.
    try {
      const m = (await stagehand.metrics) as unknown as Record<string, number>;
      if (m) logStagehandUsage(sessionId, m);
    } catch {
      /* non-blocking */
    }
  } catch (err) {
    outcome = 'error';
    console.warn(
      '[stagehand_hybrid] run failed:',
      err instanceof Error ? err.message : err,
    );
  } finally {
    clearTimeout(hardCutTimer);
    try {
      await raceWithTimeout(stagehand.close(), 5_000, 'stagehand.close');
    } catch {
      /* ignore — browser may already be closed by hard-cut */
    }
    endIso = new Date().toISOString();
    if (hardCut && outcome !== 'patience_exceeded') outcome = 'patience_exceeded';
  }

  // If nothing captured at all the browser never booted — outcome=error
  // so the scoring adapter reflects reality rather than pretending the
  // session completed.
  if (turns.length === 0) outcome = 'error';

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
