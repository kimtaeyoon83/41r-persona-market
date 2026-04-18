"""Unit tests for scorers.compute_quality_score."""
from __future__ import annotations

from adapters.checklist_adapter import ChecklistResult
from scorers import compute_quality_score


def _s(outcome: str, mode: str = "browser") -> dict:
    return {"mode": mode, "outcome": outcome, "turns": []}


def test_perfect_session_gets_five():
    q = compute_quality_score(_s("task_complete"), "nonexistent", None)
    assert q.quality_score == 5
    assert q.raw_score == 1.0
    assert not q.has_predicates


def test_error_session_gets_one():
    q = compute_quality_score(_s("error"), "nonexistent", None)
    assert q.quality_score == 1
    assert q.raw_score == 0.0


def test_abandoned_with_failed_checklist_lowest():
    checklist = [
        ChecklistResult(id="a", status="failed", memo=""),
        ChecklistResult(id="b", status="failed", memo=""),
    ]
    q = compute_quality_score(_s("abandoned"), "nonexistent", checklist)
    assert q.quality_score == 1
    assert q.checklist_pass_rate == 0.0


def test_complete_with_half_passed_checklist():
    checklist = [
        ChecklistResult(id="a", status="passed", memo=""),
        ChecklistResult(id="b", status="failed", memo=""),
    ]
    q = compute_quality_score(_s("task_complete"), "nonexistent", checklist)
    # outcome 1.0 × 0.6 + checklist 0.5 × 0.4 = 0.8 → round(1 + 3.2) = 4
    assert q.quality_score == 4
    assert q.checklist_pass_rate == 0.5


def test_blocked_items_excluded_from_denominator():
    checklist = [
        ChecklistResult(id="a", status="passed", memo=""),
        ChecklistResult(id="b", status="blocked", memo=""),
    ]
    q = compute_quality_score(_s("task_complete"), "nonexistent", checklist)
    # passed=1 / (total=2 - blocked=1) = 1.0, not 0.5
    assert q.checklist_pass_rate == 1.0
    assert q.quality_score == 5


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
    checklist = [ChecklistResult(id="a", status="passed", memo="")]
    q = compute_quality_score(_s("task_complete"), "nonexistent", checklist)
    assert q.weights["checklist"] == 0.4
    assert q.weights["outcome"] == 0.6


def test_partial_outcome_maps_to_mid_score():
    q = compute_quality_score(_s("partial"), "nonexistent", None)
    # partial=0.6 × outcome=1.0 = 0.6 → round(1 + 2.4) = 3
    assert q.quality_score == 3


def test_sessionlog_dataclass_accepted():
    """Accept SessionLog-like object (attribute access), not just dict."""
    class _Log:
        outcome = "task_complete"
        mode = "browser"
        turns: list = []
    q = compute_quality_score(_Log(), "nonexistent", None)
    assert q.quality_score == 5


def test_breakdown_to_dict_rounds_floats():
    q = compute_quality_score(_s("partial"), "nonexistent", None)
    d = q.to_dict()
    assert d["raw_score"] == round(d["raw_score"], 3)
    assert isinstance(d["quality_score"], int)
