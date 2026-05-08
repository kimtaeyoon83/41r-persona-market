# Persona Cohort Pool Redesign — Deferred

**Status**: Design agreed 2026-05-08. Implementation deferred — other work prioritized.

**Owner**: kimtayoon

**Tracks**: CLAUDE.md `Known Limitations §1` (Cohort pool is crypto-tilted)

---

## Problem

The current 8 STANDARD_COHORTS in [`packages/shared/src/cohorts.ts`](../packages/shared/src/cohorts.ts) include 3 crypto-flavored cohorts (`crypto_native`, `defi_beginner`, `web3_pro`) — that's **37.5% of the persona pool**.

On non-crypto sites this drives the rank-1 friction cluster to be "Wrong audience entirely" because crypto-cohort personas correctly identify themselves as the wrong target for, e.g., a productivity SaaS. The current 8 cohorts are also **demographic-axis-shaped** (age × tech literacy × mobile/desktop) rather than **evaluator-archetype-shaped** (who would actually visit and judge a landing page?).

### Evidence — linear.app scan (2026-05-08)

| Cohort | fit | |
|---|---:|---|
| designer_20s | 49.4 | |
| mobile_power | 43.6 | |
| defi_beginner | 39.4 | 🔴 |
| crypto_native | 39.2 | 🔴 |
| non_tech_30s | 35.6 | |
| web3_pro | 33.2 | 🔴 |
| senior | 24.0 | |
| teen_newcomer | 21.8 | |

- Crypto cohort score average: **37.3** (middle-of-pack)
- Non-crypto cohort average: **34.9**
- Top friction cluster "Unclear target audience and use case fit" (n=35) hit **7 of 8 cohorts**

**Insight**: Crypto cohorts didn't drag the *score* the most (senior + teen did). They dominated friction *quotes* visibility because their voice patterns are distinctive — making the friction list visually crypto-heavy when the actual score signal was more diffuse. The fix isn't reducing crypto presence in the pool to fix scores; it's redesigning the cohort axes around real product evaluators.

---

## Final design

### General 8 (always run, target_n=14)

| # | id | description | core selector axes |
|---|---|---|---|
| 1 | `saas_evaluator` | B2B PM / engineer buyer — features, integrations, pricing | high tech, desktop, detail-oriented |
| 2 | `investor` | VC / angel — pattern-matches on traction in 30 seconds | high tech, desktop, **low patience 0.1-0.4**, detail-oriented |
| 3 | `designer` | UI-critical creative (replaces current `designer_20s`, widened past age 20s) | design_sensitivity ≥0.7, ui_critical ≥0.5 |
| 4 | `mainstream_consumer` | B2C volume audience (NEW) | adult, mid tech, balanced axes |
| 5 | `mobile_young` | Teen / early-20s mobile-first (replaces `teen_newcomer`) | teen ∪ young_adult, mobile, low crypto |
| 6 | `senior` | 50+ low tech, accessibility-focused (current `senior` unchanged) | senior, tech 0-0.5, desktop |
| 7 | `non_tech_buyer` | 30-40s low tech B2C decision maker (replaces `non_tech_30s`, widened) | adult, tech 0.3-0.6, no crypto |
| 8 | `early_adopter` | AI / new-tech curious — currently missing archetype (NEW) | high tech, ai_tools ≥0.5, design_sensitivity 0.5-0.8 |

### Crypto add-on 1 (fires only when `scan.category ∈ {DeFi, NFT, Crypto Wallet}`)

| id | description | selector |
|---|---|---|
| `crypto_user` | Crypto-active across skill levels — replaces 3 overlapping crypto cohorts | crypto_experience 0.3-1.0, expertise_defi 0.3-1.0 |

### Result

| Scan category | Active cohorts | Persona count | Crypto voice share |
|---|---|---:|---:|
| Non-crypto (e.g. SaaS, E-commerce, Productivity) | 8 general | 112 | **0%** |
| Crypto (DeFi, NFT, Crypto Wallet) | 8 general + 1 crypto add-on | 126 | ~11% |

---

## Investor cohort selector

```ts
{
  id: 'investor',
  label: 'Investor',
  description: 'VC / angel — impatient, pattern-matches on traction signals',
  selector: {
    age_group: ['young_adult', 'adult'],
    tech_literacy: [0.7, 1.0],
    mobile_first: [false],         // desktop-first
    patience_level: [0.1, 0.4],    // 30-second skim
    detail_oriented: [0.6, 1.0],   // attention to traction / margin / team signals
  },
  target_n: 14,
}
```

### Voice sample direction (write 6-8 strings for `VOICE_BY_COHORT['investor']`)

- "Where's the ARR / MRR? Hero copy says 'used by teams' but no logos."
- "TAM claim is hand-wavy — no SAM/SOM breakdown."
- "Team page missing — who's behind this?"
- "Pricing is hidden → low-confidence revenue model."
- "Did they actually ship the AI agent feature, or is it 'coming soon'?"
- "Conversion-to-paid funnel: where does the data come from?"
- Pattern: traction / TAM / team / BM / shipping signals; impatient; specific dollar / metric language.

---

## Implementation order when work resumes

1. **`packages/shared/src/cohorts.ts`** — redefine the 9 selectors + update `CohortId` union type to match new ids.
2. **`scripts/seed-validator-cohorts.ts`** — write `VOICE_BY_COHORT` entries for the 4 new/changed cohorts (`saas_evaluator`, `investor`, `mainstream_consumer`, `early_adopter`). Existing personas stay (ON CONFLICT DO NOTHING is idempotent); new cohort personas seeded on top — pool grows to ~150-160.
3. **`apps/api/src/services/cohort_selection.ts`** — branch on `scan.category` to include `crypto_user` only for crypto categories. Default cohorts list comes from a new `defaultCohortsForCategory(category)` helper.
4. **`apps/api/src/services/scan_pipeline.ts`** — sampling step calls `defaultCohortsForCategory(scan.category)` instead of hardcoded `STANDARD_COHORTS`.
5. **`packages/shared/src/acquisition_priors.ts`** — **heaviest piece**: 96 entries (12 categories × 8 cohorts). Recompute `arrival_share` + `abandon_rate`, preserving the "sum=1.0±0.01 per category" invariant locked by `__tests__/acquisition_priors.test.ts`. Can ship #1+#3+#4 first and leave priors stale for one sprint — visitor-weighted view degrades gracefully (panel view stays correct).
6. **`CLAUDE.md`** `Known Limitations §1` → mark DONE; replace the entry with a brief "Phase 2 cohort split landed YYYY-MM-DD".

Estimated total: 1-2 sprints. Phase break: ship #1+#3+#4 first (immediate friction-list cleanup), then #2 (re-seed) → #5 (priors retune) as a follow-up sprint.

---

## What was considered and rejected

- **Keep 2 crypto cohorts (power user vs novice)** — rejected. The 3 current crypto cohorts overlap so heavily on selector axes that 1 broad cohort captures the same signal with less noise.
- **Mechanically replicate "general 8 + crypto 3" per CLAUDE.md §1** — rejected. The §1 note was a stub plan, not a designed plan. The current 8 cohorts are demographic-axis-shaped, not evaluator-shaped. New cohorts (`saas_evaluator`, `investor`, `early_adopter`) reflect who actually evaluates a landing page.
- **Friction clustering input filter as a stopgap** — rejected. Addresses the symptom (crypto voice in friction list) without fixing the cause (wrong cohorts in the pool). CLAUDE.md `§7` stays as a documented but unused option.

---

## Why this is deferred

Other features in the validator product are higher impact this sprint. The cohort redesign is a 1-2 sprint commitment that touches 6 files including a non-trivial DB seed step and the 96-entry priors retune. Sequencing it after current sprint priorities is a deliberate trade-off.

When unblocking: revisit this doc, follow Implementation order above, no re-design needed.
