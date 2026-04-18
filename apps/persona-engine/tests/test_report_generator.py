"""Unit tests for report_generator. use_llm=False path returns a skeleton."""
from __future__ import annotations

from report_generator import (
    PainPoint,
    StructuredReport,
    UxScores,
    _clamp01,
    _parse_pain_point,
    _str_list,
    generate_structured_report,
)


def _session() -> dict:
    return {
        "session_id": "s_xyz",
        "mode": "browser",
        "outcome": "task_complete",
        "turns": [],
    }


def test_offline_returns_skeleton():
    r = generate_structured_report(_session(), "p_cautious", None, use_llm=False)
    assert isinstance(r, StructuredReport)
    assert r.persona_id == "p_cautious"
    assert r.session_id == "s_xyz"
    assert r.pain_points == []
    assert r.positive_signals == []
    assert r.recommendations == []
    assert r.ux_scores.overall == 0.0


def test_clamp01_bounds():
    assert _clamp01(-1.0) == 0.0
    assert _clamp01(0.5) == 0.5
    assert _clamp01(2.0) == 1.0
    assert _clamp01("not a number") == 0.0


def test_parse_pain_point_requires_description():
    assert _parse_pain_point({"severity": "high"}) is None
    assert _parse_pain_point({"severity": "high", "description": ""}) is None
    pp = _parse_pain_point({"severity": "high", "description": "ok", "evidence_turn": 2})
    assert pp is not None
    assert pp.severity == "high"
    assert pp.evidence_turn == 2


def test_parse_pain_point_unknown_severity_becomes_low():
    pp = _parse_pain_point({"severity": "critical", "description": "ok"})
    assert pp is not None
    assert pp.severity == "low"


def test_str_list_strips_and_caps():
    out = _str_list(["  a  ", "", "b", "  "])
    assert out == ["a", "b"]
    assert _str_list("not a list") == []
    capped = _str_list([f"item{i}" for i in range(30)], cap=5)
    assert len(capped) == 5


def test_ux_scores_to_dict_rounded():
    s = UxScores(clarity=0.123456, trust=0.9, efficiency=0.5, overall=0.6)
    d = s.to_dict()
    assert d["clarity"] == 0.123
    assert d["overall"] == 0.6


def test_report_to_dict_shape():
    r = StructuredReport(
        summary="hi",
        ux_scores=UxScores(clarity=0.5, trust=0.5, efficiency=0.5, overall=0.5),
        pain_points=[PainPoint(severity="low", description="x", evidence_turn=1)],
        positive_signals=["yay"],
        recommendations=["do"],
        persona_id="p", session_id="s",
    )
    d = r.to_dict()
    assert set(d.keys()) == {
        "summary", "ux_scores", "pain_points", "positive_signals",
        "recommendations", "persona_id", "session_id",
    }
    assert d["pain_points"][0] == {
        "severity": "low", "description": "x", "evidence_turn": 1,
    }


def test_sessionlog_object_accepted():
    class _Log:
        session_id = "s_obj"
        mode = "browser"
        outcome = "task_complete"
        turns: list = []

    r = generate_structured_report(_Log(), "p_cautious", None, use_llm=False)
    assert r.session_id == "s_obj"
