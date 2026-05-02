// /api/scan — Audience-Fit Validator entry point.
//
// POST /api/scan         — create a pending scan, return scanId.
// GET  /api/scan/:id/report — return shaped report for the validator UI.
//
// Phase 1A.5 ships the route surface + demo fixture. Real LLM
// processing (per-persona vision call → dimension scores → cohort
// aggregate → audience_fit synthesis) lands in Phase 1B, at which
// point this file's GET branch hydrates from scan_persona_responses
// + scan_cohort_results instead of returning `result: null` for
// pending rows.

import { Router, type Router as RouterType } from 'express';
import { and, eq, asc, desc, sql, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { COHORT_BY_ID } from '@41rpm/shared';
import { db, schema } from '../db/index.js';
import {
  AUDIENCE_FIT_WEIGHTS,
  DIMENSION_WEIGHTS_V1,
} from '../services/audience_fit.js';
import { startScanWorker } from '../services/scan_pipeline.js';
import { getCategoryBenchmark } from '../services/benchmark.js';
import { computeAarrr } from '../services/aarrr.js';

const router: RouterType = Router();

const createScanBody = z.object({
  target_url: z.string().min(1).max(500),
  mode: z.enum(['A', 'B']).default('A'),
  target_audience_text: z.string().max(500).optional(),
  hypothesis: z.string().max(1000).optional(),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/', async (req, res) => {
  const parsed = createScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const { target_url, mode, target_audience_text, hypothesis } = parsed.data;

  const [scan] = await db
    .insert(schema.audienceFitScans)
    .values({
      targetUrl: target_url,
      mode,
      targetAudienceText: target_audience_text ?? null,
      hypothesis: hypothesis ?? null,
      status: 'pending',
      weightsVersion: 'v1.0',
    })
    .returning();

  if (!scan) {
    res.status(500).json({ error: 'insert_failed' });
    return;
  }

  // Kick off the pipeline on the next tick. Errors are caught inside
  // startScanWorker; the response returns immediately.
  startScanWorker(scan.id);

  res.json({ scanId: scan.id, status: scan.status });
});

router.get('/:id/report', async (req, res) => {
  const { id } = req.params;

  // Demo fixture lives in code so the prototype tour through the
  // validator (TopBar Report → /validator/report/demo) never depends
  // on a populated DB.
  if (id === 'demo') {
    res.json(buildDemoReport());
    return;
  }

  if (!UUID_RE.test(id ?? '')) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }

  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, id));

  if (!scan) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }

  // Read whatever rows exist right now — progressive data flows in
  // as the worker writes scan_persona_responses + scan_cohort_results
  // mid-pipeline. The polling client picks up partial state and
  // re-renders.
  const cohortRows = await db
    .select()
    .from(schema.scanCohortResults)
    .where(eq(schema.scanCohortResults.scanId, id));

  // Live persona completion count — the scan row's
  // personas_completed only gets set at synthesis time, but we want
  // the polling client to see "X of Y personas analyzed" while the
  // responding step is still inserting rows. Counts non-flagged
  // rows only, matching the post-synthesis stored semantic.
  const [liveCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.scanPersonaResponses)
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false)
      )
    );
  const livePersonasCompleted = liveCount?.n ?? 0;

  // Composite per-persona score for fit/non-fit ranking. Cheap proxy
  // for the §4.2 weighted aggregate; using the same dimensions keeps
  // partial-state ordering consistent with the final cohort_fit_score.
  const sumExpr = sql<number>`(
    coalesce(${schema.scanPersonaResponses.happinessScore}, 0)
    + coalesce(${schema.scanPersonaResponses.engagementScore}, 0)
    + coalesce(${schema.scanPersonaResponses.taskSuccessScore}, 0)
  )`;

  const fitRows = await db
    .select({
      personaId: schema.scanPersonaResponses.personaId,
      cohortId: schema.scanPersonaResponses.cohortId,
      happiness: schema.scanPersonaResponses.happinessScore,
      engagement: schema.scanPersonaResponses.engagementScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      voiceFirstImpression: schema.scanPersonaResponses.voiceFirstImpression,
      voiceBiggestFriction: schema.scanPersonaResponses.voiceBiggestFriction,
      voiceWouldReturnBecause:
        schema.scanPersonaResponses.voiceWouldReturnBecause,
      voiceSample: schema.personas.vector,
      displayName: schema.testers.displayName,
      ageGroup: schema.personas.vector,
    })
    .from(schema.scanPersonaResponses)
    .innerJoin(
      schema.personas,
      eq(schema.personas.id, schema.scanPersonaResponses.personaId)
    )
    .innerJoin(
      schema.testers,
      eq(schema.testers.walletAddress, schema.personas.testerAddr)
    )
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false),
        isNotNull(schema.scanPersonaResponses.happinessScore)
      )
    )
    .orderBy(desc(sumExpr))
    .limit(3);

  const nonFitRows = await db
    .select({
      personaId: schema.scanPersonaResponses.personaId,
      cohortId: schema.scanPersonaResponses.cohortId,
      happiness: schema.scanPersonaResponses.happinessScore,
      engagement: schema.scanPersonaResponses.engagementScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      voiceFirstImpression: schema.scanPersonaResponses.voiceFirstImpression,
      voiceBiggestFriction: schema.scanPersonaResponses.voiceBiggestFriction,
      voiceWouldReturnBecause:
        schema.scanPersonaResponses.voiceWouldReturnBecause,
      voiceSample: schema.personas.vector,
      displayName: schema.testers.displayName,
      ageGroup: schema.personas.vector,
    })
    .from(schema.scanPersonaResponses)
    .innerJoin(
      schema.personas,
      eq(schema.personas.id, schema.scanPersonaResponses.personaId)
    )
    .innerJoin(
      schema.testers,
      eq(schema.testers.walletAddress, schema.personas.testerAddr)
    )
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false),
        isNotNull(schema.scanPersonaResponses.happinessScore)
      )
    )
    .orderBy(asc(sumExpr))
    .limit(3);

  // Most-recent persona responses for the processing screen feed.
  // Pulled live so the polling UI shows the latest reactions as the
  // worker writes them. Capped at 8 — newest first.
  const recentRows = await db
    .select({
      personaId: schema.scanPersonaResponses.personaId,
      cohortId: schema.scanPersonaResponses.cohortId,
      voiceFirstImpression: schema.scanPersonaResponses.voiceFirstImpression,
      voiceBiggestFriction: schema.scanPersonaResponses.voiceBiggestFriction,
      happiness: schema.scanPersonaResponses.happinessScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      voiceSample: schema.personas.vector,
      createdAt: schema.scanPersonaResponses.createdAt,
    })
    .from(schema.scanPersonaResponses)
    .innerJoin(
      schema.personas,
      eq(schema.personas.id, schema.scanPersonaResponses.personaId)
    )
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false),
        isNotNull(schema.scanPersonaResponses.voiceFirstImpression)
      )
    )
    .orderBy(desc(schema.scanPersonaResponses.createdAt))
    .limit(8);

  // Per-cohort live completion count for the processing screen's
  // cohort progress strip. Derived from scanPersonaResponses (not
  // scanCohortResults) so it updates row-by-row mid-pipeline.
  const cohortProgressRows = await db
    .select({
      cohortId: schema.scanPersonaResponses.cohortId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.scanPersonaResponses)
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, id),
        eq(schema.scanPersonaResponses.isFlagged, false)
      )
    )
    .groupBy(schema.scanPersonaResponses.cohortId);

  const completed = scan.status === 'completed';

  // Override personas_completed with the live row count for the
  // polling client. Once the scan completes, scan.personasCompleted
  // matches livePersonasCompleted exactly, so the override is a no-op.
  const scanShape = shapeScanMeta(scan);
  scanShape.personas_completed = livePersonasCompleted;
  if (!completed && scanShape.personas_attempted === 0) {
    scanShape.personas_attempted = livePersonasCompleted;
  }

  res.json({
    scan: scanShape,
    result: completed
      ? {
          audience_fit_score: scan.audienceFitScore ?? 0,
          best: {
            cohort_id: scan.bestCohortId ?? '',
            cohort_label:
              cohortRows.find((c) => c.cohortId === scan.bestCohortId)?.cohortLabel ?? '',
            cohort_fit_score: scan.bestCohortScore ?? 0,
          },
          worst: {
            cohort_id: scan.worstCohortId ?? '',
            cohort_label:
              cohortRows.find((c) => c.cohortId === scan.worstCohortId)?.cohortLabel ?? '',
            cohort_fit_score: scan.worstCohortScore ?? 0,
          },
          median_score: scan.medianCohortScore ?? 0,
          global_task_success_avg: scan.globalTaskSuccessAvg ?? 0,
          global_sentiment_avg: scan.globalSentimentAvg ?? 0,
          weights_used: AUDIENCE_FIT_WEIGHTS,
          dimension_weights: DIMENSION_WEIGHTS_V1,
        }
      : null,
    cohorts: cohortRows.map(shapeCohort),
    fit_personas: fitRows.map((r) => shapePersonaCard(r, 'fit')),
    non_fit_personas: nonFitRows.map((r) => shapePersonaCard(r, 'non_fit')),
    // These three are computed at synthesis time; show them only when
    // the scan completes so partial state never displays misleading
    // pseudo-frictions or formula rows.
    frictions: completed ? buildFrictionsForReport(scan, cohortRows) : [],
    retention_curve: completed ? buildRetentionCurve(cohortRows) : [],
    formula_rows: completed ? buildFormulaRows(scan, cohortRows) : [],
    dimension_breakdown: completed ? buildDimensionBreakdown(cohortRows) : [],
    kpis: completed ? await buildKpis(scan, cohortRows) : [],
    // Live progressive fields — populated during scan + after.
    recent_responses: recentRows.map(shapeRecentResponse),
    cohort_progress: shapeCohortProgress(cohortProgressRows),
    // Pro tier: AARRR funnel — Mode A only (Mode B is single-audience).
    aarrr: completed && scan.mode === 'A' ? await computeAarrr(id) : null,
  });
});

// ─── GET /api/scan/:scanId/persona/:personaId ─────────────────────
// Persona drill-down endpoint — returns the persona's vector +
// their response in this scan + scan meta. Drives the per-persona
// detail page. 404 when scan or persona-row absent.
router.get('/:scanId/persona/:personaId', async (req, res) => {
  const { scanId, personaId } = req.params;
  if (!UUID_RE.test(scanId) || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }

  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, scanId));
  if (!scan) {
    res.status(404).json({ error: 'scan_not_found' });
    return;
  }

  const [row] = await db
    .select({
      personaId: schema.scanPersonaResponses.personaId,
      cohortId: schema.scanPersonaResponses.cohortId,
      happiness: schema.scanPersonaResponses.happinessScore,
      engagement: schema.scanPersonaResponses.engagementScore,
      taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
      retentionD7: schema.scanPersonaResponses.retentionD7,
      adoption: schema.scanPersonaResponses.adoptionScore,
      retentionDCurve: schema.scanPersonaResponses.retentionDCurve,
      rawResponse: schema.scanPersonaResponses.rawResponse,
      voiceFirstImpression: schema.scanPersonaResponses.voiceFirstImpression,
      voiceFriction: schema.scanPersonaResponses.voiceFriction,
      voiceBiggestFriction: schema.scanPersonaResponses.voiceBiggestFriction,
      voiceWouldReturnBecause:
        schema.scanPersonaResponses.voiceWouldReturnBecause,
      isFlagged: schema.scanPersonaResponses.isFlagged,
      flagReason: schema.scanPersonaResponses.flagReason,
      personaVector: schema.personas.vector,
      displayName: schema.testers.displayName,
      testerAddr: schema.personas.testerAddr,
    })
    .from(schema.scanPersonaResponses)
    .innerJoin(
      schema.personas,
      eq(schema.personas.id, schema.scanPersonaResponses.personaId)
    )
    .innerJoin(
      schema.testers,
      eq(schema.testers.walletAddress, schema.personas.testerAddr)
    )
    .where(
      and(
        eq(schema.scanPersonaResponses.scanId, scanId),
        eq(schema.scanPersonaResponses.personaId, personaId)
      )
    );

  if (!row) {
    res.status(404).json({ error: 'persona_response_not_found' });
    return;
  }

  res.json(shapePersonaDetailResponse(scan, row));
});

export function shapePersonaDetailResponse(
  scan: typeof schema.audienceFitScans.$inferSelect,
  row: {
    personaId: string;
    cohortId: string;
    happiness: number | null;
    engagement: number | null;
    taskSuccess: number | null;
    retentionD7: number | null;
    adoption: number | null;
    retentionDCurve:
      | { d1: number; d3: number; d7: number; d30: number }
      | null;
    rawResponse: unknown;
    voiceFirstImpression: string | null;
    voiceFriction: string | null;
    voiceBiggestFriction: string | null;
    voiceWouldReturnBecause: string | null;
    isFlagged: boolean;
    flagReason: string | null;
    personaVector: typeof schema.personas.$inferSelect.vector;
    displayName: string;
    testerAddr: string;
  }
) {
  const cohort = COHORT_BY_ID[row.cohortId];
  const ageGroup = row.personaVector.demographics?.age_group ?? 'adult';
  const age = personaAgeFromGroup(ageGroup, row.personaId);

  // Flatten the persona vector axes the detail screen renders. Keep
  // names matching the design's VECTOR_AXES list — the screen pairs
  // them with progress bars.
  const v = row.personaVector;
  const vectorAxes = [
    { k: 'tech_literacy', v: v.demographics?.tech_literacy ?? null },
    { k: 'crypto_experience', v: v.demographics?.crypto_experience ?? null },
    { k: 'patience_level', v: v.demographics?.patience_level ?? null },
    {
      k: 'mobile_first',
      v: v.ux_preferences?.mobile_first ? 1 : 0,
    },
    { k: 'design_sensitivity', v: v.demographics?.design_sensitivity ?? null },
    { k: 'expertise_defi', v: v.expertise?.defi ?? null },
  ].filter((a): a is { k: string; v: number } => a.v != null);

  const raw = row.rawResponse as
    | {
        sus_responses?: number[];
        sus_raw_score?: number;
        signup_likelihood?: number;
        completion_likelihood?: number;
      }
    | null;

  return {
    scan: {
      id: scan.id,
      target_url: scan.targetUrl,
      mode: scan.mode,
      status: scan.status,
    },
    persona: {
      id: row.personaId,
      display_name: personaDisplayName(
        row.displayName ?? 'Synthetic',
        cohort?.label ?? row.cohortId,
        row.personaId
      ),
      tester_addr: row.testerAddr,
      age,
      age_group: ageGroup,
      cohort_id: row.cohortId,
      cohort_label: cohort?.label ?? row.cohortId,
      voice_sample: v.voice_sample ?? null,
      vector_axes: vectorAxes,
    },
    response: {
      happiness: row.happiness,
      engagement: row.engagement,
      task_success: row.taskSuccess,
      retention_d7: row.retentionD7,
      adoption: row.adoption,
      retention_d_curve: row.retentionDCurve,
      sus_responses: raw?.sus_responses ?? null,
      sus_raw_score: raw?.sus_raw_score ?? null,
      signup_likelihood: raw?.signup_likelihood ?? null,
      completion_likelihood: raw?.completion_likelihood ?? null,
      voice_first_impression: row.voiceFirstImpression,
      voice_friction: row.voiceFriction,
      voice_biggest_friction: row.voiceBiggestFriction,
      voice_would_return_because: row.voiceWouldReturnBecause,
      is_flagged: row.isFlagged,
      flag_reason: row.flagReason,
    },
  };
}

// ─── Name helpers ────────────────────────────────────────────────
// First × last pools combine into 30 × 30 = 900 unique pairs, vastly
// reducing collisions inside one report (a 6-card render hits a
// duplicate ~2% of the time vs ~30% with a 50-pair pool). Used only
// to override the synthetic seed displayNames ("Crypto Native #9");
// real tester wallets keep their stored displayName.
const FIRST_NAMES: readonly string[] = [
  'Alex', 'Sora', 'Mateo', 'Ines', 'Yuki', 'Noah', 'Aisha', 'Liam',
  'Ravi', 'Eun-jin', 'Maya', 'Chen', 'Kofi', 'Priya', 'Lukas',
  'Sara', 'Jakub', 'Hana', 'Diego', 'Claire', 'Emil', 'Layla',
  'Tom', 'Mei', 'Ananya', 'Felipe', 'Anya', 'Jonas', 'Yara', 'Wei',
];
const LAST_NAMES: readonly string[] = [
  'Park', 'Tanaka', 'García', 'Almeida', 'Sato', 'Bauer', 'Khan',
  'O’Brien', 'Mehta', 'Lee', 'Cohen', 'Wei', 'Mensah', 'Iyer',
  'Schmidt', 'Lindberg', 'Nowak', 'Rojas', 'Dubois', 'Andersen',
  'Hassan', 'Becker', 'Lin', 'Rao', 'Souza', 'Volkov', 'Nielsen',
  'Saab', 'Chen', 'Romano',
];

// Detect synthetic seed names like "Crypto Native #9" so we know when
// to substitute. Real tester displayNames ("Alice Chen") pass through.
function isSyntheticSeedName(displayName: string, roleLabel: string): boolean {
  return displayName.toLowerCase().startsWith(roleLabel.toLowerCase() + ' #');
}

export function personaDisplayName(
  rawDisplayName: string,
  roleLabel: string,
  personaId: string
): string {
  if (!isSyntheticSeedName(rawDisplayName, roleLabel)) return rawDisplayName;
  const h = hash32(personaId);
  // Two independent indices from the same hash via different bit
  // shifts so the first/last picks are uncorrelated.
  const first = FIRST_NAMES[h % FIRST_NAMES.length]!;
  const last = LAST_NAMES[(h >>> 8) % LAST_NAMES.length]!;
  return `${first} ${last}`;
}

// ─── Age helpers ─────────────────────────────────────────────────
// FNV-1a 32-bit. Stable across processes, no crypto cost. Used only
// for deterministic display jitter — never for security/randomness.
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Map age_group bucket → realistic age, deterministically jittered
// from the personaId so the 14 personas inside one cohort don't all
// display the same age (which read as obviously synthetic).
export function personaAgeFromGroup(
  ageGroup: string | undefined,
  personaId: string
): number {
  const h = hash32(personaId);
  switch (ageGroup) {
    case 'teen':
      return 13 + (h % 7); // 13-19
    case 'young_adult':
      return 22 + (h % 9); // 22-30
    case 'senior':
      return 50 + (h % 23); // 50-72
    default:
      return 30 + (h % 15); // 30-44 (adult / unknown)
  }
}

// ─── Per-persona card shaping ─────────────────────────────────────
export function shapePersonaCard(
  r: {
    personaId: string;
    cohortId: string;
    happiness: number | null;
    engagement: number | null;
    taskSuccess: number | null;
    voiceFirstImpression?: string | null;
    voiceBiggestFriction?: string | null;
    voiceWouldReturnBecause?: string | null;
    voiceSample: typeof schema.personas.$inferSelect.vector;
    displayName: string;
  },
  intent: 'fit' | 'non_fit' = 'fit'
) {
  // Average the dimensions we have. If all three are null (response
  // is mid-flight or was filtered upstream), return null so the UI
  // can render a placeholder rather than a misleading 0.
  const present = [r.happiness, r.engagement, r.taskSuccess].filter(
    (v): v is number => v != null
  );
  const score =
    present.length === 0
      ? null
      : Math.round(present.reduce((a, b) => a + b, 0) / present.length);
  const cohort = COHORT_BY_ID[r.cohortId];
  const ageGroup = r.voiceSample.demographics?.age_group;
  const age = personaAgeFromGroup(ageGroup, r.personaId);
  // Prefer the LLM-generated quote that matches the card's intent —
  // fit cards get the persona's "would_return_because" reason (positive
  // tone, matches the high score), non-fit cards get "biggest_friction"
  // (the why-it-failed). Both fall back to first_impression then the
  // persona's static voice_sample so simulator/legacy rows still render.
  const quote =
    intent === 'fit'
      ? r.voiceWouldReturnBecause ||
        r.voiceFirstImpression ||
        r.voiceBiggestFriction ||
        r.voiceSample.voice_sample ||
        ''
      : r.voiceBiggestFriction ||
        r.voiceFirstImpression ||
        r.voiceWouldReturnBecause ||
        r.voiceSample.voice_sample ||
        '';
  // Dedupe tags — cohort_id (e.g. "senior") can collide with
  // age_group bucket of the same name.
  const tagSet = new Set([r.cohortId, ageGroup ?? 'unknown']);
  const role = cohort?.label ?? r.cohortId;
  return {
    id: r.personaId,
    name: personaDisplayName(r.displayName ?? 'Synthetic', role, r.personaId),
    age,
    role,
    score,
    quote,
    tags: Array.from(tagSet),
  };
}

// ─── Live processing-feed shaping ────────────────────────────────
// Sentiment classifier — bands the per-persona reaction into
// positive | mixed | friction so the processing feed can paint a
// coloured tag without having to re-render numeric scores.
export function classifySentiment(
  happiness: number | null,
  taskSuccess: number | null
): 'positive' | 'mixed' | 'friction' {
  const h = happiness ?? 50;
  const t = taskSuccess ?? 50;
  const avg = (h + t) / 2;
  if (avg >= 65) return 'positive';
  if (avg >= 40) return 'mixed';
  return 'friction';
}

export function shapeRecentResponse(r: {
  personaId: string;
  cohortId: string;
  voiceFirstImpression: string | null;
  voiceBiggestFriction: string | null;
  happiness: number | null;
  taskSuccess: number | null;
  voiceSample: typeof schema.personas.$inferSelect.vector;
  createdAt: Date;
}) {
  const cohort = COHORT_BY_ID[r.cohortId];
  const ageGroup = r.voiceSample.demographics?.age_group ?? 'adult';
  return {
    persona_id: r.personaId,
    cohort_id: r.cohortId,
    cohort_label: cohort?.label ?? r.cohortId,
    age_group: ageGroup,
    voice: r.voiceFirstImpression ?? r.voiceBiggestFriction ?? '',
    sentiment: classifySentiment(r.happiness, r.taskSuccess),
    created_at: r.createdAt.toISOString(),
  };
}

export function shapeCohortProgress(rows: Array<{ cohortId: string; n: number }>) {
  // Target = 14 personas per standard cohort (Mode A). Mode B uses a
  // single custom_audience row whose target floats with how many
  // matched the selector — we report the live count as both n and
  // target so the bar reads "X / X" once any rows arrive. This
  // matches the worker's own targeting (selectPersonasForAudience).
  return rows.map((r) => {
    const cohort = COHORT_BY_ID[r.cohortId];
    const target = cohort?.target_n ?? r.n;
    return {
      cohort_id: r.cohortId,
      cohort_label: cohort?.label ?? r.cohortId,
      n_completed: r.n,
      n_target: target,
    };
  });
}

// ─── Synthesis-tied builders (only meaningful when status='completed') ──
function buildFrictionsForReport(
  scan: typeof schema.audienceFitScans.$inferSelect,
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Prefer the LLM-clustered frictions persisted by
  // services/dimensions/frictions.ts at end of pipeline. Falls back
  // to a cohort-derived placeholder when null (simulator path or
  // clustering failed).
  const clusters = scan.frictionsJson;
  if (clusters && clusters.length > 0) {
    return clusters.map((c) => ({
      rank: c.rank,
      title: c.title,
      detail: c.summary,
      n: c.n,
      where: c.where,
      impact: c.impact,
      quote: c.quote,
    }));
  }

  // Placeholder fallback — surface worst cohorts as friction rows.
  const ranked = [...rows]
    .filter((c) => c.cohortFitScore != null)
    .sort((a, b) => (a.cohortFitScore ?? 0) - (b.cohortFitScore ?? 0))
    .slice(0, 3);
  return ranked.map((c, i) => ({
    rank: i + 1,
    title: `Low resonance: ${c.cohortLabel}`,
    detail: `${c.cohortLabel} cohort scored ${(c.cohortFitScore ?? 0).toFixed(0)}/100 — well below average.`,
    n: c.nCompleted,
    where: c.cohortLabel,
    impact: `+${Math.round((50 - (c.cohortFitScore ?? 0)) * 0.3)} fit est.`,
    quote: 'Voice clustering not run yet — using cohort placeholder.',
  }));
}

function buildRetentionCurve(
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  const valid = rows.filter((r) => r.retentionDCurve != null);
  if (valid.length === 0) return [];
  const sum = { d1: 0, d3: 0, d7: 0, d30: 0 };
  for (const r of valid) {
    const c = r.retentionDCurve!;
    sum.d1 += c.d1;
    sum.d3 += c.d3;
    sum.d7 += c.d7;
    sum.d30 += c.d30;
  }
  const n = valid.length;
  return [
    { d: 'D-1', v: Math.round(sum.d1 / n) },
    { d: 'D-3', v: Math.round(sum.d3 / n) },
    { d: 'D-7', v: Math.round(sum.d7 / n) },
    { d: 'D-30', v: Math.round(sum.d30 / n) },
  ];
}

function buildFormulaRows(
  scan: typeof schema.audienceFitScans.$inferSelect,
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Best-cohort dimension means → formula rows. This is the per-
  // dimension breakdown that drove that cohort's cohort_fit_score.
  const best = rows.find((c) => c.cohortId === scan.bestCohortId);
  if (!best) return [];
  const w = DIMENSION_WEIGHTS_V1;
  return [
    { d: 'Engagement', s: Math.round(best.engagementMean ?? 0), w: w.engagement, c: 0.78 },
    { d: 'Task Success', s: Math.round(best.taskSuccessMean ?? 0), w: w.task_success, c: 0.71 },
    { d: 'Happiness', s: Math.round(best.happinessMean ?? 0), w: w.happiness, c: 0.65 },
    { d: 'Adoption', s: Math.round(best.adoptionMean ?? 0), w: w.adoption, c: 0.38 },
    { d: 'Retention', s: Math.round(best.retentionMean ?? 0), w: w.retention, c: 0.18 },
  ];
}

function buildDimensionBreakdown(
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Cross-cohort dimension means weighted by n_completed — same shape
  // as the engagement breakdown card on the report.
  const valid = rows.filter((r) => r.cohortFitScore != null);
  if (valid.length === 0) return [];
  const totalN = valid.reduce((s, r) => s + r.nCompleted, 0) || 1;
  const wAvg = (key: 'engagementMean' | 'happinessMean' | 'taskSuccessMean' | 'adoptionMean' | 'retentionMean') =>
    Math.round(
      valid.reduce((s, r) => s + (r[key] ?? 0) * r.nCompleted, 0) / totalN
    );
  const eng = wAvg('engagementMean');
  const hap = wAvg('happinessMean');
  const tsk = wAvg('taskSuccessMean');
  const ado = wAvg('adoptionMean');
  const ret = wAvg('retentionMean');
  const tone = (v: number) => (v < 40 ? 'bad' : v < 60 ? 'warn' : 'ok');
  return [
    { l: 'Onboarding Completion', v: ado, sub: 'Sign-up likelihood', tone: tone(ado) },
    { l: 'Time to Aha', v: tsk, sub: 'Task completion proxy', tone: tone(tsk) },
    { l: 'Sentiment Resonance', v: hap, sub: 'SUS aggregate', tone: tone(hap) },
    { l: 'Feature Discovery', v: eng, sub: 'Session depth', tone: tone(eng) },
    { l: 'Return Intent', v: ret, sub: 'D-7 retention', tone: tone(ret) },
  ];
}

async function buildKpis(
  scan: typeof schema.audienceFitScans.$inferSelect,
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Mode B is a single-audience verdict scan — best == worst == median
  // by construction. Showing those as 3 different cards is misleading.
  // Surface verdict + audience definition instead.
  if (scan.mode === 'B') {
    // Floor to 1 decimal so the Audience fit value reads consistently
    // with the verdict band next to it (e.g. 39.9 reads as <40 → FAIL,
    // not 40.0 reads as <40 — toFixed/round on 39.99 produced 40.0).
    const rawScore = scan.audienceFitScore ?? 0;
    const score = Math.floor(rawScore * 10) / 10;
    const verdict = scan.modeBVerdict ?? 'pending';
    const audience =
      scan.targetAudienceText && scan.targetAudienceText.length > 36
        ? `${scan.targetAudienceText.slice(0, 36)}…`
        : scan.targetAudienceText ?? '—';
    const verdictTone =
      verdict === 'pass' ? 'ok' : verdict === 'conditional' ? 'warn' : 'bad';
    return [
      {
        l: 'Audience fit',
        v: score.toFixed(1),
        sub: scan.targetAudienceText
          ? `${rows[0]?.nCompleted ?? 0} matching personas`
          : '—',
        tone: rawScore >= 60 ? 'ok' : rawScore >= 40 ? 'warn' : 'bad',
      },
      {
        l: 'Verdict',
        v: verdict.toUpperCase(),
        sub:
          verdict === 'pass'
            ? '≥60'
            : verdict === 'conditional'
            ? '40-60'
            : '<40',
        tone: verdictTone,
      },
      {
        l: 'Personas analyzed',
        v: String(scan.personasCompleted),
        sub: `${scan.personasFlagged ?? 0} flagged`,
        tone: 'faint',
      },
      {
        l: 'Audience definition',
        v: audience,
        sub: scan.category ? `category: ${scan.category}` : '—',
        tone: 'faint',
      },
    ];
  }

  const best = rows.find((c) => c.cohortId === scan.bestCohortId);
  const worst = rows.find((c) => c.cohortId === scan.worstCohortId);

  // Industry benchmark — null when n<3 same-category scans (Phase 2-D
  // dev threshold; will move to 50 per spec §6.6 in production).
  const benchmark = scan.category
    ? await getCategoryBenchmark(scan.category)
    : null;

  return [
    {
      l: 'Best cohort fit',
      v: String(Math.round(scan.bestCohortScore ?? 0)),
      sub: best?.cohortLabel ?? '—',
      tone: 'ok',
    },
    {
      l: 'Worst cohort fit',
      v: String(Math.round(scan.worstCohortScore ?? 0)),
      sub: worst?.cohortLabel ?? '—',
      tone: 'bad',
    },
    {
      l: 'Personas analyzed',
      v: String(scan.personasCompleted),
      sub: `${scan.personasFlagged ?? 0} flagged`,
      tone: 'faint',
    },
    benchmark
      ? {
          l: 'Industry benchmark',
          v: String(Math.round(benchmark.avg)),
          sub: `${benchmark.category} · n=${benchmark.n}`,
          tone:
            benchmark.avg >= 60 ? 'ok' : benchmark.avg >= 40 ? 'warn' : 'bad',
        }
      : {
          l: 'Industry benchmark',
          v: '—',
          sub: 'coming soon',
          tone: 'faint',
        },
  ];
}

function shapeScanMeta(s: typeof schema.audienceFitScans.$inferSelect) {
  return {
    id: s.id,
    target_url: s.targetUrl,
    category: s.category,
    category_confidence: s.categoryConfidence,
    one_line_pitch: s.oneLinePitch,
    mode: s.mode,
    status: s.status,
    personas_attempted: s.personasAttempted,
    personas_completed: s.personasCompleted,
    personas_flagged: s.personasFlagged,
    weights_version: s.weightsVersion,
    target_audience_text: s.targetAudienceText,
    // Mode B fields — null on Mode A scans.
    mode_b_verdict: s.modeBVerdict as
      | 'pass'
      | 'conditional'
      | 'fail'
      | null,
    mode_b_parsed_selector: s.modeBParsedSelector,
    created_at: s.createdAt.toISOString(),
    completed_at: s.completedAt ? s.completedAt.toISOString() : null,
  };
}

function shapeCohort(c: typeof schema.scanCohortResults.$inferSelect) {
  return {
    cohort_id: c.cohortId,
    cohort_label: c.cohortLabel,
    n_target: c.nTarget,
    n_completed: c.nCompleted,
    n_flagged: c.nFlagged,
    cohort_fit_score: c.cohortFitScore,
    cohort_fit_ci_low: c.cohortFitCiLow,
    cohort_fit_ci_high: c.cohortFitCiHigh,
    dimension_means: {
      happiness: c.happinessMean,
      engagement: c.engagementMean,
      adoption: c.adoptionMean,
      retention: c.retentionMean,
      task_success: c.taskSuccessMean,
    },
    retention_d_curve: c.retentionDCurve,
  };
}

// ─── Demo fixture ────────────────────────────────────────────────
// Mirrors the Phase 0 mock data baked into
// apps/web/app/validator/report/[scanId]/page.tsx. Frontend can now
// fetch this via the API instead of branching on scanId — the
// fallback path simplifies once frontend hydration lands next.
function buildDemoReport() {
  return {
    scan: {
      id: 'demo',
      target_url: 'yoursite.com',
      category: 'DeFi',
      category_confidence: 0.91,
      one_line_pitch:
        'DeFi swap aggregator on Solana — minimal slippage + MEV protection.',
      mode: 'A' as const,
      status: 'completed' as const,
      personas_attempted: 113,
      personas_completed: 113,
      personas_flagged: 0,
      weights_version: 'v1.3',
      created_at: '2026-04-30T14:22:00.000Z',
      completed_at: '2026-04-30T14:28:00.000Z',
    },
    result: {
      audience_fit_score: 45,
      best: {
        cohort_id: 'crypto_native',
        cohort_label: 'Crypto Native',
        cohort_fit_score: 84,
      },
      worst: {
        cohort_id: 'teen_newcomer',
        cohort_label: 'Teen newcomer',
        cohort_fit_score: 21,
      },
      median_score: 35,
      global_task_success_avg: 50,
      global_sentiment_avg: 58,
      weights_used: AUDIENCE_FIT_WEIGHTS,
      dimension_weights: DIMENSION_WEIGHTS_V1,
    },
    kpis: [
      { l: 'Best cohort fit', v: '84', sub: 'Crypto Native', tone: 'ok' },
      { l: 'Worst cohort fit', v: '21', sub: 'Teen student', tone: 'bad' },
      { l: 'Hottest drop-off', v: '67%', sub: 'Wallet step', tone: 'bad' },
      { l: 'Industry benchmark', v: '—', sub: 'coming soon', tone: 'faint' },
    ],
    fit_personas: [
      {
        id: 'p_alex',
        name: 'Alex K.',
        age: 31,
        role: '30s DeFi pro',
        score: 84,
        quote:
          "Explicit MEV protection earns trust. Slippage controls feel precise — I'd use this as my main driver.",
        tags: ['crypto_native', 'mobile_first', 'high_freq'],
      },
      {
        id: 'p_june',
        name: 'June P.',
        age: 28,
        role: 'Designer (20s)',
        score: 71,
        quote:
          'Consistent tone, balanced information density. Path to first swap was unobstructed.',
        tags: ['design_lit', 'curious', 'medium_tech'],
      },
      {
        id: 'p_marco',
        name: 'Marco S.',
        age: 34,
        role: 'Web3 pro',
        score: 68,
        quote:
          'Technically solid. Missing power-user shortcuts is the only friction.',
        tags: ['power_user', 'crypto_native', 'desktop'],
      },
    ],
    non_fit_personas: [
      {
        id: 'p_jiwon',
        name: 'Jiwon L.',
        age: 16,
        role: 'Teen student',
        score: 21,
        quote:
          'I have no idea what this site does. Too much English, too many unfamiliar words.',
        tags: ['low_crypto', 'price_sens', 'mobile'],
      },
      {
        id: 'p_youngja',
        name: 'Youngja H.',
        age: 58,
        role: 'Senior (50+)',
        score: 24,
        quote: 'Buttons are too small to tap. It feels intimidating to use.',
        tags: ['low_tech', 'risk_averse', 'desktop'],
      },
      {
        id: 'p_ben',
        name: 'Ben K.',
        age: 33,
        role: 'DeFi beginner',
        score: 31,
        quote:
          "I don't know what slippage means and I can't find an explanation.",
        tags: ['low_crypto', 'curious', 'first_time'],
      },
    ],
    frictions: [
      {
        rank: 1,
        title: 'Wallet selection ambiguity',
        detail: 'No guidance on which wallet to connect.',
        n: 21,
        where: 'Connect wallet',
        impact: '+12 PMF est.',
        quote: 'Which wallet should I use? Phantom? MetaMask?',
      },
      {
        rank: 2,
        title: 'Jargon barrier',
        detail: '12 specialized terms surface without definitions.',
        n: 14,
        where: 'Hero / Features',
        impact: '+9 PMF est.',
        quote: 'Slippage? AMM? These words feel scary.',
      },
      {
        rank: 3,
        title: 'Mobile hit-target',
        detail: 'Mobile buttons fall under minimum tap-target size.',
        n: 8,
        where: 'Mobile Swap',
        impact: '+5 PMF est.',
        quote: 'Buttons are too small to press with a finger.',
      },
    ],
    retention_curve: [
      { d: 'D-1', v: 80 },
      { d: 'D-3', v: 65 },
      { d: 'D-7', v: 40 },
      { d: 'D-30', v: 18 },
    ],
    dimension_breakdown: [
      { l: 'Onboarding Completion', v: 42, sub: 'Wallet + profile', tone: 'bad' },
      {
        l: 'Time to Aha',
        v: 68,
        sub: 'Smoothness to first swap',
        tone: 'warn',
        suffix: 's',
        invert: true,
      },
      { l: 'Sentiment Resonance', v: 58, sub: 'Post first-touch', tone: 'warn' },
      { l: 'Feature Discovery', v: 34, sub: 'Adjacent feature exploration', tone: 'bad' },
      { l: 'Return Intent', v: 46, sub: 'Likelihood to come back', tone: 'warn' },
    ],
    formula_rows: [
      { d: 'Engagement', s: 42, w: 0.3, c: 0.78 },
      { d: 'Onboarding', s: 42, w: 0.2, c: 0.71 },
      { d: 'Sentiment', s: 58, w: 0.2, c: 0.65 },
      { d: 'Discovery', s: 34, w: 0.15, c: 0.38 },
      { d: 'Retention', s: 46, w: 0.15, c: 0.18 },
    ],
    cohorts: null,
    aarrr: {
      total_personas: 113,
      stages: [
        { key: 'acquisition', label: 'Acquisition', score: 100, n_passing: 113, total: 113, threshold: 'Reached the URL (baseline)' },
        { key: 'activation', label: 'Activation', score: 42, n_passing: 47, total: 113, threshold: 'task_success ≥ 50' },
        { key: 'retention', label: 'Retention', score: 28, n_passing: 32, total: 113, threshold: 'retention_d7 ≥ 30' },
        { key: 'referral', label: 'Referral', score: 21, n_passing: 24, total: 113, threshold: 'happiness ≥ 70' },
        { key: 'revenue', label: 'Revenue', score: 38, n_passing: 43, total: 113, threshold: 'adoption ≥ 50' },
      ],
    },
  };
}

export default router;
