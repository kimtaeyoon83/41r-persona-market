# 41R Persona Market

> **AI Persona-Based Product Validation Marketplace on Solana**
>
> Solana Startup Village Hackathon | February 2026

---

Companies submit a URL, AI generates test cases. Testers complete 3 manual tests to earn USDC and generate an AI Persona. That Persona then autonomously tests products via browser automation, earning passive income for the tester — all settled on Solana.

```
Company: URL + requirements  -->  LLM generates test cases
                                        |
Tester: picks test --> completes 3x --> USDC reward ($3-$5 each)
                                        |
                                  AI Persona generated
                                        |
Auto Test: Persona drives browser --> report + UX feedback
                                        |
                              41R Token settlement on-chain
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, Tailwind CSS, Recharts |
| Backend | Express.js, PostgreSQL, Drizzle ORM |
| AI | Claude Sonnet 4.6 (vision + analysis), Claude Haiku 4.5 (scoring) |
| Browser Agent | Stagehand (Playwright + AI) |
| Blockchain | Solana (devnet) |
| Payments | x402 micropayment protocol, USDC, 41R Token |
| On-chain | Token-2022 Transfer Fee (5%), Transfer Hook, SAS Attestation |

## Solana Integration

This project uses **5 distinct Solana technologies**:

1. **x402 Micropayment Protocol** — Per-API-call payment gating. Companies pay to access test results and persona data.

2. **Token-2022 Transfer Fee** — 41R token has a built-in 5% transfer fee, automatically collected on every transfer for platform revenue.

3. **Token-2022 Transfer Hook** — Atomic payment + performance recording. When 41R tokens transfer, on-chain tester performance counters update in the same transaction.

4. **SAS (Solana Attestation Service)** — Persona credentials (test quality, expertise, trust tier) are attested on-chain. Bronze/Silver/Gold tiers verified by anyone.

5. **USDC on Solana** — Instant settlement for manual testers. No bank delays, no international wire fees.

## Architecture

```
41rpm/
├── apps/
│   ├── api/                 # Express backend (port 4100)
│   │   ├── routes/          # test, tester, report, persona, autotest, hello
│   │   ├── services/        # llm, solana, sas, stagehand, matching, autotest
│   │   ├── middleware/      # x402 payment, wallet auth
│   │   └── db/              # Drizzle ORM schema (7 tables)
│   └── web/                 # Next.js frontend (port 3100)
│       ├── app/             # 12 routes: company, tester, persona, autotest
│       ├── components/      # radar-chart, sas-badge, tx-link, sidebar, ...
│       └── lib/             # API client
├── packages/
│   ├── shared/              # TypeScript type definitions
│   └── solana-utils/        # Token-2022 creation, transfer, fee collection
├── scripts/                 # seed-data, e2e-flow, setup-token, verify-demo
├── design.md                # Full technical design document
├── DEVELOPMENT_PLAN.md      # 7-day implementation roadmap
└── FEASIBILITY_ISSUES.md    # Token economics analysis
```

## Database Schema

| Table | Description |
|-------|-------------|
| `companies` | Registered companies with wallet addresses |
| `tests` | Test records with URL, requirements, USDC budget |
| `test_cases` | AI-generated checklist, scenarios, questionnaire |
| `testers` | Tester profiles, expertise, test count, persona link |
| `test_reports` | Checklist results, scenario logs, questionnaire answers |
| `personas` | 20-dimension PersonaVector + voice sample + SAS attestation |
| `settlements` | USDC and 41R payment records with TX signatures |

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker (for PostgreSQL)
- Solana CLI (for devnet wallet)

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
# Edit .env — add your ANTHROPIC_API_KEY

# Push database schema
pnpm --filter @41rpm/api db:push

# Seed demo data
npx tsx scripts/seed-data.ts

# Verify environment
npx tsx scripts/verify-demo.ts

# Start dev servers
pnpm dev
# API: http://localhost:4100
# Web: http://localhost:3100
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/test/register` | Register test (URL + requirements) |
| GET | `/api/tests` | List all tests |
| GET | `/api/test/:id` | Test detail with test cases |
| POST | `/api/tester/register` | Register tester |
| GET | `/api/tester/:wallet` | Tester profile + persona |
| POST | `/api/report/submit` | Submit test report |
| POST | `/api/persona/generate` | Generate persona (requires 3 reports) |
| GET | `/api/personas` | List active personas |
| GET | `/api/persona/:id` | Persona detail with vector |
| POST | `/api/autotest/run` | Trigger auto test |
| GET | `/api/autotest/status/:jobId` | Auto test job status |
| GET | `/api/hello` | x402 payment-gated endpoint |

## Key Flows

### 1. Test Registration (Company)
Company submits URL + requirements. Claude Sonnet analyzes screenshots and generates structured test cases (checklist items, user scenarios, questionnaire).

### 2. Manual Testing (Tester)
Tester picks a test, executes checklist items, records scenario walkthroughs, answers questionnaire. On submission: Claude Haiku scores quality (1-5) and USDC reward ($3-$5) is transferred instantly.

### 3. Persona Generation (3 tests = 1 Persona)
After 3 completed tests, Claude Sonnet analyzes all reports to generate a 20-dimension PersonaVector:
- **test_style** (5 axes): speed, thoroughness, creativity, ux_focus, bug_detection
- **expertise** (5 axes): defi, nft, gaming, ai_tools, general_web
- **feedback_pattern** (5 axes): detail_oriented, ui_critical, security_aware, performance_sensitive, accessibility_focus
- **reliability** (3 axes): consistency, quality_score, response_rate
- **voice_sample**: Natural language writing style

SAS attestation is issued on-chain (Bronze/Silver/Gold tier).

### 4. Auto Test (AI Persona)
Persona is matched to a new test via keyword-expertise scoring. Stagehand browser agent visits the target site with the Persona's system prompt, executes test cases, captures screenshots, and Claude generates a detailed report. Settlement: 41R tokens minted 50/50 (tester + treasury) with 5% transfer fee.

## Demo Data

The seed script populates:
- 1 company ("DeFi Protocol X")
- 2 active tests (DEX + NFT marketplace)
- 5 testers (Alice, Bob, Charlie, Diana, Evan)
- 9 test reports (3 each for qualified testers)
- 3 AI Personas with distinct profiles:
  - **Alice** — DeFi expert, metrics-driven, Gold tier (quality: 4.5)
  - **Bob** — UX-focused, NFT/gaming, Bronze tier (quality: 3.2)
  - **Charlie** — Security specialist, methodical, Gold tier (quality: 4.8)
- 3 USDC settlements ($125 total, $6.25 platform fees)

## Scripts

```bash
npx tsx scripts/seed-data.ts      # Populate demo data
npx tsx scripts/verify-demo.ts    # Verify demo environment (17 checks)
npx tsx scripts/e2e-flow.ts       # End-to-end integration test
npx tsx scripts/setup-token.ts    # Create 41R Token (Token-2022)
npx tsx scripts/test-stagehand.ts # Test browser automation
npx tsx scripts/test-x402.ts      # Test x402 payment protocol
```

## Team

Built for **Solana Startup Village** hackathon, February 2026.

## License

MIT
