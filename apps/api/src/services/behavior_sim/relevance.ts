// Per-node relevance judgment (behavior_sim, extracted from the spike's
// run.ts so gen-sim can fill the one signal structure can't give it).
//
//   relevance_effective = ch1(screen-type, structural) × ch2(content↔need)
//
// ch1 is deterministic from the node; ch2 is an LLM (Haiku vision) judgment
// of whether the screen's CONTENT serves the visitor's need (NOT whether
// it's a list vs detail — that's ch1's job). This split is the v7 lesson
// from the spike: pure LLM self-report can't tell "saw clues" from "found
// the answer", so screen-type attainment is heuristic and the LLM only
// scores content match.

import { client, extractTextContent, withRoute } from '../anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from '../llm.js';
import { z } from 'zod';

export type GraphNodeLite = {
  id: string;
  label?: string;
  login_wall?: boolean;
};

/** Structural relevance factor (no LLM). Login walls yield nothing;
 *  detail pages carry attainable info; listings only give clues. */
export function ch1RelevanceFactor(node: GraphNodeLite): number {
  if (node.login_wall) return 0;
  if (node.id.startsWith('py_') || node.id.startsWith('product_')) return 1.0;
  return 0.25;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Effective relevance for a node given its LLM content score (ch2). Pure. */
export function nodeRelevance(node: GraphNodeLite, ch2: number): number {
  return ch1RelevanceFactor(node) * clamp01(ch2);
}

const ch2Schema = z.object({ relevance: z.number() });

/**
 * Ch2 — Haiku vision judges how well the screen's CONTENT matches the
 * need (0..1). Failure → 0 (no relevance claimed). Returns the raw ch2;
 * multiply by ch1RelevanceFactor for the effective value.
 */
export async function judgeContentRelevance(args: {
  need: string;
  label?: string;
  imageB64: string;
}): Promise<number> {
  const system =
    'You judge how well a screen\'s CONTENT serves a visitor\'s need. ' +
    'Ignore the screen TYPE (list vs detail) — only the content match. Output JSON only.';
  const user =
    `방문 목적: ${args.need}\n화면: ${args.label ?? ''}\n\n` +
    '이 화면에 보이는 *내용*이 방문 목적과 얼마나 관련 있나요? ' +
    '0=전혀 무관, 0.5=부분 관련, 1.0=정확히 찾던 종류의 내용. ' +
    'JSON: {"relevance": 0~1 숫자}';

  try {
    const msg = await withRoute('spike.behavior_sim.relevance', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 100,
        system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: user },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: args.imageB64 },
              },
            ],
          },
        ],
      }),
    );
    const parsed = ch2Schema.safeParse(parseJsonSafe(extractTextContent(msg)));
    return parsed.success ? clamp01(parsed.data.relevance) : 0;
  } catch {
    return 0;
  }
}
