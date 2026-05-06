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
pnpm --filter api test      # Run vitest (415 tests as of 2026-05-02)
pnpm --filter api db:generate  # Emit a new versioned migration from schema changes → apps/api/drizzle/*.sql
pnpm --filter api db:migrate   # Apply pending migrations to DATABASE_URL (preferred for Railway deploys)
pnpm --filter api db:push      # Dev only: push schema directly, bypassing migration files
pnpm tsx scripts/seed-data.ts              # Base seed (5 hand-written + 2 tests)
pnpm tsx scripts/append-diverse-personas.ts  # +15 diverse profiles (total 20 personas)
pnpm tsx scripts/run-persona-batch.ts --limit N   # Batch persona runs (default mode=text)
pnpm tsx scripts/usage-summary.ts          # Analyze /tmp/llm-usage.jsonl
pnpm tsx scripts/seed-validator-cohorts.ts # 112 personas across 8 STANDARD_COHORTS (Validator)
pnpm tsx scripts/seed-calibration.ts       # 600 synthetic calibration_records (Validator §5)
pnpm tsx scripts/backfill-cohort-ci.ts [--dry-run]                 # Validator: bootstrap CI for legacy cohort rows
pnpm tsx scripts/backfill-site-classifier.ts [--dry-run] [--max N] # Validator: re-run classifier on placeholder scans
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
- Services in `src/services/` — llm.ts, solana.ts, autotest.ts, matching.ts,
  sas.ts, r2.ts, dashboard.ts (landing aggregate), scoring/, browser_quirks/
- Database: Drizzle ORM with PostgreSQL, schema in `src/db/schema.ts`
- LLM models: Claude Sonnet 4.6 (generation), Claude Haiku 4.5 (scoring/extraction)
- JSON from LLM: always use `parseJsonSafe()` which has `repairJson()` fallback
- Quality scoring: power curve `reward = baseReward * (score / 5.0)^1.5`
- Error pattern: try/catch in every route handler, 400/404/409/500 responses

### Frontend (apps/web)
- Next.js 14 App Router, all pages in `app/`
- Shared API URL: `import { API_BASE } from '@/lib/api'` — never hardcode localhost
- API client: `lib/api.ts` exports `testApi`, `reportApi`, `personaApi`,
  `testerApi`, `autoTestApi`, `dashboardApi` (landing KPIs / activity)
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
- Vitest for API unit tests (`apps/api/src/__tests__/`) — **238 tests**
  (auth, cors, env, schemas, settlement-worker, scoring suites, the
  **43-test dashboard suite** covering timeAgo / spark7* / countInWindow /
  avgInWindow / formatCountDelta / formatSumDelta / formatAvgDelta, the
  **diagnosis suite** covering `validateAuditCitations` +
  `computeFidelityBand` + `clusterPainPointDescriptions` +
  `isHarnessErrorOutcome` + `buildSynthesisPayload` +
  `accumulatePainPointsForReport` — the LLM-touching tests mock
  `services/anthropic_client` via `vi.mock` so the path is exercised
  without real API calls. New suites added 2026-04-25:
  `stagehand-error.test.ts` (captureSessionError helper, 6 tests),
  `race-timeout.test.ts` (raceWithTimeout + TimeoutError, 4 tests),
  `autotest-trigger-dedup.test.ts` (selectQueueableJobs, 6 tests).
  Empty-session guard regression in `scoring-report.test.ts` +
  `scoring-checklist.test.ts` asserts Haiku is NOT called when
  `outcome=error && turns≤1` — anti-fabrication lock-in)
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

- **stagehand_hybrid**: Node-side Stagehand drives Playwright. Scoring
  (checklist / questionnaire / structured_report / quality breakdown) is
  now **fully in-process TypeScript** — see `services/scoring/*` ported
  from the persona-engine Python adapters on 2026-04-22. Produces
  actionable pain_points tied to real UI elements. The cross-language
  hop to persona-engine `/analyses/score` is gone; persona-engine is
  only needed for `mode=text` and the legacy `persona_agent` paths.
- **persona_agent native**: In-process vision+decision loop with patience
  budget. Kept for research but trips mid-flow on complex SPAs.
- Legacy `services/autotest.ts` path still exists when `USE_PERSONA_ENGINE=0`.

### Hang protection (2026-04-25 hardening)

Three layered timeouts so the persona chain can never wedge indefinitely:

| Layer | Cap | Scope |
|---|---|---|
| Inner stagehand `RUN_TIMEOUT_MS` | 5 min | browser run only (page.act, navigation) |
| Per-LLM-call `SCORING_TIMEOUT_MS` | 90s | each of `scoreChecklist` / `answerQuestionnaire` / `generateStructuredReport` in `runStagehandHybridAndPersist` |
| Outer `PERSIST_HARDCUT_MS` | 12 min | the whole persist chain (browser + scoring + R2 + DB) |

`raceWithTimeout` + `TimeoutError` are exported from
`services/stagehand_hybrid.ts` so all three layers use the same
helper. On hit, `TimeoutError` carries the label
(`scoreChecklist(abcd1234)` etc.) for RCA. `runStagehandHybridAndPersist`
is split into a thin outer wrapper + private `…Inner` so the outer
timeout wraps the entire body (the inner hardcut covers stagehand
only, leaving R2 + DB previously unprotected).

### Queue dedup (`selectQueueableJobs`)

`/api/dev/autotest/trigger` previously could queue 2 personas with
the same `testerAddr` (matchPersonas can return multiple personas per
tester); the second one wasted ~$0.10 of stagehand+scoring compute
before its insert hit the unique constraint and threw. `services/
queue_dedup.ts::selectQueueableJobs(matches, modes, alreadyCovered)`
folds DB-covered + in-batch dedup into one pass, exported so the
6-test unit suite can lock the contract without spinning up Express.

### Browser session replay (`_session_video` sentinel, 2026-04-27)

Every stagehand_hybrid run records a low-res webm of the actual
browser session and uploads it to Cloudflare R2. The link is
persisted as a `_session_video` sentinel inside
`test_reports.questionnaireAnswers` (same conditional pattern as
`_quirks` / `_quality_breakdown` / `_session_error`). UI block on
`/report/[id]` parses it and renders an HTML5 `<video>` player.

Pipeline:

```
Stagehand (chrome-launcher CDP)            apps/api/src/services/stagehand_hybrid.ts
  └─ Page.startScreencast (jpeg, 5fps)     mainSession TS bypass — Stagehand v3 has no
  └─ Page.screencastFrame events           recordVideo option in localBrowserLaunchOptions
  └─ write JPEGs → /tmp/stagehand-frames/<sid>/
ffmpeg                                     apps/api/src/services/video.ts
  └─ libvpx 854×480 @ 5fps, 200kbit
  └─ /tmp/stagehand-videos/<sid>.webm
R2 upload                                  apps/api/src/routes/autotest.ts
  └─ key: replays/<sid>.webm  (no prefix; matches the local filename)
  └─ url: https://pub-<bucket>.r2.dev/replays/<sid>.webm
  └─ persisted as _session_video {url, sizeBytes, durationSec, width, height, fps}
```

Local dev fallback: when R2 isn't configured, `services/video.ts`
returns the bucket key as the URL (`replays/<sid>.webm`). The web UI
prefixes non-`http` URLs with `API_BASE`, and `index.ts` mounts
`app.use('/replays', express.static('/tmp/stagehand-videos'))` in the
non-production block so the local file serves directly. The
post-upload `unlinkSync` in `routes/autotest.ts` is **skipped when
the URL doesn't start with `http`** — required so the local file
stays around for serving.

Production needs `ffmpeg` in the runtime image — it's in the
`apt-get install` line of `apps/api/Dockerfile`. `isFfmpegAvailable()`
in `services/video.ts` caches the probe; restart the API after
installing ffmpeg locally or the cached `false` will skip transcoding.

## Landing Dashboard (`/` + `/api/dashboard`)

One-shot aggregate that powers every live widget on the Home page.
**Never put hardcoded KPIs / lists / sparklines back in `apps/web/app/page.tsx`** —
thread them through `GET /api/dashboard?role=&wallet=` instead.

```
role=company | tester             # required
wallet=<solana pubkey>            # optional — no wallet = platform-wide view
```

Response shape (see `apps/api/src/services/dashboard.ts` for the source of
truth; mirrored in `apps/web/lib/api.ts` for the client):

```ts
{
  role, wallet,
  kpis:          [{ label, value, unit?, delta, spark: number[7] }, x4],
  primary_list:  [{ id, title, status, meta, pay, tone, href }, x≤4],
  activity:      [{ at, t, text, kind, tone, meta? }, x≤20],
  stats:         { total_tests, total_personas },
  top_personas?: [{ id, tester_addr, voice_sample, vector, avg_quality,
                    report_count }, x3],          // company view
  my_persona?:   PersonaSummary | null,           // tester view (falls back to
                                                  //  top community persona when
                                                  //  wallet is absent)
}
```

- **Delta is always 7d vs prior 7d**, even in the no-wallet branch, so the
  landing never feels static. Formatters: `formatCountDelta`,
  `formatSumDelta`, `formatAvgDelta`. Keep `spark` and `delta` on the same
  window — otherwise "+3 this week" disagrees with a 14-day chart.
- **Sparklines are 7 chronological points** (index 0 = 6d ago, index 6 =
  today). Use `spark7` for counts, `spark7Avg` for avg-style (null bucket →
  0), `spark7Cumulative` for running totals like Tier.
- **Activity is a heterogeneous feed** (`kind: 'report' | 'test' | 'settlement'`)
  sorted by `at` desc, capped at 20. Tone is auto-assigned from quality:
  ≥4.0 success / <3.0 warn / else neutral. Tests are `accent`, settlements `info`.
- **No-wallet UX**: the Home page shows a `Platform view — connect a wallet…`
  hint, KPIs become platform-wide, and `my_persona` falls back to the
  highest-avg-quality persona so the radar card is never empty.

### Diagnosis / retry owner gate (devnet beta)

`POST /api/test/:id/diagnosis` and `POST /api/test/:id/retry-autotest` used
to require `test.companyAddr === signedWallet`. On devnet beta that check
is **intentionally dropped** — any signed wallet may regenerate. Rationale:
lets the team and demo viewers drive the full flow without needing to hold
the exact owner key. `requireSignedRequest` still gates both routes, so
anonymous writes are still refused. When promoting to mainnet, re-instate
the owner check in `apps/api/src/routes/test.ts` at the `/retry-autotest`
and `/:id/diagnosis` handlers (the deleted lines are in the
`feat(api,web): realtime dashboard + loosened diagnosis gate` commit).

## Experiment Dashboard

- `/experiment` — list of active tests. Tests where `manualCount === 0 ||
  personaCount === 0` are tagged **`pending comparison`** so users know
  up front that the dashboard will be partial. Don't filter them out —
  one-sided tests still have a detail page users may want to reach.
- `/experiment/[testId]` — charts + Key findings + By-cohort + **Cohort ×
  checklist matrix** + per-item breakdown. When `manual.count === 0 ||
  persona.count === 0` the page renders a single-side banner and
  **hides** cohort / convergence / confusion / paired scatter / rating
  distribution — those panels either show fake agreement or broken
  charts when one side is empty (we hit this on a test with 3 humans
  + 0 personas: rating histogram plotted the persona=0 bucket as a tall
  bar). Keep: headline, findings, per-item breakdown.
- `/api/reports/compare/:testId` — aggregates headline + cohort metrics +
  findings + **`by_cohort_item`** cross-table. Each cell carries
  `{cohort, itemId, humanN, personaN, humanFailRate, personaFailRate,
  flag}` with flag ∈ `both-fail | persona-worse | human-worse |
  both-pass | split | insufficient`. `insufficient` fires whenever
  either side has n<2 so a cell is always either actionable or clearly
  unreadable — not misleadingly shown as "0%/0%".
- `CohortMetrics` numeric fields (`humanMeanQuality`, `personaMeanQuality`,
  `qualityAbsDiff`, `itemAgreementRate`, `ksStatisticQuality`) are
  **nullable when their side is empty** (see `services/comparison.ts`
  `computeCohortMetrics`). Previously `|0 − personaMean|` rendered as a
  real gap in the dashboard; `findings.ts` + the UI now skip null cells.
- Cohort key defaults to `crypto_experience` (4 buckets). Matching personas
  to humans within same demographic reveals "persona ≈ human at 100% in
  novice cohort, diverges in expert cohort" — the real investor story.

## Company Test Dashboard (`/company/test/[testId]`, 2026-04-28)

8-section spec built on top of `/api/test/:id` aggregates. Sections
in render order — keep this contract; the spec was the result of an
explicit design discussion ("8섹션 spec") and reordering breaks the
intended company-facing narrative:

| § | Section | Source | Notes |
|---|---|---|---|
| 1 | Hero KPIs (4 cards) | `/api/test/:id/insights` | Personas Tested · Pain Points (count) · Avg Quality · Completion Rate |
| 2 | Why Users Drop (chat bubbles) | aggregated voice samples | Top pain points as direct persona quotes — no analysis text |
| 3 | Persona Insights (3 cards) | per-persona breakdown | Quality + completion + freeText snippet, max 3 |
| 4 | Funnel | `/api/test/:id/funnel` | Auto-extracted (see below). Cards per step + furthest_step distribution |
| 5 | Advanced Settings panel | `PATCH /api/test/:id/settings` | Inputs: `compare_with_test_id`, `monthly_visitors`, `conversion_value`, `current_conversion_rate` |
| 6 | A/B Comparison | `compareWithTestId` | Side-by-side metrics vs another test ID. Hidden when not set |
| 7 | Revenue Impact | `monthly_visitors × conversion_rate × conversion_value` | Hidden when inputs not set |
| 8 | Raw Data accordion | `/api/test/:id/insights` | Unfiltered aggregate JSON for debugging |

Only the Funnel and Advanced Settings inputs introduce new state.
Everything else is a different shape over data the diagnosis
aggregator already produces — do not re-fetch the raw reports per
card.

### Funnel auto-extraction (`services/scoring/funnel.ts`, 2026-04-28)

Funnel is **NOT** company-input — it's auto-extracted from session
data via Haiku per-session + clustering, mirroring the diagnosis
pain-point pipeline. The user explicitly pushed back on the
"company fills in funnel steps" UX ("Funnel은 자동으로 할 수 있는거
아니야?"); do not regress to input-driven.

Pipeline:

1. `extractFurthestStep(report)` — single Haiku call per session,
   given the persona's checklist + scenario log, returns the farthest
   step the user got to in human-readable text (e.g. "스왑 확인 모달",
   "트랜잭션 확인").
2. `clusterFunnelSteps(extractions)` — single Haiku call collapses
   semantic duplicates ("스왑 확인 모달" + "swap confirmation modal"
   → one canonical step). Identity-map fallback on LLM failure.
3. `buildFunnelFromExtractions()` — pure aggregator, returns
   `{steps[], total, distribution}`.
4. `generateFunnelForTest(testId)` — top-level orchestrator, persists
   to `tests.funnelJson` + `funnelGeneratedAt` + `funnelReportCount`.

Endpoints:
- `GET /api/test/:id/funnel` — cached read; auto-regen when stale
  (report count changed since last generation).
- `POST /api/test/:id/funnel/regenerate` — explicit refresh
  (rate-limited).

### New endpoints + schema columns (2026-04-28)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/test/:id/insights` | GET | Slim aggregator wrapping `aggregateForDiagnosis` for dashboard reads |
| `/api/test/:id/funnel` | GET | Cached funnel; auto-regen on stale |
| `/api/test/:id/funnel/regenerate` | POST | Force refresh (rate-limited) |
| `/api/test/:id/settings` | PATCH | Update `compareWithTestId` / `monthlyVisitors` / `conversionValue` / `currentConversionRate` (signed request + `updateTestSettingsBodySchema`) |

New `tests` table columns (drizzle migrations 0003 + 0004):
- `funnelJson jsonb` — cached funnel payload
- `funnelGeneratedAt timestamptz`
- `funnelReportCount int` — staleness check
- `compareWithTestId uuid` — A/B Comparison target
- `monthlyVisitors int`, `conversionValue numeric`, `currentConversionRate numeric` — Revenue Impact inputs

Mirror these in `apps/web/lib/api.ts`: `getInsights`, `getFunnel`,
`regenerateFunnel`, `updateSettings` methods. The web UI only ever
reads through these.

## Diagnosis validation pipeline (`services/scoring/diagnosis.ts`)

A UX diagnosis for a test is **audit-grounded markdown** — every claim
traces back to a concrete report row, and the reader sees up front how
much to trust persona-derived findings. Four mechanisms layered on top
of the base Sonnet synthesis call:

### 1. Audit-chain citations
- `PainPointCitation` carries `{reportId, evidenceTurn, isPersona,
  personaTester, severity, description}`. The synthesis prompt instructs
  the model to cite sources as `[<reportId8>·t<turn>]` and
  `validateAuditCitations()` scans the output for any id not present in
  the aggregate's `perPersona[].reportId`.
- Unknown citations get a trailing `> ⚠ **Audit check**: N citation(s)
  reference report IDs not in this test's data` footer — the
  DiagnosisMarkdown UI renders this as a red warning card.
- The validator regex matches **only inside `[...]` brackets** —
  matching bare hex across the whole document was a bug that flagged
  hex colour codes like `14F195` (Solana brand) as hallucinated report
  IDs. There's a dedicated regression test for this.

### 2. Confirmation labels (both / human-only / persona-only)
- Pain-points are sourced from two places: persona reports' upstream
  `_structured_report` sentinel (from Stagehand+Node scoring), and a
  Task-#12 Haiku pass that extracts pain-points from **manual reports'**
  free-text. Without the second pass, confirmation labels were
  permanently "persona-only" — humans had no seat in the pain-point map.
- Each `painPointFrequency` entry splits citations by `isPersona` and
  the prompt is required to tag each pain-point with
  `confirmation: both | human-only | persona-only`. UI convention:
  persona-only gets a "수동 재현 필요" caveat in the reliability
  section.

### 3. Semantic clustering (unlock "both" label)
- Before rendering, `clusterPainPointDescriptions()` batches every
  description into a single Haiku call that groups semantically
  equivalent phrasings — "로그인 벽 접근 불가" and "지갑 연결 시 진입
  차단" collapse into one canonical cluster. Without this, the
  whitespace+lowercase dedup in `normalizeStr()` left each phrasing
  as its own entry and `both` never fired.
- Failure mode is identity-map (each description as its own cluster),
  not a crash — a transient LLM outage still ships a diagnosis.
- Cost ~$0.0015/diagnosis. Exported so tests can mock `client.messages.
  create` via `vi.mock('../services/anthropic_client.js', …)`.

### 4. Fidelity gate banner
- `computeFidelityBand(itemAgreementRate, pairedCount)` → `'high' |
  'medium' | 'low' | 'n/a'`. Thresholds mirror `services/findings.ts`
  (paired ≥ 5 + agreement ≥ 0.6 ⇒ high, ≥ 0.4 ⇒ medium, else low; 0
  paired ⇒ n/a). Prepended to the markdown output as a blockquote with
  one of `⚠️ / ✅ / ℹ️ / 🟡` so the DiagnosisMarkdown React component
  can pick it out and render as a coloured banner card.
- Recommendations are required by prompt to carry
  `[해결 대상: N순위 <pain point 이름>]` so R1..Rn trace back to
  specific pain points. The LLM is allowed to say
  `[해결 대상: 없음 — <alternative evidence>]` when no rank fits,
  which is preferred over inventing a rank.

### 5. Empty-session guard + harness-error split (2026-04-25 hardening)

When stagehand crashed before capturing observations, the Haiku
`structured_report` and Sonnet `checklist` calls were grounding on
checklist task text rather than evidence — inventing plausible
narratives ("mobile viewport drop", "JSON parse mid-session") that
the diagnosis aggregator then promoted to rank-1 product findings.
Five layered fixes lock this down:

- **`scoring/report.ts`** — `outcome=error && turns.length<=1` short-
  circuits the Haiku call and returns an explicit no-data report with
  empty `pain_points`. Tests assert `mockCreate.not.toHaveBeenCalled()`.
- **`scoring/checklist.ts`** — same guard, routes to
  `ruleBasedFallback` (which produces the generic `세션 error로 시도
  불가` memo) instead of asking Sonnet to judge nothing.
- **`scoring/diagnosis.ts`** — `isHarnessErrorOutcome(outcome)` predicate
  + new `DiagnosisAggregate.harnessErrorReports[]` field. The
  `accumulatePainPointsForReport` helper (extracted, exported,
  testable) drops `outcome=error` reports' pain_points from
  `painPointMap` and pushes them into `harnessErrorReports` instead.
  Conservative — only the literal `'error'` label triggers; `unknown`
  and empty preserve their findings (manual reports without `_quality_
  breakdown` sentinels stay in the rank).
- **Synthesis prompt §5-1** — new "세션 실패 (harnessErrorReports)"
  section. The prompt instructs the model to label these as `41R 플랫폼
  자동화 실패`, NOT product issues, and to never produce R-recs for
  them. `buildSynthesisPayload` (exported pure builder) carries the
  list, capped at 30 entries, with shortened reportIds matching the
  audit-chain format.
- **jup.ag regression fixture** — 14 errored personas reproduced in
  `diagnosis.test.ts` `accumulatePainPointsForReport · jup.ag
  regression` block. Asserts `painPointMap.size === 0` +
  `harnessErrorReports.length === 14` for the legacy fixture shape so
  a future refactor of the inner loop can't silently regress.

### Session-error sentinel (`_session_error`, 2026-04-25)

Companion RCA infra. When stagehand crashes (init failure, top-level
catch, or zero-turn collapse), `captureSessionError(err, phase,
lastAction?)` (exported from `services/stagehand_hybrid.ts`) bounds
err.message ≤ 2000, stack ≤ 2000, last_action ≤ 500 and stuffs them
into `HybridSessionLog.session_error`. The route handler then writes
a `_session_error` sentinel into `test_reports.questionnaireAnswers`
— same conditional pattern as `_quirks` / `_quality_breakdown`. No
schema change. RCA queries can now group failures by phase
(`init` / `phase_a..d` / `final` / `cleanup`) + last_action without
re-running the persona.

### Client-side rendering split (`components` in page.tsx files)
- `/company/test/[id]` diagnosis tab parses the markdown into
  `{banner, body, auditWarning}` via `parseDiagnosisMarkdown()`, then
  renders each as a separate styled card. Don't hand the raw markdown
  back to `ReactMarkdown` — the banner + audit-footer would turn into
  plain blockquotes and lose their colour coding.
- `/report/[reportId]` renders a **Structured Report** section parsed
  from the `_structured_report` sentinel: summary + ux_scores bars +
  pain_points (severity chips + evidence_turn) + positive_signals +
  recommendations. Before Task #22 this data was stored but never
  surfaced — the filter-only codepath hid it entirely. `_structured_
  report` / `_quality_breakdown` / `_source` / `_quirks` are still
  filtered out of the generic Questionnaire Answers list; the
  Structured Report section is the structured rendering.

## Audience-Fit Validator (`/validator/*` + `/api/scan/*`, audited 2026-05-02)

A separate product surface from the autotest/diagnosis pipeline.
Measures **audience-fit** across 8 cohorts × 5 dimensions instead of
running per-persona browser sessions. Pure capture-and-score: one
screenshot per scan, ~100 LLM persona reactions, weighted aggregate.

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
- Route tags used by the diagnosis pipeline:
  `diagnosis` (Sonnet synthesis),
  `diagnosis.cluster_pain_points` (Haiku semantic clustering),
  `diagnosis.human_pain_points` (Haiku per-manual-report extraction).
  Each diagnosis run is one `diagnosis` + one `cluster_pain_points` +
  N `human_pain_points` (parallel across manual reports with no
  upstream `_structured_report` sentinel).

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
- Hardcode KPIs / sparklines / activity back into `apps/web/app/page.tsx`.
  Every widget on the landing must read from `dashboardApi.get(role, wallet)`
  so the page stays live. If you need a new metric, add it to
  `services/dashboard.ts` and surface it through the same payload.
- Re-add the owner check on `POST /api/test/:id/diagnosis` or
  `/retry-autotest` while on devnet beta — it's intentionally off (see
  Landing Dashboard §). Flip it back on as part of the mainnet hardening
  checklist, not as a drive-by fix.
- Replace the semantic clustering pass in `diagnosis.ts` with
  whitespace+lowercase dedup. `normalizeStr()` still exists as a
  **fallback** for when the clusterer has no input or the LLM call
  fails; making it the primary path permanently blocks the `both`
  confirmation label from ever firing (same phrasing from a human and
  a persona become two separate entries).
- Hand raw `_structured_report` / `_quality_breakdown` / `_source` /
  `_quirks` sentinels to `ReactMarkdown` or the Questionnaire Answers
  list — they're internal sentinels, not user-facing answers. Parse
  them into the Structured Report section on `/report/[id]` (see
  Diagnosis validation pipeline §).
- Render the experiment page's cohort / convergence / confusion /
  paired-scatter / rating-distribution panels when `manual.count === 0
  || persona.count === 0`. They either silently show "0%" (reads as
  "perfect agreement") or plot the zero bucket as a tall bar. The
  single-side banner + hidden sections is the contract.
- Leave `DEV_TEST_KEY` set on the production API longer than the
  window needed to run the dev harness. `/api/dev/*` bypasses payment
  verification and signed-request auth; the key must be rotated/removed
  as soon as validation is done. `railway variable delete DEV_TEST_KEY
  --service api && railway redeploy -y --service api` flips the routes
  back to 404 (dev_auth.ts gate).
- Remove the empty-session guards in `scoring/report.ts` /
  `scoring/checklist.ts`. They short-circuit the LLM call when
  `outcome=error && turns≤1`; reverting to the LLM path means Haiku /
  Sonnet immediately go back to inventing plausible failure narratives
  ("mobile viewport drop", "JSON parse mid-session") that the
  diagnosis aggregator promotes to rank-1 product findings. The
  regression tests in `scoring-report.test.ts` /
  `scoring-checklist.test.ts` lock this in via
  `mockCreate.not.toHaveBeenCalled()` — don't relax those assertions.
- Drop `harnessErrorReports` from `DiagnosisAggregate` or fold it
  back into `painPointFrequency`. Top-rank product findings get
  contaminated with infra failures the second this split disappears
  (jup.ag had 14 errored personas show up as rank-1 "테스트 환경
  제약" before the split landed). The regression suite in
  `diagnosis.test.ts` `accumulatePainPointsForReport · jup.ag
  regression` is the safety net.
- Remove the per-LLM-call 90s timeout (`SCORING_TIMEOUT_MS`) or the
  outer 12-min hardcut (`PERSIST_HARDCUT_MS`) in
  `runStagehandHybridAndPersist`. The inner stagehand 5-min hardcut
  covers only the browser portion; the post-stagehand scoring chain +
  R2 + DB had no upper bound and could wedge the chain.then() in
  /autotest/trigger indefinitely. `raceWithTimeout` + `TimeoutError`
  exported from `stagehand_hybrid.ts` — reuse, don't reimplement.
- Inline the queue dedup in `dev.ts` again. Use the
  `selectQueueableJobs` helper — `matchPersonas` can return 2
  personas sharing one testerAddr, and inlining the loop loses the
  in-batch dedup that prevents the wasted-compute symptom (full
  run + scoring → unique-constraint throw on insert).
- Mutate / unset `DEV_TEST_KEY` while a stagehand chain is in flight.
  `routes/dev.ts` runs personas sequentially via in-process
  `chain.then()`; setting or removing the env var triggers a Railway
  redeploy that kills the current process and drops every queued
  persona's run on the floor. Workflow: poll `/api/dev/snapshot/:id`
  until `reports_by_mode.stagehand_hybrid` reaches the expected count
  before deleting the key.
- Assume `enable_auto_test=true` (or `/api/dev/autotest/trigger`)
  produces a final diagnosis report. The autotest queue lands the
  raw reports only — `diagnosisMd` stays null until you explicitly
  call `POST /api/dev/diagnosis/generate` (or the signed
  `POST /api/test/:id/diagnosis`). The aitmpl ee2ad897 walkthrough
  hit this gap; if a UX flow needs a diagnosis at the end, chain the
  call yourself.
- Reorder or hide sections in the Company Test Dashboard
  (`/company/test/[id]`) without explicit need. The 8-section spec
  (Hero KPIs → Why Users Drop → Persona Insights → Funnel → Advanced
  Settings → A/B Comparison → Revenue Impact → Raw Data) was an
  explicit design decision; A/B and Revenue panels conditionally hide
  when their inputs are unset, but the others stay in order. New
  metrics belong inside an existing section (or as a new one), not
  shuffled in front.
- Reintroduce input-driven funnel UX. Funnel steps are
  auto-extracted by Haiku from session data
  (`services/scoring/funnel.ts`); the user explicitly rejected the
  "company fills in funnel steps" flow ("Funnel은 자동으로 할 수 있는거
  아니야?"). If the LLM extraction is wrong, fix the prompt or add a
  manual override field, but do not make manual the default path.
- Polling for non-404 responses with a body grep that includes
  `error` as one of the alternations — `{"error":"Not found"}` matches
  and the loop exits early. Use the HTTP status code (`curl -o /dev/null
  -w "%{http_code}"`) when waiting for a Railway redeploy.
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

## Dev harness (`/api/dev/*`)

One-shot endpoints for driving the full pipeline without the wallet-
signing loop. Entire router is mounted only when `DEV_TEST_KEY` is set
(≥12 chars) — absent env ⇒ 404 via `middleware/dev_auth.ts`, which
**loads `.env` at module init** (ESM imports run before `index.ts`'s
`dotenv.config`, so without that early load the key-gate never fires
in local dev).

Routes:
- `POST /tester` — create a tester wallet + profile (idempotent)
- `POST /test` — create a test + auto-generate test cases via LLM
  (long-running, ~90s on fresh target — use timeout ≥ 180s from clients)
- `POST /report/manual` — submit a human report, runs quality scoring
  + bumps `testsDone`
- `POST /persona/recompute` — run `recomputePersona` (requires
  testsDone ≥ 3). Returns `{personaId, versionNum, ...}` — note
  **camelCase**, not snake_case; earlier E2E scripts missed the key
  and silently got `id=undefined`.
- `POST /autotest/trigger` — queue stagehand_hybrid + text runs for
  matching personas (or a specific `persona_id`). Fire-and-forget:
  the chain resolves in background, poll `/snapshot/:test_id` to see
  `reports_by_mode: {stagehand_hybrid, text, manual}` increment.
- `POST /diagnosis/generate` — full `generateAndStoreDiagnosis` pass
- `POST /flow/full` — one-shot orchestration: company + test + test
  cases + queue persona runs + create manual tester wallets (does not
  submit manual reports; caller runs `/report/manual` per wallet).

Key: sent via `x-dev-key` header on every call. The sentinel `204`
test-count + `diagnosis.test.ts` verify the router is gated when the
env var is absent.

### End-to-end run via dev harness (canonical workflow)

When kicking off a full test on prod for verification, this is the
sequence that worked for the aitmpl ee2ad897 walkthrough — keep it
in mind as the reference flow:

```bash
# 1. Set temporary key + wait for redeploy
DEV_KEY=$(openssl rand -hex 16)
railway variable set "DEV_TEST_KEY=$DEV_KEY" --service api
until [ "$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST https://api.../api/dev/tester \
    -H "x-dev-key: $DEV_KEY" -d '{}')" = "200" ]; do sleep 8; done

# 2. Register test with auto-trigger (returns test_id, queued personas)
curl -X POST .../api/dev/test -H "x-dev-key: $DEV_KEY" \
    --max-time 180 \
    -d '{"target_url":"...","requirements":"...","enable_auto_test":true}'

# 3. Poll until expected stagehand_hybrid count lands
#    (3 personas → ~15-30 min total wall time, sequential chain)
until [ "$(curl ... | jq '.reports_by_mode.stagehand_hybrid')" -ge "3" ]; do
    sleep 60
done

# 4. Verify R2 video URLs (per report, parse _session_video sentinel)
# 5. Generate diagnosis EXPLICITLY (autotest queue does not chain it)
curl -X POST .../api/dev/diagnosis/generate -H "x-dev-key: $DEV_KEY" \
    -d '{"test_id":"..."}'

# 6. Remove key + verify 404
railway variable delete DEV_TEST_KEY --service api
until [ "$(curl ... -o /dev/null -w "%{http_code}")" = "404" ]; do sleep 8; done
```

Two quirks worth memorizing:
- Step 3's wall time is ~5-10 min per persona because the
  stagehand_hybrid chain is sequential (text mode runs in parallel,
  so its 3 reports land in the first ~3 min).
- Step 5 is what's missing if a UX flow shows reports but the
  diagnosis tab is empty. The "최종리포트가 없는데" failure case.

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

The **3-layer trust contract** the diagnosis ships with (fidelity band →
confirmation label → audit citation) is what turns "LLM wrote an essay"
into "reader can verify every claim traces to a report row". When
considering a change that relaxes any of these, think in terms of what
breaks if a company reads a persona-only pain point as a real product
defect — the `both` / `human-only` / `persona-only` split is how we
prevent that failure mode, and the semantic clustering pass is what
makes that split meaningful.
