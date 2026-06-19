// Mode C session worker — the planner → traverse rail.
//
// This is where the autonomous-agent body (traverse.ts) is dispatched
// behind the session planner's gate. It is the ONLY place the two connect:
//   planSession()  enforces the think-aloud build gate (§11)
//   traverseGraph() runs one persona's traversal once the gate is open
//
// ⚠️ GATED: runModeCSession FORCES mode:'autonomous', so planSession always
// applies the Mode C gate. With the env flag false (production default), it
// throws SessionPlanError('mode_c_gated') before any traversal runs — the
// rail is wired but unreachable until calibration passes. The graph capture
// and the LLM-backed relevanceOf/chooseNext are injected (ModeCDeps): this
// module owns the gate + fan-out, not the perception/decision LLMs.

import { thinkAloudGatePassed as ENV_GATE } from '../../config/env.js';
import { planSession, type SessionRequest, type SessionPlan } from './planner.js';
import {
  traverseGraph,
  type TraverseGraph,
  type TraverseNode,
  type NextChoice,
  type ModeCResult,
} from '../behavior_sim/traverse.js';
import type { BehaviorTraits } from '../behavior_sim/state.js';

export type ModeCPersona = { personaId: string; traits: BehaviorTraits };

export type ModeCDeps = {
  /** The captured site graph the personas traverse. */
  graph: TraverseGraph;
  /** Personas to fan the traversal across. */
  personas: ModeCPersona[];
  /** Content relevance 0..1 of a node for a persona (relevance.ts in prod). */
  relevanceOf: (node: TraverseNode, persona: ModeCPersona) => number;
  /** Next-edge choice for a persona at a node (LLM in prod). */
  chooseNext: (node: TraverseNode, trail: string[], persona: ModeCPersona) => NextChoice;
};

export type ModeCSessionResult = {
  plan: SessionPlan;
  perPersona: { personaId: string; result: ModeCResult }[];
};

/**
 * Plan + run a Mode C (autonomous traversal) session. Throws
 * SessionPlanError('mode_c_gated') while the think-aloud gate is shut
 * (env THINK_ALOUD_GATE_PASSED, false in prod) — tests inject
 * ctx.thinkAloudGatePassed to exercise the open path. The request's mode
 * is forced to 'autonomous' so the gate can never be sidestepped by
 * passing a different mode.
 */
export function runModeCSession(
  req: Omit<SessionRequest, 'mode'>,
  deps: ModeCDeps,
  ctx?: { thinkAloudGatePassed?: boolean },
): ModeCSessionResult {
  const gatePassed = ctx?.thinkAloudGatePassed ?? ENV_GATE;
  const plan = planSession({ ...req, mode: 'autonomous' }, { thinkAloudGatePassed: gatePassed });

  const perPersona = deps.personas.map((persona) => ({
    personaId: persona.personaId,
    result: traverseGraph({
      graph: deps.graph,
      traits: persona.traits,
      relevanceOf: (node) => deps.relevanceOf(node, persona),
      chooseNext: (node, trail) => deps.chooseNext(node, trail, persona),
    }),
  }));

  return { plan, perPersona };
}
