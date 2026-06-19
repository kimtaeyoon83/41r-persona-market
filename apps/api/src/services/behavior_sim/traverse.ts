// Mode C traversal engine — the autonomous-agent body (graph mode).
//
// ⚠️ GATED FOR ACTIVATION (CLAUDE.md "Behavior Simulation"): this WIRES the
// existing leave-gate (state.ts) into a per-step traversal loop. It does
// NOT tune the simulator — building the harness is infrastructure, not the
// thing the think-aloud gate protects. But its OUTPUT must not be trusted
// (no production funnel, no campaign use) until calibration passes
// (scripts/spike-behavior-sim/calibrate.ts). The session planner already
// blocks `mode: 'autonomous'` until then (planner.ts).
//
// Graph mode first (agreed direction): a persona walks a captured site
// graph; at each node we compute signals (novelty / friction / relevance),
// advance the internal state, and check the leave-gate. The two judgment
// inputs — content relevance and the next-edge choice — are INJECTED so
// the loop is pure + testable; production supplies the LLM (relevance.ts /
// run.ts's llmStep).

import {
  initState,
  updateState,
  leaveGate,
  DEFAULT_PARAMS,
  type BehaviorTraits,
  type EngineParams,
  type FrictionEvent,
  type LeaveMode,
} from './state.js';

export type TraverseNode = {
  id: string;
  login_wall?: boolean;
  edges: { label: string; to: string }[];
};
export type TraverseGraph = { nodes: TraverseNode[]; startId?: string };

/** The agent's navigation decision at a node (LLM in prod). */
export type NextChoice =
  | { kind: 'move'; to: string }
  | { kind: 'done' } // found what it came for → completed
  | { kind: 'stuck' }; // nowhere useful to go

export type ModeCOutcome =
  | { kind: 'completed' }
  | { kind: 'left'; mode: LeaveMode; atStep: number }
  | { kind: 'stuck' };

export type ModeCStep = {
  nodeId: string;
  novelty: number;
  relevance: number;
  leave: boolean;
};

export type ModeCResult = {
  path: string[];
  outcome: ModeCOutcome;
  steps: number;
  trace: ModeCStep[];
};

export function traverseGraph(opts: {
  graph: TraverseGraph;
  traits: BehaviorTraits;
  /** Content relevance 0..1 for a node (relevance.ts in prod). */
  relevanceOf: (node: TraverseNode) => number;
  /** Next-edge choice given the node + the trail so far (LLM in prod). */
  chooseNext: (node: TraverseNode, trail: string[]) => NextChoice;
  params?: EngineParams;
  rng?: () => number;
  maxSteps?: number;
}): ModeCResult {
  const params = opts.params ?? DEFAULT_PARAMS;
  const rng = opts.rng ?? (() => 1); // never-distract unless injected
  const maxSteps = opts.maxSteps ?? 50;
  const byId = new Map(opts.graph.nodes.map((n) => [n.id, n]));

  let state = initState(opts.traits, params);
  const visits = new Map<string, number>();
  const path: string[] = [];
  const trace: ModeCStep[] = [];

  let current =
    (opts.graph.startId ? byId.get(opts.graph.startId) : undefined) ??
    opts.graph.nodes[0];
  if (!current) return { path, outcome: { kind: 'stuck' }, steps: 0, trace };

  for (let step = 0; step < maxSteps; step++) {
    path.push(current.id);
    const seen = (visits.get(current.id) ?? 0) + 1;
    visits.set(current.id, seen);

    const novelty = seen <= 1 ? 1 : 0;
    const relevance = Math.max(0, Math.min(1, opts.relevanceOf(current)));
    const frictions: FrictionEvent[] = current.login_wall
      ? [{ category: 'trust', severity: 0.8 }]
      : [];

    state = updateState(state, { frictions, novelty, relevance }, opts.traits, params);
    const decision = leaveGate(state, opts.traits, params, rng);
    trace.push({ nodeId: current.id, novelty, relevance, leave: decision.leave });

    if (decision.leave) {
      return { path, outcome: { kind: 'left', mode: decision.mode, atStep: step }, steps: step + 1, trace };
    }

    const choice = opts.chooseNext(current, [...path]);
    if (choice.kind === 'done') {
      return { path, outcome: { kind: 'completed' }, steps: step + 1, trace };
    }
    if (choice.kind === 'stuck') {
      return { path, outcome: { kind: 'stuck' }, steps: step + 1, trace };
    }
    const next = byId.get(choice.to);
    if (!next) {
      return { path, outcome: { kind: 'stuck' }, steps: step + 1, trace };
    }
    current = next;
  }

  return { path, outcome: { kind: 'stuck' }, steps: maxSteps, trace };
}
