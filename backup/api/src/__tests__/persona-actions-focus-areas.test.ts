/**
 * computeFocusAreas() — vector → behavior trigger determinism lock-in.
 *
 * This is the unit-testable foundation of the §3.4.5 trust claim
 * ("PersonaVector difference computes to behavior difference, not just
 * narrative difference"). If these tests pass, the threshold-gate path
 * is deterministic regardless of LLM randomness downstream.
 *
 * No LLM calls; pure function. Runs in <10ms.
 */
import { describe, expect, it } from 'vitest';
import { computeFocusAreas } from '../services/llm.js';
import type { PersonaVector } from '@41rpm/shared';

// ─── Fixtures ────────────────────────────────────────────────────────

function baseVector(overrides: Partial<PersonaVector> = {}): PersonaVector {
  return {
    test_style: { thoroughness: 0.5, speed: 0.5, ux_focus: 0.5, bug_detection: 0.5, creativity: 0.5 },
    expertise: { defi: 0.3, nft: 0.3, gaming: 0.3, ai_tools: 0.3, general_web: 0.5 },
    feedback_pattern: { ui_critical: 0.3, security_aware: 0.3, performance_sensitive: 0.3, accessibility_focus: 0.3, detail_oriented: 0.3 },
    reliability: { quality_score: 0.7, consistency: 0.7, response_rate: 0.7 },
    voice_sample: 'baseline tester',
    ...overrides,
  };
}

const defiTrader = baseVector({
  feedback_pattern: { security_aware: 0.85, performance_sensitive: 0.72, ui_critical: 0.31, accessibility_focus: 0.20, detail_oriented: 0.78 },
  expertise: { defi: 0.92, nft: 0.45, gaming: 0.10, ai_tools: 0.30, general_web: 0.55 },
  test_style: { thoroughness: 0.82, speed: 0.65, ux_focus: 0.40, bug_detection: 0.75, creativity: 0.50 },
  demographics: { age_group: 'adult', tech_literacy: 0.85, crypto_experience: 0.90, design_sensitivity: 0.20, patience_level: 0.35 },
  ux_preferences: { mobile_first: true, visual_style: 'minimal', font_size_preference: 0.4, information_density: 0.7, animation_tolerance: 0.6, color_contrast_need: 0.4 },
});

const teenStudent = baseVector({
  feedback_pattern: { security_aware: 0.20, performance_sensitive: 0.40, ui_critical: 0.85, accessibility_focus: 0.30, detail_oriented: 0.45 },
  expertise: { defi: 0.10, nft: 0.20, gaming: 0.55, ai_tools: 0.50, general_web: 0.70 },
  test_style: { thoroughness: 0.45, speed: 0.55, ux_focus: 0.88, bug_detection: 0.35, creativity: 0.70 },
  demographics: { age_group: 'teen', tech_literacy: 0.45, crypto_experience: 0.10, design_sensitivity: 0.85, patience_level: 0.25 },
  ux_preferences: { mobile_first: false, visual_style: 'playful', font_size_preference: 0.5, information_density: 0.4, animation_tolerance: 0.7, color_contrast_need: 0.6 },
});

// ─── Determinism — the core claim ────────────────────────────────────

describe('computeFocusAreas — determinism', () => {
  it('same vector + same domain → identical output across 100 calls', () => {
    const first = computeFocusAreas(defiTrader, 'defi');
    for (let i = 0; i < 100; i++) {
      expect(computeFocusAreas(defiTrader, 'defi')).toEqual(first);
    }
  });

  it('output is stable across both representative personas', () => {
    const aFirst = computeFocusAreas(defiTrader, 'defi');
    const bFirst = computeFocusAreas(teenStudent, 'defi');
    for (let i = 0; i < 50; i++) {
      expect(computeFocusAreas(defiTrader, 'defi')).toEqual(aFirst);
      expect(computeFocusAreas(teenStudent, 'defi')).toEqual(bFirst);
    }
  });

  it('order is deterministic (array, not set)', () => {
    const result = computeFocusAreas(defiTrader, 'defi');
    // Order matters because it controls how the Haiku prompt presents
    // priorities; reordering would change the LLM's framing.
    expect(result[0]).toContain('security');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── Behavior differentiation — the §3.4.5 claim ─────────────────────

describe('computeFocusAreas — behavior differentiation', () => {
  it('two different personas on same domain produce different focus arrays', () => {
    const a = computeFocusAreas(defiTrader, 'defi');
    const b = computeFocusAreas(teenStudent, 'defi');
    expect(a).not.toEqual(b);
  });

  it('Jaccard overlap between divergent personas is low', () => {
    const a = new Set(computeFocusAreas(defiTrader, 'defi'));
    const b = new Set(computeFocusAreas(teenStudent, 'defi'));
    const intersection = [...a].filter((x) => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    const jaccard = intersection / union;
    // Hard threshold: divergent personas should share < 25% of focus
    // areas. If this regresses, the threshold gates have been weakened
    // and the §3.4.5 claim of behavior differentiation is undermined.
    expect(jaccard).toBeLessThan(0.25);
  });

  it('defi-trader gets DeFi-specific focus on a defi domain', () => {
    const result = computeFocusAreas(defiTrader, 'defi');
    expect(result.some((f) => f.includes('DeFi specifics'))).toBe(true);
    expect(result.some((f) => f.includes('mobile-first'))).toBe(true);
    expect(result.some((f) => f.includes('security'))).toBe(true);
  });

  it('teen-student gets teen UX + non-technical + design focus', () => {
    const result = computeFocusAreas(teenStudent, 'defi');
    expect(result.some((f) => f.includes('teen UX'))).toBe(true);
    expect(result.some((f) => f.includes('design quality'))).toBe(true);
    expect(result.some((f) => f.includes('UI quality'))).toBe(true);
  });
});

// ─── Domain × expertise crossover — anti-noise gate ──────────────────

describe('computeFocusAreas — domain × expertise crossover', () => {
  it('defi expertise on a generic_saas domain does NOT inject DeFi-specific focus', () => {
    // The whole point of the crossover gate: a DeFi expert evaluating
    // a SaaS site should not ask about slippage. Without this gate the
    // diagnosis is polluted with off-topic concerns.
    const result = computeFocusAreas(defiTrader, 'generic_saas');
    expect(result.some((f) => f.includes('DeFi specifics'))).toBe(false);
    // But non-domain-scoped focus areas (security, performance, etc.) still fire.
    expect(result.some((f) => f.includes('security'))).toBe(true);
  });

  it('nft expertise on devtools domain does NOT inject NFT focus', () => {
    const nftExpert = baseVector({
      expertise: { defi: 0.3, nft: 0.92, gaming: 0.2, ai_tools: 0.3, general_web: 0.5 },
    });
    const result = computeFocusAreas(nftExpert, 'devtools');
    expect(result.some((f) => f.includes('NFT specifics'))).toBe(false);
  });

  it('gaming expertise + gaming domain → gaming-specific focus fires', () => {
    const gamer = baseVector({
      expertise: { defi: 0.1, nft: 0.1, gaming: 0.85, ai_tools: 0.3, general_web: 0.5 },
    });
    const result = computeFocusAreas(gamer, 'gaming');
    expect(result.some((f) => f.includes('gaming specifics'))).toBe(true);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────

describe('computeFocusAreas — edge cases', () => {
  it('all-zero vector returns the fallback "general usability" entry', () => {
    const empty = baseVector({
      test_style: { thoroughness: 0, speed: 0, ux_focus: 0, bug_detection: 0, creativity: 0 },
      expertise: { defi: 0, nft: 0, gaming: 0, ai_tools: 0, general_web: 0 },
      feedback_pattern: { ui_critical: 0, security_aware: 0, performance_sensitive: 0, accessibility_focus: 0, detail_oriented: 0 },
    });
    const result = computeFocusAreas(empty, 'generic_saas');
    expect(result).toEqual(['general usability and UX flow']);
  });

  it('persona without demographics/ux_preferences still returns a non-empty array', () => {
    const minimal = baseVector({
      feedback_pattern: { security_aware: 0.85, performance_sensitive: 0.3, ui_critical: 0.3, accessibility_focus: 0.3, detail_oriented: 0.3 },
    });
    // No demographics, no ux_preferences set
    const result = computeFocusAreas(minimal, 'generic_saas');
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((f) => f.includes('security'))).toBe(true);
  });

  it('threshold boundary: trait at exactly 0.7 does NOT trigger (strict >)', () => {
    const boundary = baseVector({
      feedback_pattern: { security_aware: 0.7, performance_sensitive: 0.3, ui_critical: 0.3, accessibility_focus: 0.3, detail_oriented: 0.3 },
    });
    const result = computeFocusAreas(boundary, 'generic_saas');
    // > 0.7 means 0.7 itself does NOT fire
    expect(result.some((f) => f.includes('security'))).toBe(false);
  });
});
