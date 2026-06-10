#!/usr/bin/env npx tsx
/**
 * Spike Phase 0 helper — dump the visible navigation links of a page
 * so the operator can curate graph nodes/edges by hand.
 *
 * Part of docs/41rpm_behavior_sim_spike_v0.md (Phase 0). Read-only:
 * fetches one page, prints link text + href grouped by nav region.
 *
 * Usage:
 *   pnpm tsx scripts/spike-behavior-sim/explore.ts https://www.nhis.or.kr/nhis/index.do
 */
import { chromium } from 'playwright-core';

const url = process.argv[2];
if (!url) {
  console.error('usage: explore.ts <url>');
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const links = await page.evaluate(() => {
      const out: { region: string; text: string; href: string }[] = [];
      const seen = new Set<string>();
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const a of anchors) {
        const el = a as HTMLAnchorElement;
        const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text || text.length > 40) continue;
        const href = el.href;
        if (!href || href.startsWith('javascript:') || href.endsWith('#')) continue;
        const key = `${text}|${href}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // crude region tag: nearest nav/header/footer ancestor
        let region = 'body';
        let p: Element | null = el;
        while (p) {
          const tag = p.tagName.toLowerCase();
          const cls = (p.className || '').toString().toLowerCase();
          if (tag === 'nav' || cls.includes('gnb') || cls.includes('menu')) { region = 'nav'; break; }
          if (tag === 'header') { region = 'header'; break; }
          if (tag === 'footer') { region = 'footer'; break; }
          p = p.parentElement;
        }
        out.push({ region, text, href });
      }
      return out;
    });

    for (const l of links) {
      console.log(`[${l.region}]\t${l.text}\t${l.href}`);
    }
    console.error(`\ntotal: ${links.length} links`);
    await ctx.close();
  } finally {
    await browser.close();
  }
}

main();
