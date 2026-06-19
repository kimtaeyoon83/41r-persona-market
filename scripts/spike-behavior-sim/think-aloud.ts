#!/usr/bin/env npx tsx
/**
 * Think-aloud capture CLI (behavior_sim build gate — CLAUDE.md).
 *
 * A facilitator runs a session with one human subject: the subject uses
 * the captured site graph while narrating aloud ("말하는 대로"), and the
 * facilitator records, per node, what they SAID + which choice they made
 * + dwell + affect. Output is a structured ThinkAloudSession the Mode C
 * simulator is later calibrated against (gate-label vs real behaviour).
 *
 * Collects the 5-subject NHIS protocol data the gate requires. NO PII —
 * use anonymized ids (P1..P5).
 *
 * Usage:
 *   pnpm tsx scripts/spike-behavior-sim/think-aloud.ts [graph.json]
 *   (default graph: spike/graph.json)
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateSession,
  summarizeSession,
  type ThinkAloudSession,
  type ThinkAloudStep,
  type SelfReportedFeel,
  type Outcome,
} from '../../apps/api/src/services/behavior_sim/think_aloud.js';

type GraphNode = {
  id: string;
  label: string;
  edges: { label: string; to: string }[];
};
type Graph = { site: string; need: string; nodes: GraphNode[] };

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphPath = process.argv[2] ?? join(repoRoot, 'spike', 'graph.json');

const FEELS: SelfReportedFeel[] = ['fine', 'confused', 'frustrated', 'satisfied', 'bored'];

async function main(): Promise<void> {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as Graph;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = (q: string) => rl.question(q);

  console.log(`\n think-aloud · site=${graph.site}`);
  console.log(` TASK (need): ${graph.need}\n`);
  const subjectId = (await ask('Subject id (anonymized, e.g. P1): ')).trim() || 'P?';

  const steps: ThinkAloudStep[] = [];
  let current = graph.nodes[0]!; // start node
  let outcome: Outcome | null = null;

  while (!outcome) {
    const node = byId.get(current.id)!;
    console.log(`\n── node: ${node.id} (${node.label}) ──`);
    node.edges.forEach((e, i) => console.log(`   [${i}] ${e.label} → ${e.to}`));
    console.log('   [g] reached the goal   [x] leave / give up');

    const utterance = (await ask('  utterance (what they said): ')).trim();
    const dwellMs = Math.max(0, Math.round(Number(await ask('  dwell seconds: ')) * 1000) || 0);
    const feelIn = (await ask(`  feel [${FEELS.join('/')}] (enter=skip): `)).trim();
    const feel = (FEELS as string[]).includes(feelIn) ? (feelIn as SelfReportedFeel) : undefined;
    const choice = (await ask('  choice (edge #, g, x): ')).trim().toLowerCase();

    if (choice === 'g') {
      steps.push({ stepIndex: steps.length, nodeId: node.id, dwellMs, utterance, chosenEdgeLabel: null, toNodeId: null, feel });
      outcome = { kind: 'reached_goal' };
    } else if (choice === 'x') {
      const r = (await ask('  leave reason [satisfied/frustrated/gave_up/distracted]: ')).trim();
      const reason = (['satisfied', 'frustrated', 'gave_up', 'distracted'].includes(r) ? r : 'gave_up') as
        | 'satisfied' | 'frustrated' | 'gave_up' | 'distracted';
      steps.push({ stepIndex: steps.length, nodeId: node.id, dwellMs, utterance, chosenEdgeLabel: null, toNodeId: null, feel });
      outcome = { kind: 'left', reason };
    } else {
      const idx = Number(choice);
      const edge = node.edges[idx];
      if (!edge) { console.log('  (invalid choice, try again)'); continue; }
      steps.push({ stepIndex: steps.length, nodeId: node.id, dwellMs, utterance, chosenEdgeLabel: edge.label, toNodeId: edge.to, feel });
      const next = byId.get(edge.to);
      if (!next) { console.log(`  (edge target ${edge.to} not in graph — ending)`); outcome = { kind: 'left', reason: 'gave_up' }; }
      else current = next;
    }
  }

  const notes = (await ask('\nFacilitator notes (optional): ')).trim() || undefined;
  rl.close();

  const session: ThinkAloudSession = {
    schemaVersion: 1,
    site: graph.site,
    need: graph.need,
    subjectId,
    protocol: 'NHIS',
    startedAt: new Date().toISOString(),
    steps,
    outcome,
    notes,
  };

  const issues = validateSession(session);
  if (issues.length) console.warn('\n⚠️  validation issues:\n  - ' + issues.join('\n  - '));

  const outDir = join(repoRoot, 'spike', 'think-aloud');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${subjectId}.json`);
  writeFileSync(outPath, JSON.stringify(session, null, 2) + '\n');

  const sum = summarizeSession(session);
  console.log(`\n✓ saved ${outPath}`);
  console.log(`  steps=${sum.nSteps} · outcome=${sum.outcome.kind}${sum.outcome.kind === 'left' ? '(' + sum.outcome.reason + ')' : ''} · path=${sum.path.join(' → ')}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
