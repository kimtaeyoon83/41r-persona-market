#!/usr/bin/env npx tsx
/**
 * Generate simulator predictions (_sim.json) for calibration.
 *
 * Closes the last gate-pipeline piece: replays each human session's node
 * path through the leave-gate simulator (simulate.ts) and writes the
 * SimPrediction[] that calibrate.ts scores against the human ground truth.
 *
 * Per-step signals:
 *   - novelty   : derived objectively (first visit = 1, revisit = 0)
 *   - frictions : derived from the graph node (login_wall → trust friction)
 *   - relevance : the CONTENT-NEED judgment. This is the one signal that
 *                 cannot be derived from structure alone — it is the LLM's
 *                 job in run.ts. Here it is sourced from an operator-/LLM-
 *                 supplied map spike/think-aloud/_relevance.json
 *                 ({ "<nodeId>": 0..1 }). WITHOUT it, relevance defaults to
 *                 0 and the output is MEANINGLESS (everything stagnates) —
 *                 the script warns loudly so no one trusts that run.
 *
 * Persona traits default to a mid persona; override per cohort later.
 *
 * Usage:
 *   pnpm tsx scripts/spike-behavior-sim/gen-sim.ts [graph.json]
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  simulateSession,
  type ReplayStep,
} from '../../apps/api/src/services/behavior_sim/simulate.js';
import type { SimPrediction } from '../../apps/api/src/services/behavior_sim/calibration.js';
import type { ThinkAloudSession } from '../../apps/api/src/services/behavior_sim/think_aloud.js';
import type {
  BehaviorTraits,
  FrictionEvent,
} from '../../apps/api/src/services/behavior_sim/state.js';

type GraphNode = { id: string; login_wall?: boolean };
type Graph = { nodes: GraphNode[] };

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(repoRoot, 'spike', 'think-aloud');
const graphPath = process.argv[2] ?? join(repoRoot, 'spike', 'graph.json');

// Mid persona — calibration should later run per cohort trait vector.
const TRAITS: BehaviorTraits = {
  patience: 0.5,
  reading_tolerance: 0.5,
  exploration: 0.5,
  need_threshold: 1.0,
};

function main(): void {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as Graph;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const relPath = join(dir, '_relevance.json');
  const relevanceMap: Record<string, number> = existsSync(relPath)
    ? (JSON.parse(readFileSync(relPath, 'utf8')) as Record<string, number>)
    : {};
  if (!existsSync(relPath)) {
    console.warn(
      `⚠️  no ${relPath} — relevance defaults to 0, so predictions are MEANINGLESS.\n` +
        '    Supply per-node relevance (the content-need judgment, LLM in run.ts) and re-run.',
    );
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const preds: SimPrediction[] = [];
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ThinkAloudSession;
    const visit = new Map<string, number>();
    const path = [s.steps[0]?.nodeId, ...s.steps.map((st) => st.toNodeId)].filter(
      (n): n is string => typeof n === 'string',
    );
    const replay: ReplayStep[] = path.map((nodeId) => {
      const seen = (visit.get(nodeId) ?? 0) + 1;
      visit.set(nodeId, seen);
      const node = nodeById.get(nodeId);
      const frictions: FrictionEvent[] = node?.login_wall
        ? [{ category: 'trust', severity: 0.8 }]
        : [];
      return {
        nodeId,
        signals: {
          frictions,
          novelty: seen <= 1 ? 1 : 0,
          relevance: relevanceMap[nodeId] ?? 0,
        },
      };
    });
    preds.push(simulateSession(s.subjectId, TRAITS, replay));
  }

  const outPath = join(dir, '_sim.json');
  writeFileSync(outPath, JSON.stringify(preds, null, 2) + '\n');
  console.log(`✓ wrote ${preds.length} prediction(s) → ${outPath}`);
  for (const p of preds) {
    console.log(
      `  ${p.subjectId}: ${p.outcome.kind === 'left' ? `left(${p.outcome.mode})@${p.outcome.atStep}` : 'stayed'}`,
    );
  }
  console.log('\nNext: pnpm tsx scripts/spike-behavior-sim/calibrate.ts');
}

main();
