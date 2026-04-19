/**
 * AI-persona vs human comparison primitives.
 *
 * Pure functions consumed by ``routes/report.ts:/compare`` (and any
 * dashboard backend). All statistics are computed client-side in TS so
 * the frontend dashboard only has to render — no separate analytics
 * service to run during an investor demo.
 *
 * Design notes:
 *   - Every metric takes the two samples explicitly so the caller can
 *     decide how to pair manual vs persona reports (often they run on
 *     the same test but aren't 1:1 at the tester level).
 *   - No SciPy equivalent in node, so we inline simple implementations
 *     and cite the formula. Precision is plenty for N<10k samples.
 */

import type { ChecklistResult as _ChecklistResult } from '@41rpm/persona-client';

export type ChecklistStatus = 'passed' | 'failed' | 'blocked';

export interface ChecklistItemResult {
  id: string;
  status: ChecklistStatus;
}

/**
 * Per-item agreement between manual and persona populations on the same
 * checklist. For each checklist item, counts how each side voted and
 * reports the majority-agreement rate.
 *
 * Example:
 *   humans: 5 passed, 1 failed on item "CL01"
 *   personas: 4 passed, 2 failed on item "CL01"
 *   → majority both "passed" → agreement=1 for this item
 */
export interface PerItemAgreement {
  itemId: string;
  humanMajority: ChecklistStatus | null;
  personaMajority: ChecklistStatus | null;
  agree: boolean;
  humanVotes: Record<ChecklistStatus, number>;
  personaVotes: Record<ChecklistStatus, number>;
}

function mode(values: ChecklistStatus[]): {
  winner: ChecklistStatus | null;
  counts: Record<ChecklistStatus, number>;
} {
  const counts: Record<ChecklistStatus, number> = { passed: 0, failed: 0, blocked: 0 };
  for (const v of values) counts[v]++;
  let winner: ChecklistStatus | null = null;
  let max = 0;
  (Object.keys(counts) as ChecklistStatus[]).forEach((k) => {
    if (counts[k] > max) { max = counts[k]; winner = k; }
  });
  return { winner: max === 0 ? null : winner, counts };
}

export function computePerItemAgreement(
  manual: ChecklistItemResult[][],
  persona: ChecklistItemResult[][],
): {
  items: PerItemAgreement[];
  overallAgreementRate: number;
} {
  const allIds = new Set<string>();
  for (const row of manual) row.forEach((r) => allIds.add(r.id));
  for (const row of persona) row.forEach((r) => allIds.add(r.id));

  const items: PerItemAgreement[] = [];
  for (const id of Array.from(allIds).sort()) {
    const humanStatuses = manual.flatMap((row) => row.filter((r) => r.id === id).map((r) => r.status));
    const personaStatuses = persona.flatMap((row) => row.filter((r) => r.id === id).map((r) => r.status));
    const h = mode(humanStatuses);
    const p = mode(personaStatuses);
    items.push({
      itemId: id,
      humanMajority: h.winner,
      personaMajority: p.winner,
      agree: h.winner !== null && p.winner !== null && h.winner === p.winner,
      humanVotes: h.counts,
      personaVotes: p.counts,
    });
  }

  const agreeing = items.filter((i) => i.agree).length;
  const overallAgreementRate = items.length > 0 ? agreeing / items.length : 0;
  return { items, overallAgreementRate };
}

/**
 * 3x3 confusion matrix treating human majority as "ground truth".
 * Rows = persona prediction, columns = human majority.
 * Useful for the dashboard heatmap.
 */
export function buildConfusionMatrix(
  itemAgreements: PerItemAgreement[],
): Record<ChecklistStatus | 'none', Record<ChecklistStatus | 'none', number>> {
  const labels: Array<ChecklistStatus | 'none'> = ['passed', 'failed', 'blocked', 'none'];
  const matrix: ReturnType<typeof buildConfusionMatrix> = {} as never;
  for (const r of labels) {
    matrix[r] = {} as never;
    for (const c of labels) matrix[r][c] = 0;
  }
  for (const item of itemAgreements) {
    const row = item.personaMajority ?? 'none';
    const col = item.humanMajority ?? 'none';
    matrix[row][col]++;
  }
  return matrix;
}

// ─── Correlation ────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Pearson product-moment correlation. Returns 0 when either sample is
 * empty or has zero variance.
 */
export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function rank(xs: number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(xs.length).fill(0);
  // Average ranks for ties so Spearman handles duplicates correctly.
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // ranks are 1-indexed
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation — robust to non-linear monotonic
 * relationships. Useful when persona quality_score and human
 * quality_score agree on ordering but have different absolute scales.
 */
export function spearman(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  return pearson(rank(x.slice(0, n)), rank(y.slice(0, n)));
}

// ─── Distribution similarity ────────────────────────────────────────

/**
 * Two-sample Kolmogorov–Smirnov statistic. Returns the max absolute
 * difference between the empirical CDFs of ``a`` and ``b``. 0 means
 * distributions are identical; 1 means completely disjoint.
 *
 * Does NOT return a p-value — callers who want significance should
 * compare against the critical value c(α)·√((n+m)/nm) themselves; for
 * the dashboard the raw D is usually what you want to display.
 */
export function ksStatistic(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sortedA = [...a].sort((p, q) => p - q);
  const sortedB = [...b].sort((p, q) => p - q);
  const all = [...new Set([...sortedA, ...sortedB])].sort((p, q) => p - q);
  const ecdf = (sorted: number[], x: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo / sorted.length;
  };
  let maxDiff = 0;
  for (const x of all) {
    const d = Math.abs(ecdf(sortedA, x) - ecdf(sortedB, x));
    if (d > maxDiff) maxDiff = d;
  }
  return maxDiff;
}

// ─── Set overlap ────────────────────────────────────────────────────

/**
 * Jaccard similarity = |A ∩ B| / |A ∪ B|. Used for pain-point overlap
 * between persona and human findings.
 */
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─── Cohort matching ────────────────────────────────────────────────

export type CohortKey = string; // e.g. "advanced", or "30s/advanced/desktop"

/**
 * Build a coarse-grained cohort label from a tester profile.
 * Default projection is ``crypto_experience`` — 4 buckets that carry
 * most of the "how will this person behave on a crypto SPA" signal
 * while keeping cohorts populated (5-7 members each in the current
 * seed). Override via ``dimensions`` to add ``age_range`` / ``primary_device``.
 *
 * Unknown / missing values bucket into "unknown" so nobody falls out
 * of the analysis.
 */
export function cohortKey(
  profile: Record<string, unknown> | null | undefined,
  dimensions: Array<'crypto_experience' | 'age_range' | 'primary_device' | 'experience_level'> = ['crypto_experience'],
): CohortKey {
  if (!profile) return 'unknown';
  const parts = dimensions.map((d) => {
    const v = profile[d];
    return typeof v === 'string' && v ? v : 'unknown';
  });
  return parts.join('/');
}

export interface CohortMetrics {
  cohort: CohortKey;
  humanCount: number;
  personaCount: number;
  humanMeanQuality: number;
  personaMeanQuality: number;
  qualityAbsDiff: number;
  itemAgreementRate: number;  // majority agreement on checklist items
  ksStatisticQuality: number; // KS between human and persona quality distributions
}

/**
 * Group reports by cohort and compute per-cohort agreement.
 * Reports without profiles are put in the "unknown" cohort.
 */
export function computeCohortMetrics(
  reports: Array<{
    testerAddr: string;
    isPersonaTest: boolean;
    qualityScore: number | null;
    checklistResults: ChecklistItemResult[] | null;
    profile: Record<string, unknown> | null;
  }>,
  dimensions?: Parameters<typeof cohortKey>[1],
): CohortMetrics[] {
  // Bucket by cohort.
  const buckets = new Map<CohortKey, {
    humanQ: number[];
    personaQ: number[];
    humanCL: ChecklistItemResult[][];
    personaCL: ChecklistItemResult[][];
  }>();

  for (const r of reports) {
    const key = cohortKey(r.profile, dimensions);
    const b = buckets.get(key) ?? {
      humanQ: [], personaQ: [], humanCL: [], personaCL: [],
    };
    const q = typeof r.qualityScore === 'number' ? r.qualityScore : null;
    const cl = Array.isArray(r.checklistResults) ? r.checklistResults : [];
    if (r.isPersonaTest) {
      if (q !== null) b.personaQ.push(q);
      b.personaCL.push(cl);
    } else {
      if (q !== null) b.humanQ.push(q);
      b.humanCL.push(cl);
    }
    buckets.set(key, b);
  }

  const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const round3 = (v: number) => Math.round(v * 1000) / 1000;

  const out: CohortMetrics[] = [];
  for (const [key, b] of buckets.entries()) {
    // Item-level agreement — majority vote on each side, count matches.
    const { overallAgreementRate } = computePerItemAgreement(b.humanCL, b.personaCL);
    out.push({
      cohort: key,
      humanCount: b.humanCL.length,
      personaCount: b.personaCL.length,
      humanMeanQuality: round3(mean(b.humanQ)),
      personaMeanQuality: round3(mean(b.personaQ)),
      qualityAbsDiff: round3(Math.abs(mean(b.humanQ) - mean(b.personaQ))),
      itemAgreementRate: round3(overallAgreementRate),
      ksStatisticQuality: round3(ksStatistic(b.humanQ, b.personaQ)),
    });
  }

  // Sort by descending population — most-populated cohorts first.
  out.sort((a, b) => (b.humanCount + b.personaCount) - (a.humanCount + a.personaCount));
  return out;
}

// ─── Convergence curve ──────────────────────────────────────────────

export interface ConvergencePoint {
  n: number;
  humanMean: number;
  personaMean: number;
  absDiff: number;
}

/**
 * Walks a prefix of the two samples (by index) and reports the
 * running mean difference at each cut. Shows the "as N grows, persona
 * ≈ human" story.
 *
 * ``steps`` picks which prefix sizes to include. Default: fine-grained
 * under N=10 (so the curve is visible at demo scale), then log-spaced
 * above that — [1, 2, 3, 5, 10, 20, 50, 100, 200, 500]. All entries
 * are clamped to ``min(lenA, lenB)`` and the total is appended so the
 * curve always terminates at the full sample.
 */
export function convergenceCurve(
  human: number[],
  persona: number[],
  steps?: number[],
): ConvergencePoint[] {
  const maxN = Math.min(human.length, persona.length);
  const defaultSteps = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500];
  const picks = (steps ?? defaultSteps).filter((n) => n <= maxN);
  if (maxN > 0 && (picks.length === 0 || picks[picks.length - 1] !== maxN)) picks.push(maxN);

  // De-dup in case maxN matched a default step exactly.
  const uniq = Array.from(new Set(picks)).sort((a, b) => a - b);

  const out: ConvergencePoint[] = [];
  for (const n of uniq) {
    const hMean = mean(human.slice(0, n));
    const pMean = mean(persona.slice(0, n));
    out.push({
      n,
      humanMean: Number(hMean.toFixed(4)),
      personaMean: Number(pMean.toFixed(4)),
      absDiff: Number(Math.abs(hMean - pMean).toFixed(4)),
    });
  }
  return out;
}
