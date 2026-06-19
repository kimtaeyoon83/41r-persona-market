#!/usr/bin/env npx tsx
/**
 * Generate the per-node relevance map (_relevance.json) via LLM.
 *
 * Fills the one signal gen-sim can't derive from structure: how well each
 * screen's CONTENT serves the graph's need. ch2 = Haiku vision per node,
 * × ch1 structural factor → effective relevance (relevance.ts). Operator-
 * run (needs ANTHROPIC_API_KEY + the captured node screenshots).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... pnpm tsx scripts/spike-behavior-sim/gen-relevance.ts [graph.json]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  judgeContentRelevance,
  nodeRelevance,
  type GraphNodeLite,
} from '../../apps/api/src/services/behavior_sim/relevance.js';

type GraphNode = GraphNodeLite & { screenshot_top?: string; screenshot?: string };
type Graph = { need: string; nodes: GraphNode[] };

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphPath = process.argv[2] ?? join(repoRoot, 'spike', 'graph.json');

async function main(): Promise<void> {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as Graph;
  console.log(`judging relevance for ${graph.nodes.length} nodes · need: ${graph.need}`);

  const map: Record<string, number> = {};
  for (const node of graph.nodes) {
    const imgPath = node.screenshot_top ?? node.screenshot;
    let ch2 = 0;
    if (imgPath && existsSync(join(repoRoot, imgPath))) {
      const imageB64 = readFileSync(join(repoRoot, imgPath)).toString('base64');
      ch2 = await judgeContentRelevance({ need: graph.need, label: node.label, imageB64 });
    } else {
      console.warn(`  ${node.id}: no screenshot — ch2=0`);
    }
    const rel = nodeRelevance(node, ch2);
    map[node.id] = Number(rel.toFixed(3));
    console.log(`  ${node.id}: ch2=${ch2.toFixed(2)} × ch1 → ${map[node.id]}`);
  }

  const outDir = join(repoRoot, 'spike', 'think-aloud');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, '_relevance.json');
  writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n');
  console.log(`\n✓ wrote ${outPath}\nNext: pnpm tsx scripts/spike-behavior-sim/gen-sim.ts`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
