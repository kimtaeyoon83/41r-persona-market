"""Unit tests for adapters.questionnaire_generator. Uses use_llm=False so
no external calls are made."""
from __future__ import annotations

from adapters.questionnaire_generator import (
    QuestionnaireAnswer,
    QuestionnaireItem,
    _coerce,
    answer_questionnaire,
)


def _session() -> dict:
    return {"mode": "browser", "outcome": "task_complete", "turns": []}


def test_empty_questionnaire_returns_empty():
    assert answer_questionnaire([], _session(), "p_cautious", use_llm=False) == []


def test_fallback_gives_neutral_ratings():
    items = [
        QuestionnaireItem(id="q1", question="?", type="rating_1_5"),
        QuestionnaireItem(id="q2", question="?", type="rating_1_10"),
        QuestionnaireItem(id="q3", question="?", type="free_text"),
    ]
    out = answer_questionnaire(items, _session(), "p_cautious", use_llm=False)
    assert len(out) == 3
    assert out[0].answer == 3       # neutral 1-5
    assert out[1].answer == 5       # neutral 1-10
    assert out[2].answer == ""      # empty free text


def test_coerce_clamps_rating_1_5():
    assert _coerce("rating_1_5", 0) == 1
    assert _coerce("rating_1_5", 6) == 5
    assert _coerce("rating_1_5", 3) == 3
    assert _coerce("rating_1_5", "not a number") == 3  # fallback


def test_coerce_clamps_rating_1_10():
    assert _coerce("rating_1_10", -5) == 1
    assert _coerce("rating_1_10", 99) == 10
    assert _coerce("rating_1_10", 7) == 7


def test_coerce_free_text_returns_string():
    assert _coerce("free_text", "hello") == "hello"
    assert _coerce("free_text", 42) == "42"
    assert _coerce("free_text", None) == ""


def test_dict_input_accepted_and_unknown_type_becomes_free_text():
    items = [{"id": "q1", "question": "?", "type": "bogus"}]
    out = answer_questionnaire(items, _session(), "p_cautious", use_llm=False)
    assert out[0].id == "q1"
    assert out[0].answer == ""  # treated as free_text → neutral empty string


def test_answer_to_dict():
    a = QuestionnaireAnswer(id="q1", answer=4)
    assert a.to_dict() == {"id": "q1", "answer": 4}
