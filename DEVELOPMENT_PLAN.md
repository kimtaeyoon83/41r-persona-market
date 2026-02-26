# 41R Persona Market — 상세 개발 계획서

> design.md v4 기반 단계별 구현 계획
> 작성일: 2026-02-26

---

## 목차

1. [개발 환경 및 프로젝트 구조](#1-개발-환경-및-프로젝트-구조)
2. [Phase 1: 기반 셋업 + PoC (Day 1)](#2-phase-1-기반-셋업--poc-day-1)
3. [Phase 2: 기업 사이드 + Token-2022 (Day 2)](#3-phase-2-기업-사이드--token-2022-day-2)
4. [Phase 3: 테스터 사이드 (Day 3)](#4-phase-3-테스터-사이드-day-3)
5. [Phase 4: Persona + SAS (Day 4)](#5-phase-4-persona--sas-day-4)
6. [Phase 5: Auto Test Engine (Day 5)](#6-phase-5-auto-test-engine-day-5)
7. [Phase 6: 통합 + 데모 (Day 6)](#7-phase-6-통합--데모-day-6)
8. [Phase 7: 발표 + 제출 (Day 7)](#8-phase-7-발표--제출-day-7)
9. [기술 의존성 맵](#9-기술-의존성-맵)
10. [환경 변수 및 시크릿](#10-환경-변수-및-시크릿)

---

## 1. 개발 환경 및 프로젝트 구조

### 1.1 필수 도구

| 도구 | 버전 | 용도 |
|------|------|------|
| Node.js | 20 LTS | 런타임 |
| pnpm | 9.x | 패키지 매니저 (monorepo) |
| PostgreSQL | 16 | 메인 DB |
| Solana CLI | 2.x | 온체인 배포/테스트 |
| Anchor | 0.30+ | Solana 프로그램 개발 |
| Rust | 1.78+ | Transfer Hook 프로그램 |

### 1.2 프로젝트 구조 (Monorepo)

```
41rpm/
├── apps/
│   ├── web/                    # Next.js 14 프론트엔드
│   │   ├── app/
│   │   │   ├── (company)/      # 기업 대시보드
│   │   │   ├── (tester)/       # 테스터 포털
│   │   │   └── (persona)/      # Persona 관리
│   │   ├── components/
│   │   └── lib/
│   └── api/                    # Express.js 백엔드
│       ├── routes/
│       │   ├── test.ts         # 테스트 CRUD + LLM 생성
│       │   ├── tester.ts       # 테스터 프로필/리포트
│       │   ├── persona.ts      # Persona 생성/조회
│       │   └── settlement.ts   # 정산
│       ├── services/
│       │   ├── llm.ts          # Claude API 래퍼
│       │   ├── stagehand.ts    # 브라우저 자동화
│       │   ├── solana.ts       # 온체인 인터랙션
│       │   └── x402.ts         # 마이크로페이먼트
│       ├── middleware/
│       │   └── x402.ts         # x402 미들웨어
│       └── db/
│           ├── schema.ts       # Drizzle ORM 스키마
│           └── migrations/
├── programs/
│   └── transfer-hook/          # Anchor: TesterPerformance Hook
│       ├── src/lib.rs
│       └── tests/
├── packages/
│   ├── shared/                 # 공유 타입, 상수
│   └── solana-utils/           # 토큰 생성, 전송 유틸
├── scripts/
│   ├── setup-token.ts          # 41R Token Mint 생성
│   ├── deploy-hook.ts          # Transfer Hook 배포
│   └── seed-data.ts            # 데모용 시드 데이터
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

### 1.3 핵심 npm 패키지

```json
{
  "dependencies": {
    "@solana/web3.js": "^2.x",
    "@solana/spl-token": "^0.4.x",
    "@x402/express": "latest",
    "@x402/fetch": "latest",
    "@x402/svm": "latest",
    "@anthropic-ai/sdk": "latest",
    "@browserbasehq/stagehand": "latest",
    "drizzle-orm": "latest",
    "express": "^4.x",
    "next": "^14.x",
    "@solana/wallet-adapter-react": "latest",
    "sas-lib": "latest"
  }
}
```

---

## 2. Phase 1: 기반 셋업 + PoC (Day 1)

> 목표: 핵심 기술 3가지(x402, Stagehand, Token-2022)의 동작 확인

### 2.1 프로젝트 스캐폴딩 (2h)

**작업:**
1. pnpm monorepo 초기화
2. `apps/web`: `npx create-next-app@14` (App Router, TypeScript, Tailwind)
3. `apps/api`: Express.js + TypeScript 셋업
4. `programs/transfer-hook`: `anchor init`
5. PostgreSQL Docker 컨테이너 + Drizzle ORM 초기 스키마
6. Solana CLI 설정 + devnet 지갑 생성 + SOL 에어드롭

**완료 기준:**
- `pnpm dev` → web(3000), api(4000) 동시 기동
- DB 연결 확인
- `solana balance` → devnet SOL 잔액 확인

### 2.2 PoC #1: x402 Hello World (2h)

**작업:**
1. `apps/api`에 x402 미들웨어 설치 및 설정
2. 테스트 엔드포인트 생성: `GET /api/hello` (x402 결제 필요)
3. 클라이언트 측 `@x402/fetch`로 결제 + 응답 수신 확인

**구현 상세:**
```
[1] @x402/express 미들웨어 등록
    - facilitator URL 설정 (Coinbase 공식)
    - 수신 지갑 주소 설정
    - 엔드포인트별 가격 맵 정의
[2] 테스트 라우트
    - GET /api/hello → { price: "$0.01", response: "Hello from 41R" }
[3] 클라이언트 테스트
    - @x402/fetch + SolanaKeypairPaymentSigner
    - 402 응답 → 자동 USDC 결제 → 재요청 → 200 응답
```

**완료 기준:** curl → 402 → 클라이언트 결제 → 200 응답 성공

**대체 계획:** x402 SDK 호환 문제 시 → 서버 사이드 USDC 전송 검증으로 대체

### 2.3 PoC #2: Stagehand Hello World (2h)

**작업:**
1. Stagehand + Playwright 설치
2. 임의 웹사이트 방문 → 스크린샷 캡처
3. `stagehand.act()` → 특정 버튼 클릭 자동화

**구현 상세:**
```
[1] Stagehand 초기화
    - env: 'LOCAL' (로컬 브라우저)
    - modelName: 'claude-sonnet-4-20250514'
    - Anthropic API 키 설정
[2] 테스트 시나리오
    - 대상: 공개 DEX 사이트 (예: Jupiter, Raydium)
    - 단계: 방문 → 스크린샷 → "Swap" 버튼 찾기 → 클릭 → 스크린샷
[3] 결과 저장
    - 스크린샷 파일 저장
    - 행동 로그 JSON 출력
```

**완료 기준:** 자동으로 사이트 방문 → 버튼 클릭 → 스크린샷 2장 저장

**대체 계획:** 외부 사이트 실패 시 → 자체 데모 사이트(간단한 DEX mock) 제작

### 2.4 PoC #3: Token-2022 (Transfer Fee) Hello World (3h)

**작업:**
1. Token-2022로 41R Token Mint 생성 (Transfer Fee 50%)
2. 테스트 지갑에 토큰 전송 → 수수료 자동 징수 확인
3. Solana Explorer에서 수수료 확인

**구현 상세:**
```
[1] 41R Token Mint 생성 (scripts/setup-token.ts)
    - Token-2022 Program 사용
    - ExtensionType: TransferFeeConfig
    - feeBasisPoints: 5000 (50%)
    - maxFee: BigInt(1_000_000)
    - decimals: 6
[2] 토큰 발행 (Mint)
    - mintAuthority → 테스트 지갑에 100 41R 발행
[3] 토큰 전송 테스트
    - 지갑A → 지갑B 10 41R 전송
    - 지갑B 수령: 5 41R
    - 수수료 적립: 5 41R (withheld)
[4] 수수료 인출 테스트
    - withdrawWithheldTokens → Treasury 계정으로 인출
```

**완료 기준:** 전송 시 자동 50% 수수료 징수 → Explorer에서 확인

### 2.5 Day 1 체크리스트

| # | 작업 | 예상 시간 | 우선순위 |
|---|------|:---------:|:--------:|
| 1 | 모노레포 + DB + Solana CLI 셋업 | 2h | P0 |
| 2 | x402 PoC | 2h | P0 |
| 3 | Stagehand PoC | 2h | P0 |
| 4 | Token-2022 Transfer Fee PoC | 3h | P0 |
| 5 | 지갑 연결 (Phantom Adapter) 기본 | 1h | P1 |

---

## 3. Phase 2: 기업 사이드 + Token-2022 (Day 2)

> 목표: 기업이 URL을 입력하면 LLM이 테스트 케이스를 생성하고, USDC를 예치하는 전체 플로우

### 3.1 DB 스키마 구현 (1h)

**Drizzle ORM 테이블:**

```
companies
  - wallet_address (PK, text)
  - company_name (text)
  - domain (text)
  - created_at (timestamp)

tests
  - test_id (PK, uuid)
  - company_addr (FK → companies)
  - target_url (text)
  - requirements (text)
  - budget_usdc (decimal)
  - status (enum: draft/active/completed)
  - escrow_pda (text, nullable)
  - created_at (timestamp)

test_cases
  - case_id (PK, uuid)
  - test_id (FK → tests)
  - type (enum: checklist/scenario/questionnaire)
  - content (jsonb)
  - order (integer)
```

### 3.2 테스트 케이스 생성 API (3h)

**POST /api/test/register**

```
입력:
  - target_url: string
  - requirements: string
  - budget_usdc: number
  - company_wallet: string

처리 과정:
  [1] Stagehand로 URL 방문 → 스크린샷 1장 + DOM 요약 수집
  [2] Claude Sonnet API 호출
      - System: "당신은 UX 테스트 전문가입니다."
      - User: 스크린샷(base64) + DOM요약 + 요구사항
      - 출력: 체크리스트 + 시나리오 + 질문지 (JSON)
  [3] DB 저장 (tests + test_cases)
  [4] 응답 반환

출력:
  - test_id
  - test_cases (생성된 체크리스트/시나리오/질문지)
```

**LLM 프롬프트 설계:**
```
System Prompt:
"당신은 UX 테스트 전문가입니다. 주어진 웹사이트 스크린샷과 요구사항을 분석하여
정확히 다음 JSON 구조로 테스트 케이스를 생성하세요.
체크리스트는 4~6개, 시나리오는 1~2개, 질문지는 3~5개로 구성합니다."

User:
"[스크린샷: base64 이미지]
[URL]: {target_url}
[요구사항]: {requirements}

위 사이트를 분석하여 테스트 케이스를 생성하세요."
```

### 3.3 USDC Escrow 구현 (2h)

**방식: 서버 관리 Escrow (MVP)**

```
[1] 기업이 프론트엔드에서 Phantom으로 USDC 전송 트랜잭션 서명
    - 수신자: 41R 플랫폼 Escrow 지갑 (서버 관리 keypair)
    - 금액: budget_usdc
[2] 서버에서 트랜잭션 확인 후 DB에 escrow 상태 기록
[3] 테스트 완료 시 Escrow에서 테스터에게 보상 전송
```

**주의:** MVP에서는 PDA 기반 온체인 Escrow 프로그램 대신 서버 관리 지갑 사용.
프로덕션에서 온체인 Escrow 프로그램으로 전환 예정.

### 3.4 Transfer Hook 프로그램 개발 (3h)

**Anchor 프로그램: `test_performance_hook`**

```
개발 단계:
[1] TesterPerformance 계정 구조 정의
    - tester: Pubkey
    - tests_completed: u32
    - total_earned: u64
    - avg_reward: u64
    - last_active: i64
    - quality_tier: u8

[2] Transfer Hook execute 함수 구현
    - 보상 전송 시 자동 호출
    - tests_completed += 1
    - total_earned += amount
    - avg_reward 재계산
    - last_active 갱신

[3] Devnet 배포
    - anchor build
    - anchor deploy --provider.cluster devnet

[4] 41R Token Mint에 Hook 연결
    - TransferHookConfig 확장 추가
    - Hook 프로그램 ID 지정
```

### 3.5 기업 프론트엔드 (2h)

**페이지:**

```
/company
  ├── /register      # 테스트 등록 폼
  │   - URL 입력
  │   - 요구사항 텍스트 입력
  │   - 예산 설정 (USDC)
  │   - "테스트 케이스 생성" 버튼 → LLM 결과 미리보기
  │   - "예치 + 등록" 버튼 → Phantom 서명 → 등록 완료
  │
  ├── /dashboard     # 내 테스트 목록
  │   - 테스트별 상태 (진행중/완료)
  │   - 제출된 리포트 수
  │   - 예산 잔여량
  │
  └── /test/:id      # 테스트 상세 + 리포트 조회
      - 테스트 케이스 보기
      - 제출된 리포트 목록
      - 리포트 상세 뷰
```

### 3.6 Day 2 체크리스트

| # | 작업 | 예상 시간 | 우선순위 |
|---|------|:---------:|:--------:|
| 1 | DB 스키마 (companies, tests, test_cases) | 1h | P0 |
| 2 | 테스트 케이스 생성 API (LLM) | 3h | P0 |
| 3 | USDC Escrow (서버 관리 방식) | 2h | P0 |
| 4 | Transfer Hook 프로그램 (Anchor) | 3h | P0 |
| 5 | 기업 프론트엔드 (등록 + 대시보드) | 2h | P1 |

---

## 4. Phase 3: 테스터 사이드 (Day 3)

> 목표: 테스터가 가입, 테스트 수행, 리포트 제출, 보상 수령까지의 전체 플로우

### 4.1 DB 스키마 추가 (30m)

```
testers
  - wallet_address (PK, text)
  - display_name (text)
  - profile (jsonb)   # expertise, experience_level, etc.
  - tests_done (integer, default 0)
  - persona_id (FK → personas, nullable)
  - created_at (timestamp)

test_reports
  - report_id (PK, uuid)
  - tester_addr (FK → testers)
  - test_id (FK → tests)
  - checklist_results (jsonb)
  - scenario_log (jsonb)
  - questionnaire_answers (jsonb)
  - quality_score (decimal, nullable)
  - is_persona_test (boolean, default false)
  - screenshots (jsonb)
  - created_at (timestamp)

settlements
  - settlement_id (PK, uuid)
  - test_id (FK → tests)
  - report_id (FK → test_reports)
  - payer_addr (text)
  - payee_addr (text)
  - amount_token (decimal)
  - fee_collected (decimal)
  - tx_signature (text)
  - settled_at (timestamp)
```

### 4.2 테스터 프로필 API (1h)

```
POST /api/tester/register
  - wallet_address (Phantom 서명으로 인증)
  - display_name
  - profile: { expertise, experience_level, preferred_domains, ... }

GET /api/tester/:wallet
  - 프로필 + 통계 (tests_done, persona 여부)
```

### 4.3 테스트 수행 UI (4h)

**페이지: `/tester/test/:testId`**

```
[1] 테스트 정보 표시
    - 대상 URL, 요구사항
    - 예상 보상 금액

[2] 체크리스트 섹션
    - 각 항목: 토글(완료/미완료/불가) + 메모 입력
    - 대상 사이트 iframe 또는 새 탭 링크

[3] 시나리오 섹션
    - 타임라인 UI (시작/종료 시간 자동 기록)
    - 스크린샷 첨부 (파일 업로드)
    - 각 단계별 기록 텍스트

[4] 질문지 섹션
    - rating: 슬라이더 컴포넌트
    - free_text: 텍스트 입력

[5] 제출 버튼
    - 전체 데이터 JSON → POST /api/report/submit
    - 제출 성공 → 보상 지급 트리거
```

### 4.4 리포트 제출 + 보상 지급 API (3h)

**POST /api/report/submit**

```
처리 과정:
[1] 리포트 데이터 검증 + DB 저장
[2] 품질 점수 계산 (LLM 또는 규칙 기반)
    - 체크리스트 완료율
    - 시나리오 기록 상세도
    - 질문지 응답 길이/구체성
[3] 보상 지급 트랜잭션 생성
    - 수동 테스트: USDC 직접 전송 (수수료 없음)
    - 또는: 41R Token 전송 (Transfer Fee 적용)
    - Transfer Hook → TesterPerformance 자동 갱신
[4] 트랜잭션 전송 + 확인
[5] settlements 테이블 기록
[6] 테스터 tests_done += 1
[7] tests_done === 3 → Persona 생성 트리거 (Phase 4)
```

**보상 지급 트랜잭션 구성:**
```
Instructions:
  [1] 41R Token Transfer (Escrow → 테스터)
      → Transfer Fee 자동 50% 징수
      → Transfer Hook 자동 실행 (TesterPerformance 갱신)
```

### 4.5 테스터 프론트엔드 (2h)

```
/tester
  ├── /profile        # 프로필 등록/수정
  ├── /tests          # 참여 가능한 테스트 목록
  ├── /test/:id       # 테스트 수행 UI (4.3)
  ├── /reports        # 내가 제출한 리포트 목록
  └── /earnings       # 수익 현황 (온체인 데이터 연동)
```

### 4.6 Day 3 체크리스트

| # | 작업 | 예상 시간 | 우선순위 |
|---|------|:---------:|:--------:|
| 1 | DB 스키마 (testers, test_reports, settlements) | 0.5h | P0 |
| 2 | 테스터 프로필 API | 1h | P0 |
| 3 | 테스트 수행 UI (체크리스트+시나리오+질문지) | 4h | P0 |
| 4 | 리포트 제출 + 보상 지급 API | 3h | P0 |
| 5 | 테스터 프론트엔드 (목록/프로필/수익) | 2h | P1 |

---

## 5. Phase 4: Persona + SAS (Day 4)

> 목표: 3회 테스트 완료 테스터의 AI Persona 생성 + SAS 온체인 등록

### 5.1 DB 스키마 추가 (15m)

```
personas
  - persona_id (PK, uuid)
  - tester_addr (FK → testers)
  - vector (jsonb)         # Persona Vector (test_style, expertise, etc.)
  - voice_sample (text)
  - is_active (boolean)
  - sas_attestation_id (text, nullable)
  - created_at (timestamp)
  - updated_at (timestamp)
```

### 5.2 Persona 생성 API (3h)

**POST /api/persona/generate (내부 트리거)**

```
트리거: 테스터 tests_done === 3 도달 시 자동 호출

처리 과정:
[1] 해당 테스터의 3개 리포트 조회
[2] 테스터 프로필 조회
[3] Claude API 호출
    - System: "다음은 한 테스터의 프로필과 3회 리포트입니다..."
    - User: 프로필 + 리포트 3개
    - 출력: Persona Vector JSON
[4] Persona Vector 검증 (스키마 유효성)
[5] DB 저장 (personas 테이블)
[6] 테스터 테이블에 persona_id 연결
[7] SAS Attestation 발행 (5.3)
```

**LLM 프롬프트:** design.md 6.3절의 프롬프트 그대로 사용

### 5.3 SAS Attestation 발행 (2h)

```
처리 과정:
[1] SAS Schema 생성 (최초 1회)
    - tests_completed: u32
    - avg_quality: f32
    - expertise_defi: f32
    - expertise_ai_tools: f32
    - trust_tier: string
    - persona_activated: bool

[2] Persona 생성 시 Attestation 발행
    - deriveAttestationPda()
    - getCreateAttestationInstruction()
    - sendAndConfirmInstructions()

[3] Attestation ID → personas 테이블 저장
```

### 5.4 x402 미들웨어 적용 (1.5h)

```
대상 엔드포인트:
  GET  /api/persona/search       → $0.05
  GET  /api/test/:id/results     → $0.05
  GET  /api/persona/:id/detail   → $0.10

구현:
  - x402 paymentMiddleware 설정
  - 각 엔드포인트에 가격 + 네트워크(Solana) + 토큰(USDC) 설정
  - facilitator URL 설정
```

### 5.5 Persona 대시보드 UI (2h)

```
/persona
  ├── /dashboard     # 내 Persona 현황
  │   - Persona Vector 시각화 (레이더 차트)
  │   - 활성 상태
  │   - SAS Attestation 링크
  │   - 자동 테스트 이력
  │
  └── /search        # Persona 검색 (기업용)
      - 도메인/전문 분야 필터
      - Persona 목록 (벡터 시각화)
      - 상세 조회 (x402 결제 필요)
```

**레이더 차트 시각화:**
- test_style 5축: thoroughness, speed, ux_focus, bug_detection, creativity
- expertise 5축: defi, nft, gaming, ai_tools, general_web
- chart.js 또는 recharts 사용

### 5.6 Day 4 체크리스트

| # | 작업 | 예상 시간 | 우선순위 |
|---|------|:---------:|:--------:|
| 1 | Persona 생성 API (LLM) | 3h | P0 |
| 2 | SAS Attestation 발행 | 2h | P0 |
| 3 | x402 미들웨어 적용 (3개 엔드포인트) | 1.5h | P1 |
| 4 | Persona 대시보드 UI | 2h | P1 |
| 5 | Persona 검색 API (기본 필터링) | 1h | P1 |

---

## 6. Phase 5: Auto Test Engine (Day 5)

> 목표: Persona가 AI Browser Agent로 사이트를 자동 테스트하고, Persona 관점 리포트를 생성

### 6.1 Persona 매칭 로직 (1h)

```
매칭 알고리즘 (MVP — 간소화 버전):
[1] 새 테스트의 요구사항 텍스트에서 키워드 추출
[2] Persona의 expertise 벡터와 비교
    - 키워드 "DeFi" → expertise.defi 높은 순 정렬
    - 키워드 "NFT" → expertise.nft 높은 순 정렬
[3] reliability.quality_score 가중 적용
[4] 상위 N개 Persona 선택

향후: Qdrant 벡터 DB + 코사인 유사도 매칭
```

### 6.2 Auto Test Engine 핵심 (5h)

**POST /api/autotest/run**

```
입력:
  - test_id
  - persona_id

처리 과정:
[1] 테스트 케이스 + Persona Vector 조회

[2] Stagehand 초기화
    - env: 'LOCAL'
    - modelName: 'claude-sonnet-4-20250514'

[3] System Prompt에 Persona 주입
    - "당신은 다음 프로필의 테스터입니다: {persona_vector}"
    - "이 테스터의 관점, 어조, 집중 포인트를 반영하세요"

[4] 사이트 방문 + 체크리스트 자동 수행
    for (step of checklist):
      - stagehand.act({ action: step.task })
      - page.screenshot() → 저장
      - 행동 로그 기록

[5] 시나리오 자동 수행
    - Persona 관점에서 사이트 탐색
    - 각 단계 스크린샷 + 행동 로그

[6] Text Report 생성 (Claude Vision API)
    - 입력: 스크린샷 시퀀스 + 행동 로그 + Persona Vector
    - 출력: Persona 관점의 텍스트 리포트

[7] UX Feedback 시뮬레이션
    - Persona의 feedback_pattern 반영
    - 질문지 자동 응답 생성

[8] 종합 리포트 조합 + DB 저장
    - is_persona_test: true
    - screenshots: [스크린샷 경로 배열]

[9] 자동 정산 트리거
    - 41R Token 전송 (Transfer Fee + Hook)
```

### 6.3 리포트 생성 프롬프트 (1h)

```
System:
"당신은 AI 테스터 Persona입니다. 다음은 당신의 프로필입니다:
{persona_vector}
{voice_sample}

당신의 관점에서 다음 사이트 테스트 결과를 분석하고 리포트를 작성하세요.
당신의 전문성(expertise)과 피드백 패턴(feedback_pattern)을 반영하세요."

User:
"[테스트 대상]: {target_url}
[체크리스트 결과]: {checklist_results}
[스크린샷]: {screenshots as base64}
[행동 로그]: {action_log}

위 결과를 바탕으로:
1. 종합 평가 (3~5문장)
2. 체크리스트 항목별 관찰 사항
3. UX 문제점 (심각도 순)
4. 개선 제안 (구체적)
5. 점수 (1~10)"
```

### 6.4 자동 정산 통합 (1h)

```
Auto Test 완료 시:
[1] 41R Token 전송 (Escrow → 테스터)
    - Transfer Fee: 50% 자동 플랫폼 수수료
    - Transfer Hook: TesterPerformance 갱신
[2] settlements 테이블 기록
[3] SAS Attestation 갱신 (누적 성과)
```

### 6.5 Day 5 체크리스트

| # | 작업 | 예상 시간 | 우선순위 |
|---|------|:---------:|:--------:|
| 1 | Persona 매칭 로직 | 1h | P0 |
| 2 | Stagehand 자동 테스트 엔진 | 5h | P0 |
| 3 | Persona 관점 리포트 생성 프롬프트 | 1h | P0 |
| 4 | 자동 정산 통합 (Transfer Fee+Hook) | 1h | P0 |
| 5 | 기업 대시보드에 자동 테스트 리포트 표시 | 1h | P1 |

---

## 7. Phase 6: 통합 + 데모 (Day 6)

> 목표: E2E 플로우 통합, 데모 준비, UI 폴리시

### 7.1 E2E 통합 테스트 (3h)

```
전체 플로우 테스트:
[1] 기업 → URL 입력 → 테스트 케이스 생성 → USDC 예치
[2] 테스터 → 프로필 등록 → 테스트 수행 → 리포트 제출 → 보상 수령
[3] 3회 완료 → Persona 생성 → SAS Attestation
[4] 새 테스트 → Persona 매칭 → 자동 테스트 → 리포트 → 정산

각 단계 사이 데이터 정합성 확인:
- DB 상태 확인
- 온체인 상태 확인 (Transfer Hook 기록, SAS)
- 프론트엔드 표시 확인
```

### 7.2 데모용 시드 데이터 (2h)

```
scripts/seed-data.ts:
[1] 데모 기업 계정 1개
[2] 데모 테스터 3~5명 (각각 3회 테스트 완료)
[3] 데모 Persona 3~5개 (Vector + SAS)
[4] 데모 테스트 1개 (라이브 시연용)
[5] 데모 타겟 사이트에 대한 Stagehand 사전 테스트
    - 동작 확인된 사이트 2~3개 준비
```

### 7.3 프론트엔드 폴리시 (3h)

```
[1] 통합 대시보드 레이아웃
    - 좌측 사이드바: 기업/테스터/Persona 모드 전환
    - 상단: 지갑 연결 상태

[2] 시각적 개선
    - Persona Vector 레이더 차트
    - 테스트 진행 상태 타임라인
    - 리포트 비교 뷰 (수동 vs 자동)
    - Solana TX 링크 (Explorer)

[3] 데모 흐름 최적화
    - 불필요한 대기 시간 제거
    - 로딩 애니메이션
    - 에러 핸들링 (데모 중 에러 방지)
```

### 7.4 SAS Attestation UI (1h)

```
Attestation 배지 컴포넌트:
  - 등급: Bronze / Silver / Gold
  - 전문 분야 태그
  - 테스트 완료 횟수
  - "Verified on Solana" 링크 → Explorer
```

### 7.5 Day 6 체크리스트

| # | 작업 | 예상 시간 | 우선순위 |
|---|------|:---------:|:--------:|
| 1 | E2E 통합 테스트 | 3h | P0 |
| 2 | 시드 데이터 + 데모 사이트 사전 테스트 | 2h | P0 |
| 3 | 프론트엔드 폴리시 | 3h | P1 |
| 4 | SAS Attestation UI | 1h | P1 |
| 5 | 데모 리허설 1회 (전체 4분) | 1h | P0 |

---

## 8. Phase 7: 발표 + 제출 (Day 7)

> 목표: 피치 덱, 데모 영상, README, 제출

### 8.1 피치 덱 (2h)

```
4분 시나리오 (design.md 11절 기반):
  0:00-0:30  문제 제시
  0:30-1:15  기업 테스트 등록 (라이브)
  1:15-1:45  수동 테스트 결과 + Transfer Fee/Hook (사전 준비)
  1:45-2:15  Persona 생성 + SAS (라이브)
  2:15-3:15  Persona 자동 테스트 (라이브) ← 킬링 모먼트
  3:15-3:45  Solana 기술 통합 설명
  3:45-4:00  비즈니스 모델 + 마무리
```

### 8.2 데모 영상 녹화 (2h)

```
- 전체 플로우 녹화 (백업용)
- 라이브 데모 실패 시 영상 대체
- 주요 기술 포인트 하이라이트
```

### 8.3 README (2h)

```
구조:
  - 프로젝트 개요 (1문단)
  - 기술 아키텍처 다이어그램
  - Solana 기술 통합 (4가지)
  - 설치 및 실행 방법
  - 데모 시나리오
  - 팀 소개
```

### 8.4 Day 7 체크리스트

| # | 작업 | 예상 시간 | 우선순위 |
|---|------|:---------:|:--------:|
| 1 | 피치 덱 완성 | 2h | P0 |
| 2 | 데모 영상 녹화 | 2h | P0 |
| 3 | README 작성 | 2h | P0 |
| 4 | 최종 데모 리허설 | 1h | P0 |
| 5 | 제출 | 0.5h | P0 |

---

## 9. 기술 의존성 맵

```
Day 1 PoC (독립적 — 병렬 가능)
  ├── x402 PoC ─────────────────────────────────┐
  ├── Stagehand PoC ────────────────────────┐    │
  └── Token-2022 PoC ─────────────────┐     │    │
                                       │     │    │
Day 2 기업 사이드                       │     │    │
  ├── 테스트 케이스 생성 ◄──────────────┼─────┘    │
  ├── USDC Escrow ◄────────────────────┤          │
  └── Transfer Hook 프로그램 ◄─────────┘          │
                                                   │
Day 3 테스터 사이드                                 │
  ├── 테스트 수행 UI (Day 2 테스트 케이스 의존)     │
  └── 보상 지급 (Day 2 Token-2022 + Hook 의존)     │
                                                   │
Day 4 Persona + SAS                                │
  ├── Persona 생성 (Day 3 리포트 3개 의존)          │
  ├── SAS Attestation (Persona 생성 의존)          │
  └── x402 적용 ◄─────────────────────────────────┘

Day 5 Auto Test Engine
  ├── Stagehand 자동 테스트 (Day 1 PoC 의존)
  ├── Persona 리포트 생성 (Day 4 Persona 의존)
  └── 자동 정산 (Day 2-3 정산 플로우 의존)

Day 6-7 통합/데모
  └── 전체 의존
```

---

## 10. 환경 변수 및 시크릿

```env
# .env.example

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PRIVATE_KEY=           # 플랫폼 지갑 (Escrow + 보상 발송)
TOKEN_MINT_ADDRESS=           # 41R Token Mint
HOOK_PROGRAM_ID=              # Transfer Hook 프로그램 ID

# AI
ANTHROPIC_API_KEY=            # Claude API
BROWSERBASE_API_KEY=          # Stagehand (선택 — LOCAL 모드 불필요)

# Database
DATABASE_URL=postgresql://...

# x402
X402_FACILITATOR_URL=         # Coinbase facilitator
X402_RECEIVER_WALLET=         # x402 수신 지갑

# App
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOLANA_NETWORK=devnet
```

---

> **문서 버전**: v1.0
> **기반 설계서**: design.md v4
> **작성일**: 2026-02-26
