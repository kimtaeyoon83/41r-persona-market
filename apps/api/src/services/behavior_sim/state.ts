/**
 * Behavior-sim internal-state engine — L4 core of the Mode C
 * behavior simulation (docs/41rpm_behavior_simulation_spec_v1.md §4).
 *
 * Pure module: no I/O, no LLM, no clock. Every function returns new
 * objects. The caller (session loop) owns the per-step orchestration;
 * this module owns "how the visitor feels" and "whether they leave".
 *
 * Spike evidence behind this design (docs/41rpm_behavior_sim_spike_v0.md §7):
 *   - LLMs choose frustrated-leave on their own but NEVER leave from
 *     boredom (10x10 v1: 20/30 timeout while noting "같은 카테고리를
 *     반복적으로 오가고 있다") and NEVER declare satisfaction (unit
 *     test: 0/9 facing a suitable product). All three exits therefore
 *     need state-driven gates outside the LLM.
 *   - Trait-uniform gates homogenize archetypes (10x10 v2) — hence
 *     the exploration modulation on the interest floor.
 *
 * Parameter values are v0 placeholders. Tests assert DIRECTION
 * (perturbation-response), not absolute values; absolutes are the
 * calibration target (spec §7.2).
 */

export type FrictionCategory =
  | 'navigation'
  | 'comprehension'
  | 'trust'
  | 'performance'
  | 'content_mismatch';

export interface FrictionEvent {
  category: FrictionCategory;
  severity: number; // 0..1, from Ch1 normalization or Ch2 judgment
}

export interface BehaviorTraits {
  patience: number; // 0..1
  reading_tolerance: number; // 0..1
  exploration: number; // 0..1
  /** Per-category subjective weighting (spec §4.1). Missing key = 1.0. */
  friction_weights?: Partial<Record<FrictionCategory, number>>;
  /** Per-step probability of leaving for external reasons. Default 0. */
  distraction_rate?: number;
  /** value_realized needed to leave satisfied. Default 1.0. */
  need_threshold?: number;
}

export interface StepSignals {
  /** Frictions detected THIS step (objective detection; weighting happens here). */
  frictions: FrictionEvent[];
  /** 1 = first visit to this screen, 0 = revisit. Graded values allowed. */
  novelty: number;
  /** 0..1 — how much this screen served the need (Ch2 value signal). */
  relevance: number;
  /** Abstract cost of taking this step. Default 1. */
  stepCost?: number;
}

export interface InternalState {
  frustration: number;
  patience_remaining: number;
  value_realized: number;
  interest: number;
  effort_expended: number;
  steps: number;
  /** Consecutive steps with no novelty and no meaningful relevance. */
  stagnant_steps: number;
}

export interface EngineParams {
  alpha: number; // frustration gain per weighted friction
  beta: number; // patience drain per weighted friction
  gamma: number; // patience drain per step (fatigue)
  delta: number; // value gain per relevance unit
  interestEma: number; // weight on prior interest in the EMA
  interestFloorBase: number; // indifferent threshold before exploration modulation
  stagnantWindow: number; // steps of stagnation required for indifferent
  patienceBudgetMultiplier: number; // patience_remaining init = patience × this
  relevanceEpsilon: number; // relevance below this counts as stagnant
}

export const DEFAULT_PARAMS: EngineParams = {
  alpha: 1.0,
  beta: 0.15,
  gamma: 0.05,
  delta: 0.5,
  interestEma: 0.6,
  interestFloorBase: 0.3,
  stagnantWindow: 3,
  patienceBudgetMultiplier: 4,
  relevanceEpsilon: 0.2,
};

export type LeaveMode = 'satisfied' | 'frustrated' | 'indifferent' | 'distracted';

export type LeaveDecision =
  | { leave: false }
  | { leave: true; mode: LeaveMode; reason: string };

export function initState(traits: BehaviorTraits, params: EngineParams = DEFAULT_PARAMS): InternalState {
  return {
    frustration: 0,
    patience_remaining: traits.patience * params.patienceBudgetMultiplier,
    value_realized: 0,
    interest: 1,
    effort_expended: 0,
    steps: 0,
    stagnant_steps: 0,
  };
}

/** Σ(severity × persona weight) — objective detection, subjective weighting (spec principle 2). */
export function weightedFriction(frictions: FrictionEvent[], traits: BehaviorTraits): number {
  let sum = 0;
  for (const f of frictions) {
    const w = traits.friction_weights?.[f.category] ?? 1.0;
    sum += Math.max(0, Math.min(1, f.severity)) * w;
  }
  return sum;
}

/** Spec §4.2 update — pure; returns a new state, never mutates. */
export function updateState(
  state: InternalState,
  signals: StepSignals,
  traits: BehaviorTraits,
  params: EngineParams = DEFAULT_PARAMS,
): InternalState {
  const stepCost = signals.stepCost ?? 1;
  const wf = weightedFriction(signals.frictions, traits);
  const novelty = Math.max(0, Math.min(1, signals.novelty));
  const relevance = Math.max(0, Math.min(1, signals.relevance));
  const stagnantStep = novelty === 0 && relevance < params.relevanceEpsilon;

  return {
    frustration: state.frustration + params.alpha * wf,
    patience_remaining: Math.max(
      0,
      state.patience_remaining - params.beta * wf - params.gamma * stepCost,
    ),
    value_realized: state.value_realized + params.delta * relevance,
    interest: params.interestEma * state.interest + (1 - params.interestEma) * novelty,
    effort_expended: state.effort_expended + stepCost,
    steps: state.steps + 1,
    stagnant_steps: stagnantStep ? state.stagnant_steps + 1 : 0,
  };
}

/**
 * Indifferent threshold, modulated by exploration: explorers tolerate
 * longer low-novelty stretches before checking out (10x10 v2 lesson —
 * a trait-uniform floor homogenized patient/mid leave steps).
 * exploration 0 → 1.25×base · 0.5 → base · 1 → 0.75×base
 */
export function effectiveInterestFloor(traits: BehaviorTraits, params: EngineParams = DEFAULT_PARAMS): number {
  return params.interestFloorBase * (1.25 - 0.5 * traits.exploration);
}

/**
 * Spec §4.3 leave-gate. Evaluated FIRST each step, before any LLM
 * call (spec principle 4). Check order is fixed: satisfied wins over
 * frustrated wins over indifferent wins over distracted.
 *
 * `rng` is injected so tests (and resumable runs) stay deterministic.
 */
export function leaveGate(
  state: InternalState,
  traits: BehaviorTraits,
  params: EngineParams = DEFAULT_PARAMS,
  rng: () => number = Math.random,
): LeaveDecision {
  const needThreshold = traits.need_threshold ?? 1.0;
  if (state.value_realized >= needThreshold) {
    return {
      leave: true,
      mode: 'satisfied',
      reason: `value_realized ${state.value_realized.toFixed(2)} ≥ need_threshold ${needThreshold}`,
    };
  }
  if (state.frustration >= state.patience_remaining) {
    return {
      leave: true,
      mode: 'frustrated',
      reason: `frustration ${state.frustration.toFixed(2)} ≥ patience_remaining ${state.patience_remaining.toFixed(2)}`,
    };
  }
  const floor = effectiveInterestFloor(traits, params);
  if (state.interest < floor && state.stagnant_steps >= params.stagnantWindow) {
    return {
      leave: true,
      mode: 'indifferent',
      reason: `interest ${state.interest.toFixed(2)} < floor ${floor.toFixed(2)} after ${state.stagnant_steps} stagnant steps`,
    };
  }
  const distraction = traits.distraction_rate ?? 0;
  if (distraction > 0 && rng() < distraction) {
    return { leave: true, mode: 'distracted', reason: `distraction_rate ${distraction}` };
  }
  return { leave: false };
}
