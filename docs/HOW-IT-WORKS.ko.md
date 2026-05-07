# Audience-Fit Validator 동작 방식

스캔 파이프라인에 대한 코드 기반 설명서: 사용자가 **Analyze**를 클릭했을
때 무엇이 실행되는지, 어느 단계에서 어떤 LLM 호출이 일어나는지, 각
페르소나의 응답이 어떻게 숫자로 변환되는지, 그리고 그 집계가 왜 신뢰할
수 있는 audience-fit 점수를 만드는지 설명합니다.

아래 모든 주장은 구현된 파일과 줄 번호를 인용하므로 독자가 직접 소스
코드와 대조 검증할 수 있습니다. 소스의 주석이 실제 코드와 충돌하거나,
독자가 알아두어야 할 알려진 한계가 있는 부분은 **⚠️**로 표시했습니다.

> **감사일:** 2026-05-07. 이 시점 테스트 스위트: 199개 vitest 케이스 통과.

> 이 문서의 영문 원본: [`docs/HOW-IT-WORKS.md`](./HOW-IT-WORKS.md)

---

## 1. 한 문단 요약

스캔은 URL을 받아 페이지를 한 번 캡쳐하고, ~100명의 시뮬레이트된
페르소나(Mode A) 또는 ~50명의 audience-매칭된 페르소나(Mode B)에게
그 스크린샷에 대한 반응을 받아서 0-100 사이의 **audience-fit
score**와 진단 컨텍스트(코호트별 분석, friction 클러스터, 방문자
트래픽 가중 projection, AARRR 퍼널)를 산출합니다. 페르소나는
브라우징하지 않습니다 — 단일 스크린샷에 반응할 뿐입니다. 실제
사용자는 루프에 없고, 신뢰 계약(trust contract)은 개별 페르소나의
예측이 아닌 **코호트 집계 신호**에 기반합니다.

---

## 2. 파이프라인 한눈에 보기

`POST /api/scan`은 즉시 `{ scanId, status: 'pending' }`을 응답하고
fire-and-forget 워커를 시작합니다. 워커는 `audience_fit_scans` 행에
status를 5단계로 갱신하며 스캔을 진행합니다.

```
POST /api/scan
   → routes/scan.ts:54-91   audience_fit_scans INSERT (status=pending)
                            startScanWorker(scan.id)
                            res.json({ scanId, status })
   ↓
startScanWorker
   → scan_pipeline.ts:130-144   setImmediate(runScan)
                                catch → status='failed'
   ↓
runScan(scanId)                 scan_pipeline.ts:147+
   ├─ Step 0  capturing       captureSite() + classifySite()
   │                          → audience_fit_scans.{captureScreenshotUrls,
   │                            category, categoryConfidence, oneLinePitch}
   ├─ Step 1  sampling        활성 페르소나 로드
   │                          → Mode A: selectPersonasForCohorts (8 코호트)
   │                          → Mode B: parseAudience + selectPersonasForAudience
   ├─ Step 2  responding      runPersonaResponseLLM() per persona
   │                          (concurrency=5 기본)
   │                          → scan_persona_responses INSERT
   ├─ Step 3  aggregating     코호트별 persistCohortAggregate
   │                          computeAudienceFit(cohorts)
   │                          → scan_cohort_results INSERT
   ├─ Step 3.5  friction      clusterFrictions(scanId)
   │             clustering   → audience_fit_scans.frictionsJson
   └─ Step 4  completed       audience_fit_scans UPDATE
                              status, audienceFitScore, best/worst, ...
```

출처: 각 step의 구현은 모두 `apps/api/src/services/scan_pipeline.ts`와
그 헬퍼 import에 있습니다.

각 전환 시점에 `setStatus(scanId, …)`가 status 컬럼을 갱신하므로
`/api/scan/:id/report` 폴링 엔드포인트가 진행 상태를 UI에 실시간으로
노출할 수 있습니다.

---

## 3. LLM 호출 카탈로그

전체 파이프라인에서 LLM 호출 사이트는 4곳입니다. 모두
`services/anthropic_client.ts::withRoute(label, …)` 를 통하므로
사용량 로그가 호출 목적별로 태깅됩니다. 태그는 `CLAUDE.md`의 "LLM
Usage Tracking" 섹션에 문서화되어 있습니다.

| # | Route tag | Model | When | Cost / call | Source |
|---|---|---|---|---|---|
| 1 | `validator.classify_site` | Haiku (vision) | 캡쳐 후 스캔당 1회 | ~$0.0008 | `services/site_classifier.ts:115-128` |
| 2 | `validator.parse_audience` | Haiku (text) | Mode B에서만 스캔당 1회 | ~$0.0005 | `services/dimensions/audience_parser.ts` |
| 3 | `validator.persona_response` | `USE_VISION=1`이면 Sonnet (vision), 아니면 Haiku (text) | 페르소나당 1회 | Sonnet ~$0.01-0.05 / Haiku ~$0.001 | `services/dimensions/llm.ts:343-399` |
| 4 | `validator.cluster_frictions` | Haiku (text) | 응답 수집 후 스캔당 1회 | ~$0.003 | `services/dimensions/frictions.ts:184-194` |

모델 식별자는 `apps/api/src/config/env.ts:69-70`에서 env var + 기본값
으로 결정됩니다:

```
CLAUDE_SONNET_MODEL  default  claude-sonnet-4-6
CLAUDE_HAIKU_MODEL   default  claude-haiku-4-5-20251001
```

`services/llm.ts:137-140`에서 `SCORING_MODELS = { sonnet, haiku }`로
재내보냅니다.

기본 설정 (USE_VISION=0, ~112명, Mode A) 스캔당 비용:
**≈ $0.11-0.15**, 대부분 112회의 페르소나 호출이 차지합니다.
`USE_VISION=1` (Sonnet vision)이면 스캔당 비용은 스크린샷 크기와
응답 길이에 따라 **≈ $1.20-5.60**까지 올라갑니다.

---

## 4. 페르소나 응답: 입력/출력 계약

전체 파이프라인에서 가장 중요한 LLM 호출입니다. Mode A 스캔당
~112회, Mode B 스캔당 ~50회 실행되며, 다운스트림의 모든 수학적
계산은 이 호출의 출력에만 의존합니다. 출처:
`services/dimensions/llm.ts`.

### 4.1 페르소나가 보는 입력

`buildUserPrompt` (llm.ts:187-247)는 최대 4개 섹션의 텍스트
프롬프트를 만듭니다:

```
Target URL: <url>

Site context (third-party classification — read this BEFORE forming an opinion):
  category: <Category> (confidence: <0.0-1.0>)
  description: <classifySite의 one-line pitch>
  Anchor your reaction to THIS category. Do not project features
  (wallet, signing, on-chain UX, etc.) that this category does not include.

Persona profile:
  voice_sample: "<PersonaVector의 sample 문장>"
  age_group: <teen|young_adult|adult|senior>
  tech_literacy: 0.00-1.00
  crypto_experience: 0.00-1.00
  design_sensitivity: 0.00-1.00
  patience_level: 0.00-1.00
  mobile_first: <bool>
  visual_style_pref: <minimal|rich|playful|professional>
  expertise.{defi,nft,general_web}: 0.00-1.00
  feedback.{security_aware,ui_critical,detail_oriented}: 0.00-1.00

Company hypothesis to probe: "<선택적 hypothesis 텍스트>"

Respond with EXACTLY this JSON shape (replace every example value):
<SCHEMA_TEMPLATE JSON>

RULES:
  ...
```

`USE_VISION=1`이고 capture 단계에서 스크린샷 URL이 만들어졌다면,
user message는 `[image_block, …, text_block]` 형태로 빌드되고
모델도 Sonnet으로 전환됩니다 (`llm.ts:354-377`).

### 4.2 시스템 프롬프트 — engagement 정직성

시스템 프롬프트 (`llm.ts:98-117`)는 페르소나-사이트 적합도가
약할 때 모델이 명시적으로 `engagement.category=abandon`을
선택하도록 강제하며, 참조 분포를 제공합니다:

> Reference distribution across all visitors (engagement.category):
> abandon ~50%   skim ~25%   browse ~17%   engage ~5%   extended ~3%

이 지시문이 부재하면 모든 페르소나가 "browse"로 수렴해서 audience
신호 자체가 사라집니다. 5개 band → 점수 매핑은
`services/audience_fit.ts:47-53`에 있습니다:

```ts
abandon=10, skim=30, browse=55, engage=75, extended=90
```

### 4.3 출력 스키마 (Zod)

전체 JSON 스키마는 `llm.ts:42-79`에서 락되어 있습니다:

```
happiness: { sus_responses: number[10], raw_score 0-100, voice_first_impression }
engagement: { category: 5-enum, interaction_depth_estimate 0-50, abandon_likely_at, voice_friction }
adoption: { signup_likelihood 0-1, primary_barrier, trigger_to_signup }
retention: { category: 4-enum, expected_return_window: 4-enum, return_motivation_text }
task_success: { core_action_understood, completion_likelihood 0-1, blocking_friction, voice_attempt }
voice_quotes: { biggest_friction, would_return_because, if_could_change_one_thing }
self_consistency_check: { happiness_retention_aligned: bool, alignment_note }
```

스키마 불일치 → Zod throw → `runPersonaAndPersist`가 행을
`isFlagged=true`로 기록하고 스캔을 죽이지 않습니다
(`scan_pipeline.ts:720-744`). 이게 *anti-fabrication* 락입니다:
잘못된 JSON을 반환한 페르소나는 코호트 평균에서 제외되지, 0으로
조용히 카운트되지 않습니다.

### 4.4 LLM 출력 → 5개 dimension 점수 매핑

`mapLLMResponseToSimulated` (llm.ts:250-296)이 LLM JSON을 집계
가능한 숫자로 변환합니다. 5개 점수, 모두 0-100:

| Dimension | Source field | Formula |
|---|---|---|
| `happiness` | `happiness.sus_responses` (10 Likert) | `computeSusScore()` — 정통 SUS-10: 홀수 위치 → `r-1`, 짝수 위치 → `5-r`, 합 × 2.5 (`audience_fit.ts:82-96`) |
| `engagement` | `engagement.category` | band → score lookup (audience_fit.ts:47-53) |
| `adoption` | `adoption.signup_likelihood` | × 100 |
| `retention_d7` | `retention.category` | band → D-curve, `d7` 필드 (audience_fit.ts:60-70) |
| `task_success` | `task_success.completion_likelihood` | × 100 |

`engagement.category=abandon`일 때 적용되는 두 개의
**defense-in-depth 클램프** (llm.ts:265-269):
- `signup_likelihood` ≤ 0.05 (5% 캡 — abandoner는 회원가입 안 함)
- `completion_likelihood` ≤ 0.05 (5% 캡 — abandoner는 task 완료 안 함)
- `retention_band` 강제 `no_return`

이 클램프는 Haiku가 가끔 "abandoned but would sign up" 같은
모순된 응답을 emit하기 때문에 존재합니다. post-hoc 클램핑으로
모델이 시스템 프롬프트를 따르지 않더라도 코호트 수학이 일관성을
유지합니다.

`is_flagged`는 `self_consistency_check.happiness_retention_aligned`
가 false일 때, 즉 `happiness > 70 AND retention=no_return` (또는 그
역)일 때 설정됩니다. Flagged 행은 **코호트 평균에서 제외**됩니다
(`scan_pipeline.ts:812`).

---

## 5. 코호트 선택 (sampling 단계)

`apps/api/src/services/cohort_selection.ts`는 순수 함수입니다:
활성 페르소나 풀과 `CohortDef` 리스트를 받아 각 페르소나가 **최대
하나의** 코호트에만 할당된 `Map<cohort_id, PersonaRow[]>`를 산출합니다.

### 5.1 왜 페르소나당 정확히 하나의 코호트?

30대 mobile-first DeFi 전문가는 `crypto_native` 셀렉터와
`mobile_power` 셀렉터 양쪽을 모두 만족합니다. 같은 페르소나가 두
코호트 평균에 동시에 포함되면, 두 평균이 같은 개인의 상관된
artefact가 되지 두 audience의 독립적 측정이 아니게 됩니다. 출처
주석: `cohort_selection.ts:1-12`.

### 5.2 할당 알고리즘

`selectPersonasForCohorts` (cohort_selection.ts:103-146)는 quota를
지키는 closest-fit 할당입니다:

1. `vector.reliability.quality_score` 내림차순으로 페르소나 정렬
   (가장 품질 좋은 페르소나가 먼저 자기 코호트 claim).
2. 각 페르소나에 대해: `matchesSelector` (axis별 range/categorical
   체크)로 매칭되는 코호트들을 찾고, `distanceToSelector`로 selector
   midpoint와의 L2 거리로 정렬.
3. 후보 코호트들을 순회하며 아직 `target_n` (기본 14)에 도달하지
   않은 첫 코호트에 배정. 매칭 코호트가 모두 풀이면 `unassigned`로 떨어짐.

매칭 axes (cohort_selection.ts:43-57): `tech_literacy`,
`crypto_experience`, `design_sensitivity`, `patience_level`,
`expertise_defi`, `expertise_nft`, `expertise_general_web`,
`ui_critical`, `security_aware`, `detail_oriented`, 그리고 categorical
`age_group`과 `mobile_first`.

### 5.3 Mode B: 점진적 완화

`selectPersonasForAudience` (cohort_selection.ts:174-210)은 Mode B
경로입니다. 파싱된 `CohortSelector`와 `targetN=50`을 받아:

- 모든 페르소나에서 strict-match → 매칭 수가 `minN=10` 미만이면
  **가장 좁은** numeric range 제약(`hi - lo`가 가장 작은 것) 하나를
  drop하고 재매칭. ≥ `minN`이 될 때까지 반복.
- `age_group`과 `mobile_first`는 절대 완화하지 않음 (categorical;
  사용자가 명시적으로 지정한 것).
- L2 거리로 정렬, `quality_score`로 tie-break, 상위 `targetN`개 추출.

이 알고리즘은 verbatim 파싱된 audience가 너무 좁아도 Mode B가 항상
어느 정도의 페르소나 풀을 만들어내도록 보장합니다.

---

## 6. 코호트 집계: dimension 평균 → cohort_fit_score

모든 per-persona LLM 호출이 끝난 후, 각 코호트의 valid (non-flagged)
`PersonaDimensionScores` 행 묶음이 `audience_fit.ts:145-153`을 통해
하나의 숫자로 환원됩니다:

```
cohort_fit_score = engagement   × 0.30
                 + task_success × 0.30
                 + happiness    × 0.25
                 + adoption     × 0.10
                 + retention_d7 × 0.05
```

(가중치 출처: `DIMENSION_WEIGHTS_V1`, `audience_fit.ts:30-36`.)

### 왜 이 가중치인가

출처 주석 (`audience_fit.ts:25-29`): 스펙 §4.2의 confidence rating이
순서를 결정했습니다. **engagement와 task_success는 페르소나 시뮬레이션
문헌에서 가장 측정 신뢰도가 높음** (intent ≈ action 상관이 합리적),
그래서 각각 0.30. **SUS 기반 happiness**는 usability 신호로
잘 검증되어 있어 0.25. **Adoption (가입 의향)**은 측정 가능하지만
실제 conversion 대비 신호가 떨어짐 → 0.10. **Retention은 페르소나
시뮬레이션에서 calibration이 약함** (calibration 시점 r=0.18, 주석
참조), 그래서 0.05에 머물러 있음 — 향후 calibration용으로 데이터는
수집되지만 점수를 끌고 가지는 않습니다.

### Bootstrap CI

각 `cohort_fit_score`는 per-persona 점수를 1000회 비복원 샘플링하여
[2.5%, 97.5%] 백분위수에서 95% 신뢰 구간을 계산합니다
(`audience_fit.ts:164-194`). n<3이면 CI는 점 추정치로 무너짐 (작은
샘플에서 통계적 CI는 무의미). `scan_cohort_results.cohort_fit_ci_low/high`
에 저장됩니다.

---

## 7. 최상위 audience-fit 합성 (Option A)

`computeAudienceFit` (`audience_fit.ts:221-261`)이 코호트별 fit을
받아 헤드라인 0-100 숫자를 산출합니다:

```
audience_fit_score =
    0.40 × best_cohort_fit_score
  + 0.30 × median_cohort_fit_score
  + 0.20 × global_task_success_avg
  + 0.10 × global_sentiment_avg
```

(가중치: `audience_fit.ts:39-44`.)

`global_task_success_avg`와 `global_sentiment_avg`는 모든 코호트
간의 dimension에 대한 **n-completed-가중** 평균입니다
(audience_fit.ts:234-244). 이게 quota 미달 코호트(예: 3명만 매칭된
코호트)가 글로벌 평균을 dominant하지 못하게 막습니다.

### 왜 "best + median"이고 "전체 코호트 평균"이 아닌가

출처 주석 (`audience_fit.ts:1-23`): 스펙의 이전 "PMF Survival Score"
공식에는 세 가지 구조적 결함이 있었습니다:
1. **cohort_diversity 페널티** — niche-PMF wins를 penalize했음
   (한 audience에 강하게 resonate하고 나머지 7개에 무시되는
   제품이, 8개 모두에서 평균적인 50점 받는 제품보다 점수가 *낮게*
   나오면 안 됨).
2. **retention 0.20 가중** — §4.2의 "Very Low" confidence rating과
   모순.
3. **task_success 0.10 가중** — §4.2의 "High" confidence rating과
   모순.

0.40-best-cohort 가중치는 validator가 "코호트 X와는 강한 fit, 나머지는
약함"이라고 정직하게 말하게 해줍니다. 0.30-median-cohort 항은 단일
best-cohort outlier가 점수를 dominant하지 못하게 함 — 높은 점수를
받으려면 강한 best와 무너지지 않는 분포의 중간값이 *둘 다* 필요합니다.

---

## 8. 방문자 view — 왜 view가 두 개인가

위의 *research panel* view 외에, report는 *visitor-weighted* view도
계산합니다 (`audience_fit.ts:302-379`, `aarrr.ts:173-314`).

### 무엇을 측정하는가

Panel view: "8개 코호트 각각에서 N명의 페르소나가 이 사이트와
engage하면 그 집계 fit은?" — persona-conditional.

Visitor view: "실제 방문자 트래픽이 이 사이트에 들어왔을 때 몇 %가
activate / retain / convert할까?" — projection.

### 어떻게

각 코호트에 대해 visitor view는
`packages/shared/src/acquisition_priors.ts`의 두 prior를 적용합니다:

```
arrival_share : 일반적인 사이트 트래픽 중 이 코호트의 비율
                (카테고리당 8개 코호트 합 = 1.0)
abandon_rate  : 첫 15초 내 이탈 비율
```

`applyAcquisitionWeights` (`audience_fit.ts:302-326`)는 weighted
dimension 평균을 `engaged_dim × (1 - abandon_rate)`로 계산 —
abandoner는 모든 dimension에 0을 contribute합니다. 글로벌 집계는
`n_completed` 대신 `arrival_share` 가중을 사용합니다.

### 왜 AARRR visitor 퍼널은 추가 INTENT_ACTION 곱셈자를 쓰는가

페르소나는 의도(intent)를 예측("나라면 가입할까?"), 실제 퍼널은
행동(action)을 측정("실제로 가입했는가?"). intent-action 갭은
consumer research에서 잘 알려진 현상이며 단계가 깊어질수록 커집니다.
출처 주석 (`aarrr.ts:240-248`):

```ts
const INTENT_ACTION = {
  activation: 0.50,
  retention: 0.20,
  referral: 0.10,
  revenue: 0.05,
} as const;
```

이 값들은 **Google Merchandise Store GA4 (n=1)에 대해
calibrate**되었습니다.

> ⚠️ **알려진 한계 1** — universal 곱셈자는 사이트 간 차이를
> 압축합니다. 2026-05-07의 5-사이트 테스트에서 visitor view의
> Activation 스프레드는 13pt, Revenue 스프레드는 1.3pt에 불과했음
> (E-commerce / Productivity / Media / AI / DeFi 5개 매우 다른
> 카테고리에서). 상수가 공식을 dominant하기 때문. 같은 5개 사이트의
> panel view 스프레드는 52pt (Activation), 46pt (Revenue) — 상수가
> 압축하지 않으면 사이트 차이가 명확하게 보존됨. CLAUDE.md
> "Known Limitations §2 — INTENT_ACTION multipliers are universal"
> 참조.

### 왜 visitor view를 *experimental — directional only*로 라벨링하는가

Validator UI는 visitor 토글을 `"experimental — directional only,
not a traffic forecast"`로 라벨링하고, 절대 % 대신 가장 큰
stage-to-stage drop을 호출하는 `"BIGGEST LEAK"` callout을 앞세웁니다.
출처: report 페이지 토글
`apps/web/app/validator/report/[scanId]/page.tsx:200-203` 및 동일
파일의 AARRR funnel block 헬퍼. 절대 weighted 숫자가 universal 상수를
per-카테고리 곱셈자로 교체하기 전에는 실제 GA4 reality를 5-30×
overshoot하기 때문에 이 framing이 필요합니다.

---

## 9. AARRR 퍼널 (panel view = 진짜 의미론)

Panel-view AARRR funnel이 두 view 중 더 단순하고 의미론이 가장
명확합니다. 출처: `services/aarrr.ts:71-133`.

### 9.1 Cumulative 필터링

```
acqSet         = valid (non-flagged) 페르소나
activationSet  = acqSet         where task_success ≥ 30
retentionSet   = activationSet  where retention_d7 ≥ 5
referralSet    = retentionSet   where happiness ≥ 60
revenueSet     = referralSet    where adoption ≥ 30
```

각 단계는 이전 단계 집합의 **부분집합** — 그게 funnel의 의미론적
정의(monotonic non-increasing)입니다. 독립적 필터는 Referral >
Activation 같은 비논리적 모양을 만들 수 있는데, 이전 구현이 실제로
그렇게 동작했음 (출처 주석, `aarrr.ts:78-82`).

### 9.2 왜 이 특정 임계값들

출처 주석 (`aarrr.ts:50-58`): v1.1 retune (2026-05-06):
- **Retention 30 → 5**: 관측된 페르소나 분포의 ~85%가 `weak`
  band (D7=5)에 위치, `moderate` (≥30)는 ~3%에 불과. 이전의
  `≥30` 게이트는 activation 이후 funnel을 죽임. `≥5` = "어떤
  return signal이라도 있음", `no_return` (D7=0)은 여전히 제외.
- **Revenue 65 → 30**: 관측된 adoption은 대부분 0-50; `≥65`는
  도달 불가. `≥30` = "유의미한 구매 의향", funnel을 떨어뜨릴 만큼
  여전히 strict.

> ⚠️ **소스 코드 내부의 stale doc** — `aarrr.ts:11-13`의 파일
> 헤더 주석이 여전히 *옛날* 임계값을 명시:
>
> ```
>   Retention    — Returns by D-7. Adds: retention_d7 >= 30.
>   Revenue      — Conversion likely. Adds: adoption >= 65.
> ```
>
> 실제 코드 (`aarrr.ts:85, 87`)와 `THRESHOLDS` 상수
> (`aarrr.ts:42-48`)는 5와 30을 사용. retune 노트
> (`aarrr.ts:50-58`)에 변경 내역이 문서화되어 있지만 파일 헤더는
> 업데이트가 안 됨. 이 문서 독자: 파일 헤더가 아닌 `THRESHOLDS`
> 상수 + 단계별 필터 식을 신뢰하세요.

---

## 10. Friction 클러스터링

모든 응답이 수집된 후, `clusterFrictions(scanId)`
(`services/dimensions/frictions.ts:145-216`)가 스캔당 한 번의 Haiku
호출로 전체 `voice_biggest_friction` 문자열 셋을 3-5개 themed cluster
로 그룹화합니다.

### 파이프라인

1. `scan_persona_responses`에서 비어있지 않은
   `voice_biggest_friction` 문자열 SELECT (frictions.ts:146-160).
2. `[i] (cohort=X) "<quote>"` 형식의 numbered list를 만들고 Haiku에게
   3-5개 cluster object의 EXACT JSON array를 요청 — 각 cluster는
   `title`, `summary`, `where`, `representative_quote`,
   `persona_indices` 필드. 시스템 + 룰: frictions.ts:171, 134-143.
3. `assembleFrictionClusters` (frictions.ts:55-111)가 LLM 출력을 받아:
   - cluster를 `n` 내림차순 정렬,
   - top 5에서 cap,
   - **LLM이 할당하지 않은 모든 페르소나 인덱스**를 "Other / long-tail"
     bucket에 모아 append,
   - 순차적 `rank` 번호 부여,
   - `impact = +Math.round(n / total × 30)`을 fit-cost 추정 문자열로
     계산.

### 왜 long-tail bucket이 중요한가

출처 주석 (`frictions.ts:48-54`): 불변량은 `Σ cluster.n + long_tail.n
=== items.length`. long-tail append가 없으면 LLM 클러스터러가 깔끔하게
themed화 못한 friction 입력 5-10%를 silently drop함. long-tail bucket
이 모든 friction이 report에 정확히 한 번씩 나타나도록 강제합니다.

long-tail 카드에 노출되는 "첫 quote"는 입력 리스트에서 가장 먼저
인덱싱된 미할당 입력 — 이게 2026-05-07 Google Merch 케이스에서
한국어 long-tail 버킷이 등장한 이유입니다: 한국어 표현이 영어들과
클러스터되지 못하고 long-tail로 떨어진 후 첫 번째로 표시됨.
CLAUDE.md "Audience-Fit Validator §" + 2026-05-07 hardening commit들
에서 진단 전체 스토리를 참조.

---

## 11. 아키텍처가 방어 가능한 이유

합성 사용자 리서치 제품의 흔한 실패 모드를 막아주는 5개 설계 결정:

1. **Voice cleanup (Q3 P1, 2026-05-07).** `crypto_native` /
   `web3_pro` / `defi_beginner` voice sample을 *trait*만 표현하는
   카테고리 중립적 톤으로 재작성 (security_aware, fast-mover,
   power-user 트레이트는 유지하되 crypto-specific 어휘는 제거).
   Voice는 LLM이 가장 강하게 학습하는 톤 신호이므로, 크립토 페르소나가
   Spotify를 보면서 "MEV / slippage / wallet" 불만을 패러팅하지
   않게 됨. Lock: `scripts/seed-validator-cohorts.ts:75-118`,
   regression test: `apps/api/src/__tests__/dimension_llm.test.ts`.

2. **Site context 전달 (Q2, 2026-05-07).** `runPersonaResponseLLM`이
   `SiteContext { category, categoryConfidence, oneLinePitch }`를 받고
   프롬프트에 `"Anchor your reaction to THIS category. Do not project
   features (wallet, signing, on-chain UX, etc.) that this category
   does not include."`를 포함 (llm.ts:213-220). 크립토 편향 페르소나
   가 일반 e-commerce 페이지에서 wallet-connect friction을 환각하는
   것을 차단. 출처 진단: 2026-05-07 hardening commit들.

3. **Empty-screenshot 방어.** `classifySite`와 persona response가
   누락/읽기 불가 이미지를 우아하게 처리:
   - `classifySite`는 어떤 실패에도 null 반환 → 호출자는 기존 null
     유지 (`site_classifier.ts:98-106, 130-135`).
   - `buildImageBlocks`는 못 읽는 로컬 파일을 skip; 최종 array가
     비면 persona LLM이 text-only Haiku로 fallback (llm.ts:321-360).

4. **Self-consistency 플래그.** 각 persona LLM 응답이
   `self_consistency_check.happiness_retention_aligned` boolean을
   carry. false일 때 (happiness>70 AND retention=no_return, 또는 그
   역) 행이 `isFlagged=true`로 마킹되고 **코호트 평균에서 제외**됨
   (`scan_pipeline.ts:801-812`). persona-level 논리 모순이
   cohort-level 숫자를 오염시키지 않습니다.

5. **cohort_fit_score 위의 Bootstrap CI.** 각 코호트 row가 per-persona
   점수에 대한 1000-sample bootstrap으로 95% CI를 carry. report는
   point estimate 옆에 CI를 surface해서 작은 샘플 (n<14)이 자신감
   있는 숫자가 아닌 wide bar로 읽히게 함 (`audience_fit.ts:164-194`,
   `scan_cohort_results.cohort_fit_ci_low/high`).

---

## 12. 이 문서를 쓰면서 발견한 문제점

소스 코드와 (자체 주석 또는 sibling 문서) 사이의 불일치들. 어느 것도
런타임 버그는 아니지만, 다음 reader가 stale 텍스트를 신뢰하면 혼란이
생깁니다. 마찰이 가장 큰 순서로 정렬:

1. **⚠️ aarrr.ts 파일 헤더 주석이 잘못된 임계값을 명시.**
   라인 11-13은 `retention_d7 >= 30`과 `adoption >= 65`라고 적어
   놓았는데, 실제 필터 식 (라인 85, 87)과 `THRESHOLDS` 상수 (라인
   42-48)는 v1.1 retune (라인 50-58 문서화)대로 `≥ 5`와 `≥ 30`을
   사용. 헤더 텍스트가 업데이트 안 됨.
   *Fix*: 라인 11-13을 삭제하거나 `THRESHOLDS`와 일치하도록 재작성.

2. **⚠️ `lib/api.ts`에 dead client method들.** validator pivot이
   autotest API surface (`/api/test/*`, `/api/report/*`,
   `/api/tester/*`)를 삭제했지만 `apps/web/lib/api.ts`는 여전히
   `testApi`, `reportApi`, `personaApi`, `testerApi`, `autoTestApi`,
   `dashboardApi`를 export. 활성 validator 페이지들은 `scanApi`만
   호출. legacy 클라이언트들은 CLAUDE.md 라인 100 (Frontend
   conventions block)에 문서화되어 있음 — 그 라인은 정직 (export는
   *존재함*) 하지만 method들 자체는 dead code: 호출하면 404. *Fix*:
   다음 refactor pass에서 unused export + `signedRequest` 배관을
   제거, OR "preserved for future use" 코멘트로 명시적 게이팅.

3. **⚠️ Wallet-signed nonce middleware에 살아있는 consumer 없음.**
   `apps/api/src/middleware/auth.ts::requireSignedRequest` 와
   ed25519 verification flow가 존재 (CLAUDE.md "Auth (Privy +
   middleware)" 섹션이 보존을 확인). 하지만 5개 활성 라우트
   (`/api/auth`, `/api/scan`, `/api/calibration`, `/api/benchmark`,
   `/api/hello`) 모두 `requirePrivyAuth` / `optionalPrivyAuth`를
   사용 — `requireSignedRequest`를 쓰는 라우트는 하나도 없음. 미래의
   signed-mutation 라우트가 land할 때까지 effective dead.

4. **✅ persona-engine ghost — 2026-05-07 해결.** 565 MB
   `apps/persona-engine/` 디렉토리 + `packages/persona-client/` +
   관련 env vars (`USE_PERSONA_ENGINE`, `PERSONA_ENGINE_URL`,
   `PERSONA_ENGINE_AUTH_TOKEN`) + stale 문서들
   (`docs/persona-engine-integration-gaps.md`, `INTEGRATION.md`)
   이 모두 Step B 정리 패스에서 제거됨. validator 파이프라인은
   이제 self-contained: Anthropic SDK 직접 호출 (Sonnet vision /
   Haiku text), 외부 서비스 없음. CLAUDE.md Architecture 섹션도
   정리 반영.

5. **⚠️ INTENT_ACTION 곱셈자가 universal (Merch n=1 calibration).**
   CLAUDE.md "Known Limitations §2"에 이미 문서화됨. 곱셈자가
   visitor view 사이트 차이를 Merch의 calibration target 쪽으로
   압축, 그래서 visitor 토글이 experimental로 라벨링됨. per-카테고리
   GA4 reference data가 land할 때까지 (Known Limitations §3) panel
   view가 신뢰할 수 있는 비교 surface입니다.

6. **⚠️ `services/dimensions/audience_parser.ts`가 위에서 깊게
   문서화 안 됨.** Mode B의 페르소나 풀 선택이 이 LLM-파싱된
   selector에 의존; 이 문서 목적상 자연어 audience 설명을
   `CohortSelector` object로 매핑하는 Haiku 호출로 취급. 자세한
   walkthrough는 deferred — Mode B가 primary surface 될 때 자체
   문서를 받아야 함.

---

## 13. 여기서 코드를 읽기 시작할 곳

| 무엇을 이해하고 싶은가 | 시작점 |
|---|---|
| 전체 파이프라인 | `apps/api/src/services/scan_pipeline.ts` |
| Persona 프롬프트 + 응답 shape | `apps/api/src/services/dimensions/llm.ts` |
| 코호트 수학 + Option A 공식 | `apps/api/src/services/audience_fit.ts` |
| AARRR funnel 룰 | `apps/api/src/services/aarrr.ts` |
| 코호트 할당 알고리즘 | `apps/api/src/services/cohort_selection.ts` |
| Friction 클러스터링 | `apps/api/src/services/dimensions/frictions.ts` |
| Site classifier 프롬프트 | `apps/api/src/services/site_classifier.ts` |
| 코호트 정의 | `packages/shared/src/cohorts.ts` |
| Acquisition priors (visitor view) | `packages/shared/src/acquisition_priors.ts` |
| Test contracts / regression locks | `apps/api/src/__tests__/` |
| Open follow-ups + Do-NOTs | `CLAUDE.md` (repo root) |
