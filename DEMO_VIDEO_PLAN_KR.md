# 41R Persona Market — 데모 영상 촬영 계획 (60초)

## 개요

- **목표**: 60초 이내
- **형식**: 화면 녹화 + 자막 (나레이션 선택)
- **도구**: OBS / QuickTime / Loom
- **해상도**: 1920x1080, 브라우저 전체화면
- **주소**: http://localhost:3000
- **데이터 초기화**: `npx tsx scripts/seed-data.ts`

---

## 타임라인

### 장면 1: 후킹 — "41R이 뭔가요?" (0:00 ~ 0:05)

**화면**: 랜딩 페이지 → http://localhost:3000
**동작**:
1. 페이지 로드 → Hero 영역 보여주기
2. "AI Persona-Driven Product Validation" 타이틀 + 실시간 통계 (2 Active Tests, 5 AI Personas)
3. 파이프라인 흐름 가볍게 훑기 (Register URL → AI Test Cases → Testers earn USDC → Persona → Auto Test)

**자막**:
> "41R은 실제 테스터를 AI Persona로 만들어, 솔라나 위에서 제품을 자동 검증합니다."

---

### 장면 2: 기업 — 테스트 등록 (0:05 ~ 0:13)

**화면**: Company Dashboard → http://localhost:3000/company
**동작**:
1. 대시보드에서 기존 테스트 2개 (jup.ag, magiceden) 보여주기
2. "+ Register New Test" 클릭 → 등록 페이지로 이동
3. 폼 채우기 (아래 데이터 복붙)
4. "Deposit USDC & Register Test" 클릭
5. Phantom 승인 → AI 로딩 표시 (Analyzing → Generating → Finalizing)
6. 테스트 상세 페이지 → 생성된 테스트 케이스 (체크리스트 + 시나리오 + 질문지) 보여주기

**자막**:
> "기업이 URL을 등록하고 USDC를 예치하면, Claude AI가 체크리스트, 시나리오, 질문지를 자동 생성합니다."

**입력 데이터**:
| 필드 | 값 |
|------|-----|
| Company Wallet | *(Phantom에서 자동 입력됨)* |
| Target URL | `https://jup.ag` |
| Requirements | 아래 텍스트 복붙 |
| Budget (USDC) | `50` |
| Reward per Tester | `$5.0` |
| Enable AI Auto-Test | ✅ 체크 |

**Requirements 입력 텍스트** (복사용):
```
Verify DeFi token swap accuracy — check that exchange rates match on-chain data, slippage protection works correctly, and fee calculations are transparent. Also audit for security vulnerabilities: wallet permission scoping, transaction simulation before signing, and protection against sandwich attacks.
```
> 해석: DeFi 토큰 스왑 정확도 검증 — 환율이 온체인 데이터와 일치하는지, 슬리피지 보호가 작동하는지, 수수료 계산이 투명한지 확인. 보안 취약점도 감사: 지갑 권한 범위, 서명 전 트랜잭션 시뮬레이션, 샌드위치 공격 방어.

**시간 절약 팁**: 등록 과정 건너뛰고 기존 jup.ag 테스트 상세만 보여줘도 됨

---

### 장면 3: 테스터 등록 (0:13 ~ 0:20)

**화면**: Tester Profile → http://localhost:3000/tester/profile
**동작**:
1. Phantom 지갑 연결 상태 → 지갑 주소 자동 입력됨
2. "Load" 클릭 → "Not registered yet" 표시 → 등록 폼 나타남
3. 프로필 데이터 입력 (아래 참고)
4. "Register as Tester" 클릭
5. 등록 완료 → 프로필 카드 표시 (tests_done=0, Persona: Not yet)
6. "Complete 3 more test(s) to unlock AI Persona generation" 메시지 보여주기

**자막**:
> "테스터가 지갑을 연결하고 전문 분야를 등록합니다. 3회 테스트 후 AI Persona가 자동 생성됩니다."

**입력 데이터**:
| 필드 | 값 | 설명 |
|------|-----|------|
| Display Name | `Alex Kim` | 이름 |
| Age Range | `20s` | 드롭다운 선택 |
| Region | `KR` | 입력 |
| Occupation | `blockchain developer` | 입력 |
| Expertise | `defi`, `web3` 클릭 | DeFi + Web3 전문가 (칩 2개 선택) |
| Crypto Experience | `advanced` | 드롭다운 선택 |
| Experience Level | `expert` | 드롭다운 선택 |
| Preferred Domains | `defi`, `dao` 클릭 | 관심 도메인 (칩 2개 선택) |
| Primary Device | `Desktop` 클릭 | 버튼 선택 |
| Design Matters? | `Yes` 클릭 | 버튼 선택 |
| Frustration Triggers | `slow loading`, `unclear fees` 클릭 | 짜증 포인트 (칩 2개 선택) |

**화면 흐름**: 칩을 톡톡 클릭하는 게 시각적으로 예쁨 — 특히 Expertise/Domains/Frustration 영역

---

### 장면 4: 테스터 — 수동 테스트 + USDC 보상 (0:20 ~ 0:33)

**화면**: 테스터 테스트 목록 → 테스트 실행 페이지
**사용할 테스트**: 시드된 jup.ag 테스트
**바로가기**: http://localhost:3000/tester/tests → jup.ag 클릭

**동작**: 체크리스트 → 시나리오 → 질문지 채우기 → 제출 → 결과 확인

**자막**:
> "테스터가 구조화된 테스트를 완료하면 USDC 보상을 받습니다. 보상 금액은 리포트 품질에 비례합니다."

#### 체크리스트 입력 (4개 항목 — 빠르게 클릭)

| ID | 작업 내용 | 상태 | 메모 (복사용) |
|----|----------|------|--------------|
| cl-1 | Connect a Phantom wallet to the DEX | **passed** 클릭 | `Wallet connected instantly, address displayed in top-right corner` |
| cl-2 | Perform a token swap (SOL to USDC) | **passed** 클릭 | `Swap executed in ~3s, balance updated, tx hash shown with Solscan link` |
| cl-3 | Check slippage settings modal | **failed** 클릭 | `Custom slippage input accepts values above 50% without warning — potential MEV risk` |
| cl-4 | View transaction history | **passed** 클릭 | `History loads correctly with timestamps and amounts` |

> cl-3 해석: 커스텀 슬리피지 입력이 50% 이상도 경고 없이 허용됨 — MEV 리스크
> ※ 일부러 **failed** 처리해서 보안 이슈를 발견한 느낌을 줌

#### 시나리오 입력 (1개)

텍스트 영역에 복붙:
```
Swapped 2 SOL → USDC. Rate matched CoinGecko within 0.3%. Tried setting slippage to 99% — no warning shown, which is dangerous. Fee breakdown was clear before confirmation. Attempted providing liquidity but the pool page loaded slowly (~4s). Overall, swap UX is smooth but slippage guardrails need improvement.
```
> 해석: 2 SOL → USDC 스왑 수행. 코인게코 대비 0.3% 내 정확도. 슬리피지 99% 설정 시도했는데 경고 없음 — 위험. 수수료 내역은 확인 전에 명확. 유동성 공급 시도했으나 풀 페이지 로딩 느림 (~4초). 전반적으로 스왑 UX는 좋지만 슬리피지 가드레일 개선 필요.

#### 질문지 입력 (4개)

| ID | 유형 | 입력 |
|----|------|------|
| q-1 | 1~5점 | **4** 버튼 클릭 |
| q-2 | 1~10점 | **7** 버튼 클릭 |
| q-3 | 자유 텍스트 | 아래 복붙 |
| q-4 | 자유 텍스트 | 아래 복붙 |

q-3 복사용:
```
The slippage settings lack safety bounds. A new user could accidentally set 99% slippage and lose funds to MEV bots.
```
> 해석: 슬리피지 설정에 안전 범위가 없음. 초보자가 실수로 99% 설정하면 MEV 봇에게 자금 손실 가능.

q-4 복사용:
```
Yes — Jupiter aggregates the best rates across DEXs which is a clear advantage. But I'd want slippage protection warnings before switching from Raydium.
```
> 해석: Jupiter는 여러 DEX의 최적 환율을 모아주는 게 장점. 단, Raydium에서 넘어오려면 슬리피지 보호 경고가 필요.

#### 제출 후 예상 결과
- Quality Score: ~4.0–4.5/5.0 (상세 체크리스트 + 보안 발견사항)
- USDC Reward: ~$3.6–$4.3 (파워커브 적용, $5 기준)
- TX Signature: 온체인 링크
- **결과 화면에서 2~3초 멈추기** — 점수/보상/TX 보여주기

---

### 장면 5: 페르소나 — AI 정체성 생성 (0:33 ~ 0:42)

**화면**: 페르소나 갤러리 → http://localhost:3000/persona
**동작**:
1. 5개 페르소나 카드 그리드 보여주기
2. DeFi 전문 페르소나 클릭 (Alice Chen — defi=0.98)
   → http://localhost:3000/persona/591f7a77-6a7b-4fa1-8b1d-e0b69e6e0c1d
3. **레이더 차트** 보여주기 (test_style 5축 + expertise 5축)
4. 페르소나 벡터 수치 + SAS Attestation 배지 강조

**자막**:
> "테스트 3회 완료 시 AI 페르소나가 생성됩니다 — 테스터 고유의 테스팅 DNA가 SAS 온체인 인증서로 기록됩니다."

**입력 없음** — 클릭하고 스크롤만 하면 됨
레이더 차트에서 1~2초 멈춰서 시각적 임팩트 주기

---

### 장면 6: 킬링 모먼트 — Auto Test Engine (0:42 ~ 0:55)

**화면**: Auto Test → http://localhost:3000/autotest
**동작**:
1. 드롭다운에서 테스트 + 페르소나 선택
2. 페르소나 정보 카드 (전문성 태그) 확인
3. "Pay $0.10 & Run Auto Test" 클릭
4. Phantom 승인 → 프로그레스 바 → 결과
5. 보여줄 것: 스크린샷 타임라인, 페르소나 리포트, UX 피드백 점수, 41R 정산 TX

**자막**:
> "AI 페르소나가 Stagehand로 사이트를 자동 방문하고, 실제 인터랙션을 수행하여 상세 리포트를 생성합니다 — 41R 토큰으로 온체인 정산."

#### 드롭다운 선택

| 필드 | 선택 |
|------|------|
| Select Test | `jup.ag (2592010a)` — jup.ag 항목 |
| Select Persona | `591f7a77 — defi (senior)` — Alice Chen, DeFi 전문가 |

선택 후 표시되는 정보 카드:
- 태그: `defi: 98%`, `general_web: 85%`, `nft: 75%` + `senior`
- Voice sample 미리보기

#### 결과 보여주기 (사전 실행 권장)
Auto Test는 1~3분 걸리므로, **녹화 전에 미리 한 번 실행**해두고 캐시된 결과를 보여주기:

1. **Browser Session Timeline** — 2~3개 스텝 펼쳐서 다른 페이지 스크린샷 보여주기
2. **Filmstrip Overview** — 가로 스크롤로 캡쳐된 전체 페이지 훑기
3. **Persona Report** — AI 생성 분석 리포트 스크롤
4. **UX Feedback** — 4개 점수 카드 (overall, usability, visual_design, performance)
5. **41R Token Settlement** — Solana Explorer 링크 잠깐 클릭

---

### 장면 7: 클로징 — 기술 스택 (0:55 ~ 1:00)

**화면**: 랜딩 페이지 하단 또는 아웃트로
**동작**:
1. "Powered by Solana" 배너 + 기술 배지 보여주기
2. x402 Micropayment, Token-2022 Transfer Fee, Transfer Hook, SAS Attestation, Stagehand, Claude Sonnet 4.6

**자막**:
> "Solana 위에 구축 — x402 소액결제, Token-2022 5% 전송 수수료, SAS 인증, Claude AI."

---

## 복사-붙여넣기 모음

녹화 중 바로 복붙할 수 있도록 정리.

### 기업 등록 — Requirements 필드
```
Verify DeFi token swap accuracy — check that exchange rates match on-chain data, slippage protection works correctly, and fee calculations are transparent. Also audit for security vulnerabilities: wallet permission scoping, transaction simulation before signing, and protection against sandwich attacks.
```

### 테스터 등록 — Display Name
```
Alex Kim
```

### 테스터 등록 — Region
```
KR
```

### 테스터 등록 — Occupation
```
blockchain developer
```

### 테스터 — 체크리스트 메모
```
cl-1: Wallet connected instantly, address displayed in top-right corner
cl-2: Swap executed in ~3s, balance updated, tx hash shown with Solscan link
cl-3: Custom slippage input accepts values above 50% without warning — potential MEV risk
cl-4: History loads correctly with timestamps and amounts
```

### 테스터 — 시나리오 로그
```
Swapped 2 SOL → USDC. Rate matched CoinGecko within 0.3%. Tried setting slippage to 99% — no warning shown, which is dangerous. Fee breakdown was clear before confirmation. Attempted providing liquidity but the pool page loaded slowly (~4s). Overall, swap UX is smooth but slippage guardrails need improvement.
```

### 테스터 — 질문지 자유 텍스트
q-3:
```
The slippage settings lack safety bounds. A new user could accidentally set 99% slippage and lose funds to MEV bots.
```
q-4:
```
Yes — Jupiter aggregates the best rates across DEXs which is a clear advantage. But I'd want slippage protection warnings before switching from Raydium.
```

---

## 촬영 전 체크리스트

### 서버
- [ ] API 서버 동작 확인 — `curl localhost:4100/api/tests | head`
- [ ] Web 서버 동작 확인 — 브라우저에서 열기
- [ ] **좀비 프로세스 없음** — `ps aux | grep 41rpm | grep -v grep | wc -l` (약 4개여야 함)

### 데이터 확인
- [ ] 시드 실행 완료: `npx tsx scripts/seed-data.ts`
- [ ] 테스트 2개 (jup.ag, magiceden)
- [ ] 테스터 7명 (5명 페르소나 보유, Diana 3회인데 페르소나 없음, Evan 0회)
- [ ] 페르소나 5개 (전부 SAS 인증 완료)
- [ ] Auto Test 사전 실행 완료 (jup.ag + 591f7a77 페르소나)

### 브라우저 세팅
- [ ] Phantom 지갑 연결됨 (devnet 모드)
- [ ] Chrome 북마크바 숨김 (Cmd+Shift+B)
- [ ] DevTools 닫기
- [ ] 줌 레벨 110~120% (Cmd+=)
- [ ] 다크 테마 활성화 (기본값)
- [ ] 다른 탭 모두 닫기

### 녹화
- [ ] OBS/QuickTime 1920x1080, 60fps 설정
- [ ] 마이크 테스트 (나레이션 있을 경우)
- [ ] 타이머 보이게 해서 페이싱 확인

---

## 핵심 URL (데모 순서)

| 장면 | URL |
|------|-----|
| 1. 랜딩 | http://localhost:3000 |
| 2. 기업 대시보드 | http://localhost:3000/company |
| 2b. 등록 | http://localhost:3000/company/register |
| 3. 테스터 등록 | http://localhost:3000/tester/profile |
| 4. 테스트 목록 | http://localhost:3000/tester/tests |
| 4b. 테스트 실행 | http://localhost:3000/tester/test/{testId} |
| 5. 페르소나 갤러리 | http://localhost:3000/persona |
| 5b. 페르소나 상세 | http://localhost:3000/persona/591f7a77-6a7b-4fa1-8b1d-e0b69e6e0c1d |
| 6. Auto Test | http://localhost:3000/autotest |

---

## 핵심 데모 데이터

| 항목 | 값 |
|------|-----|
| jup.ag 테스트 ID | `2592010a-11d1-4eb4-bb0c-030c33d02de1` |
| magiceden 테스트 ID | `2f8a0f3f-...` |
| DeFi 전문 페르소나 | `591f7a77` — Alice Chen, defi=0.98, senior |
| 보안 전문 페르소나 | `b74d749f` — Charlie Nakamura, defi=0.9 |
| UX 전문 페르소나 | `7d4008eb` — Grace Park |
| 라이브 등록용 테스터 | 새 지갑으로 Alex Kim 등록 |
| Diana Okafor | tests_done=3, 페르소나 없음 → 라이브 생성 가능 |
| Evan Petrov | tests_done=0, 초보 테스터 |

---

## 시드 데이터 구조

```
Company: DeFi Protocol X (41vJ6x...)
├── Test 1: jup.ag ($500 budget, $5/tester) — 9 test cases
└── Test 2: magiceden.io ($350 budget, $3/tester) — 9 test cases

Testers (7명):
├── Alice Chen     — 3회 완료, 페르소나 ✓ (DeFi전문, defi=0.98), SAS ✓
├── Bobby Kim      — 3회 완료, 페르소나 ✓ (Gen Z UX), SAS ✓
├── Charlie Nakamura— 3회 완료, 페르소나 ✓ (보안감사, defi=0.9), SAS ✓
├── Fiona Bergström — 3회 완료, 페르소나 ✓ (접근성), SAS ✓
├── Grace Park     — 3회 완료, 페르소나 ✓ (디자인시스템), SAS ✓
├── Diana Okafor   — 3회 완료, 페르소나 ✗ (라이브 생성용)
└── Evan Petrov    — 0회, 초보 (등록만 된 상태)
```

---

## 속전속결 버전 (45초)

시간 부족하면:
- 장면 2를 5초로 압축: Company Dashboard에서 기존 테스트 카드만 보여주기
- 장면 3(테스터 등록) 생략: 바로 테스트 실행으로 이동

## 촬영 순서

1. **리허설 1회** — 타이머 켜고 전체 흐름 연습 (클릭 포인트 확인)
2. **녹화** — 끊지 않고 원테이크
3. **편집** — 자막 추가 + 로딩 구간 2배속 처리
