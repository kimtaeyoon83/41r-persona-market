# 41R Persona Market

> **AI Persona-Based Product Validation Marketplace on Solana**
>
> Solana Startup Village Hackathon | February 2026

---

## The Problem

Product testing is slow, expensive, and inconsistent. Companies hire human testers who provide varying quality feedback. There's no way to capture a tester's unique perspective and reuse it at scale.

## The Solution

**41R Persona Market** turns real human testers into reusable AI Personas. After 3 manual tests, an AI analyzes a tester's behavior patterns, expertise, and feedback style to generate a 20-dimension PersonaVector. That Persona then autonomously tests products via browser automation — delivering consistent, persona-perspective reports at a fraction of the cost.

We even **dogfooded our own product**: the 41R platform tested itself using its own AI Personas and generated a real UX report with 7 actionable findings.

---

## Architecture

```
                            ┌──────────────────────────────────────────────┐
                            │              41R Persona Market              │
                            └──────────────────────────────────────────────┘

    ┌─────────────┐         ┌──────────────────────┐         ┌─────────────────────┐
    │   Company    │────────▶│    Express API        │◀────────│      Tester         │
    │  (Browser)   │         │    (port 4100)        │         │    (Browser)        │
    └─────────────┘         └──────────┬───────────┘         └─────────────────────┘
          │                            │                              │
          │  Register URL              │                    Complete 3 tests
          │  + requirements            │                    Earn $3-$5 USDC
          ▼                            ▼                              │
    ┌─────────────┐         ┌──────────────────────┐                  │
    │ Claude       │         │    PostgreSQL         │                  │
    │ Sonnet 4.6   │         │    (7 tables)         │                  ▼
    │              │         │                      │         ┌─────────────────────┐
    │ - Test cases │         │  companies           │         │  AI Persona         │
    │ - Persona    │         │  tests               │         │  Generated          │
    │   generation │         │  test_cases          │         │                     │
    │ - Auto test  │         │  testers             │         │  20-dim Vector      │
    │   reports    │         │  test_reports        │         │  + voice sample     │
    └─────────────┘         │  personas            │         │  + SAS attestation  │
                            │  settlements         │         └──────────┬──────────┘
                            └──────────────────────┘                    │
                                                                       │
    ┌──────────────────────────────────────────────────────────────────┘
    │
    ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                     Auto Test Engine                                │
    │                                                                     │
    │  ┌───────────┐    ┌────────────────┐    ┌────────────────────────┐ │
    │  │ Stagehand  │───▶│ Visit site +    │───▶│ Claude Vision          │ │
    │  │ (Playwright │    │ execute tasks   │    │ generates persona-     │ │
    │  │  + AI)     │    │ + screenshots   │    │ perspective report     │ │
    │  └───────────┘    └────────────────┘    └────────────────────────┘ │
    │                                                                     │
    └─────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                        Solana Devnet                                │
    │                                                                     │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
    │  │ 41R Token     │  │ USDC         │  │ x402         │             │
    │  │ (Token-2022)  │  │ Settlement   │  │ Micropayment │             │
    │  │ 5% tx fee     │  │ $3-$5/test   │  │ $0.001-$0.10 │             │
    │  └──────────────┘  └──────────────┘  └──────────────┘             │
    │                                                                     │
    │  ┌──────────────┐  ┌──────────────┐                                │
    │  │ SAS          │  │ Transfer     │                                │
    │  │ Attestation  │  │ Hook         │                                │
    │  │ Bronze/Gold  │  │ Performance  │                                │
    │  └──────────────┘  └──────────────┘                                │
    └─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. REGISTER       Company → POST /api/test/register → Claude generates test cases
                                                       (checklist + scenarios + questionnaire)

2. MANUAL TEST    Tester → picks test → completes checklist → submits report
                                                               → Claude scores quality (1-5)
                                                               → USDC reward ($3-$5) on Solana

3. PERSONA        3 reports → Claude analyzes patterns → 20-dim PersonaVector
                                                        → SAS on-chain attestation

4. AUTO TEST      Persona matched → Stagehand visits site → 10-15 step screenshots
                                  → Claude Vision report → 41R token settlement on-chain

5. COMPARE        Manual report ←→ AI Persona report — side-by-side analysis
```

---

## Solana Integration (5 Technologies)

| # | Technology | How We Use It | Verified |
|---|-----------|---------------|:--------:|
| 1 | **x402 Micropayment** | Per-API-call payment gating ($0.001-$0.10) for test results and persona data | /api/hello, /api/persona, /api/test/results |
| 2 | **Token-2022 Transfer Fee** | 41R token with 5% built-in fee — platform revenue on every transfer | Mint: `GeriorgNHG6o7XGA2xqLyjexqaFxq8nYDvYdJ37qACpS` |
| 3 | **Token-2022 Transfer Hook** | Atomic payment + performance recording in same transaction | Fallback: PostgreSQL settlements |
| 4 | **SAS Attestation** | Persona credentials (quality, expertise, trust tier) attested on-chain via `sas-lib` | Credential: `R3hRyk…` Schema: `H3ut5o…` |
| 5 | **USDC on Solana** | Instant settlement for manual testers — no bank delays | $131+ settled in demo |

### On-Chain Assets

```
41R Token Mint:     GeriorgNHG6o7XGA2xqLyjexqaFxq8nYDvYdJ37qACpS  (devnet)
Transfer Fee:       5% (500 bps), max 1 token per transfer
Decimals:           9
Wallet:             8Vm3ys3kwLSy2qThejn56E2j6fptwSE2qcLkEeiLrdB8

SAS Credential PDA: R3hRyk7FKd7m1eAJHetzTkzbygVwNBQSgsV2YPHmkzh  (devnet)
SAS Schema PDA:     H3ut5oZXhn8LwviXs5cxCaadfuAdEKzzox8ckpcR4k1V  (devnet)
SAS Schema Fields:  tests_completed, avg_quality, expertise_defi, expertise_ai, trust_tier, persona_activated
```

---

## Tech Stack

| Layer | Technology | Model / Version |
|-------|-----------|-----------------|
| Frontend | Next.js 14, Tailwind CSS, Recharts | App Router, dark theme |
| Backend | Express.js, PostgreSQL 16, Drizzle ORM | 7 tables, typed queries |
| AI — Heavy | Claude Sonnet 4.6 | Test case gen, persona gen, auto test reports |
| AI — Fast | Claude Haiku 4.5 | Quality scoring, keyword extraction |
| Browser Agent | Stagehand v3 (Playwright + Claude Vision) | Headless Chromium, per-action screenshots |
| Blockchain | Solana devnet | Token-2022, SAS, x402 |
| Monorepo | pnpm workspaces + Turborepo | apps/web, apps/api, packages/* |

---

## Key Features

### AI-Generated Test Cases
Company submits a URL. Claude Sonnet analyzes the page and generates structured test cases — checklist items, user scenario narratives, and UX questionnaires. No manual test plan writing needed.

### 20-Dimension PersonaVector
After 3 manual tests, Claude analyzes all reports to extract:
- **test_style** (5 axes): speed, thoroughness, creativity, ux_focus, bug_detection
- **expertise** (5 axes): defi, nft, gaming, ai_tools, general_web
- **feedback_pattern** (5 axes): detail_oriented, ui_critical, security_aware, performance_sensitive, accessibility_focus
- **reliability** (3 axes): consistency, quality_score, response_rate
- **demographics**: age_group, tech_literacy, crypto_experience, design_sensitivity
- **ux_preferences**: visual_style, information_density, animation_tolerance
- **voice_sample**: Natural language writing style

### Per-Action Screenshot Timeline
Auto tests capture a screenshot after every browser action (10-15 per session), labeled with step number, action description, and phase. The LLM receives a sampled subset (max 6) for report generation while the full timeline is displayed in the UI.

### Self-Test (Dogfooding)
We registered `http://localhost:3000` (our own platform) as a test target. Alice Persona (30s DeFi expert) autonomously tested our platform and found 7 real UX issues including accessibility gaps and missing progress indicators. The report was settled with real 41R tokens on Solana devnet.

---

## Project Structure

```
41rpm/
├── apps/
│   ├── api/                     # Express backend (port 4100)
│   │   ├── src/
│   │   │   ├── routes/          # test, tester, report, persona, autotest, hello
│   │   │   ├── services/        # llm, solana, sas, autotest, matching
│   │   │   ├── middleware/      # x402 payment (4 gated routes)
│   │   │   └── db/              # Drizzle ORM schema + connection
│   │   └── drizzle.config.ts
│   └── web/                     # Next.js 14 frontend (port 3000)
│       ├── app/
│       │   ├── page.tsx                      # Homepage with live stats
│       │   ├── company/                      # Dashboard, register, test detail
│       │   │   └── test/[testId]/compare/    # Manual vs AI report comparison
│       │   ├── tester/                       # Tests list, test session, profile
│       │   ├── persona/                      # Gallery, detail (radar chart + demographics)
│       │   ├── autotest/                     # Trigger + step-by-step results viewer
│       │   └── report/[reportId]/            # Full report viewer
│       ├── components/          # sidebar, loading, radar-chart, sas-badge
│       └── lib/api.ts           # Typed API client
├── packages/
│   ├── shared/                  # TypeScript interfaces (PersonaVector, etc.)
│   └── solana-utils/            # Token-2022 creation, transfer, fee utils
├── scripts/
│   ├── seed-data.ts             # Demo data (5 testers, 3 personas, 9 reports)
│   ├── verify-demo.ts           # 18-check environment verification
│   ├── setup-token.ts           # Create 41R Token on devnet
│   └── test-stagehand.ts        # Browser automation PoC
├── screenshots/                 # Auto test screenshot output
├── design.md                    # Technical design document (v5)
└── .env.example                 # Environment template
```

---

## API Endpoints

| Method | Endpoint | x402 | Description |
|--------|----------|:----:|-------------|
| GET | `/api/health` | | Health check |
| POST | `/api/test/register` | | Register test + generate AI test cases |
| GET | `/api/tests` | | List all tests |
| GET | `/api/test/:id` | | Test detail with test cases |
| GET | `/api/test/:id/results` | $0.05 | Test results with reports + settlements |
| POST | `/api/tester/register` | | Register tester with demographics |
| GET | `/api/tester/:wallet` | | Tester profile + persona link |
| POST | `/api/report/submit` | | Submit report → quality score → USDC reward |
| GET | `/api/report/:id` | | Report detail |
| GET | `/api/reports/test/:testId` | | All reports for a test |
| GET | `/api/reports/compare/:testId` | | Manual vs persona comparison |
| POST | `/api/persona/generate` | | Generate persona (requires 3 reports) |
| GET | `/api/personas` | | List active personas |
| GET | `/api/persona/:id` | $0.10 | Persona detail with full vector |
| POST | `/api/autotest/run` | | Trigger auto test (async job) |
| GET | `/api/autotest/status/:jobId` | | Auto test progress + results |
| GET | `/api/hello` | $0.001 | x402 PoC endpoint |

---

## Database Schema

| Table | Key Fields | Description |
|-------|-----------|-------------|
| `companies` | walletAddress, companyName | Registered companies |
| `tests` | targetUrl, requirements, budgetUsdc, status | Test records with AI-generated cases |
| `test_cases` | testId, type, content, order | Checklist, scenario, questionnaire items |
| `testers` | walletAddress, displayName, profile, testsDone | Tester profiles with demographics |
| `test_reports` | testerAddr, testId, qualityScore, isPersonaTest | Manual + AI persona reports |
| `personas` | testerAddr, vector, sasAttestId, isActive | 20-dim PersonaVector + SAS link |
| `settlements` | testId, reportId, amountToken, txSignature | USDC and 41R payment records |

---

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker (for PostgreSQL)
- Solana CLI (for devnet operations)

### Setup

```bash
# Clone and install
git clone <repo-url> && cd 41rpm
pnpm install

# Start PostgreSQL
docker run -d --name 41rpm-postgres \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=admin41rpm \
  -e POSTGRES_DB=persona_market \
  -p 5432:5432 postgres:16-alpine

# Configure environment
cp .env.example .env
# Edit .env:
#   ANTHROPIC_API_KEY=sk-ant-...
#   TOKEN_41R_MINT=GeriorgNHG6o7XGA2xqLyjexqaFxq8nYDvYdJ37qACpS
#   X402_RESOURCE_WALLET=<your-solana-wallet>

# Push database schema
pnpm --filter @41rpm/api db:push

# Seed demo data
npx tsx scripts/seed-data.ts

# Verify everything works (18 checks)
npx tsx scripts/verify-demo.ts

# Start dev servers
pnpm dev
# API: http://localhost:4100
# Web: http://localhost:3000
```

### Run Auto Test

```bash
# Via API
curl -X POST http://localhost:4100/api/autotest/run \
  -H "Content-Type: application/json" \
  -d '{"test_id": "<test-id>", "persona_id": "<persona-id>"}'

# Poll for results
curl http://localhost:4100/api/autotest/status/<job-id>
```

### Create 41R Token (one-time)

```bash
npx tsx scripts/setup-token.ts
# Creates Token-2022 mint with 5% transfer fee
# Mints initial supply and verifies fee collection
```

---

## Demo Data

The seed script populates a realistic demo environment:

| Entity | Count | Details |
|--------|:-----:|---------|
| Company | 1 | "DeFi Protocol X" |
| Tests | 4 | jup.ag, magiceden.io, raydium.io, localhost:3000 (self-test) |
| Testers | 5 | Alice (DeFi, 30s), Bob (NFT, 20s), Charlie (Security, 40s), Diana, Evan |
| Reports | 9+ | 6 manual + 3+ AI persona |
| Personas | 3 | Alice (Gold 4.5), Bob (Bronze 3.2), Charlie (Gold 4.8) |
| Settlements | $131+ | USDC + 41R tokens with on-chain TX signatures |

---

## Scripts

```bash
npx tsx scripts/seed-data.ts       # Populate demo data
npx tsx scripts/verify-demo.ts     # Verify demo environment (18 checks)
npx tsx scripts/setup-token.ts     # Create 41R Token on devnet (Token-2022)
npx tsx scripts/setup-sas.ts       # Create SAS Credential + Schema on devnet
npx tsx scripts/test-stagehand.ts  # Test Stagehand browser automation
npx tsx scripts/test-x402.ts       # Test x402 payment protocol
```

---

## Team

Built for **Solana Startup Village** hackathon, February 2026.

## License

MIT
