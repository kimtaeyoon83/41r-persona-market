# 41R Persona Market

**AI Persona-driven product validation marketplace on Solana** -- turn human testers into reusable AI personas for autonomous product testing.

![Solana](https://img.shields.io/badge/Solana-Token--2022-9945FF?logo=solana&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)

> Built for the **Solana Startup Village Hackathon** (7-day sprint, Feb 2026)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         41R Persona Market                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────┐         ┌──────────────────────────────────┐    │
│  │  @41rpm/web   │  HTTP   │          @41rpm/api              │    │
│  │  Next.js 14   │────────>│        Express.js                │    │
│  │  port 3000    │         │        port 4100                 │    │
│  │               │         │                                  │    │
│  │  - Dashboard  │         │  Routes:                         │    │
│  │  - Test Mgmt  │         │    /api/test      (register/list)│    │
│  │  - Reports    │         │    /api/tester    (register/CRUD)│    │
│  │  - Personas   │         │    /api/report    (submit/query) │    │
│  │  - AutoTest   │         │    /api/persona   (generate/get) │    │
│  │  - x402 Demo  │         │    /api/autotest  (run/status)   │    │
│  │               │         │    /api/x402-demo (payment demo) │    │
│  └───────────────┘         │    /api/hello     (x402 gated)   │    │
│                            │                                  │    │
│                            │  Services:                       │    │
│                            │    LLM (Claude Sonnet/Haiku)     │    │
│                            │    Stagehand (browser automation) │    │
│                            │    Solana (USDC transfers)       │    │
│                            │    SAS (on-chain attestation)    │    │
│                            │    Matching (persona-test)       │    │
│                            └──────────┬───────────────────────┘    │
│                                       │                            │
│           ┌───────────────────────────┼─────────────────┐          │
│           │                           │                 │          │
│           ▼                           ▼                 ▼          │
│  ┌────────────────┐     ┌──────────────────┐  ┌──────────────┐    │
│  │   PostgreSQL   │     │  Solana Devnet   │  │   External   │    │
│  │  Drizzle ORM   │     │                  │  │              │    │
│  │                │     │  - Token-2022    │  │  - Anthropic │    │
│  │  - companies   │     │    (41R, 5% fee) │  │  - Browserbase│   │
│  │  - tests       │     │  - USDC rewards  │  │    Stagehand │    │
│  │  - test_cases  │     │  - SAS attests   │  │              │    │
│  │  - testers     │     │  - x402 payments │  └──────────────┘    │
│  │  - test_reports│     │                  │                       │
│  │  - personas    │     └──────────────────┘                       │
│  │  - settlements │                                                │
│  └────────────────┘                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Flow

```
Company registers test  ──>  AI generates test cases  ──>  Human testers complete tests
        │                   (Claude Sonnet 4.6)                    │
        │                                                          ▼
        │                                              LLM evaluates quality
        │                                              (power-curve reward)
        │                                                          │
        ▼                                                          ▼
   USDC budget deposited                              Reward: $0.50~$5.00 USDC
        │                                              + 41R token bonus
        │                                                          │
        │                                                          ▼
        │                                              After 3 tests:
        │                                              AI Persona generated
        │                                              (20-dim vector)
        │                                                          │
        ▼                                                          ▼
   Persona hired for auto-testing  <──────────  Stagehand browser + Claude Vision
        │
        ▼
   SAS attestation on-chain (Bronze/Silver/Gold)
```

1. **Register** -- Company submits URL + requirements + USDC budget
2. **Generate** -- Claude Sonnet 4.6 creates structured test cases (checklist, scenarios, questionnaires)
3. **Test** -- Human testers complete tests and submit reports
4. **Score** -- Claude Haiku 4.5 evaluates quality; power-curve reward ($0.50-$5.00 USDC on-chain)
5. **Persona** -- After 3 tests, a 20-dimensional AI Persona vector is generated
6. **Auto-Test** -- Persona drives Stagehand (Browserbase) headless browser + Claude Vision
7. **Settle** -- USDC reward + 41R token bonus (5% transfer fee to ecosystem treasury)
8. **Attest** -- SAS records tester trust tier on Solana (Bronze/Silver/Gold)
9. **Gate** -- x402 micropayments protect premium API endpoints ($0.001-$0.10)

---

## Features

- **AI-Generated Test Cases** -- Claude Sonnet 4.6 creates checklists, scenario narratives, and questionnaires from a target URL and requirements
- **LLM Quality Scoring** -- Claude Haiku 4.5 evaluates report quality (0-5 scale) with power-curve reward distribution
- **AI Persona Generation** -- After 3 completed tests, a 20-dimensional persona vector is generated capturing test style, expertise, feedback patterns, demographics, and UX preferences
- **Autonomous Browser Testing** -- Stagehand (Browserbase) drives headless Chrome with the persona's behavioral profile, producing screenshots and structured reports
- **Persona-Test Matching** -- LLM-powered matching scores personas against test requirements for optimal auto-test assignment
- **On-Chain Settlements** -- USDC rewards transferred on Solana; 41R token bonus with 5% transfer fee flowing to ecosystem treasury
- **SAS Attestation** -- Solana Attestation Service records tester trust tiers (Bronze/Silver/Gold) on-chain
- **x402 Micropayments** -- Premium API endpoints gated by x402 protocol ($0.001-$0.10 USDC)
- **Manual vs Persona Comparison** -- Side-by-side comparison of manual and AI-generated test reports
- **Per-Action Screenshot Timeline** -- Auto tests capture screenshots after every browser action, displayed as a step-by-step timeline

---

## Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Frontend | Next.js 14, React 18, Tailwind CSS, Recharts | Solana Wallet Adapter, dark theme |
| Backend | Express.js 4, TypeScript 5.7, Zod | CORS, 10mb JSON body limit |
| Database | PostgreSQL, Drizzle ORM 0.38 | 6 tables, typed schema, `drizzle-kit` migrations |
| AI (Heavy) | Claude Sonnet 4.6 (`@anthropic-ai/sdk`) | Test case generation, persona generation, auto-test reports |
| AI (Fast) | Claude Haiku 4.5 (`@anthropic-ai/sdk`) | Quality scoring, keyword extraction |
| Browser | Stagehand v3 (`@browserbasehq/stagehand`) | Playwright + Claude Vision, headless Chromium |
| Blockchain | Solana devnet (`@solana/web3.js`, `@solana/spl-token`) | Token-2022, SAS (`sas-lib`), x402 |
| Payments | x402 (`@x402/express`, `@x402/fetch`, `@x402/svm`) | USDC micropayments on Solana |
| Monorepo | pnpm 10.30, Turborepo 2.3 | Parallel dev/build/test tasks |
| Testing | Vitest, Supertest, Playwright | Unit + E2E |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 10.30
- **PostgreSQL** >= 15
- **Solana CLI** (`solana-keygen`, `spl-token`)

### 1. Clone and install

```bash
git clone <repo-url> && cd 41rpm
pnpm install
```

### 2. Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (default: `postgresql://admin:admin41rpm@localhost:5432/persona_market`) |
| `SOLANA_RPC_URL` | Solana RPC endpoint (default: `https://api.devnet.solana.com`) |
| `SOLANA_KEYPAIR_PATH` | Path to Solana keypair JSON (default: `~/.config/solana/id.json`) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `BROWSERBASE_API_KEY` | Browserbase API key for Stagehand |
| `BROWSERBASE_PROJECT_ID` | Browserbase project ID |
| `API_PORT` | Express server port (default: `4100`) |
| `NEXT_PUBLIC_API_URL` | API URL for frontend (default: `http://localhost:4100`) |
| `TOKEN_41R_MINT` | 41R token mint address (set after running `setup-token.ts`) |
| `SAS_CREDENTIAL_PDA` | SAS credential PDA (set after running `setup-sas.ts`) |
| `SAS_SCHEMA_PDA` | SAS schema PDA (set after running `setup-sas.ts`) |
| `X402_RESOURCE_WALLET` | Wallet address receiving x402 payments |

### 3. Database

```bash
# Create the database
createdb persona_market

# Push the Drizzle schema
pnpm --filter @41rpm/api db:push
```

### 4. Solana token setup

```bash
# Create 41R Token-2022 mint with 5% transfer fee on devnet
pnpm tsx scripts/setup-token.ts

# Initialize SAS credential and schema PDAs
pnpm tsx scripts/setup-sas.ts
```

Copy the output mint address and PDA values into `.env`.

### 5. Seed data

```bash
pnpm tsx scripts/seed-data.ts
```

### 6. Run

```bash
# Start both API (port 4100) and web (port 3000) via Turborepo
pnpm dev
```

Or run individually:

```bash
# API only
pnpm --filter @41rpm/api dev

# Web only
pnpm --filter @41rpm/web dev
```

### 7. Verify

```bash
pnpm tsx scripts/verify-demo.ts
```

---

## Project Structure

```
41rpm/
├── apps/
│   ├── api/                        # @41rpm/api — Express backend (port 4100)
│   │   └── src/
│   │       ├── index.ts            # Server entry, middleware, route mounting
│   │       ├── db/
│   │       │   ├── schema.ts       # Drizzle ORM schema (6 tables)
│   │       │   └── index.ts        # DB connection pool
│   │       ├── routes/
│   │       │   ├── test.ts         # Test registration, listing, results
│   │       │   ├── tester.ts       # Tester CRUD with stats
│   │       │   ├── report.ts       # Report submission, quality scoring, comparison
│   │       │   ├── persona.ts      # Persona generation, SAS attestation
│   │       │   ├── autotest.ts     # Auto-test job management + payment verification
│   │       │   ├── hello.ts        # x402 payment-gated demo endpoint
│   │       │   └── x402-demo.ts    # x402 flow inspection and paid request demo
│   │       ├── services/
│   │       │   ├── llm.ts          # Claude API (test gen, quality scoring, persona)
│   │       │   ├── stagehand.ts    # Browserbase headless browser automation
│   │       │   ├── solana.ts       # USDC transfers, token operations
│   │       │   ├── sas.ts          # Solana Attestation Service integration
│   │       │   ├── autotest.ts     # Auto-test orchestration (Stagehand + LLM)
│   │       │   └── matching.ts     # Persona-test matching via LLM
│   │       ├── middleware/
│   │       │   └── x402.ts         # x402 payment middleware (standard + fallback)
│   │       └── __tests__/          # Vitest unit tests
│   │
│   └── web/                        # @41rpm/web — Next.js 14 frontend (port 3000)
│       └── app/
│           ├── page.tsx            # Dashboard with live stats
│           ├── layout.tsx          # Root layout
│           ├── company/            # Company test management
│           ├── tester/             # Tester profile and history
│           ├── report/             # Report viewer
│           ├── persona/            # Persona details, radar charts, demographics
│           ├── autotest/           # Auto-test trigger and step-by-step results
│           └── x402/              # x402 demo page
│
├── packages/
│   ├── shared/                     # @41rpm/shared — TypeScript interfaces
│   │   └── src/types.ts            # All domain types and API contracts
│   │
│   └── solana-utils/               # @41rpm/solana-utils — Token-2022 utilities
│       └── src/token-setup.ts      # Mint creation, transfers, fee collection
│
├── scripts/                        # Setup, seed, and test scripts
├── screenshots/                    # Auto-test screenshot output
├── package.json                    # Root workspace config (pnpm 10.30, Turborepo)
├── pnpm-workspace.yaml             # Workspace: apps/*, packages/*
├── turbo.json                      # Turborepo task config (dev, build, test, lint)
└── .env.example                    # Environment template
```

---

## API Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check (`{ status, timestamp }`) |

### Tests

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/test/register` | Register a new test -- AI generates test cases (checklist + scenarios + questionnaire) |
| `GET` | `/api/tests` | List all tests |
| `GET` | `/api/test/:id` | Get test details with test cases |
| `GET` | `/api/test/:id/results` | Get test results with reports and settlements **(x402: $0.05)** |
| `PATCH` | `/api/test/:id/deposit` | Update deposit transaction signature |

### Testers

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tester/register` | Register a new tester with demographic profile |
| `GET` | `/api/testers` | List all testers with stats (report count, avg quality, earnings, persona info) |
| `GET` | `/api/tester/:wallet` | Get tester profile with linked persona |
| `PUT` | `/api/tester/:wallet` | Update tester display name or profile |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/report/submit` | Submit test report -- triggers LLM quality scoring + USDC reward + persona check |
| `GET` | `/api/report/:reportId` | Get a report with its settlements (USDC + 41R) |
| `GET` | `/api/reports/tester/:wallet` | All reports by a tester with test info and settlements |
| `GET` | `/api/reports/test/:testId` | All reports for a test with settlements |
| `GET` | `/api/reports/compare/:testId` | Compare manual vs persona reports (quality, issues, counts) |

### Personas

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/persona/generate` | Generate AI persona from tester's 3+ reports (issues SAS attestation) |
| `GET` | `/api/personas` | List all active personas **(x402: $0.05)** |
| `GET` | `/api/persona/:personaId` | Get persona details with full vector **(x402: $0.10)** |
| `POST` | `/api/persona/:personaId/renew-sas` | Re-issue SAS attestation with updated stats |

### Auto-Test

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/autotest/run` | Start auto-test job (requires $0.10 USDC payment or `payment_tx`) |
| `GET` | `/api/autotest/status/:jobId` | Poll job status, progress, and results |

### x402 Demo

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/hello` | Payment-gated endpoint **(x402: $0.001)** |
| `GET` | `/api/x402-demo/test-402` | Inspect a 402 Payment Required response |
| `GET` | `/api/x402-demo/test-paid` | Execute a paid request using `@x402/fetch` client |

---

## Solana Integration

### 41R Token (Token-2022)

The 41R token uses the Token-2022 program with a **5% transfer fee** extension. Every token transfer automatically withholds fees that accumulate in recipient accounts and can be collected into the ecosystem treasury by the withdraw authority.

| Property | Value |
|----------|-------|
| Program | Token-2022 (`TOKEN_2022_PROGRAM_ID`) |
| Decimals | 9 |
| Transfer fee | 500 basis points (5%) |
| Max fee per transfer | 1,000,000,000 base units (1 token) |

The `@41rpm/solana-utils` package provides:

- `createTransferFeeMint()` -- Create a new Token-2022 mint with transfer fee config
- `transferTokensWithFee()` -- Transfer using `transferCheckedWithFee` instruction
- `collectWithheldFees()` -- Two-step harvest: accounts to mint, then mint to destination
- `withdrawFeesFromAccounts()` -- Direct single-step fee withdrawal
- `calculateExpectedFee()` -- Off-chain fee calculation (ceiling division, matching on-chain)
- `fetchTransferFeeConfig()` -- Read the on-chain fee config

### USDC Rewards

Report quality is scored 0-5 by Claude Haiku 4.5. Reward follows a **power curve** (`score^1.5`) applied against the test's `reward_per_tester`:

| Quality Score | % of Max Reward | Example ($3.00 max) |
|:---:|:---:|:---:|
| 5.0 | 100% | $3.00 |
| 4.0 | 72% | $2.15 |
| 3.0 | 46% | $1.39 |
| 2.0 | 25% | $0.76 |
| < 1.5 | Rejected | $0.00 |

### SAS Attestation

Solana Attestation Service records tester trust tiers on-chain. The attestation schema includes: `tests_completed`, `avg_quality`, `expertise_defi`, `expertise_ai_tools`, `trust_tier`, and `persona_activated`.

| Tier | Criteria |
|------|----------|
| **Gold** | avg quality >= 4.0 and 10+ tests |
| **Silver** | avg quality >= 3.0 and 5+ tests |
| **Bronze** | avg quality >= 2.0 and 3+ tests |

Attestations are issued when a persona is generated and can be renewed via `POST /api/persona/:id/renew-sas`.

### x402 Micropayments

Premium endpoints are gated via the x402 protocol. The middleware intercepts requests, returns `402 Payment Required` with Solana payment instructions (CAIP-2: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`), and verifies the `X-Payment` header on retry. Two middleware modes are supported: standard `@x402/express` and a fallback mode (set `USE_X402_FALLBACK=true`).

| Endpoint | Price (USDC) |
|----------|:---:|
| `/api/hello` | $0.001 |
| `/api/test/:id/results` | $0.05 |
| `/api/personas` (search) | $0.05 |
| `/api/persona/:id` | $0.10 |

---

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `setup-token.ts` | `pnpm tsx scripts/setup-token.ts` | Create 41R Token-2022 mint with 5% transfer fee on devnet |
| `setup-sas.ts` | `pnpm tsx scripts/setup-sas.ts` | Initialize SAS credential and schema PDAs on devnet |
| `seed-data.ts` | `pnpm tsx scripts/seed-data.ts` | Seed database with sample companies, testers, tests, and reports |
| `verify-demo.ts` | `pnpm tsx scripts/verify-demo.ts` | Verify demo environment is working correctly |
| `e2e-flow.ts` | `pnpm tsx scripts/e2e-flow.ts` | Full end-to-end flow: register, test, report, persona, auto-test |
| `test-ai-features.ts` | `pnpm tsx scripts/test-ai-features.ts` | Test Claude LLM integration (test case generation, quality scoring) |
| `test-stagehand.ts` | `pnpm tsx scripts/test-stagehand.ts` | Test Stagehand browser automation |
| `test-x402.ts` | `pnpm tsx scripts/test-x402.ts` | Test x402 payment flow (402 response and paid request) |
| `test-demographics-diff.ts` | `pnpm tsx scripts/test-demographics-diff.ts` | Test demographic profile differentiation across testers |
| `test-persona-diff.ts` | `pnpm tsx scripts/test-persona-diff.ts` | Test persona vector differentiation across testers |

---

## License

MIT
