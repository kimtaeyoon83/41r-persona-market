"""41rpm ChecklistItem[] × SessionLog → ChecklistResult[].

Two-tier strategy:
  1. LLM scoring (single Haiku-tier call, JSON array out) — handles both
     browser and text mode sessions uniformly.
  2. Rule-based keyword fallback when LLM is unreachable / malformed.

Both modes accept the same ChecklistItem shape used in
packages/shared/src/types.ts (`{id, task, expected}`) and emit
ChecklistResult aligned with packages/shared's schema.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Literal

from persona_agent._internal.core.provider_router import call as llm_call

logger = logging.getLogger(__name__)

ChecklistStatus = Literal["passed", "failed", "blocked"]

_BLOCKING_OUTCOMES = {"error", "abandoned", "patience_exceeded"}


@dataclass
class ChecklistItem:
    id: str
    task: str
    expected: str = ""


@dataclass
class ChecklistResult:
    id: str
    status: ChecklistStatus
    memo: str
    matched_turn_idx: int | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "memo": self.memo,
            "matched_turn_idx": self.matched_turn_idx,
        }


_SYSTEM = """당신은 UX 테스트 체크리스트 평가관입니다.
세션 로그(행동/관찰)를 보고 각 체크리스트 항목을 판정하세요.

## 판정
- passed: task가 수행되고 expected가 관찰됨
- failed: 시도되었으나 expected가 관찰되지 않거나 오류
- blocked: 세션 중단(abandoned/error/patience_exceeded)으로 시도 불가

## 출력 (JSON array만)
[
  {"id": "...", "status": "passed|failed|blocked", "memo": "1-2문장", "matched_turn_idx": 정수|null}
]"""


def _extract(session_log: Any, key: str, default: Any = None) -> Any:
    if isinstance(session_log, dict):
        return session_log.get(key, default)
    return getattr(session_log, key, default)


def _session_summary(session_log: Any) -> str:
    """Compact text summary for LLM context."""
    mode = _extract(session_log, "mode", "browser") or "browser"
    outcome = _extract(session_log, "outcome", "") or ""
    turns = _extract(session_log, "turns", []) or []

    lines = [f"mode: {mode}", f"outcome: {outcome}", f"total_turns: {len(turns)}", ""]
    for t in turns:
        if not isinstance(t, dict):
            continue
        idx = t.get("turn")
        obs = t.get("observation") or {}
        dec = t.get("decision") or {}
        tool = t.get("tool") or {}

        parts = [f"turn {idx}:"]
        if isinstance(tool, dict):
            action = tool.get("tool")
            target = tool.get("target") or tool.get("selector")
            if action:
                parts.append(f"action={action}" + (f" target={target}" if target else ""))
        if isinstance(obs, dict):
            summary = obs.get("summary")
            if summary:
                parts.append(f"obs={str(summary)[:160]}")
        if isinstance(dec, dict):
            if dec.get("done"):
                parts.append("done=True")
            kb = dec.get("key_behaviors")
            if kb:
                parts.append(f"key_behaviors={kb}")
            fp = dec.get("frustration_points")
            if fp:
                parts.append(f"frustration={fp}")
        lines.append(" ".join(parts))
    return "\n".join(lines)


def _rule_based_fallback(
    items: list[ChecklistItem], summary: str, outcome: str
) -> list[ChecklistResult]:
    blob = summary.lower()
    blocking = outcome in _BLOCKING_OUTCOMES
    results: list[ChecklistResult] = []
    for it in items:
        keywords = [w for w in it.task.lower().split() if len(w) >= 3]
        hits = [k for k in keywords if k in blob]
        if hits:
            results.append(ChecklistResult(
                id=it.id, status="passed",
                memo=f"키워드 매칭 ({', '.join(hits)})",
            ))
        elif blocking:
            results.append(ChecklistResult(
                id=it.id, status="blocked",
                memo=f"세션 {outcome}로 시도 불가",
            ))
        else:
            results.append(ChecklistResult(
                id=it.id, status="failed",
                memo="관찰된 행동에서 태스크 증거 없음",
            ))
    return results


def _normalize_items(
    checklist: list[ChecklistItem] | list[dict],
) -> list[ChecklistItem]:
    out: list[ChecklistItem] = []
    for i in checklist:
        if isinstance(i, ChecklistItem):
            out.append(i)
        elif isinstance(i, dict):
            out.append(ChecklistItem(
                id=str(i.get("id", "")),
                task=str(i.get("task", "")),
                expected=str(i.get("expected", "")),
            ))
    return out


def score_checklist(
    checklist: list[ChecklistItem] | list[dict],
    session_log: Any,
    *,
    use_llm: bool = True,
) -> list[ChecklistResult]:
    """Score each checklist item against a session log.

    Returns ChecklistResult[] in the same order as input. Falls back to
    keyword matching if LLM call fails or ``use_llm=False``.
    """
    items = _normalize_items(checklist)
    if not items:
        return []

    summary = _session_summary(session_log)
    outcome = _extract(session_log, "outcome", "") or ""

    if not use_llm:
        return _rule_based_fallback(items, summary, outcome)

    user_msg = (
        "## 세션 요약\n" + summary + "\n\n"
        "## 체크리스트 (JSON)\n"
        + json.dumps(
            [{"id": i.id, "task": i.task, "expected": i.expected} for i in items],
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
        results: list[ChecklistResult] = []
        for it in items:
            p = by_id.get(it.id) or {}
            status_raw = p.get("status")
            status: ChecklistStatus = (
                status_raw if status_raw in ("passed", "failed", "blocked") else "failed"
            )
            results.append(ChecklistResult(
                id=it.id,
                status=status,
                memo=str(p.get("memo") or ""),
                matched_turn_idx=(
                    int(p["matched_turn_idx"])
                    if isinstance(p.get("matched_turn_idx"), int)
                    else None
                ),
            ))
        return results
    except Exception as e:
        logger.warning("checklist LLM scoring failed (%s); using rule-based fallback", e)
        return _rule_based_fallback(items, summary, outcome)
