# 41R Persona Market — Project Guidelines

## Overview

AI Persona-driven product validation marketplace on Solana.
Human testers complete tests → earn USDC rewards → generate AI Personas → Personas run autonomous browser tests.

## Architecture

```
apps/api             (Express :4100)  — routes, services, x402, Solana, Stagehand runner
apps/web             (Next.js :3000)  — app-router pages + /experiment dashboard
apps/persona-engine  (FastAPI :4200)  — Python wrapper over persona_agent, scoring adapters
packages/shared            — TypeScript interfaces (@41rpm/shared)
packages/solana-utils      — Token-2022 utilities (@41rpm/solana-utils)
packages/persona-client    — TypeScript client for persona-engine HTTP
scripts/                   — setup / seed / batch / usage-summary / render-check
```

`persona-engine` depends on upstream `persona_agent` (separate repo at
`/Users/freddie/dev/repo/personal/41r-advisor/persona_agent`). Keep both
in sync when editing browser_runner / agent_loop.

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
pnpm --filter web dev       # Web only — prefix with WATCHPACK_POLLING=true on macOS (see Local Dev Gotchas)
pnpm --filter api test      # Run vitest (98 tests)
pnpm --filter api db:generate  # Emit a new versioned migration from schema changes → apps/api/drizzle/*.sql
pnpm --filter api db:migrate   # Apply pending migrations to DATABASE_URL (preferred for Railway deploys)
pnpm --filter api db:push      # Dev only: push schema directly, bypassing migration files
pnpm tsx scripts/seed-data.ts              # Base seed (5 hand-written + 2 tests)
pnpm tsx scripts/append-diverse-personas.ts  # +15 diverse profiles (total 20 personas)
pnpm tsx scripts/run-persona-batch.ts --limit N   # Batch persona runs (default mode=text)
pnpm tsx scripts/usage-summary.ts          # Analyze /tmp/llm-usage.jsonl
```

### persona-engine (Python)
```bash
cd apps/persona-engine
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 4200 --app-dir .
# Requires Python 3.11+ and persona_agent installed via pip install -e
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
- Vitest for API unit tests (`apps/api/src/__tests__/`) — 59 tests
- Pytest for persona-engine (`apps/persona-engine/tests/`) — 35 tests
- No frontend tests (hackathon scope)
- E2E: `scripts/e2e-persona-engine.ts` (autotest+engine+DB path)
- Dashboard render check: `scripts/check-dashboard-render.py` (headless chromium)

## Autotest Modes (`POST /api/autotest/run`)

Route table (default is now **stagehand_hybrid** as of 2026-04-19):

| `mode` value                            | Path                          | Cost/run | Use case                     |
|-----------------------------------------|-------------------------------|----------|------------------------------|
| `"browser"` / `"hybrid"` / (omitted)    | stagehand_hybrid              | ~24¢     | **Default** — deep UX reports |
| `"text"`                                | persona-engine text mode      | ~5¢      | Bulk experiments, fast       |
| `"persona_agent"` / `"persona_agent_browser"` | persona_agent native browser | ~17¢     | Persona-fidelity research    |

- **stagehand_hybrid**: Node-side Stagehand drives Playwright, persona-engine
  `/analyses/score` runs checklist/questionnaire/report adapters. Produces
  actionable pain_points tied to real UI elements.
- **persona_agent native**: In-process vision+decision loop with patience
  budget. Kept for research but trips mid-flow on complex SPAs.
- Legacy `services/autotest.ts` path still exists when `USE_PERSONA_ENGINE=0`.

## Experiment Dashboard

- `/experiment` — list of active tests with manual/persona/paired counts
- `/experiment/[testId]` — 6 charts + Key findings + By-cohort breakdown
- `/api/reports/compare/:testId` — aggregates headline + cohort metrics + findings
- Cohort key defaults to `crypto_experience` (4 buckets). Matching personas to
  humans within same demographic reveals "persona ≈ human at 100% in novice
  cohort, diverges in expert cohort" — the real investor story.

## LLM Usage Tracking

- Unified JSONL log at `USAGE_LOG_PATH` (default `/tmp/llm-usage.jsonl`)
- Python side: `apps/persona-engine/usage_logger.py` monkey-patches
  `anthropic.Messages.create`; tag routes via `with_route("...")` + request
  ids via `with_request_id(...)`
- Node side: `apps/api/src/services/anthropic_client.ts` wraps the SDK via
  AsyncLocalStorage; tag via `withRoute('...', () => client.messages.create(...))`
- `scripts/usage-summary.ts` — totals by model/service/route, heaviest calls,
  duplicate-prompt detection

## Cost Optimization Notes (persona-engine)

- `structured_report` uses tier `review_inspection` (Haiku) with
  `max_tokens=1400` — lower cap (800) truncated JSON. See
  `apps/persona-engine/report_generator.py`.
- `persona_agent.browser_runner` resizes screenshots to 900px long-side
  before sending to vision LLM (`PERSONA_AGENT_VISION_MAX_DIM`).
- `persona_agent.agent_loop._decide` uses Anthropic prompt caching —
  stable prefix (persona soul + plan + system) marked
  `cache_control: ephemeral`. Disable via `PERSONA_AGENT_PROMPT_CACHE=0`.
- `persona_agent.agent_loop._summarize_page` caps a11y tree at 20 nodes
  (was 50) via `PERSONA_AGENT_A11Y_NODES`.

## Local Dev Gotchas

- **macOS EMFILE "too many open files" on Next.js**: raise ulimit and
  force polling:
  ```bash
  ulimit -n 65536
  WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=true pnpm --filter web dev
  ```
- **Python 3.11+ required** for persona-engine (pydantic `dict | None` syntax).
  If you see `TypeError: unsupported operand type(s) for |`, install 3.11
  via `brew install python@3.11`.
- **TypedDict in persona-engine/adapters/tester_to_soul.py** must come from
  `typing_extensions` (not `typing`) for pydantic v2 on py<3.12.
- **persona_agent workspace** must be configured before any `_internal`
  import — see `apps/persona-engine/main.py` top-of-file setup.

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
- Instantiate Anthropic client directly in `apps/api` — use `client` + `withRoute`
  from `services/anthropic_client.ts` so usage tracking keeps working
- Change `mode=browser` default without measuring cost/quality on both paths —
  the stagehand_hybrid default came from an A/B run (see feature/event-hardening
  branch history)

## Investor Dashboard Narrative

The "persona ≈ human" claim only holds **within matched demographic cohorts**.
Headline Spearman ρ can be weak or negative because the sample mixes cohorts
with different agent-capability patterns. Always surface `by_cohort` numbers
alongside aggregates — the honest finding is:

> In the novice crypto-experience cohort, personas match humans at 100% item
> agreement and |Δ|=0.25 on quality. In the advanced cohort the gap widens to
> |Δ|=1.69. Persona simulation quality varies by user type — this is itself
> the product insight.

Keep this framing in mind when adding features or running experiments. Do not
pitch a single aggregate ρ number without the cohort context.
