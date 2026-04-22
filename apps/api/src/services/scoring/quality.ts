/**
 * Quality score computation — 1.05..4.95 float.
 *
 * Port of apps/persona-engine/scorers.py (Phase F recalibration,
 * 2026-04-19). Pure math, no LLM calls. Keep the formula + weights
 * byte-identical so dashboards that joined against Python-produced
 * scores don't show a regime shift when the pipeline flips to TS.
 *
 * Formula:
 *   raw = persona_faithfulness × w.faithfulness
 *       + outcome_weight       × w.outcome
 *       + checklist_pass_rate  × w.checklist
 *   quality_score = clamp(1.0 + raw × 4.0, 1.05, 4.95)
 *
 * persona_faithfulness is always 0 here until the predicate scorer is
 * ported — matches current prod behaviour (builtin personas have no
 * @persona.predicate declarations, so the Python path also returns 0).
 */
import type {
  ChecklistResult,
  QualityBreakdown,
  QualityWeights,
  SessionLog,
  SessionOutcome,
} from './types.js';

// Outcome weights — softened in Phase F so partial/abandoned runs don't
// collapse the headline score.
const OUTCOME_WEIGHTS: Record<string, number> = {
  task_complete: 1.0,
  partial: 0.65,
  max_turns_hit: 0.5,
  abandoned: 0.35,
  patience_exceeded: 0.35,
  error: 0.15,
};

function outcomeWeight(outcome: string | SessionOutcome | undefined | null): number {
  return OUTCOME_WEIGHTS[outcome ?? ''] ?? 0.0;
}

/**
 * passed / (total - blocked). Blocked items drop out of the denominator
 * so a persona that couldn't reach a gated flow (env constraint) isn't
 * penalised on items they physically couldn't evaluate.
 */
export function checklistPassRate(
  results: ChecklistResult[] | null | undefined,
): { rate: number; total: number } {
  if (!results || results.length === 0) return { rate: 0.0, total: 0 };
  const total = results.length;
  const blocked = results.filter((r) => r.status === 'blocked').length;
  const passed = results.filter((r) => r.status === 'passed').length;
  const denom = total - blocked;
  if (denom <= 0) return { rate: 0.0, total };
  return { rate: passed / denom, total };
}

function pickWeights(hasPredicates: boolean, hasChecklist: boolean): QualityWeights {
  // Phase F rebalance: when a checklist is present we lean on it more
  // than the coarse outcome label (pre-F was 0.6/0.4, now 0.35/0.65).
  // Checklist aligns with how humans grade, and per-item verdicts bring
  // micro-differences back that pure outcome would flatten.
  if (hasPredicates && hasChecklist)
    return { faithfulness: 0.35, outcome: 0.25, checklist: 0.4 };
  if (hasPredicates) return { faithfulness: 0.5, outcome: 0.5, checklist: 0.0 };
  if (hasChecklist) return { faithfulness: 0.0, outcome: 0.35, checklist: 0.65 };
  return { faithfulness: 0.0, outcome: 1.0, checklist: 0.0 };
}

export interface ComputeQualityArgs {
  sessionLog: Pick<SessionLog, 'outcome'> | { outcome?: string };
  checklistResults?: ChecklistResult[] | null;
  /** Reserved. 0.0 until predicate scorer lands — wiring it here so the
   *  call site can pass a non-zero value without a signature change. */
  personaFaithfulness?: number;
  hasPredicates?: boolean;
}

export function computeQualityScore(args: ComputeQualityArgs): QualityBreakdown {
  const outcome = (args.sessionLog as { outcome?: string })?.outcome ?? '';
  const outcomeW = outcomeWeight(outcome);
  const { rate: checklistRate, total: checklistTotal } = checklistPassRate(
    args.checklistResults ?? null,
  );
  const hasChecklist = checklistTotal > 0;

  const faithfulness = args.personaFaithfulness ?? 0.0;
  const hasPredicates = args.hasPredicates ?? false;

  const w = pickWeights(hasPredicates, hasChecklist);
  let raw =
    faithfulness * w.faithfulness +
    outcomeW * w.outcome +
    checklistRate * w.checklist;
  raw = Math.max(0.0, Math.min(1.0, raw));

  let quality = 1.0 + raw * 4.0;
  quality = Math.max(1.05, Math.min(4.95, quality));

  return {
    quality_score: Number(quality.toFixed(2)),
    raw_score: Number(raw.toFixed(3)),
    persona_faithfulness: Number(faithfulness.toFixed(3)),
    outcome_weight: Number(outcomeW.toFixed(3)),
    checklist_pass_rate: Number(checklistRate.toFixed(3)),
    has_predicates: hasPredicates,
    weights: w,
  };
}
