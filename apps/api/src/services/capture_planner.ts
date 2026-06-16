// Capture planner — LLM pre-judgment / triage (Console S4, 2026-06-16).
//
// Runs right after a capture, BEFORE the ~112-persona scoring pass.
// Looks at a captured screen (screenshot + measured signals + extracted
// structure) and decides what it actually IS and what to do next, so
// the pipeline stops:
//   - scoring 112 personas on a login wall / splash / cookie modal
//   - mis-reading a mobile phone-frame app as a blocking popup
//   - evaluating the wrong journey stage (returning-user home when the
//     scan asked for new-user onboarding)
//
// It REPLACES dumb heuristics (popup_detected area math, login_wall
// regex) with a judgment, and drives auto-corrections (recapture mobile,
// use the stored auth session to cross a login gate, wait out a splash).
//
// One Haiku vision call (~$0.001). Failure → returns null; the caller
// proceeds with the heuristic signals (degrades, never blocks).

import type Anthropic from '@anthropic-ai/sdk';
import { client, extractTextContent, withRoute } from './anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from './llm.js';
import { readCaptureAsBase64 } from './site_capture.js';
import { z } from 'zod';
import { logger } from '../logger.js';

const log = logger.child({ service: 'capture_planner' });

/** Where in the user journey this screen sits. */
export const JOURNEY_STAGES = [
  'pre_login_tutorial', // new-visitor intro / marketing before any auth
  'login_gate', // sign-in / sign-up wall blocking the product
  'onboarding_step', // post-signup setup the user must complete (e.g. consonant pick)
  'main_app', // the actual product for an established user
  'content_page', // an article / docs / detail page
  'error_or_empty', // error, blank, or load failure
  'unknown',
] as const;

export const INTENDED_STAGES = ['onboarding', 'main_app', 'any'] as const;
export type IntendedStage = (typeof INTENDED_STAGES)[number];

const responseSchema = z.object({
  journey_stage: z.enum(JOURNEY_STAGES),
  surface_type: z.enum(['mobile_app', 'web_app', 'marketing_landing', 'game', 'docs', 'other']),
  render_frame: z.enum(['mobile', 'desktop']),
  blocking_state: z.enum(['none', 'login_wall', 'cookie_consent', 'modal', 'splash_loading', 'paywall']),
  /** Is THIS screen a real product surface worth scoring with personas? */
  evaluable: z.boolean(),
  /** Does it match what the scan asked to evaluate (intended stage)? */
  matches_intended_stage: z.boolean(),
  next_action_hint: z.enum([
    'none',
    'use_auth_session', // a login gate — cross it with the stored session
    'wait', // splash/loading — wait and recapture
    'dismiss_modal', // a real dismissable modal (cookie/onboarding popup)
    'recapture_mobile', // mobile-first app shown in a desktop frame
  ]),
  summary: z.string().min(3).max(240),
});

export type CapturePlan = z.infer<typeof responseSchema>;

export type PlanCaptureInput = {
  targetUrl: string;
  screenshotUrls: readonly string[];
  signals: {
    visible_word_count: number;
    link_count: number;
    cta_count: number;
    popup_detected: boolean;
    login_wall: boolean;
    nav_menu_labels: string[];
  } | null;
  structure?: { actions: string[]; nav: string[] } | null;
  intendedStage: IntendedStage;
};

const SYSTEM = `You are a capture-triage analyst for a product-validation
tool. You are shown ONE screenshot of an app/website plus measured facts
about it. Decide what this screen actually is in the user's journey and
whether it is worth evaluating. Be skeptical: a login wall, a splash/
loading screen, a cookie banner, or an empty error page is NOT the
product. A mobile-first app is often rendered as a centered phone frame
on a blurred desktop background — that is the app, NOT a popup, and it
should be recaptured at a mobile viewport. Return ONLY one JSON object.`;

function buildImageBlock(url: string): Anthropic.ImageBlockParam | null {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { type: 'image', source: { type: 'url', url } };
  }
  const local = readCaptureAsBase64(url);
  if (!local) return null;
  return { type: 'image', source: { type: 'base64', media_type: local.mediaType, data: local.data } };
}

export async function planCapture(input: PlanCaptureInput): Promise<CapturePlan | null> {
  const preferred = input.screenshotUrls[1] ?? input.screenshotUrls[0];
  if (!preferred) {
    log.warn({ targetUrl: input.targetUrl }, 'planCapture: no screenshot — skipping');
    return null;
  }
  const imageBlock = buildImageBlock(preferred);
  if (!imageBlock) {
    log.warn({ targetUrl: input.targetUrl, preferred }, 'planCapture: image unreadable');
    return null;
  }

  const facts = input.signals
    ? `Measured facts: visible_words=${input.signals.visible_word_count}, links=${input.signals.link_count}, ctas=${input.signals.cta_count}, popup_heuristic=${input.signals.popup_detected}, login_url_heuristic=${input.signals.login_wall}, nav=[${input.signals.nav_menu_labels.join(', ')}]`
    : 'Measured facts: (none)';
  const struct = input.structure
    ? `Structure: actions=[${input.structure.actions.join(', ')}], nav=[${input.structure.nav.join(', ')}]`
    : 'Structure: (none)';

  const userText = `URL: ${input.targetUrl}
Intended stage to evaluate: ${input.intendedStage}
${facts}
${struct}

Respond with EXACTLY this JSON shape (replace values):
${JSON.stringify(
  {
    journey_stage: 'onboarding_step',
    surface_type: 'mobile_app',
    render_frame: 'mobile',
    blocking_state: 'none',
    evaluable: true,
    matches_intended_stage: true,
    next_action_hint: 'none',
    summary: 'Post-signup setup screen asking the user to pick a starter letter.',
  },
  null,
  2,
)}

Rules:
- journey_stage MUST be one of: ${JOURNEY_STAGES.join(', ')}.
- render_frame: "mobile" if the content is a centered phone-frame on a
  blurred/empty desktop background (the app is mobile-first), else "desktop".
- evaluable=false for login_gate, splash_loading, error_or_empty, or a
  cookie/consent screen — those are not the product.
- matches_intended_stage: true only if journey_stage fits the intended
  stage ("onboarding" => pre_login_tutorial or onboarding_step;
  "main_app" => main_app; "any" => always true).
- next_action_hint: "use_auth_session" if blocked by a login wall;
  "recapture_mobile" if it's a phone-frame app captured on desktop;
  "wait" for splash/loading; "dismiss_modal" for a cookie/onboarding
  popup over real content; else "none".
- summary: one factual sentence describing what is on screen. Do not
  invent features not visible.`;

  try {
    const msg = await withRoute('validator.capture_planner', () =>
      client.messages.create({
        model: SCORING_MODELS.haiku,
        max_tokens: 320,
        temperature: 0.1,
        system: SYSTEM,
        messages: [{ role: 'user', content: [imageBlock, { type: 'text', text: userText }] }],
      }),
    );
    const raw = parseJsonSafe<unknown>(extractTextContent(msg));
    return responseSchema.parse(raw);
  } catch (err) {
    log.warn(
      { targetUrl: input.targetUrl, err: err instanceof Error ? err.message : 'unknown' },
      'planCapture failed — caller falls back to heuristics',
    );
    return null;
  }
}
