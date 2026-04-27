# 41R Persona Market — 기술 아키텍처

> **대상 독자**: 기술 검토를 진행하는 투자자 / 잠재 파트너
> **작성 시점**: 2026-04-26 · **현재 코드베이스**: `dev` 브랜치
> **요약 한 줄**: 인간 사용자 테스트를 **재사용 가능한 AI 페르소나**로 결정화하고, 그 페르소나가 자율적으로 웹 제품을 평가해 검증된 UX 리포트를 생성하는 Solana 기반 마켓플레이스.

---

## 목차

0. [Executive Summary](#0-executive-summary)
1. [비즈니스 모델과 시스템 개요](#1-비즈니스-모델과-시스템-개요)
2. [전체 시스템 아키텍처](#2-전체-시스템-아키텍처)
3. [**AI 페르소나 시스템** (집중 챕터)](#3-ai-페르소나-시스템-집중-챕터)
4. [백엔드 아키텍처 (apps/api)](#4-백엔드-아키텍처-appsapi)
5. [프론트엔드 아키텍처 (apps/web)](#5-프론트엔드-아키텍처-appsweb)
6. [블록체인 / 결제 레이어](#6-블록체인--결제-레이어)
7. [배포 / 운영 / 관측성](#7-배포--운영--관측성)
8. [핵심 트레이드오프와 디자인 결정](#8-핵심-트레이드오프와-디자인-결정)
9. [확장 로드맵 / 메인넷 promotion 체크리스트](#9-확장-로드맵--메인넷-promotion-체크리스트)

---

## 0. Executive Summary

### 무엇을 만들었나
AI 페르소나가 **사람을 대신해 웹사이트를 직접 사용**하고 그 결과로 UX 리포트를 생산하는 마켓플레이스입니다. 회사는 USDC를 예치해 테스트를 의뢰하고, 인간 테스터는 보상을 받으며 동시에 자신의 행동 패턴을 학습한 **AI 페르소나(자기 자신의 디지털 분신)** 를 키웁니다. 페르소나는 이후 다른 회사의 테스트에 자율적으로 참여해 추가 보상을 만들어내며, 회사는 인간 1명 + 페르소나 N명의 의견을 한 번에 받아볼 수 있습니다.

### 왜 만들었나 — 시장 페인포인트
1. **사용자 테스트 비용**: 표적 사용자 1명 인터뷰 ≈ $50–200, 5명 표본 확보까지 1–2주.
2. **재현 불가능성**: 같은 사용자에게 다시 테스트를 시키기 어렵고, 인터뷰는 일회성 데이터로 휘발됨.
3. **데모그래픽 검증의 비싼 비용**: "암호화폐 초보 30대 한국인 여성"을 5명 모집하려면 리쿠르팅 회사가 필요.

41R은 이 셋을 한 번에 풉니다 — **사용자가 한 번 참여하면 그의 페르소나가 영구 자산으로 남고, 다른 회사가 ~$0.24/run으로 그 페르소나를 빌려 쓸 수 있습니다.**

### 핵심 기술 차별화
- **3-layer Trust Contract**: Audit-chain citation + Confirmation label + Fidelity gate. LLM이 만든 진단 한 줄도 원본 리포트의 특정 turn 까지 추적되며, 회사가 "이게 사람이 본 문제인지 페르소나만 본 문제인지" 즉각 판별할 수 있습니다.
- **In-process Stagehand 하이브리드**: Browserbase Stagehand가 Playwright를 운전하고, vision LLM이 화면을 보며 다음 액션을 결정합니다. 인-프로세스 채점으로 cross-language hop을 제거해 단일 페르소나 1회 실행 ~24¢.
- **20-axis Persona Vector**: `test_style × expertise × feedback_pattern × reliability` (4 그룹 × 5 차원)으로 페르소나 성향을 수치화. 데모그래픽까지 합쳐 **코호트 매칭 기반 신뢰도 평가**가 가능 — 단순 "AI가 사람을 흉내냄" 이상의 검증 가능한 모델.

---

## 1. 비즈니스 모델과 시스템 개요

### 1.1 가치 흐름 (3개 행위자)

```
┌──────────────┐   ① 테스트 수행      ┌──────────────┐
│  Tester      │  ───── USDC 보상 ──▶│  Tester      │
│  (인간)      │                      │  (페르소나화) │
└──────┬───────┘                      └──────┬───────┘
       │                                     │
       │ ② 3회 누적 → 페르소나 생성          │ ③ 다른 테스트에
       │    (recomputePersona)               │    자동 참여
       ▼                                     ▼
┌──────────────┐  ④ 페르소나 운용    ┌──────────────┐
│  Company     │ ─── x402 micropay ─▶│  Persona     │
│  (테스트     │   ($0.001~$0.10/    │  (24/7       │
│   의뢰자)    │     쿼리)           │   가용)      │
└──────────────┘                     └──────────────┘
```

| 행위자 | 입력 | 출력 | 보상 |
|---|---|---|---|
| Tester | 시간 + 경험 | 리포트 + 페르소나 | USDC + 페르소나 운용 수익 |
| Persona | 인간 행동 패턴 학습 | 자율 테스트 리포트 | (소유자에게 귀속) |
| Company | USDC 예치 + 요구사항 | 인간+페르소나 통합 진단 | 검증된 UX 인사이트 |

### 1.2 단일 테스트 라이프사이클

```
Company POST /api/test/register
  ├─ Solana USDC 디파짓 검증 (또는 dev 환경 bypass)
  ├─ Claude Sonnet 4.6 → checklist + scenarios + questionnaire 자동 생성
  ├─ enable_auto_test=true 면 → 매칭된 N개 페르소나 자동 큐잉
  │                              (stagehand_hybrid + text 모드 dual-queue)
  └─ Test row INSERT, status='active'

Human Tester POST /api/report/submit
  ├─ Wallet signature 검증 (ed25519 + 1회용 nonce)
  ├─ Quality score 산출 (LLM, 0~5점)
  ├─ Power-curve reward = base × (score/5)^1.5
  ├─ Settlement worker가 USDC 전송 (실패 시 exp-backoff)
  └─ testsDone++, 3회 도달 → recomputePersona 트리거

Persona AutoTest (background)
  ├─ Stagehand가 Chromium 인스턴스 운전
  ├─ Per-turn: 페이지 관찰 → vision LLM 의사결정 → 액션 → 스크린샷
  ├─ 5분 inner timeout, 최대 N turns, _session_error 센티넬 캡처
  ├─ In-process scoring: checklist + questionnaire + structured_report + quality
  └─ 90s per-LLM timeout, 12분 outer hardcut

Company GET /experiment/[testId]
  ├─ 인간 vs 페르소나 코호트 비교 (crypto_experience 기반)
  ├─ Cohort × checklist matrix
  └─ POST /diagnosis/generate
       ├─ aggregateForDiagnosis: 페르소나/인간 리포트 통합 + harness-error 분리
       ├─ clusterPainPointDescriptions (Haiku, semantic 클러스터링)
       ├─ synthesizeDiagnosis (Sonnet, 마크다운 진단)
       ├─ validateAuditCitations (citation을 실제 reportId로 검증)
       └─ Fidelity band 배너 → 회사가 신뢰도를 즉시 판단
```

---

## 2. 전체 시스템 아키텍처

### 2.1 서비스 토폴로지

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare R2 CDN                            │
│        (스크린샷 객체 저장, 페르소나 실행마다 N개 업로드)            │
└─────────────────────────────────────────────────────────────────────┘
              ▲                                       ▲
              │ S3 PutObject                          │ public GET
              │                                       │
┌─────────────┴──────────────────┐       ┌────────────┴───────────┐
│        @41rpm/api (Express)    │       │      @41rpm/web        │
│        Node 20 + Chromium      │       │      Next.js 14         │
│        port 4100               │       │      port 3000          │
│                                │       │                         │
│  • routes/   (12 routers)      │       │  • app/ (App Router)    │
│  • services/ (15 services)     │ HTTP  │  • components/          │
│  • middleware/ (4)             │◀──────│  • lib/api.ts           │
│  • schemas/ (Zod)              │       │  • Phantom Wallet       │
│  • Stagehand (인-프로세스)      │       │                         │
└────────┬───────────────┬───────┘       └─────────────────────────┘
         │               │
   HTTP  │               │  Drizzle ORM (pg pool 30)
         │               │
         ▼               ▼
┌────────────────┐  ┌────────────────────┐
│ persona-engine │  │  PostgreSQL        │
│ (FastAPI)      │  │  (Railway 내부)    │
│ Python 3.11+   │  │                    │
│ port 4200      │  │  - tests           │
│                │  │  - testers         │
│ legacy text/   │  │  - personas        │
│  persona_agent │  │  - persona_versions│
│  모드만 사용    │  │  - test_reports    │
└────────────────┘  │  - settlements     │
                    │  - auth_nonces     │
                    └────────────────────┘
                           │
                           ▼
                    ┌────────────────┐
                    │ Solana devnet  │
                    │  - USDC mint   │
                    │  - 41R Token-  │
                    │    2022 (5%    │
                    │    transfer    │
                    │    fee)        │
                    │  - SAS PDAs    │
                    └────────────────┘
```

### 2.2 모노레포 구조 (pnpm workspaces + turborepo)

```
41r-persona-market/
├── apps/
│   ├── api/             Express + Stagehand + Drizzle (TypeScript)
│   ├── web/             Next.js 14 App Router (TypeScript)
│   └── persona-engine/  FastAPI (Python, persona_agent 래퍼)
├── packages/
│   ├── shared/          공통 TypeScript 타입 (PersonaVector, Test, ...)
│   ├── solana-utils/    Token-2022 유틸리티
│   ├── persona-client/  persona-engine HTTP 클라이언트
│   └── contracts/       (예약, 향후 SAS 스키마/Anchor IDL)
├── scripts/             setup / seed / batch / verify
├── docs/                기술 문서 (현재 파일 포함)
├── turbo.json           build/test/lint 의존 그래프
└── pnpm-workspace.yaml
```

**Turborepo 캐시**: `dependsOn: ["^build"]`로 패키지 의존 순서 강제. CI에서 cache hit 8/8이면 ~660ms에 typecheck 완료.

### 2.3 주요 기술 스택

| 레이어 | 선택 | 대안 대비 이유 |
|---|---|---|
| 런타임 | Node 20 (api) + Python 3.11 (engine) | Stagehand는 Node-only, persona_agent의 비전 루프는 기존 Python 자산 |
| 웹 프레임워크 | Express 4 | 미들웨어 생태계 (x402, express-rate-limit), 단순함 |
| ORM | Drizzle 0.38 | TypeScript-first, prepared statements, 마이그레이션 SQL 직시 |
| DB | PostgreSQL | Railway 내부 호스팅, JSON 컬럼이 페르소나 vector 저장에 적합 |
| 프론트엔드 | Next.js 14 App Router | RSC + standalone 빌드 (Docker 친화) |
| 브라우저 자동화 | Browserbase Stagehand 3.1 | Playwright 위에 LLM-driven action 추상화 — 직접 Playwright 코드 작성 대비 ~70% 단축 |
| LLM | Claude Sonnet 4.6 + Haiku 4.5 | Sonnet=생성/검증, Haiku=채점/추출 (cost 비대칭 활용) |
| 결제 | x402 (Coinbase) + 자체 USDC verify fallback | x402 facilitator devnet 불안정 시 fallback |
| 토큰 | Solana Token-2022 (transfer fee 5%) | 페르소나 매매 시 2차 시장 수수료를 프로토콜에 자동 누적 |
| 인증 | ed25519 wallet signature + 1회용 nonce | Web3-native, 중앙화된 인증 서버 불필요 |
| 관측 | pino + LLM JSONL 로그 + deep health | Railway 로그가 JSON parse 잘 함 |

---

## 3. AI 페르소나 시스템 (집중 챕터)

이 챕터는 41R의 핵심 차별점입니다. "LLM에게 사용자 흉내를 시킨다"가 아니라, **검증 가능한 페르소나 모델 + 자율 실행 파이프라인 + 3-layer trust contract** 의 결합이 가치 제안입니다.

### 3.1 PersonaVector — 페르소나의 데이터 모델

```ts
// packages/shared/src/types.ts
export interface PersonaVector {
  test_style: TestStyle;          //  thoroughness, speed, ux_focus,
                                  //  bug_detection, creativity (각 0~1)
  expertise: Expertise;           //  defi, nft, gaming, ai_tools,
                                  //  general_web (각 0~1)
  feedback_pattern: FeedbackPattern;
                                  //  ui_critical, security_aware,
                                  //  performance_sensitive,
                                  //  accessibility_focus, detail_oriented
  reliability: Reliability;       //  quality_score, consistency,
                                  //  response_rate
  demographics?: Demographics;    //  age_group, tech_literacy,
                                  //  crypto_experience, design_sensitivity,
                                  //  patience_level
  ux_preferences?: UxPreferences; //  visual_style, font_size_preference,
                                  //  information_density, ...
  voice_sample: string;           //  페르소나가 한국어로 자기를 말하는
                                  //  1~2문장 (LLM 생성)
}
```

**왜 이렇게 설계했나**:
- **20+ 축의 수치화**: 단순한 "이 사용자는 DeFi 잘 안다" 텍스트가 아니라, `expertise.defi: 0.82` 같은 수치라서 코사인 거리·코호트 매칭이 가능합니다.
- **2-tier 정보**: `vector` (수치) + `voice_sample` (LLM이 친근하게 표현) — 매칭은 vector로, UI 노출은 voice_sample로 하여 페르소나가 추상적 데이터가 아닌 "사람"으로 느껴집니다.
- **demographics 옵셔널**: 초기 페르소나는 vector만 있어도 작동하지만, 3-layer trust의 코호트 매칭은 demographics가 채워질수록 강해집니다.

### 3.2 페르소나 생성 파이프라인 — `recomputePersona`

```
┌────────────────────────┐
│  Tester profile        │ (등록 시 입력)
│   + 누적 N개 리포트     │
└───────────┬────────────┘
            │
            ▼  N >= MIN_REPORTS_FOR_PERSONA (= 3)
┌────────────────────────┐
│  generatePersona       │ Claude Sonnet 4.6
│  (services/llm.ts)     │
│                        │ • 입력: profile + 최신 N개 리포트
│                        │ • 출력: PersonaVector (JSON)
└───────────┬────────────┘
            │
            ▼  실패 시
┌────────────────────────┐
│  Profile-driven        │ 결정론적 fallback
│  fallback              │ (services/persona.ts)
│                        │ • profile만으로 vector 합성
│                        │ • 같은 profile → 같은 vector
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  SAS attestation       │ Solana Attestation Service
│  (services/sas.ts)     │ • Quality tier 산출 (Bronze/Silver/Gold/Diamond)
│                        │ • On-chain attest, 실패 시 local demo ID
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  persona_versions      │ 매 호출마다 새 version row
│  + personas (active)   │ → 페르소나 진화 audit trail
└────────────────────────┘
```

**구현 핵심** (`apps/api/src/services/persona.ts`):
- **트리거 3가지**: `manual` (사용자 명시), `report_submit` (자동, fire-and-forget), `admin` (운영)
- **Fallback의 의미**: LLM이 죽어도 페르소나 생성은 멈추지 않음. profile만으로 결정론적 vector를 합성하기 때문에 "동일 profile → 동일 fallback vector"가 보장되어 매칭이 무너지지 않음.
- **persona_versions 테이블**: 페르소나는 시간이 지날수록 진화한다는 **calibration flywheel** 가설을 지원하기 위한 audit trail. 어떤 리포트들이 N번째 버전을 만들었는지 추적 가능.

### 3.3 페르소나 매칭 — `matchPersonas`

회사가 테스트를 등록하면, 어떤 페르소나가 이 테스트에 적합한지 자동으로 골라야 합니다.

```ts
// apps/api/src/services/matching.ts (요약)
export async function matchPersonas(
  testDescription: string,        // 회사가 적은 요구사항
  targetUrl: string,
  personas: PersonaWithMeta[],    // 모든 활성 페르소나
  maxResults: number = 5,
): Promise<MatchResult[]>
```

**2-tier 알고리즘**:
1. **LLM ranking** (1차): Claude Sonnet에게 "이 테스트 설명과 N개 페르소나 중 가장 적합한 5개를 골라달라" 호출. JSON 응답.
2. **Keyword fallback** (LLM 실패 시): `keywordToExpertise` 매핑(`"defi" → expertise.defi`)으로 score 산출.

**왜 LLM을 1차로 두나**:
- 키워드 매칭은 "이 테스트는 DeFi" → DeFi 페르소나 → 100% 적합 같이 단순합니다.
- 실제로는 "DeFi 신규 사용자 온보딩" 테스트는 **DeFi 초보 페르소나**가 적합한 반면 DeFi 전문가는 부적합. 이런 뉘앙스를 LLM이 잡아냅니다.
- 단, LLM은 timeout/reject 가능성이 있어 keyword fallback이 필수.

### 3.4 자율 실행 — `stagehand_hybrid` 파이프라인

페르소나가 실제로 웹사이트를 방문해 테스트를 수행하는 핵심 모듈. **이 부분이 41R의 가장 큰 기술적 가치**입니다.

```
                  ┌──────────────────────────────────────┐
                  │  POST /api/dev/autotest/trigger     │
                  │  (또는 회사 register 시 auto-queue)   │
                  └─────────────────┬────────────────────┘
                                    │
                                    │ selectQueueableJobs(matches, modes)
                                    │   ├─ already-covered dedup
                                    │   └─ in-batch dedup (testerAddr 기준)
                                    │
                                    ▼
                  ┌──────────────────────────────────────┐
                  │  runStagehandHybridAndPersist        │
                  │  (services/stagehand_hybrid.ts)      │
                  │                                      │
                  │  ┌────────────────────────────────┐  │
                  │  │ raceWithTimeout (12분 outer)   │  │
                  │  │                                │  │
                  │  │  ┌──────────────────────────┐  │  │
                  │  │  │ Stagehand init           │  │  │
                  │  │  │ • Chromium spawn         │  │  │
                  │  │  │ • LLM = Sonnet 4.6       │  │  │
                  │  │  │ • Persona soul 주입       │  │  │
                  │  │  └──────┬───────────────────┘  │  │
                  │  │         │                      │  │
                  │  │         ▼ raceWithTimeout(5분) │  │
                  │  │  ┌──────────────────────────┐  │  │
                  │  │  │ Per-turn loop:           │  │  │
                  │  │  │  ① observe (page text +  │  │  │
                  │  │  │     a11y tree, 20 nodes) │  │  │
                  │  │  │  ② vision LLM decide     │  │  │
                  │  │  │  ③ page.act(action)      │  │  │
                  │  │  │  ④ screenshot → R2       │  │  │
                  │  │  │  ⑤ session log push      │  │  │
                  │  │  │  → 종료 조건까지 반복      │  │  │
                  │  │  └──────┬───────────────────┘  │  │
                  │  │         │                      │  │
                  │  │         ▼ raceWithTimeout(90s) │  │
                  │  │  ┌──────────────────────────┐  │  │
                  │  │  │ In-process scoring:      │  │  │
                  │  │  │  • scoreChecklist        │  │  │
                  │  │  │  • answerQuestionnaire   │  │  │
                  │  │  │  • generateStructured-   │  │  │
                  │  │  │    Report                │  │  │
                  │  │  │  • calculateQuality      │  │  │
                  │  │  └──────┬───────────────────┘  │  │
                  │  │         │                      │  │
                  │  │         ▼                      │  │
                  │  │  ┌──────────────────────────┐  │  │
                  │  │  │ DB persist:              │  │  │
                  │  │  │  test_reports INSERT     │  │  │
                  │  │  │  + sentinels:            │  │  │
                  │  │  │   _structured_report     │  │  │
                  │  │  │   _quality_breakdown     │  │  │
                  │  │  │   _session_error (있으면) │  │  │
                  │  │  └──────────────────────────┘  │  │
                  │  └────────────────────────────────┘  │
                  └──────────────────────────────────────┘
```

**3-layer Timeout 보호** (이 시스템이 production-ready인 이유):

| 레이어 | 캡 | 적용 범위 | 환경변수 |
|---|---|---|---|
| Inner stagehand | 5분 | 브라우저 실행만 (page.act, navigation) | `RUN_TIMEOUT_MS` |
| Per-LLM-call | 90초 | scoreChecklist / answerQuestionnaire / generateStructuredReport 각각 | `SCORING_TIMEOUT_MS` |
| Outer persist hardcut | 12분 | 전체 chain (browser + scoring + R2 + DB) | `PERSIST_HARDCUT_MS` |

`raceWithTimeout` + `TimeoutError`가 모든 레이어에서 공통 사용. 타임아웃 발생 시 `TimeoutError`에 label (`scoreChecklist(abcd1234)` 같이)이 담겨 root cause analysis 가능.

**Queue Dedup** (`selectQueueableJobs`): 한 testerAddr에 페르소나 2개가 매칭되면 unique constraint 위반 전에 ~$0.10 stagehand+scoring을 낭비합니다. 이걸 막는 pure 함수 + 6개 단위 테스트.

**Session Error Sentinel** (`_session_error`): Stagehand가 init/phase_a-d/final/cleanup 중 어디서 죽었는지 + last_action을 캡처해 `test_reports.questionnaireAnswers`에 저장. 스키마 변경 없이 RCA 가능.

### 3.4.5 PersonaVector → 행동 주입 메커니즘 (이 섹션이 핵심)

**근본 질문**: "페르소나 A와 페르소나 B는 같은 Sonnet에 다른 system prompt를 줬을 뿐 아닌가?" 만약 그렇다면 페르소나는 단순한 prompt engineering이고, "검증 가능한 모델"이라 부를 가치가 없습니다. 답: **PersonaVector의 명명된 차원이 코드의 threshold gate를 통해 행동을 결정**하기 때문에, 페르소나 차이는 prompt의 자연어 차이가 아니라 **연산 가능한 vector 거리의 차이**입니다.

이 섹션은 vector가 어떻게 실제 브라우저 액션으로 변환되는지를 코드 단위로 보입니다.

#### (a) System Prompt 초기화 — `personaOneliner`

`routes/autotest.ts:418-429`에서 매 stagehand 실행마다 페르소나 정체성의 **profile 일부**가 한 줄로 압축되어 Stagehand의 systemPrompt에 주입됩니다:

```ts
// apps/api/src/routes/autotest.ts:418-429
const profile = (tester?.profile ?? {}) as Record<string, unknown>;
const personaOneliner = [
  profile.age_range && `${profile.age_range} age`,
  profile.occupation,
  profile.region,
  profile.crypto_experience && `${profile.crypto_experience} crypto`,
  profile.primary_device && `on ${profile.primary_device}`,
].filter(Boolean).join(', ') || 'a typical end-user';
```

생성 결과 예시:
```
페르소나 A (DeFi 트레이더): "30s age, defi-trader, KR, advanced crypto, on desktop"
페르소나 B (학생):           "10s age, student, US, none crypto, on mobile"
페르소나 C (디자이너):        "20s age, designer, JP, beginner crypto, on mobile"
```

**의도된 thinness**: 이 한 줄은 Stagehand의 LLM이 페이지를 보고 "이 사용자라면 무엇을 클릭할까?"를 판단할 때 사용하는 정체성 hint입니다. **풀 vector가 system prompt에 들어가지 않는 이유**: prompt를 두껍게 만들면 LLM이 vector 수치에 매달려 행동의 유연성이 떨어집니다. 자연어 한 줄 + 차후 행동 생성 단계에서 vector를 참조하는 2-tier 설계가 더 안정적입니다.

#### (b) Per-turn Vector Reference — `generatePersonaActions()` (Phase D)

진짜 vector → behavior 변환은 `services/llm.ts:680-832`의 `generatePersonaActions()`에서 일어납니다. 이 함수가 Phase D(persona-specific exploration)에 들어갈 5-8개의 액션을 **vector를 직접 분해해** 만들어냅니다.

**Step 1 — Threshold gate로 focus area 추출**:

```ts
// apps/api/src/services/llm.ts:700-739 (요약)
const focusAreas: string[] = [];

// 1. 일반 focus (도메인 무관, vector trait가 강할 때만 발화)
if (persona.feedback_pattern.security_aware > 0.7) {
  focusAreas.push(isDefi || isNft
    ? 'security (HTTPS, token approval scopes, slippage+approval safety)'
    : 'security (HTTPS, CSP headers, OAuth scope clarity, input validation)');
}
if (persona.feedback_pattern.performance_sensitive > 0.7)
  focusAreas.push('performance (loading speed, animation smoothness)');
if (persona.feedback_pattern.ui_critical > 0.7)
  focusAreas.push('UI quality (visual glitches, alignment, color contrast)');
if (persona.feedback_pattern.accessibility_focus > 0.7)
  focusAreas.push('accessibility (screen reader labels, keyboard nav, font sizes)');

// 2. 도메인 × 전문성 교차 (둘 다 강해야 발화 — "DeFi 페르소나가 SaaS에서 슬리피지 묻기" 방지)
if (persona.expertise.defi > 0.7 && isDefi)
  focusAreas.push('DeFi specifics (slippage controls, price impact, fee breakdown, MEV protection)');
if (persona.expertise.nft > 0.7 && isNft)
  focusAreas.push('NFT specifics (image loading, metadata display, ownership verification)');

// 3. test_style 트레이트
if (persona.test_style.thoroughness > 0.8)
  focusAreas.push('edge cases (empty states, error recovery, boundary values)');

// 4. Demographics (vector의 옵셔널 필드)
const demo = persona.demographics;
if (demo) {
  if (demo.age_group === 'teen')
    focusAreas.push('teen UX (would a 16-year-old understand this without help?)');
  if (demo.tech_literacy < 0.3)
    focusAreas.push('non-technical user (confusing jargon, fear-inducing warnings)');
  if (demo.patience_level < 0.3)
    focusAreas.push('impatient user (how many clicks to complete core task?)');
}

// 5. UX preferences
const ux = persona.ux_preferences;
if (ux) {
  if (ux.mobile_first)
    focusAreas.push('mobile-first (test at 375px width, thumb-reachable zones, 44px+ tap targets)');
  if (ux.color_contrast_need > 0.7)
    focusAreas.push('contrast (text-on-bg ratios on dark themes, button distinguishability)');
}
```

**핵심 통찰**: focus area 리스트는 vector 수치의 **결정론적 함수**입니다. 같은 vector → 같은 focus area 리스트. LLM이 자유롭게 해석하는 게 아니라 코드가 먼저 좁힌 뒤 LLM에 넘깁니다.

**Step 2 — Persona context 내러티브 합성**:

```ts
// apps/api/src/services/llm.ts:744-754
let personaContext = '';
if (demo) {
  const ageLabel = { teen: '10대 청소년', young_adult: '20-30대',
                     adult: '30-50대', senior: '50대 이상' }[demo.age_group];
  personaContext +=
    `\nThis tester is a ${ageLabel} user with tech literacy ` +
    `${demo.tech_literacy.toFixed(1)}/1.0 and crypto experience ` +
    `${demo.crypto_experience.toFixed(1)}/1.0.`;
  if (demo.design_sensitivity > 0.7)
    personaContext += ' They care deeply about visual design quality.';
  if (demo.patience_level < 0.4)
    personaContext += ' They have LOW patience — will abandon if confused.';
}
```

**Step 3 — Domain guardrail로 타입 오염 방지**:

```ts
// apps/api/src/services/llm.ts:768-786 (요약)
const domainGuardrail = (() => {
  switch (domainCategory) {
    case 'defi': case 'nft':
      return 'Blockchain/web3 site — slippage, wallet approval, gas, token metadata ARE relevant.';
    case 'devtools':
      return 'Devtools/deploy platform — focus on docs discoverability, API/SDK clarity. ' +
             'Do NOT ask for slippage, token approval, NFT metadata, or DeFi-specific checks.';
    case 'ai_tools':
      return 'AI platform — model catalog, pricing per token, rate limits matter. ' +
             'Do NOT ask for wallet connect, NFT mint checks.';
    default:
      return 'General SaaS / marketing site. Do NOT ask for slippage, token approval, NFT, ' +
             'DeFi-specific, or other blockchain-specific checks — they do not apply.';
  }
})();
```

이게 **"prompt 따로, vector 따로" 함정을 막는** 핵심 layer입니다. DeFi 전문 페르소나가 일반 SaaS 사이트를 평가할 때 "왜 슬리피지 표시가 없나요?"를 묻기 시작하면 진단이 즉시 노이즈가 됩니다. Domain guardrail이 vector의 expertise.defi가 1.0이어도 SaaS 사이트에서는 비활성화되도록 강제합니다.

**Step 4 — 최종 Haiku 프롬프트 조립**:

```ts
// apps/api/src/services/llm.ts:788-816 (요약)
const prompt = `You are generating browser test actions for a QA tester
with these focus areas:
${focusAreas.map((f, i) => `${i + 1}. ${f}`).join('\n')}
${personaContext}

Target URL: ${targetUrl}
Domain category: ${domainCategory}
${domainGuardrail}
${siteContext}    // discovered links + nav labels

The tester already performed these base checklist actions:
${baseChecklist.map(c => `- ${c.id}: ${c.task}`).join('\n')}

Generate 5-8 ADDITIONAL browser actions this persona would specifically do.
CRITICAL RULES:
1. At least 2-3 actions MUST navigate to DIFFERENT pages
2. Vary the interaction types: click buttons, open modals, scroll to sections,
   try form inputs, toggle dark/light mode, resize viewport
3. Actions must be concrete and executable by a browser automation tool
4. Each action should result in a visually DIFFERENT screen state
5. Do NOT repeat actions already in the checklist
6. Stay on-domain per the "Domain category" above

Return as JSON array: [{ "id": "PA01", "action": "...", "reason": "..." }]`;

const response = await withRoute('persona_actions', () => client.messages.create({
  model: HAIKU,        // Claude Haiku 4.5 — 속도 + 비용 최적화
  max_tokens: 1000,
  messages: [{ role: 'user', content: prompt }],
}));
```

이 5-8개 액션이 Phase D에서 `page.act(action)`로 차례차례 실행되어 페르소나별로 **다른 스크린샷, 다른 session log, 다른 turn 시퀀스**를 만들어냅니다.

#### (c) 두 페르소나의 Prompt Diff 예시

같은 사이트(가정: DeFi 거래소)에 대해 두 페르소나를 돌렸을 때 `generatePersonaActions()`가 만들어내는 프롬프트 차이:

**페르소나 A — 노련한 DeFi 트레이더, 모바일 사용자, 디자인 무관심**:
```
PersonaVector:
  feedback_pattern: { security_aware: 0.85, performance_sensitive: 0.72,
                      ui_critical: 0.31, accessibility_focus: 0.20,
                      detail_oriented: 0.78 }
  expertise: { defi: 0.92, nft: 0.45, gaming: 0.10,
               ai_tools: 0.30, general_web: 0.55 }
  test_style: { thoroughness: 0.82, speed: 0.65, ux_focus: 0.40,
                bug_detection: 0.75, creativity: 0.50 }
  demographics: { age_group: 'adult', tech_literacy: 0.85,
                  crypto_experience: 0.90, design_sensitivity: 0.20,
                  patience_level: 0.35 }
  ux_preferences: { mobile_first: true, visual_style: 'minimal',
                    color_contrast_need: 0.4, ... }

→ 추출된 focusAreas:
   1. security (HTTPS, token approval scopes, slippage+approval safety, ...)
   2. performance (loading speed, animation smoothness)
   3. DeFi specifics (slippage controls, price impact, fee breakdown, MEV protection)
   4. edge cases (empty states, error recovery, boundary values)
   5. mobile-first (test at 375px width, thumb-reachable zones)

→ personaContext:
   "This tester is a 30-50대 user with tech literacy 0.9/1.0 and
    crypto experience 0.9/1.0.
    They have LOW patience — will abandon if confused.
    Prefers minimal design style. Primarily uses mobile."

→ Haiku가 만들어내는 액션 (대표):
   PA01: "Open the swap interface and inspect the slippage tolerance setting"
   PA02: "Initiate a small swap and check if the price impact + MEV warning shows"
   PA03: "Try to swap with insufficient balance to test error handling"
   PA04: "Resize viewport to 375px and verify the swap UI remains usable"
   PA05: "Inspect token approval flow — does it show the exact spending cap?"
```

**페르소나 B — 학생, 암호화폐 처음, 디자인 민감, PC 사용자**:
```
PersonaVector:
  feedback_pattern: { security_aware: 0.20, performance_sensitive: 0.40,
                      ui_critical: 0.85, accessibility_focus: 0.30,
                      detail_oriented: 0.45 }
  expertise: { defi: 0.10, nft: 0.20, gaming: 0.55,
               ai_tools: 0.50, general_web: 0.70 }
  test_style: { thoroughness: 0.45, speed: 0.55, ux_focus: 0.88,
                bug_detection: 0.35, creativity: 0.70 }
  demographics: { age_group: 'teen', tech_literacy: 0.45,
                  crypto_experience: 0.10, design_sensitivity: 0.85,
                  patience_level: 0.25 }
  ux_preferences: { mobile_first: false, visual_style: 'playful',
                    color_contrast_need: 0.6, ... }

→ 추출된 focusAreas:
   1. UI quality (visual glitches, alignment, color contrast, responsive layout)
   2. teen UX (relatable language? engaging visuals? would a 16yo understand?)
   3. non-technical user (confusing jargon, missing crypto term explanations,
      fear-inducing warnings)
   4. design quality (visual hierarchy, whitespace, typography, brand feeling)
   5. impatient user (how many clicks to complete core task?)

→ personaContext:
   "This tester is a 10대 청소년 user with tech literacy 0.5/1.0 and
    crypto experience 0.1/1.0.
    They care deeply about visual design quality.
    They have LOW patience — will abandon if confused.
    Prefers playful design style."

→ Haiku가 만들어내는 액션 (대표):
   PA01: "Try to understand what the page does by reading only the headlines —
          is it clear without crypto knowledge?"
   PA02: "Click the 'Connect Wallet' button and see if there's any explanation
          for what a wallet is or why it's needed"
   PA03: "Scroll through the page and look for confusing financial jargon
          (slippage, AMM, liquidity pool) without explanation"
   PA04: "Inspect the visual design — is the typography hierarchy clear?
          Are the colors harmonious or jarring?"
   PA05: "Time how long it takes to find the 'Help' or 'How it works' section"
```

**Diff의 의미**:
- 두 페르소나는 **완전히 다른 5개 액션**을 만들어냅니다 — 같은 페이지를 보지만 보는 곳이 다릅니다.
- 페르소나 A는 슬리피지/MEV/approval 같은 **DeFi-native concern**을 검증.
- 페르소나 B는 jargon 부재/온보딩 부족/디자인 일관성 같은 **신규 사용자 friction**을 검증.
- 같은 사이트 진단에 두 페르소나가 함께 참여하면 회사는 **숙련도 양극단의 페인포인트**를 동시에 받습니다 — 인간 5명 인터뷰로는 비싸고 어려운 일.
- **재현 가능성**: 같은 vector로 다시 돌리면 같은 focus area + 같은 personaContext가 나옵니다. LLM의 randomness는 액션 표현에만 들어가고, 행동의 *축*은 vector가 결정.

#### 왜 이 메커니즘이 "vector = 검증 가능한 모델"의 증거인가

대안 1 — **순수 prompt engineering** ("당신은 DeFi 트레이더입니다, ..."):
- 페르소나 차이 = 자연어 문장의 차이 → 검증 불가
- LLM이 대충 "DeFi 트레이더처럼 행동"하는데 어떤 차원에서 차이 나는지 측정 불가
- 두 페르소나가 우연히 비슷한 행동을 해도 알 수 없음

대안 2 — **단일 임베딩 vector** (예: text-embedding으로 페르소나 묘사 인코딩):
- 매칭은 가능하지만 vector → behavior 변환이 black box
- "이 페르소나는 왜 이 액션을 했나?"를 설명 못 함

**41R의 선택 — Named-dimension vector + 결정론적 threshold gate**:
- ✅ vector 차원이 모두 의미를 갖음 (`feedback_pattern.security_aware`)
- ✅ threshold (e.g., > 0.7)가 코드에 명시 → behavior trigger가 추적 가능
- ✅ 코호트 매칭이 의미를 가짐 (`crypto_experience: 0.2~0.4`인 페르소나끼리 묶기)
- ✅ A/B 페르소나 비교가 vector 거리 = behavior 차이로 직접 환산
- ✅ 회사 UI에서 20-axis radar로 시각화 가능 (`components/persona-radar-20.tsx`)
- ✅ 페르소나가 진화해도 (`persona_versions`) vector 차분으로 변화 추적 가능

이게 41R 페르소나가 "Sonnet에 다른 system prompt를 줬을 뿐"이 아닌 이유입니다.

### 3.5 3-Layer Trust Contract — 진단 신뢰성 보장

페르소나가 100명 돌고 LLM이 "결제 단계에서 사용자가 혼란을 겪습니다"라는 진단을 내놓았을 때, 회사는 **"이게 진짜인지" 어떻게 검증할까**? 41R의 답이 3-layer trust contract입니다.

#### Layer 1: Audit-chain Citations
```
회사가 보는 진단 문장:
  "결제 모달에서 Approve 버튼이 즉시 비활성화되어
   사용자가 진행 불가 [a3f2c1d8·t7] [b9e4f2a1·t12]"

뒤의 [a3f2c1d8·t7] 는:
  reportId 8자리 prefix · turn 번호
  → 어떤 페르소나의 7번째 turn에서 관찰됐는지 추적 가능
```

`validateAuditCitations()`가 진단 마크다운을 스캔해 모든 citation을 실제 `perPersona[].reportId` 셋과 대조. 일치하지 않으면 `> ⚠ Audit check: N citation(s) reference report IDs not in this test's data` 푸터를 추가합니다.

**Subtle bug fix**: regex가 `[ ... ]` 안에서만 매칭되도록 했는데, 이전에는 hex 색상 `#14F195` (Solana 브랜드 그린)도 reportId로 오인해 모두 hallucination 경고를 띄웠습니다. 회귀 테스트로 락인.

#### Layer 2: Confirmation Labels
```
페인포인트:
  "지갑 연결 시 진입 차단"
  confirmation: both     ← 사람도 봤고 페르소나도 봤음
  citations: 8개 (인간 3 + 페르소나 5)

페인포인트:
  "결제 단계에서 모달이 깜빡임"
  confirmation: persona-only   ← 페르소나만 본 문제
  citations: 6개 (전부 페르소나)
  → "수동 재현 필요" 캐비어트 자동 부착
```

이를 가능하게 한 두 가지 메커니즘:
1. **Manual report에서 페인포인트 추출**: 인간 리포트는 자유 텍스트라 구조화된 페인포인트가 없습니다. Task #12로 Haiku가 manual report들을 병렬 처리해 페인포인트 후보를 만듭니다 (`diagnosis.human_pain_points` 라우트 태그).
2. **Semantic clustering**: "로그인 벽 접근 불가"와 "지갑 연결 시 진입 차단"은 표현이 달라도 같은 문제. 단순 whitespace+lowercase 정규화로는 못 잡고, Haiku로 클러스터링합니다 (`clusterPainPointDescriptions`, ~$0.0015/diagnosis). 이게 없으면 `both` 라벨이 영원히 안 뜹니다.

#### Layer 3: Fidelity Gate Banner
```
┌────────────────────────────────────────────┐
│ ⚠️ Low Fidelity                            │
│ 페어드 샘플 3개 · 항목 일치율 28%           │
│ 페르소나-인간 동의가 낮습니다. 페르소나      │
│ 결과를 product 결정의 단독 근거로 쓰지     │
│ 마세요.                                    │
└────────────────────────────────────────────┘
```

`computeFidelityBand(itemAgreementRate, pairedCount)` → `'high' | 'medium' | 'low' | 'n/a'`. 진단 마크다운 맨 위에 blockquote로 prepend되고 React 컴포넌트가 색깔 배너로 렌더.

**임계값**: paired ≥ 5 + agreement ≥ 0.6 → high · ≥ 0.4 → medium · 그 외 low · paired = 0 → n/a.

#### Empty-session Guard + Harness-error Split
**실제로 일어났던 사고** (jup.ag, 2026-04-25):

Stagehand가 14개 페르소나에서 init 단계에 죽었고 (turns ≤ 1, outcome = 'error'), 채점 단계의 Sonnet/Haiku는 evidence 없이 checklist 텍스트만으로 그럴듯한 실패 시나리오를 지어냈습니다 ("mobile viewport drop", "JSON parse mid-session"). 진단 aggregator가 이를 **rank-1 product finding**으로 promote.

5개 layer로 fix:
1. `scoring/report.ts` — `outcome=error && turns ≤ 1` 시 Haiku call 단락, 빈 페인포인트 리턴
2. `scoring/checklist.ts` — 같은 가드, rule-based fallback으로 라우팅
3. `scoring/diagnosis.ts` — `isHarnessErrorOutcome()` predicate, 새 `harnessErrorReports[]` 필드 — 에러 리포트는 페인포인트 맵에서 빠지고 별도 리스트로 이동
4. **Synthesis prompt §5-1** — 이들을 "41R 플랫폼 자동화 실패"로 라벨, R-recommendation 금지
5. **Regression fixture** — `diagnosis.test.ts`가 14-에러 페르소나를 재현 → `painPointMap.size === 0 && harnessErrorReports.length === 14` 단언

**보수적 분리**: 오직 `outcome === 'error'`만 트리거. `unknown`/empty는 그대로 페인포인트 맵에 남음 — manual 리포트는 `_quality_breakdown` 센티넬이 없는 게 정상이라 포함되어야 함.

### 3.6 Diagnosis 생성 파이프라인 — `generateAndStoreDiagnosis`

```
GET trigger
  └─ aggregateForDiagnosis(testId)
      ├─ test, manual reports, persona reports 조회
      ├─ accumulatePainPointsForReport (per-report pain point 추출)
      │   └─ harness error는 harnessErrorReports로 분리
      └─ DiagnosisAggregate (시너지스 입력)

Diagnosis pipeline:
  ① clusterPainPointDescriptions (Haiku, ~$0.0015)
     └─ 의미적으로 같은 페인포인트 그룹화 → both 라벨 가능
  ② buildSynthesisPayload (pure builder, 테스트 가능)
     └─ harnessErrorReports 30개 cap, citation prefix 일치
  ③ synthesizeDiagnosis (Sonnet 4.6, ~$0.04)
     └─ Korean markdown, citation 형식 강제
  ④ validateAuditCitations
     └─ 알 수 없는 reportId citation 시 경고 푸터 추가
  ⑤ computeFidelityBand → 배너 prepend
  ⑥ tests.diagnosisMarkdown UPDATE

Total cost: ~$0.05 per diagnosis (페르소나 N에 무관)
```

**비용 관점 정리** (LLM call 단가, 2026-04 기준):
- Persona 1회 stagehand_hybrid 실행: ~24¢
- Persona 1회 text 모드: ~5¢
- Diagnosis 1회: ~5¢ (Sonnet synthesis ~4¢ + Haiku clustering 0.15¢ + Haiku human extraction N×~0.5¢)

100명 페르소나 + 1 진단 = ~$24 + $0.05. 동일 표본을 인간으로 모으려면 $5,000+ + 1주.

---

## 4. 백엔드 아키텍처 (apps/api)

### 4.1 레이어 구조

```
src/
├── index.ts          앱 진입점 (CORS, x402 mw, 라우터 마운트, settlement worker boot)
├── config/
│   ├── env.ts        Zod 검증된 단일 진실원 env (boot 시 fail-fast)
│   └── cors.ts       allowlist (env 오버라이드 가능)
├── middleware/
│   ├── auth.ts       requireSignedRequest (ed25519 + nonce)
│   ├── rate-limit.ts express-rate-limit, wallet-keyed bucket
│   ├── x402.ts       Coinbase x402 + USDC verify fallback
│   └── dev_auth.ts   /api/dev/* 게이트 (DEV_TEST_KEY 필요)
├── schemas/          Zod 입력 검증 (validateBody)
├── routes/           라우터 12개, /api/{test,tester,report,...}
├── services/         도메인 로직 15개
│   ├── scoring/      체크리스트/설문/리포트/quality/diagnosis/...
│   └── browser_quirks/ 쿠키 동의 등 사이트별 우회 로직
├── db/               Drizzle (schema.ts + index.ts)
└── logger.ts         pino + childLogger
```

**원칙**:
- 라우트 핸들러는 얇게 (try/catch + 서비스 호출 + JSON 응답).
- 비즈니스 로직은 services/. 테스트 가능하도록 pure하게 유지.
- LLM 호출은 항상 `withRoute('tag', () => client.messages.create(...))`로 래핑 → JSONL 비용 추적.

### 4.2 데이터 모델 (Drizzle + Postgres)

핵심 테이블 8개:

| 테이블 | 핵심 컬럼 | 역할 |
|---|---|---|
| `tests` | id, companyAddr, targetUrl, requirements, status, diagnosisMarkdown | 회사가 등록한 테스트 |
| `test_cases` | testId, type, content (JSON) | LLM 생성된 checklist/scenario/questionnaire |
| `testers` | walletAddress, displayName, profile, testsDone, personaId | 인간 테스터 |
| `personas` | id, testerAddr, vector (JSON), isActive, sasAttestId | 활성 페르소나 (1 tester = 1 active) |
| `persona_versions` | personaId, versionNum, vector, sourceReportIds | 페르소나 진화 audit trail |
| `test_reports` | id, testerAddr, testId, isPersonaTest, sourceMode, qualityScore, checklistResults, questionnaireAnswers (sentinels 포함) | 리포트 (인간 + 페르소나 공통) |
| `settlements` | testId, payerAddr, payeeAddr, amountToken, txSignature, retryCount | USDC 정산 큐 |
| `auth_nonces` | nonce, walletAddress, expiresAt, usedAt | wallet 인증용 1회용 nonce |

**Unique constraint 핵심**: `test_reports (testerAddr, testId, isPersonaTest, sourceMode)` — 한 페르소나가 한 테스트에 한 모드로 1번만 보고 가능. queue dedup이 이 제약을 미리 알고 막아야 비용 낭비 방지.

**Migration**: drizzle-kit으로 `apps/api/drizzle/*.sql` 버저닝. Railway 배포 시 `db:migrate` (push가 아님 — 의도치 않은 drop 방지).

### 4.3 LLM 사용 추적 (`anthropic_client.ts`)

```ts
// AsyncLocalStorage로 라우트 태그 전파
withRoute('diagnosis', async () => {
  return await withRequestId('test-abc-123', async () => {
    return await client.messages.create({...});
  });
});
```

매 호출이 `/tmp/llm-usage.jsonl`에 한 줄 JSON으로 append:
```json
{"ts":"2026-04-26T12:00:00Z","model":"claude-haiku-4-5-20251001",
 "route":"diagnosis","request_id":"test-abc-123",
 "input_tokens":1234,"output_tokens":567,"prompt_hash":"sha256..."}
```

`scripts/usage-summary.ts`가 이를 읽어 모델별/서비스별/라우트별 토큰 합산 + 중복 prompt 탐지. **비용 회귀가 보임**.

### 4.4 보안 모델

#### Wallet-signed Request
```
1. Client GET /api/auth/nonce?wallet=ABC → { nonce, expiresAt }
2. Phantom signMessage(nonce) → base58 signature
3. Client POST /api/test/register
   Headers: x-wallet-address, x-nonce, x-signature
4. Server middleware/auth.ts:
   - nonce 조회 + usedAt UPDATE (1회용)
   - 5분 TTL 검증
   - ed25519 서명 검증
   - req.signedWallet 세팅 → 핸들러에서 body wallet과 일치 확인
```

이 패턴을 모든 mutating 라우트에 적용 (`POST /tester/register`, `POST /report/submit`, `PUT /tester/:wallet`, `POST /test/register`). Web3-native라서 이메일+비밀번호 같은 중앙화 인증이 불필요합니다.

#### 그 외 layer
- **CORS allowlist**: localhost + Railway 도메인. `CORS_ALLOWED_ORIGINS` 환경변수로 오버라이드.
- **Rate limit**: wallet-keyed bucket. autotest 2/min, report submit 5/min, LLM 생성 10/min.
- **Zod 스키마**: 모든 mutating POST에 `validateBody(schema)` 적용.
- **Production env safety**: `SKIP_PAYMENT_VERIFY=true`는 `NODE_ENV=production`에서 강제 false (Zod schema에서 차단).

### 4.5 관측성

- **pino 구조화 로그**: 모든 로그가 JSON. Railway가 깔끔하게 파싱.
- **Deep health check**: `/api/health?deep=1`이 DB SELECT 1 + persona-engine /health + Solana RPC getHealth 평행 체크. 어느 하나라도 실패 시 503.
- **Settlement worker**: exp-backoff 30s → 1m → 5m → 15m, 24h MAX_AGE 후 dead-letter. Railway 배포 시 boot에서 자동 시작.

---

## 5. 프론트엔드 아키텍처 (apps/web)

### 5.1 Next.js 14 App Router 구성

```
app/
├── page.tsx                     랜딩 (KPI 대시보드, /api/dashboard 단일 콜)
├── layout.tsx                   글로벌 레이아웃 + 폰트 + 사이드바
├── globals.css                  디자인 토큰 + utility (.hf-card, .chip, ...)
├── company/
│   ├── register/                테스트 등록 (USDC 디파짓)
│   └── test/[testId]/           회사 측 테스트 상세 (진단 탭 포함)
├── tester/
│   ├── profile/                 프로필 등록
│   └── test/[testId]/           수동 리포트 작성
├── persona/[personaId]/         페르소나 상세 (20-axis radar)
├── report/[reportId]/           리포트 상세 (structured report 섹션)
├── experiment/                  비교 실험 (인간 vs 페르소나)
├── autotest/                    자동 테스트 트리거 + Live Theater
└── x402, autotest-bsc           micropayment / EVM 데모
```

### 5.2 디자인 시스템

CSS 변수 기반 토큰을 `app/globals.css`에 한 곳에 정의. **임의 Tailwind 조합 금지** — `.hf-card` / `.chip.<variant>` / `.hf-btn` 만 사용.

| 토큰 그룹 | 변수 | 용도 |
|---|---|---|
| 배경 | `--bg-0..4` | 5단계 neutral |
| 라인 | `--line-1/2` | hairline border |
| 텍스트 | `--fg-0..4` | 5단계 contrast |
| 액센트 | `--accent`, `--accent-soft`, `--accent-line` | Solana 그린 #14F195 |
| 시맨틱 | `--success`, `--warn`, `--danger`, `--info` (+`-soft`/`-line`) | 상태 |

폰트:
- **Inter Tight** (display, `-0.025em` tight tracking)
- **Inter** (body)
- **JetBrains Mono** (money, addresses)

`TweaksPanel`로 런타임에 액센트 hue / 디스플레이 폰트 / 밀도 / 라운드 변경. `localStorage('41r:tweaks')`에 영속.

### 5.3 Wallet 통합

`components/wallet-provider.tsx`가 Phantom adapter 래핑. `useWalletContext()` 훅:
- `publicKey`, `connected`
- `connect()`, `disconnect()`
- `signMessage(message)` — base58 서명 반환

`lib/api.ts`의 `signedRequest()`가 이를 받아 wallet auth 자동 처리.

### 5.4 Role 인식

`useAppRole()` 훅이 `localStorage('sidebar:role')` + CustomEvent (`41r:role`)로 사이드바와 페이지를 동기화. company / tester 둘 다 한 사이트에서 — 별도 포털 분리 안 함.

### 5.5 Landing Dashboard 패턴

핵심: **하드코딩된 KPI 금지**. `GET /api/dashboard?role=&wallet=` 단일 콜이 모든 위젯을 채웁니다.

```ts
{
  kpis: [{ label, value, unit?, delta, spark: number[7] }, ×4],
  primary_list: [{ id, title, status, meta, pay, tone, href }, ×≤4],
  activity: [{ at, t, text, kind, tone, meta? }, ×≤20],
  stats: { total_tests, total_personas },
  top_personas?: [...],          // company view
  my_persona?: PersonaSummary,   // tester view (없으면 top community persona)
}
```

- **Delta는 항상 7d vs prior 7d**: 빈 wallet 분기에도 적용 → 랜딩이 정적으로 안 보임.
- **Sparkline 7 chronological points**: index 0 = 6일 전, index 6 = 오늘.
- **Heterogeneous activity**: report / test / settlement 통합, tone은 quality 자동 산출 (≥4.0 success / <3.0 warn).

---

## 6. 블록체인 / 결제 레이어

### 6.1 Solana Token-2022 (41R 토큰)

- **Mint**: `TOKEN_41R_MINT` 환경변수
- **Transfer fee 5%**: 페르소나 매매 시 protocol fee로 자동 누적. Token-2022 native feature 활용 — 별도 hook program 불필요.
- **Devnet only** (현재): 메인넷 promotion 시 mint authority 분리 필요.

### 6.2 USDC 정산

- **Devnet mock USDC**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle faucet)
- **Power-curve reward**: `reward = baseReward × (qualityScore / 5.0) ^ 1.5`
  - Score 5.0 → 100%
  - Score 4.0 → 71%
  - Score 3.0 → 46%
  - Score 2.0 → 25%
  - Score 1.5 → 16% (rejected threshold)
- **Settlement worker**: pending settlement에 exp-backoff 재시도. on-chain TX 실패해도 큐가 살아있어 노이즈 RPC에 강함.

### 6.3 x402 Micropayment

```
GET /api/persona/<id>
  ↓ (X-Payment 헤더 없음)
402 Payment Required
{
  "x402Version": 1,
  "payment": {
    "recipientWallet": "...",
    "amount": 100000,        // 0.10 USDC (6 decimals)
    "amountUSDC": 0.10
  }
}
  ↓ (클라이언트가 USDC transfer TX 서명 + base64로 X-Payment 헤더)
GET /api/persona/<id>
  ↓ (verify SPL transfer instruction → ATA, amount)
200 OK + 페르소나 데이터
```

Coinbase x402 facilitator 사용 + 자체 fallback (`createFallbackPaymentMiddleware`) — devnet 불안정 시 자동 전환.

가격 매트릭스 (현재):
- `/api/hello` (PoC): $0.001
- `/api/test/:id/results`: $0.05
- `/api/persona/search`: $0.05
- `/api/persona/:id`: $0.10

### 6.4 Solana Attestation Service (SAS)

페르소나 quality tier (Bronze/Silver/Gold/Diamond)를 on-chain attest. `sas-lib` + `@solana/kit` 사용. 이슈 시 local demo ID로 fallback해서 데모는 안 멈춤.

`@solana/kit`의 cluster-aware 타입이 broken이라 SAS service 내부의 SDK 핸들 5개는 의도적으로 `any`. 코드에 `eslint-disable-next-line` + 이유 명시.

---

## 7. 배포 / 운영 / 관측성

### 7.1 Railway (Docker)

```
railway.toml (단일 파일, dockerfilePath만 변경)
  ├─ API   → apps/api/Dockerfile (node:20-slim + Chromium)
  └─ Web   → apps/web/Dockerfile (Next.js standalone)

Internal services:
  - PostgreSQL (자동 provisioning)
  - 네트워크 격리, persona-engine은 internal URL로
```

### 7.2 Cloudflare R2 (스크린샷 CDN)

S3-compatible API. AWS SDK v3 그대로 사용. `services/r2.ts`가 dynamic import로 SDK 로드 (cold-start 최적화). Public CDN URL을 DB의 `screenshots` 컬럼에 직접 저장 — 프론트가 prefix 처리 불필요.

Local dev: Express static fallback (`/screenshots/...`).

### 7.3 환경변수 검증 (Zod schema)

`config/env.ts`에 단일 진실원. 부팅 시:
- `DATABASE_URL`, `ANTHROPIC_API_KEY` 누락 → 즉시 throw
- `SKIP_PAYMENT_VERIFY=true` + production → 강제 false + warning
- 60+개 env가 전부 default 값 + 타입 검증
- Vitest setup이 test 환경에 fake 값 주입

### 7.4 CI/CD

- Husky pre-commit: `typecheck → lint → build` 3단 게이트 (skip 금지)
- Turborepo 캐시: 변경 없으면 ~660ms 통과
- Test suite: API 238 tests + Web 6 tests = 244, 3초 이내 완료

### 7.5 LLM Cost 가시성

`scripts/usage-summary.ts`가 `/tmp/llm-usage.jsonl`을 분석:
- 모델별/서비스별/라우트별 토큰 합산
- 가장 비싼 호출 top N
- 중복 prompt 탐지 (cache 후보)

페르소나 기반 비용 회귀를 빨리 잡아냅니다 — 예: stagehand_hybrid가 갑자기 24¢ → 40¢가 되면 즉시 알림.

---

## 8. 핵심 트레이드오프와 디자인 결정

### 8.1 왜 stagehand_hybrid를 default로 (text 모드 대비)
A/B 측정 결과 (feature/event-hardening 브랜치):
- `stagehand_hybrid`: ~24¢/run, deep UX 리포트, 실제 UI 인터랙션 관찰
- `text`: ~5¢/run, 화면 안 보고 가설로 채점, 빠른 bulk 실험에 유용

회사 진단의 핵심 가치는 "실제 UI에서 어디가 막히는가"라서 stagehand_hybrid가 default. text는 코호트 분석 같은 bulk 실험용으로 유지.

### 8.2 왜 in-process scoring으로 옮겼나
**Before** (2026-04-22 이전): Node API → HTTP → Python persona-engine `/analyses/score` → 결과 받기
- 평균 latency: 2.5초 (네트워크 + Python startup)
- Cross-language 디버깅 어려움 (Python stack trace + Node stack trace)

**After**: 채점 어댑터 4개를 TypeScript로 포팅 → `apps/api/src/services/scoring/*`
- Latency: <100ms (순수 LLM call 시간)
- 단일 stack, 단일 timeout 정책

`mode=text`와 legacy `persona_agent` 모드는 여전히 persona-engine을 거침. stagehand_hybrid만 in-process.

### 8.3 왜 owner check를 devnet beta에서 풀었나
`POST /api/test/:id/diagnosis` + `POST /api/test/:id/retry-autotest`는 원래 `test.companyAddr === signedWallet` 검증. devnet beta에서는 데모 시 demo viewer가 직접 진단 재생성을 트리거하도록 일부러 푸는 게 임팩트가 큼. `requireSignedRequest`는 그대로라서 익명 쓰기는 막혀 있음.

**메인넷 promotion 체크리스트**: `routes/test.ts`에서 owner check 두 곳 복원 (`feat(api,web): realtime dashboard + loosened diagnosis gate` 커밋의 deleted 라인).

### 8.4 왜 semantic clustering을 추가했나
초기에는 `normalizeStr()` (whitespace+lowercase)로만 페인포인트 dedup. 결과:
- "지갑 연결 시 진입 차단"과 "로그인 벽 접근 불가"가 별도 항목
- `confirmation: both` 라벨이 영원히 안 뜸 → Layer 2 trust contract 무효화

Haiku 한 번 호출 (~$0.0015)로 의미적 dedup. 실패 시 identity-map fallback (각 description = 자기 자신의 cluster)이라 LLM 다운에도 진단은 ship됨.

### 8.5 왜 환경 분리에 Zod schema를 도입했나
이전: `process.env.X` 71곳에 흩어져, key 오타가 production 에러로 발견.
지금: 부팅 즉시 schema validation. 서비스가 안 뜨거나 명확한 에러 메시지.

뿐만 아니라 **auto-completion**: TypeScript에서 `env.DATABASE_URL`이 자동완성, 오타 즉시 컴파일 에러.

### 8.6 왜 페르소나 vector를 4-group × 5-dim으로 쪼갰나
대안 1: 단일 임베딩 벡터 (예: 1536-dim openai embedding)
- 매칭은 가능, 하지만 **해석 불가능** — "이 페르소나는 왜 매칭됐나"를 회사에 설명 못 함

대안 2 (선택): 4-group × 5-dim 명명된 차원
- `expertise.defi: 0.82` 같이 의미 추적 가능
- 회사 UI에 20-axis radar 시각화 가능 (`components/persona-radar-20.tsx`)
- 코호트 매칭 (e.g., crypto_experience=0.2~0.4) 직관적

매칭 정확도는 LLM ranking이 보완 → 1차 LLM (의미 이해) + 2차 vector (해석 가능).

### 8.7 인간 vs 페르소나 비교의 진실 — 코호트 매칭

**중요한 framing**: "페르소나 ≈ 인간"은 **매칭된 데모그래픽 코호트 안에서만** 성립.

총 Spearman ρ는 약하거나 음수일 수 있는데, 이는 sample이 다른 코호트 (다른 agent capability pattern)를 섞기 때문. 정직한 발견:

> 암호화폐 초보 코호트에서는 페르소나가 사람을 100% 항목 일치 + |Δ|=0.25로 따라잡지만, 고급 코호트에서는 |Δ|=1.69로 벌어집니다. 페르소나 시뮬레이션 품질이 사용자 유형별로 다르다는 것 자체가 product insight.

이 framing 없이 단일 ρ를 자랑하는 건 자기 발등 찍기. 진단 페이지에 항상 `by_cohort` 수치를 동반 노출.

---

## 9. 확장 로드맵 / 메인넷 promotion 체크리스트

### 9.1 단기 (~1개월)
- [ ] `<img>` → `<Image>` 전환 (R2 CDN remotePatterns 설정)
- [ ] `console.*` → `logger.*` 전체 전환 (114건, 코드모드)
- [ ] `scoring/diagnosis.ts` (1,016줄) 6개 sub-module로 분할
- [ ] Web 컴포넌트 단위 테스트 (Phantom mock + RTL)

### 9.2 중기 (~3개월)
- [ ] **메인넷 promotion**:
  - [ ] `routes/test.ts` owner check 복원
  - [ ] 41R Token mint authority 분리
  - [ ] x402 fallback 제거 (mainnet facilitator 안정 후)
  - [ ] R2 → 자체 호스팅 또는 Solana 기반 영구 저장 검토
  - [ ] DB read replica + 읽기 분리
- [ ] 페르소나 다양성 확장:
  - [ ] 모바일 디바이스 페르소나 (현재 desktop only)
  - [ ] 다국어 페르소나 (현재 한국어 voice_sample)
  - [ ] 접근성 특화 페르소나 (스크린 리더 사용자, 색약 등)

### 9.3 장기 (~6개월)
- [ ] **페르소나 secondary market**:
  - [ ] Token-2022 transfer fee로 매매 수수료 자동 누적
  - [ ] 페르소나 평판 (reliability.consistency) 가격 반영
  - [ ] 회사가 특정 페르소나를 retainer로 lock-in
- [ ] **Cross-chain expansion**:
  - [ ] EVM (BSC) AutoTest 이미 PoC 단계 (`autotest-bsc`)
  - [ ] x402-evm으로 cross-chain micropay
- [ ] **Persona NFT** (선택적):
  - [ ] 각 페르소나를 cNFT로 발행
  - [ ] On-chain 페르소나 history (persona_versions를 Merkle tree로)

---

## 부록 A — 데이터 모델 ER 도식

```
companies                             tests
─────────                             ─────────
walletAddress (PK) ◀─────────────── companyAddr
companyName                          id (PK) ◀────────────────┐
domain                               targetUrl                 │
                                     requirements              │
                                     budgetUsdc                │
                                     rewardPerTester           │
                                     status                    │
                                     diagnosisMarkdown          │
                                                                │
testers                              test_cases                │
───────                              ──────────                │
walletAddress (PK) ◀───┐             id (PK)                   │
displayName             │             testId ─────────────────┘
profile (JSON)          │             type
testsDone               │             content (JSON)
personaId ──────────┐   │
                    │   │             test_reports
                    │   │             ─────────────
personas            │   │             id (PK)
─────────           │   │             testerAddr ──────────────┘
id (PK) ◀───────────┘   └───────────── testId
testerAddr                            isPersonaTest
vector (JSON)                          sourceMode (manual/stagehand_hybrid/text)
isActive                              qualityScore
sasAttestId                           checklistResults (JSON)
                                      questionnaireAnswers (JSON, 센티넬 포함)
                                      screenshots (R2 URLs)
persona_versions                       │
────────────────                       │
id (PK)                               settlements
personaId ─────┐                      ───────────
versionNum     │                      id (PK)
vector         │                      testId
sourceReportIds                       reportId
                                      payerAddr
auth_nonces                           payeeAddr
───────────                           amountToken
nonce (PK)                            txSignature
walletAddress                         retryCount, lastRetryAt
expiresAt                             status (pending/completed/dead)
usedAt
```

---

## 부록 B — 핵심 의존성 매트릭스

| 의존성 | 버전 | 사용처 | 대체 가능성 |
|---|---|---|---|
| Stagehand | 3.1 | 자율 브라우저 | 낮음 (LLM-driven 추상화 핵심) |
| Anthropic SDK | 0.78 | 모든 LLM 호출 | 높음 (모델 독립) |
| Drizzle ORM | 0.38 | DB | 중간 (Prisma 대안 가능) |
| Express | 4.21 | API | 높음 (Fastify 가능) |
| Next.js | 14.2 | Web | 중간 (앱 router 의존) |
| @solana/web3.js | 1.98 | Solana | 낮음 (Solana 표준) |
| @solana/kit | 5.5 | SAS | 낮음 (kit 외 대안 적음) |
| pino | 10.3 | 로깅 | 높음 |
| Zod | 3.24 | 검증 | 높음 |
| Vitest | 3.0 | 테스트 | 높음 |

---

## 부록 C — 운영 사고 사례 (RCA 학습)

### Case 1: jup.ag harness error → product finding 누수 (2026-04-25)
- **증상**: 14개 페르소나가 init에 죽었는데 진단이 "모바일 viewport 손실"을 rank-1 product issue로 띄움
- **원인**: 빈 turn 세션을 LLM이 받았고 checklist 텍스트 기반으로 그럴듯한 시나리오를 fabricate
- **대응**: 5-layer guard (`isHarnessErrorOutcome`, `harnessErrorReports[]` split, prompt §5-1, regression fixture)
- **교훈**: LLM은 evidence 부족 시 "I don't know"보다 "best guess"를 선택. Empty-session guard는 LLM 호출 전 단락이 정답.

### Case 2: Citation regex가 hex color를 hallucination으로 오인
- **증상**: Solana 그린 `#14F195`를 reportId로 매칭해 모든 진단에 audit warning
- **원인**: regex가 `[ ... ]` 밖의 hex도 잡음
- **대응**: regex를 `[ ... ]` 내부로 한정 + 회귀 테스트
- **교훈**: 정규표현식 boundary는 단순해 보여도 false positive가 user trust를 직접 깬다.

### Case 3: 동일 testerAddr 페르소나 2개 큐잉 (2026-04-25)
- **증상**: `/api/dev/autotest/trigger`가 unique constraint 위반 전에 ~$0.10 stagehand+scoring 낭비
- **원인**: `matchPersonas`가 동일 tester의 페르소나 2개를 반환할 수 있음을 dedup 로직이 가정 안 함
- **대응**: `selectQueueableJobs` pure 함수 + 6개 단위 테스트
- **교훈**: 비용 발생 가능한 큐잉은 항상 pre-flight dedup. unique constraint는 마지막 안전망일 뿐.

### Case 4: Outer hardcut 부재로 chain 무한 대기
- **증상**: stagehand 5분 hardcut 통과 후 scoring/R2/DB가 wedge → /autotest/trigger의 chain.then()이 영원히 안 끝남
- **원인**: inner timeout만 있고 outer가 없었음
- **대응**: 12분 outer hardcut + 90s per-LLM. `raceWithTimeout` 공통 헬퍼.
- **교훈**: 다단계 비동기 chain은 각 단계 + 전체 모두 timeout 필요. 가장 큰 hardcut이 마지막 안전망.

---

**문서 버전**: 1.0 · 2026-04-26
**유지보수**: 큰 아키텍처 변경 시 이 문서를 업데이트. CLAUDE.md는 "지금 작업하는 Claude를 위한 운영 룰"이고, 이 문서는 "외부 독자에게 시스템을 설명하는 레퍼런스"입니다 — 두 문서의 역할이 다릅니다.
