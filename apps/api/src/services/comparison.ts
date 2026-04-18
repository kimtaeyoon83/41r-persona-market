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
