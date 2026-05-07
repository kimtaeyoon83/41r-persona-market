# 41R Persona Market — Project Guidelines

## Overview

AI Persona-driven product validation marketplace on Solana.
Human testers complete tests → earn USDC rewards → generate AI Personas → Personas run autonomous browser tests.

## Architecture

```
apps/api             (Express :4100)  — routes, validator pipeline, Solana sponsored tx
apps/web             (Next.js :3000)  — app-router pages (/, /validator/*, /me/*)
apps/persona-engine  (FastAPI :4200)  — legacy Python service (not invoked by validator)
packages/shared            — TypeScript interfaces (@41rpm/shared)
packages/solana-utils      — Token-2022 utilities (@41rpm/solana-utils)
packages/persona-client    — legacy TypeScript client for persona-engine HTTP
packages/contracts         — Solana program / IDL stubs
scripts/                   — seed / migration / backfill / usage-summary
```

`apps/persona-engine` and `packages/persona-client` are leftovers
from the autotest era; the validator pipeline (Mode A / Mode B
scans) does not call persona-engine. The directory is preserved
because the env vars `USE_PERSONA_ENGINE` and `PERSONA_ENGINE_URL`
still parse and a future workload may revive it. Treat as dormant.

## Deployment (Railway + Cloudflare R2)

```
Railway ─── API  (Docker) → https://api.project-rpm.xyz   (legacy: api-production-a4e7.up.railway.app)
        ├── Web  (Docker) → https://app.project-rpm.xyz   (legacy: web-production-8813d.up.railway.app)
        └── PostgreSQL    → internal connection

Cloudflare R2 ── Screenshots CDN → https://pub-d5db789b01364e288af930cfd54a666e.r2.dev
```

### Railway custom domain target port — **always 8080**
Railway injects `PORT=8080` into every container by default. Both `apps/api/src/index.ts`
(`process.env.PORT || process.env.API_PORT || 4100`) and Next.js standalone (`apps/web/server.js`)
honor that env, so the actual listen port is **8080**, not the `EXPOSE 4100` / `EXPOSE 3000`
in the Dockerfiles. When configuring custom domains in Railway dashboard → Networking → Custom
Domain, set **Target Port: 8080** (or leave blank for auto-detect). Setting it to 4100 / 3000
based on the Dockerfile's `EXPOSE` produces a 502 because the proxy routes to a port nothing
listens on. The auto-generated `*.up.railway.app` URLs work without configuration because
Railway auto-maps them to the listening port — that's why they hide this gotcha until you add
a custom domain. CORS for the custom domain is gated by `CORS_ALLOWED_ORIGINS` env on the api
service — current allowlist must include `https://app.project-rpm.xyz`. The web subdomain is
**`app`**, not `web` (typo we considered earlier).

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
pnpm --filter api test      # Run vitest (199 tests as of 2026-05-07)
pnpm --filter api db:generate  # Emit a new versioned migration from schema changes → apps/api/drizzle/*.sql
pnpm --filter api db:migrate   # Apply pending migrations to DATABASE_URL (preferred for Railway deploys)
pnpm --filter api db:push      # Dev only: push schema directly, bypassing migration files

# Validator seeds + maintenance
pnpm tsx scripts/seed-validator-cohorts.ts # 112 personas across 8 STANDARD_COHORTS
pnpm tsx scripts/seed-calibration.ts       # synthetic calibration_records (Validator §5)
pnpm tsx scripts/backfill-cohort-ci.ts [--dry-run]                 # bootstrap CI for legacy cohort rows
pnpm tsx scripts/backfill-site-classifier.ts [--dry-run] [--max N] # re-run classifier on placeholder scans
pnpm tsx scripts/update-validator-voice-samples.ts                 # in-place voice rewrite for existing personas
pnpm tsx scripts/usage-summary.ts          # analyze /tmp/llm-usage.jsonl
```

## Key Conventions

### Backend (apps/api)
- 5 active routes under `src/routes/`, mounted in `src/index.ts`:
  `auth.ts`, `scan.ts`, `calibration.ts`, `benchmark.ts`, `hello.ts`
- Active services in `src/services/`: `llm.ts`, `audience_fit.ts`,
  `scan_pipeline.ts`, `site_classifier.ts`, `site_capture.ts`,
  `cohort_selection.ts`, `anthropic_client.ts`, `aarrr.ts`,
  `dimension_simulator.ts`, `persona_wallets.ts`, `sponsored_tx.ts`,
  `fee_payer.ts`, `r2.ts`, `health.ts`, `benchmark.ts`,
  `dimensions/` (LLM dimension scorers + friction clustering),
  `calibration/` (calibration aggregator).
- Database: Drizzle ORM with PostgreSQL, schema in `src/db/schema.ts`,
  versioned migrations in `apps/api/drizzle/`
- LLM models: Claude Sonnet 4.6 (vision / generation), Claude Haiku 4.5
  (text scoring / classification)
- JSON from LLM: always use `parseJsonSafe()` from `services/llm.ts` —
  has a `repairJson()` fallback so partial-truncation responses survive
- Anthropic SDK: never instantiate directly in apps/api. Use `client`
  + `withRoute('label', () => client.messages.create(...))` from
  `services/anthropic_client.ts` so usage logging keeps working.
- Error pattern: try/catch in every route handler, 400/404/409/500
  responses with `{ error, ... }` body.

### Frontend (apps/web)
- Next.js 14 App Router. Active routes:
  `/`, `/validator/*`, `/me/wallet`, `/me/analyses`.
- Shared API URL: `import { API_BASE } from '@/lib/api'` — never hardcode.
- API client (`lib/api.ts`): primary surface is `scanApi` for
  `/api/scan/*` routes. `signedRequest()` helper still exists for any
  future wallet-signed mutation, even though most validator routes are
  Privy-authenticated (see Auth section).
- Auth provider: **Privy** (`@privy-io/react-auth`) wraps the app via
  `apps/web/app/providers.tsx`. Single auth layer for Email / Google /
  Phantom / Solflare / Discord / X login + optional embedded Solana
  wallet. `defaultSolanaRpcsPlugin()` is registered so chain-aware
  signing on `solana:devnet` works.
- Loading / error UI: each page renders its own inline pattern (small
  text + retry button). No shared primitives.
- Components: `app-shell.tsx` is the only shared wrapper. Earlier
  shared components (sidebar, topbar, tweaks-panel, persona-radar-20,
  wallet-provider, etc.) were autotest-era and got cleaned up.
- Design system: Hi-Fi light theme on OKLCH neutrals + Solana brand
  accent. All primitives and tokens in `app/globals.css` — prefer
  the utility classes below over ad-hoc Tailwind combos.
- Fonts: **Inter Tight** (display, `-0.025em` tight tracking) +
  **Inter** (body) + **JetBrains Mono** (money / addresses). CSS
  variables `--font-display`, `--font-sans`, `--font-mono`.

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
- Mobile-only utilities (load-bearing — see Do NOT list below):
  `.v-page-pad`, `.v-stack-sm`, `.v-grid-stack-sm`, `.v-row-wrap`,
  `.hide-mobile` + the global `html, body { overflow-x: hidden }` rule.

### Solana Integration
- Network: devnet
- USDC: devnet mock mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
  (6 decimals). Sponsored 0-USDC tx is the validator scan payment
  pattern (see `services/sponsored_tx.ts` + `services/fee_payer.ts`).
- Keypair: `SOLANA_KEYPAIR_JSON` env var (production) or
  `~/.config/solana/id.json` (local).
- Persona wallets: HD-derived from `PERSONA_MASTER_MNEMONIC`. See
  `services/persona_wallets.ts::getPersonaAddress(hdIndex)`.

### Auth (Privy + middleware)
- Web: Privy is the single auth provider. `usePrivy()` gives
  `{ ready, authenticated, getAccessToken }`; `AuthBridge` in
  `providers.tsx` wires the access-token getter into `lib/api.ts`
  so every `request()` call attaches `Authorization: Bearer <token>`
  when logged in.
- API: `middleware/privy_auth.ts` exports `requirePrivyAuth` (reject
  if missing/invalid token) and `optionalPrivyAuth` (attach
  `req.privyUser` when present, otherwise pass through). `/api/scan`
  uses `optional` so anonymous landing-page demos still work.
- Legacy wallet-signed nonce path (`middleware/auth.ts` +
  `signedRequest()` in `lib/api.ts`) is preserved for any future
  signed mutation surface but currently has no live consumer routes.
  Don't remove it without confirming no follow-up sprint needs it.

### Testing
- Vitest at `apps/api/src/__tests__/` — **199 tests** as of 2026-05-07.
  Suites cover env validation, auth schema, audience-fit math,
  cohort selection, dimension LLM contracts (incl. the Q2 site-context
  + Q3 voice-cleanup regression locks), scan shapers, AARRR weighted
  funnel, friction clustering, site classifier, acquisition priors.
  LLM-touching tests mock `services/anthropic_client` via `vi.mock`
  so the prompt path runs without real API calls.
- Persona-engine (Python): `apps/persona-engine/tests/` — pytest.

## Audience-Fit Validator (`/validator/*` + `/api/scan/*`, audited 2026-05-02)

The current product. Measures **audience-fit** across 8 cohorts ×
5 dimensions via capture-and-score: one screenshot per scan, ~100
LLM persona reactions, weighted aggregate. Personas don't browse —
they react to a screenshot.

### Architecture

```
POST /api/scan                  apps/api/src/routes/scan.ts
  → scan_pipeline.ts             startScanWorker(scanId) — fire-and-forget
       Step 0 capturing           captureSite() — Playwright full-page screenshot
       Step 0.5                   classifySite() — Haiku vision: {category, confidence, one_line_pitch}
       Step 1 sampling            selectPersonasForCohorts(personas, cohortDefs)
                                    └─ filtered by scan.targetCohorts when set
       Step 2 responding          runPersonaResponseLLM() per persona
                                    Sonnet vision when USE_VISION=1, Haiku text otherwise
                                    writes scan_persona_responses (1 row per persona)
       Step 3 aggregating         dimension means → computeCohortFitScore()
                                    bootstrap CI → scan_cohort_results
                                    clusterFrictions() — Haiku theme clustering
                                    computeAudienceFit() — Option A formula
       completed                  scan row + cohort rows queryable via /report
```

### Two modes

- **Mode A — Discovery**: 8 STANDARD_COHORTS × 14 = ~112 personas. Headline
  `audience_fit_score` is a 4-component composite (Option A, see
  `services/audience_fit.ts`). When `target_cohorts` is set on the scan
  row, only that subset runs.
- **Mode B — Verification**: single audience parsed by Haiku from
  `target_audience_text` ("30s DeFi expert mobile-first" → CohortSelector
  jsonb). One bucket of ≤50 matching personas. Verdict thresholds per
  spec §1.3: ≥60 pass / 40-60 conditional / <40 fail.

### Pipeline math invariants (verified 2026-05-02)

These are the six contracts the audit locked in. **All audited at 0
mismatch across 1550 personas / 128 cohorts / 17 scans** — preserve
them:

1. `audience_fit_score = 0.4·best + 0.3·median + 0.2·task_global +
   0.1·sentiment_global` (Mode A, `services/audience_fit.ts`)
2. Mode B `audience_fit_score = cohort_fit_score` (single bucket, no
   blend) — `scan_pipeline.ts::runModeBPipeline`
3. Per-persona dims: `happiness = computeSusScore(sus_responses)`,
   `adoption = signup_likelihood × 100`, `task_success =
   completion_likelihood × 100`, `engagement = ENGAGEMENT_BAND_TO_SCORE`,
   `retention_d7 = RETENTION_BAND_TO_DCURVE.d7` — `services/dimensions/llm.ts`
4. Cohort dimension means = arithmetic mean of non-flagged persona scores
5. `cohort_fit_score = 0.30·eng + 0.30·tsk + 0.25·hap + 0.10·ado + 0.05·ret`
   (DIMENSION_WEIGHTS_V1)
6. `personas_completed = COUNT(NOT is_flagged)`, invariant
   **`attempted = completed + flagged`** holds across all 17 scans
   (post-A1 backfill 2026-05-02)

### Synthetic-persona trust contract (B2/B3 retro 2026-05-02)

The 112 seed personas (`scripts/seed-validator-cohorts.ts`) are
deliberately **labeled** as synthetic. Don't make them look more real
than they are:

- `personaAgeFromGroup(ageGroup)` returns the **bucket center**
  (16/25/35/58). The persona vector only stores categorical
  `age_group`; do not derive a per-persona age via hash jitter, even
  when it makes cards look less repetitive (B2 anti-pattern, reverted).
- `personaDisplayName(rawName, role, personaId)` substitutes
  pool names ("Jonas Bauer") only when `isSyntheticSeedName(rawName,
  role)` matches the seed pattern (`<role> #N`). Real tester
  displayNames pass through untouched.
- `ScanPersonaCard.is_synthetic: boolean` flags the substitution so
  PersonaBoard can render a small "synth" marker. Stakeholders see
  pool names AND the disclosure simultaneously — never just one.

### AARRR is CUMULATIVE (not independent filters)

`services/aarrr.ts::computeAarrrFromRows` filters cumulatively:
each stage's set is a subset of the previous. This guarantees a
monotonic non-increasing funnel shape. Independent thresholds (the
2026-05-01 prior version) could produce non-funnel shapes like
100→28→25→27→28 where Referral exceeded Activation. The pure compute
helper is exported for unit tests; `audience_fit_helpers.test.ts`
locks the monotonicity + threshold boundaries.

Thresholds (from percentile audit, 2026-05-02):
- Activation: task_success ≥ 30
- Retention: + retention_d7 ≥ 30
- Referral: + happiness ≥ 60
- Revenue: + adoption ≥ 65

### Friction clustering n invariant

`assembleFrictionClusters(items, parsed)` (pure, exported) appends
an "Other / long-tail frictions" bucket whenever the LLM left
input personas unassigned. The cluster `n` sum + long-tail bucket
**must equal `items.length`** — silently dropping 5-10% of friction
inputs (the prior behavior) breaks the report's friction count
across the top-N display.

### Site classifier (Phase 1C-D)

`services/site_classifier.ts::classifySite(targetUrl, screenshotUrls)`
is a single Haiku vision call after capture. Replaces the previous
hardcoded `category='DeFi', categoryConfidence=0.5, oneLinePitch=null`
placeholder. Cost ~$0.0008/scan. Schema: 12 category enum + 0-1
confidence + ≤160 char pitch. Failure returns null; caller leaves
the row's existing nulls (report header conditionally hides empty
pitch/benchmark).

### Backfill scripts (operator-run, idempotent)

- `scripts/backfill-cohort-ci.ts` — recompute bootstrap CI for legacy
  cohort rows whose `cohort_fit_ci_low/high` are null.
- `scripts/backfill-site-classifier.ts` — re-run Haiku classifier on
  scans matching the placeholder triple
  (`category='DeFi' AND category_confidence=0.5 AND one_line_pitch IS NULL`).
  Default `--max 25`. Skips rows without cached screenshots.

Both filter-on-shape and refuse to overwrite already-good data, so
re-runs are no-ops once backfilled.

### Pure-helper extraction pattern

For new pipeline code that mixes DB I/O, LLM calls, and business
rules: extract the pure compute into a helper (`computeAarrrFromRows`,
`assembleFrictionClusters`, `shapePersonaCard`, `shapePersonaDetailResponse`)
and leave the wrapper to do the I/O. The helper is exported for unit
tests; the wrapper stays unexported. `__tests__/audience_fit_helpers.test.ts`
+ `__tests__/scan_shapers.test.ts` are the canonical examples.

### Detail (`/validator/detail`) inputs are real

- **Q1 Target users** chips each carry a `cohort` id. Selection sends
  `target_cohorts: string[]` in the createScan body, which becomes the
  `audience_fit_scans.target_cohorts` jsonb column. The pipeline filters
  STANDARD_COHORTS to that subset before assignment. Empty/null = run
  all 8.
- **Q2 Category** is intentionally a placeholder ("auto-detected during
  scan") — the real category lands from classifySite() at capture step.
- **Q3 Hypothesis** textarea is sent as `hypothesis` and flows end-to-
  end to `runPersonaResponseLLM()::buildUserPrompt`.
- "Skip" sends `target_cohorts: undefined` + `hypothesis: undefined` so
  the run uses defaults regardless of typed input.

### Report screen Mode B KPI structure

The 4 KPI cards differ between modes:
- Mode A: Best cohort fit / Worst cohort fit / Personas analyzed / Industry benchmark
- Mode B: **Audience fit / Verdict / Personas analyzed / Audience definition**

Mode B never shows best/worst/median (all equal by construction —
single bucket). The Audience fit value is `Math.floor(rawScore * 10)
/ 10` so 39.99 reads as "39.9" next to "<40 = FAIL" instead of "40.0
< 40" cognitive dissonance.

### Persona detail (`/validator/persona/[id]`) requires `?scan=`

`GET /api/scan/:scanId/persona/:personaId` returns `{scan, persona,
response}`. The page reads `?scan=<scanId>` from the query string;
without it, renders a "Missing scan context" warning. The report
screen's PersonaBoard always passes `scanId` so links from real
report cards always work.

The "Dimension snapshot" card (5 chips for Engagement / Task /
Happiness / Adoption / Retention D-7) is **NOT a page-step funnel** —
it's a per-axis score visualisation. The previous "Session journey"
label implied behavioural step tracking which we don't measure (spec
§4 measures outcomes, not journey actions). Don't reintroduce a
step-funnel framing without first adding the underlying capture.

### Empty `_session_video` analog

The validator pipeline does not record per-persona browser sessions
(it's not Stagehand-driven — single screenshot only). There's no
`_session_video` analog and no per-persona replay UI on
`/validator/persona/[id]`. The screenshot URL is on the scan row's
`captureScreenshotUrls` array; future per-persona replays would need
a new pipeline.

## LLM Usage Tracking

- Unified JSONL log at `USAGE_LOG_PATH` (default `/tmp/llm-usage.jsonl`)
- Python side: `apps/persona-engine/usage_logger.py` monkey-patches
  `anthropic.Messages.create`; tag routes via `with_route("...")` + request
  ids via `with_request_id(...)`
- Node side: `apps/api/src/services/anthropic_client.ts` wraps the SDK via
  AsyncLocalStorage; tag via `withRoute('...', () => client.messages.create(...))`
- `scripts/usage-summary.ts` — totals by model/service/route, heaviest calls,
  duplicate-prompt detection
- Route tags used by the validator pipeline (use these as
  filter keys in `usage-summary.ts`):
  `validator.classify_site` (Haiku vision, 1× per scan),
  `validator.parse_audience` (Haiku, Mode B only — 1× per scan),
  `validator.persona_response` (Sonnet vision when USE_VISION=1
  or Haiku text otherwise, 112× per Mode A scan / ~50× Mode B),
  `validator.cluster_frictions` (Haiku, 1× per scan).

## Local Dev Gotchas

- **macOS EMFILE "too many open files" on Next.js**: raise ulimit and
  force polling:
  ```bash
  ulimit -n 65536
  WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=true pnpm --filter web dev
  ```
## Security / Observability / Settlement (Phase 0 + 1 hardening)

- **Wallet signature verification** — all mutating routes gated by
  `middleware/auth.ts` (ed25519 + single-use 5-min nonce). See §Auth above.
- **CORS allowlist** — `config/cors.ts`. Defaults allow localhost:3000/3001,
  127.0.0.1:3000/3001, the Railway web URL. Override via
  `CORS_ALLOWED_ORIGINS` (comma-separated).
- **Rate limiting** — REMOVED in the 2026-05-07 autotest pivot
  cleanup. The previous `middleware/rate-limit.ts` exposed
  `autotestRunLimiter` / `reportSubmitLimiter` / `llmGenerateLimiter`,
  but all three target routes were removed by the validator pivot.
  Validator routes (`/api/auth`, `/api/scan`, `/api/calibration`,
  `/api/benchmark`) currently have NO rate limiting — see Known
  Limitations §9 below.
- **Zod body validation** — `schemas/index.ts` + `validateBody()`. Every
  signed POST has a schema, applied right after `requireSignedRequest`.
- **Env flag safety** — `config/env.ts` enforces production-only
  invariants at boot (e.g. mandatory secrets present, dev-only
  bypass flags forced off). Boot log prints
  `[env] NODE_ENV=... · LOG_LEVEL=... · persona-engine: on|off`.
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
ANTHROPIC_API_KEY     # Claude API key (Sonnet + Haiku)
SOLANA_KEYPAIR_PATH   # Path to Solana keypair JSON (local)
SOLANA_KEYPAIR_JSON   # Solana keypair as JSON string (production — takes priority over PATH)
PERSONA_MASTER_MNEMONIC   # BIP-39 mnemonic for HD-derived persona wallets
PRIVY_APP_ID          # Public Privy app id (also embedded in client bundle)
PRIVY_APP_SECRET      # Privy server secret (validates access tokens)
NEXT_PUBLIC_PRIVY_APP_ID   # Mirrors PRIVY_APP_ID for the web bundle
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
CORS_ALLOWED_ORIGINS=...    # comma-separated; overrides the default allowlist
USE_VISION=1                # Use Sonnet vision for persona response (otherwise Haiku text)
USE_SIMULATOR=0             # Skip LLM, use synthetic responses (dev iteration)
ADMIN_API_KEY=...           # Gates /api/admin/* (≥12 chars; absent ⇒ 404)
LOG_LEVEL=info              # pino level (default: info in prod, debug in dev)
```

Dormant (parsed but not used by the validator pipeline):
```
USE_PERSONA_ENGINE=0        # legacy autotest routing flag
PERSONA_ENGINE_URL=...      # legacy persona-engine FastAPI base URL
```

### Screenshots & File Storage
- Production: uploaded to Cloudflare R2 via `services/r2.ts` (S3-compatible API)
- Local dev: saved under `/tmp/site-captures/` + served via Express static
- Frontend: check if URL starts with `http` → use directly, otherwise prefix with `API_BASE`
- Validator scan screenshots are stored in `audience_fit_scans.captureScreenshotUrls` (jsonb array of full URLs)

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
- Add ad-hoc `bg-surface border border-border-dim` card styles — use
  `.hf-card` / `.hf-card-inset`. Same for chips (`.chip.<variant>`) and
  buttons (`.hf-btn`). Migrating older pages to these classes is always
  a safe follow-up.
- Reintroduce per-persona age jitter in `personaAgeFromGroup`. The
  persona vector only stores categorical `age_group`; jittering by
  `personaId` hash invents data the system doesn't measure. Identical
  ages within a cohort are an honesty signal, not a UX bug. The B2
  retro 2026-05-02 reverted this; see Audience-Fit Validator §
  "Synthetic-persona trust contract".
- Drop the `is_synthetic` flag on `ScanPersonaCard` or the "synth"
  marker in PersonaBoard. Pool names like "Jonas Bauer" without that
  marker read as real users to a stakeholder watching a demo. The
  pool + marker combo is the contract — they ship together.
- Make AARRR threshold filters independent again in `services/aarrr.ts`.
  Each stage MUST be a cumulative subset of the previous so the
  funnel is monotonically non-increasing. Independent filters
  produced 100→28→25→27→28 on uniswap (Referral exceeded Activation —
  not a funnel). `audience_fit_helpers.test.ts` locks this via the
  "monotonically non-increasing" + "passing referral implies passing
  all earlier stages" cases.
- Drop the long-tail bucket from `assembleFrictionClusters`. The
  invariant that cluster `n` sum + long-tail equals `items.length`
  is what stops the report from silently losing 5-10% of friction
  inputs. The "n sum + long-tail equals input" test in
  `audience_fit_helpers.test.ts` is the lock.
- Hardcode `category: 'DeFi', categoryConfidence: 0.5, oneLinePitch:
  null` back into `scan_pipeline.ts`. The Phase 1C-D Haiku
  classifier (`services/site_classifier.ts`) is the source of truth.
  If the call fails, leave the row's existing nulls — the report
  screen conditionally hides empty pitch/benchmark.
- Filter persona cards (`fitRows`/`nonFitRows` in `routes/scan.ts`)
  without the `is_flagged=false` + `isNotNull(happinessScore)`
  predicates. Without them, flagged rows surface with `score=0` and
  the persona's static `voice_sample` as the quote — broken cards.
  See `scan_shapers.test.ts::shapePersonaCard` "returns score=null
  when all dimensions are null" for the related null-score lock.
- Filter the persona detail endpoint or report cards by `cohortId =
  'custom_audience'` for Mode B and assume Mode A. Mode B's single
  bucket uses the literal cohort_id `'custom_audience'`; the
  PersonaCard `role` lookup falls back to that string when
  `COHORT_BY_ID` returns undefined. Don't special-case it elsewhere.
- Send `target_users` selection from `/validator/detail` as a
  hypothesis prefix instead of a real `target_cohorts` array. The
  prior "audiences in hypothesis text" plumbing is gone — the
  pipeline filters STANDARD_COHORTS by id when `target_cohorts` is
  set. The chips on Detail carry cohort ids for exactly this.
- Restore `/validator` as a duplicate Mode A/B toggle entry point.
  Phase 4 IA cleanup made `/` (`apps/web/app/page.tsx`) the single
  entry — Mode toggle, hero, feeds, audience input all live there.
  `apps/web/app/validator/page.tsx` is intentionally a `redirect("/")`
  stub (8 lines) so bookmarks + legacy "Verify Mode B" links keep
  working. Reintroducing the toggle on `/validator` brings back the
  two-entry-point confusion that drove the consolidation.
- Re-add Discovery / Pro mode / Report / Calibration nav items to
  the validator TopBar. Pro/Report were dead links (no
  `/validator/pro` page, `/validator/report/demo` resolved a literal
  "demo" scanId), Discovery duplicated `/`, and Calibration is an
  internal/dev surface the report footer link is enough for. Current
  TopBar is `[41R logo → /]  [Sign in | My Analyses · Sign out]` —
  keep it that minimal.
- Restore the Weight Evolution chart on `/validator/calibration`.
  It rendered hardcoded `DEFAULT_VERSIONS` from
  `services/calibration/aggregator.ts` (spec §5.4 example values v1.0
  → v1.3) that don't match the v1 weights `services/audience_fit.ts`
  actually uses. The chart implied quarterly retraining had happened
  when in fact every score still uses v1.0. Phase 2-C-2 retraining
  cron + a real `calibration_versions` history table must land first.
- Change the formulas / weights / thresholds on
  `/validator/how-it-works` without updating
  `services/audience_fit.ts` + `services/dimensions/llm.ts` +
  `services/aarrr.ts` in the same commit. The methodology page is
  the public source-of-truth contract — drift between page and code
  breaks the "no black box" promise. The math invariants test suite
  (`__tests__/audience_fit_helpers.test.ts`) is the lock; if a number
  on the page doesn't appear in the code or the tests, it's stale.
- Remove `.v-page-pad` / `.v-stack-sm` / `.v-grid-stack-sm` /
  `.v-row-wrap` / `.hide-mobile` from `apps/web/app/globals.css`, or
  the `html, body { max-width: 100%; overflow-x: hidden }` rule.
  Every detail page (report, processing, persona, calibration,
  survey, me/analyses, how-it-works) leans on these for phone
  layout. Removing the overflow-x clip specifically re-breaks the
  Privy login modal on mobile — the modal anchors to a viewport that
  drifts horizontally when document width exceeds viewport.
- Drop the `viewport` export from `apps/web/app/layout.tsx`. Next 14
  ships no viewport meta without it, so iOS Safari / Android Chrome
  fall back to the 980px desktop viewport and Privy's modal renders
  at desktop scale on a phone screen. The export is required, not
  cosmetic.
- Hardcode KPI / cohort / persona feeds back into `apps/web/app/page.tsx`.
  All Recent / Top / Live data must read from `scanApi.getRecent()`
  / `getTop()` / `getLive()`. Mode A → `/validator/detail` and Mode
  B → `POST /api/scan` flows live in `onAnalyze` — the `?mode=B`
  query param flips the initial toggle so legacy "Verify Mode B"
  links keep landing in the right state.
- Edit the 96 entries in `packages/shared/src/acquisition_priors.ts`
  without keeping the `arrival_share` sum = 1.0 ± 0.01 invariant per
  category. The 14 invariant tests in
  `__tests__/acquisition_priors.test.ts` are the lock — weighted
  aggregates produce nonsense if any category's arrival shares don't
  normalize. Same for `abandon_rate` ∈ [0, 1]. Refining a prior
  value is fine; breaking the sum is not.
- Promote the report page default view from "panel" to "visitor"
  before n≥5 sites with shared GA validate the heuristic priors. The
  v1.0 prior table is *educated guess*, not measured calibration.
  Until validated, "panel" stays default and "visitor" is opt-in via
  the toggle. The Reality Check card on `/validator/calibration`
  documents the n=1 (Merch Store) baseline + the gap-closure %.
- Drop or replace `applyAcquisitionWeights` /
  `computeWeightedAudienceFit` / `computeAarrrWeightedFromRows`
  without keeping the `result.weighted` + `aarrr_weighted` API
  contract intact. The web `ScanReport` type marks both as optional/
  nullable, but the report page's `effectiveResult` /
  `effectiveAarrr` derived state silently falls back to the panel
  view only when those fields are explicitly null — flipping the API
  to omit them entirely breaks the toggle UI.
- Move the AARRR thresholds back to the v1.0 baseline
  (retention ≥ 30, revenue/adoption ≥ 65) without re-validating the
  persona output distribution. The 2026-05-06 retune to
  retention ≥ 5 + adoption ≥ 30 came from observing that ~85% of
  personas land in the retention "weak" band (D7=5) and ~95% have
  adoption < 65, so the old gates killed the cumulative funnel
  post-activation. The retune was the fix for the
  "Retention/Referral/Revenue all 0%" bug Stage 5 surfaced.
  Per-category re-tuning (Phase 2-C-2) will eventually derive these
  from real outcomes; until then, ≥5 / ≥30 are the v1.1 baselines
  that produce a meaningful 5/5 funnel.
- Conflate `audience_fit_score` (panel) with
  `result.weighted.audience_fit_score` (visitor) in marketing copy.
  These measure different things — panel is persona-conditional
  ("if 8 cohorts engage with this site, who resonates?"); visitor
  weights cohorts by site-realistic arrival shares ("if real visitor
  traffic hit this site, what's the net audience fit after the
  abandon population?"). Calibration showed visitor lands closer to
  GA4 reality but a ~10× intent-action gap remains, fundamental to
  persona-conditional measurement. Mixing the two in a single number
  reintroduces the "black box" framing the methodology page rejects.
- Skip the `getAcquisitionPriorsFor()` confidence floor. The 0.5
  `CONFIDENCE_FLOOR` exists so a low-confidence site classifier
  (`category_confidence < 0.5`) doesn't drive aggressive cohort
  weights via priors that may not apply. Falling back to the 'Other'
  prior (flat-ish distribution, moderate abandon) preserves the
  weighted feature for these scans without inventing strong claims.
- Render Retention / Referral / Revenue stages as %-confidence
  predictions. Even after the v1.1 threshold retune (5/5 stages
  non-zero), the visitor-weighted absolute values still overshoot
  GA4 reality by ~5-30× (e.g. visitor revenue 31.9% vs GA4 1.6% for
  Merch Store). They are *relative ranking signals across sites*,
  not traffic forecasts. The `PERSONA-CONDITIONAL` warning banner
  above the AARRR funnel + the "What this measures (and doesn't)"
  §00 on `/validator/how-it-works` are the load-bearing caveats —
  keep them when iterating.
- Drop the `siteContext` parameter from `runPersonaResponseLLM` /
  `buildUserPrompt` (`apps/api/src/services/dimensions/llm.ts`).
  Without it, persona prompts only see the raw URL string + their
  own crypto-tilted voice_sample and routinely hallucinate wallet/
  DeFi features on non-crypto sites — the Google Merch case
  2026-05-07 had a Korean long-tail bucket quote "지갑 연결이
  필수인데 초보자한테는 진입 장벽이 너무 높아요" on a plain
  e-commerce site. `scan_pipeline.ts` threads
  `{category, categoryConfidence, oneLinePitch}` from the scan row
  into both Mode A and Mode B persona handlers; classifier output
  must reach the persona, not just the report header.
- Reintroduce crypto-specific vocabulary in `VOICE_BY_COHORT`
  (`scripts/seed-validator-cohorts.ts`). The 2026-05-07 cleanup
  rewrote crypto_native / web3_pro / defi_beginner voice_samples
  to be category-agnostic (security_aware, detail_oriented,
  fast-mover traits survive; "slippage / MEV / multi-chain / gas /
  signing" vocabulary doesn't). Voice is the dominant tone signal
  the persona LLM picks up — putting "Slippage and MEV signaling
  matter most" back means crypto cohorts will parrot crypto framing
  on non-crypto sites again. If you re-seed, also run
  `scripts/update-validator-voice-samples.ts` to update existing
  persona rows in place (the seed script is `ON CONFLICT DO
  NOTHING` — it skips existing rows).
- Set `n_passing: 0` literally for visitor-weighted AARRR stages
  in `services/aarrr.ts::computeAarrrWeightedFromRows`. Previously
  the comment "weighted view has no meaningful integer count"
  justified zero, but the UI rendered "0 / 111" next to the score%
  and made the funnel look broken (2026-05-07 user report).
  `n_passing` is now derived as `Math.round((score/100) ×
  totalPersonas)` — an explicit *visitor-equivalent estimate* —
  so panel and visitor cards read with the same "X of Y" pattern.
  Score values unchanged.
- Reintroduce additional `<link rel="icon">` PNG entries in
  `apps/web/app/layout.tsx::metadata.icons.icon`. The 2026-05-07
  favicon fix dropped the redundant `/favicon.png` and
  `/logo/rpm_black_vertical.png` entries. The vertical wordmark
  was a 500×500 file shared with `public/favicon.png` (verified
  identical via `diff -q`); its `sizes="any"` hint won the 16×16
  tab slot, downscaling to an illegible black bar. Next.js
  auto-detects `app/favicon.ico` (multi-size 16/32/48/256) and
  emits the correct single `<link rel="icon">`. Keep
  `metadata.icons.apple` only — iOS home-screen icons render large
  enough to display the vertical wordmark legibly.
- Frame the AARRR funnel as a conversion forecast in UI copy or
  marketing. The 5-site 2026-05-07 multi-category test showed the
  visitor-weighted view collapses to nearly identical absolute %s
  (Activation spread 13pt, Revenue spread 1.3pt) across very
  different categories — a structural limit of the universal
  `INTENT_ACTION` multipliers (0.50/0.20/0.10/0.05) calibrated on
  Merch n=1. The report page now leads with a **"BIGGEST LEAK"**
  callout that names the largest stage-to-stage drop, and renders
  per-stage `▼ X pt` chips so the bottleneck is visually obvious.
  The visitor-toggle sub is `"experimental — directional only,
  not a traffic forecast"`. Don't soften that copy or restore the
  earlier `"v1.1 priors"` label — the honest framing protects the
  product against being misread as a GA4 substitute.

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

The validator's analogous trust contract (audited 2026-05-07) is the
**bottleneck-diagnosis framing** of the AARRR funnel — surface the
largest stage-to-stage drop ("BIGGEST LEAK"), label the visitor-
weighted view as "experimental — directional only, not a traffic
forecast", and never lead with absolute %s as conversion predictions.
This is what protects companies from reading a 22% activation as
"22% of real visitors will activate" when the real signal is "this
stage is your bottleneck — fix it first."

## Known Limitations / Follow-ups (post-2026-05-07 hardening)

Open items the 2026-05-07 validator hardening surfaced but did NOT
fix in-scope. Listed in dependency order — earlier items unblock
later ones. Each entry: symptom · root cause · what unblocks the fix
· estimated cost.

### 1. Cohort pool is crypto-tilted (Phase 2)

**Symptom:** On non-crypto sites the rank-1 friction cluster is
often **"Wrong audience entirely"** with 30-40% of personas bowing
out (Linear 2026-05-07: n=40/111). Real product frictions get
demoted to rank-2/3.

**Root cause:** `packages/shared/src/cohorts.ts` defines 8
STANDARD_COHORTS, of which 3 (`crypto_native`, `defi_beginner`,
`web3_pro`) are explicitly crypto. That's 37.5% of the pool. The
voice cleanup (Q3 P1) stopped them from *fabricating* crypto
features but they still correctly identify themselves as wrong
audience for non-crypto sites — which is honest behavior, not a
bug, but it dominates the friction list.

**Unblock:** Split the pool into general 8 (age × tech_literacy
× mobile/desktop × design axes, domain-neutral) + crypto add-on
3 (only run when `scan.category ∈ {DeFi, NFT, Crypto Wallet}`).
Requires DB migration on `personas` (cohort_id column or
selector versioning), re-seed of the persona pool, and
category-aware cohort selection in `scan_pipeline.ts::sampling`
step. UI also needs cohort cards to render the active set.

**Cost:** ~1-2 sprints. Not a one-line change.

### 2. INTENT_ACTION multipliers are universal (visitor-view collapse)

**Symptom:** The 5-site 2026-05-07 multi-category test showed the
visitor-weighted AARRR view collapses to nearly identical absolute
%s across very different categories: Activation spread = 13pt,
Revenue spread = 1.3pt across E-commerce / Productivity / Media /
AI / DeFi.

**Root cause:** `services/aarrr.ts::INTENT_ACTION` is a single
universal constant (`{activation: 0.50, retention: 0.20,
referral: 0.10, revenue: 0.05}`) calibrated against Merch GA4
n=1. Multiplied stage-by-stage, the constants dominate the
formula and compress site differences toward the calibration
target.

**Mitigation already shipped:** UI reframed the visitor view as
**experimental — directional only** with a `BIGGEST LEAK`
callout that names the largest stage-to-stage drop instead of
leading with absolute %s. See the `## Do NOT` entry on AARRR
framing.

**Unblock:** Per-category INTENT_ACTION (e.g. DeFi activation
0.30 to reflect wallet-connect barrier, SaaS activation 0.40,
E-commerce 0.50). Requires GA4 reference data per category — see
item 3.

**Cost:** ~1 sprint for the per-category routing + tests, but
blocked on real data.

### 3. GA4 reference set is n=1

**Symptom:** Calibration confidence on the visitor view rests on
a single site (Google Merch Store). Item 2 cannot be unblocked
without more.

**Unblock:** Beta partnership / outreach to 5+ companies per
category willing to share aggregate GA4 conversion-by-cohort data
read-only. Phase B-followup step 3 in the original validator
spec. Until then, "experimental — directional only" labeling on
the visitor view is load-bearing — see Do-NOT entry.

**Cost:** Sales/BD effort, not engineering. Once data lands,
~half-sprint to wire per-category multipliers.

### 4. Q4 hallucination-guard observation period

**Status:** No hard guard added at the prompt level (intentional
— context-starvation was the root cause and Q2+Q3 P1 fixed that).
2026-05-07 5-site post-fix test recorded **0 site fabrications**
on 4 non-crypto sites; the 2 residual crypto-vocab matches were
honest persona self-identification (`"I'm a crypto person…"`),
not invented site features.

**Unblock:** Run 5-10 more non-crypto scans across diverse
categories (Marketplace, Gaming, Social, etc.). If contamination
stays at 0 site fabrications, decision is permanent: no
prompt-level guard needed. If even 1 fabrication recurs, add the
explicit `"If a feature you describe is not visible in the
screenshot or implied by the site's stated category, do not
mention it as a friction"` rule to the buildSystemPrompt body.

**Cost:** Trivial — runs in the normal scan workflow.

### 5. Cross-scan QA script (Layer 2 detection)

**Status:** Not built. The proposed `scripts/qa-validator-scans.ts`
would pull the last N scans and flag (a) non-crypto scans with
crypto vocabulary in friction quotes, (b) "Wrong audience" rank-1
clusters representing >30% of personas, (c) weighted-view
n_passing collapsing to all zeros (would catch the n_passing=0
regression).

**Unblock:** ~1 hour engineering. Useful before Phase 2 ship to
build before/after comparisons across all historic scans.

**Cost:** ~1 hour.

### 6. UI auto-flag for domain mismatch (Layer 1 detection)

**Status:** Not built. Would render an inline warning badge on
the report page when a friction cluster's quote contains
crypto-domain vocabulary on a non-crypto-classified site, or
when rank-1 cluster represents >30% of personas with
"audience misalignment" semantics.

**Unblock:** ~3 hours engineering. Best deferred until Phase 2
(item 1) lands — Phase 2 will reduce the rank-1 audience-misfit
pattern significantly, so the flag's signal-to-noise ratio
shifts.

**Cost:** ~3 hours, but better timed after Phase 2.

### 7. Friction clustering input filter (alternative to Phase 2)

**Status:** Considered, not adopted. `clusterFrictions()` reads
ALL `voice_biggest_friction` strings including those from
`engagement.category=abandon` personas — whose "friction" is
inherently "I shouldn't be here", not a product issue.

**Trade-off:** Filtering `engagement!='abandon'` from the
clustering input removes the audience-misfit cluster from rank-1
but also throws away a real signal. Phase 2 (item 1) is the
cleaner fix because it prevents the wrong cohorts from being
sampled in the first place rather than masking them after the
fact.

**Cost:** ~30 min if we decide to do it as a stopgap before
Phase 2, but Phase 2 is the structurally correct path.

### 8. Synthetic-persona pool ceiling

**Status:** Documented, not yet hit. The current 808 persona
pool is procedurally generated from 8 cohort selectors. Voice
samples are picked from a fixed 24-string `VOICE_BY_COHORT`
table. Diversity has a hard ceiling.

**Unblock:** Onboard real testers (the 41R Persona Market is
designed for this — testers complete tests → earn USDC → AI
Persona generated from their behavior). Real personas have
unique voice samples and behavioral patterns that procedural
seeds cannot match.

**Cost:** Product/marketplace effort, not engineering. Once real
testers > N (~50) per cohort, the synthetic seeds can be marked
as fallback-only.

### 9. Validator API routes have no rate limiting

**Symptom:** `/api/auth/*`, `/api/scan/*`, `/api/calibration/*`,
`/api/benchmark/*` accept unlimited requests per IP/wallet. A
single misbehaving client (or a DoS) can exhaust LLM credits,
captureSite Playwright workers, or DB connections.

**Root cause:** The previous `middleware/rate-limit.ts`
(`autotestRunLimiter` / `reportSubmitLimiter` /
`llmGenerateLimiter`) targeted autotest-era routes that the
2026-05-07 pivot deleted. The middleware was removed in the
follow-up dead-code cleanup (commit d817167) because all three
limiters had zero call sites. Validator routes were never
re-wired to limiters.

**Cost concern:** `/api/scan` POST kicks off a ~$0.15 pipeline
(112 personas × Sonnet vision). 100 requests/hour at the API
costs $15/hour without rate limiting.

**Unblock:** Rebuild a small rate-limit module sized for the
validator surface area:
  - `/api/scan` POST: 5/min per IP + 20/hour per wallet
  - `/api/auth/nonce`: 30/min per IP
  - everything else: 60/min per IP (cheap reads)
Use `express-rate-limit` (already a dep) or the `keyv`-backed
pattern. ~1 hour engineering.

**Cost:** ~1 hour. Should land before any public/marketing
traffic; until then the API is on Railway custom-domain hidden
URLs which limits exposure but doesn't eliminate it.
