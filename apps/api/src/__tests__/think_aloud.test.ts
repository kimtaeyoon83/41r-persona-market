import { describe, expect, it } from 'vitest';
import {
  summarizeSession,
  validateSession,
  type ThinkAloudSession,
} from '../services/behavior_sim/think_aloud.js';

const good: ThinkAloudSession = {
  schemaVersion: 1,
  site: 'nhis',
  need: 'find the health checkup schedule',
  subjectId: 'P1',
  protocol: 'NHIS',
  startedAt: '2026-06-19T00:00:00.000Z',
  steps: [
    {
      stepIndex: 0,
      nodeId: 'home',
      dwellMs: 4000,
      utterance: 'too many links, where is checkup',
      chosenEdgeLabel: '나의 건강',
      toNodeId: 'checkup_roadmap',
      feel: 'confused',
    },
    {
      stepIndex: 1,
      nodeId: 'checkup_roadmap',
      dwellMs: 2000,
      utterance: 'ok this looks right',
      chosenEdgeLabel: null,
      toNodeId: null,
      feel: 'satisfied',
    },
  ],
  outcome: { kind: 'reached_goal' },
};

describe('summarizeSession', () => {
  it('reconstructs the node path and dwell total', () => {
    const s = summarizeSession(good);
    expect(s.path).toEqual(['home', 'checkup_roadmap']);
    expect(s.nSteps).toBe(2);
    expect(s.totalDwellMs).toBe(6000);
    expect(s.bouncedBeforeGoal).toBe(false);
  });

  it('flags a bounce when the subject left', () => {
    const left = {
      ...good,
      outcome: { kind: 'left', reason: 'frustrated' } as const,
    };
    expect(summarizeSession(left).bouncedBeforeGoal).toBe(true);
  });
});

describe('validateSession', () => {
  it('passes a well-formed session', () => {
    expect(validateSession(good)).toEqual([]);
  });

  it('catches out-of-order steps, empty utterance, and edge/target mismatch', () => {
    const bad: ThinkAloudSession = {
      ...good,
      steps: [
        {
          stepIndex: 5, // wrong
          nodeId: 'home',
          dwellMs: -1, // negative
          utterance: '   ', // empty
          chosenEdgeLabel: 'somewhere',
          toNodeId: null, // chose edge but no target
        },
      ],
    };
    const issues = validateSession(bad);
    expect(issues.length).toBeGreaterThanOrEqual(4);
    expect(issues.some((i) => i.includes('stepIndex'))).toBe(true);
    expect(issues.some((i) => i.includes('empty utterance'))).toBe(true);
    expect(issues.some((i) => i.includes('toNodeId is null'))).toBe(true);
  });
});
