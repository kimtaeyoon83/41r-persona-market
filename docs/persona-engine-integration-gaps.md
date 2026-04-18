# persona_agent ↔ 41rpm 통합 Gap 분석 및 수정 요청

작성일: 2026-04-17
대상 리포: `41r-advisor/persona_agent` (upstream), `41r-persona-market/apps/persona-engine` (wrapper)

> **상태 업데이트 (2026-04-17)** — upstream P1~P4 모두 구현 완료. 기본값 `mode="browser"` (0.2.x 호환), 1.0에서 `"text"` 전환 검토. 22개 신규 테스트 추가. 상세: persona_agent 커밋 참조.

## 배경

`apps/api/src/services/autotest.ts` (Stagehand 기반)를 persona_agent 기반으로 대체하는 작업의 사전 분석. 기존 autotest.ts의 모든 책임이 persona_agent 네이티브로 커버되는지 검증하고, 부족분을 (a) persona_agent upstream 수정 / (b) persona-engine wrapper 자체 구현 / (c) Express 레이어 유지로 분류.

## 통합 가능성 요약

| 영역 | 상태 |
|---|---|
| 세션 실행 / action log / plan | ✅ 네이티브 (`run_session` → `SessionLog.turns[]`) |
| 페르소나 진화 (observation, soul versioning) | ✅ 네이티브 |
| Browser 스크린샷 | ✅ 네이티브 (`list_session_screenshots`) |
| Persona faithfulness scoring | ✅ 네이티브 (`score_session_predicates`) |
| Session 일관성 평가 | ✅ 네이티브 (`evaluate_session`) |
| 체크리스트 검증 | 🟡 persona-engine에서 predicate 어댑터 필요 |
| 품질 점수 (1-5) | 🟡 persona-engine에서 집계 필요 |
| 설문(questionnaire) 자동 응답 | 🟡 persona-engine에서 LLM 호출 필요 |
| Text mode 단일 세션 | 🔴 persona_agent 수정 필요 |
| 구조화 UX 리포트 (JSON) | 🔴 persona_agent 수정 필요 |

---

## 1. persona_agent 수정 요청 (upstream)

### P1. `run_session`에 `mode` 파라미터 추가 ⭐ 우선순위 최상

#### 현재
```python
# src/persona_agent/_internal/session/agent_loop.py
def run_session(
    persona_id: str,
    url: str,
    task: str,
    *,
    max_turns: int | None = None,
) -> SessionLog:
    # browser mode only (Playwright 강제)
```

#### 요청
```python
def run_session(
    persona_id: str,
    url: str,
    task: str,
    *,
    mode: Literal["text", "browser"] = "text",
    max_turns: int | None = None,
) -> SessionLog:
```

#### 근거
- text mode 구현은 이미 `_internal/cohort/cohort_runner.py`의 `_run_text_prediction()`에 존재. 다만 private이고 cohort 경로로만 호출 가능.
- 단일 페르소나 text mode를 공식 API로 노출하면 41rpm의 `$0.10 AI Auto Test` 가격 모델이 지속 가능 (text: ~$0.40 → browser: ~$1.70)
- 마이그레이션 영향: 기본값이 `"text"`이므로 기존 browser 사용자는 명시적으로 `mode="browser"` 전달 필요 (breaking) — 또는 0.x 기간 동안 기본값 `"browser"` 유지 후 1.0에서 변경

#### 수용 기준
- [ ] `run_session(pid, url, task, mode="text")` → browser 없이 LLM-only 예측, `SessionLog` 반환
- [ ] `run_session(pid, url, task, mode="browser")` → 기존 동작 유지
- [ ] text mode 반환 `SessionLog.turns[]`도 `{observation, decision, tool?}` 구조 유지 (tool은 optional — 예측만 한 경우 null)
- [ ] 기존 cohort_runner는 새 public API 호출하도록 내부 리팩토링

---

### P2. `generate_structured_report()` — JSON 출력 API 추가 ⭐ 우선순위 상

#### 현재
```python
# src/persona_agent/_internal/reports/report_gen.py
def generate_report(
    session_logs: list[dict],
    personas: list[str],
    comparison_mode: str = "ab",
) -> str:
    # HTML만 반환 (report_id)
```

#### 요청
아래 중 하나:

**(a) 새 함수 추가 (권장)**
```python
def generate_structured_report(
    session_logs: list[dict],
    personas: list[str],
) -> StructuredReport:
    ...

@dataclass
class StructuredReport:
    summary: str
    pain_points: list[PainPoint]
    positive_signals: list[str]
    ux_scores: UxScores
    recommendations: list[str]

@dataclass
class PainPoint:
    severity: Literal["high", "medium", "low"]
    description: str
    evidence_turn: int | None  # turns[] 인덱스 참조
    affected_personas: list[str]

@dataclass
class UxScores:
    clarity: float      # 0.0-1.0
    trust: float        # 0.0-1.0
    efficiency: float   # 0.0-1.0
    overall: float      # 0.0-1.0
```

**(b) 기존 함수 옵션 확장**
```python
def generate_report(
    session_logs, personas, comparison_mode="ab",
    output_format: Literal["html", "json", "both"] = "html",
) -> str | dict | tuple[str, dict]:
```

#### 근거
- HTML은 사람이 읽는 용도. 41rpm 같은 embedding SaaS는 점수·핵심 항목을 DB에 저장해야 함 → 구조화 JSON 필수
- 41rpm `test_reports.uxFeedback` (jsonb), `test_reports.qualityScore` (1-5) 필드를 직접 채우는 재료
- Wrapper(persona-engine)에서 자체 LLM 호출로 대체 가능하지만, persona context(soul, observations, reflections)를 중복 구성해야 하며, 리포트 생성 로직이 persona_agent와 persona-engine에 분산되어 품질 관리 어려움

#### 수용 기준
- [ ] 단일 세션 / 멀티 세션(cohort) 둘 다 입력 가능
- [ ] `ux_scores.overall`은 `score_session_predicates`의 `persona_faithfulness`와는 다른 축(사이트 품질)이어야 함
- [ ] `evidence_turn`으로 `turns[]`의 특정 관찰을 역참조 가능 (UI에서 "이 발견은 여기에서 나옴" 노출용)

---

### P3. `SessionLog.duration_sec` 필드 보장 (소규모)

#### 현재
persona-engine wrapper가 `getattr(log, "duration_sec", None)`으로 방어적으로 접근 중 → 필드 누락 가능성 시사

#### 요청
- `SessionLog` dataclass에 `duration_sec: float = 0.0` 명시적 선언
- `run_session`의 모든 경로(text/browser, 정상 종료/abandon/timeout)에서 시작 시각 대비 종료 시각을 계산하여 채움

#### 근거
- 41rpm `test_reports`가 세션 소요 시간을 저장 (영수증 검증 / 어뷰징 탐지)
- 간단한 수정 — `time.time()` 차분만 일관되게 기록

---

## 2. Nice-to-have (P4, 선택)

### P4. Screenshot manifest (browser mode 한정)

#### 현재
`workspace/sessions/<sid>/screenshots/turn_01.png, turn_02.png, ...` flat 구조. turn과 파일명 매핑만 존재.

#### 요청
동일 디렉토리에 `screenshots_manifest.json` 생성:
```json
{
  "session_id": "s_abcd1234",
  "screenshots": [
    {
      "turn": 1,
      "filename": "turn_01.png",
      "timestamp": "2026-04-17T10:00:00Z",
      "action": {"tool": "navigate", "params": {"url": "..."}},
      "page_url": "...",
      "phase_hint": "initial_load"
    }
  ]
}
```

#### 근거
- 41rpm UI가 "이 스크린샷은 어떤 액션 직후 찍혔는가" 라벨을 보여줌 (기존 autotest.ts의 phase 라벨 대체)
- LLM에 보낼 스크린샷 다양성 확보 (init/exploration/decision 단계별 샘플링)

#### 수용 기준
- [ ] browser mode에서 매 턴 스크린샷과 함께 자동 생성
- [ ] `list_session_screenshots`를 `list_session_screenshots(session_id, with_metadata=True)` 로 확장 → manifest 내용 포함 반환

---

## 3. persona-engine wrapper 자체 구현 (persona_agent 수정 불필요)

참고용으로만 기록. 41rpm 리포 내부 작업.

### E1. checklist → predicate 어댑터
- 위치: `apps/persona-engine/adapters/checklist_to_predicate.py` (신규)
- 입력: `ChecklistItem[] = [{id, task}]`
- 처리: 각 항목을 `turns[].tool` 시그니처와 매칭 → `{passed|failed|blocked, matched_turn_idx, memo}`
- 구현: rule-based (키워드/tool 매칭) + LLM fallback (애매한 경우)

### E2. qualityScore 1-5 산출
- 위치: `apps/persona-engine/scorers.py` (신규)
- 공식 (초안):
  ```
  base = persona_faithfulness × 0.4
       + evaluate_session.overall × 0.3
       + (1.0 if outcome == 'task_complete' else 0.5) × 0.2
       + min(checklist_pass_rate, 1.0) × 0.1
  quality_score = round(1 + base * 4)  # 1-5
  ```
- 튜닝은 시드 데이터 대비 회귀 테스트 후 확정

### E3. questionnaireAnswers 생성
- 위치: `apps/persona-engine`에 `answer_questionnaire(session_log, soul_text, questionnaire)` 함수
- LLM: Haiku 4.5 (41rpm의 scoring/extraction 모델)
- 프롬프트: soul + 세션 요약 + 각 문항 → JSON 답변

### E4. Text mode wrapper 엔드포인트
- 현재 `POST /analyses`가 browser 암시
- P1이 merge되면 `mode` 파라미터 그대로 전달
- P1 전까지 임시: `_run_text_prediction` 내부 함수 직접 호출하는 방식 (upstream 변경에 취약)

---

## 4. 마이그레이션 순서 제안

```
[Phase 0 — 현재]
  41r-advisor: P1-P3 이슈 등록 (이 문서 복사)
  41rpm: E1/E2 스펙 확정, 샘플 데이터 세트 준비

[Phase 1 — persona_agent P1 merge 후]
  41rpm: persona-engine /analyses에 mode 전달 경로 추가
  41rpm: E1/E2 구현 + vitest 테스트
  41rpm: apps/api에 runAutoTestWithEngine 1차 연결 (USE_PERSONA_ENGINE=1)

[Phase 2 — persona_agent P2 merge 후]
  41rpm: persona-engine이 generate_structured_report 결과를 받아 그대로 프록시
  41rpm: apps/api가 받은 ux_scores/pain_points를 test_reports에 저장
  41rpm: Stagehand dependency 제거

[Phase 3 — 운영]
  P4 manifest 적용 시 UI 업데이트
```

## 5. 질문 / 미결정

- **기본 mode 결정**: P1 merge 시점에 `"text"`를 기본으로 할지, 기존 호환을 위해 `"browser"`를 유지하고 1.0에서 변경할지? persona_agent 팀 판단에 위임.
- **qualityScore 가중치**: 실데이터 없이 공식 확정 어려움 → Phase 1에서 seed-data 기반 A/B 비교 후 고정.
- **Cohort 기반 테스트**: 41rpm은 현재 단일 persona 테스트만. 추후 회사가 "코호트 15명 테스트" 상품을 팔 경우 `POST /cohort-analyses` 경로를 Express에 노출. 현 단계 scope 밖.

## 참고

- persona_agent 버전: 0.2.0 (2026-04 기준)
- persona_agent API 문서: `/Users/freddie/dev/repo/personal/41r-advisor/persona_agent/API_GUIDE.md`
- 41rpm wrapper: `apps/persona-engine/main.py`
- 41rpm bridge: `apps/api/src/services/persona_engine.ts`
- 대체 대상: `apps/api/src/services/autotest.ts` (Stagehand)
