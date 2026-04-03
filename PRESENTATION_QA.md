# 41R Persona Market — Presentation Q&A Guide

## System Overview (Korean)

### 한줄 요약
**41R은 인간 테스터의 테스팅 DNA를 AI Persona로 변환하여, 자율적으로 브라우저 테스트를 수행하고 Solana 위에서 보상을 정산하는 AI 기반 제품 검증 마켓플레이스입니다.**

### 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                        41R Persona Market                           │
├──────────────────┬──────────────────┬───────────────────────────────┤
│   Frontend       │   Backend API    │   Blockchain (Solana)         │
│   Next.js :3000  │   Express :4100  │   Devnet                     │
│                  │                  │                               │
│  - 17 pages      │  - 22 endpoints  │  - 41R Token (Token-2022)    │
│  - Phantom Wallet│  - 5 services    │  - 5% Transfer Fee           │
│  - Tailwind Dark │  - 7 DB tables   │  - USDC (Mock Mint)          │
│  - Radar Chart   │  - PostgreSQL    │  - SAS Attestation           │
│                  │  - Drizzle ORM   │  - x402 Micropayment         │
└──────────────────┴──────────────────┴───────────────────────────────┘
```

### 핵심 플로우 (5단계)

```
1. 기업 등록          2. 수동 테스트         3. Persona 생성
   URL + 예산 입력  →   테스터 3회 완료  →   AI가 테스팅 DNA 추출
   AI 테스트케이스       USDC 보상 지급       SAS 온체인 인증
   자동 생성             품질 기반 차등        레이더 차트 시각화

4. 자동 테스트         5. 정산
   Persona가 브라우저 →  41R Token 민팅
   자율 탐색+테스트      5% Transfer Fee
   스크린샷+리포트       USDC + 41R 이중 보상
```

---

## Solana 블록체인 기술 가이드 (입문자용)

> 이 프로젝트에서 실제 사용한 Solana 기술을 중심으로 설명합니다.

### 1. Solana란?

Solana는 **초고속/초저비용** 블록체인입니다.

| 비교 | Ethereum | Solana |
|------|----------|--------|
| 초당 처리량(TPS) | ~15 | ~65,000 |
| 트랜잭션 확정 | ~12초 | ~400ms |
| 가스비 | $1~$50+ | **$0.00025** |
| 합의 방식 | PoS | PoS + PoH (Proof of History) |

**왜 중요한가**: 41R에서 테스트 1건 정산에 $0.00025 비용이면, $3 USDC 보상 중 가스비 비중이 0.008%. 이더리움이면 가스비가 보상보다 클 수 있습니다.

### 2. 핵심 개념 — 41R에서 실제 사용하는 것들

#### 2.1 계정 모델 (Account Model)

Solana는 이더리움과 달리 **모든 것이 계정(Account)**입니다.

```
┌──────────────────────────────────────────────────────┐
│ Solana 계정 = { 주소, 소유 프로그램, 데이터, SOL잔액 }  │
│                                                        │
│ 유형:                                                  │
│   1. 시스템 계정  — SOL을 보유하는 일반 지갑              │
│   2. 토큰 계정   — SPL Token 잔액을 보유 (ATA)          │
│   3. 프로그램    — 실행 가능한 코드 (=스마트 컨트랙트)     │
│   4. 데이터 계정  — SAS attestation 같은 데이터 저장      │
└──────────────────────────────────────────────────────┘
```

**41R 프로젝트에서의 계정:**
- **플랫폼 지갑**: `~/.config/solana/id.json`에서 로드하는 Keypair → USDC 전송, 41R 민팅의 서명자
- **테스터 지갑**: Phantom 지갑 주소 → USDC/41R 수신
- **41R Token Mint**: Token-2022 프로그램이 소유하는 토큰 정의 계정
- **ATA (Associated Token Account)**: 각 지갑별 토큰 잔액 계정

#### 2.2 Keypair와 서명

```typescript
// 41R에서의 실제 코드 (apps/api/src/services/solana.ts)
import { Keypair } from '@solana/web3.js';

// 키페어 = 비밀키(64바이트) → 공개키(32바이트) + 서명용 비밀키
const secretKey = JSON.parse(fs.readFileSync('~/.config/solana/id.json', 'utf-8'));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
// payer.publicKey → "8Vm3ys3kwLSy2qThejn56E2j6fptwSE2qcLkEeiLrdB8" (base58 인코딩)
```

- **비밀키**: 트랜잭션 서명에 사용 (절대 노출 금지)
- **공개키**: 지갑 주소 역할 (base58 인코딩 문자열)
- **Phantom 지갑**: 유저의 비밀키를 안전하게 보관하고, 서명 요청 시 UI로 승인

#### 2.3 트랜잭션 (Transaction)

Solana 트랜잭션은 **하나 이상의 명령어(Instruction)**를 묶은 것입니다.

```typescript
// 41R에서의 실제 코드 (packages/solana-utils/src/token-setup.ts)
const transaction = new Transaction().add(
  // 명령어 1: 새 계정 생성
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: mintLen,
    lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  }),
  // 명령어 2: Transfer Fee 설정 초기화
  createInitializeTransferFeeConfigInstruction(
    mintKeypair.publicKey, payer.publicKey, payer.publicKey,
    500,    // 5% = 500 basis points
    MAX_FEE,
    TOKEN_2022_PROGRAM_ID,
  ),
  // 명령어 3: 민트 초기화
  createInitializeMintInstruction(
    mintKeypair.publicKey, 9, payer.publicKey, payer.publicKey,
    TOKEN_2022_PROGRAM_ID,
  ),
);

// 서명 + 전송 + 확인 (원자적: 모두 성공하거나 모두 실패)
await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair]);
```

**핵심**: 트랜잭션 안의 명령어는 **원자적(atomic)**으로 실행됩니다. 하나라도 실패하면 전체가 롤백.

#### 2.4 Connection (RPC 연결)

```typescript
// 41R에서의 실제 코드
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// 잔액 조회
const balance = await connection.getBalance(payer.publicKey);  // lamports 단위
const solBalance = balance / 1_000_000_000;  // 1 SOL = 10^9 lamports

// 트랜잭션 확인
await connection.confirmTransaction(signature, 'confirmed');
```

**네트워크 종류:**
| 네트워크 | 용도 | RPC URL |
|----------|------|---------|
| **Devnet** | 개발/테스트 (41R에서 사용) | `https://api.devnet.solana.com` |
| Testnet | 밸리데이터 테스트 | `https://api.testnet.solana.com` |
| Mainnet-beta | 실제 운영 | `https://api.mainnet-beta.solana.com` |

**Commitment Level** (트랜잭션 확정 수준):
- `processed`: 가장 빠름, 롤백 가능
- `confirmed`: 슈퍼마조리티(66%) 투표 완료 ← **41R에서 사용**
- `finalized`: 완전 확정, 가장 느림

### 3. SPL Token — Solana의 토큰 표준

이더리움의 ERC-20에 해당하는 것이 Solana의 **SPL Token**입니다.

#### 3.1 두 가지 토큰 프로그램

```
TOKEN_PROGRAM_ID       = "TokenkegQfeZyiNwAJ..."   ← 기존 SPL Token (USDC 등)
TOKEN_2022_PROGRAM_ID  = "TokenzQdBNbLqP5VEh..."   ← 새로운 Token-2022 (41R 사용)
```

**41R에서의 사용:**
- **USDC 전송** → 기존 `TOKEN_PROGRAM_ID` 사용 (USDC는 레거시 SPL Token)
- **41R Token** → `TOKEN_2022_PROGRAM_ID` 사용 (Transfer Fee Extension 필요)

#### 3.2 Associated Token Account (ATA)

Solana에서 토큰을 받으려면 **토큰별 전용 지갑(ATA)**이 필요합니다.

```
일반 지갑: 8Vm3ys3kw... (SOL 보유)
    │
    ├── USDC ATA: Gx7f2k9... (USDC 잔액 보유)
    └── 41R ATA:  Hj8m3q2... (41R 잔액 보유)
```

```typescript
// 41R에서의 실제 코드 — ATA 주소 계산 (결정적, 동일 입력 = 동일 출력)
// apps/web/app/company/register/page.tsx
function getATA(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// 백엔드에서는 SDK 사용 (없으면 자동 생성)
// apps/api/src/services/solana.ts
const destAta = await getOrCreateAssociatedTokenAccount(
  connection, payer, mint, recipient,
);
```

**핵심**: ATA 주소는 `[지갑주소 + 토큰프로그램 + 민트주소]`에서 결정적으로 파생됩니다. 같은 입력이면 항상 같은 ATA 주소.

#### 3.3 USDC 전송 — 수동 테스트 보상

```typescript
// apps/api/src/services/solana.ts — transferUsdc()
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';  // devnet Mock USDC
const USDC_DECIMALS = 6;  // 1 USDC = 1,000,000 base units

// $3.58 USDC 전송 예시
const amount = BigInt(Math.round(3.58 * 1_000_000));  // = 3,580,000

const tx = new Transaction().add(
  createTransferCheckedInstruction(
    sourceAta.address,    // 보내는 쪽 ATA
    mint,                 // USDC 민트 주소
    destAta.address,      // 받는 쪽 ATA
    payer.publicKey,      // 서명자
    amount,               // 금액 (base units)
    6,                    // decimals
  ),
);

const txSignature = await sendAndConfirmTransaction(connection, tx, [payer]);
// txSignature = "5KtP7..." → Solana Explorer에서 확인 가능
```

**프론트엔드에서의 USDC 전송** (Phantom 지갑):
```typescript
// apps/web/app/company/register/page.tsx — 기업이 예산 예치 시
// SPL Token Transfer 명령어를 직접 구성 (instruction index = 3)
const data = Buffer.alloc(9);
data.writeUInt8(3, 0);              // Transfer instruction 식별자
data.writeBigUInt64LE(amount, 1);   // 금액

const instruction = new TransactionInstruction({
  keys: [
    { pubkey: sourceATA, isSigner: false, isWritable: true },   // from
    { pubkey: destATA,   isSigner: false, isWritable: true },   // to
    { pubkey: owner,     isSigner: true,  isWritable: false },  // signer
  ],
  programId: TOKEN_PROGRAM_ID,
  data,
});

// Phantom이 서명
const signed = await phantom.solana.signTransaction(tx);
const sig = await connection.sendRawTransaction(signed.serialize());
await connection.confirmTransaction(sig);
```

### 4. Token-2022 — 41R 토큰의 핵심

Token-2022는 기존 SPL Token의 **확장 버전**입니다. 41R이 사용하는 확장 기능:

#### 4.1 Transfer Fee Extension

**개념**: 토큰 전송마다 **자동으로 수수료를 부과**하는 프로토콜 레벨 기능

```
일반 SPL Token 전송:     보내기 10 → 받기 10 (수수료 없음)
41R Token-2022 전송:     보내기 10 → 받기 9.5 + 수수료 0.5 (5%)
```

```typescript
// packages/solana-utils/src/token-setup.ts — 41R 토큰 생성
export const TRANSFER_FEE_BPS = 500;   // 500 basis points = 5%
export const TOKEN_DECIMALS = 9;       // 1 41R = 10^9 base units
export const MAX_FEE = BigInt(1_000_000_000);  // 최대 수수료 = 1 41R

// 수수료 계산 (천장 나눗셈 — 온체인 동작과 동일)
export function calculateExpectedFee(transferAmount: bigint): bigint {
  const numerator = transferAmount * BigInt(500);        // amount × feeBps
  const rawFee = (numerator + 10_000n - 1n) / 10_000n;  // 올림 나눗셈
  return rawFee > MAX_FEE ? MAX_FEE : rawFee;
}
// 예: 10 41R = 10_000_000_000 base → fee = 500_000_000 = 0.5 41R
```

**수수료 수거 과정** (2단계):
```
1단계: harvestWithheldTokensToMint()
   각 수신자의 ATA에 쌓인 수수료 → Mint 계정으로 이동

2단계: withdrawWithheldTokensFromMint()
   Mint에 모인 수수료 → Treasury 지갑으로 출금
```

#### 4.2 Mint (토큰 발행)

```
Mint 계정 = 토큰의 "정의서"
  ├── decimals: 9 (소수점 자릿수)
  ├── mintAuthority: 플랫폼 지갑 (발행 권한)
  ├── freezeAuthority: 플랫폼 지갑 (동결 권한)
  ├── transferFeeConfigAuthority: 플랫폼 지갑 (수수료 설정 권한)
  └── withdrawWithheldAuthority: 플랫폼 지갑 (수수료 출금 권한)
```

```typescript
// 토큰 발행 (Auto Test 보상 시)
// apps/api/src/services/solana.ts — mint41RTokens()
async mint41RTokens(recipientWallet: string, amount: number) {
  const destAta = await createTokenAccount(connection, payer, mintAddress, recipient);
  const baseAmount = toBaseUnits(amount);  // 예: 3.58 → 3_580_000_000n

  const txSignature = await mintTokens(
    connection, payer, mintAddress, destAta.address, baseAmount,
  );
  // 새 토큰이 생성되어 수신자 ATA로 직접 입금
}
```

#### 4.3 왜 Token-2022인가? (기존 SPL Token과 비교)

| 기능 | SPL Token (레거시) | Token-2022 |
|------|-------------------|------------|
| Transfer Fee | 불가능 (별도 컨트랙트 필요) | **프로토콜 내장** (우회 불가) |
| Transfer Hook | 불가능 | 전송마다 커스텀 로직 실행 가능 |
| 이자 계산 | 불가능 | Interest-bearing 확장 |
| 기밀 전송 | 불가능 | Confidential Transfer 확장 |
| USDC 등 기존 토큰 | 여기서 동작 | 하위 호환 아님 (별도 프로그램) |

**41R의 선택**: 41R Token은 Transfer Fee가 핵심 비즈니스 로직이므로 Token-2022 필수. USDC는 레거시 SPL Token이므로 기존 프로그램 사용.

### 5. x402 프로토콜 — HTTP로 결제하기

#### 5.1 개념

HTTP 상태 코드 `402 Payment Required`는 1997년 HTTP 표준에 정의되었지만, 25년 넘게 사용되지 않았습니다. x402는 이것을 **실제 웹 결제 프로토콜**로 구현한 것입니다.

```
기존 API 과금:                      x402 과금:
  1. 회원가입                        1. API 호출
  2. API 키 발급                     2. 402 응답 (가격+지갑 정보)
  3. 결제 수단 등록                   3. USDC 전송 ($0.10)
  4. 월 구독 결제                     4. X-Payment 헤더와 재요청
  5. 사용량 추적                      5. 200 OK (데이터 반환)
  6. 초과 과금
  → 복잡, 최소 $10/월                → 즉시, $0.001부터 가능
```

#### 5.2 41R에서의 구현

```typescript
// apps/api/src/middleware/x402.ts — Coinbase Facilitator 모드

// CAIP-2 포맷: 체인 식별자 (체인패밀리:체인ID)
const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

// Coinbase 공식 facilitator (결제 중개)
const facilitator = new HTTPFacilitatorClient({
  url: 'https://x402.org/facilitator',
});

// 보호 라우트 정의
const routes = {
  'GET /api/hello':                 { price: '$0.001', network: SOLANA_DEVNET, payTo },
  'GET /api/test/:testId/results':  { price: '$0.05',  network: SOLANA_DEVNET, payTo },
  'GET /api/persona/:personaId':    { price: '$0.10',  network: SOLANA_DEVNET, payTo },
};

// Express 미들웨어로 적용
app.use(paymentMiddleware(routes, resourceServer));
```

**Fallback 모드** (Coinbase facilitator 미지원 시):
```typescript
// X-Payment 헤더 없으면 → 402 반환
res.status(402).json({
  error: 'Payment Required',
  x402Version: 1,
  payment: { recipientWallet, tokenAccount, mint, amount: 100000, amountUSDC: 0.10 }
});

// X-Payment 헤더 있으면 → 직접 검증
const tx = Transaction.from(Buffer.from(paymentData.payload.serializedTransaction, 'base64'));
// SPL Token Transfer 명령어 검증 (opcode 3)
// 수신자 ATA + 최소 금액 확인 → 시뮬레이션 → 전송 → 확인
```

### 6. SAS (Solana Attestation Service) — 온체인 증명서

#### 6.1 개념

SAS는 Solana 위에 **검증 가능한 증명서(Attestation)**를 발행하는 시스템입니다. 학위 증명서의 블록체인 버전이라고 생각하면 됩니다.

```
현실 세계:                          Solana SAS:
  대학교가 졸업증명서 발급             플랫폼이 성과 증명서 발급
  종이/PDF (위조 가능)                온체인 데이터 (위조 불가)
  대학교에 문의해야 검증               누구나 Explorer에서 검증
```

#### 6.2 41R에서의 구현

```typescript
// apps/api/src/services/sas.ts

// SAS 구조: 스키마 → 자격증명(Credential) → 증명서(Attestation)
//
// 스키마: "어떤 필드를 기록할 것인가" (1회 생성)
// 자격증명: "누가 발행하는가" (플랫폼)
// 증명서: "실제 데이터" (테스터별 1개)

// 증명서에 기록되는 데이터:
interface SASPerformanceData {
  tests_completed: number;      // 총 완료 테스트 수
  avg_quality: number;          // 평균 품질 (0~5.0)
  expertise_defi: number;       // DeFi 전문도 (0~1.0)
  expertise_ai_tools: number;   // AI 도구 전문도
  trust_tier: string;           // "Bronze" | "Silver" | "Gold"
  persona_activated: boolean;   // Persona 생성 여부
}

// 온체인 저장 시 float → u32 변환 (×100 스케일)
const serializedData = serializeAttestationData(schema, {
  tests_completed: 12,
  avg_quality_x100: 420,        // 4.20 × 100
  expertise_defi_x100: 98,      // 0.98 × 100
  trust_tier: "Gold",
  persona_activated: 1,         // boolean → 0 또는 1
});

// PDA (Program Derived Address) — 결정적 주소 생성
const [attestationPda] = await deriveAttestationPda({
  credential: credentialPda,   // 발행자 계정
  schema: schemaPda,           // 스키마 계정
  nonce: nonceKeypair.address, // 고유 난수 (중복 방지)
});

// 1년 유효기간
const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
```

#### 6.3 PDA란?

PDA(Program Derived Address)는 **프로그램이 소유하는 결정적 주소**입니다.

```
일반 지갑: Keypair.generate() → 비밀키가 존재 → 누군가 서명 가능
PDA:       deriveAttestationPda(seed1, seed2, ...) → 비밀키 없음 → 프로그램만 조작 가능
```

41R에서 PDA가 사용되는 곳:
- ATA 주소: `findProgramAddressSync([owner, tokenProgram, mint])` → 지갑별 토큰 계정
- SAS 증명서: `deriveAttestationPda({credential, schema, nonce})` → 증명서 계정
- (향후) Escrow: 기업 예산을 프로그램이 관리하는 PDA에 보관

### 7. Phantom 지갑 연동

#### 7.1 41R에서의 구현

```typescript
// apps/web/components/wallet-provider.tsx

// 1. Phantom 감지
const phantom = (window as any).phantom?.solana;
if (phantom?.isPhantom) { /* 연결 가능 */ }

// 2. 연결
const response = await phantom.solana.connect();
const publicKey = response.publicKey.toString();  // base58 주소

// 3. 이벤트 리스닝
phantom.solana.on('accountChanged', (pk) => { /* 계정 전환 */ });
phantom.solana.on('disconnect', () => { /* 연결 해제 */ });

// 4. 트랜잭션 서명 (USDC 전송 시)
const transaction = new Transaction().add(transferInstruction);
transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
transaction.feePayer = new PublicKey(publicKey);

const signed = await phantom.solana.signTransaction(transaction);
const signature = await connection.sendRawTransaction(signed.serialize());
```

**플로우:**
```
프론트엔드                    Phantom                   Solana
    │                           │                         │
    ├── connect() ────────────→ │                         │
    │                           ├── 승인 팝업 표시        │
    │   ←── publicKey ─────────│                         │
    │                           │                         │
    ├── signTransaction(tx) ──→ │                         │
    │                           ├── "승인" 클릭           │
    │   ←── signed tx ─────────│                         │
    │                           │                         │
    ├── sendRawTransaction(signed) ─────────────────────→ │
    │                           │                         ├── 트랜잭션 실행
    │   ←── signature ────────────────────────────────── │
```

### 8. 41R에서 사용하는 Solana 주소/ID 정리

| 항목 | 주소/값 | 설명 |
|------|---------|------|
| **플랫폼 지갑** | `8Vm3ys3kwLSy2qThejn56E2j6fptwSE2qcLkEeiLrdB8` | USDC 수신, 41R 민팅 권한 |
| **USDC Mint (Devnet)** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Circle faucet Mock USDC |
| **41R Token Mint** | 환경변수 `TOKEN_41R_MINT` | Token-2022 + 5% Transfer Fee |
| **TOKEN_PROGRAM_ID** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | 레거시 SPL Token (USDC용) |
| **TOKEN_2022_PROGRAM_ID** | `TokenzQdBNbLqP5VEhdkAs6LZMK...` | Token-2022 (41R용) |
| **ASSOCIATED_TOKEN_PROGRAM_ID** | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | ATA 생성 |
| **RPC URL** | `https://api.devnet.solana.com` | Devnet 노드 |
| **Explorer** | `https://explorer.solana.com/...?cluster=devnet` | 트랜잭션 확인 |

### 9. 자주 나오는 Solana 용어 (Q&A 대비)

| 용어 | 설명 | 41R에서의 용도 |
|------|------|---------------|
| **Lamport** | SOL의 최소 단위 (1 SOL = 10^9 lamports) | 가스비 계산 |
| **Rent** | 계정 유지 비용 (데이터 크기에 비례) | 토큰 계정/SAS 계정 생성 시 |
| **Rent-exempt** | 최소 잔액 이상이면 영구 면제 | 모든 계정을 rent-exempt으로 생성 |
| **ATA** | Associated Token Account | 지갑별 토큰 잔액 계정 |
| **PDA** | Program Derived Address | SAS 증명서, ATA 주소 |
| **Mint** | 토큰 정의 계정 | 41R Token, USDC |
| **Authority** | 권한 보유자 (민팅/동결/수수료) | 플랫폼 지갑이 모든 authority |
| **Basis Points (bps)** | 1/100 퍼센트 (100bps = 1%) | 500bps = 5% Transfer Fee |
| **SPL** | Solana Program Library | 토큰 표준, ATA 프로그램 |
| **CAIP-2** | 체인 식별 표준 | x402에서 네트워크 식별 |
| **Devnet** | 개발용 네트워크 (무료 SOL) | 41R 전체 개발/데모 |
| **Commitment** | 트랜잭션 확정 수준 | `confirmed` 사용 |
| **Airdrop** | 무료 SOL 지급 (devnet) | 개발 시 테스트 SOL 확보 |

### 10. 발표 시 Solana 관련 핵심 어필 포인트

```
1. "왜 Solana인가?"
   → 가스비 $0.00025 — 마이크로페이먼트에 최적
   → 400ms 확정 — UX 끊김 없음
   → Token-2022 — 5% 수수료가 토큰 자체에 내장

2. "Token-2022가 뭐가 다른가?"
   → ERC-20은 수수료를 받으려면 커스텀 컨트랙트가 필요
   → Token-2022는 프로토콜 레벨에서 강제 — 우회 불가능

3. "x402가 왜 혁신인가?"
   → API 키 없이 지갑만으로 결제
   → $0.001 결제 가능 (카드 결제 최소 $0.50)
   → Solana 가스비가 $0.00025이라서 가능

4. "SAS가 왜 필요한가?"
   → Persona 실적을 온체인에서 누구나 검증 가능
   → 중앙 서버를 신뢰할 필요 없음
   → Solana Explorer에서 직접 확인
```

---

## 핵심 기술 상세 설명

### 1. AI Persona란?

인간 테스터가 3회 이상 수동 테스트를 완료하면, 그 사람의 **테스팅 DNA**를 Claude Sonnet이 분석하여 다차원 벡터로 추출합니다.

| 카테고리 | 축 | 예시 |
|----------|-----|------|
| **test_style** | thoroughness, speed, ux_focus, bug_detection, creativity | DeFi 전문가: bug_detection=0.95, thoroughness=0.88 |
| **expertise** | defi, nft, gaming, ai_tools, general_web | Alice Chen: defi=0.98, nft=0.15 |
| **feedback_pattern** | ui_critical, security_aware, performance_sensitive, accessibility, detail | 보안 전문가: security_aware=0.96 |
| **reliability** | quality_score (0-5), consistency, response_rate | 평균 품질 4.2, 일관성 0.9 |
| **demographics** | age_group, tech_literacy, crypto_experience | young_adult, expert |
| **voice_sample** | 피드백 톤 요약 문장 | "Methodical and security-focused..." |

**핵심 포인트**: 같은 사이트를 DeFi Expert Persona와 Security Expert Persona가 테스트하면 **완전히 다른 관점의 리포트**가 생성됩니다.

### 2. Stagehand 자율 브라우저 테스트

[Stagehand](https://github.com/browserbase/stagehand)는 Claude의 Vision 능력을 활용한 브라우저 자동화 프레임워크입니다.

**실행 파이프라인 (4단계):**
1. **Site Discovery** — 내부 링크 추출, 4개 페이지 방문, 네비게이션 분석
2. **Scroll Exploration** — 페이지 높이 측정, 40%/80% 스크롤하며 스크린샷
3. **Checklist Execution** — AI가 생성한 체크리스트 항목을 자동 실행 (pass/fail 기록)
4. **Persona-Specific Exploration** — Persona 성격에 맞는 5-8개 추가 탐색 액션

**스크린샷**: 총 30+장 캡처 → 최대 8장 선별 → Claude Sonnet Vision으로 분석 → Persona 관점 리포트 생성

### 3. Token Economics (41R Token)

```
┌─────────────────────────────────────────────────┐
│              41R Token (Token-2022)              │
│                                                 │
│  Transfer Fee: 5%                               │
│  Example: 10 41R 전송                           │
│    → 수신자: 9.5 41R                            │
│    → Treasury: 0.5 41R (수수료)                 │
│                                                 │
│  이중 보상 구조:                                │
│    수동 테스트 → USDC 직접 지급                 │
│    자동 테스트 → USDC + 41R 토큰 민팅           │
│                                                 │
│  품질 보상 공식 (Power Curve):                  │
│    reward = baseReward × (score / 5.0)^1.5      │
│    4.0점 → 72% 지급 | 3.0점 → 46% 지급         │
│    1.5 미만 → 거절 (0원)                        │
└─────────────────────────────────────────────────┘
```

### 4. x402 Micropayment Protocol

HTTP 402 (Payment Required) 표준을 활용한 API 과금 시스템입니다.

| 엔드포인트 | 가격 | 용도 |
|-----------|------|------|
| `GET /api/test/:id/results` | $0.05 | 테스트 결과 조회 |
| `GET /api/persona/:id` | $0.10 | Persona 상세 조회 |
| `POST /api/autotest/run` | $0.10 | 자동 테스트 실행 |

**동작 원리**: 클라이언트가 보호된 API 요청 → 서버 402 반환 → 클라이언트가 USDC 결제 → `X-Payment` 헤더에 결제 증명 포함하여 재요청 → 서버 검증 후 200 응답

### 5. SAS (Solana Attestation Service)

테스터의 성과를 **온체인에 증명**하는 시스템입니다.

```
Trust Tier 산정:
  Gold   → 평균 품질 4.0+ & 테스트 10회+
  Silver → 평균 품질 3.5+ & 테스트 5회+
  Bronze → 기본 (3회 완료 시)
```

Persona 카드에 Trust Tier 배지 + Solana Explorer 링크가 표시됩니다.

### 6. AI 모델 전략

| 용도 | 모델 | 이유 |
|------|------|------|
| 테스트 케이스 생성 | **Claude Sonnet 4.6** | Vision + 구조화된 JSON 생성 필요 |
| Persona Vector 생성 | **Claude Sonnet 4.6** | 3개 리포트 패턴 분석 + 정교한 수치 추출 |
| Auto Test 리포트 | **Claude Sonnet 4.6** | 다수 스크린샷 + Persona 관점 반영 |
| 품질 점수 계산 | **Claude Haiku 4.5** | 단순 채점, 빠른 응답, 비용 절감 |
| 키워드 추출 | **Claude Haiku 4.5** | 텍스트에서 키워드만 추출 |

---

## 기능별 세부 개발 방법

### Feature 1. 모노레포 구조 및 인프라

**구조:**
```
41rpm/
├── apps/
│   ├── api/          Express API 서버 (포트 4100)
│   └── web/          Next.js 프론트엔드 (포트 3000)
├── packages/
│   ├── shared/       공유 TypeScript 인터페이스
│   └── solana-utils/ Token-2022 유틸리티
├── scripts/          설정/시드/PoC 스크립트
├── turbo.json        Turborepo 빌드 오케스트레이션
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**핵심 설정:**
- **패키지 매니저**: pnpm (워크스페이스 프로토콜 `workspace:*`로 내부 패키지 참조)
- **빌드 도구**: Turborepo — `pnpm dev`로 api + web 동시 기동, 캐시 + 병렬 빌드
- **TypeScript**: ES2022 타겟, ESNext 모듈, bundler 모듈 해석, strict 모드
- **데이터베이스**: Docker PostgreSQL 16 Alpine (`docker run -d --name 41rpm-postgres`)
- **ORM**: Drizzle ORM — `drizzle-kit push`로 스키마 직접 적용 (마이그레이션 파일 없이)

**개발 워크플로우:**
```bash
pnpm dev                     # Turborepo가 api + web 동시 실행
pnpm --filter api test       # Vitest로 API 테스트 (19개)
pnpm --filter api db:push    # DB 스키마 반영
pnpm tsx scripts/seed-data.ts  # 데모 데이터 투입
```

---

### Feature 2. 데이터베이스 스키마 (7개 테이블)

**파일**: `apps/api/src/db/schema.ts` (Drizzle ORM)

```
companies ──1:N── tests ──1:N── testCases
                    │
                    ├──1:N── testReports ──1:N── settlements
                    │
testers ──1:1── personas
    │
    └──1:N── testReports
```

**각 테이블 설계 의도:**

| 테이블 | PK | 핵심 컬럼 | 설계 포인트 |
|--------|-----|-----------|------------|
| `companies` | wallet_address (VARCHAR 64) | company_name, domain | 지갑 = ID (별도 인증 불필요) |
| `tests` | UUID | target_url, budget_usdc, status, reward_per_tester | status: pending→active→completed 상태 머신 |
| `testCases` | UUID | test_id(FK), type, content(JSONB), order | type별 checklist/scenario/questionnaire 분류 |
| `testers` | wallet_address (VARCHAR 64) | profile(JSONB), testsDone, personaId(FK) | testsDone이 3 도달 시 Persona 트리거 |
| `testReports` | UUID | quality_score(REAL), isPersonaTest(BOOL) | 수동/자동 리포트를 같은 테이블에 저장 |
| `personas` | UUID | vector(JSONB), sasAttestId | vector가 PersonaVector 전체를 JSONB로 저장 |
| `settlements` | UUID | amount_token, settlement_type('usdc'\|'41r') | 이중 보상을 두 행으로 기록 |

**JSONB 활용 이유**: 테스터 프로필, 테스트 케이스, Persona Vector 등 구조가 유동적인 데이터를 정규화 없이 유연하게 저장. PostgreSQL JSONB는 인덱싱과 쿼리 모두 지원.

**DB 연결**: `apps/api/src/db/index.ts`
```typescript
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

---

### Feature 3. AI 테스트 케이스 자동 생성

**파일**: `apps/api/src/services/llm.ts` → `generateTestCases()`
**라우트**: `POST /api/test/register` (`apps/api/src/routes/test.ts`)

**플로우:**
```
기업이 URL + 요구사항 입력
       │
       ▼
[Claude Sonnet 4.6] (max_tokens: 8192)
  System Prompt: "You are a senior QA architect"
  Input: target_url + requirements + (optional) screenshot_base64
       │
       ▼
  Output: JSON { checklist[8-12], scenarios[3-4], questionnaire[6-8] }
       │
       ▼
[Zod 스키마 검증] → 실패 시 repairJson() → 재파싱
       │
       ▼
[DB 저장] testCases 테이블에 type별로 INSERT (order 부여)
```

**프롬프트 설계 핵심:**
- 요구사항이 있으면 **"HIGHEST PRIORITY"**로 강조 → 체크리스트의 40-50%가 요구사항 반영
- 시나리오 중 1개는 반드시 요구사항 전문가 시나리오
- 질문지에 요구사항 관련 1-2개 항목 필수 포함
- 스크린샷 첨부 시 Vision 분석으로 UI 요소 기반 테스트 생성

**JSON 안정성 처리 (3단계):**
```typescript
// 1. extractJson(): 마크다운 ```json``` 블록 제거, JSON 객체 추출
// 2. repairJson(): 잘린 JSON 수리 (trailing comma 제거, 미닫힌 괄호 닫기)
// 3. parseJsonSafe(): parse 시도 → 실패 시 repair 후 재시도
```

**Fallback**: LLM 실패 시 하드코딩된 기본 테스트 케이스 8개 + 시나리오 3개 + 질문지 8개 반환

---

### Feature 4. 테스터 등록 및 프로필 관리

**라우트**: `apps/api/src/routes/tester.ts`
**프론트엔드**: `apps/web/app/tester/profile/page.tsx`

**API 엔드포인트:**
- `POST /api/tester/register` — 프로필 생성 (wallet_address가 PK)
- `GET /api/tester/:wallet` — 프로필 + 연결된 Persona 조회
- `PUT /api/tester/:wallet` — 프로필 수정
- `GET /api/testers` — 전체 테스터 목록 (통계 포함)

**프로필 데이터 구조 (JSONB):**
```typescript
{
  age_range: '10s'|'20s'|'30s'|'40s'|'50s'|'60+',
  region: string,
  occupation: string,
  expertise: string[],              // 'defi', 'nft', 'gaming' 등
  experience_level: string,         // 'beginner'|'intermediate'|'expert'
  crypto_experience: string,        // 'none'|'beginner'|'intermediate'|'advanced'
  preferred_domains: string[],
  primary_device: 'mobile'|'desktop',
  design_matters: boolean,
  frustration_triggers: string[]    // 'slow loading', 'unclear fees' 등
}
```

**프론트엔드 구현:**
- `ChipSelect` 커스텀 컴포넌트: 다중 선택 UI (expertise, domains, frustration triggers)
- 지갑 주소 입력 → "Load" 클릭 → 기존 프로필 로드 or 등록 폼 표시
- `useWalletContext()`로 Phantom 지갑에서 주소 자동 채움
- Persona 생성 조건: `testsDone >= 3 && !personaId` → "Generate AI Persona" 버튼 활성화

---

### Feature 5. 수동 테스트 수행 + 품질 기반 USDC 보상

**라우트**: `POST /api/report/submit` (`apps/api/src/routes/report.ts`)
**프론트엔드**: `apps/web/app/tester/test/[testId]/page.tsx`

**리포트 제출 플로우:**
```
테스터가 체크리스트 + 시나리오 + 질문지 작성
       │
       ▼
POST /api/report/submit
  {tester_addr, test_id, checklist_results, scenario_log, questionnaire_answers}
       │
       ▼
[검증] 테스터 존재? 테스트 active? 중복 제출? 예산 남음?
       │
       ▼
[Claude Haiku] calculateQualityScore() (max_tokens: 300)
  → score: 0.0~5.0, reason: string
       │
       ├── score < 1.5 → REJECTED (보상 없음, testsDone 미증가)
       │
       └── score >= 1.5 → ACCEPTED
              │
              ▼
        [Power Curve 보상 계산]
        reward = baseReward × (score / 5.0)^1.5
              │
              ▼
        [Solana USDC 전송] solanaService.transferUsdc(tester, amount)
              │
              ▼
        [Settlement 기록] DB INSERT (tx_signature, amount, type='usdc')
              │
              ▼
        [테스터 업데이트] testsDone += 1
              │
              ├── testsDone == 3 → persona_triggered: true 반환
              └── testsDone < 3  → 정상 완료
```

**품질 채점 상세 (`calculateQualityScore`):**
- **AI 평가 (1차)**: Claude Haiku가 체크리스트 깊이, 시나리오 구체성, 질문지 의미 분석
- **휴리스틱 백업 (2차)**: AI 실패 시 규칙 기반
  - 체크리스트: 완료율 (max 1.0) + 메모 품질 (max 1.0) = 최대 2.0점
  - 시나리오: 총 단어수 / 40 = 최대 1.5점
  - 질문지: 의미있는 답변 비율 = 최대 1.5점

**보상 차등 테이블 ($5 base 기준):**
| 점수 | 비율 | 보상 | 등급 |
|------|------|------|------|
| 5.0 | 100% | $5.00 | Exceptional |
| 4.0 | 72% | $3.58 | Good |
| 3.0 | 46% | $2.32 | Average |
| 2.0 | 25% | $1.26 | Below Average |
| 1.5 | 16% | $0.82 | Minimum |
| <1.5 | 0% | $0 | Rejected |

---

### Feature 6. AI Persona 생성 엔진

**파일**: `apps/api/src/services/llm.ts` → `generatePersona()`
**라우트**: `POST /api/persona/generate` (`apps/api/src/routes/persona.ts`)

**생성 플로우:**
```
테스터가 3회 테스트 완료 → 프론트엔드에서 "Generate" 클릭
       │
       ▼
POST /api/persona/generate { tester_addr }
       │
       ▼
[검증] testsDone >= 3? Persona 미존재?
       │
       ▼
[DB] 최근 3개 리포트 조회 (testReports WHERE testerAddr LIMIT 3)
       │
       ▼
[Claude Sonnet 4.6] (max_tokens: 1500)
  Input: tester.profile + 3개 reports
  Demographic 매핑 힌트:
    age_range '20s' → age_group: 'young_adult'
    crypto_experience 'advanced' → score: 0.8~0.95
    primary_device 'desktop' → mobile_first: false
       │
       ▼
  Output: PersonaVector JSON (7개 카테고리, 25+ 수치)
       │
       ▼
[DB] INSERT personas (vector JSONB)
[DB] UPDATE testers SET personaId
       │
       ▼
[SAS Attestation] 비동기 발행 (실패해도 계속 진행)
  → Trust Tier 계산 → 온체인 or Fallback ID 저장
       │
       ▼
Response: { persona, sasAttestId }
```

**Persona Vector 생성 원리:**
- 3개 리포트에서 **패턴 추출**: 어떤 항목에 fail을 많이 줬는가, 메모가 기술적인가 UI 중심인가
- 프로필 demographics를 **수치화**: 나이대→인내심, 암호화폐 경험→전문도
- voice_sample: "2-3문장으로 이 사람의 피드백 톤을 요약" (예: "Methodical and security-focused, always checks edge cases first")

**프론트엔드 시각화** (`apps/web/app/persona/[personaId]/page.tsx`):
- `recharts` 라이브러리의 RadarChart 4개 (test_style, expertise, feedback_pattern, reliability)
- SAS Trust Tier 배지 (Bronze/Silver/Gold)
- Demographics/UX Preferences 수평 바 차트

---

### Feature 7. Stagehand 자율 브라우저 자동화 (Auto Test Engine)

**파일**: `apps/api/src/services/autotest.ts` — `runAutoTest()`
**라우트**: `POST /api/autotest/run`, `GET /api/autotest/status/:jobId`

**전체 파이프라인:**
```
[Phase 1] 데이터 로드 (progress: 10~30)
  DB에서 persona, test, testCases 조회

[Phase 2] 브라우저 자동화 (progress: 35~80)
  Stagehand 초기화:
    env: 'LOCAL'
    model: 'anthropic/claude-sonnet-4-6'
    headless: true

  Phase 2a: 랜딩 페이지 스크린샷 (step 0)
  Phase 2b: 사이트 탐색 (최대 4개 내부 페이지 방문)
    - page.evaluate()로 <a href> 링크 추출
    - nav/header/sidebar 요소에서 네비게이션 라벨 추출
    - SPA인 경우 → 네비게이션 클릭으로 대체
    - 각 페이지 전환마다 스크린샷 + 액션 로그
  Phase 2c: 스크롤 탐색 (페이지 > 2뷰포트 높이일 때)
    - 40% → 스크린샷, 80% → 스크린샷, 상단 복귀
  Phase 2d: 체크리스트 실행
    - stagehand.act("체크리스트 항목 텍스트") → pass/fail/error
    - 각 항목마다 스크린샷
  Phase 2e: Persona 전용 탐색
    - generatePersonaActions()로 5-8개 맞춤 액션 생성
    - 예: security_aware=0.96 → "Check CSP headers", "Test XSS inputs"
    - stagehand.act() 실행 + 스크린샷

[Phase 3] 스크린샷 큐레이션 (progress: 80~85)
  30+장 → 최대 8장 선별
  선별 로직:
    - 항상 포함: 첫 번째(랜딩) + 마지막(최종 상태)
    - Phase별 균등 분배: discovery 2장, checklist 2장, persona 1-2장
    - base64 인코딩하여 LLM에 전송

[Phase 4] LLM 리포트 생성 (progress: 85~90)
  Claude Sonnet (max_tokens: 4096)
  Input: persona vector + 8장 스크린샷 + 액션 로그 + 테스트 케이스
  Persona 성격 유지: voice_sample 톤, 전문 분야 강조
  Output: textReport, checklistResults, questionnaireAnswers,
          qualityScore, uxFeedback

[Phase 5] DB 저장 (progress: 90~95)
  INSERT testReports (isPersonaTest=true)

[Phase 6] 이중 정산 (progress: 95~100)
  1) USDC 전송 → settlement (type='usdc')
  2) 41R 토큰 민팅 → settlement (type='41r')
  3) 테스트 예산 차감
```

**비동기 Job 관리:**
```typescript
const jobs = new Map<string, AutoTestJob>()  // in-memory 저장

startAutoTest(testId, personaId)  // job 생성 → 즉시 반환 → 백그라운드 실행
getAutoTestStatus(jobId)          // 프론트엔드가 3초마다 폴링
```

**스크린샷 저장:**
- 파일: `screenshots/autotest_{jobId}_step{N}.png`
- 캡처 전 800ms 대기 (UI 안정화)
- 페이지 전환 간 2초 대기

**Persona별 액션 생성 (`generatePersonaActions`):**
- Claude Haiku (max_tokens: 1000)
- 12+ 차원의 동적 포커스 영역 생성:
  - `security_aware > 0.7` → "security (HTTPS, token approvals, XSS)"
  - `ui_critical > 0.7` → "UI quality (visual glitches, alignment)"
  - `performance_sensitive > 0.7` → "performance (load time, animations)"
  - `defi > 0.7` → "DeFi mechanics (slippage, liquidity, gas)"
- 2-3개 페이지 네비게이션 필수 포함
- 다양한 인터랙션 유형 (click, scroll, type, hover)

---

### Feature 8. Token-2022 + 5% Transfer Fee

**파일**: `packages/solana-utils/src/token-setup.ts`

**41R 토큰 생성 과정:**
```typescript
// 상수
TOKEN_DECIMALS = 9
TRANSFER_FEE_BPS = 500  // 5% = 500 basis points
MAX_FEE = 1 토큰 (base units)

// 토큰 생성
createTransferFeeMint(connection, payer) → {
  1. Keypair.generate()  // 새 민트 키페어
  2. getMinimumBalanceForRentExemption()  // 렌트 계산
  3. SystemProgram.createAccount()  // 계정 생성
     + initializeTransferFeeConfig()  // 5% Fee 설정
     + initializeMint()  // 민트 초기화
  4. TOKEN_2022_PROGRAM_ID 사용  // 기존 TOKEN_PROGRAM이 아닌 2022 버전
  return { mint: PublicKey, txSignature }
}
```

**수수료 계산 (천장 나누기):**
```typescript
calculateExpectedFee(amount) {
  // 천장 나누기: (amount * 500 + 9999) / 10000
  // 10 41R → (10*500+9999)/10000 = 0.9999... → ceil = 1 (MAX_FEE 적용)
  return Math.min(ceilDiv, MAX_FEE)
}
```

**전송 흐름:**
```
sender → transferTokensWithFee(from, to, amount) → {
  createTransferCheckedWithFeeInstruction(
    source_ata, mint, dest_ata, owner,
    amount, decimals, fee,
    TOKEN_2022_PROGRAM_ID  // 반드시 Token-2022 프로그램 사용
  )
}
→ 수신자: amount - fee
→ 수신자 ATA에 fee가 withheld로 보관
→ 플랫폼이 collectWithheldFees()로 수거
```

**Solana Service** (`apps/api/src/services/solana.ts`):
```typescript
class SolanaService {
  transferUsdc(recipient, amount)     // SPL Token 표준 전송 (6 decimals)
  mint41RTokens(recipient, amount)    // Token-2022 민팅 (9 decimals)
  transfer41RTokens(from, to, amount) // Transfer Fee 포함 전송
}
```

---

### Feature 9. x402 마이크로페이먼트 미들웨어

**파일**: `apps/api/src/middleware/x402.ts`

**두 가지 구현 모드:**

**Mode 1: Coinbase x402 Facilitator (기본)**
```typescript
createX402Middleware() → {
  1. Coinbase facilitator 클라이언트 초기화
  2. Solana devnet 스킴 등록 (ExactSvmScheme)
  3. 보호 라우트 + 가격 등록:
     /api/hello             → $0.001
     /api/test/:id/results  → $0.05
     /api/persona/search    → $0.05
     /api/persona/:id       → $0.10
  4. Express 미들웨어로 반환
}
```

**Mode 2: Custom USDC 검증 (Fallback)**
```typescript
createFallbackPaymentMiddleware() → {
  1. 요청 경로가 보호 대상인지 확인
  2. X-Payment 헤더 없으면 → 402 반환:
     { price, network: "solana:devnet", payTo: platform_wallet, usdcMint }
  3. X-Payment 헤더 있으면:
     - base64 디코딩 → 트랜잭션 파싱
     - SPL-Token transfer 명령어 검증 (opcode 3)
     - 수신자 ATA + 최소 금액 검증
     - 트랜잭션 시뮬레이션 → 전송 → 확인
  4. req.paymentSignature에 TX 서명 첨부
}
```

**프론트엔드 결제 플로우** (Auto Test 페이지):
```
1. Phantom 지갑 연결 확인
2. USDC 전송 트랜잭션 수동 생성:
   - ATA 주소 계산 (findProgramAddressSync)
   - createTransferCheckedInstruction (0.10 USDC = 100,000 base units)
3. phantom.solana.signTransaction() → 서명
4. connection.sendRawTransaction() → 전송
5. connection.confirmTransaction() → 확인
6. TX 서명을 /api/autotest/run에 전달
```

---

### Feature 10. SAS 온체인 Attestation

**파일**: `apps/api/src/services/sas.ts`

**서비스 구조:**
```typescript
class SASService {
  private useFallback = true  // 초기값: fallback 모드

  init() → {
    // Lazy 초기화 (첫 호출 시 1회)
    1. 환경변수 확인: SAS_CREDENTIAL_PDA, SAS_SCHEMA_PDA
    2. @solana/kit + sas-lib 동적 임포트
    3. RPC 연결 설정
    4. 성공 시 useFallback = false
    5. 실패 시 경고 로그 + fallback 유지
  }

  issueAttestation(testerWallet, data) → {
    // On-chain 경로:
    1. 고유 nonce 키페어 생성
    2. deriveAttestationPda(credential, schema, nonce)
    3. 데이터 직렬화 (float → u32로 ×100 스케일링)
    4. 유효기간 1년 설정
    5. getCreateAttestationInstruction() → TX 빌드 → 서명 → 전송

    // Fallback 경로:
    → "sas_demo_{tier}_{wallet.slice(0,8)}" ID 반환
  }
}
```

**Trust Tier 계산:**
```typescript
function calculateTrustTier(avgQuality, testsCompleted) {
  if (avgQuality >= 4.0 && testsCompleted >= 10) return "Gold"
  if (avgQuality >= 3.5 && testsCompleted >= 5)  return "Silver"
  return "Bronze"
}
```

**데이터 구조 (온체인 저장):**
```
tests_completed: u32      // 총 완료 테스트 수
avg_quality: u32          // 평균 품질 × 100 (420 = 4.20)
expertise_defi: u32       // DeFi 전문도 × 100 (98 = 0.98)
expertise_ai_tools: u32   // AI 도구 전문도 × 100
trust_tier: string        // "Bronze" | "Silver" | "Gold"
persona_activated: u32    // 0 또는 1
```

**핵심 설계 원칙**: SAS 실패는 Persona 생성을 차단하지 않음 (Non-blocking). 온체인 attestation은 "추가 보너스"이며, 핵심 로직은 DB에서 동작.

---

### Feature 11. Persona 매칭 알고리즘

**파일**: `apps/api/src/services/matching.ts`

**매칭 플로우:**
```
기업 요구사항 + URL
       │
       ▼
[Claude Haiku] extractKeywords() → ["defi", "swap", "slippage", "security"]
       │
       ▼
[키워드 → 전문 분야 매핑]
  keywordToExpertise:
    "swap", "dex", "lending" → 'defi'
    "nft", "collectible"    → 'nft'
    "game", "play"          → 'gaming'
    "ai", "ml", "chatbot"   → 'ai_tools'
    "web", "saas"           → 'general_web'
       │
       ▼
[각 Persona 점수 계산]
  expertiseScore = avg(matched_expertise_values)  // 50% 가중치
  qualityWeight  = persona.reliability.quality_score / 5.0  // 30%
  consistWeight  = persona.reliability.consistency          // 20%

  totalScore = (expertiseScore × 0.5) + (qualityWeight × 0.3) + (consistWeight × 0.2)
       │
       ▼
[정렬 → 상위 3개 반환]
  { persona, score, matchedKeywords }
```

**자동 매칭 트리거**: 기업이 `enable_auto_test: true`로 테스트 등록 시, 등록 직후 상위 3개 Persona에 대해 `startAutoTest()` 자동 실행

---

### Feature 12. 프론트엔드 디자인 시스템

**파일**: `apps/web/app/layout.tsx`, `tailwind.config.ts`

**디자인 토큰:**
```
폰트:
  Display: Syne (weights 400-800)     → 제목, 강조
  Body: DM Sans (weights 300-700)     → 본문, UI
  Code: JetBrains Mono (weights 400-500) → 코드, 수치

색상 (Solana 인스파이어드):
  sol-green:  #14F195    → 성공, 활성, 보상
  sol-purple: #9945FF    → 강조, Persona, 프리미엄
  sol-blue:   #00D1FF    → 정보, 링크, 보조

배경 (다크 테마):
  surface-base:    #0B0E14
  surface-card:    #151822
  surface-hover:   #1E2230
  border:          #282D3E
  text-primary:    #E8E9ED
  text-secondary:  #8A8F9E
```

**핵심 컴포넌트:**
| 컴포넌트 | 파일 | 용도 |
|----------|------|------|
| `SolanaWalletProvider` | `components/wallet-provider.tsx` | Phantom 지갑 Context |
| `RadarChart` | `components/radar-chart.tsx` | recharts 레이더 차트 |
| `Sidebar` | `components/sidebar.tsx` | 좌측 네비게이션 |
| `LoadingSpinner` | `components/loading.tsx` | 로딩 상태 |
| `ErrorDisplay` | `components/error-display.tsx` | 에러 표시 + 재시도 |
| `ChipSelect` | tester/profile 내부 | 다중 선택 칩 |
| `AiLoadingIndicator` | company/register 내부 | AI 생성 진행 표시 |

**Phantom 지갑 통합:**
```typescript
// wallet-provider.tsx
1. window.phantom.solana 감지
2. connect() → phantom.solana.connect()
3. publicKey를 base58 문자열로 Context 제공
4. accountChanged / disconnect 이벤트 리스닝
```

**페이지별 API 연동:**

| 페이지 | API 호출 | 지갑 사용 |
|--------|---------|----------|
| `/` Landing | testApi.list, personaApi.list | 없음 |
| `/company` | testApi.list | 없음 |
| `/company/register` | testApi.register | Phantom USDC 전송 |
| `/tester/profile` | testerApi.get/register, personaApi.generate | 주소 자동 채움 |
| `/tester/test/[id]` | testApi.get, reportApi.submit | 없음 |
| `/autotest` | testApi.list, personaApi.list, autoTestApi.run/status | Phantom $0.10 USDC 결제 |
| `/persona/[id]` | personaApi.get | 없음 |
| `/report/[id]` | reportApi.get | 없음 |
| `/x402` | x402-demo 라우트 | 서버사이드 자동 결제 |

---

### Feature 13. 리포트 비교 시스템

**라우트**: `GET /api/reports/compare/:testId`

**구현:**
```typescript
// 같은 testId의 모든 리포트를 수집
const allReports = await db.select().from(testReports).where(eq(testId, id))

// 거절된 리포트 제외 (qualityScore < 1.5)
const validReports = allReports.filter(r => r.qualityScore >= 1.5)

// 수동 vs 자동 분류
const manual = validReports.filter(r => !r.isPersonaTest)
const persona = validReports.filter(r => r.isPersonaTest)

// 각 그룹 통계
{
  manual: {
    count, reports, avg_quality,
    issues: { passed, failed, blocked }  // 체크리스트 집계
  },
  persona: {
    count, reports, avg_quality,
    issues: { passed, failed, blocked }
  }
}
```

**프론트엔드**: `/company/test/[testId]` 페이지에서 수동+자동 리포트가 모두 있을 때 "Compare" 링크 활성화

---

### Feature 14. 시드 데이터 및 데모 환경

**파일**: `scripts/seed-data.ts`

**시드 구조:**
```
1개 기업 (DeFi Protocol X)
  └── 2개 테스트 (DEX $500 + NFT $350)
       └── 각 9개 테스트 케이스 (4 checklist + 1 scenario + 4 questionnaire)

7명 테스터:
  ├── Alice Chen   → 3회 완료, Persona 있음 (DeFi Expert)
  ├── Bob Martinez → 3회 완료, Persona 있음 (UX Specialist)
  ├── Charlie N.   → 3회 완료, Persona 있음 (Security Auditor)
  ├── Diana Okafor → 3회 완료, Persona 없음 ← 라이브 데모용
  ├── Fiona Larson → 3회 완료, Persona 있음 (Accessibility)
  ├── Grace Park   → 3회 완료, Persona 있음 (Design Systems)
  └── Evan Wright  → 0회, 비활성 ← 신규 등록 데모용

5개 Persona (SAS Attestation 포함)
18개 리포트 (테스터별 3개)
5개 Settlement (USDC)
```

**시드 후 SAS 발행:**
```typescript
// 각 Persona에 대해 API 호출로 SAS attestation 발행
for (const p of personas) {
  await fetch(`${API_BASE}/api/persona/${p.id}/renew-sas`, { method: 'POST' })
}
```

---

## Expected Q&A

---

### Q1. 41R이 기존 크라우드 테스팅 플랫폼(Testlio, BugCrowd)과 다른 점은 무엇인가요?

**A:**
세 가지 핵심 차별점이 있습니다.

1. **AI Persona 생성**: 기존 플랫폼은 테스터를 "소모품"으로 취급합니다. 41R은 테스터의 고유한 테스팅 패턴을 AI Persona로 영구 자산화합니다. 한번 생성된 Persona는 반복적으로 자동 테스트를 수행할 수 있어, 테스터는 자지 않아도 일하는 분신을 갖게 됩니다.

2. **온체인 정산 + 품질 기반 보상**: 고정 보상이 아닌, 리포트 품질에 따라 `reward = base × (score/5)^1.5` 공식으로 차등 지급합니다. 좋은 리포트를 쓸수록 더 많이 받고, 낮은 품질은 거절됩니다. 모든 정산은 Solana 위에서 투명하게 처리됩니다.

3. **x402 마이크로페이먼트**: API 레벨에서 HTTP 402 프로토콜로 과금하여, 테스트 결과 하나 조회에 $0.05 같은 초소액 결제가 가능합니다. 기존 SaaS 구독 모델과 달리 사용한 만큼만 지불합니다.

---

### Q2. AI Persona가 정말 인간 테스터를 대체할 수 있나요? 자동 테스트의 품질은 어떤가요?

**A:**
**대체가 아니라 보완**입니다.

AI Persona는 인간 테스터의 관점과 전문성을 학습하지만, 몇 가지 차이가 있습니다:

- **강점**: 24시간 작동, 일관된 품질, 다양한 Persona 동시 투입 가능, 비용 효율 ($0.10/회)
- **한계**: 실제 사용자의 감정적 반응, 물리적 디바이스 차이, 예측 불가능한 창의적 테스팅은 인간이 우위

우리 시스템은 `GET /api/reports/compare/:testId` API로 수동 vs 자동 리포트를 비교할 수 있습니다. 실제 데모에서 DeFi Expert Persona는 슬리피지 계산 오류를 찾아냈고, Security Persona는 CSP 헤더 누락을 탐지했습니다.

**핵심은 "Human-in-the-loop"**: 인간이 3회 테스트로 Persona를 만들고, Persona가 확장 테스트를 수행하며, 결과는 다시 인간이 검증합니다.

---

### Q3. 왜 Solana를 선택했나요? 다른 체인 대비 장점은?

**A:**
네 가지 이유입니다.

1. **속도 + 비용**: 테스트 한 건 정산에 $0.00025 수준의 가스비, 400ms 이내 확정. 이더리움에서는 가스비가 보상보다 클 수 있습니다.

2. **Token-2022 확장**: SPL Token-2022의 Transfer Fee Extension으로 토큰 자체에 5% 수수료를 내장할 수 있습니다. ERC-20에서는 커스텀 컨트랙트가 필요하지만, Solana는 프로토콜 레벨에서 지원합니다.

3. **x402 생태계**: Coinbase가 Solana 기반 x402 facilitator를 공식 지원하여, HTTP 402 마이크로페이먼트를 바로 연동할 수 있었습니다.

4. **SAS (Solana Attestation Service)**: 온체인 attestation 표준이 있어 Persona의 신뢰도를 검증 가능한 형태로 기록할 수 있습니다.

---

### Q4. Token-2022의 5% Transfer Fee는 어떤 역할을 하나요?

**A:**
41R Token은 SPL Token-2022 표준으로 발행되며, **모든 전송에 5% 수수료가 자동으로 부과**됩니다.

```
예시: 10 41R 전송 시
  수신자: 9.5 41R
  Treasury: 0.5 41R (자동 수거)
```

이 수수료는 다음 용도로 사용됩니다:
- 플랫폼 운영비
- 테스터 인센티브 풀
- Persona 품질 개선 연구

중요한 점은 이것이 스마트 컨트랙트가 아니라 **토큰 자체의 기능**이라는 것입니다. Transfer Fee Extension은 Solana 런타임 레벨에서 강제되므로 우회가 불가능합니다.

---

### Q5. 품질 점수 계산은 어떻게 이루어지나요? 공정한가요?

**A:**
2단계 검증 시스템입니다.

**1단계: AI 평가 (Claude Haiku)**
- 체크리스트 완성도, 시나리오 상세도, 질문지 구체성을 분석
- 0.0~5.0 점수 산출 + 평가 이유 텍스트
- 평가 기준: 구체적 버그 발견(+1), 액션 가능한 제안(+0.5), 일반적 코멘트(0), 빈 응답(-1)

**2단계: 휴리스틱 백업**
- AI 평가 실패 시 규칙 기반 채점이 자동 적용
- 체크리스트 완료율(최대 2점) + 시나리오 단어 수(최대 1.5점) + 질문지 응답 품질(최대 1.5점)

**공정성 보장**:
- 모든 평가 이유가 기록되어 투명하게 확인 가능
- 1.5점 미만만 거절 → 최소한의 노력만 하면 보상 받음
- Power Curve (`^1.5`)로 고품질 리포트에 기하급수적 인센티브

---

### Q6. Stagehand가 정확히 무엇이며, 어떻게 Persona의 성격을 반영하나요?

**A:**
Stagehand는 [BrowserBase](https://www.browserbase.com/)에서 만든 AI 브라우저 자동화 프레임워크입니다. Claude Vision을 내장하여 "이 버튼을 클릭해" 같은 자연어 명령으로 브라우저를 제어합니다.

**Persona 성격 반영 과정:**

1. Persona Vector에서 전문 분야 추출 (예: security_aware=0.96)
2. Claude Haiku가 Persona에 맞는 5-8개 브라우저 액션 생성:
   - Security Expert → "Check for XSS input fields", "Inspect CSP headers"
   - DeFi Expert → "Verify slippage calculation", "Test token swap flow"
   - UX Designer → "Check color contrast ratio", "Test responsive layout"
3. Stagehand가 각 액션을 실행하며 스크린샷 캡처
4. Claude Sonnet이 Persona 관점에서 리포트 작성 (voice_sample 톤 유지)

**결과**: 같은 사이트를 5개 Persona가 테스트하면 5개의 **서로 다른 관점**의 리포트가 나옵니다.

---

### Q7. x402 프로토콜이란? 왜 일반 API 키 대신 사용하나요?

**A:**
x402는 HTTP 표준 상태 코드 402 (Payment Required)를 활용한 **웹 네이티브 결제 프로토콜**입니다.

**기존 API 과금 방식의 문제:**
- API 키 발급 → 월 구독 → 사용량 초과 → 추가 과금 → 복잡한 빌링
- 최소 과금 단위가 큼 ($10/월 등)

**x402 방식:**
```
1. 클라이언트: GET /api/persona/591f7a77
2. 서버: 402 Payment Required { price: $0.10, payTo: "wallet..." }
3. 클라이언트: USDC 전송 ($0.10)
4. 클라이언트: GET /api/persona/591f7a77 + X-Payment: <tx_proof>
5. 서버: 200 OK { persona data }
```

**장점:**
- 회원가입/API 키 불필요 — 지갑만 있으면 즉시 사용
- $0.001 단위 초소액 결제 가능 (기존 결제 시스템으로는 불가)
- 모든 결제가 온체인 → 투명하고 검증 가능
- Coinbase가 공식 facilitator 운영 → 신뢰성 확보

---

### Q8. SAS Attestation은 무엇이고, 왜 필요한가요?

**A:**
SAS(Solana Attestation Service)는 Solana 위에 **검증 가능한 증명서**를 발행하는 시스템입니다.

**왜 필요한가?**
Persona의 신뢰도를 제3자가 검증할 수 있어야 합니다. "이 Persona가 정말 10회 테스트를 완료하고 평균 4.2점을 받았는가?"를 온체인에서 확인할 수 있습니다.

**기록 데이터:**
```
tests_completed: 12       // 총 완료 테스트 수
avg_quality: 4.2          // 평균 품질 점수
expertise_defi: 98        // DeFi 전문도 (0-100)
expertise_ai_tools: 45    // AI 도구 전문도
trust_tier: "Gold"        // 신뢰 등급
persona_activated: true   // Persona 활성화 여부
```

**Trust Tier:**
- Gold: 품질 4.0+ & 10회+ → 프리미엄 자동 테스트 매칭 우선
- Silver: 품질 3.5+ & 5회+
- Bronze: 기본 (3회 완료)

이를 통해 기업은 Persona를 선택할 때 **온체인 검증된 실적**을 기준으로 판단할 수 있습니다.

---

### Q9. 실제 비즈니스 모델은 어떻게 되나요? 수익은 어디서 발생하나요?

**A:**
3가지 수익원이 있습니다.

1. **41R Token Transfer Fee (5%)**
   - 모든 41R 전송에서 자동 수거
   - 플랫폼 규모가 커질수록 수수료 수입 증가

2. **x402 API 과금**
   - 테스트 결과 조회: $0.05/건
   - Persona 상세 정보: $0.10/건
   - 자동 테스트 실행: $0.10/회
   - 마이크로 단위이지만 대량 사용 시 누적

3. **테스트 예산 수수료 (향후)**
   - 기업이 예치하는 테스트 예산에서 플랫폼 수수료 (예: 10%)
   - 현재 해커톤 버전에서는 미구현

**비용 구조:**
- LLM API 비용: Sonnet 테스트 케이스 생성 ~$0.02, 자동 리포트 ~$0.05
- Haiku 채점 ~$0.001
- Solana 가스비: ~$0.00025/TX
- **자동 테스트 1회당 원가**: ~$0.08 → 수입 $0.10 → 마진 약 20%

---

### Q10. Persona 매칭은 어떻게 이루어지나요?

**A:**
기업이 테스트를 등록하면, 요구사항에 가장 적합한 Persona를 자동으로 매칭합니다.

**매칭 알고리즘:**
```
매칭 점수 = (expertise 매칭 50%) + (품질 점수 30%) + (일관성 20%)
```

**과정:**
1. 기업 요구사항에서 Claude Haiku로 키워드 추출 (예: "DeFi", "slippage", "security")
2. 각 Persona의 expertise 벡터와 키워드 비교
3. 복합 점수 계산:
   - expertise 매칭: 키워드 ↔ Persona 전문 분야 유사도 (50%)
   - quality_score: 평균 리포트 품질 (30%)
   - consistency: 결과 일관성 (20%)
4. 상위 3개 Persona 추천

예시: "DeFi swap 테스트" 요구 → Alice Chen (defi=0.98) > Charlie Nakamura (security=0.90) > Grace Park (ux=0.85)

---

### Q11. 보안은 어떻게 처리하나요? 지갑 인증은?

**A:**
현재 해커톤 스코프에서는 간소화된 인증을 사용합니다.

**현재 구현:**
- Phantom 지갑 연결 = 인증 (서명 검증 미구현)
- 모든 API는 `wallet_address` 파라미터로 사용자 식별
- USDC 전송은 Phantom이 서명하므로 온체인에서 검증됨

**프로덕션 로드맵:**
- 메시지 서명 기반 인증 (Sign In With Solana)
- Rate limiting per wallet
- USDC escrow (기업 예산 예치)
- Transfer Hook에서 권한 검증 강화

**데이터 보안:**
- API 키, 지갑 키 등은 `.env`에만 저장 (코드/커밋에 포함 안됨)
- LLM 입력에 민감 정보 포함되지 않도록 필터링
- 스크린샷은 로컬 저장 + 분석 후 base64 전송

---

### Q12. 왜 Claude를 선택했나요? GPT-4 대비 장점은?

**A:**
세 가지 이유입니다.

1. **Vision + 구조화된 출력**: Claude Sonnet은 스크린샷 분석과 동시에 정확한 JSON 구조를 생성합니다. 테스트 케이스 생성 시 체크리스트/시나리오/질문지를 한번에 구조화해서 출력합니다.

2. **Stagehand 네이티브 통합**: Stagehand 프레임워크가 Claude를 기본 모델로 사용합니다. 브라우저 화면을 "보고" 자연어 명령을 실행하는 데 최적화되어 있습니다.

3. **모델 계층화**: Sonnet (고성능) + Haiku (저비용/고속)를 용도별로 분리하여 비용을 최적화합니다. 리포트 생성은 Sonnet, 점수 계산은 Haiku — 이 구조로 자동 테스트 1회 비용을 ~$0.08로 유지합니다.

---

### Q13. 확장성(Scalability)은 어떻게 고려했나요?

**A:**
현재는 해커톤 MVP이지만, 확장을 고려한 설계입니다.

**현재 한계 (의도적 단순화):**
- 자동 테스트 job은 in-memory 저장 (Redis로 교체 필요)
- 단일 서버 (Express + PostgreSQL)
- 브라우저 인스턴스 로컬 실행

**확장 로드맵:**
| 현재 | 프로덕션 |
|------|---------|
| In-memory job store | Redis + Bull Queue |
| 로컬 Chromium | BrowserBase 클라우드 |
| 단일 PostgreSQL | Read replica + 캐시 |
| Express 단일 서버 | Kubernetes + 오토스케일링 |

**이미 분리된 아키텍처:**
- API / Web / Shared / Solana-utils가 pnpm 모노레포로 분리
- 서비스 레이어 (LLM, Solana, AutoTest)가 독립적
- DB 스키마가 Drizzle ORM으로 마이그레이션 가능

---

### Q14. 데모에서 보여준 데이터가 실제인가요, 하드코딩인가요?

**A:**
**시드 데이터 + 실제 AI 생성의 조합**입니다.

- **테스트 케이스**: 실제 Claude Sonnet이 jup.ag 요구사항을 분석하여 생성한 결과
- **테스트 리포트**: 시드 스크립트로 사전 삽입 (시연 시간 절약을 위해)
- **Persona Vector**: Claude Sonnet이 3개 리포트를 분석하여 실제 생성
- **SAS Attestation**: 데브넷 fallback (demo ID) 사용
- **USDC 보상**: 데브넷 Mock USDC 실제 전송
- **자동 테스트**: Stagehand가 실제 브라우저를 열고 사이트를 탐색 (사전 실행 후 캐싱)

라이브에서 기업 등록 → AI 테스트 케이스 생성까지는 **실시간 AI 호출**입니다.

---

### Q15. 3회라는 Persona 생성 기준은 어떻게 정한 건가요?

**A:**
**패턴 인식의 최소 데이터 포인트**입니다.

- 1회: 단일 샘플 → 편향 가능
- 2회: 비교 가능하지만 일관성 판단 어려움
- 3회: 패턴 확인 가능 + 일관성/비일관성 식별
- 5회+: 더 정확하지만 테스터 이탈 위험 (진입 장벽)

3회는 **정확도와 접근성의 균형점**입니다. 프로덕션에서는 테스트가 누적될수록 Persona Vector를 업데이트하여 정확도를 지속 개선할 수 있습니다.

---

### Q16. 테스터가 저품질 리포트를 반복 제출하면 어떻게 되나요?

**A:**
다층 방어 시스템이 있습니다.

1. **품질 점수 1.5 미만 → 거절**: 보상 없음, testsDone 미증가 → Persona 생성 불가
2. **Power Curve**: 저품질 리포트는 기하급수적으로 낮은 보상 (2.0점 = 기본의 25%만 지급)
3. **SAS Trust Tier**: 평균 품질이 낮으면 Bronze 등급에 머무름 → 자동 테스트 매칭에서 후순위
4. **Persona 품질 반영**: 저품질 리포트 3개로 생성된 Persona는 reliability.quality_score가 낮음 → 자동 테스트 결과도 신뢰도 낮음으로 표시

경제적 인센티브가 자연스럽게 품질을 끌어올리는 구조입니다.

---

### Q17. 이 프로젝트의 기술적으로 가장 어려웠던 부분은?

**A:**
**Auto Test Engine**입니다.

1. **Stagehand + Persona 통합**: Persona의 성격을 브라우저 액션으로 변환하는 것이 가장 도전적이었습니다. security_aware=0.96인 Persona가 "CSP 헤더 확인"같은 구체적 보안 테스트를 하도록 하려면, 먼저 사이트 구조를 파악하고 (네비게이션, 링크, 입력 필드), 그 위에서 Persona에 맞는 탐색 전략을 동적으로 생성해야 합니다.

2. **LLM JSON 안정성**: Claude가 가끔 truncated JSON이나 마크다운 래핑된 JSON을 반환하여, `extractJson()` + `repairJson()` 2단계 파싱 로직이 필요했습니다.

3. **스크린샷 큐레이션**: 30+장의 스크린샷 중 LLM에 보낼 8장을 선별하는 로직 — 각 Phase에서 고르게 선택하되 중복 화면 제거, 첫/마지막 화면 필수 포함.

---

### Q18. 향후 로드맵은?

**A:**

**단기 (3개월):**
- Persona 마켓플레이스: 기업이 Persona를 직접 검색/구매하여 테스트 실행
- Persona Vector 업데이트: 테스트 누적 시 벡터 재학습
- 메인넷 배포: 실제 USDC + 41R 토큰

**중기 (6개월):**
- 다중 체인 지원: Ethereum, Base 등
- Persona NFT: Persona를 NFT로 민팅하여 거래 가능
- CI/CD 통합: GitHub Actions에서 자동 테스트 트리거

**장기 (12개월):**
- Persona 간 협업 테스트: 여러 Persona가 동시에 테스트하여 시너지
- 벤치마크 리포트: 업계 평균 대비 제품 품질 비교
- DAO 거버넌스: 41R 토큰 홀더가 플랫폼 정책 결정

---

### Q19. 테스터의 개인정보는 어떻게 보호하나요?

**A:**
- 테스터는 **지갑 주소**로만 식별됩니다 (이름, 이메일 불필요)
- display_name은 선택적이며 닉네임 사용 가능
- 프로필 데이터 (나이대, 지역, 전문 분야)는 Persona 생성에만 사용
- LLM에 전송되는 데이터에 PII(개인식별정보) 미포함
- 모든 데이터는 자체 PostgreSQL에 저장 (외부 서비스 미전송)

프로덕션에서는 Solana의 **데이터 소유권** 모델을 활용하여, 테스터가 자신의 데이터 삭제를 요청하면 온체인 attestation만 남기고 오프체인 데이터를 삭제할 수 있습니다.

---

### Q20. 해커톤 이후 실제 서비스로 전환하려면 무엇이 필요한가요?

**A:**

| 영역 | 현재 (Hackathon) | 프로덕션 필요 |
|------|-----------------|--------------|
| 네트워크 | Devnet | Mainnet-beta |
| USDC | Mock Mint | 실제 USDC |
| 인증 | 지갑 연결만 | Sign In With Solana |
| 자동 테스트 | 로컬 Chromium | BrowserBase 클라우드 |
| Job Queue | In-memory | Redis + Bull |
| 데이터베이스 | 단일 PostgreSQL | Read Replica + 캐시 |
| SAS | Fallback 모드 | 온체인 실제 발행 |
| Escrow | 미구현 | PDA 기반 USDC 에스크로 |
| 모니터링 | 없음 | Sentry + Datadog |
| 법적 | 없음 | 이용약관 + 개인정보처리방침 |

핵심은 **아키텍처가 이미 분리**되어 있어서, 각 모듈을 독립적으로 프로덕션 수준으로 교체할 수 있습니다.

---

## Quick Reference Card (발표 중 참고용)

```
프로젝트명: 41R Persona Market
한줄 설명: AI Persona 기반 제품 검증 마켓플레이스

핵심 수치:
  - 22개 API 엔드포인트
  - 7개 DB 테이블
  - 17개 웹 페이지
  - 5개 AI Persona
  - 5% Token Transfer Fee
  - $0.10 자동 테스트 1회 비용
  - ~$0.08 AI 원가 (20% 마진)
  - Power Curve: reward = base × (score/5)^1.5

Tech Stack:
  Solana (Token-2022, SAS, x402)
  Claude Sonnet 4.6 + Haiku 4.5
  Stagehand (Browser Automation)
  Next.js 14 + Express + PostgreSQL
  pnpm Monorepo + Drizzle ORM

핵심 차별점:
  1. 인간 테스터 → AI Persona 자산화
  2. 품질 기반 차등 보상 (Power Curve)
  3. x402 마이크로페이먼트
  4. SAS 온체인 신뢰도 증명
  5. Persona별 자율 브라우저 테스트
```
