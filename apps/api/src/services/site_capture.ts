// Site capture — Phase 1C-C.
//
// Pure capture-only flow: navigate to URL → 1 full-page screenshot →
// upload to R2 (prod) or write to /tmp + serve via Express static
// (dev). NO browser automation, NO clicking, NO scrolling logic
// beyond a single full-page snapshot. The vision LLM does the
// "exploration" by reading the screenshot.
//
// Cache: 24-hour bucket by URL hash. Same target on the same UTC day
// reuses the file — typical re-runs (compare two scans, debug a
// flagged persona) skip the browser launch entirely.

import { chromium, type BrowserContextOptions } from 'playwright-core';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { uploadToR2 } from './r2.js';
import { validateTargetUrl, resolvesToPublicHost } from './url_guard.js';

const log = logger.child({ service: 'site_capture' });

const LOCAL_DIR = '/tmp/site-captures';
const NAV_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1280, height: 800 };

/** Ch1-style objective page facts, measured during the capture page
 *  load — no LLM. Behavior-sim spike transfer (2026-06-10): grounds
 *  persona prompts (dimensions/llm.ts pageFacts section) and renders
 *  the report's "measured" strip. */
export type CaptureSignals = {
  visible_word_count: number;
  link_count: number;
  cta_count: number;
  nav_menu_labels: string[];
  popup_detected: boolean;
  login_wall: boolean;
};

export type CaptureResult = {
  urls: string[];
  capturedAt: Date;
  fromCache: boolean;
  /** Null when extraction failed or the cache predates signals. */
  signals: CaptureSignals | null;
};

function signalsPathFor(key: string): string {
  // Sidecar next to the cached PNG so same-day re-scans keep signals.
  return path.join(LOCAL_DIR, `${path.basename(key, '.png')}.signals.json`);
}

function readSignalsSidecar(key: string): CaptureSignals | null {
  try {
    const p = signalsPathFor(key);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as CaptureSignals;
  } catch {
    return null;
  }
}

function dateBucket(): string {
  // YYYY-MM-DD UTC — re-captures only happen across day boundaries.
  return new Date().toISOString().slice(0, 10);
}

function captureKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return `site-captures/${hash}_${dateBucket()}.png`;
}

// Classifier-bound key — viewport-only crop (1280 × 1024) of the same
// page. Anthropic's vision API rejects images > 8000px on either axis,
// so very tall landing pages (e.g. linear.app at 10314px) fail the
// classifier when given the full-page capture. The viewport snapshot
// gives the classifier the hero region — enough to identify category.
function captureClassifierKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return `site-captures/${hash}_${dateBucket()}_view.png`;
}

function localPathFor(key: string): string {
  return path.join(LOCAL_DIR, path.basename(key));
}

export async function captureSite(targetUrl: string): Promise<CaptureResult> {
  // Security gate (2026-06-15) — defense in depth. The /api/scan route
  // already validated before storing, but this is the function that
  // actually points a headless browser at the URL (SSRF), so it
  // re-validates: any private/hostile target throws here too, and the
  // pipeline marks the scan failed rather than navigating.
  const guard = validateTargetUrl(targetUrl);
  if (!guard.ok) {
    throw new Error(`unsafe_target_url:${guard.reason}`);
  }
  const normalised = guard.url;

  const key = captureKey(normalised);
  const localPath = localPathFor(key);
  const viewKey = captureClassifierKey(normalised);
  const viewLocalPath = localPathFor(viewKey);

  if (fs.existsSync(localPath)) {
    const fullUrl = isR2Configured()
      ? `${process.env.R2_PUBLIC_URL ?? ''}/${key}`
      : `/${key}`;
    // Cached scans before viewport-clip support won't have the _view
    // file. We still return cached even without it; the classifier
    // then falls back to the full URL (which may exceed Anthropic's
    // 8000px limit and fail to placeholder, matching pre-fix behavior).
    const urls = [fullUrl];
    if (fs.existsSync(viewLocalPath)) {
      const viewUrl = isR2Configured()
        ? `${process.env.R2_PUBLIC_URL ?? ''}/${viewKey}`
        : `/${viewKey}`;
      urls.push(viewUrl);
    }
    log.info({ targetUrl: normalised, key }, 'using cached capture');
    return {
      urls,
      capturedAt: fs.statSync(localPath).mtime,
      fromCache: true,
      signals: readSignalsSidecar(key),
    };
  }

  // SSRF defense-in-depth (2026-06-15) — resolve the hostname right
  // before navigating and refuse if it maps to a private IP. Catches
  // DNS rebinding / internal CNAMEs (public-looking host → 10.0.0.5)
  // that the static validateTargetUrl above can't see.
  if (!(await resolvesToPublicHost(guard.host))) {
    throw new Error('unsafe_target_url:private_host_resolved');
  }

  fs.mkdirSync(LOCAL_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    // CHROMIUM_PATH is set in Docker so prod uses the baked binary;
    // dev falls back to Playwright's bundled chromium.
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  let bufFull: Buffer;
  let bufView: Buffer;
  let signals: CaptureSignals | null = null;
  try {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    try {
      await page.goto(normalised, {
        waitUntil: 'networkidle',
        timeout: NAV_TIMEOUT_MS,
      });
    } catch (err) {
      // Sites with ever-streaming ad/analytics requests never reach
      // networkidle (10x10.co.kr, 2026-06-10 — capture failed and the
      // whole scan silently degraded to text-only). Retry once with
      // domcontentloaded + a settle wait: a slightly-early screenshot
      // beats no screenshot, no classifier, and no Ch1 signals.
      log.warn(
        { targetUrl: normalised, err: (err as Error).message },
        'networkidle timeout — retrying with domcontentloaded',
      );
      await page.goto(normalised, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(2500);
    }
    await page.waitForTimeout(500);
    // Full-page capture for personas (existing behavior).
    bufFull = await page.screenshot({ fullPage: true, type: 'png' });
    // Viewport crop for classifier (avoids Anthropic 8000px limit).
    bufView = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });

    // Ch1 objective signals — same page load, one evaluate. Failure
    // is non-fatal: signals stay null and every consumer hides.
    signals = await extractCaptureSignals(page, normalised);

    await ctx.close();
  } finally {
    await browser.close();
  }

  // Always write local — both for the dev static-serve path AND as
  // the cache. R2 upload then returns either the public R2 URL or
  // the bare key (when R2 isn't configured) per uploadToR2's
  // existing fallback contract.
  fs.writeFileSync(localPath, bufFull);
  fs.writeFileSync(viewLocalPath, bufView);
  if (signals) {
    try {
      fs.writeFileSync(signalsPathFor(key), JSON.stringify(signals));
    } catch {
      /* sidecar is best-effort — same-day cache hits just lose signals */
    }
  }
  log.info(
    { targetUrl: normalised, key, bytesFull: bufFull.length, bytesView: bufView.length },
    'capture written',
  );

  let publicUrl: string;
  let viewPublicUrl: string;
  if (isR2Configured()) {
    publicUrl = await uploadToR2(key, bufFull, 'image/png');
    viewPublicUrl = await uploadToR2(viewKey, bufView, 'image/png');
  } else {
    publicUrl = `/${key}`;
    viewPublicUrl = `/${viewKey}`;
  }

  return {
    urls: [publicUrl, viewPublicUrl],
    capturedAt: new Date(),
    fromCache: false,
    signals,
  };
}

function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

// Read a local capture as a base64 data URL — used by the LLM call
// when serving over the dev static path; Sonnet needs either an
// http(s) URL or base64 in the image content block.
export function readCaptureAsBase64(
  url: string,
): { mediaType: 'image/png'; data: string } | null {
  if (url.startsWith('http://') || url.startsWith('https://')) return null;
  const cleanKey = url.startsWith('/') ? url.slice(1) : url;
  const localPath = path.join(LOCAL_DIR, path.basename(cleanKey));
  if (!fs.existsSync(localPath)) return null;
  return {
    mediaType: 'image/png',
    data: fs.readFileSync(localPath).toString('base64'),
  };
}

// ─── Shared signal extraction (used by captureSite + auth capture) ──
// Browser-side collector — runs in page context (no Node closure refs).
function collectSignalsInPage() {
  const text = document.body?.innerText ?? '';
  const words = text.split(/\s+/).filter(Boolean).length;
  const anchors = Array.from(document.querySelectorAll('a[href]')).filter((a) => {
    const el = a as HTMLAnchorElement;
    const t = (el.innerText || '').trim();
    return t && el.href && !el.href.startsWith('javascript:');
  });
  const ctas = document.querySelectorAll(
    'button, input[type=submit], [role=button], a.btn, a[class*="btn"]',
  ).length;
  const navLabels: string[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    const el = a as HTMLAnchorElement;
    let p: Element | null = el;
    let inNav = false;
    let inFooter = false;
    while (p) {
      const tag = p.tagName.toLowerCase();
      const cls = (p.className || '').toString().toLowerCase();
      if (tag === 'footer' || cls.includes('footer')) {
        inFooter = true;
        break;
      }
      if (tag === 'nav' || tag === 'header' || cls.includes('gnb') || cls.includes('menu')) {
        inNav = true;
      }
      p = p.parentElement;
    }
    if (!inNav || inFooter) continue;
    const label = (el.innerText || '').trim().replace(/\s+/g, ' ');
    if (!label || label.length > 30 || seen.has(label)) continue;
    seen.add(label);
    navLabels.push(label);
    if (navLabels.length >= 15) break;
  }
  let popup = Boolean(
    document.querySelector('[role=dialog]:not([hidden]), [class*="modal"]:not([hidden])'),
  );
  if (!popup) {
    const vw = window.innerWidth * window.innerHeight;
    for (const el of Array.from(document.querySelectorAll('div, section'))) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      const ratio = (r.width * r.height) / vw;
      // A real modal covers a MIDDLE band of the viewport (a centered
      // card / sheet). A near-full-screen fixed element (>= 85%) is the
      // app shell / background, NOT a popup — flagging it as one
      // false-fired on mobile-first apps that render a full-screen fixed
      // container (geulbat app-viewport, 2026-06-16) and poisoned the
      // persona prompt with a non-existent "popup blocks the page".
      if (ratio >= 0.25 && ratio < 0.85) {
        popup = true;
        break;
      }
    }
  }
  return { words, links: anchors.length, ctas, navLabels, popup };
}

async function extractCaptureSignals(
  page: import('playwright-core').Page,
  label: string,
): Promise<CaptureSignals | null> {
  try {
    const finalUrl = page.url();
    const extracted = await page.evaluate(collectSignalsInPage);
    return {
      visible_word_count: extracted.words,
      link_count: extracted.links,
      cta_count: extracted.ctas,
      nav_menu_labels: extracted.navLabels,
      popup_detected: extracted.popup,
      login_wall: /login|signin|sign-in|auth|cert|sso/i.test(new URL(finalUrl).pathname),
    };
  } catch (err) {
    log.warn({ targetUrl: label, err: (err as Error).message }, 'signal extraction failed');
    return null;
  }
}

// ─── Authenticated multi-screen capture (Phase 1, 2026-06-16) ──────
// For login-gated apps: reuse a human's session (storageState) so the
// scanner reaches the REAL product, capture the founder's key screens,
// and extract a structure summary (accessibility tree → available
// actions + nav) per screen. NOT cached (session-specific) and SAFE:
// only GET-navigates explicit same-origin targets — never clicks
// destructive buttons / submits forms.

/** Pruned structure for one screen — what a user can DO + navigate. */
export type AuthCaptureScreen = {
  path: string;
  url: string;
  title: string;
  screenshotUrl: string;
  viewUrl: string;
  signals: CaptureSignals | null;
  actions: string[];
  nav: string[];
};

export type AuthCaptureResult = {
  /** [full, view] of the primary (first) screen — feeds personas + classifier. */
  primaryUrls: string[];
  capturedAt: Date;
  signals: CaptureSignals | null;
  screens: AuthCaptureScreen[];
};

const MAX_AUTH_SCREENS = 6;

// Browser-side structure collector — interactive affordances (what a
// user can DO: buttons, inputs) + navigation (links), deduped + capped.
// DOM-based rather than the deprecated accessibility snapshot.
function collectStructureInPage() {
  const actions: string[] = [];
  const nav: string[] = [];
  const seenA = new Set<string>();
  const seenN = new Set<string>();
  const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
  const addA = (t: string) => {
    if (t && t.length <= 40 && !seenA.has(t) && actions.length < 40) {
      seenA.add(t);
      actions.push(t);
    }
  };
  const addN = (t: string) => {
    if (t && t.length <= 40 && !seenN.has(t) && nav.length < 40) {
      seenN.add(t);
      nav.push(t);
    }
  };
  document
    .querySelectorAll('button, [role="button"], input[type=submit], input[type=button]')
    .forEach((el) => {
      const e = el as HTMLElement & { value?: string };
      addA(norm(e.innerText || e.value || el.getAttribute('aria-label')));
    });
  document
    .querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select')
    .forEach((el) => {
      const e = el as HTMLInputElement;
      const lab =
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        (e.labels && e.labels[0] ? (e.labels[0] as HTMLElement).innerText : '') ||
        e.name ||
        '';
      addA(norm(lab));
    });
  document.querySelectorAll('a[href]').forEach((a) => {
    const el = a as HTMLAnchorElement;
    if (!el.href || el.href.startsWith('javascript:')) return;
    addN(norm(el.innerText || el.getAttribute('aria-label')));
  });
  return { actions, nav };
}

async function extractStructure(
  page: import('playwright-core').Page,
): Promise<{ actions: string[]; nav: string[] }> {
  try {
    return await page.evaluate(collectStructureInPage);
  } catch {
    return { actions: [], nav: [] };
  }
}

// SPAs (esp. behind login) show a splash/loading screen for a beat after
// navigation, then render content. Screenshotting too early captures the
// splash — which reads as a "modal blocking everything" (geulbat /home,
// 2026-06-16: visible_word_count=7 splash). Poll until the page has real
// text, bounded so a genuinely sparse/visual page still proceeds.
async function waitForContent(
  page: import('playwright-core').Page,
  minWords = 25,
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  // Always give one settle tick first.
  await page.waitForTimeout(600);
  while (Date.now() - start < timeoutMs) {
    const words = await page
      .evaluate(() => (document.body?.innerText || '').split(/\s+/).filter(Boolean).length)
      .catch(() => 0);
    if (words >= minWords) return;
    await page.waitForTimeout(600);
  }
}

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

export async function captureAuthenticatedSite(
  targetUrl: string,
  opts: { storageState: unknown; capturePaths?: string[] | null; mobile?: boolean | null },
): Promise<AuthCaptureResult> {
  const guard = validateTargetUrl(targetUrl);
  if (!guard.ok) throw new Error(`unsafe_target_url:${guard.reason}`);
  const start = guard.url;
  if (!(await resolvesToPublicHost(guard.host))) {
    throw new Error('unsafe_target_url:private_host_resolved');
  }
  const origin = new URL(start).origin;

  // Resolve capture targets to same-origin absolute URLs, each re-guarded
  // (a capture_path could be an absolute URL to a private host).
  const raw =
    opts.capturePaths && opts.capturePaths.length ? opts.capturePaths : [start];
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    let u: string;
    try {
      u = new URL(t, origin).toString();
    } catch {
      continue;
    }
    const g = validateTargetUrl(u);
    if (!g.ok || new URL(g.url).origin !== origin) continue;
    if (seen.has(g.url)) continue;
    seen.add(g.url);
    targets.push(g.url);
  }
  if (targets.length === 0) targets.push(start);
  const list = targets.slice(0, MAX_AUTH_SCREENS);

  const vp = opts.mobile ? MOBILE_VIEWPORT : VIEWPORT;
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const screens: AuthCaptureScreen[] = [];
  try {
    const ctx = await browser.newContext({
      viewport: vp,
      userAgent: opts.mobile
        ? MOBILE_UA
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      ...(opts.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
      storageState: opts.storageState as BrowserContextOptions['storageState'],
    });
    const page = await ctx.newPage();
    for (const url of list) {
      try {
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
        } catch {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        }
        // Wait for the SPA to render past its splash/loading screen.
        await waitForContent(page);
        const bufFull = await page.screenshot({ fullPage: true, type: 'png' });
        const bufView = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, width: vp.width, height: vp.height },
        });
        const key = captureKey(url);
        const viewKey = captureClassifierKey(url);
        fs.writeFileSync(localPathFor(key), bufFull);
        fs.writeFileSync(localPathFor(viewKey), bufView);
        let screenshotUrl: string;
        let viewUrl: string;
        if (isR2Configured()) {
          screenshotUrl = await uploadToR2(key, bufFull, 'image/png');
          viewUrl = await uploadToR2(viewKey, bufView, 'image/png');
        } else {
          screenshotUrl = `/${key}`;
          viewUrl = `/${viewKey}`;
        }
        const signals = await extractCaptureSignals(page, url);
        const { actions, nav } = await extractStructure(page);
        const title = await page.title().catch(() => '');
        screens.push({
          path: url,
          url: page.url(),
          title,
          screenshotUrl,
          viewUrl,
          signals,
          actions,
          nav,
        });
      } catch (err) {
        log.warn({ url, err: (err as Error).message }, 'auth screen capture failed');
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }

  const primary = screens[0];
  log.info(
    { targetUrl: start, screens: screens.length },
    'authenticated capture complete',
  );
  return {
    primaryUrls: primary ? [primary.screenshotUrl, primary.viewUrl] : [],
    capturedAt: new Date(),
    signals: primary?.signals ?? null,
    screens,
  };
}
