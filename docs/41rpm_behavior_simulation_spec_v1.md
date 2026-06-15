# 41rpm 행동 시뮬레이션 엔진 — 개발 스펙 v1

> 합성 페르소나가 실제 브라우저에서 행동하여 유입(engage/bounce), 체류시간, 이탈(mode + 이유),
> 사용 여부 verdict, 문제점을 **분포 수준**으로 산출하는 시스템.
> 기존 "스크린샷 + 멀티모달 LLM 해석" 방식을 대체한다.

---

## 0. 설계 원칙 (전 레이어 공통)

1. **프레임워크는 primitive, loop는 orchestrator 소유** — 브라우저 프레임워크에 task를 위임하지 않는다. perceive/act 두 primitive만 사용.
2. **객관 감지와 주관 가중의 분리** — friction은 페르소나 무관하게 동일 측정(Channel 1), impact만 페르소나 trait로 가중.
3. **결론을 input에 심지 않는다 (no circularity)** — 유입 경로 seed 금지, goal-target 금지, GA 태그 조향 금지, "텍스트 싫어하는 12살" 같은 결론 내장 페르소나 금지. 모든 결과는 emerge해야 한다.
4. **leave는 1급 선택지** — 매 step 가장 먼저 평가. LLM은 leave 이후가 아니라 continue 이후에만 호출.
5. **LLM 호출 최소화** — Channel 1, internal-state 갱신, leave-gate는 전부 LLM-free. LLM은 action 선택과 selective perception에만.
6. **GA 계측은 듣되, 조향하지 않는다.**

---

## 1. 레이어 아키텍처

```
[ L5  집계 (population)          ]  분포·funnel·문제 랭킹          ← product 산출물
[ L4  internal-state 엔진        ]  trait 가중·leave-gate·verdict   ← 난이도 80%, 핵심 해자
[ L3  2채널 분석                 ]  Ch1 프로그래밍 / Ch2 LLM        
[ L2  브라우저 인터랙션          ]  browser-use (perceive/act)      
[ L1  Playwright / CDP           ]  공통 기반                       
        ↑ (점선) GA 분포 calibration이 L4 가중치로 되먹임
```

---

## 2. L2 — 브라우저 인터랙션 층

### 2.1 선택

- **browser-use** (Python) — library 모드. Agent 모드 사용 금지.
- 사용 primitive 두 개만:
  - `perceive()` → 현재 화면의 actionable 요소 목록(SoM 인덱스 + 텍스트/role) + 압축 상태
  - `act(element_index, action_type, value?)` → 클릭/입력/스크롤 실행
- mark/SoM은 매 step 자동 생성 (라이브러리 내부 처리, 사전 annotation 불필요).

### 2.2 필수 guard 4종 (지난 실패 재발 방지)

| Guard | 내용 | 구현 위치 |
|---|---|---|
| 요소 필터링 | viewport 내 + interactive만, 요소당 텍스트 50자 절삭 | browser-use 설정 |
| History 캡 | 이전 step 상태 폐기, 최근 1 step + 텍스트 trace 요약만 유지 | orchestrator |
| 토큰 budget | perceive 결과가 step당 2,000 토큰 초과 시 절삭 후 진행 | orchestrator |
| Degradation ladder | a11y/SoM 추출 실패 시 **해당 step만** screenshot-only로 fallback | orchestrator |

### 2.3 Bake-off (개발 착수 전, 2일 timebox)

- 대상: 타깃 SPA에서 **이전에 깨졌던 최난도 화면 3개**.
- 측정 항목:
  1. actionable 요소 감지율 (수동 라벨 대비)
  2. step당 perceive 토큰 수
  3. 화면 전환(SPA route change) 후 재감지 안정성
- 판정: 통과 → browser-use 확정. 토큰 budget 지속 초과 → browsegrab의 a11y-tree-only 패턴 차용 또는 교체 검토.
- 알려진 약점 (fallback 대상으로 사전 인지): hover-only 메뉴, drag&drop, canvas UI, 깊은 iframe, virtualized 리스트.

---

## 3. L3 — 2채널 분석

### 3.1 Channel 1: 프로그래밍 객관 추출 (LLM 없음, 매 step)

JS injection / CDP로 추출하는 **raw friction vector**. 페르소나 무관, deterministic.

```json
{
  "step": 7,
  "url": "...",
  "signals": {
    "text_density": 0.62,
    "visible_word_count": 480,
    "cta_count": 9,
    "primary_cta_dominance": 0.21,
    "fcp_ms": 1840,
    "tti_ms": 3100,
    "cls": 0.18,
    "failed_requests": 1,
    "scroll_depth_available": 4.2,
    "interactive_element_count": 31,
    "ga_events_fired": ["view_item"]
  }
}
```

| 신호 | 추출 방법 |
|---|---|
| text_density / word_count | `innerText` 길이, 텍스트 면적 / viewport 면적 |
| CTA 개수·우세도 | interactive 요소 쿼리 + `getComputedStyle` (크기/대비/위치) |
| 성능 (FCP/TTI/CLS/실패 요청) | CDP Performance + Network domain |
| 구조 | `page.accessibility.snapshot()` 또는 CDP `Accessibility.getFullAXTree` |
| GA 이벤트 | 3.3 참조 |

### 3.2 Channel 2: LLM perception (selective)

코드로 측정 불가한 semantic 판단만. **매 step 호출 금지.**

- 판단 항목: `comprehension` (value prop 명확성, 다음 step의 자명성), `trust` (신뢰 인상), `content_mismatch` (페르소나 need vs 페이지 내용)
- 호출 트리거 (v1 초안, 측정 후 정밀화):
  1. 새로운 page type 첫 진입 시
  2. Channel 1 신호가 애매 구간일 때 (예: cta_dominance 0.3~0.6)
  3. leave-gate 점수가 경계 구간(임계 ±15%)일 때
- Payload: marked screenshot 1장 + 압축 a11y tree (≤1k 토큰)
- 모델: 저가 API 모델 (Claude Haiku / Gemini Flash / GPT-4o-mini 급). 출력은 JSON 강제.

### 3.3 GA 계측 활용 — "듣되, 조향하지 않는다"

**Pass A — Discovery pass** (페르소나 없음, 사이트당 1회 + 주기 갱신):
- `gtm.js` 컨테이너 파싱 → trigger의 CSS selector / 이벤트명 추출
- 산출물: **이벤트 그래프** (운영자 정의 funnel: 예 `view_item → add_to_cart → begin_checkout → purchase`)
- 용도: 사후 분석의 milestone 매핑, decision-graph 모드(#6)의 노드 자동 생성

**Pass B — Behavior pass** (페르소나 세션 중, 감청만):
- CDP Network 감청: `google-analytics.com/g/collect` 류 요청에서 `en=` 파라미터 파싱
- `window.dataLayer.push` hook 주입: 모든 push를 timestamp와 함께 캡쳐 (server-side GTM 보완)
- 페르소나는 태깅 여부를 **절대 모른다**. 태그 발화 여부 자체가 결과 신호.

**정책**:
- Consent 배너: 시뮬레이션 모드에서 "수락 고정" (측정 일관성). 추후 페르소나 행동으로 옵션화 가능.
- GA 없는 사이트: 이벤트 그래프 없이 동작 (enrichment이지 의존성 아님).

---

## 4. L4 — 페르소나 모델 & internal-state 엔진

### 4.1 페르소나 trait schema

```json
{
  "persona_id": "p_0412",
  "archetype_id": "a_early_teen_casual",
  "traits": {
    "patience": 0.25,
    "reading_tolerance": 0.2,
    "exploration_tendency": 0.7,
    "trust_sensitivity": 0.4,
    "tech_literacy": 0.6,
    "reading_speed_wpm": 180,
    "decision_latency_ms": [400, 1500],
    "distraction_rate": 0.08
  },
  "need": "친구들이 하는 게임 아이템을 빨리 찾고 싶다",
  "friction_weights": {
    "comprehension": 1.8,
    "navigation": 1.2,
    "performance": 1.5,
    "trust": 0.6,
    "content_mismatch": 1.0
  }
}
```

- `need`는 **lens**다 — 달성 target이 아니라 평가 기준. prompt에 "목표를 달성하라"는 표현 금지.
- 결론 내장 금지: "텍스트가 많으면 떠나는 성격" 같은 서술 금지. 일반 trait + 가중치만.
- **archetype 단위 reasoning**: LLM 추론은 archetype(50~100개)에만. 개별 페르소나는 trait의 parameter perturbation(±10~20%)으로 생성.

### 4.2 Internal state (세션 중 매 step 갱신, LLM-free)

```json
{
  "value_realized": 0.3,
  "effort_expended": 4.2,
  "frustration": 0.55,
  "patience_remaining": 0.18,
  "interest": 0.4
}
```

**갱신 함수 (v1: 선형 누적 + 임계 판정 하이브리드)**:

```
weighted_friction(step) = Σ_category( raw_signal_norm × friction_weights[category] )

frustration      += α · weighted_friction(step)
patience_remaining -= β · weighted_friction(step) + γ · step_cost
value_realized   += δ · relevance(step)        # Ch1 휴리스틱 + (있으면) Ch2 content_mismatch 역수
interest          = ema(interest, novelty(step))
```

- α, β, γ, δ는 **calibration 대상 파라미터** (§7).
- 가중 함수의 최종 형태(순수 선형 vs 임계 기반)는 미해결 결정 포인트 — v1은 위 하이브리드로 시작하고 GA fit 결과로 재평가.

### 4.3 Leave-gate (매 step 최우선 평가, LLM-free)

```python
def leave_gate(state, persona) -> LeaveDecision:
    if state.value_realized >= persona.need_threshold:
        return Leave(mode="satisfied")
    if state.frustration >= state.patience_remaining_threshold():
        return Leave(mode="frustrated", reasons=top_k_frictions(k=3))
    if state.interest < INTEREST_FLOOR and stagnant(state.value_realized, n=3):
        return Leave(mode="indifferent")
    if random() < persona.traits.distraction_rate:
        return Leave(mode="distracted")
    return Continue()
```

| Mode | 의미 | 제품 관점 |
|---|---|---|
| satisfied | 원하던 가치 획득 | ≈ conversion |
| frustrated | friction 누적으로 포기 | **churn 신호 (핵심)** |
| indifferent | 계속할 이유 없음 | bounce |
| distracted | 외부 요인 흥미 상실 | 자연 이탈 base rate |

- leave 시 `leave_reason`: patience를 소진시킨 dominant friction top-3 (카테고리 + 발생 step + 요소 ref).

### 4.4 체류시간 (derived, wall-clock 아님)

```
dwell_time = Σ_steps( content_volume(step) / reading_speed + decision_latency_sample() )
```

- `content_volume`: Channel 1 (visible_word_count, 요소 수)
- 브라우저 = "처리할 양", 페르소나 = "처리 속도" 의 분업. LLM/인프라 latency는 절대 포함하지 않는다.

---

## 5. Per-step 메인 루프 (orchestrator 의사코드)

```python
async def run_session(persona, site_url) -> SessionResult:
    state = InternalState.init(persona)
    trace, frictions, ga_hits = [], [], []
    await browser.goto(site_url)                      # cold landing, 유입 맥락 seed 없음

    for step in range(MAX_STEPS):
        page = await stabilize(browser)               # SPA settle 대기

        ch1 = extract_channel1(page)                  # LLM 없음
        ga_hits += ch1.ga_events_fired

        ch2 = None
        if channel2_trigger(ch1, state):              # selective
            ch2 = await llm_perceive(page.marked_screenshot, page.a11y_compact,
                                     persona.need, model=CHEAP_MODEL)

        frictions += detect_frictions(ch1, ch2)       # 객관 감지 (페르소나 무관)
        state.update(frictions[-1:], persona.friction_weights)   # 주관 가중

        decision = leave_gate(state, persona)         # LLM 없음, 최우선
        if decision.leave:
            return finalize(persona, trace, frictions, ga_hits, state, decision)

        elements = await browser.perceive()           # SoM, guard 적용
        action = await llm_decide_action(             # 유일한 정규 LLM 호출
            persona_lens=persona.need,
            traits_brief=persona.traits_summary(),
            state_brief=state.summary(),
            elements=truncate(elements, TOKEN_BUDGET),
            recent_trace=trace[-1:],                  # history 캡
            model=CHEAP_MODEL)
        await browser.act(action)
        trace.append(action)

    return finalize(..., decision=Leave(mode="timeout"))


def finalize(persona, trace, frictions, ga_hits, state, decision):
    dwell = compute_dwell(trace, persona)             # §4.4
    verdict = llm_verdict(persona, frictions, state, decision,   # 세션당 1회
                          model=CHEAP_MODEL)
    return SessionResult(persona.id, decision.mode, decision.reasons,
                         dwell, trace, frictions, ga_hits, verdict)
```

**LLM 호출 지점은 정확히 3곳**: ① action 선택(매 continue step), ② Channel 2(조건부), ③ verdict(세션당 1회). 나머지 전부 LLM-free.

---

## 6. Friction taxonomy & 세션 산출물 schema

### 6.1 Friction record

```json
{
  "step": 7,
  "category": "comprehension",
  "severity": 0.7,
  "source": "ch1",
  "evidence": {"signal": "text_density", "value": 0.62},
  "element_ref": "som_idx_14",
  "url": "..."
}
```

- category enum: `navigation | comprehension | trust | performance | content_mismatch`
- 이 schema는 leave_reason, verdict, 집계가 전부 소비 — **가장 먼저 확정할 schema.**

### 6.2 Verdict (세션 종료 후 LLM reflection 1회)

```json
{
  "would_use": false,
  "would_return": false,
  "confidence": 0.8,
  "reasons": ["읽을 게 너무 많고 다음에 뭘 해야 할지 모르겠음"],
  "problems": [
    {"category": "comprehension", "frequency": 5, "worst_step": 7},
    {"category": "navigation", "frequency": 2, "worst_step": 3}
  ]
}
```

---

## 7. L5 — 집계 & calibration

### 7.1 집계 (product 산출물)

- archetype × milestone(GA 이벤트 그래프) funnel: 어느 세그먼트가 어디서 떨어지나
- leave mode 분포 (satisfied / frustrated / indifferent / distracted) per archetype
- 문제 빈도 랭킹: "어떤 friction이 가장 많은 페르소나를 막나" (category × element × archetype)
- dwell time 분포 per archetype
- (dual-mode 도입 시) 의도 baseline vs 행동 결과의 gap = UX quality 지표

### 7.2 GA 분포 calibration (Phase 2.5, 점선 되먹임의 실체)

- **Loss**: 합성 분포 vs GA 실제 분포의 거리
  - bounce rate per (세그먼트 ≈ archetype 그룹)
  - engagement time 분포
  - 이벤트 그래프 milestone 전환율 (실제/합성이 **같은 이벤트 vocabulary** — 직접 비교 가능)
  - (BigQuery export 시) page path 분포 비교
- **튜닝 대상**: friction_weights, α/β/γ/δ, patience 분포
- **매핑 원칙**: GA 세그먼트(연령 bracket/디바이스/지역)는 거칠다 → archetype *그룹* 수준에서만 fit. 세부 trait까지 GA로 fit하지 않는다 (overfitting 금지).
- **Population seeding**: GA 방문자 mix(디바이스/연령/지역 비율)로 합성 population 구성비 결정.
- GA 접근 불가 사이트 → "uncalibrated 모드"로 명시 구분 (상대 비교용).

---

## 8. 비용 전략 (확정 사항)

| # | 항목 | 결정 |
|---|---|---|
| 1 | Self-hosted LLM | **보류** — 스케일/closed-network 시장 진입 시 pull할 known lever |
| 1' | 대체: 저가 API 모델 | **채택** — 모든 LLM 호출에 Haiku/Flash/4o-mini급 |
| 2 | 토큰 효율 encoding | **채택** — SoM/a11y + guard 4종 |
| 3 | Action caching | 측정 후 판단 |
| 4 | Hierarchical decision | **채택** — leave-gate가 top-level, LLM-free |
| 5 | Archetype clustering | **채택** — reasoning은 archetype만, 개별은 perturbation |
| 6 | Decision-graph 모드 | dual-mode의 **의도적 선택**으로만 (비용 핑계로 default화 금지). GA discovery pass가 노드 자동 생성 |

목표 단가: 세션당 LLM 비용 ≤ $0.05 (20 step 기준). step당 perceive ≤ 2k 토큰.

---

## 9. 개발 로드맵

| Step | 내용 | Deliverable | 완료 기준 |
|---|---|---|---|
| 0 | 브라우저 bake-off | browser-use perceive 검증 리포트 | 최난도 화면 3개에서 감지율·토큰·재감지 통과 (2일) |
| 1 | Spine | perceive→act 루프 + guard 4종 | 타깃 SPA에서 10-step 세션이 budget 내 완주 |
| 2 | Channel 1 + GA listener | raw friction vector + GA hit 로그 | 동일 화면 반복 측정 시 deterministic |
| 3 | Internal-state + leave-gate | §4 엔진, 4-mode 이탈 | trait가 다른 두 페르소나가 같은 화면에서 다른 시점·다른 mode로 이탈 |
| 4 | Friction schema + verdict | §6 산출물 | 세션 1개 → 구조화된 friction 로그 + verdict JSON |
| 5 | 집계 | archetype × funnel 대시보드 | N=100 페르소나(archetype 10개) 배치 실행 → 분포 산출 |
| 6 | GA calibration | 가중치 fit 루프 | 합성 bounce/dwell 분포가 GA 세그먼트 분포에 수렴 |
| 7+ | Dual-mode(#6), caching(#3), self-host(#1) | — | Step 6까지의 측정 결과로 판단 |

핵심 투자 배분: **Step 3 (internal-state)이 전체 난이도의 80%** — "스크립트 봇"과 "행동 시뮬레이션"을 가르는 지점. 여기에 ground truth 검증을 병행할 것.

---

## 10. 미해결 결정 포인트 (다음 설계 세션)

1. internal-state 가중 함수 최종 형태 (선형 누적 vs 임계 기반 vs 하이브리드 유지) — Step 6 fit 결과로 결정
2. Channel 2 호출 트리거의 정량 조건 정밀화 — Step 2~3에서 실측 후
3. GA 세그먼트 ↔ archetype 그룹 매핑 테이블 설계
4. Dual-mode(#6) 도입 시점과 의도-행동 gap 지표 정의
5. Consent 처리의 페르소나 행동화 여부

---

## 부록 — 경쟁/참고 레퍼런스

- **Uxia (uxia.app)**: 직접 경쟁. SUS/SUPR-Q, WCAG 체크, attention heatmap. reverse-engineer 필수.
- 차별점 후보: 객관 friction 감지 + 페르소나별 가중 + GA ground-truth 보정이 결합된 internal-state 엔진 / 한국 시장 특화 / on-prem 가능성 / dual-metric (의도 vs 행동 gap).
- 기술 레퍼런스: browser-use (SoM, WebVoyager 89.1%), Stagehand v3 (SPA·caching 패턴), browsegrab (a11y 토큰 효율, step당 0.5~1.5k), Stanford genagents (페르소나 reasoning loop).
