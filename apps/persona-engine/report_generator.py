"""41rpm structured UX report generator (wrapper-level P2).

Schema mirrors docs/persona-engine-integration-gaps.md §P2:

    StructuredReport
      summary: str
      ux_scores: {clarity, trust, efficiency, overall}   # each 0.0-1.0
      pain_points: [{severity, description, evidence_turn, affected_personas}]
      positive_signals: list[str]
      recommendations: list[str]

Generation is a single Haiku-tier call consuming the SessionLog plus any
ChecklistResult[]. ``ux_scores.overall`` is distinct from
persona_faithfulness — it evaluates *the site*, not the persona. We do
NOT roundtrip through persona_agent because upstream has no
generate_structured_report yet; this is the wrapper-level implementation.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal

from persona_agent._internal.core.provider_router import call as llm_call

from adapters.checklist_adapter import ChecklistResult, _session_summary

logger = logging.getLogger(__name__)

Severity = Literal["high", "medium", "low"]


@dataclass
class UxScores:
    clarity: float = 0.0
    trust: float = 0.0
    efficiency: float = 0.0
    overall: float = 0.0

    def to_dict(self) -> dict:
        return {
            "clarity": round(self.clarity, 3),
            "trust": round(self.trust, 3),
            "efficiency": round(self.efficiency, 3),
            "overall": round(self.overall, 3),
        }


@dataclass
class PainPoint:
    severity: Severity
    description: str
    evidence_turn: int | None = None

    def to_dict(self) -> dict:
        return {
            "severity": self.severity,
            "description": self.description,
            "evidence_turn": self.evidence_turn,
        }


@dataclass
class StructuredReport:
    summary: str = ""
    ux_scores: UxScores = field(default_factory=UxScores)
    pain_points: list[PainPoint] = field(default_factory=list)
    positive_signals: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    persona_id: str = ""
    session_id: str = ""

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "ux_scores": self.ux_scores.to_dict(),
            "pain_points": [p.to_dict() for p in self.pain_points],
            "positive_signals": self.positive_signals,
            "recommendations": self.recommendations,
            "persona_id": self.persona_id,
            "session_id": self.session_id,
        }


_SYSTEM = """당신은 UX 리서치 애널리스트입니다.
AI 페르소나의 세션 로그(행동/관찰) + 체크리스트 결과를 근거로 제품의 UX를 평가하는 구조화 리포트를 작성하세요.

## 원칙
- 세션에 없는 사실을 날조하지 마세요 (관찰 기반 근거만 사용)
- ux_scores는 사이트/제품 품질 평가 (페르소나가 얼마나 캐릭터에 충실했는지가 아님)
- pain_points의 evidence_turn은 turns[]의 turn 번호 (근거가 된 턴). 불분명하면 null
- severity=high는 태스크 실패를 유발한 마찰만

## 출력 (JSON object만)
{
  "summary": "2~4문장, 한국어",
  "ux_scores": {
    "clarity": 0.0~1.0,      // 정보 구조/라벨의 명확성
    "trust": 0.0~1.0,        // 신뢰 신호 (보안, 약관, 리뷰 등)
    "efficiency": 0.0~1.0,   // 태스크 완료까지의 단계 수·마찰
    "overall": 0.0~1.0       // 가중 평균 또는 종합 판단
  },
  "pain_points": [
    {"severity": "high|medium|low", "description": "...", "evidence_turn": 정수|null}
  ],
  "positive_signals": ["잘 된 점 1", "..."],
  "recommendations": ["개선 제안 1", "..."]
}"""


def _clamp01(v: Any) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, f))


def _empty_report(persona_id: str, session_id: str) -> StructuredReport:
    return StructuredReport(
        summary="(리포트 생성 실패 또는 off-line 경로)",
        ux_scores=UxScores(),
        pain_points=[],
        positive_signals=[],
        recommendations=[],
        persona_id=persona_id,
        session_id=session_id,
    )


def _parse_pain_point(raw: Any) -> PainPoint | None:
    if not isinstance(raw, dict):
        return None
    sev_raw = raw.get("severity")
    severity: Severity = sev_raw if sev_raw in ("high", "medium", "low") else "low"
    description = str(raw.get("description") or "").strip()
    if not description:
        return None
    et = raw.get("evidence_turn")
    evidence_turn = int(et) if isinstance(et, int) else None
    return PainPoint(
        severity=severity,
        description=description,
        evidence_turn=evidence_turn,
    )


def _str_list(raw: Any, cap: int = 20) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for v in raw[:cap]:
        s = str(v).strip()
        if s:
            out.append(s)
    return out


def generate_structured_report(
    session_log: Any,
    persona_id: str,
    checklist_results: list[ChecklistResult] | None = None,
    *,
    use_llm: bool = True,
) -> StructuredReport:
    """Produce a StructuredReport for a single session.

    Returns a skeleton report with empty lists / zero scores if
    ``use_llm=False`` or the LLM call fails.
    """
    session_id = (
        session_log.get("session_id") if isinstance(session_log, dict)
        else getattr(session_log, "session_id", "")
    ) or ""

    if not use_llm:
        return _empty_report(persona_id, session_id)

    summary = _session_summary(session_log)
    checklist_summary = ""
    if checklist_results:
        checklist_summary = "\n## 체크리스트 결과\n" + "\n".join(
            f"- [{r.status}] {r.id}: {r.memo}"
            for r in checklist_results
        )

    user_msg = (
        "## 세션 요약\n" + summary + checklist_summary
    )

    try:
        # Cost optimisation (2026-04-19): structured_report was 38% of
        # the Sonnet bill on a typical 5-run batch (~$0.14/run). We
        # route this through Haiku ("review_inspection" = tier=low in
        # persona_agent/routing.yaml). max_tokens: the first cut at
        # 800 hit truncation on real pain-point lists (JSON parse
        # errors, returning the empty skeleton). 1400 fits the typical
        # 4-pain-points / 5-recommendations output with headroom and
        # is still <20% the Sonnet cost at 1500.
        response = llm_call(
            "review_inspection",
            [{"role": "user", "content": user_msg}],
            system=_SYSTEM,
            max_tokens=1400,
        )
        raw = response.get("content", "") or ""
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start < 0 or end <= start:
            raise ValueError("no JSON object in LLM response")
        parsed = json.loads(raw[start:end])
        if not isinstance(parsed, dict):
            raise ValueError("LLM returned non-object")

        scores_raw = parsed.get("ux_scores") or {}
        if not isinstance(scores_raw, dict):
            scores_raw = {}
        ux = UxScores(
            clarity=_clamp01(scores_raw.get("clarity")),
            trust=_clamp01(scores_raw.get("trust")),
            efficiency=_clamp01(scores_raw.get("efficiency")),
            overall=_clamp01(scores_raw.get("overall")),
        )

        pp_raw = parsed.get("pain_points")
        pain_points: list[PainPoint] = []
        if isinstance(pp_raw, list):
            for item in pp_raw[:20]:
                pp = _parse_pain_point(item)
                if pp:
                    pain_points.append(pp)

        return StructuredReport(
            summary=str(parsed.get("summary") or "").strip(),
            ux_scores=ux,
            pain_points=pain_points,
            positive_signals=_str_list(parsed.get("positive_signals")),
            recommendations=_str_list(parsed.get("recommendations")),
            persona_id=persona_id,
            session_id=session_id,
        )
    except Exception as e:
        logger.warning("structured report LLM failed (%s); returning empty skeleton", e)
        return _empty_report(persona_id, session_id)
