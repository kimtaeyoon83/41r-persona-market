# 행동 시뮬레이션 가설 검증 스파이크 (v0) — 실험 설계

> `41rpm_behavior_simulation_spec_v1.md` 착수 게이트.
> 엔진을 만들지 않고 1~2주 안에 스펙의 핵심 가설을 검증/반증한다.
> **반증 기준은 이 문서에서 사전 고정한다 — 실험 후 수정 금지.**

관련 결정 (2026-06-10 세션): Mode C 병행 · 그래프 모드 우선 · TS-native (browser-use 미채택).

---

## 0. 검증 대상 가설

| ID | 가설 | 실패 시 |
|---|---|---|
| **H1** | LLM 페르소나의 탐색 경로·막힘 지점·이탈이 실제 사람과 **분포 수준**에서 유사하다 | 스펙 전체 보류. Mode A 멀티스크린샷 개선으로 전환 |
| **H2** | trait 차이(patience, reading_tolerance)가 **의미 있게 다른** 이탈 시점·mode를 만든다 | 치명 아님 — L4 trait 가중 설계 수정 신호. H1 통과면 재시도 |
| **H3** | **정적 화면 그래프**만으로 사람이 겪는 탐색 friction이 검출된다 | 그래프 모드 폐기. 라이브 모드 직행 여부를 비용 재평가로 결정 |
| **H0** | 이탈 mode 분포 + friction 랭킹이 현 리포트보다 고객에게 가치 있다 | 기술 검증과 무관하게 제품화 보류 |

부가 관측 (가설 아님, 기록만): **LLM이 스스로 떠나는가** — 스펙의 "leave-gate가 LLM 밖에 있어야 한다"(원칙 4)는 주장의 실측 근거 확보.

---

## 1. 대상 사이트

### 선정 기준

1. 실제 운영 서비스 (한국어 또는 영어)
2. 메뉴 깊이 ≥ 2, 핵심 탐색이 화면 10~15개로 커버됨
3. 로그인 없이 탐색 가능한 영역이 충분
4. 개인화/AB 테스트가 약함 (참가자 간 화면 동일성 — 재현성)
5. 탐색 friction이 있을 법한 정보 구조 (너무 다듬어진 사이트는 천장 효과)

### 구성

- **Primary (사람 ground truth 수집):** 기준 1~5 충족 사이트 1개. 후보 풀: 공공기관/대학/금융 등 정보 구조가 복잡한 사이트, 또는 41R의 잠재 고객 카테고리(SaaS/커머스)의 중간 완성도 제품. **운영자 확정 필요 — 착수 전 결정 항목 D1.**
- **Secondary (GA 분포 대조, 사람 불필요):** Google Merch Store. 이미 보유한 유일한 GA ground truth(n=1). 동일 미니 시뮬을 돌려 bounce(첫 노드 이탈률)·평균 탐색 깊이를 GA 분포와 **방향** 비교. stretch goal — primary 판정에는 미사용.

---

## 2. Phase 0 — 수동 그래프 구축 (Day 1~2)

크롤러 없이 손으로 만든다. 이 단계가 빠르다는 것 자체가 그래프 모드의 비용 주장 검증이기도 하다.

### 그래프 schema (스파이크용 최소형)

```json
{
  "site": "example.com",
  "captured_at": "2026-06-12",
  "nodes": [
    {
      "id": "home",
      "url": "/",
      "screenshot": "spike/screens/home.png",
      "signals": {
        "visible_word_count": 480,
        "cta_count": 9,
        "menu_item_count": 7,
        "primary_cta_label": "시작하기"
      },
      "edges": [
        { "label": "요금제", "to": "pricing" },
        { "label": "제품 소개", "to": "product" }
      ]
    }
  ]
}
```

- **노드:** 화면 10~15개. 데스크탑 풀페이지 스크린샷 (사람 세션도 데스크탑 고정 — 매칭 일관성).
- **엣지:** 화면에 보이는 네비게이션 선택지. 라벨은 **화면에 보이는 텍스트 그대로** (요약·의역 금지 — 결론 심기 방지).
- **signals (Ch1-lite):** word count, CTA 수, 메뉴 항목 수만 수동 기록. 성능 신호는 스파이크에서 제외 (정적 그래프에서 무의미).
- **막다른 화면도 노드로** — 뒤로가기 엣지 포함. silent drop 금지.

산출물: `spike/graph.json` + 스크린샷 10~15장.

---

## 3. Phase 1 — Human ground truth (Day 2~5, Phase 0와 병렬 가능)

### 참가자

- **5명.** 해당 사이트 비사용자. 연령·기기 친숙도 분산 (20대~50대, 테크 능숙 2 / 보통 2 / 낮음 1 권장). 지인 리크루팅 허용.
- 데스크탑 브라우저 고정.

### 프로토콜

1. **need 부여 — 느슨하게.** "~를 찾아서 완료하세요"(태스크) 금지. "~가 궁금해서 이 사이트에 들어왔다고 생각하세요"(lens) 형식. 시뮬레이션의 archetype에 **동일한 need 텍스트** 사용.
2. **think-aloud 지시:** "보이는 것, 생각하는 것, 누르고 싶은 것을 계속 소리 내서 말해주세요."
3. 진행자는 **힌트 금지.** 침묵 10초 이상이면 "지금 무슨 생각 하세요?"만 허용.
4. 화면 녹화 + 음성 녹음. 세션 최대 10분.
5. **종료 조건:** 참가자가 자연스럽게 그만두거나("이제 됐어요" / "모르겠어요, 그만 볼래요") 10분 도달. 진행자가 종료시키지 않는다.
6. 세션 직후 1문항: "그만둔 이유는?" → satisfied / frustrated / indifferent 중 사후 분류.

### 기록 template (세션당)

| 필드 | 내용 |
|---|---|
| path | 방문 화면 순서 (그래프 노드 id로 매핑) |
| stuck_points | (화면 id, 카테고리, 발화 인용) — 막힘 판정 기준은 §5.1 |
| leave | { step, mode, 이유 인용 } |
| off_graph | 그래프에 없는 화면으로 이동한 횟수 + 목적지 (커버리지 천장 측정 — H3 입력) |

---

## 4. Phase 2 — 미니 시뮬레이션 (Day 4~7)

### Archetype 3개 (대비 극대화 배치)

| id | patience | reading_tolerance | exploration | need |
|---|---|---|---|---|
| `impatient_scanner` | 0.2 | 0.2 | 0.5 | 사람 참가자와 동일 |
| `patient_reader` | 0.8 | 0.8 | 0.4 | 〃 |
| `mid_pragmatic` | 0.5 | 0.4 | 0.7 | 〃 |

- 각 archetype × perturbation ±15% × **10 = 총 30 세션.**
- trait는 위 3개 + need만. **결론 내장 서술 금지** (스펙 원칙 3).

### 세션 루프 (스크립트 수준 — 엔진 아님)

```
매 step (max 8):
  프롬프트 = need + trait 요약(수치 그대로) + 현재 노드 스크린샷(vision)
           + 엣지 목록(라벨 그대로) + 직전 1 step trace
  → Haiku JSON 출력:
    { "action": "move" | "leave",
      "edge_label": "...",          // move일 때
      "leave_mode": "satisfied|frustrated|indifferent",  // leave일 때
      "friction_note": "..." | null }  // 이 화면에서 거슬린 것 (없으면 null)
```

- **이중 leave 기록:** ① LLM이 스스로 leave를 고른 경우, ② 간이 leave-gate(아래)가 발동한 경우 — 둘 다 기록하고 어느 쪽이 먼저였는지 남긴다. → 부가 관측("LLM은 안 떠난다") 데이터.
- **간이 leave-gate (휴리스틱, 스파이크용):**
  `frustration += (friction_note ? 1 : 0) × (1 − reading_tolerance)` · `frustration > patience × 4 → frustrated leave`. 정밀할 필요 없음 — H2는 *방향*만 본다.
- 모델: Haiku 4.5 vision. 출력 파싱은 `parseJsonSafe()` 재사용.

### 구현 위치

- `scripts/spike-behavior-sim/` 아래 standalone tsx 스크립트 (run.ts + graph.json + 결과 JSONL).
- LLM 호출은 `apps/api`의 `anthropic_client.ts` 경유 (route tag `spike.behavior_sim`) — usage 추적 유지.
- 예상 비용: 30 세션 × ~8 step × (~1.5k tok) ≈ 360k input — **$1 미만.**

---

## 5. Phase 3 — 분석 & 판정 (Day 8~10)

### 5.1 friction 정의 (사전 고정)

- **사람 측 "막힘":** 다음 중 하나 — (a) 발화 신호("어디지", "모르겠다", "왜 안 보이지" 류), (b) 뒤로가기 후 동일 메뉴 재진입, (c) 10초+ 무행동 정지.
- **사람 합의 friction:** 5명 중 **≥2명**에게서 관찰된 (화면, 카테고리) 쌍.
- **시뮬 friction 랭킹:** 30 세션의 friction_note를 (화면, 카테고리)로 집계한 빈도 순위.
- 카테고리: 스펙 §6 taxonomy에서 `performance` 제외 4종 — `navigation | comprehension | trust | content_mismatch`.

### 5.2 판정 기준 (사전 고정 — 실험 후 수정 금지)

| 가설 | PASS 조건 |
|---|---|
| **H1-recall** | 사람 합의 friction의 **≥60%**가 시뮬 랭킹 top-5에 등장 |
| **H1-precision** | 시뮬 랭킹 top-3 중 **≥2개**가 사람 ≥1명에게서 관찰됨 (false positive 체크 — recall만큼 중요) |
| **H2** | ① median 이탈 step 순서: `impatient_scanner < mid_pragmatic ≤ patient_reader`, ② frustrated-leave 비율 순서: `impatient > patient`, ③ 각 archetype 내 10 perturbation 중 ≥7이 archetype 간 순서와 방향 일치 |
| **H3** | ① 사람 합의 friction 중 navigation/comprehension 카테고리에 대해 H1 기준 충족, ② 사람 friction 중 **정적 그래프로 원리상 검출 불가**(폼 입력·동적 상태 의존)인 비율 ≤ 40% — 초과 시 그래프 모드의 측정 천장이 너무 낮음 |
| **H0** | 시뮬 산출물로 손으로 구성한 목업 리포트 vs 현 Mode A 리포트를 잠재 고객 2~3명에게 나란히 제시 → 과반이 목업에 더 높은 지불 의사 |

H1은 recall과 precision **둘 다** 통과해야 PASS.

### 5.3 분기 (사전 고정)

| 결과 | 다음 행동 |
|---|---|
| H1✓ H3✓ | 그래프 모드 v1 착수 (스펙 v1.1 개정 먼저: browser-use→TS, Mode C 병행, 미정의 항목 보강) |
| H1✓ H3✗ | 라이브 모드 직행 vs 중단 — 비용($5~7/스캔 + 브라우저 팜) 재평가 후 결정 |
| H1✗ | 스펙 보류. Mode A 멀티스크린샷 공급(Phase 0 캡처 재활용)으로 전환 |
| H2✗ (H1✓) | trait 가중 설계 수정 후 H2만 재실험 (그래프·ground truth 재사용 — 며칠) |
| H0✗ | 기술 결과와 무관하게 제품화 보류, 결과는 마케팅 자산으로만 |

---

## 6. 일정 · 비용 · 사전 결정 항목

```
Day 1-2   Phase 0  수동 그래프 (반나절~1일) + 참가자 리크루팅 시작
Day 2-5   Phase 1  사람 세션 5건 (참가자 일정 따라 분산)
Day 4-7   Phase 2  미니 시뮬 스크립트 + 30 세션 실행
Day 8-10  Phase 3  매칭 분석 + 판정 + 결과 리포트
          (병렬)   H0 목업 리포트 + 인터뷰 2~3건
```

- 엔지니어링: ~3~4일. 달력: 1~2주 (참가자 일정이 크리티컬 패스).
- LLM 비용: $5 미만. 참가자 사례비: 운영 판단 (커피 기프티콘 수준 권장).

### 착수 전 결정 항목 (운영자)

- **D1.** Primary 사이트 확정 (§1 기준)
- **D2.** need 문안 확정 (사람·시뮬 공용 — lens 형식 준수)
- **D3.** H0 인터뷰 대상 2~3명 섭외 가능 여부 (불가 시 H0는 차기로 이월, H1~H3만 진행)

---

## 7. 중간 기록 — Phase 0 + 2 완료 (2026-06-10, 사람 데이터 수집 전)

판정은 Phase 1(사람 5명) 이후에만. 아래는 시뮬레이션 측 사실 기록.

- **Phase 0:** NHIS 14노드 그래프 + 스크린샷 28장 (`spike/graph.json`). 로그인 벽 6개 자동 검출(전부 동일 인증 페이지로 리다이렉트), 혼동 쌍·정답 경로 보존. 소요 반나절 — 그래프 모드의 저비용 주장과 부합.
- **Phase 2:** 30세션 × 2회 실행 (Haiku vision, 총 <$1).
  - **v1 (trace 요약 누락):** 페르소나가 자기가 부딪힌 로그인 벽을 기억 못 해 같은 메뉴를 최대 4회 재클릭 → friction 68건 전부 단일 노드. **스펙 §2.2 history 캡의 "텍스트 trace 요약" 부분이 생략 불가 요소임을 실증.** `spike/sessions.v1-no-trail.jsonl` 보존.
  - **v2 (방문 경로 요약 추가, 본 결과):** `spike/sessions.jsonl`
    - 이탈 중앙값 step: impatient 2 < mid 5 < patient 8 — **H2 순서 조건 충족 방향** (사람 대조 전이므로 H2 가판정은 Phase 3에서)
    - friction 랭킹: ① 검진대상 조회=로그인 벽 (49 content_mismatch + 17 navigation) ② 실시안내 페이지의 일반론 한계 — "유형은 많지만 '내가' 받을 항목이 안 나옴" (39)
    - satisfied 0건 — 비로그인으로 개인화된 답을 줄 수 없는 사이트 구조에서 emerge한 결과 (조향 없음)
  - **부가 관측 (leave-gate 필요성):** LLM 자발 이탈은 frustrated에선 잘 작동 (v1 18/30). 그러나 **indifferent/지루함으로는 한 번도 안 떠남** — patient_reader는 timeout까지 꽉 채움. leave-gate가 필수인 건 frustrated가 아니라 indifferent 모드. 스펙 v1.1에 반영할 것.
- **사람 대조 시 주시할 시뮬 측 약점 (사전 등록):**
  1. 첫 클릭이 30/30 "검진대상 조회"로 무분산 — 사람은 통합검색·히어로 퀵링크·메뉴 hover 등으로 분산될 것. H1-precision 리스크.
  2. 그래프 모드가 엣지를 평면 리스트로 제시 → 실제 화면의 시각적 위계(퀵링크 카드 등)가 사라짐. 정적 그래프의 구조적 한계 후보.

### 2차 사이트 — 텐바이텐 쇼핑몰 (2026-06-10, 탐색적 실행)

satisfied가 구조적으로 가능한 사이트에서의 대조 실행. config 일반화
(`scripts/spike-behavior-sim/sites/*.json`, 산출물 `spike/tenbyten/`).
need: "친구 집들이 선물이 있을지 궁금해서 들어왔다". 13노드 (선물포장
서비스관·베스트·기획전·할인특가·주방식기·상품 2·장바구니=로그인 벽·distractor).
무신사·오늘의집은 헤드리스 차단 — 봇 차단이 그래프 모드의 실전 제약임을 확인.

결과: impatient frustrated 8/10 (median 4) · mid/patient **timeout 20/20**.
satisfied 0. 상품 상세 도달 0.

- **핵심 발견 — indifferent 게이트의 필요성이 더 강하게 실증됨:** 페르소나가
  기획전↔할인특가를 무한 왕복하며 friction 노트에 *"같은 카테고리를 반복적으로
  오가고 있다"*고 **스스로 인지하면서도 leave를 선택하지 않음**. 방문 경로
  요약(trail)은 동일 벽 재클릭은 막지만 2페이지 진동은 못 막음. 스펙 §4.2의
  `interest = ema(novelty)` + §4.3의 indifferent 게이트(`interest < FLOOR and
  stagnant`)가 정확히 이 패턴을 끊기 위한 장치 — 생략했더니 20/30이 timeout.
  **스펙의 해당 설계가 장식이 아니라 필수임을 역방향으로 실증.**
- **그래프 큐레이션 교훈 (커머스 특화):** 커머스의 실제 행동 공간은 메뉴가
  아니라 "목록 → 상품" 링크인데, 13노드 큐레이션이 상품 노드를 2개(그중 1개는
  고아 노드)만 담아 페르소나가 메뉴 순회밖에 할 수 없었음. v1 크롤러는 목록
  페이지의 상품 링크를 노드로 대량 포함하거나 페이지네이션 추상화가 필요.
  또한 홈 피드가 캡처 시점마다 회전(상품 구성 변동) — 쇼핑몰의 재현성 제약.
- friction 노트 품질은 유지: "할인상품만 보여서 원하는 카테고리가 명확하지
  않다"(sale, 13건), "선물포장 서비스 페이지지만 선물 추천 상품이 바로 보이지
  않는다"(gift_recommend) — 모두 실제 화면 상태와 부합.

**v2 (interest 게이트 추가):** timeout 20→5, indifferent 1→17 — §4.3
indifferent 게이트가 진동을 설계대로 끊음 (기계적 검증 통과). 이탈 mode도
archetype별 분화: impatient=frustrated 중심, patient=indifferent 중심.
단 crude 게이트가 trait 무관 균일이라 patient/mid의 이탈 step이 동질화 —
v1 엔진에서는 exploration trait가 INTEREST_FLOOR를 변조해야 함.
`sessions.v2-interest-gate.jsonl`.

**v3 (엣지 버그 수정 + 상품 자동 확장 16노드, 총 32노드):**
capture.ts의 normPath가 query를 버려 모든 상품/기획전 링크가 한 노드로
붕괴되던 버그 수정(KEEP_PARAMS), 목록 페이지 상품 링크 자동 노드화
(auto_expand — v1 크롤러 프로토타입). 결과: **상품 엣지가 생겨도 클릭 0.**
이유가 중요 — 목록 허브(할인특가·베스트)에 실재하는 상품은 문구·클리어런스
잡화로 need(집들이 선물)와 불일치, 선물 적합 상품(브런치 세트 등)은 홈 배너
1개 뒤에만 존재. 페르소나는 "그래프가 준 선택지 안에서는" 합리적으로 행동.
impatient 3명은 홈 팝업 모달 + "집들이 선물 카테고리가 안 보인다"를 이유로
**step 1 자발 bounce** — 현실적 bounce 행동의 emerge.

**v4 (B1 부분 지각 + 위치 태그):** capture가 링크 y좌표를 수집, run이
patience별 가시 범위(1200/1800/2400px)로 엣지를 필터 + "(상단 메뉴)/(첫
화면)/(스크롤 아래)" 위치 태그 병기. 결과:
- **첫 클릭 분산 생성**: 30/30 단일 → **21 기획전 / 6 베스트 / 3 할인특가.**
  랜덤이 아니라 지각 차등에서 emerge — B1 메커니즘 검증.
- **상품 방문 0 → 20/30 세션 (24회).** 목록→상품 행동이 시작됨.
- y좌표의 부수 발견: 머그 기획전 배너는 y=10,319 — 사람도 거기까지 스크롤
  안 함. 부분 지각이 이 배너를 전원에게서 숨긴 것은 버그가 아니라 현실 재현.

**A1 satisfied 단위 테스트 (적합 상품 페이지에서 시작, 9세션,
`sessions.unit-satisfied.jsonl`):** 집들이 선물감 상품(브런치 1인세트)을
정면으로 마주한 상태에서 시작했는데 **9/9 전원이 step 1에 "기획전"으로 이탈**
("다른 것도 둘러봐야겠다") — 비교 쇼핑 자체는 인간적이나, 이후 아무도
돌아오지 않고 어떤 상품에도 "이걸로 결정" 순간 없이 indifferent/timeout 종료.
satisfied 0/9.

**→ 스파이크의 3번째 핵심 실증: LLM은 스스로 만족을 선언하지 않는다.**
frustrated는 LLM 자발 선택 가능(NHIS), indifferent는 외부 게이트 필수(10x10
v1→v2), **satisfied도 외부 게이트 필수** — 스펙 §4.2의 `value_realized ≥
need_threshold → Leave(satisfied)` 항이 바로 그 장치인데 crude 게이트에서
생략했더니 satisfied로 가는 경로 자체가 소멸. 스펙 §4.2/4.3의 leave 3경로
전부가 "LLM 밖 internal-state 게이트 필수"로 수렴 — **스펙 원칙 4의 완전한
실증이자, L4 엔진이 왜 난이도 80%인지의 데이터 근거.**

**v5-v6 (internal-state 엔진 통합 — L4 1·2단계):** 엔진 모듈
`apps/api/src/services/behavior_sim/state.ts` (순수, 5변수 + 4-gate,
방향성 유닛테스트 17개, 전체 스위트 216 통과) 작성 후 run.ts의 crude
게이트를 전면 교체. LLM 출력에 `relevance`(Ch2 value signal) 추가.

- **v5 (relevance 무앵커):** satisfied 0 → **25/30** — 진자 반전. 원인:
  relevance 자기보고의 **기대-획득 혼동** — distractor 캐릭터관 0.70,
  홈 0.62인데 상품 상세 0.18로 역전. "도움될 것 같은 느낌"을 보고함.
  `sessions.v5-engine-rawrel.jsonl`.
- **v6 (attainment 앵커 척도):** 역전은 해소(전 노드 ~0.30로 압축)됐지만
  앵커값 군집 발생 — 목록도 상품도 "0.3=단서" 부근. satisfied 17 중
  상품 미방문 13. 모드 분포 자체는 처음으로 전 스펙트럼:
  impatient frustrated 9 (median 5) · patient satisfied 7+indifferent 3
  (median 7) · mid satisfied 9 (median 7) — trait 순서 유지.
- **결정적 증거 — 게이트 라벨과 발화의 모순:** v6 satisfied 세션의 마지막
  thought가 "기획전에서 선물세트 같은 게 있을 수도", "자세히 보고 싶다" 등
  **계속 탐색 중인 내용** — 게이트는 satisfied로 끊었는데 페르소나의 언어
  상태는 미충족. 0.3 단서 점적 누적이 임계를 넘겨 만든 거짓 만족.
  value_realized 분포도 겹침(satisfied 평균 1.04 / indifferent 0.90 /
  frustrated 0.65). → "게이트 판정 vs 발화 일치율"은 사람 없이 돌릴 수 있는
  엔진 QA 지표 후보.
- **결론 (스파이크 4번째 실증):** relevance를 순수 LLM 자기보고로 두면
  변별력이 없다 — 스펙 §4.2가 원래 지정한 대로 **Ch1 주도**(노드 타입:
  상세 페이지 도달, 가격/구체 정보 노출 등 사실 기반) + Ch2 보조로
  구성해야 함. 스펙 원문 "value_realized += δ·relevance # Ch1 휴리스틱 +
  Ch2"의 설계 의도가 역방향으로 재확인됨. v1 엔진의 relevance 함수는
  Ch1 사실(도달 화면 유형·정보 밀도)을 1차 신호로, Ch2 자기보고를
  보조로. need_threshold와 함께 calibration 대상.

**v7 (Ch1 주도 relevance — 처방 구현):** `relevance_effective =
ch1Factor(상세 1.0 / 목록·메뉴 0.25 / 로그인벽 0) × ch2(내용 일치도만
LLM 자기보고)`. 결과:
- **ch2 변별력 확보**: 진짜 선물감(브런치 세트) ch2 = 0.60~0.70 vs 무관
  문구류 상세 ch2 = 0.24 — 신호가 처음으로 적합/부적합을 가름.
- 메인 30세션 satisfied 0 — **이 그래프에선 정직한 판정** (도달 가능 상품이
  전부 문구/잡화). 거짓 만족(v6) 소멸.
- 단위 테스트(브런치 세트에서 시작): 1회 확인 = +0.33 적립 후 비교 대상을
  찾아 떠남 → 비교할 두 번째 선물감이 그래프에 없어 미충족 종료. 의미론은
  "후보 하나로는 결정 못 함" — need_threshold 1.0(≈강한 확인 2~3회)의
  타당성 자체가 calibration 질문으로 남음.
- timeout 재증가(14/30)는 엔진 결함이 아니라 **세션 캡 artifact** — 32노드
  그래프에서 novelty가 8 step 안에 고갈되지 않아 interest가 유지됨. 실제
  엔진의 MAX_STEPS 20+에서는 indifferent로 수렴할 것.
- **v4→v7 진자 기록**: satisfied 0(경로 없음) → 25(기대 인플레) → 17(거짓
  만족) → 0(정직). 남은 노브(need_threshold, ch1 계수, δ)는 전부 사람
  기준 필요 — **여기가 사람 데이터 없이 갈 수 있는 한계선.**

**텐바이텐 아크의 최종 교훈 (H3 커버리지 천장의 구체적 메커니즘):**
커머스에서 사람이 실제로 쓰는 핵심 affordance — **검색창, 카테고리
메가메뉴(hover)** — 가 정확히 정적 링크 스크랩이 못 담는 요소다. 그래프는
배너·클리어런스만 제공하고, 현실적 선물 탐색 경로(카테고리 드릴다운 /
"집들이 선물" 검색)는 구조적으로 부재. satisfied 생성 능력은 **이 그래프
한계 때문에 미판정** — 시뮬의 결함 증거가 아님. v1 크롤러 요구사항:
메가메뉴 전개 캡처 + 검색 결과 노드(대표 키워드 N개 사전 실행) 또는
H3 판정에서 커머스를 "부분 커버" 카테고리로 명시.

## 8. 산출물

1. `spike/graph.json` + 스크린샷 — v1 크롤러의 fixture로 재사용
2. 사람 세션 기록 5건 (template 기반) — L4 ground truth 자산으로 보존
3. 시뮬 세션 JSONL 30건 + friction 매칭 테이블
4. **판정 리포트** — 가설별 PASS/FAIL + §5.3 분기 결정. 이 문서에 결과 섹션으로 추가 (별도 문서 생성 안 함)
