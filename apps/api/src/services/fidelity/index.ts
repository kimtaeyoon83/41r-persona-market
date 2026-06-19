// Fidelity PoC — DB wrapper (Stage 1 / T0).
//
// I/O layer that feeds the pure compute in ./metrics.ts with real rows:
//   - AI side: scan_persona_responses (per-cohort dimension scores)
//   - Human side: survey_responses (scored via the SAME scoreRespondent
//     formula human_aggregate uses, then matched to a cohort by
//     self-reported demographics)
//
// Keeps the pure-helper extraction pattern: every number comes from
// ./metrics.ts; this file only fetches and shapes. No new math here.

import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { scoreRespondent } from '../human_aggregate.js';
import {
  computeCohortFidelity,
  computeRankingFidelity,
  matchHumanToCohort,
  type CohortFidelity,
  type CohortMatch,
  type DimensionScores,
  type RankingFidelity,
  type VariantPoint,
} from './metrics.js';

// scan_persona_responses row → DimensionScores, or null when the row is
// flagged or any dimension is null (mirrors the report's fitRows filter:
// is_flagged=false AND non-null scores — see routes/scan.ts Do-NOT note).
export function aiRowToScores(
  row: typeof schema.scanPersonaResponses.$inferSelect,
): DimensionScores | null {
  if (row.isFlagged) return null;
  const {
    happinessScore,
    engagementScore,
    adoptionScore,
    retentionD7,
    taskSuccessScore,
  } = row;
  if (
    happinessScore == null ||
    engagementScore == null ||
    adoptionScore == null ||
    retentionD7 == null ||
    taskSuccessScore == null
  ) {
    return null;
  }
  return {
    happiness: happinessScore,
    engagement: engagementScore,
    adoption: adoptionScore,
    retentionD7,
    taskSuccess: taskSuccessScore,
  };
}

export type ScanFidelity = {
  scanId: string;
  mode: string;
  nAiPersonas: number;
  nHumans: number;
  nHumansMatched: number;
  nHumansUnmatched: number;
  cohorts: CohortFidelity[];
  /** Mean absDeltaMean over cohorts where BOTH sides have data. The one
   *  honest "overall closeness" number — but ALWAYS reported alongside
   *  the by-cohort rows, never instead of them (§8 contract). */
  overallAbsDeltaMean: number | null;
  nCohortsCompared: number;
};

/** Per-cohort AI↔human fidelity for a single scan. */
export async function computeScanFidelity(
  scanId: string,
): Promise<ScanFidelity | null> {
  const [scan] = await db
    .select({ mode: schema.audienceFitScans.mode })
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, scanId));
  if (!scan) return null;

  const aiRows = await db
    .select()
    .from(schema.scanPersonaResponses)
    .where(eq(schema.scanPersonaResponses.scanId, scanId));

  const aiByCohort = new Map<string, DimensionScores[]>();
  let nAiPersonas = 0;
  for (const row of aiRows) {
    const s = aiRowToScores(row);
    if (!s) continue;
    nAiPersonas++;
    const list = aiByCohort.get(row.cohortId) ?? [];
    list.push(s);
    aiByCohort.set(row.cohortId, list);
  }

  const surveyRows = await db
    .select()
    .from(schema.surveyResponses)
    .where(eq(schema.surveyResponses.scanId, scanId));

  let nHumansMatched = 0;
  const humans = surveyRows.map((row) => {
    const match: CohortMatch | null = matchHumanToCohort(row.demographics);
    if (match) nHumansMatched++;
    return { scores: scoreRespondent(row) as DimensionScores, match };
  });

  const cohorts = computeCohortFidelity({ aiByCohort, humans });

  const compared = cohorts.filter((c) => c.absDeltaMean != null);
  const overallAbsDeltaMean =
    compared.length > 0
      ? compared.reduce((s, c) => s + (c.absDeltaMean ?? 0), 0) /
        compared.length
      : null;

  return {
    scanId,
    mode: scan.mode,
    nAiPersonas,
    nHumans: surveyRows.length,
    nHumansMatched,
    nHumansUnmatched: surveyRows.length - nHumansMatched,
    cohorts,
    overallAbsDeltaMean,
    nCohortsCompared: compared.length,
  };
}

export type VariantRanking = {
  ranking: RankingFidelity;
  points: VariantPoint[];
  /** Scan ids skipped because they lacked an AI fit or a human aggregate
   *  (a variant needs BOTH to be rankable). */
  skipped: { scanId: string; reason: 'no_ai_fit' | 'no_human_aggregate' }[];
};

/**
 * "Which variant wins" across a set of scans (site variants A/B/…).
 * AI fit = audience_fit_scans.audience_fit_score; human fit =
 * human_aggregate.audience_fit_score. A variant is only ranked when both
 * exist — others are reported in `skipped` (no silent drops).
 */
export async function computeVariantRanking(
  scanIds: readonly string[],
): Promise<VariantRanking> {
  const points: VariantPoint[] = [];
  const skipped: VariantRanking['skipped'] = [];

  for (const scanId of scanIds) {
    const [scan] = await db
      .select({
        aiFit: schema.audienceFitScans.audienceFitScore,
        human: schema.audienceFitScans.humanAggregate,
      })
      .from(schema.audienceFitScans)
      .where(eq(schema.audienceFitScans.id, scanId));

    if (!scan || scan.aiFit == null) {
      skipped.push({ scanId, reason: 'no_ai_fit' });
      continue;
    }
    const humanFit = (scan.human as { audience_fit_score?: number } | null)
      ?.audience_fit_score;
    if (humanFit == null) {
      skipped.push({ scanId, reason: 'no_human_aggregate' });
      continue;
    }
    points.push({ variantId: scanId, aiFit: scan.aiFit, humanFit });
  }

  return { ranking: computeRankingFidelity(points), points, skipped };
}
