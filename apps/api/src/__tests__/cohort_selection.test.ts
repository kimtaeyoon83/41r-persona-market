// Contract tests for selectPersonasForCohorts.
// Locks: empty-pool guard, range edge cases, multi-cohort tiebreaker
// by L2 distance, target_n quota enforcement, unassigned reporting.

import { describe, expect, it } from 'vitest';
import { STANDARD_COHORTS } from '@41rpm/shared';
import {
  distanceToSelector,
  matchesSelector,
  selectPersonasForCohorts,
  type PersonaRow,
} from '../services/cohort_selection';

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function makePersona(
  id: string,
  vectorOverrides: DeepPartial<PersonaRow['vector']> = {}
): PersonaRow {
  const baseVector: PersonaRow['vector'] = {
    test_style: { thoroughness: 0.5, speed: 0.5, ux_focus: 0.5, bug_detection: 0.5, creativity: 0.5 },
    expertise: { defi: 0.5, nft: 0.5, gaming: 0.5, ai_tools: 0.5, general_web: 0.5 },
    feedback_pattern: {
      ui_critical: 0.5,
      security_aware: 0.5,
      performance_sensitive: 0.5,
      accessibility_focus: 0.5,
      detail_oriented: 0.5,
    },
    reliability: { quality_score: 0.7, consistency: 0.7, response_rate: 0.7 },
    voice_sample: 'Synthetic test persona.',
  };
  const merged: PersonaRow['vector'] = {
    ...baseVector,
    ...(vectorOverrides as Partial<PersonaRow['vector']>),
    test_style: { ...baseVector.test_style, ...(vectorOverrides.test_style ?? {}) },
    expertise: { ...baseVector.expertise, ...(vectorOverrides.expertise ?? {}) },
    feedback_pattern: { ...baseVector.feedback_pattern, ...(vectorOverrides.feedback_pattern ?? {}) },
    reliability: { ...baseVector.reliability, ...(vectorOverrides.reliability ?? {}) },
  };
  if (vectorOverrides.demographics) {
    merged.demographics = vectorOverrides.demographics as PersonaRow['vector']['demographics'];
  }
  if (vectorOverrides.ux_preferences) {
    merged.ux_preferences = vectorOverrides.ux_preferences as PersonaRow['vector']['ux_preferences'];
  }
  return {
    id,
    testerAddr: `wallet_${id}`,
    vector: merged,
    isActive: true,
    sasAttestId: null,
    hdIndex: null,
    suiObjectId: null,
    walrusBlobId: null,
    sealId: null,
    anchoredAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

const cryptoNativeVector = {
  demographics: {
    age_group: 'adult' as const,
    tech_literacy: 0.85,
    crypto_experience: 0.85,
    design_sensitivity: 0.5,
    patience_level: 0.6,
  },
  expertise: { defi: 0.85, nft: 0.6, gaming: 0.3, ai_tools: 0.5, general_web: 0.7 },
  feedback_pattern: {
    ui_critical: 0.5,
    security_aware: 0.8,
    performance_sensitive: 0.7,
    accessibility_focus: 0.4,
    detail_oriented: 0.7,
  },
  reliability: { quality_score: 0.9, consistency: 0.85, response_rate: 0.9 },
  ux_preferences: {
    visual_style: 'minimal' as const,
    font_size_preference: 0.5,
    information_density: 0.7,
    animation_tolerance: 0.4,
    color_contrast_need: 0.5,
    mobile_first: true,
  },
  voice_sample: 'Crypto native, mobile-first, security-aware.',
};

const teenVector = {
  demographics: {
    age_group: 'teen' as const,
    tech_literacy: 0.4,
    crypto_experience: 0.05,
    design_sensitivity: 0.5,
    patience_level: 0.3,
  },
  expertise: { defi: 0.0, nft: 0.0, gaming: 0.7, ai_tools: 0.3, general_web: 0.6 },
  feedback_pattern: {
    ui_critical: 0.4,
    security_aware: 0.2,
    performance_sensitive: 0.5,
    accessibility_focus: 0.3,
    detail_oriented: 0.3,
  },
  reliability: { quality_score: 0.6, consistency: 0.5, response_rate: 0.7 },
  ux_preferences: {
    visual_style: 'playful' as const,
    font_size_preference: 0.6,
    information_density: 0.5,
    animation_tolerance: 0.7,
    color_contrast_need: 0.5,
    mobile_first: true,
  },
  voice_sample: 'Teen newcomer, mobile-first.',
};

describe('matchesSelector', () => {
  it('matches when all numeric ranges + age_group satisfied', () => {
    const v = makePersona('p1', cryptoNativeVector).vector;
    const cohort = STANDARD_COHORTS.find((c) => c.id === 'crypto_native')!;
    expect(matchesSelector(v, cohort.selector)).toBe(true);
  });

  it('rejects when age_group does not match', () => {
    const v = makePersona('p1', teenVector).vector;
    const cohort = STANDARD_COHORTS.find((c) => c.id === 'crypto_native')!;
    expect(matchesSelector(v, cohort.selector)).toBe(false);
  });

  it('rejects when numeric axis falls outside [lo,hi] band', () => {
    const v = makePersona('p1', {
      ...cryptoNativeVector,
      demographics: { ...cryptoNativeVector.demographics, crypto_experience: 0.5 },
    }).vector;
    const cohort = STANDARD_COHORTS.find((c) => c.id === 'crypto_native')!;
    expect(matchesSelector(v, cohort.selector)).toBe(false);
  });

  it('rejects when demographics is undefined and selector requires age_group', () => {
    const v = makePersona('p1', {
      expertise: { defi: 0.85, nft: 0.6, gaming: 0.3, ai_tools: 0.5, general_web: 0.7 },
    }).vector;
    const cohort = STANDARD_COHORTS.find((c) => c.id === 'crypto_native')!;
    expect(matchesSelector(v, cohort.selector)).toBe(false);
  });

  it('rejects when ux_preferences is undefined and selector requires mobile_first', () => {
    const v = makePersona('p1', {
      demographics: {
        age_group: 'teen',
        tech_literacy: 0.4,
        crypto_experience: 0.1,
        design_sensitivity: 0.5,
        patience_level: 0.5,
      },
    }).vector;
    const cohort = STANDARD_COHORTS.find((c) => c.id === 'teen_newcomer')!;
    expect(matchesSelector(v, cohort.selector)).toBe(false);
  });
});

describe('distanceToSelector', () => {
  it('distance to own midpoint is 0', () => {
    const v = makePersona('p1', {
      demographics: {
        age_group: 'adult',
        tech_literacy: 0.5,
        crypto_experience: 0.85, // midpoint of [0.7, 1.0]
        design_sensitivity: 0.5,
        patience_level: 0.5,
      },
      expertise: { defi: 0.8, nft: 0.5, gaming: 0.3, ai_tools: 0.5, general_web: 0.7 },
      feedback_pattern: {
        ui_critical: 0.5,
        security_aware: 0.75,
        performance_sensitive: 0.5,
        accessibility_focus: 0.5,
        detail_oriented: 0.5,
      },
      reliability: { quality_score: 0.9, consistency: 0.9, response_rate: 0.9 },
    }).vector;
    const sel = STANDARD_COHORTS.find((c) => c.id === 'crypto_native')!.selector;
    expect(distanceToSelector(v, sel)).toBeCloseTo(0, 4);
  });

  it('returns 0 for selectors with no numeric constraints', () => {
    const v = makePersona('p1', cryptoNativeVector).vector;
    expect(distanceToSelector(v, { age_group: ['adult'] })).toBe(0);
  });
});

describe('selectPersonasForCohorts', () => {
  it('empty pool → all cohort buckets empty, no unassigned', () => {
    const out = selectPersonasForCohorts([]);
    for (const cohort of STANDARD_COHORTS) {
      expect(out.assignments.get(cohort.id)).toEqual([]);
    }
    expect(out.unassigned).toEqual([]);
  });

  it('matching persona lands in the right cohort', () => {
    const persona = makePersona('p1', cryptoNativeVector);
    const out = selectPersonasForCohorts([persona]);
    expect(out.assignments.get('crypto_native')).toEqual([persona]);
    expect(out.unassigned).toEqual([]);
  });

  it('persona with no demographics lands in unassigned', () => {
    const orphan = makePersona('p1', {});
    const out = selectPersonasForCohorts([orphan]);
    expect(out.unassigned).toEqual([orphan]);
    for (const cohort of STANDARD_COHORTS) {
      expect(out.assignments.get(cohort.id)).toEqual([]);
    }
  });

  it('respects target_n quota — overflow falls to next-best cohort or unassigned', () => {
    // 16 crypto-native personas; crypto_native target_n=14.
    const personas = Array.from({ length: 16 }, (_, i) =>
      makePersona(`p${i}`, cryptoNativeVector)
    );
    const out = selectPersonasForCohorts(personas);
    expect(out.assignments.get('crypto_native')!.length).toBe(14);
    const web3 = out.assignments.get('web3_pro')!.length;
    const overflow = web3 + out.unassigned.length;
    expect(overflow).toBe(2);
  });

  it('high-quality personas claim cohort first when capacity is tight', () => {
    const personas = Array.from({ length: 15 }, (_, i) =>
      makePersona(`p${i}`, {
        ...cryptoNativeVector,
        reliability: {
          quality_score: i === 0 ? 0.99 : 0.5,
          consistency: 0.7,
          response_rate: 0.7,
        },
      })
    );
    const out = selectPersonasForCohorts(personas);
    const topPersona = personas[0]!;
    expect(out.assignments.get('crypto_native')).toContain(topPersona);
  });

  it('teen vector lands in teen_newcomer cohort', () => {
    const teen = makePersona('p_teen', teenVector);
    const out = selectPersonasForCohorts([teen]);
    expect(out.assignments.get('teen_newcomer')).toEqual([teen]);
  });

  it('returns a Map with all 8 cohort keys', () => {
    const out = selectPersonasForCohorts([]);
    const ids = Array.from(out.assignments.keys()).sort();
    const expected = STANDARD_COHORTS.map((c) => c.id).sort();
    expect(ids).toEqual(expected);
  });
});
