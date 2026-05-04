/**
 * Shared types for the browser-quirk harness.
 *
 * A "quirk" is any environmental obstacle the automation can hit on a
 * real-world site that ISN'T a genuine product defect: login walls,
 * cookie consent modals, captcha challenges, paywalls, age gates,
 * geoblocks, etc. Each one gets its own module in this directory with
 * a consistent detect/recover/classify shape, and the main phase
 * runner iterates a registry after each act() so new quirks get
 * absorbed without touching stagehand_hybrid.ts.
 *
 * Detection is two-tier:
 *   detectFast   — cheap, deterministic (regex on URL, DOM selector),
 *                  always tried first.
 *   detectWithLlm — optional Haiku fallback for cases regex can't
 *                  catch (multilingual cookie banners, paywalls that
 *                  vary per-site). Only called when detectFast misses.
 *
 * Cost: each LLM detector is a ~$0.0005 Haiku classify call and only
 * fires when the fast tier said "no". For a typical 20-turn session
 * that's at most a few cents of extra spend for much cleaner
 * attribution in the final diagnosis.
 */

export interface QuirkContext {
  /** Live Playwright page — typed opaquely to keep this file from
   *  importing stagehand/playwright types directly. */
  page: unknown;
  /** Current page.url() value, already captured by the caller so
   *  detectors don't all re-read. */
  url: string;
  /** Which phase of the run this check fires during. Detectors and
   *  recoverers can behave differently by phase (e.g. a cookie banner
   *  hit in Phase A is less urgent than one blocking checklist act). */
  phase: 'A' | 'B' | 'C' | 'D' | 'final';
  /** The landing page URL the run started from — recoverers goto()
   *  here when the current page is beyond saving. */
  targetUrl: string;
  /** Max milliseconds a recover() step is allowed to spend. Caller
   *  enforces via raceWithTimeout on the returned promise. */
  recoverTimeoutMs: number;
}

export interface QuirkDetectionResult {
  /** True when this quirk applies to the current page. */
  hit: boolean;
  /** Short note for the session_log turn when hit=true. */
  note?: string;
}

export interface QuirkRecoveryResult {
  /** True when the page is usable again after recovery (e.g. banner
   *  dismissed, redirected back to landing). The main loop will
   *  continue to the next checklist item when true; when false, it
   *  records the turn as blocked and breaks out of that phase. */
  recovered: boolean;
  /** Short note appended to the session_log turn. */
  note: string;
}

export interface BrowserQuirk {
  /** Stable identifier used in session_log.quirks counter + diagnosis
   *  prompt. snake_case. */
  name: string;

  /** Human-readable summary — goes into diagnosis synthesis prompt so
   *  the LLM knows how to interpret a high count. */
  description: string;

  /** Fast deterministic detector (URL pattern, DOM selector). */
  detectFast?(ctx: QuirkContext): Promise<QuirkDetectionResult>;

  /** LLM-assisted fallback — only called when detectFast missed or
   *  isn't present. Reads page text and asks Haiku. */
  detectWithLlm?(ctx: QuirkContext): Promise<QuirkDetectionResult>;

  /** Attempt to clear the obstacle. Common strategies: goto() the
   *  landing page, click a dismiss button, accept a cookie banner. */
  recover(ctx: QuirkContext): Promise<QuirkRecoveryResult>;

  /** How the turn gets tagged when this quirk blocks it. 'blocked'
   *  (default) keeps the checklist item out of the scoring denom —
   *  the right call for environmental constraints. 'error' means
   *  something is genuinely wrong. */
  classifyBlockedAs?: 'blocked' | 'error';
}

export async function runDetectors(
  quirks: BrowserQuirk[],
  ctx: QuirkContext,
): Promise<{ quirk: BrowserQuirk; hit: QuirkDetectionResult } | null> {
  for (const q of quirks) {
    if (q.detectFast) {
      try {
        const r = await q.detectFast(ctx);
        if (r.hit) return { quirk: q, hit: r };
      } catch {
        /* detector failure is non-fatal, move on */
      }
    }
  }
  // Only escalate to LLM tier when every fast detector missed.
  for (const q of quirks) {
    if (q.detectWithLlm) {
      try {
        const r = await q.detectWithLlm(ctx);
        if (r.hit) return { quirk: q, hit: r };
      } catch {
        /* detector failure is non-fatal */
      }
    }
  }
  return null;
}
