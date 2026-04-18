# 41R Persona Market — 전략 피봇 리포트

> **작성일**: 2026-04-10
> **목적**: "QA 도구"에서 "AI 페르소나 기반 유저·데이터 플랫폼"으로의 전환을 위한 가설 검증·설계·시장 분석
> **현재 상태**: 해킹톤 MVP (apps/api 22 endpoints, 7 tables / apps/web 17 pages)

---

## 0. Executive Summary

**한 줄 명제**
> 41R의 방어선은 *기술*(LLM, 브라우저 에이전트)이 아니라, *실제 보상받은 테스터의 행동이 온체인으로 증명되어 페르소나로 수렴하는 데이터 루프*다.

**현재 코드가 가진 자산과 공백**
- ✅ **L2(성과 최적화)는 상당 부분 구현됨** — 20차원 페르소나 벡터(`schema.ts:personas`), Stagehand 4단계 자동 테스트(`autotest.ts:69-464`), 품질 파워커브 보상(`report.ts:50-92`), SAS 온체인 증명.
- 🟡 **L1(코드/서비스 검증)은 "URL 기반 UX 체크리스트"에 머물러 있음** — 개발자 워크플로우(PR/CI) 진입 없음.
- 🔴 **L3(살아있는 데이터 해자)는 구조적으로 비어있음** — 자동 테스트 결과 메모리 저장만, 페르소나 재훈련·버전 관리·예측 vs 실제 비교 루프 없음, 커뮤니티 레이어 부재.

**핵심 결론 3가지**
1. **L2를 wedge로 삼고 L1은 의도적으로 얇게 유지**한다. CPO/마케팅 바이어를 등대 고객으로 한 "Persona Insight Report"가 현재 코드와 가장 가깝고, 경쟁사 가격 헤드룸(Listen Labs $15K~25K/seat 대비 1/10)이 있다.
2. **L3 "Synthetic User Provision"은 규제 지뢰밭**이다. FTC Fake Reviews Rule(2024.10.21 발효, 건당 $51,744 벌금)은 "AI가 생성한 리뷰/추천"을 금지한다. **포지셔닝 언어를 "simulation/stress test/pre-launch cohort"로 고정**해야 하고, "synthetic reviews"는 마케팅 금기어다.
3. **해자의 실질은 "페르소나 provenance(유래 증명)"**다. 온체인 SAS + USDC 보상 트레일이 *legal defensibility*와 *enterprise trust*를 동시에 준다. 경쟁사(Blok, PersonaQA, Thunders) 중 누구도 이 조합을 못 한다.

---

## 1. 검증해야 할 가설 (Hypothesis Tree)

피봇의 위험은 6개 가설로 분해된다. 각각은 **독립적으로 falsifiable**하고, 실패 시 제품을 다시 설계해야 한다.

### H1. 바이어 가설 (Who pays)
> **CPO/마케팅 본부장은 "실제 유저 행동으로 캘리브레이션된 페르소나" 리포트에 건당 $500~$2,000을 지불한다.**

- **근거**: Synthetic Users($2~27/인터뷰)는 시뮬레이션 품질 논란으로 commodity화, Listen Labs/Outset/Strella는 $15K~25K/seat/년에 판매 중. 중간 가격대(리포트당 $500~2K)가 공백.
- **실패 조건(kill criteria)**: 30명 CPO 아웃바운드에 대해 유료 파일럿 전환율 <5%, 또는 리포트당 실지불 의향가 <$300.

### H2. 정확도 가설 (Does it actually work)
> **"실제 테스터 세션으로 캘리브레이션된 페르소나"는 LLM-only 페르소나보다 실제 유저 행동 예측에서 측정 가능하게 더 정확하다.**

- **근거**: Columbia Business School 메가스터디(2,000 digital twins, 19개 연구) — 인터뷰 기반 트윈은 **개인 단위 75% 정확도**, demographic-only 대비 **정치 bias 36~62%, 인종 bias 7~38% 감소**. NN/g는 "cohort 상대 차이는 잘 잡지만 개인 empathy는 약하다"고 경고.
- **실패 조건**: 동일 URL·동일 태스크에 대해 (a) LLM-only 페르소나 (b) 41R 캘리브레이션 페르소나 (c) 실제 유저 그룹을 돌렸을 때, (b)와 (c)의 예측 상관계수가 (a)와 (c) 대비 유의미하게(p<0.05) 높지 **않으면** 가설 기각.

### H3. 플라이휠 가설 (Does calibration compound)
> **테스터 볼륨이 늘면 페르소나 예측 정확도는 monotonic하게 개선된다 (log-linear 이상).**

- **근거**: 모든 데이터 moat 회사(Amplitude, Heap, Mixpanel)의 기본 내러티브. 단 41R은 *고객 이벤트 저장*이 아니라 *페르소나 벡터 정교화*가 축이므로, 이 곡선은 스스로 측정해야 함.
- **실패 조건**: 100→1,000 테스터 구간에서 프레디션 델타가 saturate하거나 역전되면, moat 주장이 무너짐.

### H4. 커뮤니티 가설 (Do testers stay)
> **테스터는 일회성 리워드가 아니라 "나의 페르소나가 성장한다"는 감정적 소유권 때문에 지속 참여한다.**

- **근거**: 현재 SAS Bronze/Silver/Gold 배지가 이미 씨앗. 하지만 현재 `/tester` UI는 "할 일 목록" 형태로, 커뮤니티가 아니다.
- **실패 조건**: 30일 테스터 retention <20%, 또는 "페르소나 페이지 재방문율" <15%. (벤치마크: PlaytestCloud 등 세션 페이즈 패널은 ~30% monthly).

### H5. 진입점 가설 (Does L1 funnel into L2)
> **얇은 L1(GitHub App / PR 훅 형태의 서비스 검증)은 엔터프라이즈 인입 통로로 작동하되, 엔지니어링 리소스를 <10% 잡아먹는다.**

- **근거**: QA Wolf $90K ARR, Mabl $499/mo. 이 시장에 정면 승부하면 *LLM 경쟁 지대*(Devin, Replit Agent, Cursor)에 들어간다. **팔지 않고, 인입으로만** 사용해야 함.
- **실패 조건**: L1 구현이 엔지니어링 시간의 >25%를 잡아먹거나, L1→L2 전환율 <3%면 L1 자체를 drop.

### H6. 규제 가설 (Is L3 legal)
> **Synthetic User Provision은 "사전 출시 시뮬레이션/스트레스 테스트"로 포지셔닝하면 FTC Fake Reviews Rule 리스크를 회피하면서 판매 가능하다.**

- **근거**: FTC 465조 2항은 virtual influencer/AI 아바타 마케팅을 명시적으로 허용. 내부 product validation은 "review/testimonial" 카테고리가 아님.
- **실패 조건**: 법률 검토에서 "유저 페르소나 판매가 GDPR Art.22(자동화 의사결정)/국내 개인정보보호법의 가명정보 요건"을 충족 못 하면, 전체 L3 스토리 재설계.

---

## 2. 각 가설의 검증 접근 (Experiments)

| 가설 | 실험 설계 | 필요 자산 | 판정 지표 |
|---|---|---|---|
| **H1** | 30명 한국/북미 CPO 리스트업 → 개인화 콜드 이메일 (회사 웹사이트 분석 미리보기 1장 첨부) → 유료 파일럿($1K~2K/리포트) 제안 | 콜드 이메일 파이프라인, 샘플 리포트 PDF 템플릿, 스케줄링 툴 | 응답률, 미팅 전환율, 유료 전환율 |
| **H2** | 동일 타깃 URL(3개) × 3 조건(LLM-only / 캘리브레이션 / 리얼 유저) × 5개 태스크 = 45개 세션. 행동 시퀀스·CTR·이탈 지점 비교 | 캘리브레이션 로직, ground-truth 수집 채널, 통계 분석 | Spearman ρ, p-value, bias 감소율 |
| **H3** | 테스터 코호트 사이즈를 {10, 50, 100, 500}로 grow하면서 H2 실험 반복. learning curve 플롯 | 테스터 리크루팅 예산, 버전 관리된 페르소나 벡터 저장소 | 정확도의 로그-선형 기울기 |
| **H4** | 커뮤니티 UI 2개 변종 A/B 테스트: (a) 현재 "할 일 목록", (b) "페르소나 프로필 + 랭킹 + 페르소나끼리의 리포트 승패 기록" | 프런트엔드 리팩토링, 이벤트 로깅 | 30일 retention, DAU/MAU, 페르소나 페이지 재방문율 |
| **H5** | 얇은 GitHub App MVP (PR에 41R 페르소나 1명 자동 실행, 결과 댓글) → 무료 배포 → 인입 → 유료 L2 전환 관찰 | GitHub App 등록, 이벤트 추적, L2 판매 링크 | L1 install → L2 유료 전환율 |
| **H6** | 외부 법률 자문(미·한 각 1명) 1회 리뷰. FTC/GDPR/개인정보보호법 위험 평가 + 포지셔닝 문구 검수 | 법률 자문 예산, 현 마케팅 카피 일체 | 서면 리스크 평가 |

**실험 우선순위**: H1 → H6 → H2 → H4 → H3 → H5
- H1이 실패하면 다른 가설은 의미 없음 (수요 없음)
- H6은 싸고 빠르게 끝나며, 실패 시 L3 스토리 전면 재설계
- H2는 가장 비싸지만 유일한 "기술적 moat의 경험적 증거". 데모 데이로 쓸 수 있음.

---

## 3. 필요한 설계 변경 (Architecture Delta)

피봇이 성립하려면 현재 코드에서 **다음 7개 빈자리**를 채워야 한다.

### 3.1 데이터 모델 추가

| 새 테이블 | 목적 | 주요 컬럼 |
|---|---|---|
| `persona_versions` | 페르소나 벡터의 시간순 히스토리 (calibration 추적) | `id, persona_id, vector, source_report_ids, created_at, version_num` |
| `autotest_runs` (영속화) | 현재 메모리에만 있는 자동 테스트 작업을 DB로 | `id, test_id, persona_id, status, phases_json, screenshots, started_at, finished_at` |
| `ground_truth_events` | 실제 유저 행동 이벤트 (클라이언트 SDK 또는 analytics import) | `id, company_id, session_id, url, event_type, payload_json, timestamp` |
| `prediction_deltas` | 페르소나 예측 vs 실제 유저 행동의 차이 (H2 핵심 지표) | `id, persona_version_id, ground_truth_session_id, metric_name, predicted, actual, delta` |
| `persona_lineage` | 어떤 리포트·온체인 attestation이 기여했는지 (provenance) | `persona_id, report_id, contribution_weight, sas_txn` |
| `tenant_acl` | 엔터프라이즈 멀티테넌시 | `tenant_id, owner_wallet, plan, data_isolation_mode` |
| `report_artifacts` | CPO 판매용 PDF/내보내기 | `id, test_id, persona_version_id, format, url, generated_at` |

### 3.2 서비스 레이어 추가

- **`calibration.ts`** — `ground_truth_events`와 `persona_versions`를 비교해 델타를 계산하고, 새 페르소나 버전을 생성. H2·H3의 실험 축.
- **`ingest.ts`** — 외부 SDK/analytics pipe (webhook 또는 `POST /api/ingest/events`). GDPR 동의 토큰 검증.
- **`report-pdf.ts`** — Persona Insight Report를 PDF로 출력 (Puppeteer 또는 React-PDF). H1 유료 전환의 deliverable.
- **`community.ts`** — 테스터 랭킹, 페르소나 리더보드, 페르소나 vs 페르소나 비교 뷰. H4 검증 레버.

### 3.3 프런트엔드 추가·변경

- **`/persona/[id]/public`** — 공개 페르소나 카드 (Open Graph 태그, 공유 가능, SEO). "나의 페르소나"를 감정 자산으로 만드는 핵심.
- **`/tester` 재설계** — "할 일 목록"에서 "내 페르소나 성장 허브"로. 페르소나 진화 히스토리, 참여한 테스트의 품질 곡선, SAS 배지 트로피 케이스.
- **`/company/report/[id]`** — CPO에게 판매할 Persona Insight Report 뷰 (다운로드 가능 PDF + shareable link).
- **`/ingest/setup`** — 클라이언트사가 analytics를 연결하는 설정 UI (OAuth + SDK 스니펫).

### 3.4 아키텍처 원칙

- **페르소나 버저닝이 first-class.** 현재 `personas` 테이블은 단일 row로 덮어쓰기(update)하는 구조인데, 이건 calibration 플라이휠과 정면 충돌. 버전 히스토리를 append-only로 가야 "시간에 따라 정확도가 올랐다"는 주장을 **증명**할 수 있다.
- **Ground truth 수집 루트는 3개 모두 준비하되, 기본값은 "41R 테스터 세션"**으로 잡는다. (1) 41R 테스터 세션 = 기본, (2) 클라이언트 analytics webhook = 옵션, (3) 퍼블릭 사이트 스크래핑(GA/heatmap) = 에지케이스.
- **페르소나 → 사람 역추적 불가능 보장.** GDPR 대응. 최소 3개 테스터 세션 병합 후에만 페르소나 발행(k-anonymity = 3).
- **Provenance 체인 공개.** `persona_lineage` 테이블의 SAS 트랜잭션을 페르소나 public 페이지에서 노출. 이게 곧 "Fake reviews 아님"의 법적/마케팅 증거.

---

## 4. 시장 현황 (Market Landscape)

### 4.1 경쟁 지형

| 카테고리 | 플레이어 | 41R 관점 |
|---|---|---|
| **AI QA (L1)** | Mabl $499/mo, Testim $450/user, **QA Wolf $90K ARR**, Rainforest $200/mo+$5/h, Browserbase + Stagehand v3 | 41R이 이기려 하면 LLM 경쟁 지대. **진입용으로만** 사용. |
| **AI User Research (L2)** | Synthetic Users $2~27/interview (commodity), **Listen Labs $20K/seat**, Outset, Strella, Maze($99), Lyssna($75) | **가격 공백 $500~2K**가 41R의 타깃. |
| **Persona + Browser QA (L1+L2 hybrid)** | **Blok, PersonaQA, Thunders** | **가장 직접적 경쟁자**. 셋 다 "페르소나 소스 증명" 없음. 41R provenance가 차별화 축. |
| **Cold-start / Synthetic Users (L3)** | **제품 카테고리 부재** | 41R이 최초 명명 가능. 단 FTC 지뢰. |
| **Reward Testing Panels** | UserTesting $16.9K~136.8K, Userlytics $19/세션, PlaytestCloud $9~12, BetaFamily $5~20 | 41R은 **USDC + 온체인 attestation**으로 차별화. Web3 테스팅은 사실상 공백. |
| **Data Moat (Analytics)** | Amplitude, Heap, Mixpanel | 이들의 해자는 "고객 이벤트 스키마 락인". 41R 해자는 "페르소나 캘리브레이션 연속성"이라 동형이지만 판매 대상이 다름(데이터 자체 vs 예측 서비스). |
| **한국 시장** | 셀렉트스타(25만 크라우드, LLM eval로 피봇), 크라우드웍스(데이터 라벨링) | 두 회사 모두 **"프로덕트 UX 검증 + 페르소나 시뮬레이션"은 손대지 않음**. 41R의 한국 그린필드. |

### 4.2 직접 경쟁자 Top 5

1. **Blok** (TechCrunch 2025.7) — "AI personas to simulate real-world app usage before launch". 41R과 서사 가장 유사. 페르소나 소스가 불명확한 점이 약점.
2. **PersonaQA** (persona.qa) — 브라우저 자동화 + personality traits. L1 + L2 묶어 판매 중. provenance 없음.
3. **Thunders** (thunders.ai) — Thunders Personas + self-healing QA. 페르소나 내러티브를 QA 사이드에서 선점 중.
4. **Synthetic Users** — 가격 파괴자 ($2~27/인터뷰). 41R의 L2 가격 상한을 찍음. 단 브라우저 조작 없음.
5. **QA Wolf** — managed $90K ARR 레퍼런스. 41R L1 가격 상한선. 정면 경쟁 대상 아님.

### 4.3 가격 벤치마크

| 축 | 하한 | 상한 |
|---|---|---|
| QA 자동화 per-test (managed) | $40/test/mo | $90K/yr (median ARR) |
| User research 응답자당 | $2/interview (SU) | $100/interview (전통) |
| Enterprise AI research seat | $10K/study | $25K/seat/yr |
| 휴먼 테스터 리워드 | $5/session | $20/session |
| **합성 유저 seeding** | — | **가격 부재 = 41R 정의권** |

**권장 41R 가격 포지셔닝**
- **L1** (얇게): 무료 GitHub App + 파일럿 limit → 엔터프라이즈 $500/mo starter
- **L2** (wedge): **Persona Insight Report $1,000~2,000/건**, 월 구독 $3K~10K (SU 대비 프리미엄, Listen Labs 대비 1/10)
- **L3** (신규): 월 구독 $5K~15K + 유저 수 기반 usage. 파운더/growth 팀 대상.

### 4.4 규제 리스크 (매우 중요)

**FTC Fake Reviews Rule** — 2024.10.21 발효, 건당 **$51,744 벌금**
- 금지: "fake/AI-generated consumer reviews/testimonials", 리뷰어 정체성 misrepresentation
- 허용: Section 465.2 virtual influencer / AI 아바타 마케팅
- **41R 시사점**: L3를 "review/endorsement 생성"으로 포지셔닝하면 즉시 타격. **포지셔닝 고정어**:
  - ❌ "synthetic reviews", "AI-generated user feedback", "fake users to boost ratings"
  - ✅ "pre-launch simulation cohort", "product validation synthetic users", "stress-test personas", "QA persona runs"

**GDPR Art. 22/6 & 한국 개인정보보호법 (가명정보)**
- 테스터 온보딩 시 "내 세션이 페르소나 학습에 사용될 수 있음"에 명시적 동의 필요
- k-anonymity ≥ 3 (최소 3명 세션 병합 후 페르소나 발행)
- 페르소나 → 특정 개인 역추적 불가능 설계
- 한국: 셀렉트스타가 이미 밟은 가명정보 규정 경로 참조 가능

**윤리적 2차 리스크**: "living data" 내러티브가 강할수록 "리얼 유저가 동의 없이 복제된다"는 언론 프레임 위험. **페르소나 = 개인 복제가 아니라 aggregate behavioral pattern의 합성**이라는 점을 기술 문서·백서에 명시.

---

## 5. 권장 전략 (Wedge → Expansion)

### Phase 0 — 피봇 확정 (2주)
1. **가설 문서를 팀 내부에서 락(lock)한다** — H1~H6을 변경 없이 8주간 고정
2. **H6(법률 자문)을 먼저 처리** — 싸고 빠르며, 실패 시 L3 설계 전면 재작성
3. **장표/웹사이트 카피에서 FTC 금기어 제거**

### Phase 1 — CPO Wedge 집중 (6주)
1. **샘플 Persona Insight Report PDF 1개 제작** (현재 코드 + 수동 편집으로 impressive mock)
2. **30명 CPO 콜드 아웃바운드** (H1 검증)
3. 병행: **`persona_versions` 테이블 + `calibration.ts` 뼈대** 구현 (플라이휠의 기초)
4. Phase 1 Gate: **유료 파일럿 3건** 확보하면 Phase 2 진입, 못하면 가격·세그먼트 재조정

### Phase 2 — H2/H3 실증 (8주)
1. **캘리브레이션 실험 1회차 수행** — 유료 파일럿 고객 데이터 + 41R 테스터 세션으로
2. **결과를 백서/블로그로 공개** — "실제 유저 캘리브레이션은 LLM-only 대비 X% 정확" = 세일즈 탄약
3. 병행: **`report_artifacts` + PDF 파이프라인** 자동화

### Phase 3 — 커뮤니티 & L3 (12주)
1. **`/tester` UI를 커뮤니티 허브로 재설계** (H4)
2. **L3 Synthetic User Provision 제품화** — 법률 검토 통과한 포지셔닝으로 파운더 세그먼트 테스트
3. **L1 GitHub App MVP** — 의도적으로 얇게. 인입 채널 검증만(H5)

### 의도적으로 **하지 않을** 것
- ❌ Mabl/Testim/QA Wolf와 정면 경쟁 (L1을 두껍게 만들기)
- ❌ OpenAI Operator / Computer Use를 래핑해서 범용 에이전트로 경쟁
- ❌ "synthetic reviews" / "AI user feedback" 워딩 사용
- ❌ 3개 세일즈 퍼널(CTO/CPO/파운더)을 동시에 굴리기 — CPO 하나에 집중
- ❌ 페르소나 개별 정확도 주장 (Columbia 연구대로 cohort 단위 정확도로만 주장)

---

## 6. Open Questions (결정 필요)

1. **"실제 유저 데이터" 수집 루트** — 아래 3개 중 기본값은?
   - (a) 41R 테스터 세션 = 기본 (권장)
   - (b) 고객사 analytics webhook 연동 (엔터프라이즈 deal 때 필수)
   - (c) 퍼블릭 사이트 스크래핑 (GA public, heatmap 등)
2. **등대 고객 지역**: 한국 CPO vs 북미 CPO 중 H1 아웃바운드 우선순위?
3. **L1 드롭 가능 여부**: 투자자/해킹톤 제출 입장에서 "AI QA SaaS"를 장표에서 뺄 수 있나?
4. **가격 앵커**: Persona Insight Report $1K~2K 가격이 초기 파일럿에서 너무 비싸면 어디까지 내릴지? (제 관점: 최저 $500, 그 이하는 commodity로 빠짐)
5. **Open source 전략**: Stagehand처럼 일부를 OSS로 풀어 개발자 인입을 유도할지, 모두 closed로 갈지?
6. **페르소나 소유권 경제학**: 테스터가 자신의 페르소나로 발생한 수익의 일부를 받는가? (현재 코드엔 없음, 하지만 moat H4 강화 레버)

---

## 7. 다음 액션 (immediate)

- [ ] 이 문서를 팀 전체에 공유하고 H1~H6에 대한 반박 받기
- [ ] H6 법률 자문 견적 받기 (미·한 각 1명)
- [ ] Phase 1 wedge 제품(샘플 PDF 리포트 템플릿) 설계 시작
- [ ] `persona_versions` 마이그레이션 draft 작성 (코드 레벨 피봇 준비)
- [ ] 위 Open Question 6개에 대한 팀 회의 소집

---

## Appendix A — 참고 문헌

**경쟁 & 가격**
- [Stagehand v3 — Browserbase Blog](https://www.browserbase.com/blog/ai-web-agent-sdk)
- [QA Wolf Pricing — Sacra](https://sacra.com/chat/h/bb0c3a1e-c8d7-4df9-bf63-8bbbd8721c13/)
- [Testim/Functionize/Applitools 비교](https://www.amplifilabs.com/post/testim-vs-functionize-vs-applitools-which-ai-testing-platform-fits-your-qa-strategy)
- [Synthetic Users 홈페이지](https://www.syntheticusers.com/)
- [Listen Labs](https://listenlabs.ai/)
- [Best AI Interview Platforms 2026](https://www.userintuition.ai/posts/best-ai-interview-platforms-2026-comparison/)
- [Blok TechCrunch](https://techcrunch.com/2025/07/09/blok-is-using-ai-persons-to-simulate-real-world-app-usage/)
- [PersonaQA](https://persona.qa/)
- [Thunders](https://www.thunders.ai/)

**학술 & 방법론**
- [Synthetic Users 비판 — NN/g](https://www.nngroup.com/articles/synthetic-users/)
- [Evaluating AI-Simulated Behavior — NN/g (Columbia megastudy)](https://www.nngroup.com/articles/ai-simulations-studies/)
- [Digital Twins: Simulating Humans — NN/g](https://www.nngroup.com/articles/digital-twins/)
- [AI Agent Digital Twin — Columbia Business School](https://business.columbia.edu/insights/digital-future/ai-agent-digital-twin)
- [Towards Human Digital Twin — ScienceDirect 2025](https://www.sciencedirect.com/science/article/pii/S2452414X25001980)

**규제**
- [FTC Final Rule Banning Fake Reviews](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
- [FTC Rule Analysis — Sidley](https://www.sidley.com/en/insights/newsupdates/2024/08/us-ftcs-new-rule-on-fake-and-ai-generated-reviews-and-social-media-bots)
- [FTC Warning Letters 2025 — DLA Piper](https://www.dlapiper.com/en-us/insights/publications/2025/12/ftc-warning-letters-ai-consumer-reviews)

**콜드 스타트 & 마켓플레이스**
- [Andrew Chen — Cold-start for social products](https://andrewchen.com/how-to-solve-the-cold-start-problem-for-social-products/)
- [Reforge — Beat the cold start](https://www.reforge.com/guides/beat-the-cold-start-problem-in-a-marketplace)

**한국 시장**
- [셀렉트스타](https://selectstar.ai/)
- [크라우드웍스](https://works.crowdworks.kr/)

---

## Appendix B — 현재 코드 레퍼런스

| 자산 | 파일 | 피봇 후 역할 |
|---|---|---|
| 20차원 페르소나 벡터 | `apps/api/src/db/schema.ts:personas` | 유지 + `persona_versions` 히스토리 추가 |
| LLM 페르소나 생성 | `apps/api/src/routes/persona.ts:10-120` | 유지 + ground truth calibration 훅 추가 |
| Stagehand 4단계 자동 테스트 | `apps/api/src/services/autotest.ts:69-464` | 유지 + `autotest_runs` DB 영속화 |
| 품질 파워커브 보상 | `apps/api/src/routes/report.ts:50-92` | 유지 |
| SAS 온체인 증명 | `apps/api/src/services/sas.ts` | 핵심 확장 — provenance 체인의 정규 출입구 |
| x402 게이트웨이 | `apps/api/src/middleware/x402.ts:65-114` | L2 리포트 판매 결제 레일로 재활용 |
| 테스터 포털 UI | `apps/web/app/tester/*` | **전면 재설계** — 할 일 목록 → 커뮤니티 허브 |
| 회사 대시보드 | `apps/web/app/company/*` | **확장** — Persona Insight Report 뷰 추가 |

---

*이 문서는 피봇 결정의 출발점이며, H1~H6 검증 결과에 따라 8주 후 업데이트 예정.*
