// Site-specific custom survey question generator — Phase 5.
//
// One Haiku vision call per scan, run after site_classifier so we
// have category + one_line_pitch + screenshot already cached. Asks
// Haiku to draft 3-5 site-aware questions a human respondent could
// answer — mixing 1-5 Likert (so we can compare numerics across
// AI vs human aggregates) and free-text (qualitative depth).
//
// Stored verbatim on audience_fit_scans.custom_questions; the
// survey UI renders these alongside the fixed §11.1 question set
// and persists per-respondent answers in survey_responses.custom_answers.
//
// Failure mode: returns null on any error. Caller writes nothing
// (the column stays null), and the survey UI simply omits the
// custom-question section. No scan-level blocking.

import type Anthropic from '@anthropic-ai/sdk';
import { client, extractTextContent, withRoute } from '../anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from '../llm.js';
import { readCaptureAsBase64 } from '../site_capture.js';
import { z } from 'zod';
import { logger } from '../../logger.js';

const log = logger.child({ service: 'custom_questions' });

const DIMENSION_HINTS = [
  'engagement',
  'task_success',
  'happiness',
  'adoption',
  'retention',
] as const;

const questionSchema = z.object({
  id: z.string().regex(/^cq[1-9]\d?$/, 'id must be cq1..cq99'),
  type: z.enum(['likert', 'text']),
  question: z.string().min(8).max(200),
  dimension_hint: z.enum(DIMENSION_HINTS).optional(),
});

const responseSchema = z.object({
  questions: z.array(questionSchema).min(3).max(5),
});

export type CustomQuestion = z.infer<typeof questionSchema>;

const SYSTEM = `You are a UX research assistant. Look at the supplied
screenshot + category + value-prop summary of a website, and draft
3-5 site-specific survey questions a real human visitor could answer
after using the site for a few minutes. Questions must be diagnostic
of how a real visitor would react to THIS specific site — not generic
usability questions (those are already asked separately via SUS-10).
Return ONLY a single JSON object. No prose before or after.`;

const SCHEMA_TEMPLATE = {
  questions: [
    {
      id: 'cq1',
      type: 'likert',
      question: 'How clear was the pricing information on the landing page?',
      dimension_hint: 'task_success',
    },
    {
      id: 'cq2',
      type: 'text',
      question:
        'If you only had 30 seconds on this site, what would you do first?',
    },
    {
      id: 'cq3',
      type: 'likert',
      question:
        'How likely are you to recommend this product to a colleague after this visit?',
      dimension_hint: 'adoption',
    },
  ],
};

const RULES = `Rules:
- Generate 3-5 questions total. At least 1 likert AND at least 1 text.
- "id" MUST be sequential (cq1, cq2, cq3, ...).
- "type" is "likert" (1-5 agreement scale, respondent picks an int)
  or "text" (free-form 1-3 sentences).
- "question" must reference something concrete the visitor would
  actually encounter on THIS site (a feature, a CTA, a section,
  pricing tier, hero copy, etc.) — quote-paraphrase from the
  screenshot when possible. Avoid generic "How easy was the site?"
  questions.
- "dimension_hint" is OPTIONAL on likert questions. Use it when the
  question maps cleanly to one of: engagement, task_success,
  happiness, adoption, retention. Omit otherwise.
- Do NOT ask about anything not visible in the screenshot or implied
  by the category/pitch. No fabricated features.
- Each "question" ≤ 200 chars. Plain English. No jargon unless the
  site is technical and uses that jargon itself.`;

function buildImageBlock(
  screenshotUrl: string,
): Anthropic.ImageBlockParam | null {
  if (
    screenshotUrl.startsWith('http://') ||
    screenshotUrl.startsWith('https://')
  ) {
    return { type: 'image', source: { type: 'url', url: screenshotUrl } };
  }
  const local = readCaptureAsBase64(screenshotUrl);
  if (!local) return null;
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: local.mediaType,
      data: local.data,
    },
  };
}

export async function generateCustomQuestions(args: {
  targetUrl: string;
  category: string | null;
  oneLinePitch: string | null;
  screenshotUrls: readonly string[];
}): Promise<CustomQuestion[] | null> {
  const { targetUrl, category, oneLinePitch, screenshotUrls } = args;
  // Same screenshot preference as site_classifier — viewport-crop
  // first, full-page fallback.
  const preferred = screenshotUrls[1] ?? screenshotUrls[0];
  if (!preferred) {
    log.warn(
      { targetUrl },
      'generateCustomQuestions: no screenshot — skipping',
    );
    return null;
  }
  const imageBlock = buildImageBlock(preferred);
  if (!imageBlock) {
    log.warn(
      { targetUrl, preferred },
      'generateCustomQuestions: image block unreadable',
    );
    return null;
  }

  const contextLines: string[] = [`URL: ${targetUrl}`];
  if (category) contextLines.push(`Category: ${category}`);
  if (oneLinePitch) contextLines.push(`Pitch: ${oneLinePitch}`);

  const userText = `${contextLines.join('\n')}

Respond with EXACTLY this JSON shape (replace example values with
your generated questions):
${JSON.stringify(SCHEMA_TEMPLATE, null, 2)}

${RULES}`;

  try {
    const msg = await withRoute('validator.custom_questions', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 800,
        temperature: 0.4,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [imageBlock, { type: 'text', text: userText }],
          },
        ],
      }),
    );
    const raw = parseJsonSafe<unknown>(extractTextContent(msg));
    const parsed = responseSchema.parse(raw);
    return parsed.questions;
  } catch (err) {
    log.warn(
      { targetUrl, err: err instanceof Error ? err.message : 'unknown' },
      'generateCustomQuestions failed — survey UI will skip the section',
    );
    return null;
  }
}
