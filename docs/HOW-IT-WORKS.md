# How the Audience-Fit Validator Works

A code-grounded walkthrough of the scan pipeline: what runs when a
user clicks **Analyze**, which LLM calls happen at which stage, how
each persona's response is turned into numbers, and why the
aggregation produces a defensible audience-fit score.

Every claim below cites the file and line range where the behaviour
is implemented, so a reader can verify against source. Where the
documentation in source disagrees with the actual code, or where the
reader should be careful about a known limitation, the section is
marked **⚠️**.

> **Audited:** 2026-05-07. Test suite at this audit: 199 vitest
> cases passing.

> Korean translation: [`docs/HOW-IT-WORKS.ko.md`](./HOW-IT-WORKS.ko.md)

---

## 1. The product in one paragraph

A scan takes a URL, captures the page once, asks ~100 simulated
personas (Mode A) or ~50 audience-matched personas (Mode B) to react
to that screenshot, and produces a 0-100 **audience-fit score** plus
diagnostic context (per-cohort breakdown, friction clusters,
visitor-traffic-weighted projection, AARRR funnel). Personas don't
browse — they react to a single screenshot. There are no real users
in the loop; the trust contract rests on cohort-aggregate signals,
not on individual persona predictions.

---

## 2. Pipeline at a glance

`POST /api/scan` returns immediately with `{ scanId, status: 'pending' }`
and kicks off a fire-and-forget worker. The worker drives the scan
through 5 status transitions written back to the `audience_fit_scans`
row.

```
POST /api/scan
   → routes/scan.ts:54-91   INSERT audience_fit_scans (status=pending)
                            startScanWorker(scan.id)
                            res.json({ scanId, status })
   ↓
startScanWorker
   → scan_pipeline.ts:130-144   setImmediate(runScan)
                                catch → status='failed'
   ↓
runScan(scanId)                 scan_pipeline.ts:147+
   ├─ Step 0  capturing       captureSite() + classifySite()
   │                          → audience_fit_scans.{captureScreenshotUrls,
   │                            category, categoryConfidence, oneLinePitch}
   ├─ Step 1  sampling        load active personas
   │                          → Mode A: selectPersonasForCohorts (8 cohorts)
   │                          → Mode B: parseAudience + selectPersonasForAudience
   ├─ Step 2  responding      runPersonaResponseLLM() per persona
   │                          (concurrency=5, default)
   │                          → INSERT scan_persona_responses
   ├─ Step 3  aggregating     persistCohortAggregate per cohort
   │                          computeAudienceFit(cohorts)
   │                          → INSERT scan_cohort_results
   ├─ Step 3.5  friction      clusterFrictions(scanId)
   │             clustering   → audience_fit_scans.frictionsJson
   └─ Step 4  completed       UPDATE audience_fit_scans
                              status, audienceFitScore, best/worst, etc.
```

Source: every numbered step is implemented in
`apps/api/src/services/scan_pipeline.ts` and the helpers it imports.

The status field is updated at each transition via `setStatus(scanId, …)`
so the `/api/scan/:id/report` polling endpoint can surface progress
to the UI in real time.

---

## 3. LLM call catalog

Four distinct LLM call sites cover the entire pipeline. All run
through `services/anthropic_client.ts::withRoute(label, …)` so
usage logging tags every call by purpose. Tags are documented in
`CLAUDE.md` under "LLM Usage Tracking".

| # | Route tag | Model | When | Cost / call | Source |
|---|---|---|---|---|---|
| 1 | `validator.classify_site` | Haiku (vision) | once per scan, after capture | ~$0.0008 | `services/site_classifier.ts:115-128` |
| 2 | `validator.parse_audience` | Haiku (text) | Mode B only, once per scan | ~$0.0005 | `services/dimensions/audience_parser.ts` |
| 3 | `validator.persona_response` | Sonnet (vision) when `USE_VISION=1`, else Haiku (text) | per persona | Sonnet ~$0.01-0.05 / Haiku ~$0.001 | `services/dimensions/llm.ts:343-399` |
| 4 | `validator.cluster_frictions` | Haiku (text) | once per scan, after responses | ~$0.003 | `services/dimensions/frictions.ts:184-194` |

Model identifiers are resolved through env vars with sensible
defaults at `apps/api/src/config/env.ts:69-70`:

```
CLAUDE_SONNET_MODEL  default  claude-sonnet-4-6
CLAUDE_HAIKU_MODEL   default  claude-haiku-4-5-20251001
```

re-exported as `SCORING_MODELS = { sonnet, haiku }` from
`services/llm.ts:137-140`.

Per-scan total at default settings (USE_VISION=0, ~112 personas,
Mode A): **≈ $0.11-0.15 per scan**, dominated by the 112 persona
calls. With `USE_VISION=1` (Sonnet vision), per-scan cost rises to
**≈ $1.20-5.60** depending on screenshot size and persona response
length.

---

## 4. The persona response: input contract, output contract

This is the single most important LLM call. It runs ~112 times per
Mode A scan (~50 times per Mode B), and its output is the only thing
the downstream math depends on. Source: `services/dimensions/llm.ts`.

### 4.1 What the persona sees

`buildUserPrompt` (llm.ts:187-247) constructs a text prompt with up
to 4 sections:

```
Target URL: <url>

Site context (third-party classification — read this BEFORE forming an opinion):
  category: <Category> (confidence: <0.0-1.0>)
  description: <one-line pitch from classifySite>
  Anchor your reaction to THIS category. Do not project features
  (wallet, signing, on-chain UX, etc.) that this category does not include.

Persona profile:
  voice_sample: "<sample sentence from PersonaVector>"
  age_group: <teen|young_adult|adult|senior>
  tech_literacy: 0.00-1.00
  crypto_experience: 0.00-1.00
  design_sensitivity: 0.00-1.00
  patience_level: 0.00-1.00
  mobile_first: <bool>
  visual_style_pref: <minimal|rich|playful|professional>
  expertise.{defi,nft,general_web}: 0.00-1.00
  feedback.{security_aware,ui_critical,detail_oriented}: 0.00-1.00

Company hypothesis to probe: "<optional hypothesis text>"

Respond with EXACTLY this JSON shape (replace every example value):
<SCHEMA_TEMPLATE JSON>

RULES:
  ...
```

When `USE_VISION=1` and the capture step produced screenshot URLs,
the user message is built as `[image_block, …, text_block]` instead
of text-only, and the model is switched to Sonnet
(`llm.ts:354-377`).

### 4.2 The system prompt — engagement honesty

The system prompt (`llm.ts:98-117`) explicitly forces the model to
mark `engagement.category=abandon` when the persona-site fit is
weak, and gives a reference distribution:

> Reference distribution across all visitors (engagement.category):
> abandon ~50%   skim ~25%   browse ~17%   engage ~5%   extended ~3%

This is the load-bearing instruction that prevents personas from
all collapsing into "browse" (which would erase audience signal).
The mapping from these 5 bands to numeric scores is in
`services/audience_fit.ts:47-53`:

```ts
abandon=10, skim=30, browse=55, engage=75, extended=90
```

### 4.3 Output schema (Zod)

The full JSON schema is locked at `llm.ts:42-79`:

```
happiness: { sus_responses: number[10], raw_score 0-100, voice_first_impression }
engagement: { category: 5-enum, interaction_depth_estimate 0-50, abandon_likely_at, voice_friction }
adoption: { signup_likelihood 0-1, primary_barrier, trigger_to_signup }
retention: { category: 4-enum, expected_return_window: 4-enum, return_motivation_text }
task_success: { core_action_understood, completion_likelihood 0-1, blocking_friction, voice_attempt }
voice_quotes: { biggest_friction, would_return_because, if_could_change_one_thing }
self_consistency_check: { happiness_retention_aligned: bool, alignment_note }
```

Schema mismatch → Zod throws → `runPersonaAndPersist` records the
row as `isFlagged=true` instead of crashing the scan
(`scan_pipeline.ts:720-744`). This is the *anti-fabrication* lock:
a persona that returns malformed JSON is excluded from cohort means,
not silently zero'd.

### 4.4 Mapping LLM output → 5 dimension scores

`mapLLMResponseToSimulated` (llm.ts:250-296) is where the LLM JSON
becomes numbers the aggregator can sum. Five scores, all 0-100:

| Dimension | Source field | Formula |
|---|---|---|
| `happiness` | `happiness.sus_responses` (10 Likerts) | `computeSusScore()` — canonical SUS-10: odd-position items → `r-1`, even → `5-r`, sum × 2.5 (`audience_fit.ts:82-96`) |
| `engagement` | `engagement.category` | band → score lookup (audience_fit.ts:47-53) |
| `adoption` | `adoption.signup_likelihood` | × 100 |
| `retention_d7` | `retention.category` | band → D-curve, take `d7` field (audience_fit.ts:60-70) |
| `task_success` | `task_success.completion_likelihood` | × 100 |

Two **defense-in-depth clamps** apply when `engagement.category=abandon`
(llm.ts:265-269):
- `signup_likelihood` ≤ 0.05 (cap at 5% — abandoners don't sign up)
- `completion_likelihood` ≤ 0.05 (cap at 5% — abandoners don't finish tasks)
- `retention_band` forced to `no_return`

These exist because Haiku occasionally drifts and emits
"abandoned but would sign up", which would inflate downstream
adoption means. Clamping post-hoc keeps the cohort math consistent
even if the model fails to follow the system prompt.

`is_flagged` is set when `self_consistency_check.happiness_retention_aligned`
is false, i.e. when `happiness > 70 AND retention=no_return` (or the
inverse). Flagged rows are **excluded from cohort means**
(`scan_pipeline.ts:812`).

---

## 5. Cohort selection (sampling step)

`apps/api/src/services/cohort_selection.ts` is a pure function: given
the active persona pool and a list of `CohortDef`s, it produces a
`Map<cohort_id, PersonaRow[]>` with each persona assigned to **at
most one** cohort.

### 5.1 Why each persona goes to exactly one cohort

A 30-something mobile-first DeFi expert satisfies BOTH `crypto_native`
AND `mobile_power` selectors. If the same persona was double-counted
in both cohort means, the means would be correlated artefacts of the
same individual, not independent measurements of two distinct
audiences. Source comment: `cohort_selection.ts:1-12`.

### 5.2 Assignment algorithm

`selectPersonasForCohorts` (cohort_selection.ts:103-146) implements
quota-aware closest-fit assignment:

1. Sort personas by `vector.reliability.quality_score` desc (highest-
   quality personas claim first).
2. For each persona: list cohorts whose `selector` matches via
   `matchesSelector` (axis-by-axis range / categorical check), sort by
   L2 distance from selector midpoint via `distanceToSelector`.
3. Walk those candidate cohorts; assign to the first one whose
   bucket has not yet hit `target_n` (default 14). If all matching
   cohorts are full, the persona ends up in `unassigned`.

Matching axes (cohort_selection.ts:43-57): `tech_literacy`,
`crypto_experience`, `design_sensitivity`, `patience_level`,
`expertise_defi`, `expertise_nft`, `expertise_general_web`,
`ui_critical`, `security_aware`, `detail_oriented`, plus categorical
`age_group` and `mobile_first`.

### 5.3 Mode B: progressive relaxation

`selectPersonasForAudience` (cohort_selection.ts:174-210) is the
Mode B path. Given a parsed `CohortSelector` and `targetN=50`:

- Strict-match all personas; if the count is below `minN=10`, drop
  the **narrowest** numeric range constraint (smallest `hi - lo`)
  and re-match. Repeat until ≥ `minN` matches.
- `age_group` and `mobile_first` are NEVER relaxed (categorical;
  user named them explicitly).
- Sort by L2 distance, break ties by `quality_score`, take top
  `targetN`.

This guarantees Mode B always produces some persona pool even when
the verbatim parsed audience is too narrow to populate naturally.

---

## 6. Cohort aggregation: dimension means → cohort_fit_score

After all per-persona LLM calls land, each cohort's bucket of valid
(non-flagged) `PersonaDimensionScores` rows is reduced to one number
via `audience_fit.ts:145-153`:

```
cohort_fit_score = engagement   × 0.30
                 + task_success × 0.30
                 + happiness    × 0.25
                 + adoption     × 0.10
                 + retention_d7 × 0.05
```

(Weights from `DIMENSION_WEIGHTS_V1`, `audience_fit.ts:30-36`.)

### Why these weights

Source comment (`audience_fit.ts:25-29`): the spec §4.2 confidence
ratings drove the ordering. **Engagement and task-success have the
highest measurement confidence** in the persona simulation literature
(intent ≈ action correlation is reasonable), so they take 0.30 each.
**Happiness via SUS** is well-validated as a usability signal, hence
0.25. **Adoption (intent to sign up)** has measurable but degraded
signal vs real conversion → 0.10. **Retention is calibration-poor**
in persona simulation (r=0.18 at calibration time per the comment),
so it stays at 0.05 — the data is collected for future calibration
but doesn't drive the score.

### Bootstrap CI

Each `cohort_fit_score` carries a 95% confidence interval computed
by resampling the per-persona scores 1000 times with replacement and
taking the [2.5%, 97.5%] percentiles (`audience_fit.ts:164-194`).
For n<3, CI collapses to the point estimate (statistical CI is
meaningless on tiny samples). Stored in `scan_cohort_results.cohort_fit_ci_low/high`.

---

## 7. Top-level audience-fit synthesis (Option A)

`computeAudienceFit` (`audience_fit.ts:221-261`) takes per-cohort
fits and produces the headline 0-100 number:

```
audience_fit_score =
    0.40 × best_cohort_fit_score
  + 0.30 × median_cohort_fit_score
  + 0.20 × global_task_success_avg
  + 0.10 × global_sentiment_avg
```

(Weights at `audience_fit.ts:39-44`.)

`global_task_success_avg` and `global_sentiment_avg` are the
**n-completed-weighted** averages of those dimensions across all
cohorts (audience_fit.ts:234-244). This guards against an under-quota
cohort (e.g. only 3 personas matched) dominating the global average.

### Why "best + median" instead of "mean across cohorts"

Source comment (`audience_fit.ts:1-23`): the spec's earlier "PMF
Survival Score" composite had three structural flaws:
1. **cohort_diversity penalty** — penalised niche-PMF wins (a
   product that resonates strongly with one audience and gets
   ignored by the other 7 should NOT score lower than a mediocre
   product that scores 50 across all 8).
2. **retention weighted 0.20** — contradicted §4.2's "Very Low"
   confidence rating.
3. **task_success weighted 0.10** — contradicted §4.2's "High"
   confidence rating.

The 0.40-best-cohort weighting is what lets the validator say
"strong fit with cohort X, weak with the rest" honestly. The
0.30-median-cohort term keeps a single best-cohort outlier from
dominating — to score high, a product needs both a strong best AND
a non-collapsing middle of the distribution.

---

## 8. The visitor view — why two views exist

Apart from the *research panel* view above, the report also computes
a *visitor-weighted* view (`audience_fit.ts:302-379` and
`aarrr.ts:173-314`).

### What it measures

The panel view answers "if N personas from each of 8 cohorts engage
with this site, what's their aggregate fit?" — persona-conditional.

The visitor view answers "if real visitor traffic hit this site,
what fraction would activate / retain / convert?" — projection.

### How

For each cohort, the visitor view applies two priors from
`packages/shared/src/acquisition_priors.ts`:

```
arrival_share : fraction of typical site traffic from this cohort
                (sums to 1.0 across the 8 cohorts per category)
abandon_rate  : fraction of arrivals that bounce within 15 seconds
```

Then `applyAcquisitionWeights` (`audience_fit.ts:302-326`) computes
weighted dimension means as `engaged_dim × (1 - abandon_rate)` —
abandoners contribute 0 to every dimension. Global aggregates use
`arrival_share` weighting instead of `n_completed`.

### Why the AARRR visitor funnel uses additional INTENT_ACTION multipliers

Personas predict intent ("would I sign up?"), but real funnels
measure action ("did they sign up?"). Intent-action gap is well
documented in consumer research and grows stage-by-stage. Source
comment (`aarrr.ts:240-248`):

```ts
const INTENT_ACTION = {
  activation: 0.50,
  retention: 0.20,
  referral: 0.10,
  revenue: 0.05,
} as const;
```

These are **calibrated against Google Merch Store GA4 (n=1)**.

> ⚠️ **Known limitation 1** — universal multipliers compress site
> differences. The 2026-05-07 5-site test showed visitor-view
> Activation spread = 13pt and Revenue spread = 1.3pt across 5
> very different categories (E-commerce / Productivity / Media /
> AI / DeFi), because the constants dominate the formula. The
> panel view spread on the same 5 sites was 52pt (Activation) and
> 46pt (Revenue) — site differences are clearly preserved when
> the constants don't compress them. See CLAUDE.md "Known
> Limitations §2 — INTENT_ACTION multipliers are universal."

### Why the visitor view is *experimental — directional only*

The validator UI labels the visitor toggle as
`"experimental — directional only, not a traffic forecast"` and
leads with a `"BIGGEST LEAK"` callout that names the largest
stage-to-stage drop instead of the absolute %. Source: report page
toggle at `apps/web/app/validator/report/[scanId]/page.tsx:200-203`
and the AARRR funnel block helper at the same file. The framing
exists because the absolute weighted numbers overshoot real GA4
reality by 5-30× until per-category multipliers replace the universal
constants.

---

## 9. AARRR funnel (panel view = real semantics)

The panel-view AARRR funnel is the simpler of the two and has the
cleanest semantics. Source: `services/aarrr.ts:71-133`.

### 9.1 Cumulative filtering

```
acqSet         = valid (non-flagged) personas
activationSet  = acqSet         where task_success ≥ 30
retentionSet   = activationSet  where retention_d7 ≥ 5
referralSet    = retentionSet   where happiness ≥ 60
revenueSet     = referralSet    where adoption ≥ 30
```

Each stage is a **subset** of the previous stage's set — that's what
makes this a real funnel (monotonic non-increasing). Independent
filters could produce nonsense like Referral > Activation, which the
previous implementation actually did (source comment, `aarrr.ts:78-82`).

### 9.2 Why these specific thresholds

Source comment (`aarrr.ts:50-58`): the v1.1 retune (2026-05-06):
- **Retention 30 → 5**: observed persona distribution puts ~85% in
  the `weak` band (D7=5), only ~3% in `moderate` (≥30). The
  earlier `≥30` gate killed the funnel post-activation. `≥5` =
  "any return signal at all", with `no_return` (D7=0) still
  excluded.
- **Revenue 65 → 30**: observed adoption is mostly 0-50; `≥65`
  was unreachable. `≥30` = "meaningful purchase intent", still
  strict enough to drop the funnel.

> ⚠️ **Stale doc inside source** — the file header comment at
> `aarrr.ts:11-13` still names the *old* thresholds:
>
> ```
>   Retention    — Returns by D-7. Adds: retention_d7 >= 30.
>   Revenue      — Conversion likely. Adds: adoption >= 65.
> ```
>
> Actual code (`aarrr.ts:85, 87`) and the `THRESHOLDS` constant
> (`aarrr.ts:42-48`) use 5 and 30. The retune note (`aarrr.ts:50-58`)
> documents the change, but the file header was never updated.
> Reader of this doc: trust `THRESHOLDS` const + the per-stage
> filter expressions, not the file header.

---

## 10. Friction clustering

After all responses land, `clusterFrictions(scanId)` (`services/dimensions/frictions.ts:145-216`)
runs one Haiku call over the full set of `voice_biggest_friction`
strings per scan and groups them into 3-5 themed clusters.

### Pipeline

1. SELECT all non-empty `voice_biggest_friction` strings from
   `scan_persona_responses` (frictions.ts:146-160).
2. Build a numbered list `[i] (cohort=X) "<quote>"` and ask Haiku
   for an EXACT JSON array of 3-5 cluster objects, each with
   `title`, `summary`, `where`, `representative_quote`,
   `persona_indices`. System + rules: frictions.ts:171, 134-143.
3. `assembleFrictionClusters` (frictions.ts:55-111) takes the LLM
   output and:
   - sorts clusters by `n` descending,
   - caps at top 5,
   - **collects every persona index that the LLM didn't assign**
     into a "Other / long-tail" bucket and appends it,
   - assigns sequential `rank` numbers,
   - computes `impact = +Math.round(n / total × 30)` as a fit-cost
     estimate string.

### Why the long-tail bucket matters

Source comment (`frictions.ts:48-54`): the invariant is `Σ cluster.n
+ long_tail.n === items.length`. Without the long-tail append, the
LLM clusterer would silently drop 5-10% of friction inputs (anything
it couldn't theme cleanly). The long-tail bucket forces every
friction to appear in the report exactly once.

The "first quote" surfaced in the long-tail card is whichever
unassigned input was indexed first in the input list — this is why
the 2026-05-07 Google Merch case had a Korean-language long-tail
bucket: the Korean phrasing didn't cluster with the English ones,
landed in long-tail, and got displayed first. See CLAUDE.md
"Audience-Fit Validator §" + the 2026-05-07 hardening commits for
the full diagnostic story.

---

## 11. Why the architecture is defensible

Five design choices that protect against common failure modes of
synthetic-user research products:

1. **Voice cleanup (Q3 P1, 2026-05-07).** `crypto_native` /
   `web3_pro` / `defi_beginner` voice samples were rewritten to
   express the underlying *trait* (security_aware, fast-mover,
   power-user) without crypto-specific vocabulary. Voice is the
   dominant tone signal the LLM picks up, so a crypto persona
   looking at Spotify no longer parrots "MEV / slippage / wallet"
   complaints. Lock: `scripts/seed-validator-cohorts.ts:75-118`,
   regression tests in `apps/api/src/__tests__/dimension_llm.test.ts`.

2. **Site context threading (Q2, 2026-05-07).** `runPersonaResponseLLM`
   accepts a `SiteContext { category, categoryConfidence, oneLinePitch }`
   and the prompt includes `"Anchor your reaction to THIS category.
   Do not project features (wallet, signing, on-chain UX, etc.) that
   this category does not include."` (llm.ts:213-220). Stops a
   crypto-tilted persona from inventing wallet-connect frictions on a
   plain e-commerce page. Source diagnosis: 2026-05-07 hardening
   commits.

3. **Empty-screenshot defense.** `classifySite` and persona response
   both gracefully handle missing/unreadable images:
   - `classifySite` returns null on any failure → caller leaves the
     existing nulls (`site_classifier.ts:98-106, 130-135`).
   - `buildImageBlocks` skips local files it can't read; if the
     final array is empty, the persona LLM falls back to text-only
     Haiku (llm.ts:321-360).

4. **Self-consistency flag.** Each persona LLM response carries a
   `self_consistency_check.happiness_retention_aligned` boolean.
   When false (happiness>70 AND retention=no_return, or inverse),
   the row is marked `isFlagged=true` and **excluded from cohort
   means** (`scan_pipeline.ts:801-812`). Persona-level logic
   contradictions don't poison cohort-level numbers.

5. **Bootstrap CI on cohort_fit_score.** Each cohort row carries a
   95% CI computed via 1000-sample bootstrap on the per-persona
   scores. Reports surface the CI alongside the point estimate so
   small samples (n<14) read as wide bars instead of confident
   numbers (`audience_fit.ts:164-194`, `scan_cohort_results.cohort_fit_ci_low/high`).

---

## 12. Issues found while writing this doc

These are inconsistencies between the source code and either its
own comments or sibling documentation. None are runtime bugs — but
the next reader of those files will hit confusion if they trust the
stale text. Listed in order of highest-friction first.

1. **⚠️ aarrr.ts file-header comment lists the wrong thresholds.**
   Lines 11-13 say `retention_d7 >= 30` and `adoption >= 65`. The
   actual filter expressions (lines 85, 87) and the `THRESHOLDS`
   const (lines 42-48) use `≥ 5` and `≥ 30` per the v1.1 retune
   documented at lines 50-58. The header text was never updated.
   *Fix*: delete or rewrite lines 11-13 to match `THRESHOLDS`.

2. **⚠️ `lib/api.ts` has dead client methods.** The validator
   pivot deleted the autotest API surface (`/api/test/*`,
   `/api/report/*`, `/api/tester/*`) but `apps/web/lib/api.ts`
   still exports `testApi`, `reportApi`, `personaApi`, `testerApi`,
   `autoTestApi`, `dashboardApi`. Active validator pages call
   `scanApi` only. The legacy clients are documented in CLAUDE.md
   line 100 (Frontend conventions block) — that line is honest
   (the exports DO exist) but the methods themselves are dead code:
   any caller would 404. *Fix*: another refactor pass to drop the
   unused exports + their `signedRequest` plumbing, OR explicitly
   gate them behind a "preserved for future use" comment.

3. **⚠️ Wallet-signed nonce middleware has no live consumer.**
   `apps/api/src/middleware/auth.ts::requireSignedRequest` and the
   ed25519 verification flow exist (CLAUDE.md "Auth (Privy +
   middleware)" section confirms preservation). But all five
   active routes (`/api/auth`, `/api/scan`, `/api/calibration`,
   `/api/benchmark`, `/api/hello`) use `requirePrivyAuth` /
   `optionalPrivyAuth` — none use `requireSignedRequest`. The
   middleware is effectively dead until a future signed-mutation
   route lands.

4. **⚠️ persona-engine directory is a 565 MB ghost.** The
   `apps/persona-engine/` directory contains only `__pycache__`,
   `adapters/`, `tests/`, `sample-usage.jsonl` — `main.py`,
   `report_generator.py`, the `persona_agent` module are all
   gone. The validator pipeline does not call persona-engine at
   all (verified: only reference in active source is the env-var
   declarations at `config/env.ts`). The directory is preserved
   per CLAUDE.md "Architecture" note as dormant. *Fix candidate*:
   delete `apps/persona-engine/` and the env vars; if the future
   re-enable plan is real, move it to `archive/` instead.

5. **⚠️ INTENT_ACTION multipliers are universal (Merch n=1
   calibration).** Already documented in CLAUDE.md "Known
   Limitations §2". The multipliers compress visitor-view site
   differences toward Merch's calibration target, which is why
   the visitor toggle is labelled experimental. Until per-
   category GA4 reference data lands (Known Limitations §3),
   the panel view is the trustworthy comparison surface.

6. **⚠️ `services/dimensions/audience_parser.ts` is referenced
   but not deeply documented above.** Mode B's persona pool
   selection feeds off this LLM-parsed selector; for the purposes
   of THIS doc, treat it as a Haiku call that maps natural-
   language audience descriptions to a `CohortSelector` object.
   Detailed walkthrough deferred — the file should get its own
   short doc when Mode B becomes a primary surface.

---

## 13. Where to read code from here

| If you want to understand … | Start at |
|---|---|
| The full pipeline | `apps/api/src/services/scan_pipeline.ts` |
| Persona prompt + response shape | `apps/api/src/services/dimensions/llm.ts` |
| Cohort math + Option A formula | `apps/api/src/services/audience_fit.ts` |
| AARRR funnel rules | `apps/api/src/services/aarrr.ts` |
| Cohort assignment algorithm | `apps/api/src/services/cohort_selection.ts` |
| Friction clustering | `apps/api/src/services/dimensions/frictions.ts` |
| Site classifier prompt | `apps/api/src/services/site_classifier.ts` |
| Cohort definitions | `packages/shared/src/cohorts.ts` |
| Acquisition priors (visitor view) | `packages/shared/src/acquisition_priors.ts` |
| Test contracts / regression locks | `apps/api/src/__tests__/` |
| Open follow-ups + Do-NOTs | `CLAUDE.md` (project root) |
