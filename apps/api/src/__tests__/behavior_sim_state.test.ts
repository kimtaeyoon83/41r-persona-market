/**
 * Internal-state engine locks (behavior_sim/state.ts).
 *
 * These are DIRECTION tests (perturbation-response style, spike doc
 * §5.2 H2): a trait perturbation must move the outcome the right way.
 * Absolute step counts are v0-parameter artifacts and intentionally
 * not asserted except where a bound is the contract itself.
 */
import { describe, expect, it } from 'vitest';
import {
  BehaviorTraits,
  DEFAULT_PARAMS,
  InternalState,
  StepSignals,
  effectiveInterestFloor,
  initState,
  leaveGate,
  updateState,
  weightedFriction,
} from '../services/behavior_sim/state.js';

const IMPATIENT: BehaviorTraits = { patience: 0.2, reading_tolerance: 0.2, exploration: 0.5 };
const PATIENT: BehaviorTraits = { patience: 0.8, reading_tolerance: 0.8, exploration: 0.4 };

const FRICTION_STEP: StepSignals = {
  frictions: [{ category: 'navigation', severity: 0.7 }],
  novelty: 1,
  relevance: 0,
};
const STAGNANT_STEP: StepSignals = { frictions: [], novelty: 0, relevance: 0 };
const VALUE_STEP: StepSignals = { frictions: [], novelty: 1, relevance: 1 };

/** Run identical signal stream until the gate fires or maxSteps. */
function runUntilLeave(
  traits: BehaviorTraits,
  signal: StepSignals,
  maxSteps = 50,
): { state: InternalState; leftAt: number | null; mode: string | null } {
  let state = initState(traits);
  for (let i = 1; i <= maxSteps; i++) {
    state = updateState(state, signal, traits);
    const d = leaveGate(state, traits, DEFAULT_PARAMS, () => 1); // rng=1 → distracted never fires
    if (d.leave) return { state, leftAt: i, mode: d.mode };
  }
  return { state, leftAt: null, mode: null };
}

describe('initState', () => {
  it('starts neutral with patience budget scaled by trait', () => {
    const s = initState(IMPATIENT);
    expect(s.frustration).toBe(0);
    expect(s.value_realized).toBe(0);
    expect(s.interest).toBe(1);
    expect(s.patience_remaining).toBeCloseTo(0.2 * DEFAULT_PARAMS.patienceBudgetMultiplier);
  });
});

describe('updateState', () => {
  it('is pure — never mutates the input state', () => {
    const s0 = initState(IMPATIENT);
    const frozen = JSON.stringify(s0);
    updateState(s0, FRICTION_STEP, IMPATIENT);
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it('frustration is non-decreasing and patience_remaining non-increasing', () => {
    let s = initState(PATIENT);
    for (let i = 0; i < 5; i++) {
      const next = updateState(s, FRICTION_STEP, PATIENT);
      expect(next.frustration).toBeGreaterThanOrEqual(s.frustration);
      expect(next.patience_remaining).toBeLessThanOrEqual(s.patience_remaining);
      s = next;
    }
  });

  it('weights friction by persona friction_weights (subjective weighting)', () => {
    const sensitive: BehaviorTraits = { ...IMPATIENT, friction_weights: { navigation: 2.0 } };
    const tolerant: BehaviorTraits = { ...IMPATIENT, friction_weights: { navigation: 0.5 } };
    expect(weightedFriction(FRICTION_STEP.frictions, sensitive)).toBeCloseTo(1.4);
    expect(weightedFriction(FRICTION_STEP.frictions, tolerant)).toBeCloseTo(0.35);
  });

  it('interest decays under zero novelty and recovers with novelty', () => {
    let s = initState(PATIENT);
    s = updateState(s, STAGNANT_STEP, PATIENT);
    s = updateState(s, STAGNANT_STEP, PATIENT);
    expect(s.interest).toBeLessThan(0.5);
    const recovered = updateState(s, VALUE_STEP, PATIENT);
    expect(recovered.interest).toBeGreaterThan(s.interest);
  });

  it('stagnant_steps resets on a novel or relevant step', () => {
    let s = initState(PATIENT);
    s = updateState(s, STAGNANT_STEP, PATIENT);
    s = updateState(s, STAGNANT_STEP, PATIENT);
    expect(s.stagnant_steps).toBe(2);
    s = updateState(s, VALUE_STEP, PATIENT);
    expect(s.stagnant_steps).toBe(0);
  });

  it('accumulates effort_expended by stepCost (dwell-time input)', () => {
    let s = initState(PATIENT);
    s = updateState(s, { ...STAGNANT_STEP, stepCost: 2 }, PATIENT);
    s = updateState(s, STAGNANT_STEP, PATIENT);
    expect(s.effort_expended).toBe(3);
  });
});

describe('leaveGate — frustrated', () => {
  it('impatient persona leaves strictly earlier than patient under the identical friction stream', () => {
    const imp = runUntilLeave(IMPATIENT, FRICTION_STEP);
    const pat = runUntilLeave(PATIENT, FRICTION_STEP);
    expect(imp.mode).toBe('frustrated');
    expect(pat.mode).toBe('frustrated');
    expect(imp.leftAt!).toBeLessThan(pat.leftAt!);
  });

  it('friction-sensitive weighting accelerates the frustrated exit', () => {
    const sensitive: BehaviorTraits = { ...PATIENT, friction_weights: { navigation: 2.0 } };
    const base = runUntilLeave(PATIENT, FRICTION_STEP);
    const fast = runUntilLeave(sensitive, FRICTION_STEP);
    expect(fast.leftAt!).toBeLessThanOrEqual(base.leftAt!);
  });
});

describe('leaveGate — satisfied', () => {
  it('relevance stream fills value_realized and exits satisfied (the 0/9 spike gap)', () => {
    const r = runUntilLeave(PATIENT, VALUE_STEP);
    expect(r.mode).toBe('satisfied');
  });

  it('zero-relevance stream never exits satisfied', () => {
    const r = runUntilLeave(PATIENT, STAGNANT_STEP);
    expect(r.mode).not.toBe('satisfied');
  });

  it('satisfied wins over frustrated when both thresholds are crossed', () => {
    const traits: BehaviorTraits = { ...IMPATIENT, need_threshold: 0.1 };
    let s = initState(traits);
    s = updateState(
      s,
      {
        frictions: [
          { category: 'trust', severity: 1 },
          { category: 'navigation', severity: 1 },
        ],
        novelty: 1,
        relevance: 1,
      },
      traits,
    );
    s = { ...s, frustration: 99, patience_remaining: 0 }; // force frustrated condition too
    const d = leaveGate(s, traits, DEFAULT_PARAMS, () => 1);
    expect(d.leave && d.mode).toBe('satisfied');
  });
});

describe('leaveGate — indifferent', () => {
  it('stagnation drives an indifferent exit without any friction (the 20/30-timeout spike gap)', () => {
    const r = runUntilLeave(PATIENT, STAGNANT_STEP);
    expect(r.mode).toBe('indifferent');
  });

  it('higher exploration tolerates stagnation longer (floor modulation)', () => {
    const explorer: BehaviorTraits = { ...PATIENT, exploration: 0.9 };
    const settler: BehaviorTraits = { ...PATIENT, exploration: 0.1 };
    expect(effectiveInterestFloor(explorer)).toBeLessThan(effectiveInterestFloor(settler));
    const e = runUntilLeave(explorer, STAGNANT_STEP);
    const s = runUntilLeave(settler, STAGNANT_STEP);
    expect(e.leftAt!).toBeGreaterThanOrEqual(s.leftAt!);
  });

  it('requires the full stagnant window — novelty resets the clock', () => {
    let state = initState(PATIENT);
    // alternate stagnant/novel so stagnant_steps never reaches the window
    for (let i = 0; i < 10; i++) {
      state = updateState(state, i % 2 === 0 ? STAGNANT_STEP : { ...STAGNANT_STEP, novelty: 1 }, PATIENT);
      const d = leaveGate(state, PATIENT, DEFAULT_PARAMS, () => 1);
      expect(d.leave && d.mode === 'indifferent').toBe(false);
    }
  });
});

describe('leaveGate — distracted', () => {
  it('fires only via injected rng below distraction_rate', () => {
    const traits: BehaviorTraits = { ...PATIENT, distraction_rate: 0.1, need_threshold: 99 };
    const s = updateState(initState(traits), VALUE_STEP, traits);
    const hit = leaveGate(s, traits, DEFAULT_PARAMS, () => 0.05);
    const miss = leaveGate(s, traits, DEFAULT_PARAMS, () => 0.95);
    expect(hit.leave && hit.mode).toBe('distracted');
    expect(miss.leave).toBe(false);
  });

  it('never fires when distraction_rate is absent, regardless of rng', () => {
    const s = updateState(initState(PATIENT), STAGNANT_STEP, PATIENT);
    const d = leaveGate(s, PATIENT, DEFAULT_PARAMS, () => 0);
    expect(d.leave).toBe(false);
  });
});
