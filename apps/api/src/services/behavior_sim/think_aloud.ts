// Think-aloud ground-truth schema (design: behavior_sim spec §1; the
// build gate before Mode C — CLAUDE.md "Behavior Simulation").
//
// The gate requires real human think-aloud data BEFORE the leave-gate
// simulator (state.ts) is tuned further, so it's calibrated against how
// people actually behave, not toward aesthetics. This module is the
// structured form that data takes: a facilitator walks a subject through
// the captured site graph (spike/graph.json), recording at each node
// what they SAID, what they CHOSE, and how long they took — plus the
// final outcome (reached the goal / left, and why).
//
// A session is the ground truth the simulator's per-step LeaveDecision is
// later scored against (the spike's "gate-label vs utterance" agreement).
// Pure schema + helpers; no I/O.

/** Facilitator-coded affect at a step (optional, from the utterance). */
export type SelfReportedFeel =
  | 'fine'
  | 'confused'
  | 'frustrated'
  | 'satisfied'
  | 'bored';

export interface ThinkAloudStep {
  /** 0-based position in the session. */
  stepIndex: number;
  /** Graph node the subject was on (spike/graph.json node id). */
  nodeId: string;
  /** Milliseconds on the node before acting. */
  dwellMs: number;
  /** What the subject said aloud, transcribed verbatim. */
  utterance: string;
  /** The navigation choice taken (edge label), or null when stuck/none. */
  chosenEdgeLabel: string | null;
  /** Resolved target node id (null when no move). */
  toNodeId: string | null;
  /** Optional affect the facilitator codes from the utterance. */
  feel?: SelfReportedFeel;
}

export type Outcome =
  | { kind: 'reached_goal' }
  | { kind: 'left'; reason: 'satisfied' | 'frustrated' | 'gave_up' | 'distracted' };

export interface ThinkAloudSession {
  schemaVersion: 1;
  site: string;
  /** The task the subject was asked to accomplish (graph.need). */
  need: string;
  /** Anonymized subject id (e.g. "P1".."P5") — never PII. */
  subjectId: string;
  protocol: string; // e.g. "NHIS"
  /** ISO timestamp. */
  startedAt: string;
  steps: ThinkAloudStep[];
  outcome: Outcome;
  notes?: string;
}

export interface SessionSummary {
  subjectId: string;
  nSteps: number;
  /** Node-id path the subject walked. */
  path: string[];
  outcome: Outcome;
  /** True when they left without reaching the goal. */
  bouncedBeforeGoal: boolean;
  totalDwellMs: number;
}

/** Derived, audit-friendly summary. Pure. */
export function summarizeSession(s: ThinkAloudSession): SessionSummary {
  const path = [s.steps[0]?.nodeId, ...s.steps.map((st) => st.toNodeId)].filter(
    (n): n is string => typeof n === 'string',
  );
  return {
    subjectId: s.subjectId,
    nSteps: s.steps.length,
    path,
    outcome: s.outcome,
    bouncedBeforeGoal: s.outcome.kind === 'left',
    totalDwellMs: s.steps.reduce((sum, st) => sum + st.dwellMs, 0),
  };
}

/** Structural validation. Returns the list of problems (empty = valid). */
export function validateSession(s: ThinkAloudSession): string[] {
  const issues: string[] = [];
  if (s.schemaVersion !== 1) issues.push('schemaVersion must be 1');
  if (!s.subjectId.trim()) issues.push('subjectId is required');
  if (s.steps.length === 0) issues.push('session has no steps');
  s.steps.forEach((st, i) => {
    if (st.stepIndex !== i) issues.push(`step ${i}: stepIndex out of order (${st.stepIndex})`);
    if (st.dwellMs < 0) issues.push(`step ${i}: negative dwellMs`);
    if (st.chosenEdgeLabel !== null && st.toNodeId === null) {
      issues.push(`step ${i}: chose an edge but toNodeId is null`);
    }
    if (!st.utterance.trim()) issues.push(`step ${i}: empty utterance`);
  });
  return issues;
}
