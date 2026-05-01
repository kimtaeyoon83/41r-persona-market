// Contract tests for the §11.1 LLM persona response schema.
// Locks: Zod schema rejects out-of-range / malformed responses,
// mapLLMResponseToSimulated produces the right PersonaDimensionScores
// for known fixtures, extractVoiceQuotes pulls the 4 columns.

import { describe, expect, it } from 'vitest';
import {
  extractVoiceQuotes,
  mapLLMResponseToSimulated,
  personaResponseSchema,
  type PersonaLLMResponse,
} from '../services/dimensions/llm';
import {
  ENGAGEMENT_BAND_TO_SCORE,
  RETENTION_BAND_TO_DCURVE,
  computeSusScore,
} from '../services/audience_fit';

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
