// Contract tests for the §11.1 LLM persona response schema.
// Locks: Zod schema rejects out-of-range / malformed responses,
// mapLLMResponseToSimulated produces the right PersonaDimensionScores
// for known fixtures, extractVoiceQuotes pulls the 4 columns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildUserPrompt,
  extractVoiceQuotes,
  mapLLMResponseToSimulated,
  personaResponseSchema,
  type PersonaLLMResponse,
  type SiteContext,
} from '../services/dimensions/llm';
import {
  ENGAGEMENT_BAND_TO_SCORE,
  RETENTION_BAND_TO_DCURVE,
  computeSusScore,
} from '../services/audience_fit';
import type { PersonaRow } from '../services/cohort_selection';

const VALID: PersonaLLMResponse = {
  happiness: {
    sus_responses: [4, 2, 5, 2, 4, 2, 4, 2, 5, 2],
    raw_score: 80,
    voice_first_impression: 'Looks clean. I trust the security signaling.',
  },
  engagement: {
    category: 'engage',
    interaction_depth_estimate: 12,
    abandon_likely_at: 'none',
    voice_friction: 'Minor — one extra confirmation step on swap.',
  },
  adoption: {
    signup_likelihood: 0.78,
    primary_barrier: 'Wallet selection ambiguity',
    trigger_to_signup: 'Promo APR.',
  },
  retention: {
    category: 'moderate',
    expected_return_window: '1week',
    return_motivation_text: 'Will check weekly for new pools.',
  },
  task_success: {
    core_action_understood: 'Swap tokens',
    completion_likelihood: 0.71,
    blocking_friction: 'Slippage settings hidden',
    voice_attempt: 'Found swap quickly. Confirmed and signed in two taps.',
  },
  voice_quotes: {
    biggest_friction: 'Wallet picker is confusing',
    would_return_because: 'Fast and trustworthy',
    if_could_change_one_thing: 'Default slippage to 0.5%',
  },
  self_consistency_check: {
    happiness_retention_aligned: true,
    alignment_note: '',
  },
};

describe('personaResponseSchema · happy path', () => {
  it('accepts the canonical valid fixture', () => {
    expect(() => personaResponseSchema.parse(VALID)).not.toThrow();
  });
});

describe('personaResponseSchema · rejects bad input', () => {
  it('rejects SUS array of wrong length', () => {
    const bad = { ...VALID, happiness: { ...VALID.happiness, sus_responses: [4, 2, 5] } };
    expect(() => personaResponseSchema.parse(bad)).toThrow();
  });

  it('rejects SUS Likert out of [1,5]', () => {
    const bad = {
      ...VALID,
      happiness: { ...VALID.happiness, sus_responses: [4, 2, 5, 2, 4, 2, 4, 2, 5, 7] },
    };
    expect(() => personaResponseSchema.parse(bad)).toThrow();
  });

  it('rejects signup_likelihood > 1', () => {
    const bad = { ...VALID, adoption: { ...VALID.adoption, signup_likelihood: 1.5 } };
    expect(() => personaResponseSchema.parse(bad)).toThrow();
  });

  it('rejects unknown engagement category', () => {
    const bad = {
      ...VALID,
      engagement: { ...VALID.engagement, category: 'lurking' as never },
    };
    expect(() => personaResponseSchema.parse(bad)).toThrow();
  });

  it('rejects unknown retention category', () => {
    const bad = {
      ...VALID,
      retention: { ...VALID.retention, category: 'forever' as never },
    };
    expect(() => personaResponseSchema.parse(bad)).toThrow();
  });

  it('rejects missing self_consistency_check', () => {
    const { self_consistency_check: _scc, ...rest } = VALID;
    void _scc;
    expect(() => personaResponseSchema.parse(rest)).toThrow();
  });
});

describe('mapLLMResponseToSimulated', () => {
  it('happiness comes from canonical SUS scorer (not the LLM raw_score)', () => {
    const sim = mapLLMResponseToSimulated(VALID);
    expect(sim.scores.happiness).toBe(computeSusScore(VALID.happiness.sus_responses));
  });

  it('engagement maps via ENGAGEMENT_BAND_TO_SCORE', () => {
    const sim = mapLLMResponseToSimulated(VALID);
    expect(sim.scores.engagement).toBe(ENGAGEMENT_BAND_TO_SCORE.engage);
  });

  it('retention_d7 comes from the spec §4.1 D-curve map', () => {
    const sim = mapLLMResponseToSimulated(VALID);
    expect(sim.scores.retention_d7).toBe(RETENTION_BAND_TO_DCURVE.moderate.d7);
  });

  it('adoption = signup_likelihood × 100', () => {
    const sim = mapLLMResponseToSimulated(VALID);
    expect(sim.scores.adoption).toBeCloseTo(78, 4);
  });

  it('task_success = completion_likelihood × 100', () => {
    const sim = mapLLMResponseToSimulated(VALID);
    expect(sim.scores.task_success).toBeCloseTo(71, 4);
  });

  it('flags when self_consistency_check.happiness_retention_aligned is false', () => {
    const incoherent: PersonaLLMResponse = {
      ...VALID,
      self_consistency_check: {
        happiness_retention_aligned: false,
        alignment_note: 'happiness 90 but no_return — odd',
      },
    };
    const sim = mapLLMResponseToSimulated(incoherent);
    expect(sim.is_flagged).toBe(true);
    expect(sim.flag_reason).toContain('odd');
  });

  it('does NOT flag the canonical aligned fixture', () => {
    const sim = mapLLMResponseToSimulated(VALID);
    expect(sim.is_flagged).toBe(false);
    expect(sim.flag_reason).toBeNull();
  });

  it('preserves SUS responses + likelihoods in raw payload', () => {
    const sim = mapLLMResponseToSimulated(VALID);
    expect(sim.raw.sus_responses).toEqual(VALID.happiness.sus_responses);
    expect(sim.raw.signup_likelihood).toBeCloseTo(0.78, 4);
    expect(sim.raw.completion_likelihood).toBeCloseTo(0.71, 4);
  });
});

describe('extractVoiceQuotes', () => {
  it('returns the 4 voice columns', () => {
    const v = extractVoiceQuotes(VALID);
    expect(v.voiceFirstImpression).toBe('Looks clean. I trust the security signaling.');
    expect(v.voiceFriction).toBe('Minor — one extra confirmation step on swap.');
    expect(v.voiceBiggestFriction).toBe('Wallet picker is confusing');
    expect(v.voiceWouldReturnBecause).toBe('Fast and trustworthy');
  });

  it('falls back to null on empty strings', () => {
    const v = extractVoiceQuotes({
      ...VALID,
      happiness: { ...VALID.happiness, voice_first_impression: '' },
      voice_quotes: {
        biggest_friction: '',
        would_return_because: '',
        if_could_change_one_thing: '',
      },
    });
    expect(v.voiceFirstImpression).toBeNull();
    expect(v.voiceBiggestFriction).toBeNull();
    expect(v.voiceWouldReturnBecause).toBeNull();
  });
});

// ─── Q2 regression lock — site context threading (2026-05-07) ────
// Locks the fix that surfaces classifier output (category, pitch,
// confidence) inside the persona prompt. Without this block, crypto-
// tilted personas hallucinate wallet/DeFi features on non-crypto
// sites (Google Merch case: long-tail bucket quote "지갑 연결이
// 필수인데..." on a plain e-commerce site).

function makePersonaForPrompt(): PersonaRow {
  return {
    id: 'p-test',
    testerAddr: 'wallet_p-test',
    isActive: true,
    sasAttestId: null,
    hdIndex: null,
    suiObjectId: null,
    walrusBlobId: null,
    sealId: null,
    anchoredAt: null,
    transferredTo: null,
    transferredAt: null,
    contentHash: null,
    contentManifestBlobId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    vector: {
      test_style: { thoroughness: 0.6, speed: 0.6, ux_focus: 0.5, bug_detection: 0.5, creativity: 0.4 },
      expertise: { defi: 0.8, nft: 0.4, gaming: 0.2, ai_tools: 0.4, general_web: 0.6 },
      feedback_pattern: {
        ui_critical: 0.5,
        security_aware: 0.7,
        performance_sensitive: 0.5,
        accessibility_focus: 0.3,
        detail_oriented: 0.6,
      },
      reliability: { quality_score: 0.8, consistency: 0.8, response_rate: 0.9 },
      demographics: {
        age_group: 'adult',
        tech_literacy: 0.8,
        crypto_experience: 0.85,
        design_sensitivity: 0.5,
        patience_level: 0.6,
      },
      ux_preferences: {
        visual_style: 'professional',
        font_size_preference: 0.5,
        information_density: 0.6,
        animation_tolerance: 0.4,
        color_contrast_need: 0.5,
        mobile_first: false,
      },
      voice_sample: 'I evaluate products on speed, transparency, and control.',
    },
  };
}

describe('buildUserPrompt · Q2 site-context threading', () => {
  const persona = makePersonaForPrompt();

  it('omits the Site context block when siteContext is undefined (legacy / no-classification path)', () => {
    const prompt = buildUserPrompt(persona, 'https://example.com');
    expect(prompt).not.toContain('Site context');
    expect(prompt).not.toContain('Anchor your reaction');
    // Ensure the basic structure still works.
    expect(prompt).toContain('Target URL: https://example.com');
    expect(prompt).toContain('Persona profile:');
  });

  it('renders the Page facts block when pageFacts is provided (Ch1 grounding, 2026-06-10)', () => {
    const ctx: SiteContext = {
      category: 'E-commerce',
      categoryConfidence: 0.9,
      oneLinePitch: null,
      pageFacts: {
        visibleWordCount: 480,
        linkCount: 72,
        ctaCount: 9,
        navMenuLabels: ['Shop', 'Sale', 'Support'],
        popupDetected: true,
        loginWall: false,
      },
    };
    const prompt = buildUserPrompt(persona, 'https://example.com', undefined, ctx);
    expect(prompt).toContain('Page facts (measured from the live page');
    expect(prompt).toContain('visible word count: 480');
    expect(prompt).toContain('links: 72 · CTA/buttons: 9');
    expect(prompt).toContain('popup/modal overlays the page on load');
    expect(prompt).not.toContain('redirected to a login/auth page');
    expect(prompt).toContain('navigation menu (verbatim): Shop / Sale / Support');
    // Grounding guard — companion to the Q2 anti-projection line.
    expect(prompt).toContain('Do not invent features beyond the screenshot and this menu list');
  });

  it('omits the Page facts block when pageFacts is absent — legacy prompt stays byte-identical', () => {
    const ctx: SiteContext = {
      category: 'E-commerce',
      categoryConfidence: 0.9,
      oneLinePitch: null,
    };
    const prompt = buildUserPrompt(persona, 'https://example.com', undefined, ctx);
    expect(prompt).not.toContain('Page facts');
    expect(prompt).not.toContain('navigation menu (verbatim)');
  });

  it('renders the Site context block + anti-projection guard when siteContext is provided', () => {
    const ctx: SiteContext = {
      category: 'E-commerce',
      categoryConfidence: 0.98,
      oneLinePitch: 'Official Google merchandise store offering branded apparel.',
    };
    const prompt = buildUserPrompt(persona, 'https://shop.googlemerchandisestore.com', undefined, ctx);
    expect(prompt).toContain('Site context');
    expect(prompt).toContain('category: E-commerce (confidence: 0.98)');
    expect(prompt).toContain('description: Official Google merchandise store offering branded apparel.');
    // The anti-projection guard is the load-bearing line that stops
    // crypto-tilted personas from inventing wallet/DeFi features on
    // a non-crypto site. Don't relax this assertion.
    expect(prompt).toContain('Anchor your reaction to THIS category');
    expect(prompt).toContain('Do not project features (wallet, signing, on-chain UX, etc.)');
  });

  it('flags low classifier confidence (<0.5) so the persona does not anchor on a misclassification', () => {
    const ctx: SiteContext = {
      category: 'Marketplace',
      categoryConfidence: 0.42,
      oneLinePitch: null,
    };
    const prompt = buildUserPrompt(persona, 'https://ambiguous.example', undefined, ctx);
    expect(prompt).toContain('confidence: 0.42 — category may be unclear');
  });

  it('still includes the persona voice_sample so tone signal survives', () => {
    const prompt = buildUserPrompt(persona, 'https://example.com', undefined, {
      category: 'SaaS',
      categoryConfidence: 0.9,
      oneLinePitch: 'Generic SaaS app.',
    });
    expect(prompt).toContain('I evaluate products on speed, transparency, and control.');
  });
});

// ─── Q3 P1 regression lock — voice_sample cleanup (2026-05-07) ────
// Locks the cleanup that rewrote crypto_native / web3_pro /
// defi_beginner voice_samples to be category-agnostic. Reading the
// seed script as text (not import) avoids triggering its top-level
// DB connection. If anyone reintroduces "slippage", "MEV", "multi-
// chain", "gas-aware", "wallet" etc. in those three cohort entries,
// these tests fail.

// Crypto-specific vocabulary the post-2026-05-07 voice rewrite
// removed from crypto_native / web3_pro / defi_beginner. Only terms
// that are unambiguously crypto-domain — "CSV export" alone is fine
// because power users in any domain need it; "multi-chain ops" is
// crypto-specific and was dropped.
const FORBIDDEN_VOCAB = [
  'slippage',
  'MEV',
  'multi-chain',
  'gas-aware',
  'gas estimation',
  'on-chain',
  'mobile wallets',
  'signing UX',
];

function readSeedScript(): string {
  // Resolve from the test file's location to the repo root scripts/.
  // dimension_llm.test.ts lives at apps/api/src/__tests__/, so
  // scripts/ is 4 levels up.
  const path = resolve(__dirname, '../../../../scripts/seed-validator-cohorts.ts');
  return readFileSync(path, 'utf8');
}

function extractCohortVoiceBlock(seedSrc: string, cohortId: string): string {
  // Locate `<cohortId>: [` and capture lines until matching `]`.
  const start = seedSrc.indexOf(`${cohortId}: [`);
  if (start < 0) return '';
  const close = seedSrc.indexOf('],', start);
  return seedSrc.slice(start, close + 1);
}

describe('VOICE_BY_COHORT — voice cleanup regression lock', () => {
  const seed = readSeedScript();

  it('seed script is readable + still defines the three crypto-leaning cohort voice arrays', () => {
    expect(seed).toContain('crypto_native: [');
    expect(seed).toContain('web3_pro: [');
    expect(seed).toContain('defi_beginner: [');
  });

  for (const cohort of ['crypto_native', 'web3_pro', 'defi_beginner']) {
    it(`${cohort} voice_sample array contains no forbidden crypto-specific vocab`, () => {
      const block = extractCohortVoiceBlock(seed, cohort);
      expect(block.length).toBeGreaterThan(0);
      for (const term of FORBIDDEN_VOCAB) {
        const re = new RegExp(term, 'i');
        expect(block, `forbidden term "${term}" reappeared in ${cohort} voice array`).not.toMatch(re);
      }
    });
  }

  it('crypto_native voice array still expresses the underlying traits in neutral language', () => {
    const block = extractCohortVoiceBlock(seed, 'crypto_native');
    // At least one of the rewritten phrases should be present so we
    // know the post-2026-05-07 voice survives. If someone replaces
    // them with crypto vocab, both this and the forbidden-vocab check
    // above fail.
    const neutralMarkers = [
      /speed,\s*transparency,\s*and control/i,
      /security model is unclear/i,
      /power-user shortcuts/i,
    ];
    const matched = neutralMarkers.some((re) => re.test(block));
    expect(matched).toBe(true);
  });
});
