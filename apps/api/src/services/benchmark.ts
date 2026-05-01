// Industry benchmark — Phase 2-D.
//
// Spec §6.6: per-category audience-fit average across all scanned
// sites. Hidden until enough data accumulates (spec sets the bar at
// 50+; we use 3+ for dev visibility, configurable via the `minN`
// parameter). Returns null below threshold so the caller can render
// "coming soon" rather than a misleading 1-site average.
//
// Phase 2-D scope: simple per-category mean + 25/75 percentile.
// Phase 3+ will add cohort-level breakdowns and time-of-day splits.

import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type CategoryBenchmark = {
  category: string;
  avg: number;
  n: number;
  p25: number;
  p75: number;
};

const DEFAULT_MIN_N = 3;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(p * sorted.length)),
  );
  return sorted[idx]!;
}

export async function getCategoryBenchmark(
  category: string,
  minN: number = DEFAULT_MIN_N,
): Promise<CategoryBenchmark | null> {
  if (!category) return null;
  const rows = await db
    .select({ score: schema.audienceFitScans.audienceFitScore })
    .from(schema.audienceFitScans)
    .where(
      and(
        eq(schema.audienceFitScans.status, 'completed'),
        eq(schema.audienceFitScans.category, category),
        isNotNull(schema.audienceFitScans.audienceFitScore),
      ),
    );

  const scores = rows
    .map((r) => r.score)
    .filter((s): s is number => s !== null);
  if (scores.length < minN) return null;

  const sorted = [...scores].sort((a, b) => a - b);
  const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
  return {
    category,
    avg,
    n: scores.length,
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
  };
}

export async function listCategoryBenchmarks(
  minN: number = DEFAULT_MIN_N,
): Promise<CategoryBenchmark[]> {
  const rows = await db
    .select({
      category: schema.audienceFitScans.category,
      score: schema.audienceFitScans.audienceFitScore,
    })
    .from(schema.audienceFitScans)
    .where(
      and(
        eq(schema.audienceFitScans.status, 'completed'),
        isNotNull(schema.audienceFitScans.audienceFitScore),
        isNotNull(schema.audienceFitScans.category),
      ),
    );

  // Bucket by category in code — simpler than a GROUP BY array_agg
  // round-trip and the row volume is small.
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    if (r.category === null || r.score === null) continue;
    const arr = buckets.get(r.category) ?? [];
    arr.push(r.score);
    buckets.set(r.category, arr);
  }

  const out: CategoryBenchmark[] = [];
  for (const [category, scores] of buckets) {
    if (scores.length < minN) continue;
    const sorted = [...scores].sort((a, b) => a - b);
    const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
    out.push({
      category,
      avg,
      n: scores.length,
      p25: percentile(sorted, 0.25),
      p75: percentile(sorted, 0.75),
    });
  }
  return out;
}
