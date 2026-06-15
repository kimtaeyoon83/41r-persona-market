#!/usr/bin/env npx tsx
/**
 * Spike Phase 0 — capture a curated screen graph for one site.
 *
 * Part of docs/41rpm_behavior_sim_spike_v0.md. Two-pass capture:
 *
 *   Pass 1: capture every curated node (screenshot full + top crop,
 *           Ch1-lite signals, raw anchor list).
 *   Auto-expand (optional, config.auto_expand): from each curated
 *           node's anchors, promote the first `per_page` links
 *           matching `match` (e.g. product detail URLs) into auto
 *           nodes — the 10x10 v1/v2 runs showed hand-curation
 *           systematically under-covers the listing→product action
 *           space that real commerce visitors actually use.
 *   Pass 2: capture auto nodes.
 *   Edge derivation: after ALL nodes are known, match every node's
 *           anchors against the full node set (verbatim labels).
 *           Off-graph links are counted, never silently dropped.
 *
 * Login walls are detected by redirect to login/cert pages and kept
 * as dead-end nodes — that IS a friction, not an error.
 *
 * Usage:
 *   pnpm tsx scripts/spike-behavior-sim/capture.ts scripts/spike-behavior-sim/sites/<id>.json
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const configPath = process.argv[2];
if (!configPath) {
  console.error('usage: capture.ts <sites/config.json>');
  process.exit(1);
}
const CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
  site_id: string;
  site: string;
  need: string;
  auto_expand?: { match: string; per_page: number; max: number };
  nodes: { id: string; url: string; label: string; note: string }[];
};

const OUT_DIR = path.join(process.cwd(), 'spike', CONFIG.site_id);
const SCREENS_DIR = path.join(OUT_DIR, 'screens');
const SCREEN_REL = `spike/${CONFIG.site_id}/screens`;

const VIEWPORT = { width: 1440, height: 900 };
const TOP_CROP_HEIGHT = 2400; // LLM payload crop — well under 8000px limit

// Keep identity-bearing query params — many sites route everything
// through one .asp/.do path and differentiate by id (10x10:
// category_prd.asp?itemid=...). Dropping the query collapses every
// product/event link onto one node and miswires edges. Tracking
// params (gaparam, rc, pEtr...) stay excluded.
const KEEP_PARAMS = ['itemid', 'disp', 'eventid', 'atype', 'makerid'];
function normPath(u: string): string {
  try {
    const url = new URL(u);
    const kept = KEEP_PARAMS.filter((k) => url.searchParams.has(k))
      .map((k) => `${k}=${url.searchParams.get(k)}`)
      .join('&');
    return url.pathname.replace(/\/$/, '') + (kept ? `?${kept}` : '');
  } catch {
    return u;
  }
}

interface Anchor {
  text: string;
  href: string;
  y: number | null; // document y of the link; null = zero-size/hidden element
}
interface CapturedNode {
  id: string;
  url: string;
  label: string;
  note: string;
  auto?: boolean;
  final_url?: string;
  login_wall?: boolean;
  screenshot?: string;
  screenshot_top?: string;
  signals?: { visible_word_count: number; link_count: number; cta_count: number };
  anchors?: Anchor[]; // dropped before graph.json write
  capture_failed?: boolean;
}

async function captureNode(
  ctx: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>>,
  node: CapturedNode,
): Promise<void> {
  const page = await ctx.newPage();
  console.log(`[capture] ${node.id} ← ${node.url}`);
  try {
    await page.goto(node.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const finalUrl = page.url();
    const redirected = normPath(finalUrl) !== normPath(node.url);
    node.login_wall = redirected && /login|cert|auth|sso/i.test(finalUrl + (await page.title()));
    node.final_url = finalUrl;

    const fullPath = path.join(SCREENS_DIR, `${node.id}.png`);
    const topPath = path.join(SCREENS_DIR, `${node.id}.top.png`);
    await page.screenshot({ path: fullPath, fullPage: true, type: 'png' });
    const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({
      path: topPath,
      type: 'png',
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.min(TOP_CROP_HEIGHT, docHeight) },
    });
    node.screenshot = `${SCREEN_REL}/${node.id}.png`;
    node.screenshot_top = `${SCREEN_REL}/${node.id}.top.png`;

    const extracted = await page.evaluate(() => {
      const text = document.body?.innerText ?? '';
      const words = text.split(/\s+/).filter(Boolean).length;
      const anchors = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => {
          const el = a as HTMLAnchorElement;
          const rect = el.getBoundingClientRect();
          const y =
            rect.width === 0 && rect.height === 0
              ? null
              : Math.round(rect.top + window.scrollY);
          return { text: (el.innerText || '').trim().replace(/\s+/g, ' '), href: el.href, y };
        })
        .filter(
          (l) =>
            l.text &&
            l.text.length <= 40 &&
            l.href &&
            !l.href.startsWith('javascript:') &&
            !l.href.endsWith('#'),
        );
      const buttons = document.querySelectorAll(
        'button, input[type=submit], [role=button], a.btn, a[class*="btn"]',
      ).length;
      return { words, anchors, buttons };
    });
    node.signals = {
      visible_word_count: extracted.words,
      link_count: extracted.anchors.length,
      cta_count: extracted.buttons,
    };
    node.anchors = extracted.anchors;
    console.log(`  words=${extracted.words} links=${extracted.anchors.length} login_wall=${node.login_wall}`);
  } catch (err) {
    console.error(`  FAILED: ${(err as Error).message}`);
    node.capture_failed = true;
  } finally {
    await page.close();
  }
}

async function main() {
  fs.mkdirSync(SCREENS_DIR, { recursive: true });
  const nodes: CapturedNode[] = CONFIG.nodes.map((n) => ({ ...n }));

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });

    // Pass 1 — curated nodes
    for (const node of nodes) await captureNode(ctx, node);

    // Auto-expand — promote listing-page product links to nodes
    if (CONFIG.auto_expand) {
      const { match, per_page, max } = CONFIG.auto_expand;
      const known = new Set(nodes.map((n) => normPath(n.url)));
      const autoNodes: CapturedNode[] = [];
      for (const node of nodes) {
        if (!node.anchors) continue;
        let taken = 0;
        for (const a of node.anchors) {
          if (autoNodes.length >= max) break;
          if (taken >= per_page) break;
          if (!a.href.includes(match)) continue;
          const np = normPath(a.href);
          if (known.has(np)) continue;
          known.add(np);
          const itemKey = np.replace(/[^a-zA-Z0-9]+/g, '_').slice(-24);
          autoNodes.push({
            id: `p${itemKey}`,
            url: a.href,
            label: a.text,
            note: `auto-expanded from ${node.id}`,
            auto: true,
          });
          taken++;
        }
      }
      console.log(`\n[auto-expand] ${autoNodes.length} product nodes from listing anchors`);
      // Pass 2 — auto nodes
      for (const node of autoNodes) await captureNode(ctx, node);
      nodes.push(...autoNodes);
    }

    await ctx.close();
  } finally {
    await browser.close();
  }

  // Edge derivation over the FULL node set
  const byPath = new Map(nodes.filter((n) => !n.capture_failed).map((n) => [normPath(n.url), n.id]));
  const graphNodes = nodes.map((node) => {
    if (node.capture_failed || !node.anchors) {
      const { anchors: _a, ...rest } = node;
      return { ...rest, edges: [], off_graph_link_count: 0 };
    }
    const seenEdge = new Set<string>();
    const edges: { label: string; to: string; y: number | null }[] = [];
    let offGraph = 0;
    for (const a of node.anchors) {
      const toId = byPath.get(normPath(a.href));
      if (toId && toId !== node.id) {
        if (!seenEdge.has(toId)) {
          seenEdge.add(toId);
          edges.push({ label: a.text, to: toId, y: a.y });
        }
      } else if (!toId) {
        offGraph++;
      }
    }
    const { anchors: _anchors, ...rest } = node;
    return { ...rest, edges, off_graph_link_count: offGraph };
  });

  const graph = {
    site: CONFIG.site,
    need: CONFIG.need,
    captured_at: new Date().toISOString().slice(0, 10),
    viewport: VIEWPORT,
    nodes: graphNodes,
  };
  const graphPath = path.join(OUT_DIR, 'graph.json');
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  for (const n of graphNodes) {
    console.log(
      `  ${n.id}: edges=${(n as { edges: unknown[] }).edges.length} off_graph=${(n as { off_graph_link_count: number }).off_graph_link_count}`,
    );
  }
  console.log(`\n[done] ${graphNodes.length} nodes → ${graphPath}`);
}

main();
