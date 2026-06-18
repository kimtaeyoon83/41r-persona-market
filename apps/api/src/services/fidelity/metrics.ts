// Fidelity PoC — measurement core (Stage 1 / T0, no chain).
//
// Design doc RPM v0.4 §11 names the FIRST thing to build: prove that the
// persona↔human signal is decision-grade BEFORE building any chain
// infra. This module is that measurement, as a pure, testable core.
//
// It answers two questions the doc insists on keeping separate from a
// single aggregate ρ (§8 "충실도 주의" / investor-narrative contract):
//
//   1. PER-COHORT fidelity — within a matched demographic cohort, how
//      far apart are AI persona dimension means and real human means?
//      Surfaced as by-cohort |Δ|, NEVER a single mixed-cohort number.
//
//   2. "WHICH VARIANT WINS" ranking accuracy — across site variants
//      (multiple scans), does the AI's ranking by audience-fit match the
//      humans' ranking? This is the decision-grade signal (§8: "절대 효과
//      크기 추정이 아니라 상대 순위"). Relative order matters, not the
//      absolute number.
//
// Pure: takes already-fetched rows, returns structured results. The DB
// wrapper that feeds it lives separately (pure-helper extraction
// pattern — see audience_fit_helpers / scan_shapers). No I/O here.

import { STANDARD_COHORTS, COHORT_BY_ID } from '@41rpm/shared';

// ─── Dimensions ─────────────────────────────────────────────────────
// Same 5 axes the AI pipeline (scan_persona_responses) and the human
// aggregate (human_aggregate.ts) both score, 0-100.
export type Dimension =
  | 'happiness'
  | 'engagement'
  | 'adoption'
  | 'retentionD7'
  | 'taskSuccess';

export const DIMENSIONS: readonly Dimension[] = [
  'happiness',
  'engagement',
  'adoption',
  'retentionD7',
  'taskSuccess',
];

export type DimensionScores = Record<Dimension, number>;

// ─── Human → cohort matching ────────────────────────────────────────
// Real survey respondents self-report only 4 axes
// (survey_responses.demographics), but STANDARD_COHORTS selectors
// constrain up to ~13. So the strict matchesSelector() in
// cohort_selection.ts (built for full PersonaVectors) is NOT reused
// here — it would reject every human against any cohort that hinges on
// an unreported axis (e.g. designer_20s needs design_sensitivity).
//
// Instead we score each cohort by the fraction of its *evaluable*
// constraints (those on axes the human reports) the human satisfies,
// and report a `confidence` that penalizes cohorts relying on unknown
// axes. Honest about partial information — "claim only what you verify".

export type HumanDemographics = {
  age_group: 'teen' | 'young_adult' | 'adult' | 'senior';
  tech_literacy: number; // 0-1
  crypto_experience: number; // 0-1
  mobile_first: boolean;
};

export type CohortMatch = {
  cohortId: string;
  /** (satisfied evaluable constraints) / (total selector constraints).
   *  Cohorts hinging on axes the human can't report score lower. */
  confidence: number;
  evaluableConstraints: number;
  totalConstraints: number;
};

function inRange(x: number, [lo, hi]: [number, number]): boolean {
  return Number.isFinite(x) && x >= lo && x <= hi;
}

/**
 * Assign one human to the best-fitting STANDARD_COHORT, or null when no
 * cohort has even one evaluable constraint the human fully satisfies.
 *
 * Ranking: all evaluable constraints satisfied (score 1) wins; ties
 * broken by more evaluable constraints (more of the human was actually
 * checked → more trustworthy), then higher confidence, then cohort
 * declaration order (deterministic).
 */
export function matchHumanToCohort(
  demo: HumanDemographics,
  cohorts: readonly { id: string; selector: Record<string, unknown> }[] = STANDARD_COHORTS,
): CohortMatch | null {
  let best: (CohortMatch & { score: number; order: number }) | null = null;

  cohorts.forEach((cohort, order) => {
    const sel = cohort.selector as {
      age_group?: HumanDemographics['age_group'][];
      tech_literacy?: [number, number];
      crypto_experience?: [number, number];
      mobile_first?: boolean[];
      [k: string]: unknown;
    };

    const totalConstraints = Object.keys(sel).filter(
      (k) => sel[k] !== undefined,
    ).length;

    let evaluable = 0;
    let satisfied = 0;

    if (sel.age_group !== undefined) {
      evaluable++;
      if (sel.age_group.includes(demo.age_group)) satisfied++;
    }
    if (sel.tech_literacy !== undefined) {
      evaluable++;
      if (inRange(demo.tech_literacy, sel.tech_literacy)) satisfied++;
    }
    if (sel.crypto_experience !== undefined) {
      evaluable++;
      if (inRange(demo.crypto_experience, sel.crypto_experience)) satisfied++;
    }
    if (sel.mobile_first !== undefined) {
      evaluable++;
      if (sel.mobile_first.includes(demo.mobile_first)) satisfied++;
    }

    // A cohort only competes if every constraint we COULD check passed
    // and at least one was checkable.
    if (evaluable === 0 || satisfied < evaluable) return;

    const score = satisfied / evaluable; // == 1 here by the guard above
    const confidence = totalConstraints > 0 ? satisfied / totalConstraints : 0;
    const candidate = {
      cohortId: cohort.id,
      confidence,
      evaluableConstraints: evaluable,
      totalConstraints,
      score,
      order,
    };

    if (
      best === null ||
      candidate.score > best.score ||
      (candidate.score === best.score &&
        candidate.evaluableConstraints > best.evaluableConstraints) ||
      (candidate.score === best.score &&
        candidate.evaluableConstraints === best.evaluableConstraints &&
        candidate.confidence > best.confidence)
    ) {
      best = candidate;
    }
  });

  if (best === null) return null;
  const b: CohortMatch & { score: number; order: number } = best;
  return {
    cohortId: b.cohortId,
    confidence: b.confidence,
    evaluableConstraints: b.evaluableConstraints,
    totalConstraints: b.totalConstraints,
  };
}

// ─── Means + per-cohort fidelity ────────────────────────────────────

/** Per-dimension mean over rows; null when rows is empty. */
export function meanScores(
  rows: readonly DimensionScores[],
): DimensionScores | null {
  if (rows.length === 0) return null;
  const out = {} as DimensionScores;
  for (const dim of DIMENSIONS) {
    let s = 0;
    for (const r of rows) s += r[dim];
    out[dim] = s / rows.length;
  }
  return out;
}

export type CohortFidelity = {
  cohortId: string;
  cohortLabel: string;
  nAi: number;
  nHuman: number;
  aiMeans: DimensionScores | null;
  humanMeans: DimensionScores | null;
  /** ai - human, per dimension. null unless BOTH sides have ≥1 row. */
  delta: DimensionScores | null;
  /** mean |Δ| across the 5 dimensions — the headline per-cohort fidelity
   *  number (lower = AI closer to humans). null unless both sides ≥1. */
  absDeltaMean: number | null;
  /** mean match confidence of the humans bucketed into this cohort. */
  matchConfidenceMean: number | null;
};

/**
 * Build one fidelity row per cohort that has AI personas and/or matched
 * humans. Δ and |Δ| are only computed where BOTH sides have data — a
 * cohort with AI but no humans (or vice versa) reports counts + means
 * but a null delta, never a fabricated comparison.
 */
export function computeCohortFidelity(input: {
  /** Non-flagged AI persona dimension scores, grouped by cohort id. */
  aiByCohort: ReadonlyMap<string, readonly DimensionScores[]>;
  /** Humans with their dimension scores and cohort match (null = unmatched). */
  humans: readonly { scores: DimensionScores; match: CohortMatch | null }[];
}): CohortFidelity[] {
  const humansByCohort = new Map<
    string,
    { scores: DimensionScores; confidence: number }[]
  >();
  for (const h of input.humans) {
    if (!h.match) continue;
    const list = humansByCohort.get(h.match.cohortId) ?? [];
    list.push({ scores: h.scores, confidence: h.match.confidence });
    humansByCohort.set(h.match.cohortId, list);
  }

  const cohortIds = new Set<string>([
    ...input.aiByCohort.keys(),
    ...humansByCohort.keys(),
  ]);

  const out: CohortFidelity[] = [];
  for (const cohort of STANDARD_COHORTS) {
    if (!cohortIds.has(cohort.id)) continue;
    out.push(buildCohortRow(cohort.id, input.aiByCohort, humansByCohort));
    cohortIds.delete(cohort.id);
  }
  // Any cohort ids not in STANDARD_COHORTS (e.g. Mode B 'custom_audience')
  // still get a row, after the canonical 8, for completeness.
  for (const id of cohortIds) {
    out.push(buildCohortRow(id, input.aiByCohort, humansByCohort));
  }
  return out;
}

function buildCohortRow(
  cohortId: string,
  aiByCohort: ReadonlyMap<string, readonly DimensionScores[]>,
  humansByCohort: ReadonlyMap<
    string,
    readonly { scores: DimensionScores; confidence: number }[]
  >,
): CohortFidelity {
  const aiRows = aiByCohort.get(cohortId) ?? [];
  const humanRows = humansByCohort.get(cohortId) ?? [];
  const aiMeans = meanScores(aiRows);
  const humanMeans = meanScores(humanRows.map((h) => h.scores));

  let delta: DimensionScores | null = null;
  let absDeltaMean: number | null = null;
  if (aiMeans && humanMeans) {
    delta = {} as DimensionScores;
    let absSum = 0;
    for (const dim of DIMENSIONS) {
      const d = aiMeans[dim] - humanMeans[dim];
      delta[dim] = d;
      absSum += Math.abs(d);
    }
    absDeltaMean = absSum / DIMENSIONS.length;
  }

  const matchConfidenceMean =
    humanRows.length > 0
      ? humanRows.reduce((s, h) => s + h.confidence, 0) / humanRows.length
      : null;

  return {
    cohortId,
    cohortLabel: COHORT_BY_ID[cohortId]?.label ?? cohortId,
    nAi: aiRows.length,
    nHuman: humanRows.length,
    aiMeans,
    humanMeans,
    delta,
    absDeltaMean,
    matchConfidenceMean,
  };
}

// ─── "Which variant wins" ranking accuracy ──────────────────────────
// Across site variants (each variant = one scan with both an AI fit and
// a human fit), does AI order them the way humans do? This is the PoC's
// decision-grade output: a product team asks "does B beat A?" and we
// want AI's verdict to match reality's ranking even if absolute numbers
// are off (§8 — relative ranking, not absolute prediction).

export type VariantPoint = {
  variantId: string;
  aiFit: number;
  humanFit: number;
};

export type RankingFidelity = {
  nVariants: number;
  /** Spearman rank correlation of AI vs human fit. null when <2 variants. */
  spearman: number | null;
  /** Kendall tau-a (concordant−discordant)/pairs. null when <2 variants. */
  kendallTau: number | null;
  /** Fraction of variant PAIRS ordered the same way by AI and humans.
   *  The most interpretable "how often does AI call the winner right". */
  pairwiseAgreement: number | null;
  /** Does AI's top pick equal humans' top pick? null when 0 variants. */
  topPick: { aiTop: string; humanTop: string; agree: boolean } | null;
};

export function computeRankingFidelity(
  points: readonly VariantPoint[],
): RankingFidelity {
  const n = points.length;
  if (n === 0) {
    return {
      nVariants: 0,
      spearman: null,
      kendallTau: null,
      pairwiseAgreement: null,
      topPick: null,
    };
  }

  const aiTop = argTop(points, (p) => p.aiFit);
  const humanTop = argTop(points, (p) => p.humanFit);
  const topPick = {
    aiTop: aiTop.variantId,
    humanTop: humanTop.variantId,
    agree: aiTop.variantId === humanTop.variantId,
  };

  if (n < 2) {
    return {
      nVariants: n,
      spearman: null,
      kendallTau: null,
      pairwiseAgreement: null,
      topPick,
    };
  }

  const ai = points.map((p) => p.aiFit);
  const human = points.map((p) => p.humanFit);
  const spearman = pearson(rank(ai), rank(human));

  // Kendall tau-a + pairwise agreement over all unordered pairs.
  let concordant = 0;
  let discordant = 0;
  let comparable = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const aSign = Math.sign(ai[i]! - ai[j]!);
      const hSign = Math.sign(human[i]! - human[j]!);
      if (aSign === 0 || hSign === 0) continue; // tie on a side → not comparable
      comparable++;
      if (aSign === hSign) concordant++;
      else discordant++;
    }
  }
  const kendallTau =
    comparable > 0 ? (concordant - discordant) / comparable : null;
  const pairwiseAgreement = comparable > 0 ? concordant / comparable : null;

  return { nVariants: n, spearman, kendallTau, pairwiseAgreement, topPick };
}

function argTop<T>(items: readonly T[], key: (t: T) => number): T {
  let best = items[0] as T;
  let bestVal = key(best);
  for (let i = 1; i < items.length; i++) {
    const it = items[i] as T;
    const v = key(it);
    if (v > bestVal) {
      best = it;
      bestVal = v;
    }
  }
  return best;
}

/** Fractional (average-tie) ranks, ascending, 1-based. */
export function rank(values: readonly number[]): number[] {
  const idx = values.map((v, i) => ({ v, i }));
  idx.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1]!.v === idx[k]!.v) j++;
    // positions k..j are tied → average rank (1-based)
    const avg = (k + j) / 2 + 1;
    for (let t = k; t <= j; t++) ranks[idx[t]!.i] = avg;
    k = j + 1;
  }
  return ranks;
}

function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n === 0 || n !== y.length) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den === 0) return null; // no variance on a side → undefined correlation
  return num / den;
}
