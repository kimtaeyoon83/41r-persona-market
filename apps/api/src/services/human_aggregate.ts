// Human-aggregate pipeline — Phase 5.
//
// Reads survey_responses rows for a scan, runs them through the
// SAME aggregation primitives the AI pipeline uses (dimension
// score mapping → friction clustering → AARRR), and writes a
// like-for-like report into audience_fit_scans.human_aggregate.
//
// Why mirror the AI shape: the comparison report (/validator/compare)
// renders human-side metrics next to AI-side ones, so they MUST
// share the same vocabulary (audience_fit_score, frictions[], aarrr
// stages, dimension_breakdown). Keeping the same helpers also means
// any future fix to the AARRR cumulative semantics or friction
// clustering invariants automatically benefits humans too.
//
// Single-bucket model: humans are NOT pre-bucketed by cohort, so the
// human report uses Mode-B-style "single audience" math
// (audience_fit_score = cohort_fit_score, no best/worst/median split).
// Phase 6 may add demographic cohort matching once n is high enough.
//
// Idempotent: writes overwrite previous human_aggregate. Caller
// (POST /:id/human-aggregate handler) decides when to re-run.

import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { computeAarrrFromRows, type AarrrFunnel } from './aarrr.js';
import {
  assembleFrictionClusters,
  type FrictionCluster,
  type FrictionInputItem,
  type FrictionLLMCluster,
} from './dimensions/frictions.js';
import { client, extractTextContent, withRoute } from './anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from './llm.js';
import { logger } from '../logger.js';
import { z } from 'zod';

const log = logger.child({ service: 'human_aggregate' });

// ─── Dimension score mapping (mirror /survey handler) ──────────────
// These constants stay in lockstep with the AI persona's per-dimension
// formulas in services/dimensions/llm.ts and the inline values in
// routes/scan.ts /:id/survey. Duplicated here so the aggregate
// doesn't depend on a route's internals.

const ENGAGEMENT_TO_SCORE: Record<string, number> = {
  abandon: 10,
  skim: 30,
  browse: 55,
  engage: 75,
  extended: 90,
};

const RETENTION_TO_D7: Record<string, number> = {
  no_return: 0,
  weak: 5,
  moderate: 30,
  strong: 55,
};

function computeSusScore(responses: readonly number[]): number {
  // Canonical SUS-10. Same body as services/audience_fit.ts +
  // routes/scan.ts /:id/survey.
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const r = responses[i] ?? 3;
    sum += i % 2 === 0 ? r - 1 : 5 - r;
  }
  return sum * 2.5;
}

// Per-respondent scores in the same key set the AI pipeline writes
// to scan_persona_responses. Exported so the fidelity PoC
// (services/fidelity) scores humans through the SAME formula the
// comparison report uses — single source for human dimension scoring.
export type RespondentScores = {
  happiness: number;
  taskSuccess: number;
  adoption: number;
  retentionD7: number;
  engagement: number;
};

export function scoreRespondent(
  row: typeof schema.surveyResponses.$inferSelect,
): RespondentScores {
  const di = row.dimensionInputs;
  return {
    happiness: computeSusScore(row.susResponses),
    taskSuccess: di.completion_likelihood * 100,
    adoption: di.signup_likelihood * 100,
    retentionD7: RETENTION_TO_D7[di.retention_category] ?? 0,
    engagement: ENGAGEMENT_TO_SCORE[di.engagement_category] ?? 30,
  };
}

// ─── Public output shape ────────────────────────────────────────────
export type HumanAggregate = {
  /** Number of survey_responses rows the aggregate was built from. */
  n_respondents: number;
  /** Single-bucket fit score. Same DIMENSION_WEIGHTS_V1 formula as
   *  cohort_fit_score on the AI side: 0.30·eng + 0.30·tsk + 0.25·hap
   *  + 0.10·ado + 0.05·ret. Mirrors Mode B's
   *  `audience_fit_score = cohort_fit_score` collapse. */
  audience_fit_score: number;
  /** Per-dimension means (0-100). Same key set as the AI side. */
  dimension_means: {
    happiness: number;
    task_success: number;
    adoption: number;
    retention_d7: number;
    engagement: number;
  };
  /** Friction clusters from the 4 voice fields + free-text custom
   *  answers. Same shape as AI side; null when n_respondents < 3
   *  (Haiku won't produce stable clusters below that floor). */
  frictions: FrictionCluster[] | null;
  /** AARRR funnel using the same v1.1 thresholds as AI. */
  aarrr: AarrrFunnel | null;
  /** Per-custom-question rollup. Likert: { mean, n_answered }.
   *  Text: { quotes: string[] (up to 3 sample answers) }. Empty
   *  object when the scan has no custom_questions. */
  custom_question_rollup: Record<
    string,
    { likert?: { mean: number; n_answered: number }; quotes?: string[] }
  >;
  /** ISO timestamp of when this aggregate was computed. */
  computed_at: string;
};

// Same v1.1 weights as services/audience_fit.ts DIMENSION_WEIGHTS_V1.
// Inlined to keep this module decoupled from the calibration table.
const W = {
  engagement: 0.30,
  taskSuccess: 0.30,
  happiness: 0.25,
  adoption: 0.10,
  retentionD7: 0.05,
} as const;

function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

// ─── Friction clustering for human side ─────────────────────────────
// Parallel to clusterFrictions(scanId) in services/dimensions/frictions.ts
// but pulls voice strings from survey_responses (4 voice fields +
// free-text custom answers) and tags everything with cohort='human'
// since respondents aren't bucketed.
async function clusterHumanFrictions(
  rows: ReadonlyArray<typeof schema.surveyResponses.$inferSelect>,
  customQuestions: ReadonlyArray<{ id: string; type: string }> | null,
): Promise<FrictionCluster[] | null> {
  // Friction-shaped fields (biggest_friction, if_could_change_one_thing)
  // get priority; first_impression / would_return_because come along
  // because they often include implicit pain points worth clustering.
  // Free-text custom answers also feed in.
  const textQuestionIds = new Set(
    (customQuestions ?? [])
      .filter((q) => q.type === 'text')
      .map((q) => q.id),
  );

  const items: FrictionInputItem[] = [];
  for (const r of rows) {
    const v = r.voice ?? {};
    const candidates = [
      v.biggest_friction,
      v.if_could_change_one_thing,
      v.first_impression,
      v.would_return_because,
    ];
    for (const s of candidates) {
      if (typeof s === 'string' && s.trim().length >= 8) {
        items.push({ cohortId: 'human', friction: s.trim() });
      }
    }
    for (const id of textQuestionIds) {
      const ans = r.customAnswers[id];
      if (typeof ans === 'string' && ans.trim().length >= 8) {
        items.push({ cohortId: 'human', friction: ans.trim() });
      }
    }
  }

  if (items.length === 0) return null;
  if (items.length < 3) {
    return [
      {
        rank: 1,
        title: 'Raw human voice',
        summary: `${items.length} respondent voice quote${items.length === 1 ? '' : 's'} — clustering skipped (n < 3).`,
        where: 'Survey free-text',
        quote: items[0]!.friction,
        n: items.length,
        impact: '—',
        affected_cohorts: ['Human respondents'],
      },
    ];
  }

  const numbered = items
    .map((i, idx) => `[${idx}] "${i.friction}"`)
    .join('\n');

  const system = `You are a UX research synthesizer. Given a list of voice quotes from real human visitors to a website, group semantically equivalent complaints / observations into 3-5 themed clusters. Output JSON only.`;
  const user = `Voice quotes from ${items.length} human respondents:

${numbered}

Respond with EXACTLY a JSON array of 3-5 cluster objects matching this shape:
[
  {
    "title": "Pricing unclear",
    "summary": "Visitors couldn't tell which tier they needed without scrolling past the fold.",
    "where": "Pricing / Hero",
    "representative_quote": "I had to scroll three times before seeing the actual prices.",
    "persona_indices": [0, 3, 7]
  }
]

RULES:
- Return EXACTLY a JSON array of 3-5 cluster objects.
- title: short noun phrase (≤8 words).
- summary: ≤30 words explaining the theme.
- where: page or step name.
- representative_quote: pick one input quote VERBATIM.
- persona_indices: 0-based indices into the input list.
- Output ONLY the JSON array, no markdown fences, no commentary.`;

  const llmClusterSchema = z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      where: z.string(),
      representative_quote: z.string(),
      persona_indices: z.array(z.number().int().nonnegative()),
    }),
  );

  let parsed: FrictionLLMCluster[];
  try {
    const msg = await withRoute('validator.cluster_human_frictions', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 2000,
        temperature: 0.4,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    );
    const raw = parseJsonSafe<unknown>(extractTextContent(msg));
    parsed = llmClusterSchema.parse(raw);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message.slice(0, 200) : 'unknown' },
      'human friction clustering failed',
    );
    return null;
  }

  return assembleFrictionClusters(items, parsed);
}

// ─── Custom question rollup ────────────────────────────────────────
function rollupCustomAnswers(
  rows: ReadonlyArray<typeof schema.surveyResponses.$inferSelect>,
  customQuestions: ReadonlyArray<{ id: string; type: string }> | null,
): HumanAggregate['custom_question_rollup'] {
  const out: HumanAggregate['custom_question_rollup'] = {};
  if (!customQuestions || customQuestions.length === 0) return out;

  for (const q of customQuestions) {
    if (q.type === 'likert') {
      const nums: number[] = [];
      for (const r of rows) {
        const v = r.customAnswers[q.id];
        if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
      }
      out[q.id] = {
        likert: {
          mean: nums.length > 0 ? meanOf(nums) : 0,
          n_answered: nums.length,
        },
      };
    } else {
      const quotes: string[] = [];
      for (const r of rows) {
        const v = r.customAnswers[q.id];
        if (typeof v === 'string' && v.trim().length >= 4 && quotes.length < 3) {
          quotes.push(v.trim());
        }
      }
      out[q.id] = { quotes };
    }
  }
  return out;
}

// ─── Public entry point ────────────────────────────────────────────
export async function recomputeHumanAggregate(
  scanId: string,
): Promise<HumanAggregate | null> {
  const rows = await db
    .select()
    .from(schema.surveyResponses)
    .where(eq(schema.surveyResponses.scanId, scanId));

  if (rows.length === 0) {
    log.info({ scanId }, 'no survey_responses to aggregate');
    return null;
  }

  const [scan] = await db
    .select({ customQuestions: schema.audienceFitScans.customQuestions })
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, scanId));
  const customQuestions = scan?.customQuestions ?? null;

  const scored = rows.map((r) => scoreRespondent(r));
  const dimMeans = {
    happiness: meanOf(scored.map((s) => s.happiness)),
    task_success: meanOf(scored.map((s) => s.taskSuccess)),
    adoption: meanOf(scored.map((s) => s.adoption)),
    retention_d7: meanOf(scored.map((s) => s.retentionD7)),
    engagement: meanOf(scored.map((s) => s.engagement)),
  };

  const audienceFitScore =
    W.engagement * dimMeans.engagement +
    W.taskSuccess * dimMeans.task_success +
    W.happiness * dimMeans.happiness +
    W.adoption * dimMeans.adoption +
    W.retentionD7 * dimMeans.retention_d7;

  const aarrrInputRows = scored.map((s) => ({
    isFlagged: false,
    happiness: s.happiness,
    taskSuccess: s.taskSuccess,
    adoption: s.adoption,
    retentionD7: s.retentionD7,
  }));
  const aarrr = computeAarrrFromRows(aarrrInputRows);

  const frictions = await clusterHumanFrictions(rows, customQuestions);
  const customRollup = rollupCustomAnswers(rows, customQuestions);

  const aggregate: HumanAggregate = {
    n_respondents: rows.length,
    audience_fit_score: audienceFitScore,
    dimension_means: dimMeans,
    frictions,
    aarrr,
    custom_question_rollup: customRollup,
    computed_at: new Date().toISOString(),
  };

  await db
    .update(schema.audienceFitScans)
    .set({ humanAggregate: aggregate })
    .where(eq(schema.audienceFitScans.id, scanId));

  log.info(
    { scanId, n: rows.length, score: audienceFitScore.toFixed(1) },
    'human aggregate computed',
  );

  return aggregate;
}
