# Report Generation Pipeline — Step-by-Step Data Flow

A walkthrough of every step from `POST /api/scan` through to the rendered report page. **What data goes in, what processing happens, what output flows to the next step** — traced against the actual code.

> **As of**: 2026-05-11. Companion docs: [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) (topic-by-topic deep dive) + [`CLAUDE.md`](../CLAUDE.md) (engineering conventions + Do-NOT rules). This doc focuses on the **chronological pipeline trace**. Korean mirror: [`REPORT-PIPELINE.ko.md`](REPORT-PIPELINE.ko.md).

---

## 0. Trigger

**User action**: `POST /api/scan { target_url, mode, hypothesis?, target_cohorts? }`

| Field | Detail |
|---|---|
| Route | `apps/api/src/routes/scan.ts:55-91` |
| Processing | `INSERT audience_fit_scans (status='pending')` → `startScanWorker(scan.id)` fires off a background worker |
| Immediate response | `{ scanId, status: 'pending' }` (the worker runs separately, async) |
| Worker entry point | `services/scan_pipeline.ts::runScan(scanId)` |

**DB status transitions**: `pending → capturing → sampling → responding → aggregating → completed`

`setStatus()` updates the row at each transition. The UI polls `/api/scan/:id/report` every 800ms and re-renders as progressive state lands.

---

## Step 0: capturing (screenshot + classification + custom questions)

### 0.a — Playwright capture

| | |
|---|---|
| Code | `services/site_capture.ts::captureSite()` |
| Input | `target_url` |
| Processing | Headless Chromium loads the site, then captures (i) a full-page PNG and (ii) a viewport-crop PNG. Uploaded to Cloudflare R2 (or `/tmp/site-captures/` in dev) |
| Output | `string[2]` URLs → `audience_fit_scans.captureScreenshotUrls` (jsonb) |
| Cost / time | ~$0 + 5-10s |

### 0.b — Site classification (Haiku vision)

| | |
|---|---|
| Code | `services/site_classifier.ts::classifySite()` |
| Input | viewport-crop PNG + URL |
| Processing | One Claude **Haiku 4.5 vision** call via `withRoute('validator.classify_site', ...)`. Response validated with Zod schema |
| Output | `{ category, category_confidence, one_line_pitch }` → `audience_fit_scans.{category, categoryConfidence, oneLinePitch}` |

Example output:
```json
{ "category": "Productivity",
  "category_confidence": 0.92,
  "one_line_pitch": "The product development system for teams and agents..." }
```

### 0.c — Site-specific survey questions (Phase 5, Haiku vision)

| | |
|---|---|
| Code | `services/dimensions/custom_questions.ts::generateCustomQuestions()` |
| Input | screenshot + category + pitch |
| Processing | One Haiku vision call generates 3-5 site-specific questions (mix of Likert + free-text) |
| Output | `Array<{ id, type: 'likert'\|'text', question, dimension_hint? }>` → `audience_fit_scans.customQuestions` |

→ Step 0 total cost: ~$0.002/scan (2 Haiku calls), time: ~5-10s

---

## Step 1: sampling (persona selection)

| | |
|---|---|
| Code | `services/cohort_selection.ts::selectPersonasForCohorts()` (Mode A) or `selectPersonasForAudience()` (Mode B) |
| Input | All rows from the `personas` table + `scan.mode` + `scan.targetCohorts` (Mode A optional filter) or `scan.targetAudienceText` (Mode B) |

### Mode A — Discovery

1. Sort all personas by `quality_score` descending
2. For each persona, match its `vector` (20 axes — demographic + expertise + feedback_pattern + ux_preferences) against each `CohortSelector` range
3. Among matching cohorts, sort by L2 distance and place into the closest cohort bucket (up to `target_n=14`)
4. Personas that fail every cohort match end up `unassigned` (excluded from the scan)

→ **~112 personas selected (8 cohorts × 14)**

### Mode B — Verification

1. `services/dimensions/audience_parser.ts::parseAudience(targetAudienceText)` — Haiku call converts the natural-language audience description into a `CohortSelector` jsonb
2. Personas matching that selector are sorted by L2 distance and the top ≤50 are picked
3. Progressive relaxation if too few match (narrowest numeric axis constraints drop first)

→ **Single bucket, ≤50 personas selected**

| | |
|---|---|
| Output | `Map<cohortId, PersonaRow[]>` — passed in **memory only** to the next step, no DB write |

---

## Step 2: responding (persona response — the core LLM step)

One LLM call per persona, parallelized with concurrency=5.

### Input (per persona)

```ts
{
  persona_vector: { demographics, expertise, voice_sample, ... },
  hypothesis: scan.hypothesis,                              // user input
  site_context: { category, categoryConfidence, oneLinePitch },  // ⭐ Q2 fix — prevents non-crypto sites from triggering crypto-feature hallucinations
  screenshot_url: scan.captureScreenshotUrls[0],
}
```

### Processing: `services/dimensions/llm.ts::runPersonaResponseLLM()`

1. **Build system prompt** — the persona's `voice_sample` (tone primer) + a one-liner identity hint compressed from demographics
2. **Build user prompt** — hypothesis + site context + Zod output schema (`personaResponseSchema` lines 42-79)
3. **Invoke LLM** — `withRoute('validator.persona_response', ...)`
   - `USE_VISION=1` (production): Claude **Sonnet 4.6 vision** — screenshot + text simultaneously (multimodal — the model sees the page like a human reading it)
   - `USE_VISION=0` (dev iteration): Claude **Haiku 4.5 text-only** — low-cost mode, screenshot ignored
4. **Output JSON** (Zod-validated):
   ```json
   {
     "happiness": { "sus_responses": [1-5]×10, "raw_score": 0-100, "voice_first_impression": "..." },
     "engagement": { "category": "browse", "voice_engagement": "..." },
     "adoption": { "signup_likelihood": 0-1, "voice_signup": "..." },
     "retention": { "category": "weak", "voice_retention": "..." },
     "task_success": { "completion_likelihood": 0-1, "voice_biggest_friction": "..." },
     "voice_quotes": { "if_could_change_one_thing": "...", "would_return_because": "..." },
     "self_consistency_check": { "happiness_retention_aligned": boolean }
   }
   ```

### Score conversion (constants from `services/audience_fit.ts`)

| Dimension | LLM output | Conversion | Final score (0-100) |
|---|---|---|---|
| happiness | `sus_responses[10]` (1-5 Likert) | `computeSusScore()` — standard SUS-10 formula | 0-100 |
| engagement | `category` (`abandon`..`extended`) | `ENGAGEMENT_BAND_TO_SCORE` mapping | 10 / 30 / 55 / 75 / 90 |
| adoption | `signup_likelihood` (0-1) | `× 100` | 0-100 |
| retention_d7 | `category` (`no_return`..`strong`) | `RETENTION_BAND_TO_DCURVE.d7` | 0 / 5 / 30 / 55 |
| task_success | `completion_likelihood` (0-1) | `× 100` | 0-100 |

### Output: `scan_persona_responses` table

One row per persona, each containing:
- Raw LLM JSON (`rawResponse` jsonb — no need to re-call the LLM on re-aggregation)
- Converted 5 scores (`happinessScore`, `engagementScore`, `adoptionScore`, `retentionScore`, `taskSuccessScore`)
- Voice quotes ×4 (`voiceFirstImpression`, `voiceBiggestFriction`, `voiceSignup`, `voiceEngagement`)
- `isFlagged` — true if `self_consistency_check` failed (excluded from aggregation)
- `cohort_id` (bucket assigned in the sampling step)

→ The `audience_fit_scans.{personasCompleted, personasFlagged}` counters increment in step with inserts.

→ **Cost**: with Sonnet vision, ~112 calls × ~$0.001-0.005 = **$0.10-0.50 per scan** (~90% of total cost, ~3 min wall-clock).

---

## Step 3: aggregating (cohort math → headline score → frictions → funnel)

### 3.a — Per-cohort aggregation

| | |
|---|---|
| Code | `services/audience_fit.ts::computeCohortFitScore()` |
| Input | `scan_persona_responses` rows for this scan, grouped by cohort |
| Processing | 1. Filter `is_flagged=false` — only personas that passed self-consistency<br>2. Arithmetic mean of each dimension<br>3. `cohort_fit_score = 0.30·eng + 0.30·tsk + 0.25·hap + 0.10·ado + 0.05·ret` (DIMENSION_WEIGHTS_V1)<br>4. Bootstrap CI (1000 samples, 95%) → `cohort_fit_ci_low`, `cohort_fit_ci_high` |
| Output | `scan_cohort_results` rows (one per cohort) — `cohort_id`, `cohort_label`, `n_completed`, `n_flagged`, `cohort_fit_score`, `cohort_fit_ci_low/high`, 5 dimension means |

### 3.b — Headline synthesis (Option A)

| | |
|---|---|
| Code | `services/audience_fit.ts::computeAudienceFit()` |
| Input | Every cohort's `cohort_fit_score` + per-cohort dimension means |
| Processing | **Mode A**:<br>· `best` = max(cohort scores), `worst` = min, `median` = middle value<br>· `global_task_success_avg`, `global_sentiment_avg` (= happiness×0.7 + adoption×0.3) — weighted average across cohorts<br>· `audience_fit_score = 0.4·best + 0.3·median + 0.2·task_global + 0.1·sentiment_global`<br><br>**Mode B**: single bucket, so `audience_fit_score = cohort_fit_score` (no best/worst/median split) |
| Output | Updates the scan row: `audience_fit_score`, `best_cohort_id/score`, `worst_*`, `median_*`, `global_*` |

### 3.c — Friction clustering (Haiku)

| | |
|---|---|
| Code | `services/dimensions/frictions.ts::clusterFrictions()` + pure helper `assembleFrictionClusters()` |
| Input | Every persona's `voice_biggest_friction` string + `cohort_id` (after `is_flagged=false` filter) |
| Processing | 1. Haiku prompt: "Group these N voice quotes by semantic similarity into 3-5 themed clusters; for each cluster return a representative quote + where (page/step) + persona indices."<br>2. Pure helper guarantees any quote not assigned to a named cluster → **"Other / long-tail frictions"** bucket<br>3. Invariant: cluster `n` sum + long-tail = `items.length` (silent drops forbidden) |
| Output | `audience_fit_scans.frictionsJson` array — rank 1-5 + long-tail. Each cluster: `{ title, summary, n, where, impact, quote, affected_cohorts[] }` |

### 3.d — AARRR funnel (cumulative)

| | |
|---|---|
| Code | `services/aarrr.ts::computeAarrrFromRows()` |
| Input | Same `scan_persona_responses` rows |
| Processing | **Each stage is a subset of the previous stage's passing personas** (cumulative — guarantees monotonic non-increasing shape):<br>· Acquisition: all personas (baseline 100%)<br>· Activation: subset where `task_success ≥ 30`<br>· Retention: above + `retention_d7 ≥ 5` (v1.1 threshold)<br>· Referral: above + `happiness ≥ 60`<br>· Revenue: above + `adoption ≥ 30` (v1.1)<br><br>Each stage score: `(passing_count / total) × 100` |
| Output | `AarrrFunnel { stages: AarrrStage[5], total_personas }` — **computed at response time, not persisted to DB** |

### 3.e — Visitor-weighted view (optional, Phase B v1.1, currently locked in UI)

| | |
|---|---|
| Code | `services/audience_fit.ts::computeWeightedAudienceFit()`, `services/aarrr.ts::computeAarrrWeightedFromRows()` |
| Input | Cohort-level results + `packages/shared/src/acquisition_priors.ts` (12 categories × 8 cohorts arrival_share + abandon_rate table) |
| Processing | Re-weight cohort scores by category-specific priors + apply `INTENT_ACTION` multipliers (0.50 / 0.20 / 0.10 / 0.05) to estimate a visitor-traffic scenario |
| Output | `audience_fit_scans` response includes `weighted` + `aarrr_weighted` fields. **However, the UI currently shows "Coming in next version"** (Merch GA4 n=1 calibration limitation; will unlock once additional GA4 reference data lands) |

---

## Step 4: completed → response serialization

When `audience_fit_scans.status = 'completed'`, polling stops. The `GET /api/scan/:id/report` response bundle:

```ts
{
  scan: {
    id, target_url, category, category_confidence, one_line_pitch,
    mode, status, personas_attempted, personas_completed, personas_flagged,
    weights_version, target_audience_text, mode_b_verdict, mode_b_parsed_selector,
    custom_questions,                          // Phase 5
    created_at, completed_at,
  },
  result: {
    audience_fit_score,
    best:   { cohort_id, cohort_label, cohort_fit_score },
    worst:  { cohort_id, cohort_label, cohort_fit_score },
    median_score,
    global_task_success_avg, global_sentiment_avg,
    weighted?: { ... },                        // Acquisition Layer v1.1
  },
  cohorts: ScanCohortResult[],                 // 8-cohort breakdown
  fit_personas: ScanPersonaCard[],             // top 10 high-fit
  non_fit_personas: ScanPersonaCard[],         // top 10 low-fit
  frictions: ScanFriction[],                   // rank 1-5 + long-tail
  retention_curve: { d, v }[],                 // D1 / D7 / D30 curve
  dimension_breakdown: ChipData[],             // 5 dimension chips
  aarrr: AarrrFunnel | null,                   // Mode A only
  aarrr_weighted?: AarrrFunnel | null,         // Acquisition Layer v1.1 (UI locked)
  recent_responses: ScanRecentResponse[],      // latest 8 (streaming-effect UI)
  cohort_progress: ScanCohortProgress[],       // progress strip
  survey_response_count,                       // Phase 5
  human_aggregate_computed,                    // Phase 5
}
```

The report page (`apps/web/app/validator/report/[scanId]/page.tsx`) renders this JSON directly — almost no client-side derivation.

---

## Step 5: Phase 5 — Human comparison (async, separate flow)

After the scan completes, the operator shares the survey link (`/validator/survey/<scanId>`) with respondents. As responses accumulate, the operator clicks "Compare with humans (n=X) →" on the report page. This triggers a parallel pipeline.

### 5.a — Human response collection (per submission)

| | |
|---|---|
| Route | `POST /api/scan/:id/survey` (Phase 5.1: **requirePrivyAuth**) |
| Input | sus_responses (10), engagement_category, signup_likelihood, retention_category, completion_likelihood, voice (4 quotes), demographics, custom_answers |
| Processing | 1. `userId = req.privyUser.id`<br>2. Score on the same 5 axes as the AI side using mirror functions (`computeSusScoreLocal`, `HUMAN_ENGAGEMENT_TO_SCORE`, `HUMAN_RETENTION_TO_D7`)<br>3. Append 5 rows to `calibration_records` (legacy operator-team aggregator)<br>4. **Upsert** into `survey_responses` on `(scan_id, user_id)` UNIQUE — resubmitting overwrites all jsonb fields and bumps `submittedAt` |
| Output | One `survey_responses` row (per user, per scan) + 5 `calibration_records` rows |

### 5.b — Human aggregate trigger (operator manual)

| | |
|---|---|
| Route | `POST /api/scan/:id/human-aggregate` |
| Code | `services/human_aggregate.ts::recomputeHumanAggregate(scanId)` |
| Input | All `survey_responses` rows for the scan + `audience_fit_scans.customQuestions` |
| Processing | **Strict mirror of the AI side**:<br><br>1. **Score per respondent** — same constants as AI (`ENGAGEMENT_TO_SCORE`, `RETENTION_TO_D7`, `computeSusScore`)<br>2. **Single-bucket fit score** — apply `DIMENSION_WEIGHTS_V1` to respondent means (Mode-B-style collapse)<br>3. **Friction clustering** — **re-uses** the `assembleFrictionClusters()` pure helper. The Haiku call is in-module (`validator.cluster_human_frictions`) with a different prompt — inputs are voice quotes (4 fields) + free-text custom answers, all tagged `cohort='human'`.<br>· If `n_respondents < 3`, skip Haiku and short-circuit to a single "Raw human voice" bucket (Haiku produces unstable clusters on small samples)<br>4. **AARRR funnel** — **re-uses** `computeAarrrFromRows()` pure helper with the same v1.1 thresholds<br>5. **Custom question rollup** — Likert mean + Text quotes (up to 3) |
| Output | `audience_fit_scans.human_aggregate` jsonb (single row, idempotent overwrite) |

`HumanAggregate` shape:
```ts
{
  n_respondents: number,
  audience_fit_score: number,
  dimension_means: { happiness, task_success, adoption, retention_d7, engagement },
  frictions: FrictionCluster[] | null,
  aarrr: AarrrFunnel | null,
  custom_question_rollup: {
    [qid]: { likert?: { mean, n_answered }; quotes?: string[] }
  },
  computed_at: ISO-8601,
}
```

### 5.c — Compare response + diff computation

| | |
|---|---|
| Route | `GET /api/scan/:id/compare` |
| Input | `audience_fit_scans` row (`audienceFitScore`, `frictionsJson`, `humanAggregate`) + `scan_cohort_results` (for AI dimension means via weighted average) |
| Processing | 1. AI `dimension_means` — weighted by cohort `n_completed` (mirrors the `wAvg()` pattern in the `/survey` handler)<br>2. Expose `human_aggregate` as-is (null if not yet computed)<br>3. Compute `diff`:<br>· `audience_fit_delta = human − ai`<br>· `dimension_deltas` per axis<br>· `friction_overlap` — token-overlap heuristic on cluster titles (lowercase + 3+ char tokens), 0-1<br>· `{ai,human}_only_frictions` — top 3 each |
| Output | `{ scan, ai, human, diff, survey_response_count }` → rendered directly by `/validator/compare/[scanId]` |

---

## End-to-end flow diagram

```
target_url (POST /api/scan)
  ↓
[Playwright capture] → 2 PNGs → R2 → captureScreenshotUrls
  ↓ status='capturing'
[Haiku vision ×1] → category, confidence, pitch → scan row
  ↓
[Haiku vision ×1] → custom_questions[] → scan row
  ↓ status='sampling'
[cohort_selection] → in-memory persona buckets (Mode A: 8×14=112 / Mode B: ≤50)
  ↓ status='responding'
[Sonnet vision ×N personas, concurrency=5] → 5-axis + voice JSON each
  ↓ (score conversion: SUS-10 / band→score / × 100)
INSERT scan_persona_responses (N rows)
  ↓ status='aggregating'
[cohort aggregation ×K cohorts] → scan_cohort_results
  - cohort_fit_score (DIMENSION_WEIGHTS_V1)
  - bootstrap CI
  ↓
[Option A synthesis] → audience_fit_score, best/worst/median → scan row
  ↓
[Haiku friction clustering ×1] → frictions_json → scan row
  ↓
[computeAarrrFromRows] → aarrr funnel (computed at response time)
  ↓ status='completed'
GET /api/scan/:id/report returns the full bundle
  ↓
─────────── (async, hours/days later) ───────────
  ↓
Humans fill /validator/survey/<scanId> (Privy auth)
  ↓
[POST /survey × N humans] → survey_responses upsert(scan_id, user_id)
  ↓
Operator clicks "Compare with humans"
  ↓
[recomputeHumanAggregate]
  - same AI-side scoring constants
  - same DIMENSION_WEIGHTS_V1 formula (single bucket)
  - re-uses assembleFrictionClusters + computeAarrrFromRows
  → audience_fit_scans.human_aggregate
  ↓
GET /api/scan/:id/compare → { ai, human, diff } → /validator/compare page
```

---

## Locked invariants (6, enforced by tests)

Unit-tested in `apps/api/src/__tests__/audience_fit_helpers.test.ts` + `scan_shapers.test.ts`:

1. `audience_fit_score = 0.4·best + 0.3·median + 0.2·task_global + 0.1·sentiment_global` (Mode A, Option A)
2. Mode B: `audience_fit_score = cohort_fit_score` (single bucket)
3. Per-persona: happiness = SUS-10, task = completion×100, adoption = signup×100, engagement = BAND_TO_SCORE, retention_d7 = BAND_TO_DCURVE
4. `cohort_fit_score = 0.30·eng + 0.30·tsk + 0.25·hap + 0.10·ado + 0.05·ret` (DIMENSION_WEIGHTS_V1)
5. AARRR cumulative — each stage is a subset of the previous (monotonic non-increasing)
6. Friction clustering — cluster `n` sum + long-tail = `items.length` (no silent drops)

---

## Cost / time summary (Mode A baseline)

| Step | LLM calls | Cost estimate | Time |
|---|---|---|---|
| Step 0.a Playwright capture | 0 | $0 | ~5-10s |
| Step 0.b classify_site (Haiku vision) | 1 | ~$0.0008 | ~3s |
| Step 0.c custom_questions (Haiku vision) | 1 | ~$0.001 | ~5s |
| Step 1 sampling | 0 | $0 | <1s |
| Step 2 persona responses (Sonnet vision) | ~112 | $0.10-0.50 | ~2-3min |
| Step 3.c friction clustering (Haiku) | 1 | ~$0.003 | ~5-10s |
| **Total** | **~115 LLM calls** | **~$0.11-0.51** | **~3-4 min** |

Phase 5 (per human-aggregate trigger): one extra friction clustering call (`validator.cluster_human_frictions`, ~$0.003) — skipped when `n_respondents < 3`.

LLM usage is logged by the `withRoute(tag, ...)` wrapper to `USAGE_LOG_PATH` (`/tmp/llm-usage.jsonl`). `scripts/usage-summary.ts` aggregates by route + model.

---

## Where to read code from here

| If you want to understand … | Start at |
|---|---|
| The full pipeline orchestration | `apps/api/src/services/scan_pipeline.ts` |
| Persona prompt + response schema | `apps/api/src/services/dimensions/llm.ts` |
| Cohort math + Option A formula | `apps/api/src/services/audience_fit.ts` |
| AARRR rules | `apps/api/src/services/aarrr.ts` |
| Persona assignment algorithm | `apps/api/src/services/cohort_selection.ts` |
| Friction clustering | `apps/api/src/services/dimensions/frictions.ts` |
| Site-specific question generator (Phase 5) | `apps/api/src/services/dimensions/custom_questions.ts` |
| Human aggregate (Phase 5) | `apps/api/src/services/human_aggregate.ts` |
| `/api/me/survey-responses` endpoints | `apps/api/src/routes/me_responses.ts` |
| Cohort definitions | `packages/shared/src/cohorts.ts` |
| Acquisition priors (visitor view) | `packages/shared/src/acquisition_priors.ts` |
| Tests (math invariant locks) | `apps/api/src/__tests__/` |
| Engineering conventions + Do-NOTs | `CLAUDE.md` (repo root) |
| Deeper topic-by-topic walkthrough | [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) / [`HOW-IT-WORKS.ko.md`](HOW-IT-WORKS.ko.md) |
