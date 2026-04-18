"""41rpm quality scoring — aggregate a session into a 1.0..5.0 float.

Inputs:
  - SessionLog (browser or text mode)
  - persona_id (for predicate lookup)
  - ChecklistResult[] (optional, from checklist_adapter)

Output: QualityBreakdown with a 1.0..5.0 float score and the sub-metrics
that fed it, so the caller (41rpm Express) can persist both the score
and its provenance into test_reports.

Design rationale (Phase F recalibration, 2026-04-19):
  Earlier versions quantised to integer 1..5, which made AI-persona
  scores cluster into five buckets while human raters used fractional
  scores like 3.6 or 4.2. That alone drove the dashboard's ρ = -0.38
  and KS = 0.52 by polarising persona scores into {1, 4}. We now:
    - return a float (keeps the 1..5 headline band but restores
      fractional granularity),
    - soften the outcome weights (partial/abandoned no longer collapse
      to 0.6 / 0.2 — they interpolate smoother),
    - shift weight from outcome toward checklist_pass_rate when a
      meaningful checklist exists, since checklist is more aligned
      with what humans grade on.

Formula:
  raw = persona_faithfulness × w.faithfulness
      + outcome_weight       × w.outcome
      + checklist_pass_rate  × w.checklist
  quality_score = 1.0 + raw × 4.0           # float
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from persona_agent._internal.analysis.predicate_scorer import (
    score_session_predicates,
)

from adapters.checklist_adapter import ChecklistResult

logger = logging.getLogger(__name__)

# Outcome weights (Phase F softening). Compared to the pre-F table
# (task_complete=1.0, partial=0.6, max_turns=0.4, abandoned=0.2,
# error=0.0) we:
#   - raise abandoned/patience to 0.35 so a persona that bailed on
#     *one* environmental blocker (e.g. a wallet-signing step) is not
#     penalised to "1 out of 5" — most of the session may still have
#     been informative.
#   - raise error to 0.15 — engine-side failures likely indicate a
#     real site issue humans would flag but not bottom out the score.
#   - narrow max_turns_hit toward 0.5 (a long session that hit the
#     turn cap usually *did* observe the UX).
_OUTCOME_WEIGHTS: dict[str, float] = {
    "task_complete": 1.0,
    "partial": 0.65,
    "max_turns_hit": 0.5,
    "abandoned": 0.35,
    "patience_exceeded": 0.35,
    "error": 0.15,
}


@dataclass
class QualityBreakdown:
    quality_score: float        # 1.0..5.0 (float — Phase F)
    raw_score: float            # 0.0..1.0 (blended)
    persona_faithfulness: float # 0.0..1.0, None-as-0 if no predicates
    outcome_weight: float       # 0.0..1.0
    checklist_pass_rate: float  # 0.0..1.0 (passed / (total - blocked))
    has_predicates: bool
    weights: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "quality_score": round(self.quality_score, 2),
            "raw_score": round(self.raw_score, 3),
            "persona_faithfulness": round(self.persona_faithfulness, 3),
            "outcome_weight": round(self.outcome_weight, 3),
            "checklist_pass_rate": round(self.checklist_pass_rate, 3),
            "has_predicates": self.has_predicates,
            "weights": self.weights,
        }


def _outcome_weight(outcome: str) -> float:
    return _OUTCOME_WEIGHTS.get(outcome or "", 0.0)


def _checklist_pass_rate(results: list[ChecklistResult] | None) -> tuple[float, int]:
    if not results:
        return 0.0, 0
    total = len(results)
    blocked = sum(1 for r in results if r.status == "blocked")
    passed = sum(1 for r in results if r.status == "passed")
    denom = total - blocked
    if denom <= 0:
        return 0.0, total
    return passed / denom, total


def compute_quality_score(
    session_log: Any,
    persona_id: str,
    checklist_results: list[ChecklistResult] | None = None,
) -> QualityBreakdown:
    """Score a session on 1-5 scale, returning sub-metric breakdown.

    Uses persona_agent's ``score_session_predicates`` when the persona has
    predicates defined in its soul frontmatter. Otherwise, only outcome +
    checklist drive the score.
    """
    outcome = (
        session_log.get("outcome") if isinstance(session_log, dict)
        else getattr(session_log, "outcome", "")
    ) or ""
    outcome_w = _outcome_weight(outcome)
    checklist_rate, checklist_total = _checklist_pass_rate(checklist_results)
    has_checklist = checklist_total > 0

    faithfulness = 0.0
    has_predicates = False
    try:
        score_result = score_session_predicates(persona_id, session_log)
        scored = score_result.total - score_result.skipped
        if scored > 0:
            faithfulness = score_result.persona_faithfulness
            has_predicates = True
    except Exception as e:
        logger.debug("predicate scoring skipped for %s: %s", persona_id, e)

    # Weight redistribution — preserves numerator == 1.0 regardless of
    # which inputs are available.
    #
    # Phase F rebalance: when a checklist is present we now lean on it
    # more than outcome. Humans grade primarily on "did each thing
    # work?" — the outcome label is a coarse session-wide summary that
    # tends to dominate if over-weighted (pre-F ratio 0.6/0.4 outcome
    # vs checklist). New ratio 0.35/0.65 puts micro-differences from
    # per-item verdicts back in the driver's seat.
    if has_predicates and has_checklist:
        w = {"faithfulness": 0.35, "outcome": 0.25, "checklist": 0.40}
    elif has_predicates:
        w = {"faithfulness": 0.5, "outcome": 0.5, "checklist": 0.0}
    elif has_checklist:
        w = {"faithfulness": 0.0, "outcome": 0.35, "checklist": 0.65}
    else:
        w = {"faithfulness": 0.0, "outcome": 1.0, "checklist": 0.0}

    raw = (
        faithfulness * w["faithfulness"]
        + outcome_w * w["outcome"]
        + checklist_rate * w["checklist"]
    )
    raw = max(0.0, min(1.0, raw))

    # Float score (Phase F). We clamp into 1.05..4.95 rather than
    # 1.0..5.0 so raw 0.0 and raw 1.0 sessions don't bottom out or
    # saturate — mirrors how humans rarely give absolute 1 or 5
    # without hedging.
    quality_score = 1.0 + raw * 4.0
    quality_score = max(1.05, min(4.95, quality_score))

    return QualityBreakdown(
        quality_score=round(quality_score, 2),
        raw_score=raw,
        persona_faithfulness=faithfulness,
        outcome_weight=outcome_w,
        checklist_pass_rate=checklist_rate,
        has_predicates=has_predicates,
        weights=w,
    )
