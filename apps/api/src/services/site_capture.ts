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

import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { uploadToR2 } from './r2.js';

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
  // Normalise protocol — accept "yoursite.com" → "https://yoursite.com"
  const normalised = /^https?:\/\//i.test(targetUrl)
    ? targetUrl
    : `https://${targetUrl}`;

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
    try {
      const finalUrl = page.url();
      const extracted = await page.evaluate(() => {
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
        // Nav menu labels — nearest nav/header/gnb region anchors,
        // verbatim text, deduped, capped. Feeds the persona prompt's
        // "what can you do on this site" grounding.
        const navLabels: string[] = [];
        const seen = new Set<string>();
        for (const a of anchors) {
          const el = a as HTMLAnchorElement;
          let p: Element | null = el;
          let inNav = false;
          while (p) {
            const tag = p.tagName.toLowerCase();
            const cls = (p.className || '').toString().toLowerCase();
            if (tag === 'nav' || tag === 'header' || cls.includes('gnb') || cls.includes('menu')) {
              inNav = true;
              break;
            }
            p = p.parentElement;
          }
          if (!inNav) continue;
          const label = (el.innerText || '').trim().replace(/\s+/g, ' ');
          if (!label || label.length > 30 || seen.has(label)) continue;
          seen.add(label);
          navLabels.push(label);
          if (navLabels.length >= 15) break;
        }
        // Popup/modal heuristic: visible dialog roles or fixed
        // overlays covering ≥ 25% of the viewport.
        let popup = Boolean(
          document.querySelector('[role=dialog]:not([hidden]), [class*="modal"]:not([hidden])'),
        );
        if (!popup) {
          const vw = window.innerWidth * window.innerHeight;
          for (const el of Array.from(document.querySelectorAll('div, section'))) {
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden')
              continue;
            const r = el.getBoundingClientRect();
            if ((r.width * r.height) / vw >= 0.25) {
              popup = true;
              break;
            }
          }
        }
        return { words, links: anchors.length, ctas, navLabels, popup };
      });
      signals = {
        visible_word_count: extracted.words,
        link_count: extracted.links,
        cta_count: extracted.ctas,
        nav_menu_labels: extracted.navLabels,
        popup_detected: extracted.popup,
        login_wall: /login|signin|sign-in|auth|cert|sso/i.test(new URL(finalUrl).pathname),
      };
    } catch (err) {
      log.warn({ targetUrl: normalised, err: (err as Error).message }, 'signal extraction failed');
    }

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
