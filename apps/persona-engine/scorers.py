"""41rpm quality scoring — aggregate a session into a 1~5 integer.

Inputs:
  - SessionLog (browser or text mode)
  - persona_id (for predicate lookup)
  - ChecklistResult[] (optional, from checklist_adapter)

Output: QualityBreakdown with the 1-5 score and the sub-metrics that fed
it, so the caller (41rpm Express) can persist both the score and its
provenance into test_reports.

Formula (re-weighted from docs/persona-engine-integration-gaps.md §E2 —
evaluate_session is not yet implemented upstream, so its weight is merged
into outcome + checklist to keep the numerator at 1.0):

  raw = persona_faithfulness * 0.4
      + outcome_weight       * 0.4
      + checklist_pass_rate  * 0.2
  quality_score = round(1 + raw * 4)   # 1..5

If no predicates are defined for the persona, faithfulness weight is
redistributed across outcome + checklist (× 1.67 each) rather than
penalising the session.
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

_OUTCOME_WEIGHTS: dict[str, float] = {
    "task_complete": 1.0,
    "partial": 0.6,
    "max_turns_hit": 0.4,
    "abandoned": 0.2,
    "patience_exceeded": 0.2,
    "error": 0.0,
}


@dataclass
class QualityBreakdown:
    quality_score: int          # 1..5 (integer)
    raw_score: float            # 0.0..1.0 (blended)
    persona_faithfulness: float # 0.0..1.0, None-as-0 if no predicates
    outcome_weight: float       # 0.0..1.0
    checklist_pass_rate: float  # 0.0..1.0 (passed / (total - blocked))
    has_predicates: bool
    weights: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "quality_score": self.quality_score,
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
    if has_predicates and has_checklist:
        w = {"faithfulness": 0.4, "outcome": 0.4, "checklist": 0.2}
    elif has_predicates:
        w = {"faithfulness": 0.5, "outcome": 0.5, "checklist": 0.0}
    elif has_checklist:
        w = {"faithfulness": 0.0, "outcome": 0.6, "checklist": 0.4}
    else:
        w = {"faithfulness": 0.0, "outcome": 1.0, "checklist": 0.0}

    raw = (
        faithfulness * w["faithfulness"]
        + outcome_w * w["outcome"]
        + checklist_rate * w["checklist"]
    )
    raw = max(0.0, min(1.0, raw))
    quality_score = max(1, min(5, round(1 + raw * 4)))

    return QualityBreakdown(
        quality_score=quality_score,
        raw_score=raw,
        persona_faithfulness=faithfulness,
        outcome_weight=outcome_w,
        checklist_pass_rate=checklist_rate,
        has_predicates=has_predicates,
        weights=w,
    )
