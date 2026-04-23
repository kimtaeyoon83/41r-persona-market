/**
 * Cookie / GDPR consent banner quirk. Two-tier detection:
 *
 *   Fast: DOM selector pass. Catches the common libraries
 *   (OneTrust, CookieBot, Cookieyes, GDPR.js variants) by attribute
 *   patterns like [data-cookie-banner], [class*="cookie"], etc.
 *
 *   LLM fallback: for one-off banners that don't carry a recognisable
 *   class/id. Haiku reads the first ~2KB of body innerText and
 *   answers YES/NO. ~$0.0005 per call, only fires when fast missed.
 *
 * Recovery: ask Stagehand to click the accept / dismiss button in
 * natural language. If the click succeeds the session continues with
 * the banner out of the way; if it fails we record the turn as
 * blocked and move on.
 */
import { client, withRoute } from '../anthropic_client.js';
import { SCORING_MODELS } from '../llm.js';
import type { BrowserQuirk, QuirkContext } from './types.js';

// Very broad CSS selectors that correlate with "cookie banner is
// present" across major cookie-consent libraries. Intentionally
// permissive — false positives here only cost a Haiku call or a
// harmless stagehand.act that tries to click accept.
const COOKIE_SELECTORS = [
  '[data-cookie-banner]',
  '[data-cookieconsent]',
  '[id*="cookie-banner" i]',
  '[id*="cookie-consent" i]',
  '[id*="cookieConsent"]',
  '[id*="onetrust-banner"]',
  '[id*="CybotCookiebot"]',
  '[class*="cookie-banner" i]',
  '[class*="cookie-consent" i]',
  '[aria-label*="cookie" i]',
  '[aria-label*="consent" i]',
];

async function fastDomCheck(page: unknown): Promise<boolean> {
  const p = page as {
    $(selector: string): Promise<unknown | null>;
  };
  for (const sel of COOKIE_SELECTORS) {
    try {
      const el = await p.$(sel);
      if (el) return true;
    } catch {
      /* selector syntax occasionally rejected by some pages — skip */
    }
  }
  return false;
}

export const cookieConsentQuirk: BrowserQuirk = {
  name: 'cookie_consent',
  description:
    'GDPR / cookie consent banners blocking the main content. Usually dismissible with a single accept click; counts so the diagnosis knows the initial turns may have been clicking through consent rather than exploring product UI.',

  async detectFast(ctx: QuirkContext) {
    const hit = await fastDomCheck(ctx.page);
    return { hit, note: hit ? 'cookie banner DOM selector matched' : undefined };
  },

  async detectWithLlm(ctx: QuirkContext) {
    // Pull the first chunk of visible body text and ask Haiku.
    const p = ctx.page as {
      innerText(sel: string, opts?: unknown): Promise<string>;
    };
    let text = '';
    try {
      text = (await p.innerText('body', { timeout: 2000 } as unknown)).slice(0, 2000);
    } catch {
      return { hit: false };
    }
    if (!text) return { hit: false };

    try {
      const resp = await withRoute('quirk.cookie_consent', () =>
        client.messages.create({
          model: SCORING_MODELS.haiku,
          max_tokens: 10,
          temperature: 0,
          system:
            'You are a page classifier. Given visible body text, answer STRICTLY with "YES" or "NO" to the user question. No other words.',
          messages: [
            {
              role: 'user',
              content:
                'Is there a cookie / privacy / GDPR consent banner blocking the main content in the text below? Only YES when such a banner demands an explicit accept/reject click to continue.\n\n' +
                text,
            },
          ],
        }),
      );
      const raw = resp.content[0]?.type === 'text' ? resp.content[0].text.trim().toUpperCase() : '';
      const hit = raw.startsWith('YES');
      return { hit, note: hit ? 'Haiku detected cookie banner text' : undefined };
    } catch {
      return { hit: false };
    }
  },

  async recover(ctx: QuirkContext) {
    const stagehand = (ctx.page as { context: { stagehand?: unknown } }).context?.stagehand ?? null;
    // Prefer stagehand.act if available — natural-language click that
    // navigates accept/dismiss across languages.
    if (stagehand && typeof (stagehand as { act?: unknown }).act === 'function') {
      try {
        const act = (stagehand as { act: (q: string) => Promise<{ success?: boolean }> }).act;
        const res = await act('Accept or dismiss the cookie / privacy consent banner');
        if (res?.success) return { recovered: true, note: 'stagehand.act dismissed banner' };
      } catch {
        /* fall through to selector path */
      }
    }
    // Fallback: try generic accept-button selector heuristic.
    const page = ctx.page as {
      click(sel: string, opts?: unknown): Promise<unknown>;
    };
    const ACCEPT_SELECTORS = [
      'button[id*="accept" i]',
      'button[class*="accept" i]',
      'button:has-text("Accept")',
      'button:has-text("I Agree")',
      'button:has-text("동의")',
      'button:has-text("모두 동의")',
      'button[data-cookie-accept]',
    ];
    for (const sel of ACCEPT_SELECTORS) {
      try {
        await page.click(sel, { timeout: 1500 } as unknown);
        return { recovered: true, note: `clicked ${sel}` };
      } catch {
        /* try next */
      }
    }
    return { recovered: false, note: 'no accept control found' };
  },

  classifyBlockedAs: 'blocked',
};
