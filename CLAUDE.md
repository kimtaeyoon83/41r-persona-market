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
- Design system: Hi-Fi dark theme built on OKLCH neutrals + Solana brand accent
  (sol-green #14F195, sol-purple #9945FF, sol-blue #00C2FF). All primitives and
  tokens are defined in `app/globals.css` — do not introduce one-off styles
  when a utility class already covers the need.
- Fonts: **Inter Tight** (display, `-0.025em` tight tracking) + **Inter** (body)
  + **JetBrains Mono** (money / addresses). Font CSS variables are
  `--font-display-loaded`, `--font-sans-loaded`, `--font-mono-loaded`, piped
  through `--font-display` / `--font-sans` / `--font-mono` so `TweaksPanel`
  can swap the display face at runtime.
- Wallet: Phantom via `components/wallet-provider.tsx`, `useWalletContext()`
  hook. Exposes `publicKey`, `connected`, `connect()`, `disconnect()`,
  **`signMessage(message)`** returning base58 signature.
- Role awareness: `useAppRole()` from `components/sidebar.tsx` returns
  `{role: 'company' | 'tester', setRole}`. Persists in localStorage
  (`sidebar:role`) and fires `41r:role` CustomEvent on change so pages like
  Home KPI dashboard can react. Sidebar nav is role-filtered; use this hook
  when a page needs to branch on role.

### Design tokens / utility classes
Declared in `app/globals.css`. Prefer these over ad-hoc Tailwind combos:
- Cards: `.hf-card` (bg-1 + line-1 border + r-4) · `.hf-card-inset` (bg-2 + r-3)
- Buttons: `.hf-btn` + `.primary` / `.ghost` / `.sm` / `.lg` (32px base height,
  primary has accent glow ring)
- Chips: `.chip` + `.accent` / `.success` / `.warn` / `.danger` / `.info` /
  `.ghost` (22px pill, line-1 border). `.chip-dot` for the leading pulse dot.
- Type scale: `.t-display-xl|l|m|s` (56 / 40 / 28 / 20 px), `.t-body-l|''|s`,
  `.t-caption`, `.t-label` (11px uppercase tracked)
- Numbers + wallet: `.money` (JetBrains Mono, tabular-nums), `.addr` (11px mono
  with fg-2 muted color)
- Colors: `--bg-0..4` (5 neutral steps), `--line-1/2`, `--fg-0..4`,
  `--accent` / `--accent-soft` / `--accent-line`, semantic
  `--success` / `--warn` / `--danger` / `--info` with `-soft` + `-line` variants
- Legacy aliases (`--bg-surface`, `--text-primary`, `--border-dim`, …) still
  resolve to the new tokens — safe to delete when you touch a given file.

### Shared primitives
- `components/topbar.tsx` — hairline page header (title + subtitle + actions
  + eyebrow chip). Drop into any page that needs a consistent title slot.
- `components/var-tabs.tsx` — `01 Label / 02 Label` layout switcher (used on
  Home, company test detail).
- `components/persona-radar-20.tsx` — flattens persona.vector (test_style +
  expertise + feedback_pattern + reliability) into a 20-axis polygon.
- `components/tweaks-panel.tsx` — floating settings card (accent hue, font,
  density, radius). Toggled from sidebar footer, persists to localStorage
  (`41r:tweaks`).
- `components/dev-demo-banner.tsx` — amber "Dev / Demo — not production flow"
  banner for `/x402` and `/autotest-bsc`.

### Solana Integration
- Network: devnet
- 41R Token: Token-2022 with 5% transfer fee (mint in TOKEN_41R_MINT env)
- USDC: devnet mock mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals)
- x402: payment-gated endpoints via `middleware/x402.ts` ($0.001 ~ $0.10)
- SAS: on-chain attestation with fallback to local demo IDs
- Keypair: loaded from `SOLANA_KEYPAIR_JSON` env var (production) or `~/.config/solana/id.json` (local)

### Auth / signed requests (important)
Mutating routes (`POST /api/tester/register`, `PUT /api/tester/:wallet`,
`POST /api/report/submit`, `POST /api/test/register`) require a wallet-signed
nonce. Pattern:

```ts
// client (apps/web/lib/api.ts)
await signedRequest('/api/...', { method: 'POST', body }, { wallet, signMessage })
// under the hood:
//  1. GET /api/auth/nonce?wallet=...  → { nonce, expiresAt }
//  2. signMessage(nonce)              → base58 signature
//  3. POST with x-wallet-address, x-nonce, x-signature headers
```

- **Do not** POST to signed routes without going through `signedRequest`.
  `request()` in `lib/api.ts` preserves Content-Type when callers pass their
  own headers — regression reproducer in `/tmp/e2e-flows.py`.
- Server side: `middleware/auth.ts` `requireSignedRequest` verifies ed25519 +
  single-use nonce (5-min TTL). Handlers additionally assert
  `req.signedWallet === body.walletField` where applicable.
- Schemas: every signed POST has a Zod schema in `apps/api/src/schemas/`
  applied via `validateBody(schema)` in the route chain (after
  `requireSignedRequest`, before the handler).

### E2E test hooks (dev only)
- `__E2E_BYPASS_DEPOSIT=1` in localStorage: on `/company/register` and
  `/autotest`, skip the Solana USDC round-trip (signTransaction +
  confirmTransaction). Uses a synthetic payment_tx. Gated behind
  `NODE_ENV !== 'production'` so it's dead code in prod builds.
  Useful for browser E2E that can't easily mock web3.js internals.

### Testing
- Vitest for API unit tests (`apps/api/src/__tests__/`) — **98 tests**
  (auth, cors, env, schemas, settlement-worker + prior suites)
- Pytest for persona-engine (`apps/persona-engine/tests/`) — 35 tests
- Browser E2E harness at `/tmp/e2e-flows.py` (Phantom mock via tweetnacl +
  playwright). Covers tester register → report submit → persona generate
  → company register → AutoTest (5 flows, 22/22 assertions).
- Legacy API-only E2E: `scripts/e2e-flow.ts` (updated to generate real
  keypairs + sign nonces).
- Dashboard render check: `scripts/check-dashboard-render.py` (headless
  chromium) and `scripts/check-experiment-index.py`.

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

## Security / Observability / Settlement (Phase 0 + 1 hardening)

- **Wallet signature verification** — all mutating routes gated by
  `middleware/auth.ts` (ed25519 + single-use 5-min nonce). See §Auth above.
- **CORS allowlist** — `config/cors.ts`. Defaults allow localhost:3000/3001,
  127.0.0.1:3000/3001, the Railway web URL. Override via
  `CORS_ALLOWED_ORIGINS` (comma-separated).
- **Rate limiting** — `middleware/rate-limit.ts` keys by wallet (signedWallet
  → route params → body wallet → IP). Autotest 2/min, reportSubmit 5/min,
  LLM-generation routes 10/min.
- **Zod body validation** — `schemas/index.ts` + `validateBody()`. Every
  signed POST has a schema, applied right after `requireSignedRequest`.
- **Env flag safety** — `config/env.ts` forces `SKIP_PAYMENT_VERIFY=false`
  when `NODE_ENV === 'production'` regardless of env input. Boot log prints
  `[env] NODE_ENV=... · payment verify: ENABLED/SKIPPED · x402 mode: …`.
- **Structured logging** — `apps/api/src/logger.ts` exports a pino instance
  (+ `childLogger(bindings)`). Railway surfaces JSON logs cleanly. Replace
  remaining `console.*` as you touch files.
- **Deep health** — `GET /api/health?deep=1` pings DB + persona-engine +
  Solana RPC with per-dep latency (`services/health.ts`). 503 when any dep
  is down. Basic `/api/health` stays synchronous + cheap.
- **Settlement worker** — exponential backoff 30s → 1m → 5m → 15m cap,
  24h MAX_AGE terminal marker (`services/settlement-worker.ts`). Runs in
  background; disable via `SETTLEMENT_WORKER_DISABLED=1` for tests.
- **DB migrations** — `apps/api/drizzle/` holds versioned SQL. Use
  `pnpm --filter api db:migrate` for Railway deploys. `db:push` is dev-only.

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

Persona-engine (required when `USE_PERSONA_ENGINE=1`):
```
USE_PERSONA_ENGINE=1                     # route autotest through persona-engine
PERSONA_ENGINE_URL=http://127.0.0.1:4200 # or the Railway internal URL
PERSONA_ENGINE_WORKSPACE=/tmp/persona-jobs   # writable path for job artifacts
```

Optional:
```
API_PORT=4100
NEXT_PUBLIC_API_URL=http://localhost:4100
CORS_ALLOWED_ORIGINS=...    # comma-separated; overrides the default allowlist
SKIP_PAYMENT_VERIFY=true    # Local dev only — auto-forced to false in production
USE_X402_FALLBACK=false     # Use custom USDC verification instead of x402
CHROMIUM_PATH=/usr/bin/chromium  # Set in Docker for Stagehand
LOG_LEVEL=info              # pino level (default: info in prod, debug in dev)
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
- ~~Add wallet signature verification~~ — wallet signature IS required now on all
  mutating routes. Don't disable it or bypass `requireSignedRequest` middleware.
- Call `request()` in `lib/api.ts` with custom headers and forget about
  `Content-Type` — the helper preserves explicit headers but caller-provided
  options must not override it. `signedRequest` already handles this.
- Create new .md docs without explicit request
- Use `fs.writeFile` for screenshots in production — use `uploadToR2()` from `services/r2.ts`
- Assume local file paths work in Docker — use env vars for all external paths
- Instantiate Anthropic client directly in `apps/api` — use `client` + `withRoute`
  from `services/anthropic_client.ts` so usage tracking keeps working
- Change `mode=browser` default without measuring cost/quality on both paths —
  the stagehand_hybrid default came from an A/B run (see feature/event-hardening
  branch history)
- Remove the `result: {...}` nested field from the synchronous `/api/autotest/run`
  response — the UI's completion panel reads it. The top-level flat fields
  exist for other consumers but the nested one is what drives the screen.
- Remove the `__E2E_BYPASS_DEPOSIT` branches from `/company/register` or
  `/autotest` without replacing the browser E2E strategy — the test harness
  in `/tmp/e2e-flows.py` depends on them. They are guarded by
  `NODE_ENV !== 'production'` so they compile out of prod bundles.
- Add ad-hoc `bg-surface border border-border-dim` card styles — use
  `.hf-card` / `.hf-card-inset`. Same for chips (`.chip.<variant>`) and
  buttons (`.hf-btn`). Migrating older pages to these classes is always
  a safe follow-up.

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
