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
import { eq, asc, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { COHORT_BY_ID } from '@41rpm/shared';
import { db, schema } from '../db/index.js';
import {
  AUDIENCE_FIT_WEIGHTS,
  DIMENSION_WEIGHTS_V1,
} from '../services/audience_fit.js';
import { startScanWorker } from '../services/scan_pipeline.js';

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
  // responding step is still inserting rows.
  const [liveCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.scanPersonaResponses)
    .where(eq(schema.scanPersonaResponses.scanId, id));
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
    .where(eq(schema.scanPersonaResponses.scanId, id))
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
    .where(eq(schema.scanPersonaResponses.scanId, id))
    .orderBy(asc(sumExpr))
    .limit(3);

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
    fit_personas: fitRows.map(shapePersonaCard),
    non_fit_personas: nonFitRows.map(shapePersonaCard),
    // These three are computed at synthesis time; show them only when
    // the scan completes so partial state never displays misleading
    // pseudo-frictions or formula rows.
    frictions: completed ? buildFrictionsFromCohorts(cohortRows) : [],
    retention_curve: completed ? buildRetentionCurve(cohortRows) : [],
    formula_rows: completed ? buildFormulaRows(scan, cohortRows) : [],
    dimension_breakdown: completed ? buildDimensionBreakdown(cohortRows) : [],
    kpis: completed ? buildKpis(scan, cohortRows) : [],
  });
});

// ─── Per-persona card shaping ─────────────────────────────────────
function shapePersonaCard(r: {
  personaId: string;
  cohortId: string;
  happiness: number | null;
  engagement: number | null;
  taskSuccess: number | null;
  voiceFirstImpression?: string | null;
  voiceBiggestFriction?: string | null;
  voiceSample: typeof schema.personas.$inferSelect.vector;
  displayName: string;
}) {
  const score = Math.round(
    ((r.happiness ?? 0) + (r.engagement ?? 0) + (r.taskSuccess ?? 0)) / 3
  );
  const cohort = COHORT_BY_ID[r.cohortId];
  const ageGroup = r.voiceSample.demographics?.age_group;
  const age =
    ageGroup === 'teen'
      ? 16
      : ageGroup === 'young_adult'
      ? 25
      : ageGroup === 'senior'
      ? 58
      : 35;
  // Prefer the LLM-generated quote when available (real Phase 1C
  // scans). Falls back to the persona's seed voice_sample for
  // simulator runs or rows from before the LLM pipeline shipped.
  const quote =
    r.voiceFirstImpression ||
    r.voiceBiggestFriction ||
    r.voiceSample.voice_sample ||
    '';
  return {
    id: r.personaId,
    name: r.displayName ?? 'Synthetic',
    age,
    role: cohort?.label ?? r.cohortId,
    score,
    quote,
    tags: [r.cohortId, ageGroup ?? 'unknown'],
  };
}

// ─── Synthesis-tied builders (only meaningful when status='completed') ──
function buildFrictionsFromCohorts(
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  // Phase 1C will mine voice_friction columns + cluster via Haiku.
  // Phase 1B placeholder: surface the worst cohorts as friction rows
  // so the report is non-empty when the synthesis lands.
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
    quote: 'Voice clustering arrives in Phase 1C with the real LLM call.',
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

function buildKpis(
  scan: typeof schema.audienceFitScans.$inferSelect,
  rows: Array<typeof schema.scanCohortResults.$inferSelect>
) {
  const best = rows.find((c) => c.cohortId === scan.bestCohortId);
  const worst = rows.find((c) => c.cohortId === scan.worstCohortId);
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
    {
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
  };
}

export default router;
