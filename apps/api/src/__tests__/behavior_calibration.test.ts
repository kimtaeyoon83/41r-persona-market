import { describe, expect, it } from 'vitest';
import { calibrate, type SimPrediction } from '../services/behavior_sim/calibration.js';
import type { ThinkAloudSession, Outcome } from '../services/behavior_sim/think_aloud.js';

function human(subjectId: string, outcome: Outcome, path: string[] = ['home']): ThinkAloudSession {
  // Build steps so the reconstructed path === `path`.
  const steps = path.map((nodeId, i) => ({
    stepIndex: i,
    nodeId,
    dwellMs: 1000,
    utterance: 'x',
    chosenEdgeLabel: i < path.length - 1 ? 'e' : null,
    toNodeId: i < path.length - 1 ? path[i + 1]! : null,
  }));
  return {
    schemaVersion: 1,
    site: 'nhis',
    need: 'task',
    subjectId,
    protocol: 'NHIS',
    startedAt: '2026-06-19T00:00:00.000Z',
    steps,
    outcome,
  };
}

describe('calibrate', () => {
  it('perfect outcome + reason agreement passes the gate', () => {
    const humans = [
      human('P1', { kind: 'reached_goal' }),
      human('P2', { kind: 'left', reason: 'frustrated' }),
    ];
    const sims: SimPrediction[] = [
      { subjectId: 'P1', outcome: { kind: 'stayed' } },
      { subjectId: 'P2', outcome: { kind: 'left', mode: 'frustrated', atStep: 1 } },
    ];
    const r = calibrate(humans, sims);
    expect(r.nPaired).toBe(2);
    expect(r.outcomeAgreement).toBe(1);
    expect(r.leaveReasonAgreement).toBe(1);
    expect(r.passesGate).toBe(true);
  });

  it('outcome mismatch lowers agreement and fails the gate', () => {
    const humans = [
      human('P1', { kind: 'reached_goal' }),
      human('P2', { kind: 'left', reason: 'frustrated' }),
    ];
    const sims: SimPrediction[] = [
      { subjectId: 'P1', outcome: { kind: 'left', mode: 'indifferent', atStep: 0 } }, // sim left, human stayed
      { subjectId: 'P2', outcome: { kind: 'stayed' } }, // sim stayed, human left
    ];
    const r = calibrate(humans, sims, { gateThreshold: 0.7 });
    expect(r.outcomeAgreement).toBe(0);
    expect(r.passesGate).toBe(false);
  });

  it('gave_up matches frustrated OR indifferent', () => {
    const humans = [human('P1', { kind: 'left', reason: 'gave_up' })];
    expect(
      calibrate(humans, [{ subjectId: 'P1', outcome: { kind: 'left', mode: 'indifferent', atStep: 1 } }])
        .leaveReasonAgreement,
    ).toBe(1);
    expect(
      calibrate(humans, [{ subjectId: 'P1', outcome: { kind: 'left', mode: 'distracted', atStep: 1 } }])
        .leaveReasonAgreement,
    ).toBe(0);
  });

  it('scores path agreement when sim provides a path', () => {
    const humans = [human('P1', { kind: 'reached_goal' }, ['home', 'a', 'b'])];
    const r = calibrate(humans, [
      { subjectId: 'P1', outcome: { kind: 'stayed' }, path: ['home', 'a', 'z'] }, // 2/3 match
    ]);
    expect(r.pathAgreement).toBeCloseTo(2 / 3, 6);
  });

  it('skips unpaired subjects', () => {
    const r = calibrate([human('P1', { kind: 'reached_goal' })], []);
    expect(r.nPaired).toBe(0);
    expect(r.passesGate).toBe(false);
  });
});
