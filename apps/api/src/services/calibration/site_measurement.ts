// Site measurement — Phase 2-C-2 Track A ground truth.
//
// Pure capture-only browser run that extracts site-level metrics
// the LLM persona inference can be calibrated against:
//   - load_time_ms        (proxy for "Time to Aha" / engagement)
//   - dom_node_count      (UI density)
//   - interactive_count   (link/button/form count → task complexity)
//   - has_signup_cta      (presence of sign-up affordance → adoption proxy)
//
// Heuristic mapping to dimension scores: shorter+balanced page →
// higher engagement; CTA presence + reasonable interactive count →
// higher task_success. These heuristics are intentionally simple —
// the *value* of Track A comes from accumulating (LLM, ground_truth)
// pairs and watching the Pearson r curve over months. Phase 2-D
// will refine the heuristic once enough records exist to fit a
// regression.

import { chromium } from 'playwright-core';
import { logger } from '../../logger.js';

const log = logger.child({ service: 'site_measurement' });

const NAV_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1280, height: 800 };

export type SiteMeasurement = {
  url: string;
  loadTimeMs: number;
  domNodeCount: number;
  interactiveCount: number;
  hasSignupCta: boolean;
  engagementScore: number;
  taskSuccessScore: number;
  measuredAt: Date;
};

function clamp(x: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, x));
}

// Heuristic engagement score from page metrics.
// Fast load + ~50-300 nodes + 5-30 interactives → high (75-90).
// Very slow OR very sparse OR overwhelming density → low.
export function engagementHeuristic(m: {
  loadTimeMs: number;
  domNodeCount: number;
  interactiveCount: number;
}): number {
  const speedScore =
    m.loadTimeMs < 1500 ? 90 :
    m.loadTimeMs < 3000 ? 75 :
    m.loadTimeMs < 5000 ? 55 :
    m.loadTimeMs < 10000 ? 35 :
    20;
  const densityScore =
    m.domNodeCount < 50 ? 30 :
    m.domNodeCount < 200 ? 80 :
    m.domNodeCount < 800 ? 70 :
    m.domNodeCount < 2000 ? 55 :
    35;
  const interactivityScore =
    m.interactiveCount < 3 ? 30 :
    m.interactiveCount < 10 ? 75 :
    m.interactiveCount < 50 ? 70 :
    m.interactiveCount < 100 ? 55 :
    35;
  return clamp((speedScore + densityScore + interactivityScore) / 3);
}

// Task success: presence of clear CTA + reasonable interactive count.
export function taskSuccessHeuristic(m: {
  hasSignupCta: boolean;
  interactiveCount: number;
}): number {
  const ctaScore = m.hasSignupCta ? 75 : 35;
  const balance =
    m.interactiveCount < 3 ? 30 :
    m.interactiveCount < 30 ? 80 :
    m.interactiveCount < 80 ? 60 :
    35;
  return clamp((ctaScore + balance) / 2);
}

export async function measureSite(url: string): Promise<SiteMeasurement> {
  const normalised = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  const t0 = Date.now();
  let loadTimeMs = 0;
  let domNodeCount = 0;
  let interactiveCount = 0;
  let hasSignupCta = false;

  try {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(normalised, {
      waitUntil: 'load',
      timeout: NAV_TIMEOUT_MS,
    });
    loadTimeMs = Date.now() - t0;

    // Single round-trip into the page to extract all metrics.
    const metrics = await page.evaluate(() => {
      const nodes = document.querySelectorAll('*').length;
      const interactive = document.querySelectorAll(
        'a, button, input, select, textarea',
      ).length;

      // CTA detection: text-content scan for sign-up triggers.
      const ctaTriggers = [
        'sign up',
        'sign-up',
        'signup',
        'get started',
        'register',
        'create account',
        'join',
        'try free',
        'try it',
      ];
      const candidates = Array.from(
        document.querySelectorAll(
          'a, button, [role="button"], input[type="submit"]',
        ),
      );
      const hasCta = candidates.some((el) => {
        const txt = (el.textContent ?? '').trim().toLowerCase();
        return ctaTriggers.some((t) => txt.includes(t));
      });

      return { nodes, interactive, hasCta };
    });

    domNodeCount = metrics.nodes;
    interactiveCount = metrics.interactive;
    hasSignupCta = metrics.hasCta;
    await ctx.close();
  } finally {
    await browser.close();
  }

  const engagementScore = engagementHeuristic({
    loadTimeMs,
    domNodeCount,
    interactiveCount,
  });
  const taskSuccessScore = taskSuccessHeuristic({
    hasSignupCta,
    interactiveCount,
  });

  log.info(
    {
      url: normalised,
      loadTimeMs,
      domNodeCount,
      interactiveCount,
      hasSignupCta,
      engagementScore: engagementScore.toFixed(1),
      taskSuccessScore: taskSuccessScore.toFixed(1),
    },
    'site measurement complete',
  );

  return {
    url: normalised,
    loadTimeMs,
    domNodeCount,
    interactiveCount,
    hasSignupCta,
    engagementScore,
    taskSuccessScore,
    measuredAt: new Date(),
  };
}
