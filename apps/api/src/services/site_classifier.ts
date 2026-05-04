// Site classifier — Phase 1C-D.
//
// One Haiku vision call per scan, run right after site_capture
// completes. Extracts:
//   - category: short top-level vertical (e.g. "DeFi", "SaaS",
//     "E-commerce", "Social", "Gaming", "Productivity", "AI Tools",
//     "Marketplace", "Media", "Other")
//   - category_confidence: 0..1 self-rated by the model
//   - one_line_pitch: 1-sentence value-prop the site appears to make
//
// Replaces the hardcoded `category: 'DeFi', confidence: 0.5,
// pitch: null` placeholder in scan_pipeline.ts. Cost ~$0.0008/scan
// (Haiku vision, ~600 input + ~120 output tokens).
//
// Failure mode: returns null on any error. Caller falls back to the
// existing placeholder so a transient classifier outage doesn't fail
// the whole scan.

import type Anthropic from '@anthropic-ai/sdk';
import { client, extractTextContent, withRoute } from './anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from './llm.js';
import { readCaptureAsBase64 } from './site_capture.js';
import { z } from 'zod';
import { logger } from '../logger.js';

const log = logger.child({ service: 'site_classifier' });

const CATEGORIES = [
  'DeFi',
  'SaaS',
  'E-commerce',
  'Social',
  'Gaming',
  'Productivity',
  'AI Tools',
  'Marketplace',
  'Media',
  'Crypto Wallet',
  'NFT',
  'Other',
] as const;

const responseSchema = z.object({
  category: z.enum(CATEGORIES),
  category_confidence: z.number().min(0).max(1),
  one_line_pitch: z.string().min(3).max(160),
});

export type SiteClassification = z.infer<typeof responseSchema>;

const SYSTEM = `You are a product analyst. Look at the supplied
screenshot of a website's landing/product page and classify it. Return
ONLY a single JSON object. No prose before or after.`;

const SCHEMA_TEMPLATE = {
  category: 'DeFi',
  category_confidence: 0.92,
  one_line_pitch: 'Decentralised swap aggregator with MEV protection.',
};

const RULES = `Rules:
- "category" MUST be one of: ${CATEGORIES.join(', ')}.
- "category_confidence" is YOUR confidence in the category choice
  (0=guessing, 1=certain). Use 0.5 if the page is ambiguous.
- "one_line_pitch" is a single English sentence summarising the
  product's stated value prop. Quote-paraphrase the hero text — do
  not invent claims. Keep ≤ 160 chars.
- Use "Other" for the category when nothing else fits — do not force
  a fit at low confidence into a recognisable bucket.`;

function buildImageBlock(
  screenshotUrl: string,
): Anthropic.ImageBlockParam | null {
  if (screenshotUrl.startsWith('http://') || screenshotUrl.startsWith('https://')) {
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

export async function classifySite(
  targetUrl: string,
  screenshotUrls: readonly string[],
): Promise<SiteClassification | null> {
  const first = screenshotUrls[0];
  if (!first) {
    log.warn({ targetUrl }, 'classifySite: no screenshot — skipping');
    return null;
  }
  const imageBlock = buildImageBlock(first);
  if (!imageBlock) {
    log.warn({ targetUrl, first }, 'classifySite: image block unreadable');
    return null;
  }

  const userText = `URL: ${targetUrl}

Respond with EXACTLY this JSON shape (replace example values):
${JSON.stringify(SCHEMA_TEMPLATE, null, 2)}

${RULES}`;

  try {
    const msg = await withRoute('validator.classify_site', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 220,
        temperature: 0.2,
        system: SYSTEM,
        messages: [
          { role: 'user', content: [imageBlock, { type: 'text', text: userText }] },
        ],
      }),
    );
    const raw = parseJsonSafe<unknown>(extractTextContent(msg));
    return responseSchema.parse(raw);
  } catch (err) {
    log.warn(
      { targetUrl, err: err instanceof Error ? err.message : 'unknown' },
      'classifySite failed — caller falls back to placeholder',
    );
    return null;
  }
}
