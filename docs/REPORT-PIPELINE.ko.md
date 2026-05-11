# 리포트 생성 파이프라인 — 단계별 데이터 흐름

`POST /api/scan` 호출부터 리포트 페이지가 렌더되기까지 전 단계 walkthrough. **어떤 데이터가 입력되어 어떤 처리를 거쳐 어떤 결과로 다음 단계에 전달되는지** 코드 기준으로 추적.

> **현재 시점 기준**: 2026-05-11. 영문 정본: [`REPORT-PIPELINE.md`](REPORT-PIPELINE.md). 컴패니언 문서로 [`HOW-IT-WORKS.ko.md`](HOW-IT-WORKS.ko.md) (주제별 deep-dive) + [`CLAUDE.md`](../CLAUDE.md) (운영 가이드 + Do-NOT) 참조. 이 문서는 chronological pipeline trace 관점에 초점.

---

## 0. 트리거

**유저 액션**: `POST /api/scan { target_url, mode, hypothesis?, target_cohorts? }`

| 항목 | 내용 |
|---|---|
| 라우트 | `apps/api/src/routes/scan.ts:55-91` |
| 처리 | `INSERT audience_fit_scans (status='pending')` → `startScanWorker(scan.id)` fire-and-forget 백그라운드 워커 시작 |
| 즉시 응답 | `{ scanId, status: 'pending' }` (워커는 별도 비동기 실행) |
| 워커 진입점 | `services/scan_pipeline.ts::runScan(scanId)` |

**DB 상태 전이**: `pending → capturing → sampling → responding → aggregating → completed`

각 전이 시점에 `setStatus()`가 행을 업데이트하고, UI는 `/api/scan/:id/report`를 800ms 폴링하며 진행 상태를 표시.

---

## Step 0: capturing (스크린샷 + 분류 + 사이트별 질문)

### 0.a — Playwright 캡처

| | |
|---|---|
| 코드 | `services/site_capture.ts::captureSite()` |
| Input | `target_url` |
| 처리 | 헤드리스 Chromium으로 사이트 로드 후 (i) full-page PNG, (ii) viewport-crop PNG 2장 캡처. R2에 업로드 (또는 dev면 `/tmp/site-captures/`에 저장) |
| Output | `string[2]` URLs → `audience_fit_scans.captureScreenshotUrls` (jsonb) |
| 비용/시간 | ~$0 + 5-10초 |

### 0.b — 사이트 분류 (Haiku 비전)

| | |
|---|---|
| 코드 | `services/site_classifier.ts::classifySite()` |
| Input | viewport-crop PNG + URL |
| 처리 | `withRoute('validator.classify_site', ...)` 로 Claude **Haiku 4.5 vision** 1회 호출. Zod 스키마로 응답 검증 |
| Output | `{ category, category_confidence, one_line_pitch }` → `audience_fit_scans.{category, categoryConfidence, oneLinePitch}` |

예시 결과:
```json
{ "category": "Productivity",
  "category_confidence": 0.92,
  "one_line_pitch": "The product development system for teams and agents..." }
```

### 0.c — 사이트별 설문 질문 생성 (Phase 5, Haiku 비전)

| | |
|---|---|
| 코드 | `services/dimensions/custom_questions.ts::generateCustomQuestions()` |
| Input | 스크린샷 + category + pitch |
| 처리 | Haiku vision 1회로 3-5개 사이트 특화 질문 (Likert + free-text mix) 생성 |
| Output | `Array<{ id, type: 'likert'\|'text', question, dimension_hint? }>` → `audience_fit_scans.customQuestions` |

→ Step 0 전체 비용: ~$0.002/scan (Haiku 2회), 시간: ~5-10초

---

## Step 1: sampling (페르소나 선택)

| | |
|---|---|
| 코드 | `services/cohort_selection.ts::selectPersonasForCohorts()` (Mode A) 또는 `selectPersonasForAudience()` (Mode B) |
| Input | DB의 모든 `personas` 행 + `scan.mode` + `scan.targetCohorts` (Mode A 선택적 필터) 또는 `scan.targetAudienceText` (Mode B) |

### Mode A — Discovery

1. 모든 페르소나를 `quality_score` 내림차순으로 정렬
2. 각 페르소나의 `vector` (20축 demographic + expertise + feedback_pattern + ux_preferences) 를 각 `CohortSelector` 범위 조건과 매칭
3. 매칭되는 cohort들을 L2 거리로 정렬해 가장 가까운 cohort 버킷에 (`target_n=14` 까지) 배치
4. 어떤 cohort에도 못 들어간 페르소나는 `unassigned` (스캔에서 제외)

→ **8 cohorts × 14 = 약 112명 선택**

### Mode B — Verification

1. `services/dimensions/audience_parser.ts::parseAudience(targetAudienceText)` Haiku 호출 → 자연어 audience 설명을 `CohortSelector` jsonb로 변환
2. 그 selector에 매칭되는 페르소나를 L2 거리 기준 정렬해 ≤50명 선택
3. 매칭 부족 시 progressive relaxation (가장 좁은 numeric axis부터 제약 완화)

→ **단일 버킷 ≤50명 선택**

| | |
|---|---|
| Output | `Map<cohortId, PersonaRow[]>` — **메모리상으로만** 다음 step에 전달, DB 저장 없음 |

---

## Step 2: responding (페르소나 응답 — 핵심 LLM 단계)

각 페르소나마다 한 번씩 (concurrency=5로 병렬 처리).

### Input (per persona)

```ts
{
  persona_vector: { demographics, expertise, voice_sample, ... },
  hypothesis: scan.hypothesis,                          // 사용자 입력
  site_context: { category, categoryConfidence, oneLinePitch },  // ⭐ Q2 fix — non-crypto 사이트에서 페르소나가 crypto feature 환각하는 것을 막음
  screenshot_url: scan.captureScreenshotUrls[0],
}
```

### 처리: `services/dimensions/llm.ts::runPersonaResponseLLM()`

1. **System prompt 빌드** — 페르소나의 `voice_sample` (말투 샘플) + demographic을 한 줄로 압축한 정체성 hint
2. **User prompt 빌드** — hypothesis + site context + Zod 출력 스키마 (`personaResponseSchema` lines 42-79)
3. **LLM 호출** — `withRoute('validator.persona_response', ...)`
   - `USE_VISION=1` (production): Claude **Sonnet 4.6 vision** — 스크린샷 + 텍스트 동시 입력 (멀티모달, 페이지를 사람처럼 시각적으로 이해)
   - `USE_VISION=0` (dev iteration): Claude **Haiku 4.5 text-only** — 저비용 모드, 스크린샷 무시
4. **Output JSON** (Zod 검증):
   ```json
   {
     "happiness": { "sus_responses": [1-5]×10, "raw_score": 0-100, "voice_first_impression": "..." },
     "engagement": { "category": "browse", "voice_engagement": "..." },
     "adoption": { "signup_likelihood": 0-1, "voice_signup": "..." },
     "retention": { "category": "weak", "voice_retention": "..." },
     "task_success": { "completion_likelihood": 0-1, "voice_biggest_friction": "..." },
     "voice_quotes": { "if_could_change_one_thing": "...", "would_return_because": "..." },
     "self_consistency_check": { "happiness_retention_aligned": boolean }
   }
   ```

### 점수 변환 (`services/audience_fit.ts` 상수 사용)

| 차원 | LLM Output | 변환 함수 | 최종 점수 (0-100) |
|---|---|---|---|
| happiness | `sus_responses[10]` (1-5) | `computeSusScore()` — SUS-10 표준 공식 | 0-100 |
| engagement | `category` (`abandon`..`extended`) | `ENGAGEMENT_BAND_TO_SCORE` 매핑 | 10/30/55/75/90 |
| adoption | `signup_likelihood` (0-1) | `× 100` | 0-100 |
| retention_d7 | `category` (`no_return`..`strong`) | `RETENTION_BAND_TO_DCURVE.d7` | 0/5/30/55 |
| task_success | `completion_likelihood` (0-1) | `× 100` | 0-100 |

### Output: `scan_persona_responses` 테이블

1 row per persona, 각 행에:
- 원본 LLM JSON (`rawResponse` jsonb — 재집계 시 LLM 재호출 불필요)
- 변환된 5개 점수 (happinessScore, engagementScore, adoptionScore, retentionScore, taskSuccessScore)
- voice quotes 4개 (voiceFirstImpression, voiceBiggestFriction, voiceSignup, voiceEngagement)
- `isFlagged` — self_consistency_check 실패 시 true (집계에서 제외)
- cohort_id (sampling 단계에서 배치된 버킷)

→ 동시에 `audience_fit_scans.{personasCompleted, personasFlagged}` 카운터 증가

→ **비용**: Sonnet 비전 기준 ~112회 × ~$0.001-0.005 = **$0.10-0.50/scan** (전체 비용의 ~90%, 시간 ~3분)

---

## Step 3: aggregating (집계 → 점수 → 친션 → 퍼널)

### 3.a — 코호트별 집계

| | |
|---|---|
| 코드 | `services/audience_fit.ts::computeCohortFitScore()` |
| Input | `scan_persona_responses` rows (this scan, cohort별 그룹화) |
| 처리 | 1. `is_flagged=false` 필터링 — 자기일관성 통과한 페르소나만 사용<br>2. 각 차원 산술 평균 계산<br>3. `cohort_fit_score = 0.30·eng + 0.30·tsk + 0.25·hap + 0.10·ado + 0.05·ret` (DIMENSION_WEIGHTS_V1)<br>4. Bootstrap CI (1000 샘플, 95%) → `cohort_fit_ci_low`, `cohort_fit_ci_high` |
| Output | `scan_cohort_results` rows (cohort당 1행) — `cohort_id`, `cohort_label`, `n_completed`, `n_flagged`, `cohort_fit_score`, `cohort_fit_ci_low/high`, 5개 dimension 평균 |

### 3.b — 스캔 헤드라인 합성 (Option A)

| | |
|---|---|
| 코드 | `services/audience_fit.ts::computeAudienceFit()` |
| Input | 모든 cohort의 `cohort_fit_score` + per-cohort dimension 평균 |
| 처리 | **Mode A**: <br>· `best` = max(cohort scores), `worst` = min, `median` = 중간값<br>· `global_task_success_avg`, `global_sentiment_avg` (= happiness×0.7 + adoption×0.3) cohort 가중평균<br>· `audience_fit_score = 0.4·best + 0.3·median + 0.2·task_global + 0.1·sentiment_global`<br><br>**Mode B**: 단일 버킷이므로 `audience_fit_score = cohort_fit_score` (best/worst/median 분리 없음) |
| Output | scan row 업데이트 — `audience_fit_score`, `best_cohort_id/score`, `worst_*`, `median_*`, `global_*` |

### 3.c — Friction 클러스터링 (Haiku)

| | |
|---|---|
| 코드 | `services/dimensions/frictions.ts::clusterFrictions()` + 순수 헬퍼 `assembleFrictionClusters()` |
| Input | 모든 페르소나의 `voice_biggest_friction` 문자열 + cohort_id (`is_flagged=false` 필터링 후) |
| 처리 | 1. Haiku에 "이 N개 voice quote들을 의미상 비슷한 것끼리 3-5개 테마로 묶고, 각 cluster마다 representative quote + 어디서 (page/step) 발생했는지 + n persona indices 반환"<br>2. 순수 헬퍼가 어떤 cluster에도 안 들어간 quote → **"Other / long-tail frictions"** 버킷에 강제 추가<br>3. cluster `n` 총합 + long-tail = `items.length` invariant 유지 (silent drop 금지) |
| Output | `audience_fit_scans.frictionsJson` 배열 — rank 1-5 + long-tail, 각 cluster에 `{ title, summary, n, where, impact, quote, affected_cohorts[] }` |

### 3.d — AARRR 퍼널 (cumulative)

| | |
|---|---|
| 코드 | `services/aarrr.ts::computeAarrrFromRows()` |
| Input | 같은 scan_persona_responses |
| 처리 | **각 단계는 직전 단계를 통과한 personas의 부분집합** (cumulative — monotonic non-increasing 보장):<br>· Acquisition: 모든 personas (baseline 100%)<br>· Activation: `task_success ≥ 30`인 subset<br>· Retention: 위 + `retention_d7 ≥ 5` (v1.1 임계값)<br>· Referral: 위 + `happiness ≥ 60`<br>· Revenue: 위 + `adoption ≥ 30` (v1.1)<br><br>각 단계 점수: `(passing_count / total) × 100` |
| Output | `AarrrFunnel { stages: AarrrStage[5], total_personas }` — **응답 시점에 계산, DB 저장 안 함** |

### 3.e — Visitor-weighted view (선택, Phase B v1.1, 현재 UI 잠금)

| | |
|---|---|
| 코드 | `services/audience_fit.ts::computeWeightedAudienceFit()`, `services/aarrr.ts::computeAarrrWeightedFromRows()` |
| Input | cohort-level results + `packages/shared/src/acquisition_priors.ts` (12 category × 8 cohort arrival_share + abandon_rate 테이블) |
| 처리 | category별 priors로 cohort 가중평균 + `INTENT_ACTION` 곱셈자 (0.50/0.20/0.10/0.05) 적용해 visitor-traffic 시나리오 추정 |
| Output | `audience_fit_scans` 응답에 `weighted` + `aarrr_weighted` 필드로 직렬화. **단, 현재 UI는 "Coming in next version"으로 잠금** (Merch GA4 n=1 calibration 한계 명시, 추가 GA4 데이터 확보 후 활성화 예정) |

---

## Step 4: completed → 응답 직렬화

`audience_fit_scans.status = 'completed'`로 전이되면 UI 폴링 종료. `GET /api/scan/:id/report` 응답 묶음:

```ts
{
  scan: {
    id, target_url, category, category_confidence, one_line_pitch,
    mode, status, personas_attempted, personas_completed, personas_flagged,
    weights_version, target_audience_text, mode_b_verdict, mode_b_parsed_selector,
    custom_questions,                          // Phase 5
    created_at, completed_at,
  },
  result: {
    audience_fit_score,
    best:   { cohort_id, cohort_label, cohort_fit_score },
    worst:  { cohort_id, cohort_label, cohort_fit_score },
    median_score,
    global_task_success_avg, global_sentiment_avg,
    weighted?: { ... },                        // Acquisition Layer v1.1
  },
  cohorts: ScanCohortResult[],                 // 8개 cohort breakdown
  fit_personas: ScanPersonaCard[],             // top 10 high-fit
  non_fit_personas: ScanPersonaCard[],         // top 10 low-fit
  frictions: ScanFriction[],                   // rank 1-5 + long-tail
  retention_curve: { d, v }[],                 // D1/D7/D30 곡선
  dimension_breakdown: ChipData[],             // 5 dimension 칩
  aarrr: AarrrFunnel | null,                   // Mode A only
  aarrr_weighted?: AarrrFunnel | null,         // Acquisition Layer v1.1, UI 잠금
  recent_responses: ScanRecentResponse[],      // 최근 8개 (스트리밍 효과용)
  cohort_progress: ScanCohortProgress[],       // 진행률 strip
  survey_response_count,                       // Phase 5
  human_aggregate_computed,                    // Phase 5
}
```

리포트 페이지(`apps/web/app/validator/report/[scanId]/page.tsx`)는 이 JSON을 직접 렌더 — 별도 클라이언트 사이드 변환 거의 없음.

---

## Step 5: Phase 5 — Human comparison (비동기, 분리된 흐름)

스캔 완료 후 운영자가 survey 링크 (`/validator/survey/<scanId>`)를 사람들에게 공유 → 응답 누적 → 운영자가 리포트 페이지에서 "Compare with humans (n=X) →" 버튼 클릭. 이때 또 다른 파이프라인이 돕니다.

### 5.a — 인간 응답 수집 (per submission)

| | |
|---|---|
| 라우트 | `POST /api/scan/:id/survey` (Phase 5.1: **requirePrivyAuth**) |
| Input | sus_responses (10), engagement_category, signup_likelihood, retention_category, completion_likelihood, voice (4 quotes), demographics, custom_answers |
| 처리 | 1. `userId = req.privyUser.id`<br>2. AI 측과 동일한 매핑 함수로 5축 채점 (`computeSusScoreLocal`, `HUMAN_ENGAGEMENT_TO_SCORE`, `HUMAN_RETENTION_TO_D7`)<br>3. `calibration_records` 5행 append (legacy 운영팀 aggregator용)<br>4. `survey_responses` **upsert** on `(scan_id, user_id)` UNIQUE — 재제출 시 jsonb 필드 모두 덮어쓰기 + submittedAt bump |
| Output | `survey_responses` 1행 (per user, per scan) + `calibration_records` 5행 |

### 5.b — Human aggregate 트리거 (운영자 manual)

| | |
|---|---|
| 라우트 | `POST /api/scan/:id/human-aggregate` |
| 코드 | `services/human_aggregate.ts::recomputeHumanAggregate(scanId)` |
| Input | 그 scan의 모든 `survey_responses` rows + `audience_fit_scans.customQuestions` |
| 처리 | **AI 측의 strict mirror**:<br><br>1. **응답자별 채점** — AI와 동일 상수 (`ENGAGEMENT_TO_SCORE`, `RETENTION_TO_D7`, `computeSusScore`)<br>2. **단일 버킷 fit score** — `DIMENSION_WEIGHTS_V1` 공식을 응답자 평균에 적용 (Mode B 스타일 collapse)<br>3. **Friction clustering** — `assembleFrictionClusters()` 순수 헬퍼 **재사용**. Haiku 호출은 in-module (`validator.cluster_human_frictions`), AI 측과 다른 prompt — 입력은 voice 4축 + free-text custom 답변, 모두 `cohort='human'` 태그.<br>· `n_respondents < 3`이면 Haiku 안 부르고 단일 "Raw human voice" 버킷으로 short-circuit (Haiku가 작은 샘플에서 불안정한 클러스터를 만들기 때문)<br>4. **AARRR funnel** — `computeAarrrFromRows()` 순수 헬퍼 **재사용**, 같은 v1.1 임계값<br>5. **Custom question rollup** — Likert 평균 + Text quote 최대 3개 |
| Output | `audience_fit_scans.human_aggregate` jsonb 단일 행 (idempotent overwrite) |

`HumanAggregate` shape:
```ts
{
  n_respondents: number,
  audience_fit_score: number,
  dimension_means: { happiness, task_success, adoption, retention_d7, engagement },
  frictions: FrictionCluster[] | null,
  aarrr: AarrrFunnel | null,
  custom_question_rollup: {
    [qid]: { likert?: { mean, n_answered }; quotes?: string[] }
  },
  computed_at: ISO-8601,
}
```

### 5.c — Compare 응답 + diff 계산

| | |
|---|---|
| 라우트 | `GET /api/scan/:id/compare` |
| Input | `audience_fit_scans` 행 (`audienceFitScore`, `frictionsJson`, `humanAggregate`) + `scan_cohort_results` (AI dimension 평균 가중 산출용) |
| 처리 | 1. AI 측 `dimension_means` — cohort `n_completed` 가중평균 (`/survey` 핸들러의 `wAvg()` 패턴 재현)<br>2. `human_aggregate` 그대로 노출 (없으면 null)<br>3. `diff` 계산:<br>· `audience_fit_delta = human − ai`<br>· `dimension_deltas` 5축<br>· `friction_overlap` — 클러스터 title의 token-overlap heuristic (lowercase + 3+ char tokens), 0-1<br>· `{ai,human}_only_frictions` — 각 top 3 |
| Output | `{ scan, ai, human, diff, survey_response_count }` → `/validator/compare/[scanId]` 페이지가 직접 렌더 |

---

## 전체 흐름 시각 요약

```
target_url (POST /api/scan)
  ↓
[Playwright capture] → 2 PNGs → R2 → captureScreenshotUrls
  ↓ status='capturing'
[Haiku vision ×1] → category, confidence, pitch → scan row
  ↓
[Haiku vision ×1] → custom_questions[] → scan row
  ↓ status='sampling'
[cohort_selection] → 메모리상 persona 버킷 (Mode A: 8×14=112 / Mode B: ≤50)
  ↓ status='responding'
[Sonnet vision ×N personas, concurrency=5] → 각각 5축 + voice JSON
  ↓ (점수 변환: SUS-10 / band→score / × 100)
INSERT scan_persona_responses (N행)
  ↓ status='aggregating'
[cohort aggregation ×K cohorts] → scan_cohort_results
  - cohort_fit_score (DIMENSION_WEIGHTS_V1)
  - bootstrap CI
  ↓
[Option A 합성] → audience_fit_score, best/worst/median → scan row
  ↓
[Haiku friction clustering ×1] → frictions_json → scan row
  ↓
[computeAarrrFromRows] → aarrr funnel (응답 시점)
  ↓ status='completed'
GET /api/scan/:id/report 가 모든 걸 묶어 반환
  ↓
─────────── (비동기, 시간 흐른 후) ───────────
  ↓
사람들이 /validator/survey/<scanId> 작성 (Privy auth)
  ↓
[POST /survey × N humans] → survey_responses upsert(scan_id, user_id)
  ↓
운영자가 "Compare with humans" 클릭
  ↓
[recomputeHumanAggregate]
  - 같은 AI 측 채점 매핑
  - 같은 DIMENSION_WEIGHTS_V1 공식 (단일 버킷)
  - 같은 assembleFrictionClusters + computeAarrrFromRows 재사용
  → audience_fit_scans.human_aggregate
  ↓
GET /api/scan/:id/compare → { ai, human, diff } → /validator/compare 페이지
```

---

## 핵심 invariant (테스트로 lock된 6개)

`apps/api/src/__tests__/audience_fit_helpers.test.ts` + `scan_shapers.test.ts`에 unit-test로 박혀있음:

1. `audience_fit_score = 0.4·best + 0.3·median + 0.2·task_global + 0.1·sentiment_global` (Mode A, Option A)
2. Mode B: `audience_fit_score = cohort_fit_score` (단일 버킷)
3. Per-persona: happiness=SUS-10, task=completion×100, adoption=signup×100, engagement=BAND_TO_SCORE, retention_d7=BAND_TO_DCURVE
4. `cohort_fit_score = 0.30·eng + 0.30·tsk + 0.25·hap + 0.10·ado + 0.05·ret` (DIMENSION_WEIGHTS_V1)
5. AARRR cumulative — 각 단계는 직전 단계 통과 personas의 부분집합 (monotonic non-increasing)
6. Friction clustering — cluster `n` 총합 + long-tail = `items.length` (silent drop 금지)

---

## 비용 / 시간 요약 (Mode A 기준)

| 단계 | LLM 호출 | 비용 추정 | 시간 |
|---|---|---|---|
| Step 0.a Playwright capture | 0 | $0 | ~5-10초 |
| Step 0.b classify_site (Haiku vision) | 1 | ~$0.0008 | ~3초 |
| Step 0.c custom_questions (Haiku vision) | 1 | ~$0.001 | ~5초 |
| Step 1 sampling | 0 | $0 | <1초 |
| Step 2 persona responses (Sonnet vision) | ~112 | $0.10-0.50 | ~2-3분 |
| Step 3.c friction clustering (Haiku) | 1 | ~$0.003 | ~5-10초 |
| **Total** | **~115 LLM 호출** | **~$0.11-0.51** | **~3-4분** |

Phase 5 (per human-aggregate 트리거): friction clustering 1회 추가 (`validator.cluster_human_frictions`, ~$0.003) — n_respondents < 3이면 skip.

LLM 사용량은 `withRoute(tag, ...)` 래퍼가 `USAGE_LOG_PATH` (`/tmp/llm-usage.jsonl`)에 기록. `scripts/usage-summary.ts`로 route/model별 집계 가능.

---

## 어디서 코드를 더 읽을지

| 궁금한 것 | Start at |
|---|---|
| 전체 파이프라인 흐름 | `apps/api/src/services/scan_pipeline.ts` |
| 페르소나 프롬프트 + 응답 스키마 | `apps/api/src/services/dimensions/llm.ts` |
| 코호트 수학 + Option A 공식 | `apps/api/src/services/audience_fit.ts` |
| AARRR 룰 | `apps/api/src/services/aarrr.ts` |
| 페르소나 할당 알고리즘 | `apps/api/src/services/cohort_selection.ts` |
| Friction clustering | `apps/api/src/services/dimensions/frictions.ts` |
| 사이트별 질문 생성 (Phase 5) | `apps/api/src/services/dimensions/custom_questions.ts` |
| Human aggregate (Phase 5) | `apps/api/src/services/human_aggregate.ts` |
| `/api/me/survey-responses` 엔드포인트 | `apps/api/src/routes/me_responses.ts` |
| 코호트 정의 | `packages/shared/src/cohorts.ts` |
| Acquisition priors (visitor view) | `packages/shared/src/acquisition_priors.ts` |
| 테스트 (math invariants 락) | `apps/api/src/__tests__/` |
| 운영 가이드 + Do-NOT | `CLAUDE.md` (repo root) |
| 더 깊은 주제별 walkthrough | [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) / [`HOW-IT-WORKS.ko.md`](HOW-IT-WORKS.ko.md) |
