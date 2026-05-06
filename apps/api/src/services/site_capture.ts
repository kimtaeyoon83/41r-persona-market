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

export type CaptureResult = {
  urls: string[];
  capturedAt: Date;
  fromCache: boolean;
};

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
  try {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(normalised, {
      waitUntil: 'networkidle',
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(500);
    // Full-page capture for personas (existing behavior).
    bufFull = await page.screenshot({ fullPage: true, type: 'png' });
    // Viewport crop for classifier (avoids Anthropic 8000px limit).
    bufView = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });
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
