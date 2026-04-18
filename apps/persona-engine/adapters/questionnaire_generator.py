"""41rpm QuestionnaireItem[] × SessionLog × persona soul → QuestionnaireAnswer[].

Emits answers in the shape of packages/shared/src/types.ts
`QuestionnaireAnswer` = `{id, answer: string | number}`. Rating items
yield integers (1..5 or 1..10), free_text items yield strings.

Generation strategy:
  1. Single Haiku-tier LLM call with soul + session summary + all items
  2. Rule-based fallback on LLM failure — returns neutral ratings and
     an empty free_text so the caller always gets well-formed output.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Literal

from persona_agent._internal.core.provider_router import call as llm_call
from persona_agent._internal.persona.persona_store import read_persona

from adapters.checklist_adapter import _session_summary

logger = logging.getLogger(__name__)

QuestionType = Literal["rating_1_5", "rating_1_10", "free_text"]


@dataclass
class QuestionnaireItem:
    id: str
    question: str
    type: QuestionType


@dataclass
class QuestionnaireAnswer:
    id: str
    answer: str | int

    def to_dict(self) -> dict:
        return {"id": self.id, "answer": self.answer}


_SYSTEM = """당신은 주어진 AI 페르소나의 관점에서 UX 설문에 답변합니다.
페르소나의 성향(soul)과 세션 중 실제로 관찰된 행동을 근거로, 과장·날조 없이 답변하세요.

## 중요 원칙 — "서비스 품질"과 "세션 결과"를 분리

세션이 abandoned/error/partial로 끝났어도, 그 원인이 무엇인지 먼저 구분하세요.

(A) 서비스 자체의 결함 때문에 세션이 실패 → 낮은 점수 정당
    예: 페이지 로딩 실패, 링크 깨짐, 폼 제출 오류

(B) 환경 제약(지갑 없음, 트랜잭션 서명 불가, 외부 플랫폼 의존)으로 완료 불가
    → 이건 서비스 탓이 아님. 관찰 가능했던 범위의 UX만 평가하고
       평균~평균 이상(3~4)으로 답변

(C) 테스트 에이전트의 능력 한계 (SPA 탐색 부족, 동적 UI 해석 실패)
    → 이 또한 서비스 평가에 반영 금지. 관찰된 부분만 평가

결과가 partial/abandoned라도 서비스 자체의 품질이 평균 이상이었다면
당당히 3~4점을 주세요. 1점은 "서비스에 명백한 결함이 있다"고 증거가 있을 때만.

## 출력 (JSON array만, 다른 텍스트 없음)
[
  {"id": "q1", "answer": 정수 또는 문자열}
]

## 규칙
- type=rating_1_5: 정수 1~5 (1=매우 나쁨, 3=보통, 5=매우 좋음).
  * 극단값(1, 5)은 관찰된 근거가 매우 강할 때만. 평범한 세션은 2~4 사이에 자리잡아야 함.
  * 세션이 실패했어도 관찰 범위가 너무 좁다면 "판단 보류" 의미로 3을 기본.
- type=rating_1_10: 정수 1~10. 5~8 범위를 주로 사용, 극단은 강한 근거가 있을 때만.
- type=free_text: 1-3문장 한국어 서술. 세션에서 관찰된 구체적 근거를 1개 이상 언급.
  * 세션이 환경 제약으로 완료 불가였다면 그 사실을 명시하고, 관찰 가능했던 UX는 별도로 평가.
- 모든 질문에 반드시 답변 (누락 금지).
"""


def _rating_default(qtype: QuestionType) -> int:
    if qtype == "rating_1_5":
        return 3
    if qtype == "rating_1_10":
        return 5
    return 0  # shouldn't happen for ratings


def _coerce(qtype: QuestionType, raw: Any) -> str | int:
    """Normalise LLM output to the schema-expected type."""
    if qtype == "free_text":
        return str(raw) if raw is not None else ""
    # rating types
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return _rating_default(qtype)
    if qtype == "rating_1_5":
        return max(1, min(5, val))
    if qtype == "rating_1_10":
        return max(1, min(10, val))
    return val


def _neutral_fallback(items: list[QuestionnaireItem]) -> list[QuestionnaireAnswer]:
    out: list[QuestionnaireAnswer] = []
    for it in items:
        if it.type == "free_text":
            out.append(QuestionnaireAnswer(id=it.id, answer=""))
        else:
            out.append(QuestionnaireAnswer(id=it.id, answer=_rating_default(it.type)))
    return out


def _normalize_items(
    questionnaire: list[QuestionnaireItem] | list[dict],
) -> list[QuestionnaireItem]:
    out: list[QuestionnaireItem] = []
    for q in questionnaire:
        if isinstance(q, QuestionnaireItem):
            out.append(q)
        elif isinstance(q, dict):
            qtype_raw = str(q.get("type") or "free_text")
            qtype: QuestionType = (
                qtype_raw if qtype_raw in ("rating_1_5", "rating_1_10", "free_text")
                else "free_text"
            )
            out.append(QuestionnaireItem(
                id=str(q.get("id", "")),
                question=str(q.get("question", "")),
                type=qtype,
            ))
    return out


def answer_questionnaire(
    questionnaire: list[QuestionnaireItem] | list[dict],
    session_log: Any,
    persona_id: str,
    *,
    use_llm: bool = True,
) -> list[QuestionnaireAnswer]:
    """Generate per-item answers by having Haiku roleplay the persona."""
    items = _normalize_items(questionnaire)
    if not items:
        return []

    if not use_llm:
        return _neutral_fallback(items)

    try:
        persona = read_persona(persona_id)
        soul_text = persona.soul_text
    except Exception as e:
        logger.warning("read_persona(%s) failed: %s", persona_id, e)
        soul_text = ""

    summary = _session_summary(session_log)
    user_msg = (
        "## 페르소나\n" + (soul_text or "(soul 불러오기 실패)") + "\n\n"
        "## 세션 요약\n" + summary + "\n\n"
        "## 설문 (JSON)\n"
        + json.dumps(
            [{"id": i.id, "question": i.question, "type": i.type} for i in items],
            ensure_ascii=False, indent=2,
        )
    )

    try:
        response = llm_call(
            "review_proposer",
            [{"role": "user", "content": user_msg}],
            system=_SYSTEM,
            max_tokens=1024,
        )
        raw = response.get("content", "") or ""
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start < 0 or end <= start:
            raise ValueError("no JSON array in LLM response")
        parsed = json.loads(raw[start:end])
        if not isinstance(parsed, list):
            raise ValueError("LLM returned non-array")
        by_id: dict[str, dict] = {
            str(p.get("id")): p for p in parsed if isinstance(p, dict) and p.get("id")
        }
        out: list[QuestionnaireAnswer] = []
        for it in items:
            p = by_id.get(it.id)
            if p is None:
                # LLM skipped this id — fall back to neutral for this item
                out.append(QuestionnaireAnswer(
                    id=it.id, answer=_rating_default(it.type) if it.type != "free_text" else "",
                ))
                continue
            out.append(QuestionnaireAnswer(
                id=it.id,
                answer=_coerce(it.type, p.get("answer")),
            ))
        return out
    except Exception as e:
        logger.warning("questionnaire LLM failed (%s); returning neutral defaults", e)
        return _neutral_fallback(items)
