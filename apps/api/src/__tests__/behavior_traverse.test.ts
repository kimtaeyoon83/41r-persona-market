import { describe, expect, it } from 'vitest';
import {
  traverseGraph,
  type TraverseGraph,
  type NextChoice,
} from '../services/behavior_sim/traverse.js';
import type { BehaviorTraits } from '../services/behavior_sim/state.js';

const traits: BehaviorTraits = {
  patience: 0.8,
  reading_tolerance: 1,
  exploration: 0.5,
  need_threshold: 1,
};

const lineGraph: TraverseGraph = {
  nodes: [
    { id: 'home', edges: [{ label: 'to a', to: 'a' }] },
    { id: 'a', edges: [{ label: 'to b', to: 'b' }] },
    { id: 'b', edges: [] },
  ],
};

describe('traverseGraph', () => {
  it('completes when the agent reaches its goal without leaving', () => {
    const chooseNext = (node: { id: string }): NextChoice =>
      node.id === 'b' ? { kind: 'done' } : { kind: 'move', to: node.id === 'home' ? 'a' : 'b' };
    const r = traverseGraph({ graph: lineGraph, traits, relevanceOf: () => 0.6, chooseNext });
    expect(r.outcome).toEqual({ kind: 'completed' });
    expect(r.path).toEqual(['home', 'a', 'b']);
  });

  it('leaves indifferent on a stagnant self-loop', () => {
    const loop: TraverseGraph = { nodes: [{ id: 'home', edges: [{ label: 'reload', to: 'home' }] }] };
    const r = traverseGraph({
      graph: loop,
      traits,
      relevanceOf: () => 0, // no content value → stagnation
      chooseNext: () => ({ kind: 'move', to: 'home' }),
    });
    expect(r.outcome.kind).toBe('left');
    if (r.outcome.kind === 'left') expect(r.outcome.mode).toBe('indifferent');
  });

  it('reports stuck when the agent gives up', () => {
    const r = traverseGraph({
      graph: lineGraph,
      traits,
      relevanceOf: () => 0.6,
      chooseNext: () => ({ kind: 'stuck' }),
    });
    expect(r.outcome).toEqual({ kind: 'stuck' });
    expect(r.steps).toBe(1);
  });

  it('reports stuck when a chosen edge points nowhere', () => {
    const r = traverseGraph({
      graph: lineGraph,
      traits,
      relevanceOf: () => 0.6,
      chooseNext: () => ({ kind: 'move', to: 'does-not-exist' }),
    });
    expect(r.outcome).toEqual({ kind: 'stuck' });
  });
});
