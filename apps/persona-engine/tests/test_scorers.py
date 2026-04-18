"""Unit tests for scorers.compute_quality_score (Phase F float scoring)."""
from __future__ import annotations

import math

from adapters.checklist_adapter import ChecklistResult
from scorers import compute_quality_score


def _s(outcome: str, mode: str = "browser") -> dict:
    return {"mode": mode, "outcome": outcome, "turns": []}


def test_perfect_session_saturates_just_under_five():
    """raw=1.0 → quality=5.0, then clamped to 4.95 to avoid saturation."""
    q = compute_quality_score(_s("task_complete"), "nonexistent", None)
    assert math.isclose(q.quality_score, 4.95, abs_tol=0.01)
    assert math.isclose(q.raw_score, 1.0, abs_tol=0.001)
    assert not q.has_predicates


def test_error_session_bottom_clamped_just_above_one():
    """error now yields outcome_weight=0.15 (Phase F, not 0), so
    quality floats around 1.6 even with no checklist."""
    q = compute_quality_score(_s("error"), "nonexistent", None)
    assert 1.0 <= q.quality_score <= 2.0
    assert q.raw_score > 0.0  # no longer absolute zero


def test_abandoned_with_failed_checklist_stays_low():
    checklist = [
        ChecklistResult(id="a", status="failed", memo=""),
        ChecklistResult(id="b", status="failed", memo=""),
    ]
    q = compute_quality_score(_s("abandoned"), "nonexistent", checklist)
    # outcome 0.35 × 0.35 + checklist 0.0 × 0.65 ≈ 0.12 → 1 + 0.49 ≈ 1.5
    assert q.quality_score < 2.0
    assert q.checklist_pass_rate == 0.0


def test_complete_with_half_passed_checklist_mid_range():
    checklist = [
        ChecklistResult(id="a", status="passed", memo=""),
        ChecklistResult(id="b", status="failed", memo=""),
    ]
    q = compute_quality_score(_s("task_complete"), "nonexistent", checklist)
    # outcome 1.0 × 0.35 + checklist 0.5 × 0.65 = 0.675 → ~3.7
    assert 3.5 < q.quality_score < 4.0
    assert q.checklist_pass_rate == 0.5


def test_blocked_items_excluded_from_denominator():
    checklist = [
        ChecklistResult(id="a", status="passed", memo=""),
        ChecklistResult(id="b", status="blocked", memo=""),
    ]
    q = compute_quality_score(_s("task_complete"), "nonexistent", checklist)
    # pass_rate = 1/1 = 1.0; raw = 1.0×0.35 + 1.0×0.65 = 1.0 → 4.95
    assert q.checklist_pass_rate == 1.0
    assert math.isclose(q.quality_score, 4.95, abs_tol=0.01)


def test_all_blocked_returns_zero_rate():
    checklist = [
        ChecklistResult(id="a", status="blocked", memo=""),
        ChecklistResult(id="b", status="blocked", memo=""),
    ]
    q = compute_quality_score(_s("abandoned"), "nonexistent", checklist)
    assert q.checklist_pass_rate == 0.0


def test_weights_redistribute_when_no_checklist():
    q = compute_quality_score(_s("task_complete"), "nonexistent", None)
    assert q.weights["outcome"] == 1.0
    assert q.weights["checklist"] == 0.0


def test_weights_include_checklist_when_provided():
    """Phase F rebalance shifts weight onto checklist (0.65) vs
    outcome (0.35). Pre-F ratio was 0.4 / 0.6."""
    checklist = [ChecklistResult(id="a", status="passed", memo="")]
    q = compute_quality_score(_s("task_complete"), "nonexistent", checklist)
    assert q.weights["checklist"] == 0.65
    assert q.weights["outcome"] == 0.35


def test_partial_outcome_maps_to_mid_score_float():
    """partial_weight 0.65 × outcome_weight 1.0 = 0.65 → 1 + 2.6 = 3.6"""
    q = compute_quality_score(_s("partial"), "nonexistent", None)
    assert 3.4 < q.quality_score < 3.8


def test_sessionlog_dataclass_accepted():
    class _Log:
        outcome = "task_complete"
        mode = "browser"
        turns: list = []
    q = compute_quality_score(_Log(), "nonexistent", None)
    assert math.isclose(q.quality_score, 4.95, abs_tol=0.01)


def test_breakdown_to_dict_emits_float_quality():
    """Phase F — quality_score is a float (previously int)."""
    q = compute_quality_score(_s("partial"), "nonexistent", None)
    d = q.to_dict()
    assert isinstance(d["quality_score"], float)
    assert d["raw_score"] == round(d["raw_score"], 3)


def test_micro_differentiation_between_similar_sessions():
    """Two sessions, same outcome, different checklist pass rates,
    should now produce distinct float scores (pre-F they often
    rounded to the same integer)."""
    cl1 = [ChecklistResult(id="a", status="passed", memo="")] * 3 + [ChecklistResult(id="b", status="failed", memo="")]
    cl2 = [ChecklistResult(id="a", status="passed", memo="")] * 4  # all 4 pass
    q1 = compute_quality_score(_s("task_complete"), "nonexistent", cl1)
    q2 = compute_quality_score(_s("task_complete"), "nonexistent", cl2)
    # Previously both could round to 5; now the three-of-four session
    # should be meaningfully less than all-four.
    assert q2.quality_score > q1.quality_score
    assert abs(q2.quality_score - q1.quality_score) > 0.1
