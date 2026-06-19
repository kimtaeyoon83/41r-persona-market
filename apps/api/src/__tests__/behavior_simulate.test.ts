import { describe, expect, it } from 'vitest';
import { simulateSession, type ReplayStep } from '../services/behavior_sim/simulate.js';
import type { BehaviorTraits, StepSignals } from '../services/behavior_sim/state.js';

function sig(over: Partial<StepSignals>): StepSignals {
  return { frictions: [], novelty: 1, relevance: 0, ...over };
}
function steps(n: number, s: StepSignals): ReplayStep[] {
  return Array.from({ length: n }, (_, i) => ({ nodeId: `n${i}`, signals: s }));
}

describe('simulateSession path-replay', () => {
  it('leaves satisfied when value_realized reaches the need threshold', () => {
    const t: BehaviorTraits = { patience: 1, reading_tolerance: 1, exploration: 0.5, need_threshold: 1 };
    const r = simulateSession('P1', t, steps(4, sig({ relevance: 1, novelty: 1 })));
    expect(r.outcome).toEqual({ kind: 'left', mode: 'satisfied', atStep: 1 });
  });

  it('leaves frustrated when frustration overruns patience', () => {
    const t: BehaviorTraits = { patience: 0.25, reading_tolerance: 0.5, exploration: 0.5 };
    const r = simulateSession('P2', t, [
      { nodeId: 'home', signals: sig({ frictions: [{ category: 'navigation', severity: 1 }], relevance: 0, novelty: 0 }) },
    ]);
    expect(r.outcome).toEqual({ kind: 'left', mode: 'frustrated', atStep: 0 });
  });

  it('leaves indifferent after a stagnant stretch', () => {
    const t: BehaviorTraits = { patience: 0.8, reading_tolerance: 1, exploration: 0.5 };
    const r = simulateSession('P3', t, steps(4, sig({ novelty: 0, relevance: 0 })));
    expect(r.outcome.kind).toBe('left');
    if (r.outcome.kind === 'left') {
      expect(r.outcome.mode).toBe('indifferent');
      expect(r.outcome.atStep).toBe(2);
    }
  });

  it('stays when relevant-but-not-satisfying and engaging', () => {
    const t: BehaviorTraits = { patience: 1, reading_tolerance: 1, exploration: 0.5, need_threshold: 1 };
    const r = simulateSession('P4', t, steps(2, sig({ relevance: 0.3, novelty: 1 })));
    expect(r.outcome).toEqual({ kind: 'stayed' });
    expect(r.path).toEqual(['n0', 'n1']);
  });
});
