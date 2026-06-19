import { describe, expect, it, vi } from 'vitest';
import { runModeCSession, type ModeCDeps } from '../services/session/mode_c.js';
import { SessionPlanError } from '../services/session/planner.js';
import type { TraverseGraph, NextChoice } from '../services/behavior_sim/traverse.js';
import type { BehaviorTraits } from '../services/behavior_sim/state.js';

const traits: BehaviorTraits = {
  patience: 0.8,
  reading_tolerance: 1,
  exploration: 0.5,
  need_threshold: 1,
};

const graph: TraverseGraph = {
  nodes: [
    { id: 'home', edges: [{ label: 'to a', to: 'a' }] },
    { id: 'a', edges: [] },
  ],
};

function deps(): ModeCDeps {
  return {
    graph,
    personas: [
      { personaId: 'p1', traits },
      { personaId: 'p2', traits },
    ],
    relevanceOf: vi.fn(() => 0.6),
    // home → move to 'a', then complete at 'a'
    chooseNext: vi.fn(
      (node): NextChoice => (node.id === 'a' ? { kind: 'done' } : { kind: 'move', to: 'a' }),
    ),
  };
}

const baseReq = { source: 'user', targetUrl: 'https://example.com', tier: 'T1' } as const;

describe('runModeCSession — gate (§11)', () => {
  it('throws mode_c_gated and runs NO traversal while the gate is shut', () => {
    const d = deps();
    expect(() => runModeCSession(baseReq, d, { thinkAloudGatePassed: false })).toThrow(
      SessionPlanError,
    );
    expect(d.relevanceOf).not.toHaveBeenCalled();
    expect(d.chooseNext).not.toHaveBeenCalled();
  });

  it('defaults to the env gate (false in test) — shut without an explicit ctx', () => {
    try {
      runModeCSession(baseReq, deps());
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SessionPlanError);
      expect((e as SessionPlanError).code).toBe('mode_c_gated');
    }
  });
});

describe('runModeCSession — open gate dispatches traverse per persona', () => {
  it('forces autonomous mode and returns one result per persona', () => {
    const out = runModeCSession(baseReq, deps(), { thinkAloudGatePassed: true });
    expect(out.plan.mode).toBe('autonomous');
    expect(out.perPersona.map((p) => p.personaId)).toEqual(['p1', 'p2']);
    for (const p of out.perPersona) {
      expect(p.result.outcome).toEqual({ kind: 'completed' });
      expect(p.result.path).toEqual(['home', 'a']);
    }
  });
});

describe('runModeCSession — cross-axis rules still apply once open', () => {
  it('rejects a sealed-asset session on T0 even with the gate open', () => {
    try {
      runModeCSession(
        { ...baseReq, tier: 'T0', secretAsset: true },
        deps(),
        { thinkAloudGatePassed: true },
      );
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SessionPlanError);
      expect((e as SessionPlanError).code).toBe('secret_requires_sandbox');
    }
  });
});
