// Mode B audience parser — Phase 2-A.
//
// Interprets a free-form target audience description ("30s DeFi
// expert", "암호화폐 처음 써보는 30대 한국인 여성") into a
// CohortSelector — the same axis-range type used by the standard
// cohorts. The resulting selector feeds the Mode B persona-selection
// step (pick up to N personas whose vectors fall inside the range).
//
// Falls back gracefully on LLM/parse failure: returns an empty
// selector (no constraints) so the pipeline still runs against the
// full pool — the report surfaces isFallback so the operator knows.
//
// Cost: ~$0.001 per scan (one Haiku call).

import { z } from 'zod';
import type { CohortSelector } from '@41rpm/shared';
import { client, extractTextContent, withRoute } from '../anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from '../llm.js';
import { logger } from '../../logger.js';

const log = logger.child({ service: 'audience_parser' });

// ─── Zod schema mirroring CohortSelector ──────────────────────────
const AGE_GROUPS = ['teen', 'young_adult', 'adult', 'senior'] as const;
const RANGE = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

const selectorSchema = z.object({
  age_group: z.array(z.enum(AGE_GROUPS)).optional(),
  tech_literacy: RANGE.optional(),
  crypto_experience: RANGE.optional(),
  design_sensitivity: RANGE.optional(),
  patience_level: RANGE.optional(),
  english_fluency: RANGE.optional(),
  mobile_first: z.array(z.boolean()).optional(),
  expertise_defi: RANGE.optional(),
  expertise_nft: RANGE.optional(),
  expertise_general_web: RANGE.optional(),
  ui_critical: RANGE.optional(),
  security_aware: RANGE.optional(),
  detail_oriented: RANGE.optional(),
});

// Concrete example for the LLM. Demonstrates the SHAPE — numeric
// ranges as [lo, hi], age_group as array of allowed values,
// mobile_first as a boolean array. Same prompt-fix pattern that
// kept Phase 1C-A from breaking.
const SELECTOR_TEMPLATE: CohortSelector = {
  age_group: ['adult'],
  tech_literacy: [0.6, 1.0],
  crypto_experience: [0.7, 1.0],
  expertise_defi: [0.6, 1.0],
};

const PARSE_RULES = `
RULES:
- Output ONLY a JSON object (no markdown fences, no commentary).
- Include only axes that the description constrains. Omit any axis
  the description doesn't speak to (becomes "no constraint").
- For age_group: pick from ["teen","young_adult","adult","senior"].
  teen ≈ <20, young_adult ≈ 20s, adult ≈ 30-49, senior ≈ 50+.
  If multiple plausible (e.g. "20-30s"), include both.
- All numeric ranges are [lo, hi] over 0.0..1.0.
- mobile_first: [true] or [false] when device is named; omit otherwise.
- crypto_experience axis interpretation:
    0.0-0.2 = never used crypto
    0.2-0.5 = beginner / curious
    0.5-0.8 = comfortable user
    0.8-1.0 = power user / DeFi pro
- Be GENEROUS with ranges — prefer [0.4, 0.8] over narrow [0.6, 0.7]
  unless the description is unambiguous.`;

type ParsedAudience = {
  selector: CohortSelector;
  label: string;
  isFallback: boolean;
};

export async function parseAudience(text: string): Promise<ParsedAudience> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { selector: {}, label: '(empty)', isFallback: true };
  }

  const system = `You are a UX research synthesizer. Convert a free-form target audience description into a structured selector over PersonaVector axes. Output JSON only.`;
  const user = [
    `Target audience: "${trimmed}"`,
    '',
    'Respond with EXACTLY this JSON shape (use the example values as a SHAPE template, replace values to match the audience above):',
    JSON.stringify(SELECTOR_TEMPLATE, null, 2),
    PARSE_RULES,
  ].join('\n');

  try {
    const msg = await withRoute('audience_fit.parse_audience', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 600,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    );
    const raw = parseJsonSafe<unknown>(extractTextContent(msg));
    const selector = selectorSchema.parse(raw);
    return { selector, label: trimmed, isFallback: false };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message.slice(0, 200) : 'unknown', text: trimmed },
      'audience parse failed — using broad fallback',
    );
    return { selector: {}, label: trimmed, isFallback: true };
  }
}
