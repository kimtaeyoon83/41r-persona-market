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
pnpm --filter api test      # Run vitest (238 tests)
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
