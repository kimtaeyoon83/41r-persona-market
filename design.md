# 41R Persona Market — Technical Design Document v5

> **AI Persona-Based Product Validation Marketplace on Solana**
> Solana Startup Village | February 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem & Solution](#2-problem--solution)
3. [Core User Flow](#3-core-user-flow)
4. [System Architecture](#4-system-architecture)
5. [Solana Technology Integration Map](#5-solana-technology-integration-map)
6. [Module Specifications](#6-module-specifications)
   - 6.1 Test Case Generator
   - 6.2 Tester Portal
   - 6.3 Persona Engine
   - 6.4 Auto Test Engine (AI Browser Agent)
   - 6.5 Payment & Settlement Module
   - 6.6 Persona Fingerprint & On-Chain Registry
7. [Solana Deep Integration Details](#7-solana-deep-integration-details)
   - 7.1 x402 Micropayment Protocol
   - 7.2 Token-2022 Transfer Fee (온체인 운영 수수료)
   - 7.3 Token-2022 Transfer Hook (보상 지급 + 성과 기록 원자적 처리)
   - 7.4 Solana Attestation Service (SAS) — 테스터 성과 온체인 증명
   - 7.5 Solana Memo Program — Persona Fingerprint (Roadmap)
8. [Data Models](#8-data-models)
9. [Privacy & Security Architecture](#9-privacy--security-architecture)
10. [Revenue Model & Settlement Flow](#10-revenue-model--settlement-flow)
11. [Demo Scenario (4-minute)](#11-demo-scenario-4-minute)
12. [Judge Q&A — Why Solana?](#12-judge-qa--why-solana)
13. [7-Day Implementation Roadmap](#13-7-day-implementation-roadmap)
14. [Risk Analysis & Mitigation](#14-risk-analysis--mitigation)
15. [Post-Hackathon Roadmap](#15-post-hackathon-roadmap)

---

## 1. Executive Summary

**41R Persona Market**은 AI Persona 기반 제품 검증 마켓플레이스입니다.

기업이 제품/사이트 URL과 테스트 요구사항을 입력하면, LLM이 자동으로 테스트 케이스를 생성합니다. 테스터들은 수동으로 3회 테스트를 완료한 후, 자신의 리포트 데이터 기반으로 AI Persona가 생성됩니다. 이후 새로운 테스트에는 이 Persona가 자동으로 참가하여 AI Browser Agent를 통해 실제 사이트를 방문하고, 텍스트 리포트와 UX 피드백을 생성합니다.

**Solana의 역할**: 단순한 결제 레이어가 아닌, x402 마이크로페이먼트, Token-2022 Transfer Fee/Hook, Attestation Service, Memo Program 등 Solana 생태계의 핵심 기술들이 플랫폼의 근간을 이루는 구조입니다.

```
┌──────────────────────────────────────────────────────────┐
│                    ONE-LINE PITCH                         │
│                                                          │
│  "기업은 URL만 넣으면 AI가 테스트하고,                      │
│   테스터는 3번 테스트하면 AI 분신이 돈을 벌어다 줍니다.      │
│   결제부터 성과증명까지, 전부 Solana 위에서 돌아갑니다."     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Problem & Solution

### Problem

| 현재 상황 | 구체적 문제 |
|-----------|-------------|
| 제품 테스트 비용 | UserTesting 기준 $49/세션, 10명 = $490 |
| 느린 피드백 | 테스터 모집 → 수행 → 분석까지 1~2주 |
| 타겟팅 부정확 | 인구통계 기반 ("25세 남성") → 실제 전문성/성향 모름 |
| 정산 마찰 | 국제 테스터 → 은행 송금 수수료 + 1~2주 대기 |
| 반복 불가 | 같은 테스터 재테스트 시 다시 모집부터 |

### Solution: 41R Persona Market

```
기업: URL + "이걸 테스트해줘" → LLM이 테스트 케이스 자동 생성
                                   ↓
테스터: 테스트 선택 → 수행 → 리포트 → USDC 즉시 수령 ($3~$5)
                                   ↓
          3회 완료 → AI Persona 자동 생성
                                   ↓
새 테스트: Persona가 자동 참가 → AI Browser Agent로 사이트 방문
           → 스크린샷 + 행동 분석 + Persona 관점 리포트 자동 생성
                                   ↓
정산 (이중 모델):
  ├── 수동 테스트: USDC 직접 지급 (수수료 없음, 즉시 수령)
  └── 자동 테스트: 41R Token (Token-2022) 지급
      ├── Transfer Fee: 5% 온체인 운영 수수료
      └── Transfer Hook: 테스트 완료 횟수 + 품질 점수 온체인 기록
```

---

## 3. Core User Flow

### Phase 1: 기업 — 테스트 등록

```
기업 (Company)
    │
    ├── 1. 사이트 URL 입력 (예: https://my-dex.app)
    ├── 2. 테스트 요구사항 텍스트 입력
    │       "신규 유저가 첫 토큰 스왑까지 도달하는 UX를 검증해주세요"
    ├── 3. LLM이 테스트 케이스 자동 생성
    │       ├── 체크리스트: "지갑 연결", "토큰 선택", "스왑 실행", "TX 확인"
    │       ├── 시나리오: "DeFi 초보자로서 첫 스왑까지의 여정 기록"
    │       └── 질문지: "UI 직관성(1~5)", "혼란스러운 부분은?", "개선 제안"
    ├── 4. 테스트 비용 예치 (USDC → Escrow PDA)
    │       └── x402로 테스트 등록 API 호출 시 자동 결제
    └── 5. 플랫폼에 테스트 항목 공개
```

### Phase 2: 테스터 — 수동 테스트 (처음 3회)

```
테스터 (Tester)
    │
    ├── 1. 지갑 연결 (Phantom/Backpack) → 지갑 = 유저 ID
    ├── 2. 프로필 등록
    │       ├── 기본 정보: 전문 분야, 경력, 관심 도메인
    │       └── 취향 정보: 선호 UI 스타일, 기술 수준, 관심사
    ├── 3. 테스트 목록에서 원하는 테스트 선택
    ├── 4. 테스트 수행
    │       ├── 실제 사이트 방문 → 체크리스트 체크
    │       ├── 시나리오에 따라 사용 여정 기록
    │       └── 질문지 응답 (주관적 평가)
    ├── 5. 결과 리포트 제출
    ├── 6. 보상 즉시 수령
    │       ├── USDC 직접 지급 ($3~$5) → 테스터 지갑
    │       └── Transfer Hook: 테스트 완료 횟수 +1 온체인 기록
    └── 7. 3회 완료 → Phase 3으로
```

### Phase 3: Persona 생성 + 온체인 등록

```
Persona 생성 프로세스
    │
    ├── 1. 3회 리포트 + 프로필 → LLM 분석
    │       └── "이 테스터의 테스트 스타일, 전문성, 피드백 패턴을 분석해줘"
    ├── 2. Persona Vector 생성 (구조화된 JSON)
    │       ├── test_style: { thoroughness: 0.92, speed: 0.65, ux_focus: 0.88 }
    │       ├── expertise: { defi: 0.85, nft: 0.40, ai_tools: 0.72 }
    │       ├── feedback_pattern: { ui_critical: 0.90, security_aware: 0.78 }
    │       └── reliability: { quality_score: 0.87, response_rate: 1.0 }
    ├── 3. SAS Attestation 발행
    │       ├── "이 테스터는 3회 수동 테스트 완료"
    │       ├── "평균 품질 점수: 4.2/5.0"
    │       └── "전문 분야: DeFi, AI Tools"
    └── 4. 테스터에게 Persona 활성화 알림
```

### Phase 4: Persona 자동 테스트

```
새 테스트 등록됨
    │
    ├── 1. Persona 매칭 (테스트 요구 vs Persona Vector)
    │       └── 코사인 유사도로 적합한 Persona 선택
    ├── 2. Auto Test Engine 실행
    │       ├── [A] Browser Agent (Stagehand + Playwright)
    │       │       ├── 사이트 방문 → 스크린샷 캡처
    │       │       ├── Vision LLM이 화면 분석 → 행동 결정
    │       │       ├── 클릭/입력/네비게이션 자동 실행
    │       │       └── 전 과정 행동 로그 + 스크린샷 기록
    │       ├── [B] Text Report Generator
    │       │       └── 스크린샷 + 행동로그 + Persona → 텍스트 리포트
    │       └── [C] UX Feedback Simulator
    │               └── Persona 관점에서 UX 평가 + 점수 + 개선점
    ├── 3. 종합 리포트 생성 (A+B+C 통합)
    ├── 4. 기업 대시보드에 리포트 전달
    └── 5. 자동 정산 (41R Token, 하나의 트랜잭션)
            ├── 서버가 USDC 수령 → 50/50 분배 계산
            ├── 41R Token 민팅: 테스터 몫 + 플랫폼 몫 각각 민팅
            ├── 41R Token 전송 → 테스터 지갑
            │   ├── Transfer Fee: 5% 온체인 운영 수수료
            │   └── Transfer Hook: 테스트 완료 기록 + 품질 점수 갱신
            └── 41R Token 전송 → 플랫폼 Treasury
```

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       41R Persona Market                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Frontend (Next.js)                     │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐             │   │
│  │  │ /company  │  │ /tester  │  │ /persona  │             │   │
│  │  │ 테스트등록│  │ 프로필   │  │ Persona   │             │   │
│  │  │ 결과보기  │  │ 테스트수행│  │ 관리/결과 │             │   │
│  │  │ 대시보드  │  │ 리포트   │  │ 자동테스트│             │   │
│  │  └──────────┘  └──────────┘  └───────────┘             │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                    │
│  ┌─────────────────────────▼───────────────────────────────┐   │
│  │                  Backend (Express.js)                     │   │
│  │                                                          │   │
│  │  ┌────────────────────┐  ┌───────────────────────────┐  │   │
│  │  │ Test Case Generator│  │    Auto Test Engine ★      │  │   │
│  │  │ ─────────────────  │  │ ─────────────────────────  │  │   │
│  │  │ URL 분석           │  │ Stagehand Browser Agent    │  │   │
│  │  │ LLM 테스트케이스   │  │ Vision LLM (스크린샷분석)  │  │   │
│  │  │ 체크리스트/시나리오 │  │ Text Report Generator     │  │   │
│  │  │ 질문지 생성        │  │ UX Feedback Simulator     │  │   │
│  │  └────────────────────┘  └───────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌────────────────────┐  ┌───────────────────────────┐  │   │
│  │  │  Persona Engine    │  │   Payment Module          │  │   │
│  │  │ ─────────────────  │  │ ─────────────────────────  │  │   │
│  │  │ 리포트 분석 (LLM)  │  │ x402 Middleware           │  │   │
│  │  │ Persona Vector     │  │ USDC Escrow (PDA)         │  │   │
│  │  │ 지문 생성 (SHA-256)│  │ 41R Token (Token-2022)    │  │   │
│  │  │ SAS 성과 등록      │  │  ├ Transfer Fee (수수료)  │  │   │
│  │  └────────────────────┘  │  └ Transfer Hook (성과기록)│  │   │
│  │                          └───────────────────────────┘  │   │
│  │  ┌────────────────────┐                                 │   │
│  │  │  On-Chain Registry │                                 │   │
│  │  │ ─────────────────  │                                 │   │
│  │  │ SAS: 성과 Credential│                                │   │
│  │  │ Memo: 지문 (로드맵) │                                │   │
│  │  └────────────────────┘                                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Solana Blockchain                       │  │
│  │                                                           │  │
│  │  ┌───────────┐ ┌──────────────┐ ┌───────────────────┐   │  │
│  │  │   x402    │ │  Token-2022   │ │       SAS         │   │  │
│  │  │Micropay-  │ │ ┌───────────┐│ │   Attestation     │   │  │
│  │  │  ments    │ │ │TransferFee││ │   Service         │   │  │
│  │  │           │ │ │TransferHook││ │   (성과 증명)     │   │  │
│  │  └───────────┘ │ └───────────┘│ └───────────────────┘   │  │
│  │                └──────────────┘                           │  │
│  │  ┌───────────┐                                           │  │
│  │  │   Memo    │  ← Roadmap: Persona 지문 불변 기록        │  │
│  │  │  Program  │                                           │  │
│  │  └───────────┘                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     Database Layer                        │  │
│  │  PostgreSQL: 유저/테스트/리포트/정산                       │  │
│  │  (Optional) Qdrant: Persona 매칭용 벡터 검색              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Solana Technology Integration Map

41R은 Solana의 **4가지 핵심 기술**을 통합 활용합니다 (+ 1가지 로드맵). 각 기술은 명확한 비즈니스 근거를 가지며, 없으면 해당 기능이 동작하지 않습니다.

| 기술 | 어디에 쓰나 | 왜 필요한가 | 상태 |
|------|-----------|------------|------|
| **x402 Micropayment** | 수동 테스트 1건 완료 → 즉시 $3~$5 USDC 지급 | Stripe $0.30 고정 수수료 → $3 보상 시 ~10% 손실. Solana $0.00025로 0.008% | ✅ Core |
| **Token-2022 Transfer Fee** | 자동 테스트 41R Token 전송 시 5% 운영 수수료 | 수수료가 토큰에 내장 → 프로토콜 레벨 강제, 우회 불가 | ✅ Core |
| **Token-2022 Transfer Hook** | 보상 지급과 동시에 성과 온체인 기록 | 지급 = 기록이 하나의 트랜잭션. 품질·횟수 자동 갱신, 조작 불가 | ✅ Core |
| **SAS (Attestation Service)** | 테스트 품질·전문 분야·신뢰도 등급 증명 | 2025.05 메인넷 출시. 온체인 Credential → 타 dApp 재사용 가능 포터블 평판 | ✅ Core |
| **Memo Program** | Persona 데이터 지문 온체인 기록 | 향후 Persona 거래/이동 시 무결성 보장 | 🔷 Roadmap |

---

## 6. Module Specifications

### 6.1 Test Case Generator

```
입력: URL + 요구사항 텍스트
출력: 구조화된 테스트 케이스 (JSON)

프로세스:
1. URL → Stagehand로 사이트 방문 → 스크린샷 + DOM 구조 수집
2. 스크린샷 + 요구사항 → Vision LLM (Claude Sonnet)
3. LLM이 3종류 테스트 케이스 생성:

{
  "test_id": "test_abc123",
  "target_url": "https://my-dex.app",
  "created_by": "company_wallet_address",
  "budget_usdc": 50.00,
  "test_cases": {
    "checklist": [
      { "id": "CL01", "task": "지갑 연결 버튼을 찾아 클릭", "expected": "지갑 선택 모달 표시" },
      { "id": "CL02", "task": "토큰 페어 선택", "expected": "SOL/USDC 선택 가능" },
      { "id": "CL03", "task": "스왑 수량 입력 후 실행", "expected": "트랜잭션 확인 화면" },
      { "id": "CL04", "task": "트랜잭션 완료 확인", "expected": "성공 메시지 + TX 링크" }
    ],
    "scenarios": [
      {
        "id": "SC01",
        "persona_type": "DeFi 초보자",
        "narrative": "솔라나 지갑은 있지만 DEX를 처음 사용하는 유저로서, 100 USDC를 SOL로 스왑하기까지의 전체 여정을 기록하세요.",
        "evaluation_points": ["첫 화면 이해도", "네비게이션 난이도", "에러 발생 시 대처"]
      }
    ],
    "questionnaire": [
      { "id": "Q01", "question": "전체 UI 직관성", "type": "rating_1_5" },
      { "id": "Q02", "question": "가장 혼란스러운 부분", "type": "free_text" },
      { "id": "Q03", "question": "경쟁 서비스 대비 장/단점", "type": "free_text" },
      { "id": "Q04", "question": "다시 사용할 의향 (1~10)", "type": "rating_1_10" }
    ]
  }
}
```

### 6.2 Tester Portal

```
테스터 프로필 구조:

{
  "wallet_address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "profile": {
    "display_name": "CryptoTester42",
    "expertise": ["defi", "nft", "solana"],
    "experience_level": "intermediate",
    "preferred_domains": ["blockchain", "fintech"],
    "ui_preference": "minimal",
    "languages": ["ko", "en"],
    "device_types": ["desktop", "mobile"]
  },
  "stats": {
    "tests_completed": 3,
    "avg_quality_score": 4.2,
    "persona_activated": true,
    "persona_id": "persona_xyz789"
  }
}

테스트 수행 UI:
- 체크리스트: 각 항목 토글 (완료/미완료/불가) + 메모
- 시나리오: 타임라인 형태 기록 (시작~종료 시간 + 스크린샷 첨부)
- 질문지: 점수 슬라이더 + 텍스트 입력
- 제출 시: 전체 데이터 → DB 저장 + 기업에 알림
```

### 6.3 Persona Engine

```
입력: 프로필 + 3회 리포트
출력: Persona Vector (JSON)

LLM 프롬프트:
"""
다음은 한 테스터의 프로필과 3회에 걸친 테스트 리포트입니다.
이 테스터의 테스트 Persona를 분석하여 다음 JSON 구조로 출력하세요.

[프로필] {profile}
[리포트 1] {report_1}
[리포트 2] {report_2}
[리포트 3] {report_3}

출력 형식:
{
  "persona_id": "자동생성",
  "test_style": {
    "thoroughness": 0.0~1.0,
    "speed": 0.0~1.0,
    "ux_focus": 0.0~1.0,
    "bug_detection": 0.0~1.0,
    "creativity": 0.0~1.0
  },
  "expertise": {
    "defi": 0.0~1.0,
    "nft": 0.0~1.0,
    "gaming": 0.0~1.0,
    "ai_tools": 0.0~1.0,
    "general_web": 0.0~1.0
  },
  "feedback_pattern": {
    "ui_critical": 0.0~1.0,
    "security_aware": 0.0~1.0,
    "performance_sensitive": 0.0~1.0,
    "accessibility_focus": 0.0~1.0,
    "detail_oriented": 0.0~1.0
  },
  "reliability": {
    "quality_score": 0.0~1.0,
    "consistency": 0.0~1.0,
    "response_rate": 0.0~1.0
  },
  "voice_sample": "이 테스터가 피드백할 때 사용하는 특징적인 어조와 관점을 2~3문장으로 요약"
}
"""

Persona Vector → SAS Attestation 발행 (성과 + 품질 + 전문 분야)
```

### 6.4 Auto Test Engine (AI Browser Agent)

```
핵심 구성요소:
- Stagehand (TypeScript): AI Browser Agent 프레임워크
- Playwright: 브라우저 자동화 백엔드
- Claude Sonnet (Vision): 스크린샷 분석 + 행동 결정
- Persona Context: System Prompt에 Persona Vector 주입

실행 플로우:

async function runAutoTest(persona, testCase, siteUrl) {
  // 1. Stagehand 초기화
  const stagehand = new Stagehand({
    env: 'LOCAL',
    modelName: 'claude-sonnet-4-20250514',
  });
  await stagehand.init();

  // 2. 사이트 방문 + 초기 스크린샷
  await stagehand.page.goto(siteUrl);

  // 3. 테스트 케이스별 자동 수행
  for (const step of testCase.checklist) {
    // Stagehand가 Vision LLM으로 화면 분석 → 클릭
    await stagehand.act({ action: step.task });
    // 스크린샷 캡처 + 행동 로그
  }

  // 4. Persona 관점 리포트 생성
  //    스크린샷 + 행동로그 + Persona Vector → Vision LLM
  //    "이 Persona의 관점에서 종합 리포트 작성"

  // 5. UX 피드백 시뮬레이션
  //    Persona의 성향(ui_critical, security_aware 등) 반영

  // 6. 종합 리포트 반환
  return { screenshots, actionLog, textReport, uxFeedback };
}

리포트 생성 시 Persona 반영 방식:
- System Prompt에 Persona Vector + voice_sample 주입
- "당신은 다음 프로필을 가진 테스터입니다: {persona}"
- "이 테스터의 관점, 어조, 집중 포인트를 반영하여 리포트를 작성하세요"
```

### 6.5 Payment & Settlement Module

```
이중 결제 모델 (Dual Payment Model):

┌──────────────────────────────────────────────────────────────┐
│                  Payment Architecture                         │
│                                                              │
│  ★ 핵심 설계: 수동 = USDC, 자동 = 41R Token                  │
│  → "같은 토큰으로 다른 수수료율" 불가능 문제를 해결           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 수동 테스트 (Manual Test) — USDC 직접 지급            │    │
│  │                                                      │    │
│  │  기업 USDC 예치 → Escrow PDA                          │    │
│  │      → 테스트 완료 확인                                │    │
│  │          → USDC $3~$5 → 테스터 지갑 (100%, 수수료 0%) │    │
│  │          → Transfer Hook: 테스트 완료 횟수 기록        │    │
│  │                                                      │    │
│  │  ★ 수동 테스터에게는 수수료 없이 USDC를 직접 지급      │    │
│  │    테스터 획득 비용으로 투자 → Persona 생성 유도        │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 자동 테스트 (Persona Auto Test) — 41R Token 지급      │    │
│  │                                                      │    │
│  │  기업 USDC 예치 → Escrow PDA                          │    │
│  │      → Auto Test 완료 확인                            │    │
│  │          → 서버가 수익 배분 계산 (50/50)               │    │
│  │          → USDC → 41R Token 민팅 (1:1)                │    │
│  │              ├── 테스터 몫: 2 41R 민팅 → 전송          │    │
│  │              │   ├── Transfer Fee: 5% 운영 수수료      │    │
│  │              │   └── Transfer Hook: 성과 기록 갱신     │    │
│  │              └── 플랫폼 몫: 2 41R 민팅 → Treasury      │    │
│  │                  └── Transfer Fee: 5% 운영 수수료      │    │
│  │                                                      │    │
│  │  ★ 50/50 수익 배분은 서버가 민팅 시점에 결정           │    │
│  │    Transfer Fee 5%는 온체인 운영 수수료 (투명성 보장)  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 41R Token Mint Authority & Lifecycle                   │    │
│  │                                                      │    │
│  │  서버 = Mint Authority (41R Token 발행 권한 보유)       │    │
│  │                                                      │    │
│  │  민팅 (Mint):                                         │    │
│  │  ├── 자동 테스트 결제 시에만 민팅                       │    │
│  │  ├── 기업이 예치한 USDC 기준 1:1 민팅                  │    │
│  │  └── USDC는 Platform USDC Treasury에 보관              │    │
│  │                                                      │    │
│  │  리딤 (Redeem):                                       │    │
│  │  ├── 테스터가 41R → USDC 환전 요청                     │    │
│  │  ├── 서버가 41R Token 소각 (burn)                      │    │
│  │  └── Platform USDC Treasury에서 USDC 지급              │    │
│  │                                                      │    │
│  │  ★ 41R Token = USDC 1:1 담보 스테이블 유틸리티 토큰    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  x402 마이크로페이먼트 적용 지점:                              │
│  ├── POST /api/test/register      → $1~$100 (테스트등록)     │
│  ├── GET  /api/test/:id/results   → $0.05 (결과조회)         │
│  ├── GET  /api/persona/search     → $0.05 (Persona검색)     │
│  └── GET  /api/persona/:id/detail → $0.10 (상세조회)         │
│                                                              │
│  예시: 기업이 $50 예치, 수동 테스트 $3~$5                     │
│  ├── 수동 테스트 10~16건: $30~$50 (USDC 직접 지급)           │
│  └── 나머지 예산: 자동 테스트에 할당 (41R Token)              │
└──────────────────────────────────────────────────────────────┘
```

### 6.6 Persona Fingerprint & On-Chain Registry

```
온체인 등록 프로세스:

1. Token-2022 Transfer Hook이 매 보상 전송 시 자동 기록:
   ├── 테스트 완료 횟수
   ├── 누적 품질 점수
   └── 전문 분야별 테스트 이력

2. SAS Attestation 발행 (Persona 생성 시 + 갱신 시):
   ├── "이 테스터는 N회 수동 테스트를 완료한 실제 사람 기반"
   ├── "평균 품질 점수: X/5.0"
   ├── "전문 분야: DeFi, AI Tools"
   └── 다른 dApp에서도 이 Persona의 신뢰도 검증 가능

3. [Roadmap] Memo Program — Persona 지문 기록:
   ├── Persona Vector → JSON.stringify (키 정렬) → SHA-256
   ├── 데이터: "41R:PERSONA:v1:{wallet}:{fingerprint}:{timestamp}"
   ├── 비용: ~$0.00025/tx
   └── 향후 Persona 거래/이동 시 무결성 보장용

검증 프로세스:
- SAS Attestation: "이 Persona가 검증된 테스터인가?" → 온체인 확인
- Transfer Hook 기록: "이 테스터의 실제 테스트 횟수/품질은?" → 온체인 확인
- [Roadmap] Memo 지문: "이 Persona Vector가 변조되지 않았는가?" → 해시 비교
```

---

## 7. Solana Deep Integration Details

### 7.1 x402 Micropayment Protocol

```
x402란?
- HTTP 402 "Payment Required" 상태 코드 기반 결제 프로토콜
- Coinbase가 2025.05 출시, 오픈 표준
- Solana와 Base가 주요 프로덕션 네트워크
- Cloudflare, Google Cloud 등과 파트너십

41R에서의 활용:

// Express.js x402 미들웨어 설정
import { paymentMiddleware } from '@x402/express';
import { Network } from '@x402/core';

app.use(paymentMiddleware({
  "GET /api/persona/search": {
    accepts: [{
      network: Network.SOLANA_MAINNET,
      token: "USDC",
      maxAmountRequired: "0.05",   // $0.05
    }],
    description: "Search matching Personas for your test requirements",
  },
  "GET /api/test/:id/results": {
    accepts: [{
      network: Network.SOLANA_MAINNET,
      token: "USDC",
      maxAmountRequired: "0.05",
    }],
    description: "View test results and reports",
  },
  "POST /api/test/register": {
    accepts: [{
      network: Network.SOLANA_MAINNET,
      token: "USDC",
      maxAmountRequired: "100.00",
    }],
    description: "Register a new test with budget",
  },
}));

클라이언트 (기업 측):
import { wrapFetchWithPayment } from '@x402/fetch';
import { SolanaKeypairPaymentSigner } from '@x402/svm';

const paidFetch = wrapFetchWithPayment(fetch, {
  paymentSigner: new SolanaKeypairPaymentSigner(companyKeypair),
});

// 자동으로 402 → 결제 → 재요청
const results = await paidFetch('https://41r.market/api/persona/search?domain=defi');

왜 x402가 필수인가:

  $3 보상 지급 시 수수료 비교:
  ┌─────────────────────────────────────────────────┐
  │  Stripe:  $0.30 고정 + 2.9% = $0.387           │
  │           → 보상($3)의 12.9%. 소액에 과도한 비용. │
  │                                                  │
  │  x402 on Solana: 수수료 $0.00025                 │
  │           → 보상($3)의 0.008%. ✅                 │
  │                                                  │
  │  결론: 실시간 소액 보상 UX에서                     │
  │        Solana x402는 Stripe 대비 1,500배 저렴.    │
  │        글로벌 테스터에게 즉시 지급 가능.            │
  └─────────────────────────────────────────────────┘
```

### 7.2 Token-2022 Transfer Fee (온체인 운영 수수료)

```
Transfer Fee란?
- Token-2022 프로그램의 확장 기능
- 토큰 전송 시 자동으로 수수료를 징수
- 수수료는 수신자 토큰 계정에 적립, withdraw authority가 인출
- 토큰 레벨에서 강제 → 서버 로직 우회 불가

41R에서의 활용:

문제:
  - 41R Token이 전송될 때마다 투명한 운영 수수료가 필요
  - 서버에서 수수료를 따로 계산하면? → 투명성 부족
  - "41R이 정말 5%만 운영비로 쓰는지 어떻게 증명하나?"

해결 (Transfer Fee 5%):
  - 41R Token 생성 시 Transfer Fee = 5% 설정
  - 모든 41R Token 전송에서 자동으로 5%가 운영 수수료로 적립
  - 온체인에서 누구나 수수료율 확인 가능 → 투명성 보장
  - ★ 5%는 온체인 운영 수수료 (서버 비용, 인프라 등)
  - ★ 50/50 수익 배분은 서버가 민팅 시점에 분배 (별도 메커니즘)

구현:
import {
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
} from '@solana/spl-token';

// 1. 41R Token Mint 생성 (Transfer Fee 5% 설정)
const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
const mintKeypair = Keypair.generate();

// Transfer Fee Config 초기화
const initTransferFeeIx = createInitializeTransferFeeConfigInstruction(
  mintKeypair.publicKey,
  feeAuthority.publicKey,        // 수수료율 변경 권한
  withdrawAuthority.publicKey,   // 수수료 인출 권한 (41R Treasury)
  500,                           // feeBasisPoints: 5% (500/10000)
  BigInt(1_000_000),             // maxFee: 1 USDC equivalent
  TOKEN_2022_PROGRAM_ID
);

// Mint 초기화 (서버 = Mint Authority)
const initMintIx = createInitializeMintInstruction(
  mintKeypair.publicKey,
  6,                             // decimals (USDC와 동일)
  serverMintAuthority.publicKey, // ★ 서버가 Mint Authority 보유
  freezeAuthority.publicKey,
  TOKEN_2022_PROGRAM_ID
);

// 2. 자동 테스트 정산 시:
//    기업 $4 예치 → 서버가 50/50 분배 결정
//    → 테스터에게 2.00 41R 민팅 + 전송
//       ├── 테스터 수령: 1.90 41R
//       └── 운영 수수료: 0.10 41R (5%, 자동)
//    → 플랫폼에 2.00 41R 민팅 + 전송
//       ├── 플랫폼 수령: 1.90 41R
//       └── 운영 수수료: 0.10 41R (5%, 자동)

// 3. 플랫폼이 적립된 운영 수수료 인출
const withdrawFeeIx = createWithdrawWithheldTokensFromAccountsInstruction(
  mintKeypair.publicKey,
  operationsTreasuryAccount,     // 운영비 계정
  withdrawAuthority.publicKey,
  [],
  [testerTokenAccount, platformTokenAccount],
  TOKEN_2022_PROGRAM_ID
);

★ 핵심 가치:
  "5% 운영 수수료가 토큰 자체에 내장되어 있습니다.
   서버가 조작하거나 우회할 수 없습니다.
   누구나 온체인에서 5% 수수료율을 직접 확인할 수 있습니다.
   토큰이 실제로 유통·전송 가능한 수준의 합리적 수수료입니다.
   수익 배분(50/50)은 민팅 시점에 투명하게 처리됩니다."
```

### 7.3 Token-2022 Transfer Hook (보상 지급 + 성과 기록 원자적 처리)

```
Transfer Hook이란?
- Token-2022의 확장 기능
- 모든 토큰 전송에서 커스텀 프로그램 로직을 자동 실행
- 전송 후 상태를 반영한 시점에서 호출 → 데이터 정합성 보장
- 하나의 트랜잭션에서 전송 + 커스텀 로직이 원자적으로 실행

41R에서의 활용:

문제:
  - 테스터 보상 지급 후 별도로 "테스트 완료" DB 업데이트?
    → 서버 장애 시 "돈은 갔는데 기록 안 됨" 가능
    → "성과 기록을 누가 조작할 수 있지 않나?"

해결 (Transfer Hook):
  - 보상 전송 시 Transfer Hook이 자동으로 실행
  - 하나의 트랜잭션에서:
    ① 41R Token 전송 (보상)
    ② Transfer Fee 징수 (5% 운영 수수료)
    ③ Transfer Hook 실행 (성과 기록)
  - 하나라도 실패하면 전부 롤백 → 데이터 정합성 100%

구현 (Anchor 프로그램):

// transfer_hook 프로그램 (Anchor)
use anchor_lang::prelude::*;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

#[program]
pub mod test_performance_hook {
    use super::*;

    // Transfer Hook: 보상 전송 시 자동 호출
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        let performance = &mut ctx.accounts.tester_performance;

        // 1. 테스트 완료 횟수 증가
        performance.tests_completed += 1;

        // 2. 누적 보상 금액 업데이트
        performance.total_earned += amount;

        // 3. 최근 활동 시간 갱신
        performance.last_active = Clock::get()?.unix_timestamp;

        // 4. 평균 보상 계산 (품질이 높을수록 높은 보상)
        performance.avg_reward =
            performance.total_earned / performance.tests_completed as u64;

        emit!(TestCompleted {
            tester: ctx.accounts.tester.key(),
            tests_completed: performance.tests_completed,
            amount,
        });

        Ok(())
    }
}

#[account]
pub struct TesterPerformance {
    pub tester: Pubkey,           // 테스터 지갑 주소
    pub tests_completed: u32,     // 누적 테스트 완료 횟수
    pub total_earned: u64,        // 누적 보상 금액
    pub avg_reward: u64,          // 평균 보상 (품질 지표)
    pub last_active: i64,         // 마지막 활동 시간
    pub quality_tier: u8,         // 품질 등급 (1~5)
}

실제 플로우 (자동 테스트 정산):
  기업이 $4 예치, Auto Test 완료
      ↓
  서버가 50/50 분배: 테스터 $2 / 플랫폼 $2
      ↓
  41R Token 2.00 민팅 → 테스터 지갑 전송 (1건의 Solana 트랜잭션)
      ├── ① 테스터에게 2.00 41R 전달
      ├── ② Transfer Fee: 5% 운영 수수료 (0.10 41R 자동 징수)
      └── ③ Transfer Hook: TesterPerformance 자동 갱신
           ├── tests_completed: 3 → 4
           ├── total_earned: 6.00 → 7.90 (수수료 차감 후)
           └── last_active: 2026-02-26T10:00:00Z

★ 핵심 가치:
  "보상 지급과 성과 기록이 하나의 트랜잭션입니다.
   '돈은 받았는데 기록이 안 된' 상태가 불가능합니다.
   성과 데이터는 온체인이라 누구도 조작할 수 없습니다.
   이것이 블록체인 기반 테스터 평판 시스템의 핵심입니다."
```

### 7.4 Solana Attestation Service (SAS) — 테스터 성과 온체인 증명

```
SAS란?
- Solana Foundation + Solana Identity Group이 2025.05 메인넷 출시
- 오프체인 정보를 온체인에 검증 가능한 Credential로 연결
- 개인정보 노출 없이 자격/속성 증명
- npm 패키지: sas-lib

41R에서의 활용:

Transfer Hook이 "매 전송마다 실시간 카운터"라면,
SAS는 "누적 성과를 종합한 공식 자격증명"입니다.

Attestation 종류:

1. Tester Qualification Attestation
   - 발행 시점: 3회 수동 테스트 완료 시
   - 내용: "이 테스터는 3회 수동 테스트를 완료한 실제 사람"
   - 활용: Persona 생성 자격 검증

2. Performance Attestation
   - 발행 시점: Persona 생성 시 + 주기적 갱신
   - 내용:
     ├── 누적 테스트 완료: 15회
     ├── 평균 품질 점수: 4.2/5.0
     ├── 전문 분야: DeFi (0.85), AI Tools (0.72)
     ├── 신뢰도 등급: Gold
     └── 최근 활동: 2026-02-25
   - 활용: 기업이 Persona 선택 시 신뢰도 참고

3. Domain Expert Attestation
   - 발행 시점: 특정 분야 테스트 5회+ 완료 시
   - 내용: "이 테스터는 DeFi 분야 전문 테스터"
   - 활용: 정밀 타겟 매칭, 프리미엄 과금

구현:
import { deriveAttestationPda, getCreateAttestationInstruction,
         fetchSchema, serializeAttestationData } from 'sas-lib';

// SAS Schema 정의 (41R 테스터 성과)
const SCHEMA_DATA = {
  tests_completed: "u32",
  avg_quality: "f32",
  expertise_defi: "f32",
  expertise_ai_tools: "f32",
  trust_tier: "string",        // "Bronze" | "Silver" | "Gold"
  persona_activated: "bool",
};

// Attestation 발행
async function issuePerformanceAttestation(
  testerWallet: PublicKey,
  performanceData: TesterPerformance
) {
  const [attestationPda] = await deriveAttestationPda({
    credential: credentialPda,
    schema: schemaPda,
    nonce: testerWallet,
  });

  const schema = await fetchSchema(rpc, schemaPda);

  const expiryTimestamp = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90일

  const createIx = await getCreateAttestationInstruction({
    payer: platformWallet,
    authority: platformAuthority,
    credential: credentialPda,
    schema: schemaPda,
    attestation: attestationPda,
    nonce: testerWallet,
    expiry: expiryTimestamp,
    data: serializeAttestationData(schema.data, {
      tests_completed: performanceData.tests_completed,
      avg_quality: performanceData.avg_quality,
      expertise_defi: performanceData.expertise_defi,
      expertise_ai_tools: performanceData.expertise_ai_tools,
      trust_tier: performanceData.trust_tier,
      persona_activated: true,
    }),
  });

  await sendAndConfirmInstructions(client, platformWallet, [createIx]);
}

// 다른 dApp에서 검증
// → "이 유저가 41R에서 Gold 등급 테스터인가?" 온체인 확인 가능

Transfer Hook과 SAS의 관계:
┌──────────────────────────────────────────────────┐
│  Transfer Hook (실시간)    SAS Attestation (종합) │
│  ──────────────────────    ────────────────────── │
│  매 보상 전송 시 자동       Persona 생성 시 발행   │
│  tests_completed +1        "Gold 등급 테스터"     │
│  total_earned 갱신         "DeFi 전문가"          │
│  ────────────────────────────────────────────── │
│  역할: 실시간 카운터        역할: 공식 자격증명    │
│  대상: 41R 내부             대상: Solana 생태계    │
│  ★ Hook이 쌓은 데이터로 SAS Attestation을 발행    │
└──────────────────────────────────────────────────┘
```

### 7.5 Solana Memo Program — Persona Fingerprint (Roadmap)

```
Memo Program이란?
- Solana 네이티브 프로그램
- 트랜잭션에 임의 데이터를 첨부하여 불변 기록
- 비용: ~$0.00025/tx (극저비용)
- 프로그램 ID: MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr

41R에서의 활용 (Roadmap):

현재: Persona Vector는 서버 DB에 저장.
      Transfer Hook + SAS로 성과와 자격을 온체인에 기록.

향후: Persona 거래/이동이 발생할 때 무결성 보장이 필요.
      → Persona Vector의 SHA-256 지문을 Memo에 불변 기록

구현 (향후):
import {
  Connection, Transaction, TransactionInstruction,
  PublicKey, Keypair
} from '@solana/web3.js';

const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
);

async function registerPersonaFingerprint(
  persona: PersonaVector,
  walletAddress: string,
  connection: Connection,
  payer: Keypair
) {
  // 1. 지문 생성
  const sorted = JSON.stringify(persona, Object.keys(persona).sort());
  const fingerprint = crypto
    .createHash('sha256')
    .update(sorted)
    .digest('hex');

  // 2. Memo 데이터 구성
  const memoData = JSON.stringify({
    protocol: "41R",
    version: "1",
    type: "PERSONA_FINGERPRINT",
    wallet: walletAddress,
    fingerprint: fingerprint,
    timestamp: new Date().toISOString(),
  });

  // 3. Memo Instruction 생성
  const memoInstruction = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoData),
  });

  // 4. 트랜잭션 전송
  const tx = new Transaction().add(memoInstruction);
  const signature = await connection.sendTransaction(tx, [payer]);

  return { signature, fingerprint };
}

적용 시점:
- MVP: 미구현 (성과 기록은 Transfer Hook + SAS로 충분)
- Q2 2026: Persona 마켓 오픈 시 지문 기록 구현
- 목적: Persona Vector가 거래/이동될 때 "원본과 동일한가?" 검증
```

---

## 8. Data Models

### ERD (Entity Relationship)

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│    Company     │     │     Test      │     │   TestCase    │
├───────────────┤     ├───────────────┤     ├───────────────┤
│ wallet_addr PK│──┐  │ test_id    PK │──┐  │ case_id    PK │
│ company_name  │  └─→│ company_addr  │  └─→│ test_id    FK │
│ domain        │     │ target_url    │     │ type          │
│ created_at    │     │ requirements  │     │ content (JSON)│
└───────────────┘     │ budget_usdc   │     │ order         │
                      │ status        │     └───────────────┘
                      │ escrow_pda    │
                      │ created_at    │
                      └───────────────┘
                            │
                  ┌─────────┴──────────┐
                  ▼                    ▼
┌───────────────┐     ┌───────────────────────┐
│    Tester     │     │      TestReport       │
├───────────────┤     ├───────────────────────┤
│ wallet_addr PK│──┐  │ report_id          PK │
│ display_name  │  └─→│ tester_addr        FK │
│ profile (JSON)│     │ test_id            FK │
│ tests_done    │     │ checklist_results     │
│ persona_id FK │     │ scenario_log          │
│ created_at    │     │ questionnaire_answers │
└───────────────┘     │ quality_score         │
        │             │ is_persona_test       │
        ▼             │ screenshots (JSON)    │
┌───────────────┐     │ created_at            │
│   Persona     │     └───────────────────────┘
├───────────────┤
│ persona_id PK │     ┌───────────────────────┐
│ tester_addr FK│     │     Settlement        │
│ vector (JSON) │     ├───────────────────────┤
│ is_active     │     │ settlement_id      PK │
│ sas_attest_id │     │ test_id            FK │
│ created_at    │     │ report_id          FK │
│ updated_at    │     │ payer_addr            │
└───────────────┘     │ payee_addr            │
                      │ amount_token          │
                      │ fee_collected         │
                      │ hook_tx_sig           │
                      │ tx_signature          │
                      │ settled_at            │
                      └───────────────────────┘

┌─────────────────────────────┐
│  TesterPerformance (온체인)  │
├─────────────────────────────┤
│ tester         Pubkey       │
│ tests_completed  u32        │
│ total_earned     u64        │
│ avg_reward       u64        │
│ last_active      i64        │
│ quality_tier     u8         │
└─────────────────────────────┘
  ↑ Transfer Hook이 자동 갱신
```

### Persona Vector Full Schema

```json
{
  "persona_id": "persona_abc123",
  "version": 1,
  "owner_wallet": "7xKXtg2CW87...",

  "test_style": {
    "thoroughness": 0.92,
    "speed": 0.65,
    "ux_focus": 0.88,
    "bug_detection": 0.75,
    "creativity": 0.60
  },

  "expertise": {
    "defi": 0.85,
    "nft": 0.40,
    "gaming": 0.30,
    "ai_tools": 0.72,
    "general_web": 0.90
  },

  "feedback_pattern": {
    "ui_critical": 0.90,
    "security_aware": 0.78,
    "performance_sensitive": 0.55,
    "accessibility_focus": 0.45,
    "detail_oriented": 0.88
  },

  "reliability": {
    "quality_score": 0.87,
    "consistency": 0.82,
    "response_rate": 1.0
  },

  "voice_sample": "이 테스터는 UI의 미세한 불일치를 잘 포착하며, 보안 관련 이슈에 특히 민감합니다. 피드백은 구체적이고 건설적이며, 항상 대안을 제시합니다.",

  "meta": {
    "based_on_reports": 3,
    "domains_tested": ["defi", "nft_marketplace"],
    "sas_attestation_id": "attest_xyz789",
    "created_at": "2026-02-25T10:00:00Z",
    "updated_at": "2026-02-25T10:00:00Z"
  }
}
```

---

## 9. Privacy & Security Architecture

```
┌──────────────────────────────────────────────────────────┐
│                Privacy & Security Layers                  │
│                                                          │
│  Layer 1: 데이터 분류 (Data Classification)               │
│  ─────────────────────────────────────────                │
│  │ 데이터 유형     │ 저장 위치    │ 공개 범위           │  │
│  │─────────────────│─────────────│──────────────────── │  │
│  │ 테스트 리포트    │ 서버 DB     │ 기업 + 테스터만     │  │
│  │ Persona Vector  │ 서버 DB     │ 마켓 공개 (익명)    │  │
│  │ 성과 기록       │ Solana 체인  │ 공개 (Transfer Hook)│  │
│  │ 자격 증명       │ Solana 체인  │ 공개 (SAS)          │  │
│  │ 결제 금액       │ Solana 체인  │ 공개 (표준 전송)    │  │
│  │ 지갑 주소       │ Solana 체인  │ 공개 (but 익명)     │  │
│  │ 테스터 프로필    │ 서버 DB     │ 본인만             │  │
│                                                          │
│  Layer 2: 온체인 투명성 (On-Chain Transparency)            │
│  ─────────────────────────────────────────                │
│  ├── Transfer Fee: 수수료율 온체인 공개 → 누구나 검증     │
│  ├── Transfer Hook: 성과 데이터 온체인 → 조작 불가        │
│  ├── SAS Attestation: 자격 증명 온체인 → 타 dApp 재사용   │
│  └── [Roadmap] Memo: Persona 지문 → 변조 탐지            │
│                                                          │
│  Layer 3: 서버 보안 (Server Security)                     │
│  ─────────────────────────────────────                    │
│  ├── 리포트 암호화 저장 (AES-256)                         │
│  ├── API 인증: 지갑 서명 기반 (Solana Sign-In)            │
│  ├── x402: 결제 없이 API 접근 불가                        │
│  └── Rate Limiting: DDoS 방지                             │
│                                                          │
│  Layer 4: 테스터 평판 무결성 (Reputation Integrity)        │
│  ─────────────────────────────────────────                │
│  ├── Transfer Hook: 매 보상마다 성과 자동 기록 (원자적)    │
│  ├── SAS: 누적 성과 → 공식 자격증명 발행                  │
│  ├── 품질 조작: Hook이 온체인 기록 → DB 수정으로 우회 불가 │
│  └── [Roadmap] Persona 지문: Vector 변조 시 즉시 탐지     │
│                                                          │
│  ★ 핵심 원칙:                                             │
│  "수수료와 성과는 토큰 프로토콜이 강제하고,               │
│   자격 증명은 Solana가 보증합니다."                        │
└──────────────────────────────────────────────────────────┘
```

---

## 10. Revenue Model & Settlement Flow

### 수익 구조

```
┌──────────────────────────────────────────────────────────┐
│                    Revenue Streams                        │
│                                                          │
│  1. Persona 자동 테스트 수익 배분 (50/50)                  │
│     ├── 서버가 USDC 수령 → 50% 테스터 / 50% 플랫폼 분배  │
│     ├── 각각 41R Token으로 민팅하여 전송                   │
│     ├── Transfer Fee 5%는 온체인 운영 수수료 (별도)       │
│     └── 수동 테스트: USDC 직접 지급, 수수료 0%            │
│         (테스터 획득 비용 = 마케팅 투자)                   │
│                                                          │
│  2. x402 마이크로페이먼트 (API 접근 수수료)                │
│     ├── Persona 검색: $0.05/query                         │
│     ├── 결과 조회: $0.05/query                            │
│     ├── Persona 상세: $0.10/query                         │
│     └── 월 1,000 queries × $0.05 = $50/mo                │
│                                                          │
│  3. 온체인 운영 수수료 (Transfer Fee 5%)                   │
│     ├── 41R Token 전송 시 5% 자동 징수                    │
│     ├── 서버 인프라, 블록체인 비용, 운영비에 활용          │
│     └── 온체인에서 투명하게 확인 가능                      │
│                                                          │
│  4. (Q3+) 기업 구독 모델                                   │
│     └── 월 $500~$5,000 무제한 접근                        │
│                                                          │
│  연간 수익 예측 (Year 1):                                  │
│  ├── Persona 자동 테스트 (50% 수익분배): ~$360,000        │
│  │   (월 200건 × $600 평균 × 50% 플랫폼 몫              │
│  │    = $60,000 × 12 × 50%)                              │
│  ├── Transfer Fee 운영 수수료 (5%):     ~$36,000          │
│  │   (연간 $720,000 전송 × 5%)                            │
│  ├── x402 API 수수료:                   ~$12,000          │
│  │   (일 1,000 queries × $0.05 × 365 ≈ $18,250          │
│  │    - 현실적 보정 65%)                                  │
│  └── 구독 (Q3~):                        ~$60,000          │
│      (월 10사 × $1,000 × 6개월)                          │
│                                                          │
│  Total Year 1: ~$468,000                                 │
└──────────────────────────────────────────────────────────┘
```

### 정산 플로우

```
수동 테스트 정산 (USDC 직접 지급):
──────────────────────────────────────────────
기업 USDC 예치
    → Escrow PDA
         → 테스트 완료 확인
              → USDC $3~$5 → 테스터 지갑 (100%, 수수료 없음)
              → Transfer Hook: 테스트 완료 기록 (횟수 카운팅만)

Persona 자동 테스트 정산 (41R Token):
──────────────────────────────────────────────
기업 USDC 예치 ($4 예시)
    → Escrow PDA
         → Auto Test 완료 확인
              → 서버가 50/50 분배 계산
              → USDC $4 → Platform USDC Treasury 보관
              → 41R Token 민팅 (서버 = Mint Authority)
                   ├── 테스터에게 2.00 41R 민팅 + 전송
                   │   ├── Transfer Fee: 5% (0.10 41R) 운영비 자동 징수
                   │   └── Transfer Hook: 성과 기록 자동 갱신
                   │       ├── tests_completed += 1
                   │       ├── total_earned += 1.90
                   │       └── avg_reward 재계산
                   └── 플랫폼에 2.00 41R 민팅 + 전송
                       └── Transfer Fee: 5% (0.10 41R) 운영비 자동 징수

41R → USDC 리딤 플로우:
──────────────────────────────────────────────
테스터: 41R 리딤 요청 (예: 10 41R)
    → 서버가 41R Token 소각 (burn)
         → Platform USDC Treasury에서 10 USDC 지급
              → 테스터 지갑으로 USDC 전송
```

---

## 11. Demo Scenario (4-minute)

```
┌─────────────────────────────────────────────────────────────┐
│                    4-MINUTE DEMO SCENARIO                    │
│                                                             │
│  0:00-0:30  PROBLEM (문제 제시)                              │
│  ─────────────────────────────────────                      │
│  "앱 테스트에 인당 $49, 10명이면 $490.                      │
│   결과까지 2주. 그리고 그 테스터가 내 제품의                 │
│   진짜 타겟 유저인지도 모릅니다.                             │
│   테스트를 한 번 더 하고 싶으면? 처음부터 다시."             │
│                                                             │
│  0:30-1:15  기업 테스트 등록  ← WOW #1                      │
│  ─────────────────────────────────────                      │
│  ∙ URL 입력: https://demo-dex.app                           │
│  ∙ "신규 유저의 첫 스왑 경험을 테스트해주세요"               │
│  ∙ [버튼 클릭] → LLM이 실시간으로 테스트 케이스 생성!       │
│    → 체크리스트 4개 + 시나리오 1개 + 질문지 4개              │
│  ∙ USDC $50 예치 → Solana TX 확인 (Escrow PDA)             │
│                                                             │
│  1:15-1:45  테스터 수동 테스트 (미리 3회 완료 상태)          │
│  ─────────────────────────────────────                      │
│  ∙ 테스터 프로필 보여주기 (DeFi 전문, UI 까다로움)          │
│  ∙ "이 테스터가 3회 테스트를 완료했습니다"                   │
│  ∙ 보상 수령: USDC $3 즉시 지급 TX 확인 ★                   │
│  ∙ Transfer Hook으로 테스트 완료 기록 자동 갱신 ★            │
│    → Explorer에서 TesterPerformance 계정 확인               │
│                                                             │
│  1:45-2:15  Persona 생성 + SAS 등록  ← WOW #2              │
│  ─────────────────────────────────────                      │
│  ∙ 3회 리포트 분석 → AI Persona 자동 생성                   │
│  ∙ Persona Vector 보여주기 (UI 시각화)                      │
│    "thoroughness: 0.92, ux_focus: 0.88, defi: 0.85"        │
│  ∙ SAS Attestation 발행 → "Gold 등급 DeFi 전문 테스터"      │
│  ∙ "이 자격증명은 41R 밖 다른 Solana dApp에서도 유효합니다" │
│                                                             │
│  2:15-3:15  ★★★ KILLING MOMENT: Persona 자동 테스트 ★★★    │
│  ─────────────────────────────────────                      │
│  ∙ 새 테스트 등록됨 → Persona 자동 매칭                     │
│  ∙ [실행 버튼] → 브라우저가 실제 사이트 방문!               │
│    → AI가 지갑 연결 버튼 찾기...                            │
│    → 클릭! 스크린샷 캡처!                                   │
│    → 토큰 선택... 스왑 실행...                              │
│    → 전 과정 자동 수행 + 스크린샷 5장                       │
│  ∙ Persona 관점 리포트 자동 생성 ← WOW #3                  │
│    "이 테스터의 관점에서: 지갑 연결 버튼의 색상 대비가       │
│     약해 DeFi 초보자는 찾기 어려울 것으로 예상됩니다..."     │
│  ∙ 자동 정산 (41R Token):                                   │
│    ① 서버가 50/50 분배 → 41R 민팅                          │
│    ② 테스터에게 41R 전송 + 5% 운영 수수료 자동 징수         │
│    ③ Transfer Hook → 성과 기록 자동 갱신                    │
│                                                             │
│  3:15-3:45  Solana 기술 통합 (차별점)                       │
│  ─────────────────────────────────────                      │
│  ∙ "지금 보신 데모에 Solana 기술 4가지가 사용되었습니다"    │
│    1. x402: $3~$5 USDC 즉시 보상 (Stripe 대비 1,500배 저렴)│
│    2. Transfer Fee: 5% 운영 수수료 토큰 레벨 자동 징수      │
│    3. Transfer Hook: 보상 = 성과 기록, 하나의 트랜잭션      │
│    4. SAS: 테스터 성과를 Solana 생태계 공식 자격증명으로     │
│  ∙ "Solana 없으면 이 4가지가 전부 안 됩니다."              │
│                                                             │
│  3:45-4:00  비즈니스 모델 + 마무리                          │
│  ─────────────────────────────────────                      │
│  ∙ Year 1 ~$468K 예상 수익                                 │
│  ∙ "테스터는 3번 일하면 AI 분신이 평생 돈을 벌어다 줍니다"  │
│  ∙ "기업은 URL만 넣으면 AI가 테스트합니다"                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 12. Judge Q&A — Why Solana?

### Q: "왜 Solana인가? 다른 체인에서도 되지 않나?"

```
A: "4가지 기술이 비즈니스 로직에 직결되어 있습니다."

1. x402 Micropayment
   → $3 보상에 Stripe 수수료 $0.387 (12.9%) → 소액에 과도한 비용
   → Solana tx 수수료 $0.00025 → x402로 실시간 소액 보상 가능
   → Coinbase 개발, Solana와 Base가 주요 프로덕션 네트워크

2. Token-2022 Transfer Fee
   → 5% 온체인 운영 수수료가 토큰 자체에 내장
   → 서버 조작 불가, 온체인에서 수수료율 공개 검증
   → Solana Token-2022 네이티브 기능, 타 체인에 동등한 것 없음

3. Token-2022 Transfer Hook
   → 보상 전송 = 성과 기록이 하나의 원자적 트랜잭션
   → "돈은 갔는데 기록 안 됨" 불가능
   → Solana Token-2022 네이티브 기능

4. SAS Attestation
   → 테스터 성과/품질/전문성을 Solana 생태계 공식 Credential로
   → 다른 dApp에서도 재사용 가능한 포터블 평판
   → 2025.05 메인넷 출시, Solana 네이티브

결론: 이 4가지는 "Solana에서도 되는 기능"이 아니라
      "Solana에서만 이 조합이 가능한 기능"입니다.
```

### Q: "Persona가 자동 테스트한 결과를 기업이 신뢰할까?"

```
A: "신뢰는 기술로 증명합니다."

1. Persona는 실제 3회 테스트를 수행한 사람의 데이터 기반
   → SAS Attestation으로 "3회 완료" 온체인 증명

2. 테스터의 성과가 조작 불가
   → Transfer Hook이 매 보상마다 온체인에 자동 기록
   → 품질 점수, 완료 횟수 모두 온체인 데이터

3. 수수료 구조가 투명
   → Transfer Fee가 토큰에 내장 → 온체인에서 누구나 확인
   → "41R이 정말 5%만 운영비로 쓰는지?" → 토큰 Mint 확인으로 증명
   → 수익 배분(50/50)은 민팅 시점에 투명하게 처리

4. 가격 차등으로 기대치 관리
   → 수동 테스트: $3~$5 USDC 직접 지급 "진짜 사람"
   → Persona 테스트: 41R Token "AI 시뮬레이션"
   → 기업이 용도에 맞게 선택

5. 리포트에 명확 표시
   → 수동 테스트 / Persona 테스트
   → 투명하게 구분
```

### Q: "Cold Start 어떻게 해결하나?"

```
A: "테스터 먼저, Persona는 자연스럽게."

1단계: Web3 커뮤니티 타겟
  - 지갑 있음 (가입 마찰 제로)
  - 보상 참여 익숙 (에어드롭, 스테이킹)
  - 커뮤니티 밀집 (Discord/Telegram에 이미 모여 있음)

2단계: 수동 테스트로 양면 구축
  - 기업: "실제 사람이 테스트" → 신뢰
  - 테스터: "돈 받으면서 3회" → 자연스럽게 Persona 생성

3단계: Persona 축적 → 자동화 시작
  - 100개 Persona → 기업에게 "자동 테스트 가능" 제안
  - 비용 50% 절감 → 기업 유입 가속

핵심: "Persona가 없어도 수동 테스트로 가치 제공.
       Persona는 보너스이지 필수가 아닌 상태에서 시작."
```

---

## 13. 7-Day Implementation Roadmap

```
┌─────────────────────────────────────────────────────────────┐
│                  7-DAY HACKATHON SPRINT                      │
│                                                             │
│  Day 1: 기반 셋업 + PoC (★ 가장 중요)                       │
│  ═══════════════════════════════════════                     │
│  □ Express.js + PostgreSQL + Next.js 스캐폴딩               │
│  □ Solana 지갑 연결 (Phantom Adapter)                       │
│  □ ★ x402 hello-world: 402 → 결제 → 응답 확인              │
│  □ ★ Stagehand hello-world: 사이트 방문 → 클릭 → 스크린샷   │
│  □ ★ Token-2022 hello-world: Transfer Fee 토큰 생성 + 전송  │
│  → 완료 기준: 3개 PoC 모두 동작 확인                        │
│                                                             │
│  Day 2: 기업 사이드 — 테스트 등록 + Token-2022 셋업         │
│  ═══════════════════════════════════                         │
│  □ URL + 요구사항 입력 폼 (Next.js)                         │
│  □ LLM 테스트 케이스 자동 생성 API                           │
│  □ 테스트 항목 DB 저장 + 목록 API                            │
│  □ USDC 예치 → Escrow PDA                                   │
│  □ 41R Token Mint (Transfer Fee 5% + Transfer Hook)         │
│  □ Transfer Hook 프로그램 배포 (TesterPerformance 기록)     │
│  → 완료 기준: URL 입력 → 케이스 생성 → 토큰 전송 → 성과기록 │
│                                                             │
│  Day 3: 테스터 사이드 — 수동 테스트                          │
│  ═══════════════════════════════════                         │
│  □ 테스터 프로필 등록 UI/API                                 │
│  □ 테스트 목록 조회 + 선택                                   │
│  □ 테스트 수행 UI (체크리스트+시나리오+질문지)               │
│  □ 리포트 제출 + 보상 지급 (USDC $3~$5 직접 전송)           │
│  □ Transfer Hook 동작 확인 (횟수 카운팅)                     │
│  → 완료 기준: 가입 → 테스트 → 리포트 → USDC 수령 → 성과기록 │
│                                                             │
│  Day 4: Persona 생성 + SAS 등록                              │
│  ═══════════════════════════════════                         │
│  □ 3회 리포트 → LLM Persona Vector 생성                     │
│  □ SAS Attestation 발행 (성과 + 품질 + 전문 분야)           │
│  □ Persona 대시보드 UI                                      │
│  □ x402 미들웨어 적용 (결과 조회 / Persona 검색 API)        │
│  → 완료 기준: 3회 리포트 → Persona → SAS Attestation         │
│                                                             │
│  Day 5: ★ Auto Test Engine (KILLING MOMENT)                 │
│  ═══════════════════════════════════════                     │
│  □ Stagehand + Persona → 자동 사이트 방문                   │
│  □ 테스트 케이스 자동 수행 + 스크린샷 캡처                   │
│  □ Vision LLM → Persona 관점 리포트 생성                    │
│  □ UX 피드백 시뮬레이션                                     │
│  □ 41R Token 민팅 + 50/50 정산 (Transfer Fee 5% + Hook)     │
│  → 완료 기준: Persona → 사이트 자동 방문 → 리포트 → 정산    │
│                                                             │
│  Day 6: 통합 + 데모 준비                                     │
│  ═══════════════════════════════════                         │
│  □ E2E 플로우 통합 테스트                                    │
│  □ 데모용 Persona 3~5개 (사전 3회 완료)                     │
│  □ 데모 타겟 사이트 Stagehand 테스트                        │
│  □ SAS Attestation UI (자격 증명 표시)                      │
│  □ 프론트엔드 폴리시                                        │
│  → 완료 기준: 전체 데모 1회 완벽 수행                       │
│                                                             │
│  Day 7: 발표 + 제출                                         │
│  ═══════════════════════════════════                         │
│  □ 피치 덱 (4분 시나리오)                                   │
│  □ 데모 영상 녹화                                           │
│  □ README 작성                                              │
│  □ Solana 기술 통합 다이어그램 포함                          │
│  □ 제출                                                     │
│                                                             │
│  ═══════════════════════════════════════════════════════     │
│  우선순위 컷라인:                                           │
│  ✅ 필수: 테스트 생성 + 수동 테스트 + Persona + 자동 테스트  │
│  ⭐ 높음: x402 + Token-2022 (Fee+Hook) + Stagehand 데모     │
│  🔷 중간: SAS Attestation                                   │
│  ⚡ 보너스: Memo 지문 기록                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 14. Risk Analysis & Mitigation

| # | 리스크 | 영향도 | 확률 | 완화 전략 |
|---|--------|:------:|:----:|-----------|
| 1 | Stagehand가 데모 사이트에서 동작 안 함 | 🔴 높음 | 중 | Day 1 PoC 필수. 실패 시 → 자체 데모 사이트에서 시연. 2~3개 사이트 사전 테스트 |
| 2 | x402 라이브러리 통합 난이도 | 🔴 높음 | 중 | Day 1 hello-world. @x402/express + @x402/fetch 공식 SDK 사용 |
| 3 | Transfer Hook 프로그램 개발 시간 | 🔴 높음 | 중 | Day 1-2에 Anchor 기반 PoC. 실패 시 → 서버 사이드 기록 + "프로덕션에서 Hook 전환" 설명 |
| 4 | LLM 테스트케이스 품질 불안정 | 🟡 중간 | 낮 | 프롬프트 튜닝 + 데모 데이터 사전 준비 |
| 5 | Vision LLM 비용 (스크린샷 분석) | 🟡 중간 | 낮 | Claude Sonnet 사용. 스크린샷 1280x720 제한. 테스트당 5장 이내 |
| 6 | SAS SDK 학습 곡선 | 🟢 낮음 | 중 | Day 4에 시도. 실패 시 → 개념 설명 + 아키텍처로 대체 |
| 7 | 7일 일정 내 전부 구현 불가 | 🟡 중간 | 중 | 우선순위 컷라인 엄격 적용 |

---

## 15. Post-Hackathon Roadmap

```
Q1 2026: MVP Launch (Web3 Community)
─────────────────────────────────────
├── 100 테스터 확보 → 30+ Persona 활성화
├── 5개 기업 파일럿
├── Memo Program 지문 기록 구현
├── Mainnet 배포
└── Solana Devnet → Mainnet 마이그레이션

Q2 2026: Persona 고도화
─────────────────────────────────────
├── Persona Vector 정교화 (더 많은 리포트 반영)
├── Persona 매칭 알고리즘 개선 (ML 기반)
├── Persona 마켓 오픈 (거래/이동 + Memo 지문 검증)
├── 기업 대시보드 v2 (분석 기능 강화)
└── Stagehand 범용성 개선 (더 많은 사이트 지원)

Q3 2026: 기업 구독 모델
─────────────────────────────────────
├── 월간 구독 패키지 ($500~$5,000)
├── API 통합 (기업 CI/CD에 테스트 자동 포함)
├── Persona 다양성 확장 (비-Web3 도메인)
├── SAS Attestation 생태계 확장
└── 다른 dApp에서 41R Persona Attestation 활용

Q4 2026: 스케일링
─────────────────────────────────────
├── Solana Program (Smart Contract)으로 정산 자동화
├── Treasury 온체인 멀티시그 운영
├── AI Agent 간 Persona 거래 마켓
└── 글로벌 확장 (AI/Tech 스타트업 → 일반 스타트업)
```

---

## Appendix: Tech Stack Summary

| 구분 | 기술 | 용도 |
|------|------|------|
| Frontend | Next.js 14, TailwindCSS | 기업/테스터/Persona 대시보드 |
| Backend | Express.js, Node.js | REST API, 비즈니스 로직 |
| Database | PostgreSQL | 유저, 테스트, 리포트, 정산 |
| Vector DB | Qdrant (선택) | Persona 매칭용 벡터 검색 |
| AI/LLM | Claude Sonnet (Anthropic) | 테스트케이스 생성, Persona 분석, 리포트 생성 |
| Browser Agent | Stagehand (Browserbase) | AI 브라우저 자동화 (Playwright 기반) |
| Blockchain | Solana (Devnet → Mainnet) | 결제, 성과 기록, 자격 증명 |
| Payment | x402 (@x402/express, @x402/fetch) | HTTP 402 마이크로페이먼트 |
| Token | 41R Token (Token-2022) | Persona 자동 테스트 보상 + 운영 수수료 + 성과 기록 |
| Token Extension | Transfer Fee | 5% 온체인 운영 수수료 자동 징수 |
| Token Extension | Transfer Hook | 보상 전송 시 성과 데이터 원자적 기록 |
| Identity | SAS (Solana Attestation Service) | 테스터 성과/품질/전문 분야 온체인 증명 |
| Fingerprint | Solana Memo Program (Roadmap) | Persona Vector 지문 불변 기록 |
| Settlement | USDC (SPL Token) | 수동 테스트 직접 지급 + 기업 예치/결제 기본 화폐 |

---

## Appendix: v3 → v4 변경 내역

| 항목 | v3 | v4 | 변경 사유 |
|------|----|----|-----------|
| ZK Compression | Core (6개 기술) | **제거** | Persona는 오프체인 데이터. 온체인 저장할 것이 없어 비용 절감 논거 부적합 |
| Confidential Balances | Core (6개 기술) | **제거** | "왜 금액을 숨겨야 하는가" 비즈니스 근거 약함. USDC는 레거시 Token Program이라 직접 적용 불가 |
| ACK Protocol | Core (6개 기술) | **제거** | AI Persona ≠ AI Agent. 현재 Persona는 자율 경제 활동을 하지 않음 |
| Token-2022 Transfer Fee | 없음 | **Core 추가** | 플랫폼 수수료를 토큰 레벨에서 강제 → 투명성 + 우회 불가 |
| Token-2022 Transfer Hook | 없음 | **Core 추가** | 보상 지급 = 성과 기록을 원자적 처리 → 데이터 정합성 보장 |
| SAS 용도 | "3회 완료" 자격 | **성과/품질/전문 분야 종합 증명**으로 확대 | Transfer Hook의 실시간 데이터를 종합한 공식 자격증명 |
| Memo Program | Core (6개 기술) | **Roadmap으로 축소** | MVP에서는 Transfer Hook + SAS로 충분. 향후 Persona 거래 시 필요 |
| x402 Solana 49.7% | 슬라이드에 포함 | **제거** | 특정 주간 데이터 + non-organic 트래픽 이슈. 팩트체크 미통과 |
| Ethereum 12-15초 비교 | 비교표에 포함 | **제거** | 블록 타임과 파이널리티 혼용. 비교 기준 불일치 |
| 비교 방식 | 체인 간 비교표 | **Stripe vs x402** | 심사위원에게 더 직관적인 비교. 팩트체크 통과 |

---

## Appendix: v4 → v5 변경 내역

| 항목 | v4 | v5 | 변경 사유 |
|------|----|----|-----------|
| 결제 모델 | 수동+자동 모두 41R Token | **이중 모델: 수동=USDC, 자동=41R Token** | 같은 토큰으로 다른 수수료율(0% vs 50%) 적용 불가 문제 해결. 수동은 USDC 직접 지급, 자동만 41R Token 사용 |
| Transfer Fee | 50% (5000 bp) | **5% (500 bp)** | 50%는 수익 배분 메커니즘으로 부적합. 5%는 투명한 온체인 운영 수수료. 토큰이 실제 유통 가능한 수준 |
| 수익 배분 | Transfer Fee 50%로 자동 | **서버가 민팅 시점에 50/50 분배** | 수익 배분은 민팅 수량으로 제어 (테스터 몫 + 플랫폼 몫 각각 민팅). Transfer Fee는 운영 수수료 전용 |
| 수동 테스트 보상 | $0.10 | **$3~$5** | $0.10은 테스터 동기부여 부족. $3~$5로 현실적 보상. Stripe 대비 여전히 우위 ($0.387 vs $0.00025) |
| 41R Token 민팅 | 불명확 | **서버 = Mint Authority, USDC 1:1 민팅** | 명확한 토큰 라이프사이클: USDC 수령 → 41R 민팅 → 테스터 리딤 시 소각 → USDC 반환 |
| 리딤 메커니즘 | 없음 | **41R → USDC 리딤 (소각 + USDC 지급)** | 테스터가 41R을 실제 가치로 환전할 수 있는 경로 제공 |
| x402 비교 | $0.10 보상 vs Stripe | **$3 보상 vs Stripe** | $3에도 Stripe 수수료 12.9% ($0.387) vs Solana 0.008% ($0.00025). 논거 여전히 유효 |
| 예산 예시 | $50 → 500건 ($0.10) | **$50 → 10~16건 수동 ($3~$5)** | 현실적 예산 배분: 수동 테스트 + 자동 테스트 혼합 |
| 연간 수익 예측 | ~$792K | **~$468K** | Transfer Fee 50% → 5% 변경 + 수익 배분 구조 현실화 반영 |

---

> **Document Version**: v5.0
> **Last Updated**: 2026-02-26
> **Team**: 41R
> **Event**: Solana Startup Village
