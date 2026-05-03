// Friction clustering — Phase 1C-B.
//
// After the per-persona LLM responses land, run a single Haiku
// clustering pass over the full set of voiceBiggestFriction strings
// to produce 3-5 themed friction clusters. Result cached on
// audience_fit_scans.frictionsJson.
//
// Falls back gracefully on LLM failure: returns null (caller leaves
// frictionsJson null and the report shows the placeholder
// cohort-derived frictions).
//
// Cost: ~$0.003 per scan (~5K input tokens, ~1K output Haiku).

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { COHORT_BY_ID } from '@41rpm/shared';
import { db, schema } from '../../db/index.js';
import { logger } from '../../logger.js';
import { client, extractTextContent, withRoute } from '../anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from '../llm.js';

const log = logger.child({ service: 'frictions' });

export type FrictionCluster = {
  rank: number;
  title: string;
  summary: string;
  n: number;
  where: string;
  impact: string;
  quote: string;
  affected_cohorts: string[];
};

export type FrictionInputItem = {
  cohortId: string;
  friction: string;
};

export type FrictionLLMCluster = {
  title: string;
  summary: string;
  where: string;
  representative_quote: string;
  persona_indices: number[];
};

// Pure compute — turns the raw LLM cluster output into the final
// ranked + capped + long-tail-padded FrictionCluster[]. Exported so
// the contract can be unit-tested without an LLM call. Two locks
// matter most: (a) `n` per cluster ALWAYS sums to items.length when
// items > 0 (no silent drop), (b) the "Other / long-tail" bucket is
// always appended when any input persona didn't land in a named
// cluster — even past the top-5 cap.
export function assembleFrictionClusters(
  items: ReadonlyArray<FrictionInputItem>,
  parsed: ReadonlyArray<FrictionLLMCluster>,
): FrictionCluster[] {
  const assigned = new Set<number>();
  const ranked = parsed
    .map((c) => {
      const personasInCluster = c.persona_indices
        .map((i) => {
          const it = items[i];
          if (it !== undefined) assigned.add(i);
          return it;
        })
        .filter((it): it is FrictionInputItem => it !== undefined);
      const cohortIds = Array.from(
        new Set(personasInCluster.map((p) => p.cohortId)),
      );
      const cohortLabels = cohortIds.map((id) => COHORT_BY_ID[id]?.label ?? id);
      return {
        title: c.title,
        summary: c.summary,
        where: c.where,
        quote: c.representative_quote,
        n: personasInCluster.length,
        affected_cohorts: cohortLabels,
      };
    })
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  const unassigned = items.filter((_, i) => !assigned.has(i));
  if (unassigned.length > 0) {
    const otherCohorts = Array.from(
      new Set(unassigned.map((p) => p.cohortId)),
    ).map((id) => COHORT_BY_ID[id]?.label ?? id);
    ranked.push({
      title: 'Other / long-tail frictions',
      summary: `${unassigned.length} persona${unassigned.length > 1 ? 's' : ''} raised one-off concerns that did not cluster with the main themes.`,
      where: 'Various',
      quote: unassigned[0]!.friction,
      n: unassigned.length,
      affected_cohorts: otherCohorts,
    });
  }

  return ranked.map((c, i) => ({
    rank: i + 1,
    title: c.title,
    summary: c.summary,
    n: c.n,
    where: c.where,
    impact: `+${Math.round((c.n / Math.max(items.length, 1)) * 30)} fit est.`,
    quote: c.quote,
    affected_cohorts: c.affected_cohorts,
  }));
}

const clusterSchema = z.array(
  z.object({
    title: z.string().max(120),
    summary: z.string().max(400),
    where: z.string().max(80),
    representative_quote: z.string().max(400),
    persona_indices: z.array(z.number().int().min(0)),
  }),
);

// Concrete example values — Haiku copies the SHAPE not the text.
const CLUSTER_TEMPLATE = [
  {
    title: 'Wallet selection ambiguity',
    summary: 'Personas struggled to pick which wallet to connect.',
    where: 'Connect wallet',
    representative_quote: 'Which wallet should I use? Phantom? MetaMask?',
    persona_indices: [0, 4, 7, 11],
  },
];

const CLUSTER_RULES = `
RULES:
- Return EXACTLY a JSON array (no wrapping object) of 3-5 cluster objects.
- title: short noun phrase (≤8 words).
- summary: ≤30 words explaining what's broken.
- where: page or step name (e.g., "Connect wallet", "Hero / Features").
- representative_quote: pick one input voice string verbatim that best represents the cluster.
- persona_indices: 0-based indices into the input list of personas in this cluster.
- Group semantically equivalent complaints — "I don't know which wallet" + "wallet picker confusing" + "what's MetaMask" all go in one cluster.
- Output ONLY the JSON array, no markdown fences, no commentary.`;

export async function clusterFrictions(scanId: string): Promise<FrictionCluster[] | null> {
  const rows = await db
    .select({
      personaId: schema.scanPersonaResponses.personaId,
      cohortId: schema.scanPersonaResponses.cohortId,
      friction: schema.scanPersonaResponses.voiceBiggestFriction,
    })
    .from(schema.scanPersonaResponses)
    .where(eq(schema.scanPersonaResponses.scanId, scanId));

  const items = rows
    .filter(
      (r): r is typeof r & { friction: string } =>
        typeof r.friction === 'string' && r.friction.trim().length > 0,
    )
    .map((r, idx) => ({ idx, ...r }));

  if (items.length === 0) {
    log.info({ scanId }, 'no friction strings to cluster');
    return null;
  }

  const numbered = items
    .map((i) => `[${i.idx}] (cohort=${i.cohortId}) "${i.friction}"`)
    .join('\n');

  const system = `You are a UX research synthesizer. Given a list of friction quotes from individual personas, group semantically equivalent complaints into 3-5 themed clusters. Output JSON only.`;
  const user = [
    `Friction quotes from ${items.length} personas:`,
    '',
    numbered,
    '',
    'Respond with EXACTLY this JSON array shape (replace example values):',
    JSON.stringify(CLUSTER_TEMPLATE, null, 2),
    CLUSTER_RULES,
  ].join('\n');

  let parsed: z.infer<typeof clusterSchema>;
  try {
    const msg = await withRoute('audience_fit.cluster_frictions', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 2000,
        temperature: 0.4,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    );
    const raw = parseJsonSafe<unknown>(extractTextContent(msg));
    parsed = clusterSchema.parse(raw);
  } catch (err) {
    log.warn(
      { scanId, err: err instanceof Error ? err.message.slice(0, 200) : 'unknown' },
      'friction clustering failed',
    );
    return null;
  }

  const clusters = assembleFrictionClusters(items, parsed);

  await db
    .update(schema.audienceFitScans)
    .set({ frictionsJson: clusters })
    .where(eq(schema.audienceFitScans.id, scanId));

  log.info(
    { scanId, items: items.length, clusters: clusters.length },
    'friction clustering complete',
  );

  return clusters;
}
