# 41R Persona Market — Project Guidelines

## Overview

AI Persona-driven product validation marketplace on Solana.
Human testers complete tests → earn USDC rewards → generate AI Personas → Personas run autonomous browser tests.

## Architecture

```
apps/api  (Express :4100)  — 22 endpoints, 6 services, 7 DB tables
apps/web  (Next.js :3000)  — 17 pages, 7 components, Tailwind dark theme
packages/shared            — TypeScript interfaces (@41rpm/shared)
packages/solana-utils      — Token-2022 utilities (@41rpm/solana-utils)
scripts/                   — 10 setup/test/seed scripts
```

## Deployment (Railway + Cloudflare R2)

```
Railway ─── API  (Docker) → https://api-production-a4e7.up.railway.app
        ├── Web  (Docker) → https://web-production-8813d.up.railway.app
        └── PostgreSQL    → internal connection

Cloudflare R2 ── Screenshots CDN → https://pub-d5db789b01364e288af930cfd54a666e.r2.dev
```

### Deployment Commands
```bash
# API deploy (switch railway.toml to api Dockerfile first)
railway up --service api --detach

# Web deploy (switch railway.toml to web Dockerfile first)
railway up --service web --detach

# Set env vars
railway vars --set "KEY=VALUE" --service api

# DB operations (use public URL for local access)
DATABASE_URL="postgresql://postgres:xxx@gondola.proxy.rlwy.net:42069/railway" pnpm --filter api db:push

# Docker local test
docker compose up -d          # Ports: web=3001, api=4101, db=5433
```

### railway.toml Switching
Railway uses a single `railway.toml` at project root. Change `dockerfilePath` before deploying each service:
- API: `dockerfilePath = "apps/api/Dockerfile"`
- Web: `dockerfilePath = "apps/web/Dockerfile"`

### Docker
- `apps/api/Dockerfile` — node:20-slim + Chromium (for Stagehand browser automation)
- `apps/web/Dockerfile` — Next.js standalone build
- `docker-compose.yml` — local dev (DB + API + Web)
- `.dockerignore` — excludes node_modules, .env, .git

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
- Services in `src/services/` — llm.ts, solana.ts, autotest.ts, matching.ts, sas.ts, r2.ts
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
- Keypair: loaded from `SOLANA_KEYPAIR_JSON` env var (production) or `~/.config/solana/id.json` (local)

### Testing
- Vitest for API unit tests (`apps/api/src/__tests__/`)
- No frontend tests (hackathon scope)
- E2E: manual walkthrough or `scripts/e2e-flow.ts`

## Environment Variables

Required in root `.env` (local) or Railway env vars (production):
```
DATABASE_URL          # PostgreSQL connection string
ANTHROPIC_API_KEY     # Claude API key
SOLANA_KEYPAIR_PATH   # Path to Solana keypair JSON (local)
SOLANA_KEYPAIR_JSON   # Solana keypair as JSON string (production — takes priority over PATH)
X402_RESOURCE_WALLET  # Wallet receiving x402 payments
TOKEN_41R_MINT        # 41R token mint address
SAS_CREDENTIAL_PDA    # SAS credential account
SAS_SCHEMA_PDA        # SAS schema account
```

R2 (screenshot storage, production only):
```
R2_ACCOUNT_ID         # Cloudflare account ID
R2_ACCESS_KEY_ID      # R2 API token access key
R2_SECRET_ACCESS_KEY  # R2 API token secret
R2_BUCKET             # Bucket name (default: 41rpm-screenshots)
R2_PUBLIC_URL         # Public CDN URL for the bucket
```

Optional:
```
API_PORT=4100
NEXT_PUBLIC_API_URL=http://localhost:4100
SKIP_PAYMENT_VERIFY=true    # Skip on-chain verification for demo
USE_X402_FALLBACK=false     # Use custom USDC verification instead of x402
CHROMIUM_PATH=/usr/bin/chromium  # Set in Docker for Stagehand
```

### Screenshots & File Storage
- Production: uploaded to Cloudflare R2 via `services/r2.ts` (S3-compatible API)
- Local dev: saved to `../../screenshots/` + served via Express static
- Frontend: check if URL starts with `http` → use directly, otherwise prefix with `API_BASE/screenshots/`
- Screenshot URLs in DB `test_reports.screenshots` are full R2 URLs in production

### Workspace Packages
- `packages/shared` and `packages/solana-utils` have `main` pointing to `dist/` (built output)
- Must build packages before API: `pnpm --filter @41rpm/shared build && pnpm --filter @41rpm/solana-utils build`

## Do NOT

- Commit `.env`, keypair files, or API keys
- Hardcode `localhost:4100` in frontend — use `API_BASE`
- Use `JSON.parse()` on LLM output — use `parseJsonSafe()` from `services/llm.ts`
- Add wallet signature verification (simplified for hackathon)
- Create new .md docs without explicit request
- Use `fs.writeFile` for screenshots in production — use `uploadToR2()` from `services/r2.ts`
- Assume local file paths work in Docker — use env vars for all external paths
