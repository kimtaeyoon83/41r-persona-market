"""Unit tests for adapters.checklist_adapter. LLM path is bypassed via
``use_llm=False`` so these run offline and deterministically."""
from __future__ import annotations

from adapters.checklist_adapter import (
    ChecklistItem,
    ChecklistResult,
    score_checklist,
)


def _session(outcome: str, turn_actions: list[dict], mode: str = "browser") -> dict:
    return {
        "mode": mode,
        "outcome": outcome,
        "turns": [
            {
                "turn": i,
                "observation": {"summary": a.get("summary", "")},
                "decision": {"done": a.get("done", False)},
                "tool": a.get("tool"),
            }
            for i, a in enumerate(turn_actions)
        ],
    }


def test_empty_checklist_returns_empty():
    results = score_checklist([], _session("task_complete", []), use_llm=False)
    assert results == []


def test_rule_match_marks_passed():
    session = _session("task_complete", [
        {"summary": "clicked the signup button", "tool": {"tool": "click"}},
    ])
    items = [ChecklistItem(id="a", task="click signup button")]
    results = score_checklist(items, session, use_llm=False)
    assert len(results) == 1
    assert results[0].status == "passed"
    assert "signup" in results[0].memo or "button" in results[0].memo


def test_abandoned_session_blocks_unmatched_items():
    session = _session("abandoned", [])
    items = [ChecklistItem(id="a", task="complete purchase")]
    results = score_checklist(items, session, use_llm=False)
    assert results[0].status == "blocked"
    assert "abandoned" in results[0].memo


def test_task_complete_but_no_evidence_fails():
    session = _session("task_complete", [
        {"summary": "landing page rendered", "tool": {"tool": "navigate"}},
    ])
    items = [ChecklistItem(id="a", task="checkout purchase order")]
    results = score_checklist(items, session, use_llm=False)
    assert results[0].status == "failed"


def test_dict_input_is_accepted():
    session = _session("task_complete", [
        {"summary": "navigated to example", "tool": {"tool": "navigate"}},
    ])
    items = [{"id": "a", "task": "navigate to example", "expected": "page load"}]
    results = score_checklist(items, session, use_llm=False)
    assert results[0].id == "a"
    assert results[0].status == "passed"


def test_result_to_dict_has_expected_keys():
    r = ChecklistResult(id="x", status="passed", memo="hi", matched_turn_idx=2)
    d = r.to_dict()
    assert set(d.keys()) == {"id", "status", "memo", "matched_turn_idx"}
    assert d["matched_turn_idx"] == 2


def test_error_outcome_also_blocks():
    session = _session("error", [])
    items = [ChecklistItem(id="a", task="anything here")]
    results = score_checklist(items, session, use_llm=False)
    assert results[0].status == "blocked"


def test_text_mode_session_works():
    session = _session("partial", [
        {"summary": "user browsed pricing section", "tool": None},
    ], mode="text")
    items = [ChecklistItem(id="a", task="browsed pricing page")]
    results = score_checklist(items, session, use_llm=False)
    assert results[0].status == "passed"
