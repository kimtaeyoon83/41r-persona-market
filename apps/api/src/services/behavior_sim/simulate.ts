// Path-replay adapter: run the leave-gate simulator (state.ts) over a
// fixed node path and report where/why it would have left.
//
// The Mode C gate is specifically about the LEAVE-GATE model (does the
// frustration / value / interest dynamics fire at the right moment?), so
// calibration replays the HUMAN's actual path through the simulator and
// compares the predicted leave point/mode to where the human really left.
// Navigation choice (which edge) is a separate concern and is taken from
// the human path, isolating the thing under test.
//
// Pure + deterministic (rng injected, default never-distract). The runner
// (scripts/.../gen-sim.ts) builds the per-step signals and emits the
// SimPrediction[] that calibration.ts scores.

import {
  initState,
  updateState,
  leaveGate,
  DEFAULT_PARAMS,
  type BehaviorTraits,
  type StepSignals,
  type EngineParams,
} from './state.js';
import type { SimPrediction } from './calibration.js';

export type ReplayStep = { nodeId: string; signals: StepSignals };

/**
 * Replay `steps` through the simulator for one subject. Returns the first
 * step the leave-gate fires (left + mode + atStep), or `stayed` if it
 * reaches the end. `rng` defaults to always-1 so distraction never fires
 * unless a test injects it — keeping calibration deterministic.
 */
export function simulateSession(
  subjectId: string,
  traits: BehaviorTraits,
  steps: readonly ReplayStep[],
  params: EngineParams = DEFAULT_PARAMS,
  rng: () => number = () => 1,
): SimPrediction {
  let state = initState(traits, params);
  const path: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    path.push(step.nodeId);
    // Observe the screen (update internal state), then decide.
    state = updateState(state, step.signals, traits, params);
    const decision = leaveGate(state, traits, params, rng);
    if (decision.leave) {
      return {
        subjectId,
        outcome: { kind: 'left', mode: decision.mode, atStep: i },
        path,
      };
    }
  }
  return { subjectId, outcome: { kind: 'stayed' }, path };
}
