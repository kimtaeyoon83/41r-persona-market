# 41R Persona Market — Project Guidelines

## Overview

AI Persona-driven product validation marketplace on Solana.
Human testers complete tests → earn USDC rewards → generate AI Personas → Personas run autonomous browser tests.

## Architecture

```
apps/api             (Express :4100)  — routes, validator pipeline, Solana sponsored tx
apps/web             (Next.js :3000)  — app-router pages (/, /validator/*, /me/*)
packages/shared            — TypeScript interfaces (@41rpm/shared)
packages/solana-utils      — Token-2022 utilities (@41rpm/solana-utils)
packages/contracts         — Solana program / IDL stubs
scripts/                   — seed / migration / backfill / usage-summary
```

The autotest-era `apps/persona-engine/` (FastAPI service) +
`packages/persona-client/` (TS HTTP client) + their env vars
(`USE_PERSONA_ENGINE`, `PERSONA_ENGINE_URL`, `PERSONA_ENGINE_AUTH_TOKEN`)
were all removed in the 2026-05-07 hygiene pass. Validator pipeline
(Mode A / Mode B scans) is self-contained — Sonnet vision /
Haiku text via the Anthropic SDK directly, no external service.

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
pnpm --filter api test      # Run vitest (272 tests as of 2026-06-12)
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
pnpm tsx scripts/qa-validator-scans.ts [--max=10] [--scan=<id>]  # cross-scan QA (Layer 2):
                                           # crypto-vocab on non-crypto, misfit rank-1 >30%,
                                           # weighted-AARRR all-zero, numeric-vs-voice contradictions
pnpm tsx scripts/spike-behavior-sim/capture.ts scripts/spike-behavior-sim/sites/<id>.json
pnpm tsx scripts/spike-behavior-sim/run.ts spike/<id>/graph.json [--start=<node>] [--n=N] [--suffix=s]
```

## Key Conventions

### Backend (apps/api)
- 7 active routes under `src/routes/`, mounted in `src/index.ts`:
  `scan.ts`, `calibration.ts`, `benchmark.ts`, `hello.ts`,
  `console.ts` (Console S2 — workspace CRUD/keys/analytics),
  `me_responses.ts` (Phase 5.1 — `/api/me/survey-responses[/:scanId]`,
  `/api/me/points`; Console S1 2026-06-11 adds `/api/me/credits`),
  `partner.ts` (workspace-keyed since 2026-06-12 —
  `POST /api/partner/{survey,session-token,survey-by-token,profile,
  behavior}` + `/t.js`+`/t` beacons. S2S gated by `requireSiteSecret`
  (`middleware/partner.ts` — workspace rpm_sk_ secret, sha256 lookup);
  email is a provisional identity claimed on Privy login — see
  `middleware/privy_auth.ts::claimPartnerRows`).
- Active services in `src/services/`: `llm.ts`, `audience_fit.ts`,
  `scan_pipeline.ts`, `site_classifier.ts`, `site_capture.ts`,
  `cohort_selection.ts`, `anthropic_client.ts`, `aarrr.ts`,
  `dimension_simulator.ts`, `persona_wallets.ts`, `sponsored_tx.ts`,
  `fee_payer.ts`, `r2.ts`, `health.ts`, `benchmark.ts`,
  `credits.ts` (Console S1 2026-06-11 — founder credit ledger, see
  Console section below),
  `human_aggregate.ts` (Phase 5 — survey_responses → AI-shape human
  report via the same dimension/friction/AARRR pipeline),
  `dimensions/` (LLM dimension scorers + friction clustering +
  `custom_questions.ts` Haiku site-specific question generator),
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
  `/`, `/validator/*` (incl. `/validator/compare/[scanId]` — Phase 5),
  `/console` + `/console/sites/[host]` (Console S1 — site-grouped
  founder console; `[host]` is the normalized URL host until
  site_workspaces lands in S2; grouping helpers in
  `app/console/_lib.ts`),
  `/me` (tester home: points + credits + activity), `/me/points`,
  `/me/wallet`,
  `/me/responses[/[scanId]]` (Phase 5.1 — own survey list + AI-vs-Me detail).
  `/me/analyses` is a redirect stub → `/console` (bookmark preservation,
  same pattern as `/validator` → `/`).
- i18n: `lib/i18n.tsx` — lightweight en-default + ko dictionary via
  React context, locale in localStorage (`41r-locale`), `LocaleToggle`
  in the TopBar. Decision §12-5 of `docs/console-ia-redesign.md`: new
  console/me screens must use `t()` from day one; no locale URL
  routing, deliberately not next-intl.
- Shared API URL: `import { API_BASE } from '@/lib/api'` — never hardcode.
- API client (`lib/api.ts`): surfaces are `scanApi` (/api/scan/*),
  `consoleApi` (/api/console/*), `meApi` (/api/me/*),
  `calibrationApi`. All authenticated calls ride the Privy bearer
  auto-attached by `setAuthTokenGetter()` (see Auth section).
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
- Legacy wallet-signed nonce path — REMOVED 2026-06-12 (user-approved
  large-change cleanup). `middleware/auth.ts`, `routes/auth.ts`
  (/api/auth/nonce + /me), `schemas/common.ts`, and the web `authApi`
  all had zero live consumers after the Privy migration. If a future
  surface needs wallet-signed mutations, build it fresh against the
  then-current need — don't resurrect the nonce store.

### Testing
- Vitest at `apps/api/src/__tests__/` — **272 tests** as of 2026-06-12.
  Suites cover env validation, auth schema, audience-fit math,
  cohort selection, dimension LLM contracts (incl. the Q2 site-context
  + Q3 voice-cleanup regression locks), scan shapers, AARRR weighted
  funnel, friction clustering, site classifier, acquisition priors,
  behavior-sim state core, partner auth, and Console S1 contracts
  (`console_sprint1.test.ts` — pricing/bonus constants, anonymous demo
  allowance, calibration soft gate, rate-limit envelope).
  LLM-touching tests mock `services/anthropic_client` via `vi.mock`
  so the prompt path runs without real API calls.

## Audience-Fit Validator (`/validator/*` + `/api/scan/*`, audited 2026-05-08)

The current product. Measures **audience-fit** across 8 cohorts ×
5 dimensions via capture-and-score: one screenshot per scan, ~100
LLM persona reactions, weighted aggregate. Personas don't browse —
they react to a screenshot. Phase 5+ adds human comparison: real
respondents take a Privy-authed survey on the same scan, the
operator clicks "Compare with humans", and a `/validator/compare`
page renders AI vs Human side-by-side.

### Architecture

```
POST /api/scan                  apps/api/src/routes/scan.ts
  → scan_pipeline.ts             startScanWorker(scanId) — fire-and-forget
       Step 0 capturing           captureSite() — Playwright full-page screenshot
       Step 0.5a                  classifySite() — Haiku vision:
                                    {category, confidence, one_line_pitch}
       Step 0.5b (Phase 5)        generateCustomQuestions() — Haiku vision:
                                    3-5 site-specific human-survey questions,
                                    persisted to audience_fit_scans.custom_questions
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

Phase 5 — Human comparison (async, operator-triggered):
POST /api/scan/:id/survey          authenticated (Privy); upserts one row in
  → routes/scan.ts                 survey_responses keyed by (scan_id, user_id),
                                   appends 5 rows to calibration_records (legacy)
POST /api/scan/:id/human-aggregate operator clicks "Compare with humans"; reads
  → human_aggregate.ts             survey_responses, runs the SAME aggregation
                                   primitives as the AI side (dimension means →
                                   clusterFrictions Haiku call → AARRR), writes
                                   audience_fit_scans.human_aggregate
GET  /api/scan/:id/compare         returns { ai, human, diff } where diff =
  → routes/scan.ts                 per-dimension Δ + friction overlap +
                                   AI-only / Human-only cluster callouts
GET  /api/scan/:id/report.md       public markdown export of the AI report
                                   (for sharing with ChatGPT/Claude as a link)
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

### Phase 5 — Human comparison report

Async operator workflow. Real human respondents take a survey at
`/validator/survey/<scanId>` (Privy-authed since Phase 5.1, see below);
when enough have piled up, the operator clicks "Compare with humans
(n=X)" on the report page, which fires `POST /:id/human-aggregate`.

`services/human_aggregate.ts::recomputeHumanAggregate(scanId)` is the
entry point. It is **strict-mirror of the AI side**: same dimension
score formulas (`HUMAN_ENGAGEMENT_TO_SCORE`, `RETENTION_TO_D7`,
`computeSusScore`), same single-bucket cohort_fit math (Mode-B-style
collapse), same friction clustering primitive (`assembleFrictionClusters`
re-used; the LLM call is in-module — Haiku, route tag
`validator.cluster_human_frictions`), same AARRR (`computeAarrrFromRows`
re-used). Output shape `HumanAggregate` is persisted as jsonb on
`audience_fit_scans.human_aggregate` and rendered alongside the AI
report at `/validator/compare/[scanId]`.

Friction clustering safe-floor: when n_respondents < 3, the helper
returns a single fallback bucket with raw quotes instead of calling
Haiku — Haiku produces unstable clusters below that threshold.

`GET /:id/compare` returns `{ ai, human, diff }`. `diff.audience_fit_delta`
is `human − ai`. Friction overlap uses a token-overlap heuristic on
cluster titles (lowercase + 3+ char tokens); not semantic embedding
matching, but cheap and good enough to color overlapping clusters
together vs. AI-only / Human-only.

The `survey_response_count` and `human_aggregate_computed` fields land
on the scan-report response so the report-page footer button can render
"Compare with humans (n=X) →" without an extra round-trip.

### Phase 5.1 — Privy-authed surveys + per-user editing

`POST /api/scan/:id/survey` is **`requirePrivyAuth`**. The body schema
no longer carries `email`; identity comes from `req.privyUser.id`. The
handler upserts on the unique `(scan_id, user_id)` index — a
respondent can come back, prefill from their prior submission via
`GET /api/me/survey-responses/:scanId`, edit, and resubmit. Only the
last submission counts toward `human_aggregate`.

`/me/responses` (list) and `/me/responses/[scanId]` (AI-vs-Me detail
with 5-dimension Δ) surface the per-user view. Server-side the
`user_id = req.privyUser.id` filter is the **enforced data-isolation
boundary** — a user can never read another user's rows even if they
guess a scan id.

Legacy email-only rows (3 pre-Phase-5.1 test submissions) survive
because Postgres treats NULL as distinct in UNIQUE — `email` is
nullable now, but the column stays for backward-compat with those
old rows and any future legacy data. New rows always have
`email IS NULL`, `user_id IS NOT NULL`.

### AARRR is CUMULATIVE (not independent filters)

`services/aarrr.ts::computeAarrrFromRows` filters cumulatively:
each stage's set is a subset of the previous. This guarantees a
monotonic non-increasing funnel shape. Independent thresholds (the
2026-05-01 prior version) could produce non-funnel shapes like
100→28→25→27→28 where Referral exceeded Activation. The pure compute
helper is exported for unit tests; `audience_fit_helpers.test.ts`
locks the monotonicity + threshold boundaries.

Thresholds (v1.1 retune 2026-05-06 — see Do-NOT entry on AARRR
threshold reverts for the rationale + observed-distribution data
that drove the retention/revenue gate cuts):
- Activation: task_success ≥ 30
- Retention: + retention_d7 ≥ 5     (v1.0 was ≥ 30, dropped because
  ~85% of personas land in the weak band D7=5; old gate killed the
  funnel post-activation)
- Referral: + happiness ≥ 60
- Revenue: + adoption ≥ 30          (v1.0 was ≥ 65, unreachable in
  the observed adoption distribution; ≥ 30 = "meaningful purchase
  intent" while still dropping the funnel)

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

## Partner Integration — workspace-keyed (2026-06-12 rework)

The geulbat env-key special-casing (`PARTNER_API_KEY_GEULBAT`,
`PARTNER_SITE_KEY_GEULBAT`, `requireGeulbatKey`, `/api/partner/geulbat/*`
paths) was REMOVED by user decision — geulbat had not yet implemented
the old guide, and will register fresh through the console once the
rebuild ships. Every partner (geulbat included) now:

1. registers a workspace in the console → gets `rpm_pk_` site key +
   `rpm_sk_` secret (shown once),
2. uses generic S2S paths: `POST /api/partner/{survey,session-token,
   survey-by-token,profile,behavior}` with `x-partner-key: rpm_sk_…`,
3. embeds `/api/partner/t.js` with `data-site="rpm_pk_…"` for beacons.

Handoff/identify tokens are HMAC-signed with the workspace's stored
secret HASH (server-only signing key; payload carries the workspace id;
rotating the secret invalidates outstanding tokens by design). Ledger
`source` values are `ws:<workspace_id>`; historical `'geulbat'` rows
remain valid data. Dogfooding likewise: register the 41R app itself as
a workspace and put its rpm_pk_ key in NEXT_PUBLIC_TRACKING_SITE_KEY.

The section below documents the original pilot's data model — the
3-stream concept is unchanged, only the auth/paths moved.

## Partner Pilot — geulbat (2026-06-10, auth/paths superseded above)

First instance of the tester-data loop: a partner site feeds three
streams into 41R, all keyed by Google-verified email and claimed on
the person's first Privy login (`privy_auth.ts::claimPartnerRows`
backfills `user_id` across all partner tables; non-fatal, never
blocks login; skips scans the user already submitted to directly so
the `(scan_id, user_id)` unique index holds).

```
① profile    POST /api/partner/geulbat/profile     → partner_profiles (flexible jsonb)
② behavior   <script .../api/partner/t.js data-site=…>  → partner_behavior_events
             (GA-style snippet: pageview/dwell/session, sendBeacon text/plain;
              S2S POST /geulbat/behavior is the server-side fallback)
③ survey     POST /geulbat/session-token → hosted page ?pt=<token>
             → /geulbat/survey-by-token → survey_responses + calibration_records
             + point_transactions (+100pt pilot, first submission only)
```

**Two key tiers — never confuse them:**
- `PARTNER_API_KEY_GEULBAT` — S2S secret, also the HMAC secret for
  handoff/identify tokens. Server env only.
- `PARTNER_SITE_KEY_GEULBAT` — public like a GA measurement id; only
  routes beacons to a source bucket.

Integration guide for the geulbat repo:
[`docs/partner-geulbat-integration.md`](docs/partner-geulbat-integration.md).
Pending value: anchor scanId (run a 41R scan of the geulbat prod URL).
Points policy is intentionally undecided — the ledger is append-only
so any future policy can reprice retroactively.

## Console Sprint 3 — analytics + retention loops (2026-06-12)

- **Analytics API** — `GET /api/console/sites/:id/analytics?days=7|30`
  aggregates partner_behavior_events for source `ws:<id>`: KPIs
  (distinct-anon visitors, sessions, pageviews, avg dwell ms), daily
  series, path ranking (views/dwell/scroll), monthly usage vs the
  100k soft cap. Direct SQL — a rollup table is the scale path.
- **Beacon soft cap** — in-memory per-(source, month) counter, lazily
  DB-initialized; over-cap batches are DROPPED with 204 (tracking must
  never error the partner's page — the console usage gauge is the
  warning). Single-instance semantics, same caveat as rate limiters.
- **Analytics tab** (`/console/sites/[id]` ?tab) — TRACKED: KPI strip,
  daily bars, page table, and the "Prediction vs reality" combined
  card (MEASURED ↔ AI PREDICTED `experimental — directional only` ↔
  HUMAN SURVEY — the flywheel §0.2 made visible; keep the labels).
  LITE: snippet upsell framed as "verify the prediction", never
  "replace your analytics" (Clarity is free — §0.3).
- **Retention loop #2** — `services/notify.ts::notifySurveyMilestone`:
  survey-response arrival email to the scan owner at exact counts
  1/5/10/20/30 (max = reward cap). Fire-and-forget from BOTH survey
  paths, only on first submissions.
- **Retention loop #3** — weekly digest cron (`startDigestCron`, env
  `DIGEST_CRON_ENABLED=1`, Mondays UTC): per-user summary of each
  workspace's 7d scans/fit/visitors. In-process week guard only —
  a redeploy on Monday can double-send (accepted for pilot).

## Console Sprint 2 — workspaces + key self-serve (2026-06-12)

S2 shipped on the same branch. (Originally kept a geulbat env-key
alias; that alias was removed on 2026-06-12 by user decision — see
"Partner Integration — workspace-keyed" below.)

- **site_workspaces** (migration 0014, idempotent) — registration =
  per-user analysis workspace, NOT ownership: `UNIQUE(user_id,
  url_host)`, no global host unique (N users can register the same
  site, fully isolated). No domain verification ever — installing the
  snippet is the natural gate. Tier is emergent: `last_event_at` set →
  TRACKED, else LITE.
- **Two-tier keys** (`services/workspaces.ts`): `rpm_pk_…` site key
  (public, beacon routing only) / `rpm_sk_…` secret (S2S + HMAC,
  sha256-hashed, plaintext shown exactly once at create/rotate).
  Neither grants read access — leak blast radius is fake-data
  injection only.
- **/api/console/sites** CRUD + rotate-key + link-scan
  (`routes/console.ts`, owner-scoped WHERE user_id). Creating a
  workspace adopts the user's existing unassigned scans for that host;
  new scans auto-link in POST /api/scan via `findWorkspaceByHost`.
- **requireSiteSecret** (`middleware/partner.ts`) — workspace secrets
  only (source 'ws:<id>'). Beacon `siteKeySource` resolves `rpm_pk_…`
  keys from the DB and touches `last_event_at`.
- **Survey rewards** (`services/rewards.ts`) — single source for both
  the partner and direct survey paths: +100pt first submission,
  per-scan cap 30; beyond the cap a transparent 0pt
  'reward_cap_reached' row is appended (never silently dropped) and
  the survey page discloses the state BEFORE answering via
  `survey_reward_available` on the report response (§12 decision 7).
  `point_transactions.ref_id` (scan id) backs the cap count.
- **Scan-complete email** (`services/email.ts`) — Resend HTTP wrapper,
  no-op without RESEND_API_KEY; fired from both pipeline completion
  points (non-fatal). Headline is the best-fit audience, not the score.
- **Web**: /console lists workspaces (LITE/TRACKED badge) + Unassigned
  scans with one-click register; /console/sites/new is a 1-step form
  whose success state shows the secret once + snippet; detail moved to
  /console/sites/[id] with a Settings tab (keys, rotate, snippet,
  last-event, delete — delete unlinks scans, never destroys).

## Console Sprint 1 — credits + founder console (2026-06-11)

Product plan: `docs/console-ia-redesign.md` (v0.6 — decisions §12
confirmed). S1 shipped on branch `feat/console-sprint1`:

- **Credit ledger** — `credit_transactions` (migration 0013, idempotent
  SQL) + `services/credits.ts`. Append-only, same contract as
  point_transactions: corrections/refunds are NEW rows, never UPDATE.
  Points (tester earn) and credits (founder spend) are separate
  currencies on purpose — don't unify before v2.
- **Signup bonus** — granted in `privy_auth.ts::upsertUser` via
  `ensureSignupBonus` (non-fatal, like claimPartnerRows): $30 verified
  identity (any non-wallet linked account) / $5 wallet-only, upgraded
  +$25 when an email/social links later. `expires_at` recorded (90d)
  but NOT enforced during the pilot — expiry batch ships with top-up
  billing (v2).
- **Scan pricing** — Mode A $2 / Mode B $1, debited in POST /api/scan
  *before* startScanWorker under a per-user pg advisory xact lock
  (`debitScan`); 402 `insufficient_credits` deletes the pending row.
  Refund on failure goes through the `setStatus('failed')` choke point
  in scan_pipeline + the worker crash handler (`refundScanDebit`,
  idempotent).
- **Anonymous demo** — 1 fresh scan per IP per day + same-URL 24h
  cache reuse (returns the existing scanId with `cached: true`).
- **Console UI** — `/console` (host-grouped sites; S2 replaces host
  grouping with `site_workspaces`), `/console/sites/[host]` (Overview
  hero = best-fit cohort first, score second, misfit line — keep that
  order, it's the §0.4 honesty contract on screen), `/me` + `/me/points`
  (first consumer of /api/me/points), TopBar `[Console · My Page]` +
  EN/KO toggle, `/me/analyses` → `/console` redirect.
- S2 next: `site_workspaces` table + key self-serve +
  `requireSiteSecret` generalization (geulbat
  env-key seeded as row 1, no downtime) + scan-complete email.

## Behavior Simulation (Mode C — gated, not shipped)

Spec: `docs/41rpm_behavior_simulation_spec_v1.md`. Validation spike +
v1-v7 results: `docs/41rpm_behavior_sim_spike_v0.md` (§7 carries four
empirical findings that feed spec v1.1: trace summary is mandatory;
indifferent AND satisfied exits both need state gates — LLMs never
leave from boredom nor declare satisfaction; relevance must be
Ch1-led, not self-reported). The L4 internal-state core already
exists as a pure module: `apps/api/src/services/behavior_sim/state.ts`
(5 state vars + 4-mode leave gate, 17 direction tests, not wired to
any route). Agreed direction: Mode C runs ALONGSIDE Mode A/B (they
measure different funnel stages), graph mode first, labeled
"탐색 시뮬레이션". **Build gate: Phase 1 human think-aloud data (5
people, NHIS protocol in the spike doc) — do not iterate the
simulator further without it (risk: tuning toward aesthetics).**

## Capture Signals (Ch1, 2026-06-10 spike transfer)

`captureSite()` measures objective page facts in the capture page
load (word/link/CTA counts, nav menu labels, popup heuristic,
login-wall redirect) → `audience_fit_scans.capture_signals` (null on
legacy scans — every consumer hides). They ground persona prompts
(`SiteContext.pageFacts` → "Page facts (measured)" section; without
pageFacts the prompt is byte-identical to pre-2026-06-10, locked by
`dimension_llm.test.ts`) and render the report's "MEASURED · NO LLM"
strip. Capture falls back networkidle → domcontentloaded on timeout
(ad-heavy sites previously degraded silently to text-only scans).

## LLM Usage Tracking

- Unified JSONL log at `USAGE_LOG_PATH` (default `/tmp/llm-usage.jsonl`)
- `apps/api/src/services/anthropic_client.ts` wraps the SDK via
  AsyncLocalStorage; tag via `withRoute('...', () => client.messages.create(...))`
- `scripts/usage-summary.ts` — totals by model/service/route, heaviest calls,
  duplicate-prompt detection
- Route tags used by the validator pipeline (use these as
  filter keys in `usage-summary.ts`):
  `validator.classify_site` (Haiku vision, 1× per scan),
  `validator.custom_questions` (Haiku vision, Phase 5 — 1× per scan,
  generates 3-5 site-specific human-survey questions right after
  classifySite),
  `validator.parse_audience` (Haiku, Mode B only — 1× per scan),
  `validator.persona_response` (Sonnet vision when USE_VISION=1
  or Haiku text otherwise, 112× per Mode A scan / ~50× Mode B),
  `validator.cluster_frictions` (Haiku, 1× per scan),
  `validator.cluster_human_frictions` (Haiku, Phase 5 — 1× per
  POST /:id/human-aggregate when n_respondents ≥ 3).

## Local Dev Gotchas

- **macOS EMFILE "too many open files" on Next.js**: raise ulimit and
  force polling:
  ```bash
  ulimit -n 65536
  WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=true pnpm --filter web dev
  ```
## Security / Observability / Settlement (Phase 0 + 1 hardening)

- **Auth** — Privy bearer on all user-facing mutations
  (`middleware/privy_auth.ts`); partner S2S via x-partner-key
  (`middleware/partner.ts`); operator via x-admin-key
  (`middleware/admin.ts`). The autotest-era wallet-signature layer was
  removed 2026-06-12 (see §Auth above).
- **Target-URL guard (SSRF + injection)** — `services/url_guard.ts`
  (2026-06-15). The site URL is hostile input: captureSite() points a
  headless Chromium at it (SSRF) and it's echoed into reports/prompts.
  `validateTargetUrl()` is the synchronous gate — http(s) scheme only;
  no credentials; no control/script chars (`<>"'\`` etc., raw — encoded
  `%3C` passes); host must be a public hostname or public IP. Rejects
  every private/loopback/link-local (incl. 169.254.169.254 metadata),
  ULA, CGNAT, multicast, single-label, reserved-suffix (.local/.internal/
  …), and numeric/hex IP-coercion form (2130706433, 0x7f000001, 127.1).
  Wired at POST /api/scan + console site create/patch (stores the
  normalized canonical URL; junk/`javascript:` never reaches the DB).
  `resolvesToPublicHost()` is the async defense-in-depth in captureSite:
  resolves the host right before navigating and refuses any private
  answer (DNS-rebinding / internal-CNAME). Frontend mirror is
  `apps/web/lib/url.ts::checkTargetUrl` (instant UX block on landing /
  detail / console-new; server stays authoritative — keep the two rule
  sets in sync). Matrix locked by `__tests__/url_guard.test.ts`.
- **CORS allowlist** — `config/cors.ts`. Defaults allow localhost:3000/3001,
  127.0.0.1:3000/3001, the Railway web URL. Override via
  `CORS_ALLOWED_ORIGINS` (comma-separated).
- **Rate limiting** — REBUILT in Console S1 (2026-06-11, closes Known
  Limitations §9). `middleware/rate_limit.ts`: POST /api/scan gets
  5/min·IP + 20/h·user (user limiter runs after optionalPrivyAuth so
  it keys on privyUser.id), mutations (survey / human-aggregate /
  payment) 30/min·user, and a router-wide read limiter on
  auth/scan/calibration/benchmark/me. The partner router is
  deliberately NOT limited (beacons are high-frequency by design).
  In-memory stores — fine single-instance; `app.set('trust proxy', 1)`
  in index.ts makes req.ip the real client behind Railway. Limiters
  skip when NODE_ENV=test.
- **Zod body validation** — inline `z.object(...).safeParse(req.body)`
  per route handler (scan.ts, console.ts, partner.ts pattern). The old
  shared `schemas/` dir went with the wallet-signature layer.
- **Env flag safety** — `config/env.ts` enforces production-only
  invariants at boot (e.g. mandatory secrets present, dev-only
  bypass flags forced off). Boot log prints
  `[env] NODE_ENV=... · payment verify: ENABLED|SKIPPED`.
- **Structured logging** — `apps/api/src/logger.ts` exports a pino instance
  (+ `childLogger(bindings)`). Railway surfaces JSON logs cleanly. Replace
  remaining `console.*` as you touch files.
- **Deep health** — `GET /api/health?deep=1` pings DB + Solana RPC with
  per-dep latency (`services/health.ts`). 503 when any dep is down.
  Basic `/api/health` stays synchronous + cheap.
- **Settlement worker** — exponential backoff 30s → 1m → 5m → 15m cap,
  24h MAX_AGE terminal marker (`services/settlement-worker.ts`). Runs in
  background; disable via `SETTLEMENT_WORKER_DISABLED=1` for tests.
- **DB migrations** — `apps/api/drizzle/` holds versioned SQL.
  **Production reality check (2026-06-10): the prod DB's drizzle
  journal is EMPTY** — the schema was historically applied via
  `db:push`, so `db:migrate` against prod would replay from 0000 and
  fail. Until a baselining pass records 0000-0012 as applied, ship
  prod schema changes as idempotent SQL applied manually (the
  0009-0012 files are written idempotent — `IF NOT EXISTS` /
  constraint guards — for exactly this). `db:push` stays dev-only.

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
ADMIN_API_KEY=...           # Gates /api/admin/* (≥12 chars; absent ⇒ 404).
                            # Console S1: when set, also demotes /api/calibration
                            # to operator-only (x-admin-key) and acts as the
                            # operator override on POST /:id/human-aggregate.
NEXT_PUBLIC_TRACKING_SITE_KEY=... # Dogfooding: a real workspace's rpm_pk_ site key
                            # (register app.project-rpm.xyz in the console). When set
                            # together with NEXT_PUBLIC_API_URL, layout.tsx injects
                            # the t.js snippet (public by design, GA-id semantics).
                            # Partner env keys (PARTNER_*_GEULBAT, PARTNER_SITE_KEY_41R)
                            # were removed 2026-06-12 — keys live in site_workspaces now.
RESEND_API_KEY=...          # Console S2/S3 — transactional email (scan-complete,
                            # response milestones, weekly digest). Absent ⇒
                            # services/email.ts no-ops (local/test safe)
EMAIL_FROM=...              # Sender (default: 41R <noreply@project-rpm.xyz>)
DIGEST_CRON_ENABLED=1       # Console S3 — weekly digest cron (Mondays UTC)
WEB_PUBLIC_URL=...          # Base for partner survey_url links (default https://app.project-rpm.xyz)
LOG_LEVEL=info              # pino level (default: info in prod, debug in dev)
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
- Call `request()` in `lib/api.ts` with custom headers and forget about
  `Content-Type` — the helper preserves explicit headers but caller-provided
  options must not override it.
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
- Drop the `(scan_id, user_id)` UNIQUE index on `survey_responses`.
  Phase 5.1 upsert relies on it: `POST /:id/survey` does
  select-then-insert/update keyed by this composite, and the unique
  constraint is the race-safety net at the DB layer if two requests
  land in flight from the same authenticated user. Legacy
  `user_id IS NULL` rows are exempt because Postgres treats NULL as
  distinct in UNIQUE — that's intentional, don't try to "fix" it
  by NOT NULL'ing user_id (the 3 pre-Phase-5.1 test rows hold their
  emails and have no user_id; bumping NOT NULL would require purging
  them).
- Reintroduce the `email` field to `surveyBody` Zod schema in
  `routes/scan.ts`. Phase 5.1 made identity Privy-only; an email in
  the body would let an authenticated user spoof a different
  identity in the row's `email` column, which currently exists only
  for backward-compat with legacy NULL-user_id rows. If we ever
  want a "shared with non-account-holder" path, that's a separate
  endpoint, not a re-wired version of this one.
- Surface another user's `survey_responses` row through any
  `/api/me/*` endpoint. The `user_id = req.privyUser.id` WHERE
  filter in `routes/me_responses.ts` is the data-isolation
  boundary, not a UI convention. Adding a public list endpoint
  ("see all responses for this scan") needs to go on a different
  route + return only de-identified aggregates (or live in the
  operator-only surface that `human_aggregate` already serves).
- Drop the `clusterHumanFrictions` n<3 fallback bucket in
  `services/human_aggregate.ts`. Below 3 quotes Haiku produces
  unstable clusters (often a single mega-cluster or 5 single-quote
  clusters), so the helper short-circuits to a single "Raw human
  voice" bucket carrying the actual quote string. This is a
  signal-quality safe-floor, not a UI nicety — removing it without
  changing the prompt re-introduces noisy clusters.
- Stop appending the 5 `calibration_records` rows in `POST /survey`.
  The Phase 5.1 rewrite kept them on purpose: they feed the
  operator-team Track A aggregator (`services/calibration/aggregator.ts`)
  + the `/validator/calibration` page. `survey_responses` is the
  **per-respondent raw** store; `calibration_records` is the
  **per-dimension cross-site** rollup. They serve different
  audiences and different time scales — one isn't a successor of
  the other.
- Replace the `validator.cluster_human_frictions` Haiku call with
  the AI-side `clusterFrictions(scanId)` helper. They look similar
  but the input is different: AI clusters quotes from
  `scan_persona_responses.voiceBiggestFriction` (cohort-tagged),
  while human clusters pull `survey_responses.voice.{biggest_friction,
  if_could_change_one_thing, first_impression, would_return_because}`
  + free-text custom answers all tagged `cohort='human'`. Sharing
  the wrapper would lose the human-side input shape. The
  `assembleFrictionClusters` pure helper IS shared — that's the
  right level of reuse.

- Ship a workspace SECRET (`rpm_sk_…`) to a browser, commit it, or
  accept a browser-supplied email anywhere outside the two designed
  channels (partner-key S2S routes, HMAC-token routes). The site key
  (`rpm_pk_…`) is the only partner value allowed in client markup —
  it is public by design, like a GA measurement id.
- Change `POST /api/partner/t` to require `application/json`. The
  text/plain body is what makes sendBeacon a CORS simple request (no
  preflight) — "fixing" the content type silently drops beacons from
  partner origins not in the CORS allowlist.
- Extend `t.js` to capture content (text, titles, keystrokes, form
  values). The consent copy promises paths/durations/scroll only —
  geulbat is a WRITING app; capturing content breaks the consent
  contract, not just privacy hygiene.
- Mutate or recompute `point_transactions` rows. The ledger is
  append-only precisely because the reward policy is undecided — a
  future policy reprices by appending adjustments, never by editing.
- Feed personas an under-specified objective fact without qualifying
  what is NOT known. The 2026-06-10 Spotify case: a bare
  "popup detected" fact seeded a fabricated "wallet connect required"
  friction; the fix was "(content not identified — do not assume what
  it asks for)". When adding new pageFacts lines, state the unknowns.
- Re-include footer links in `nav_menu_labels` extraction (footers
  often wrap link groups in <nav> landmarks — Spotify's legal links
  polluted the menu list and personas reported "navigation cluttered
  with legal links" as a top friction; that was OUR artifact).
- Make `claimPartnerRows` fatal or remove its already-submitted-scan
  guard. A claim failure must never block login, and claiming a scan
  the user already answered directly would violate the
  `(scan_id, user_id)` unique index — the Privy-authored row wins.

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

**Unblock:** Replace the 8 STANDARD_COHORTS with 8 general
evaluator-archetype cohorts + 1 crypto add-on (collapses
crypto_native/defi_beginner/web3_pro into one broad
`crypto_user`). The general 8 includes a new `investor`
archetype (currently missing — VC/angel pattern-matchers on
traction signals). Crypto add-on fires only when
`scan.category ∈ {DeFi, NFT, Crypto Wallet}`.

**Design + implementation order is fully spec'd in
[`docs/cohort-redesign-deferred.md`](docs/cohort-redesign-deferred.md)**
(2026-05-08, agreed but deferred). When unblocking, follow that
doc — do not redesign. Touches `packages/shared/src/cohorts.ts`,
`scripts/seed-validator-cohorts.ts`, `services/cohort_selection.ts`,
`scan_pipeline.ts`, and the heavyweight 96-entry
`acquisition_priors.ts` retune.

**Cost:** ~1-2 sprints. The doc breaks it into a Sprint 1
(cohorts + seed + selection — immediate friction-list relief)
and Sprint 2 (priors retune — keeps the visitor-weighted view
consistent with the new cohort set).

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

### 4. Q4 hallucination-guard observation period — CLOSED (2026-06-10)

**Resolution:** The one-recurrence condition fired. First prod scan
with capture-signal page facts (Spotify) produced a fabricated
`"지갑 연결이 필수인 것처럼 보이는데"` friction from a Designer
persona — the unspecified `popup_detected` fact gave crypto-tilted
vectors a blank to fill. Per the pre-agreed rule, the explicit
guard ("feature not visible in screenshot nor implied by category →
not a friction; an unidentified popup is just a popup") was added
to `buildSystemPrompt`, and the pageFacts popup line now carries
"content not identified — do not assume what it asks for".
Same-day Spotify rescan: 0 crypto/wallet mentions across 109
personas, and the top friction title became **"Unidentified modal
popup on load"** — the persona reported the popup without guessing
its content, exactly the intended behavior. Lesson recorded: when
feeding objective facts to personas, an under-specified fact is a
hallucination seed — qualify what is NOT known.

### 5. Cross-scan QA script (Layer 2 detection) — CLOSED (2026-06-10)

**Resolution:** `scripts/qa-validator-scans.ts` shipped with the
three planned checks plus a fourth from the behavior-sim spike's
gate-vs-utterance pattern: (d) numeric-vs-voice contradictions
(adoption ≥70 with strongly negative voice; abandon-level engagement
with adoption ≥50). Validated against prod on day one: it flagged
both 2026-06-10 Spotify scans correctly (the pre-fix wallet
fabrication and the footer-link artifact cluster) while all four
uniswap scans passed clean. Run it after any batch of scans; flags
are human-review signals, not verdicts.

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

### 9. Validator API routes have no rate limiting — CLOSED (2026-06-11)

**Resolution:** Console Sprint 1 shipped `middleware/rate_limit.ts`
(express-rate-limit): `/api/scan` POST 5/min·IP + 20/h·user,
mutations 30/min·user, router-wide read limiter on the validator
surface; partner beacons deliberately excluded. Cost defense is now
two-layer: rate limits (burst/DoS, per minute/hour) + the credit
ledger (business allowance — Mode A $2 / Mode B $1 debit per scan,
anonymous demo capped at 1/IP/day with a 24h same-URL cache). See
the Security section above + `docs/console-ia-redesign.md` §4.
