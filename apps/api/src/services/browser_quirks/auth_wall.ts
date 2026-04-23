/**
 * Auth-wall quirk. Fires when the browser ends up on a login / signup
 * / OAuth path the automation can't push past without credentials.
 *
 * Fast detect only — URL pattern is deterministic and cheap, no need
 * for an LLM tier. Recovery: goto(landing). Most SPA sites allow the
 * landing page to render without auth even when `/dashboard` redirects,
 * so this usually succeeds and the next checklist item gets a clean
 * starting state.
 *
 * Prior to the harness this logic lived inline in stagehand_hybrid.ts.
 * The move is a behavioural no-op — AUTH_WALL_PATTERNS is the same
 * regex set, just relocated.
 */
import type { BrowserQuirk, QuirkContext } from './types.js';

const AUTH_WALL_PATTERNS: RegExp[] = [
  /\/login(\b|\/|\?)/i,
  /\/signin(\b|\/|\?)/i,
  /\/sign-in(\b|\/|\?)/i,
  /\/signup(\b|\/|\?)/i,
  /\/sign-up(\b|\/|\?)/i,
  /\/register(\b|\/|\?)/i,
  /\/oauth(\b|\/|\?)/i,
  /\/auth\/(login|signin|callback|authorize)/i,
  /github\.com\/(login|signup)/i,
  /accounts\.google\.com/i,
  /login\.microsoftonline\.com/i,
  /facebook\.com\/login/i,
  /member\..*\/user\/.*\/mlogin/i,
];

export function isAuthWallUrl(url: string): boolean {
  if (!url) return false;
  return AUTH_WALL_PATTERNS.some((p) => p.test(url));
}

export const authWallQuirk: BrowserQuirk = {
  name: 'auth_wall',
  description:
    'Pages where the session got redirected to a login / OAuth flow. Each hit means the product content was gated behind credentials and the automation cannot push past — the affected checklist item is marked blocked, not failed, so scoring treats it as an environment constraint.',

  async detectFast(ctx: QuirkContext) {
    const hit = isAuthWallUrl(ctx.url);
    return {
      hit,
      note: hit ? `auth-wall URL ${ctx.url}` : undefined,
    };
  },

  async recover(ctx: QuirkContext) {
    const page = ctx.page as {
      goto(url: string, opts?: unknown): Promise<unknown>;
    };
    try {
      await page.goto(ctx.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeoutMs: Math.min(10_000, ctx.recoverTimeoutMs),
      } as unknown);
      await new Promise((r) => setTimeout(r, 800));
      return { recovered: true, note: 'returned to landing URL' };
    } catch (err) {
      return {
        recovered: false,
        note: `goto landing failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  classifyBlockedAs: 'blocked',
};
