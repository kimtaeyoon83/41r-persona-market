// Real LLM persona response — Phase 1C-A.
//
// Drop-in replacement for `simulatePersonaResponse` from
// `dimension_simulator.ts`. Same input/output shape so the pipeline
// can dispatch between simulator (dev iteration) and real LLM (real
// scans) by env flag without touching the orchestration layer.
//
// Phase 1C-A is text-only — the prompt describes the URL but does
// NOT yet send screenshots. Phase 1C-B will add Stagehand capture
// and switch the prompt to vision (Sonnet) per spec §11.1.
//
// Model: Haiku (~$0.001/persona, ~$0.11 per 112-persona scan).
// Phase 1C-B upgrade to Sonnet vision will run ~$5.66/scan as
// projected in the spec discussion.

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { client, extractTextContent, withRoute } from '../anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from '../llm.js';
import {
  ENGAGEMENT_BAND_TO_SCORE,
  RETENTION_BAND_TO_DCURVE,
  computeSusScore,
  type EngagementBand,
  type RetentionBand,
} from '../audience_fit.js';
import type { PersonaRow } from '../cohort_selection.js';
import type { SimulatedResponse } from '../dimension_simulator.js';
import { readCaptureAsBase64 } from '../site_capture.js';

// ─── Zod schema for §11.1 response ───────────────────────────────
// Strict — any LLM deviation throws. Caller treats parse failure as
// a flagged response (still record it, exclude from cohort means).
const SUS_LIKERT = z.number().int().min(1).max(5);
const ZERO_TO_ONE = z.number().min(0).max(1);
const ZERO_TO_100 = z.number().min(0).max(100);

const ENGAGEMENT_BANDS = ['abandon', 'skim', 'browse', 'engage', 'extended'] as const;
const RETENTION_BANDS = ['no_return', 'weak', 'moderate', 'strong'] as const;
const RETENTION_WINDOWS = ['no_return', '1day', '1week', '1month'] as const;

export const personaResponseSchema = z.object({
  happiness: z.object({
    sus_responses: z.array(SUS_LIKERT).length(10),
    raw_score: ZERO_TO_100,
    voice_first_impression: z.string().max(800),
  }),
  engagement: z.object({
    category: z.enum(ENGAGEMENT_BANDS),
    interaction_depth_estimate: z.number().int().min(0).max(50),
    abandon_likely_at: z.string().max(120),
    voice_friction: z.string().max(600),
  }),
  adoption: z.object({
    signup_likelihood: ZERO_TO_ONE,
    primary_barrier: z.string().max(600),
    trigger_to_signup: z.string().max(400),
  }),
  retention: z.object({
    category: z.enum(RETENTION_BANDS),
    expected_return_window: z.enum(RETENTION_WINDOWS),
    return_motivation_text: z.string().max(600),
  }),
  task_success: z.object({
    core_action_understood: z.string().max(200),
    completion_likelihood: ZERO_TO_ONE,
    blocking_friction: z.string().max(600),
    voice_attempt: z.string().max(800),
  }),
  voice_quotes: z.object({
    biggest_friction: z.string().max(400),
    would_return_because: z.string().max(400),
    if_could_change_one_thing: z.string().max(400),
  }),
  self_consistency_check: z.object({
    happiness_retention_aligned: z.boolean(),
    alignment_note: z.string().max(400),
  }),
});

export type PersonaLLMResponse = z.infer<typeof personaResponseSchema>;

// ─── Prompt builder ───────────────────────────────────────────────
function buildSystemPrompt(): string {
  return `You are a UX research synthesizer responding AS a specific human persona looking at a product. You output JSON only — no prose outside the JSON.

Stay in character. The persona is fictional but its voice and reactions must be plausible given the supplied PersonaVector. Do NOT pretend ability the persona doesn't have, and do NOT pretend interest the persona doesn't have.

Be honest about engagement. Real first-time visitors abandon sites quickly — across typical web traffic ~50% leave within 15 seconds, ~75% within a minute. Mark engagement.category=abandon when ANY of:
  - The persona physically cannot use the site (e.g. low english_fluency on an English-only site)
  - The site's category / topic does not match the persona's interests or expertise
  - The persona's tech_literacy is incompatible with the interface complexity
  - The value proposition is not legible to this persona at first glance
  - The persona has no incentive to invest more than 15 seconds

Reference distribution across all visitors (engagement.category):
  abandon ~50%   skim ~25%   browse ~17%   engage ~5%   extended ~3%

Adjust based on persona-fit: a strong-fit persona may land at engage/extended, a weak-fit persona must land at abandon/skim. Personas should NOT all collapse into "browse" — that hides the audience signal you're being asked to surface.

When engagement.category=abandon, also set interaction_depth_estimate ≤ 1, retention.category=no_return, signup_likelihood ≤ 0.05, completion_likelihood ≤ 0.05. An abandoner doesn't sign up or complete tasks.

If you cannot judge a dimension from what you know about the URL, set numeric values to 0 and explain in the matching voice field. Do NOT invent specifics about the site.`;
}

// Concrete example values — Haiku copies the SHAPE not the text.
// If we use `'[10 ints 1-5...]'` as a placeholder string, Haiku
// returns it verbatim as a string instead of replacing with an array.
// Real values teach the model what types each field expects.
const SCHEMA_TEMPLATE = {
  happiness: {
    sus_responses: [4, 2, 4, 3, 4, 2, 4, 3, 4, 2],
    raw_score: 65,
    voice_first_impression: 'Replace this with the persona\'s first impression voice.',
  },
  engagement: {
    category: 'browse',
    interaction_depth_estimate: 8,
    abandon_likely_at: 'none',
    voice_friction: 'Replace with the persona\'s friction voice.',
  },
  adoption: {
    signup_likelihood: 0.55,
    primary_barrier: 'Replace with primary barrier text.',
    trigger_to_signup: 'Replace with what would tip them.',
  },
  retention: {
    category: 'weak',
    expected_return_window: '1day',
    return_motivation_text: 'Replace with return-motivation voice.',
  },
  task_success: {
    core_action_understood: 'Replace with what persona thinks primary task is',
    completion_likelihood: 0.6,
    blocking_friction: 'Replace with blocking friction text.',
    voice_attempt: 'Replace with persona\'s narration of the attempt.',
  },
  voice_quotes: {
    biggest_friction: 'Replace with biggest friction quote.',
    would_return_because: 'Replace with reason they would return.',
    if_could_change_one_thing: 'Replace with one-thing-to-change quote.',
  },
  self_consistency_check: {
    happiness_retention_aligned: true,
    alignment_note: '',
  },
};

// Type/range constraints — appended to the prompt as a separate
// section so Haiku doesn't mistake them for required string values.
const SCHEMA_RULES = `
RULES:
- happiness.sus_responses: array of EXACTLY 10 integers, each 1-5.
  Canonical SUS order Q1..Q10.
- happiness.raw_score: integer 0-100.
- engagement.category: exactly one of "abandon" | "skim" | "browse" | "engage" | "extended".
- engagement.interaction_depth_estimate: integer 0-30.
- adoption.signup_likelihood: float 0.0-1.0.
- retention.category: exactly one of "no_return" | "weak" | "moderate" | "strong".
- retention.expected_return_window: exactly one of "no_return" | "1day" | "1week" | "1month".
- task_success.completion_likelihood: float 0.0-1.0.
- All voice_* fields: persona voice, ≤80 words each.
- self_consistency_check.happiness_retention_aligned: false ONLY when
  happiness>70 AND retention=no_return (or happiness<30 AND retention=strong).
- Replace every "Replace with..." placeholder string with the persona's actual content.
- Output ONLY the JSON object, no markdown fences, no commentary.`;

function buildUserPrompt(persona: PersonaRow, targetUrl: string, hypothesis?: string): string {
  const v = persona.vector;
  const d = v.demographics;
  const u = v.ux_preferences;

  const lines: string[] = [];
  lines.push(`Target URL: ${targetUrl}`);
  lines.push('');
  lines.push('Persona profile:');
  lines.push(`  voice_sample: "${v.voice_sample}"`);
  if (d) {
    lines.push(`  age_group: ${d.age_group}`);
    lines.push(`  tech_literacy: ${d.tech_literacy.toFixed(2)}`);
    lines.push(`  crypto_experience: ${d.crypto_experience.toFixed(2)}`);
    lines.push(`  design_sensitivity: ${d.design_sensitivity.toFixed(2)}`);
    lines.push(`  patience_level: ${d.patience_level.toFixed(2)}`);
  }
  if (u) {
    lines.push(`  mobile_first: ${u.mobile_first}`);
    lines.push(`  visual_style_pref: ${u.visual_style}`);
  }
  lines.push(`  expertise.defi: ${v.expertise.defi.toFixed(2)}`);
  lines.push(`  expertise.nft: ${v.expertise.nft.toFixed(2)}`);
  lines.push(`  expertise.general_web: ${v.expertise.general_web.toFixed(2)}`);
  lines.push(`  feedback.security_aware: ${v.feedback_pattern.security_aware.toFixed(2)}`);
  lines.push(`  feedback.ui_critical: ${v.feedback_pattern.ui_critical.toFixed(2)}`);
  lines.push(`  feedback.detail_oriented: ${v.feedback_pattern.detail_oriented.toFixed(2)}`);
  if (hypothesis) {
    lines.push('');
    lines.push(`Company hypothesis to probe: "${hypothesis}"`);
  }

  lines.push('');
  lines.push('Respond with EXACTLY this JSON shape (replace every example value):');
  lines.push(JSON.stringify(SCHEMA_TEMPLATE, null, 2));
  lines.push(SCHEMA_RULES);
  return lines.join('\n');
}

// ─── Map LLM response → SimulatedResponse shape ──────────────────
export function mapLLMResponseToSimulated(parsed: PersonaLLMResponse): SimulatedResponse {
  // Re-derive SUS raw via the canonical formula. We trust the persona
  // for the Likert responses, not for the arithmetic.
  const susRawScore = computeSusScore(parsed.happiness.sus_responses);

  const engagementBand = parsed.engagement.category as EngagementBand;
  let retentionBand = parsed.retention.category as RetentionBand;

  // Defense in depth — system prompt asks the LLM to set signup/
  // completion ≤ 0.05 and retention=no_return when engagement=abandon,
  // but Haiku occasionally drifts and emits "abandoned but would
  // sign up". Clamp here so downstream cohort means + AARRR funnel
  // see consistent values regardless of model compliance.
  let signupLikelihood = parsed.adoption.signup_likelihood;
  let completionLikelihood = parsed.task_success.completion_likelihood;
  if (engagementBand === 'abandon') {
    signupLikelihood = Math.min(signupLikelihood, 0.05);
    completionLikelihood = Math.min(completionLikelihood, 0.05);
    retentionBand = 'no_return';
  }

  const retentionDCurve = RETENTION_BAND_TO_DCURVE[retentionBand];

  return {
    scores: {
      happiness: susRawScore,
      engagement: ENGAGEMENT_BAND_TO_SCORE[engagementBand],
      adoption: signupLikelihood * 100,
      retention_d7: retentionDCurve.d7,
      task_success: completionLikelihood * 100,
    },
    retention_band: retentionBand,
    retention_d_curve: retentionDCurve,
    engagement_band: engagementBand,
    raw: {
      sus_responses: parsed.happiness.sus_responses,
      sus_raw_score: susRawScore,
      signup_likelihood: signupLikelihood,
      completion_likelihood: completionLikelihood,
    },
    is_flagged: !parsed.self_consistency_check.happiness_retention_aligned,
    flag_reason: !parsed.self_consistency_check.happiness_retention_aligned
      ? parsed.self_consistency_check.alignment_note ||
        'self-consistency check failed'
      : null,
  };
}

// Voice quotes are persisted on scan_persona_responses but not used
// in cohort score math. Pull them out as a separate object so the
// pipeline can pass straight through to the INSERT.
export function extractVoiceQuotes(parsed: PersonaLLMResponse) {
  return {
    voiceFirstImpression: parsed.happiness.voice_first_impression || null,
    voiceFriction: parsed.engagement.voice_friction || null,
    voiceBiggestFriction: parsed.voice_quotes.biggest_friction || null,
    voiceWouldReturnBecause: parsed.voice_quotes.would_return_because || null,
  };
}

// ─── Main entry ───────────────────────────────────────────────────
export type PersonaResponseResult = {
  sim: SimulatedResponse;
  parsed: PersonaLLMResponse;
  llmCostUsd: number;
  llmLatencyMs: number;
};

// Build image content blocks for Sonnet vision. http(s) URLs use
// the URL source; local /site-captures/ paths get base64-encoded
// from /tmp via readCaptureAsBase64.
function buildImageBlocks(screenshotUrls: readonly string[]): Anthropic.ImageBlockParam[] {
  const blocks: Anthropic.ImageBlockParam[] = [];
  for (const u of screenshotUrls) {
    if (u.startsWith('http://') || u.startsWith('https://')) {
      blocks.push({ type: 'image', source: { type: 'url', url: u } });
      continue;
    }
    const local = readCaptureAsBase64(u);
    if (local) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: local.mediaType,
          data: local.data,
        },
      });
    }
  }
  return blocks;
}

export async function runPersonaResponseLLM(
  persona: PersonaRow,
  targetUrl: string,
  hypothesis?: string,
  screenshotUrls?: readonly string[],
): Promise<PersonaResponseResult> {
  const t0 = Date.now();
  const system = buildSystemPrompt();
  const userText = buildUserPrompt(persona, targetUrl, hypothesis);

  const useVision = !!screenshotUrls && screenshotUrls.length > 0;
  const imageBlocks = useVision ? buildImageBlocks(screenshotUrls) : [];
  const reallyVision = imageBlocks.length > 0;

  // When vision blocks are attached: Sonnet (handles images well).
  // When text-only: Haiku (cheaper, fast).
  const model = reallyVision ? SCORING_MODELS.sonnet : SCORING_MODELS.haiku;

  const userContent: Anthropic.ContentBlockParam[] = reallyVision
    ? [
        ...imageBlocks,
        { type: 'text', text: userText },
      ]
    : [{ type: 'text', text: userText }];

  const msg = await withRoute('validator.persona_response', () =>
    client.messages.create({
      model,
      max_tokens: 1400,
      temperature: 0.7,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  );

  const rawJson = parseJsonSafe<unknown>(extractTextContent(msg));
  const parsed = personaResponseSchema.parse(rawJson);
  const sim = mapLLMResponseToSimulated(parsed);

  // Pricing (Apr 2026):
  //   Haiku: input $0.80/MTok, output $4.00/MTok
  //   Sonnet: input $3.00/MTok, output $15.00/MTok
  const inputTok = msg.usage?.input_tokens ?? 0;
  const outputTok = msg.usage?.output_tokens ?? 0;
  const inPrice = reallyVision ? 3.0 : 0.8;
  const outPrice = reallyVision ? 15.0 : 4.0;
  const llmCostUsd =
    (inputTok / 1_000_000) * inPrice + (outputTok / 1_000_000) * outPrice;

  return {
    sim,
    parsed,
    llmCostUsd,
    llmLatencyMs: Date.now() - t0,
  };
}
