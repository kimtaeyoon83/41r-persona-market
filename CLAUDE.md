# 41R Persona Market — Project Guidelines

## Overview

AI Persona-driven product validation marketplace on Solana.
Human testers complete tests → earn USDC rewards → generate AI Personas → Personas run autonomous browser tests.

## Architecture

```
apps/api  (Express :4100)  — 22 endpoints, 5 services, 7 DB tables
apps/web  (Next.js :3000)  — 17 pages, 7 components, Tailwind dark theme
packages/shared            — TypeScript interfaces (@41rpm/shared)
packages/solana-utils      — Token-2022 utilities (@41rpm/solana-utils)
scripts/                   — 10 setup/test/seed scripts
```

## Commands

```bash
pnpm dev                    # Run all (web + api)
pnpm --filter api dev       # API only
pnpm --filter web dev       # Web only
pnpm --filter api test      # Run vitest (19 tests)
pnpm --filter api db:push   # Push schema to DB
pnpm tsx scripts/seed-data.ts  # Populate demo data
```

## Key Conventions

### Backend (apps/api)
- All routes under `src/routes/`, mounted in `src/index.ts`
- Services in `src/services/` — llm.ts, solana.ts, autotest.ts, matching.ts, sas.ts
- Database: Drizzle ORM with PostgreSQL, schema in `src/db/schema.ts`
- LLM models: Claude Sonnet 4.6 (generation), Claude Haiku 4.5 (scoring/extraction)
- JSON from LLM: always use `parseJsonSafe()` which has `repairJson()` fallback
- Quality scoring: power curve `reward = baseReward * (score / 5.0)^1.5`
- Error pattern: try/catch in every route handler, 400/404/409/500 responses

### Frontend (apps/web)
- Next.js 14 App Router, all pages in `app/`
- Shared API URL: `import { API_BASE } from '@/lib/api'` — never hardcode localhost
- API client: `lib/api.ts` exports `testApi`, `reportApi`, `personaApi`, `testerApi`, `autoTestApi`
- Loading: use `<LoadingSpinner>` or `<Loading>` from `components/loading.tsx`
- Errors: use `<ErrorDisplay message={...} onRetry={...}>` from `components/error-display.tsx`
- Design system: Solana-inspired dark theme (sol-green #14F195, sol-purple #9945FF)
- Fonts: Syne (display), DM Sans (body), JetBrains Mono (code)
- Wallet: Phantom via `components/wallet-provider.tsx`, `useWalletContext()` hook

### Solana Integration
- Network: devnet
- 41R Token: Token-2022 with 5% transfer fee (mint in TOKEN_41R_MINT env)
- USDC: devnet mock mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals)
- x402: payment-gated endpoints via `middleware/x402.ts` ($0.001 ~ $0.10)
- SAS: on-chain attestation with fallback to local demo IDs
- Keypair: loaded from `~/.config/solana/id.json`

### Testing
- Vitest for API unit tests (`apps/api/src/__tests__/`)
- No frontend tests (hackathon scope)
- E2E: manual walkthrough or `scripts/e2e-flow.ts`

## Environment Variables

Required in root `.env`:
```
DATABASE_URL          # PostgreSQL connection string
ANTHROPIC_API_KEY     # Claude API key
SOLANA_KEYPAIR_PATH   # Path to Solana keypair JSON
X402_RESOURCE_WALLET  # Wallet receiving x402 payments
TOKEN_41R_MINT        # 41R token mint address
SAS_CREDENTIAL_PDA    # SAS credential account
SAS_SCHEMA_PDA        # SAS schema account
```

Optional:
```
API_PORT=4100
NEXT_PUBLIC_API_URL=http://localhost:4100
SKIP_PAYMENT_VERIFY=true    # Skip on-chain verification for demo
USE_X402_FALLBACK=false     # Use custom USDC verification instead of x402
```

## Do NOT

- Commit `.env`, keypair files, or API keys
- Hardcode `localhost:4100` in frontend — use `API_BASE`
- Use `JSON.parse()` on LLM output — use `parseJsonSafe()` from `services/llm.ts`
- Add wallet signature verification (simplified for hackathon)
- Create new .md docs without explicit request
