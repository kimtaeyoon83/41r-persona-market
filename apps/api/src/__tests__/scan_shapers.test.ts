// Contract tests for the per-scan shaping helpers in
// routes/scan.ts. Locks: null-score handling, tag dedup, sentiment
// boundary thresholds, cohort progress fallback, persona-detail
// vector flattening + raw_response extraction.
//
// These contracts back the visible report screen — silent
// regressions here surface as broken persona cards (score=0,
// duplicate tags) or wrong sentiment chips on the processing
// feed. See verification log 2026-05-01 for the original failure.

import { describe, expect, it } from 'vitest';
import {
  classifySentiment,
  isSyntheticSeedName,
  personaAgeFromGroup,
  personaDisplayName,
  shapeCohortProgress,
  shapePersonaCard,
  shapePersonaDetailResponse,
  shapeRecentResponse,
} from '../routes/scan';
import type { PersonaVector } from '@41rpm/shared';

function makeVector(overrides: Partial<PersonaVector> = {}): PersonaVector {
  return {
    test_style: {
      thoroughness: 0.5,
      speed: 0.5,
      ux_focus: 0.5,
      bug_detection: 0.5,
      creativity: 0.5,
    },
    expertise: {
      defi: 0.5,
      nft: 0.5,
      gaming: 0.5,
      ai_tools: 0.5,
      general_web: 0.5,
    },
    feedback_pattern: {
      ui_critical: 0.5,
      security_aware: 0.5,
      performance_sensitive: 0.5,
      accessibility_focus: 0.5,
      detail_oriented: 0.5,
    },
    reliability: {
      quality_score: 0.7,
      consistency: 0.7,
      response_rate: 0.7,
    },
    voice_sample: 'I move fast and read security models first.',
    ...overrides,
  } as PersonaVector;
}

// ───────────────────────── shapePersonaCard ─────────────────────────

describe('shapePersonaCard', () => {
  it('averages the 3 dimension scores when all present', () => {
    const card = shapePersonaCard({
      personaId: 'p1',
      cohortId: 'crypto_native',
      happiness: 70,
      engagement: 80,
      taskSuccess: 90,
      voiceFirstImpression: 'Polished, looks like uniswap.',
      voiceSample: makeVector({
        demographics: {
          age_group: 'young_adult',
          tech_literacy: 0.8,
          crypto_experience: 0.9,
          design_sensitivity: 0.5,
          patience_level: 0.5,
        },
      }),
      displayName: 'Crypto Native #1',
    });
    expect(card.score).toBe(80);
    expect(card.role).toBe('Crypto Native');
    // young_adult bucket → 25 (bucket-center; we don't synthesise
    // a per-persona age — only the categorical age_group exists).
    expect(card.age).toBe(25);
    expect(card.id).toBe('p1');
    // Seed displayName "Crypto Native #1" matches role prefix → flagged
    // synthetic so the UI can show a "synth" marker.
    expect(card.is_synthetic).toBe(true);
  });

  it('returns score=null when all dimensions are null (does not fall back to 0)', () => {
    const card = shapePersonaCard({
      personaId: 'p2',
      cohortId: 'senior',
      happiness: null,
      engagement: null,
      taskSuccess: null,
      voiceFirstImpression: null,
      voiceSample: makeVector({
        demographics: {
          age_group: 'senior',
          tech_literacy: 0.2,
          crypto_experience: 0.0,
          design_sensitivity: 0.3,
          patience_level: 0.6,
        },
      }),
      displayName: 'Senior #4',
    });
    expect(card.score).toBeNull();
  });

  it('averages only the present dimensions when some are null', () => {
    const card = shapePersonaCard({
      personaId: 'p3',
      cohortId: 'designer_20s',
      happiness: 60,
      engagement: null,
      taskSuccess: 80,
      voiceSample: makeVector({
        demographics: {
          age_group: 'young_adult',
          tech_literacy: 0.7,
          crypto_experience: 0.4,
          design_sensitivity: 0.9,
          patience_level: 0.5,
        },
      }),
      displayName: 'Designer #2',
    });
    expect(card.score).toBe(70);
  });

  it('dedupes tags when cohort_id collides with age_group bucket', () => {
    const card = shapePersonaCard({
      personaId: 'p4',
      cohortId: 'senior',
      happiness: 30,
      engagement: 40,
      taskSuccess: 35,
      voiceSample: makeVector({
        demographics: {
          age_group: 'senior',
          tech_literacy: 0.2,
          crypto_experience: 0.1,
          design_sensitivity: 0.3,
          patience_level: 0.5,
        },
      }),
      displayName: 'Senior #1',
    });
    expect(card.tags).toEqual(['senior']);
    expect(card.tags).not.toEqual(['senior', 'senior']);
  });

  it('keeps two tags when cohort_id and age_group differ', () => {
    const card = shapePersonaCard({
      personaId: 'p5',
      cohortId: 'crypto_native',
      happiness: 70,
      engagement: 70,
      taskSuccess: 70,
      voiceSample: makeVector({
        demographics: {
          age_group: 'young_adult',
          tech_literacy: 0.8,
          crypto_experience: 0.9,
          design_sensitivity: 0.5,
          patience_level: 0.5,
        },
      }),
      displayName: 'Crypto Native #1',
    });
    expect(card.tags).toEqual(['crypto_native', 'young_adult']);
  });

  it('prefers voice_first_impression over voice_biggest_friction over voice_sample', () => {
    const base = {
      personaId: 'p6',
      cohortId: 'crypto_native',
      happiness: 70,
      engagement: 70,
      taskSuccess: 70,
      voiceSample: makeVector({ voice_sample: 'static seed quote' }),
      displayName: 'Crypto Native #1',
    };
    expect(
      shapePersonaCard({
        ...base,
        voiceFirstImpression: 'first',
        voiceBiggestFriction: 'biggest',
      }).quote
    ).toBe('first');
    expect(
      shapePersonaCard({
        ...base,
        voiceFirstImpression: null,
        voiceBiggestFriction: 'biggest',
      }).quote
    ).toBe('biggest');
    expect(
      shapePersonaCard({
        ...base,
        voiceFirstImpression: null,
        voiceBiggestFriction: null,
      }).quote
    ).toBe('static seed quote');
  });

  it('falls back to age=35 when age_group is missing', () => {
    const card = shapePersonaCard({
      personaId: 'p7',
      cohortId: 'mobile_power',
      happiness: 50,
      engagement: 50,
      taskSuccess: 50,
      voiceSample: makeVector(),
      displayName: 'Mobile #1',
    });
    // No age_group → adult/unknown bucket center 35.
    expect(card.age).toBe(35);
    expect(card.tags).toEqual(['mobile_power', 'unknown']);
  });
});

// ───────────────────────── classifySentiment ─────────────────────────

describe('classifySentiment', () => {
  it('returns positive at avg ≥ 65 (boundary)', () => {
    expect(classifySentiment(65, 65)).toBe('positive');
    expect(classifySentiment(80, 50)).toBe('positive');
  });

  it('returns mixed for 40 ≤ avg < 65', () => {
    expect(classifySentiment(64, 64)).toBe('mixed');
    expect(classifySentiment(40, 40)).toBe('mixed');
    expect(classifySentiment(50, 50)).toBe('mixed');
  });

  it('returns friction below 40', () => {
    expect(classifySentiment(39, 39)).toBe('friction');
    expect(classifySentiment(0, 10)).toBe('friction');
  });

  it('treats missing scores as 50 (mixed mid-band)', () => {
    expect(classifySentiment(null, null)).toBe('mixed');
    expect(classifySentiment(null, 80)).toBe('positive');
    expect(classifySentiment(20, null)).toBe('friction');
  });
});

// ───────────────────────── shapeRecentResponse ─────────────────────────

describe('shapeRecentResponse', () => {
  it('emits ISO 8601 created_at and the right sentiment', () => {
    const r = shapeRecentResponse({
      personaId: 'p1',
      cohortId: 'crypto_native',
      voiceFirstImpression: 'Polished UI.',
      voiceBiggestFriction: null,
      happiness: 75,
      taskSuccess: 80,
      voiceSample: makeVector({
        demographics: {
          age_group: 'young_adult',
          tech_literacy: 0.8,
          crypto_experience: 0.9,
          design_sensitivity: 0.5,
          patience_level: 0.5,
        },
      }),
      createdAt: new Date('2026-05-01T06:23:13.160Z'),
    });
    expect(r.created_at).toBe('2026-05-01T06:23:13.160Z');
    expect(r.sentiment).toBe('positive');
    expect(r.cohort_label).toBe('Crypto Native');
    expect(r.age_group).toBe('young_adult');
  });

  it('falls back to voice_biggest_friction when first_impression null', () => {
    const r = shapeRecentResponse({
      personaId: 'p2',
      cohortId: 'senior',
      voiceFirstImpression: null,
      voiceBiggestFriction: 'I do not know what a wallet is.',
      happiness: 30,
      taskSuccess: 20,
      voiceSample: makeVector({
        demographics: {
          age_group: 'senior',
          tech_literacy: 0.2,
          crypto_experience: 0.1,
          design_sensitivity: 0.3,
          patience_level: 0.5,
        },
      }),
      createdAt: new Date('2026-05-01T06:23:13.160Z'),
    });
    expect(r.voice).toBe('I do not know what a wallet is.');
    expect(r.sentiment).toBe('friction');
  });

  it('defaults age_group to "adult" when missing', () => {
    const r = shapeRecentResponse({
      personaId: 'p3',
      cohortId: 'mobile_power',
      voiceFirstImpression: 'Mobile-first feels good.',
      voiceBiggestFriction: null,
      happiness: 70,
      taskSuccess: 60,
      voiceSample: makeVector(),
      createdAt: new Date('2026-05-01T06:23:13.160Z'),
    });
    expect(r.age_group).toBe('adult');
  });
});

// ───────────────────────── shapeCohortProgress ─────────────────────────

describe('shapeCohortProgress', () => {
  it('attaches cohort_label and target_n from STANDARD_COHORTS', () => {
    const out = shapeCohortProgress([
      { cohortId: 'crypto_native', n: 8 },
      { cohortId: 'senior', n: 14 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      cohort_id: 'crypto_native',
      cohort_label: 'Crypto Native',
      n_completed: 8,
      n_target: 14,
    });
    expect(out[1]?.n_target).toBe(14);
  });

  it('falls back target = n for unknown cohort_ids (Mode B custom_audience)', () => {
    const out = shapeCohortProgress([{ cohortId: 'custom_audience', n: 16 }]);
    expect(out[0]).toEqual({
      cohort_id: 'custom_audience',
      cohort_label: 'custom_audience',
      n_completed: 16,
      n_target: 16,
    });
  });

  it('returns [] for empty input', () => {
    expect(shapeCohortProgress([])).toEqual([]);
  });
});

// ───────────────────────── shapePersonaDetailResponse ─────────────────────────

function makeDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    personaId: 'p1',
    cohortId: 'crypto_native',
    happiness: 73,
    engagement: 75,
    taskSuccess: 82,
    retentionD7: 55,
    adoption: 78,
    retentionDCurve: { d1: 72, d3: 53, d7: 33, d30: 13 },
    rawResponse: {
      sus_responses: [4, 2, 4, 3, 4, 2, 5, 2, 4, 2],
      sus_raw_score: 72.5,
      signup_likelihood: 0.72,
      completion_likelihood: 0.74,
    },
    voiceFirstImpression: 'Clean swap UI.',
    voiceFriction: null,
    voiceBiggestFriction: 'Slippage hidden until connect.',
    voiceWouldReturnBecause: 'Trusted brand.',
    isFlagged: false,
    flagReason: null,
    personaVector: makeVector({
      demographics: {
        age_group: 'young_adult',
        tech_literacy: 0.5,
        crypto_experience: 0.9,
        design_sensitivity: 0.46,
        patience_level: 0.47,
      },
      expertise: {
        defi: 0.75,
        nft: 0.1,
        gaming: 0.1,
        ai_tools: 0.4,
        general_web: 0.7,
      },
      ux_preferences: {
        mobile_first: false,
        visual_style: 'rich',
        animation_tolerance: 0.6,
        color_contrast_need: 0.5,
        information_density: 0.7,
        font_size_preference: 0.5,
      },
    }),
    displayName: 'Crypto Native #9',
    testerAddr: 'seed_cohort_crypto_native_09',
    ...overrides,
  };
}

const fakeScan = {
  id: '11111111-1111-4111-8111-111111111111',
  targetUrl: 'https://uniswap.org',
  category: 'DeFi',
  categoryConfidence: 0.5,
  oneLinePitch: null,
  mode: 'A' as const,
  targetAudienceText: null,
  hypothesis: null,
  status: 'completed' as const,
  captureScreenshotUrls: null,
  captureCompletedAt: null,
  audienceFitScore: 52.4,
  bestCohortId: 'crypto_native',
  bestCohortScore: 70.7,
  medianCohortScore: 41.5,
  worstCohortId: 'senior',
  worstCohortScore: 29.3,
  globalTaskSuccessAvg: 29.79,
  globalSentimentAvg: 57.65,
  personasAttempted: 107,
  personasCompleted: 107,
  personasFlagged: 7,
  totalCostUsd: 2.13,
  weightsVersion: 'v1.0',
  createdAt: new Date('2026-05-01T06:19:04.799Z'),
  completedAt: new Date('2026-05-01T06:23:13.160Z'),
  frictionsJson: null,
  modeBVerdict: null,
  modeBParsedSelector: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('shapePersonaDetailResponse', () => {
  it('flattens vector axes (skips null) and pulls SUS from raw_response', () => {
    const out = shapePersonaDetailResponse(fakeScan, makeDetailRow());
    expect(out.persona.vector_axes).toEqual([
      { k: 'tech_literacy', v: 0.5 },
      { k: 'crypto_experience', v: 0.9 },
      { k: 'patience_level', v: 0.47 },
      { k: 'mobile_first', v: 0 },
      { k: 'design_sensitivity', v: 0.46 },
      { k: 'expertise_defi', v: 0.75 },
    ]);
    expect(out.response.sus_responses).toEqual([4, 2, 4, 3, 4, 2, 5, 2, 4, 2]);
    expect(out.response.sus_raw_score).toBe(72.5);
    expect(out.response.signup_likelihood).toBe(0.72);
  });

  it('sets mobile_first axis to 1 when ux_preferences.mobile_first is true', () => {
    const row = makeDetailRow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row.personaVector as any).ux_preferences.mobile_first = true;
    const out = shapePersonaDetailResponse(fakeScan, row);
    const mobile = out.persona.vector_axes.find((a) => a.k === 'mobile_first');
    expect(mobile?.v).toBe(1);
  });

  it('returns null SUS fields when raw_response is null (e.g. flagged row)', () => {
    const out = shapePersonaDetailResponse(
      fakeScan,
      makeDetailRow({
        rawResponse: null,
        isFlagged: true,
        flagReason: 'zod_validation_failed',
        happiness: null,
        engagement: null,
        taskSuccess: null,
      })
    );
    expect(out.response.sus_responses).toBeNull();
    expect(out.response.sus_raw_score).toBeNull();
    expect(out.response.is_flagged).toBe(true);
    expect(out.response.flag_reason).toBe('zod_validation_failed');
    expect(out.response.happiness).toBeNull();
  });

  it('preserves age_group → age mapping (senior=58)', () => {
    const row = makeDetailRow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row.personaVector as any).demographics.age_group = 'senior';
    const out = shapePersonaDetailResponse(fakeScan, row);
    // senior bucket → 58 (bucket-center).
    expect(out.persona.age).toBe(58);
    expect(out.persona.age_group).toBe('senior');
  });

  it('falls back display_name to "Synthetic" when null', () => {
    const out = shapePersonaDetailResponse(
      fakeScan,
      makeDetailRow({ displayName: null as unknown as string })
    );
    expect(out.persona.display_name).toBe('Synthetic');
  });
});

// ───────────── name + age helpers (B2/B3 trust restoration) ─────────────

describe('isSyntheticSeedName', () => {
  it('detects "<role> #N" pattern (case insensitive)', () => {
    expect(isSyntheticSeedName('Crypto Native #9', 'Crypto Native')).toBe(true);
    expect(isSyntheticSeedName('senior (50+) #1', 'Senior (50+)')).toBe(true);
  });

  it('lets real names pass through', () => {
    expect(isSyntheticSeedName('Alice Chen', 'Crypto Native')).toBe(false);
    expect(isSyntheticSeedName('Ivan Petrov', 'Crypto Native')).toBe(false);
  });

  it('does not match when displayName starts with role but no "#"', () => {
    expect(isSyntheticSeedName('Crypto Native enthusiast', 'Crypto Native')).toBe(false);
  });
});

describe('personaDisplayName', () => {
  it('replaces synthetic seed names with a deterministic pool entry', () => {
    const out = personaDisplayName(
      'Crypto Native #9',
      'Crypto Native',
      '11111111-1111-1111-1111-111111111111',
    );
    expect(out).not.toBe('Crypto Native #9');
    expect(out).toMatch(/^[A-Z]\S+ \S+/); // "First Last" shape
  });

  it('is deterministic — same personaId yields same name', () => {
    const args: [string, string, string] = [
      'Crypto Native #9',
      'Crypto Native',
      'aaaaaaaa-1111-1111-1111-111111111111',
    ];
    expect(personaDisplayName(...args)).toBe(personaDisplayName(...args));
  });

  it('different personaIds usually yield different names', () => {
    const a = personaDisplayName('Senior #1', 'Senior', 'aaaa1111-1111-1111-1111-111111111111');
    const b = personaDisplayName('Senior #2', 'Senior', 'bbbb2222-2222-2222-2222-222222222222');
    expect(a).not.toBe(b);
  });

  it('passes real names through unchanged', () => {
    expect(personaDisplayName('Alice Chen', 'Crypto Native', 'p1')).toBe('Alice Chen');
    expect(personaDisplayName('Ivan Petrov', 'Crypto Native', 'p2')).toBe('Ivan Petrov');
  });

  it('passes through "Synthetic" fallback (does not match the seed pattern)', () => {
    expect(personaDisplayName('Synthetic', 'Crypto Native', 'p3')).toBe('Synthetic');
  });
});

describe('personaAgeFromGroup', () => {
  it('returns the bucket-center for each known age_group', () => {
    expect(personaAgeFromGroup('teen')).toBe(16);
    expect(personaAgeFromGroup('young_adult')).toBe(25);
    expect(personaAgeFromGroup('senior')).toBe(58);
    expect(personaAgeFromGroup('adult')).toBe(35);
  });

  it('falls back to 35 for undefined or unknown buckets', () => {
    expect(personaAgeFromGroup(undefined)).toBe(35);
    expect(personaAgeFromGroup('made-up-bucket')).toBe(35);
  });

  it('is deterministic — same input always yields same age (no jitter)', () => {
    // Anti-regression: a previous version hashed personaId to jitter
    // age within the bucket. The age field is bucket-center only —
    // we don't synthesise an exact age that the persona vector
    // doesn't store.
    expect(personaAgeFromGroup('young_adult')).toBe(25);
    expect(personaAgeFromGroup('young_adult')).toBe(25);
    expect(personaAgeFromGroup('young_adult')).toBe(25);
  });
});
