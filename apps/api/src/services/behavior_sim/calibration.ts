// Behavior-sim calibration (the Mode C gate's pass/fail engine).
//
// Once 5 human think-aloud sessions (think_aloud.ts) are collected, the
// simulator (state.ts) is run over the same graph + persona to produce a
// prediction per subject. This module scores prediction vs ground truth —
// the "gate-label vs real behaviour" agreement the spike flagged as the
// thing that must hold before Mode C is trusted. If agreement clears the
// bar, the gate opens.
//
// Pure: takes the human sessions + the sim predictions, returns a report.
// No I/O, no LLM, no graph — the runner script feeds both sides in.

import type { ThinkAloudSession } from './think_aloud.js';
import type { LeaveMode } from './state.js';

/** What the simulator predicted for one subject's run. */
export type SimPrediction = {
  subjectId: string;
  outcome:
    | { kind: 'stayed' }
    | { kind: 'left'; mode: LeaveMode; atStep: number };
  /** Optional node path the sim walked (for choice agreement). */
  path?: string[];
};

// Map a human leave reason to the sim leave-modes that count as agreeing.
// gave_up is ambiguous between frustration and boredom, so both pass.
const REASON_TO_SIM_MODES: Record<string, LeaveMode[]> = {
  satisfied: ['satisfied'],
  frustrated: ['frustrated'],
  gave_up: ['frustrated', 'indifferent'],
  distracted: ['distracted'],
};

export type PerSubject = {
  subjectId: string;
  /** Both left, or both stayed. */
  outcomeMatch: boolean;
  /** Among both-left pairs: did the sim mode map to the human reason?
   *  null when not both-left. */
  reasonMatch: boolean | null;
  /** Fraction of human path positions the sim matched. null if no paths. */
  pathMatch: number | null;
};

export type CalibrationReport = {
  nPaired: number;
  /** Fraction of subjects where leave-vs-stay matched. */
  outcomeAgreement: number;
  /** Mean reason agreement over both-left pairs (null if none). */
  leaveReasonAgreement: number | null;
  /** Mean path agreement (null if no sim paths). */
  pathAgreement: number | null;
  /** Gate verdict: outcomeAgreement ≥ threshold. */
  passesGate: boolean;
  gateThreshold: number;
  perSubject: PerSubject[];
};

function pathMatchFraction(human: string[], sim?: string[]): number | null {
  if (!sim || human.length === 0) return null;
  let matches = 0;
  for (let i = 0; i < human.length; i++) {
    if (sim[i] === human[i]) matches++;
  }
  return matches / human.length;
}

/**
 * Score sim predictions against human ground truth. `gateThreshold` is the
 * outcome-agreement bar for opening the gate — a PLACEHOLDER default (0.7);
 * the team sets the real bar from the spike's distribution once n=5 lands.
 */
export function calibrate(
  humans: readonly ThinkAloudSession[],
  sims: readonly SimPrediction[],
  opts: { gateThreshold?: number } = {},
): CalibrationReport {
  const gateThreshold = opts.gateThreshold ?? 0.7;
  const simById = new Map(sims.map((s) => [s.subjectId, s]));

  const perSubject: PerSubject[] = [];
  for (const h of humans) {
    const sim = simById.get(h.subjectId);
    if (!sim) continue; // unpaired — skip (runner reports the gap)

    const humanLeft = h.outcome.kind === 'left';
    const simLeft = sim.outcome.kind === 'left';
    const outcomeMatch = humanLeft === simLeft;

    let reasonMatch: boolean | null = null;
    if (humanLeft && simLeft && sim.outcome.kind === 'left' && h.outcome.kind === 'left') {
      const allowed = REASON_TO_SIM_MODES[h.outcome.reason] ?? [];
      reasonMatch = allowed.includes(sim.outcome.mode);
    }

    const humanPath = [
      h.steps[0]?.nodeId,
      ...h.steps.map((st) => st.toNodeId),
    ].filter((n): n is string => typeof n === 'string');
    const pathMatch = pathMatchFraction(humanPath, sim.path);

    perSubject.push({ subjectId: h.subjectId, outcomeMatch, reasonMatch, pathMatch });
  }

  const n = perSubject.length;
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

  const outcomeAgreement = n === 0 ? 0 : perSubject.filter((p) => p.outcomeMatch).length / n;
  const reasonVals = perSubject.filter((p) => p.reasonMatch !== null).map((p) => (p.reasonMatch ? 1 : 0));
  const pathVals = perSubject.filter((p) => p.pathMatch !== null).map((p) => p.pathMatch as number);

  return {
    nPaired: n,
    outcomeAgreement,
    leaveReasonAgreement: mean(reasonVals),
    pathAgreement: mean(pathVals),
    passesGate: n > 0 && outcomeAgreement >= gateThreshold,
    gateThreshold,
    perSubject,
  };
}
