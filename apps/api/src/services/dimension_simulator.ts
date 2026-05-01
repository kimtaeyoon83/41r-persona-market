// Deterministic dimension simulator — Phase 1B stub for the persona
// Sonnet vision call. Same persona × same URL always produces the
// same dimension scores. This lets Phase 1B exercise the full
// pipeline (cohort selection → response → cohort means → audience-
// fit synthesis → DB writes) without any LLM dependency.
//
// Phase 1C will replace `simulatePersonaResponse` with a real Sonnet
// vision call returning the §11.1 schema. Everything downstream of
// this function (post-processing, aggregation, synthesis, DB writes)
// stays — that's the entire point of using a simulator at this layer.

import {
  ENGAGEMENT_BAND_TO_SCORE,
  RETENTION_BAND_TO_DCURVE,
  computeSusScore,
  type EngagementBand,
  type PersonaDimensionScores,
  type RetentionBand,
} from './audience_fit.js';
import type { PersonaRow } from './cohort_selection.js';

// ─── Deterministic noise ──────────────────────────────────────────
// FNV-1a 32-bit hash → 0..1 float. We want reproducibility across
// runs, not cryptographic strength.
function simpleHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function seedNoise(seed: number, axis: number): number {
  // Different prime per axis → near-independent noise streams.
  const v = (seed * 9301 + axis * 49297) % 233280;
  return v / 233280;
}

const clamp = (x: number, lo = 0, hi = 100): number =>
  Math.max(lo, Math.min(hi, x));

// ─── SUS response fabricator ──────────────────────────────────────
// Build a 10-Likert response array consistent with the persona's
// happiness profile, then run it through the real Brooke 1986 scorer
// so the value is dimensionally identical to a true SUS response.
function fabricateSusResponses(baseHappiness: number, seed: number): number[] {
  // Map base 0-100 → mean Likert per polarity:
  //   Odd (positive-worded, score = r-1) wants r ~ 1 + base/100 * 4
  //   Even (negative-worded, score = 5-r) wants r ~ 5 - base/100 * 4
  const oddTarget = 1 + (baseHappiness / 100) * 4;
  const evenTarget = 5 - (baseHappiness / 100) * 4;
  const out: number[] = [];
  for (let i = 0; i < 10; i++) {
    const target = i % 2 === 0 ? oddTarget : evenTarget;
    const noise = (seedNoise(seed, i + 1) - 0.5) * 1.6;
    const raw = Math.round(Math.max(1, Math.min(5, target + noise)));
    out.push(raw);
  }
  return out;
}

function pickEngagementBand(score: number): EngagementBand {
  if (score < 20) return 'abandon';
  if (score < 40) return 'skim';
  if (score < 65) return 'browse';
  if (score < 82) return 'engage';
  return 'extended';
}

function pickRetentionBand(retentionish: number): RetentionBand {
  if (retentionish < 25) return 'no_return';
  if (retentionish < 50) return 'weak';
  if (retentionish < 75) return 'moderate';
  return 'strong';
}

// ─── Main simulator ───────────────────────────────────────────────
export type SimulatedResponse = {
  scores: PersonaDimensionScores;
  retention_band: RetentionBand;
  retention_d_curve: { d1: number; d3: number; d7: number; d30: number };
  engagement_band: EngagementBand;
  raw: {
    sus_responses: number[];
    sus_raw_score: number;
    signup_likelihood: number;
    completion_likelihood: number;
  };
  is_flagged: boolean;
  flag_reason: string | null;
};

export function simulatePersonaResponse(
  persona: PersonaRow,
  targetUrl: string,
  hypothesis?: string,
): SimulatedResponse {
  const v = persona.vector;
  const seed = simpleHash(targetUrl + persona.id + (hypothesis ?? ''));

  const techLit = v.demographics?.tech_literacy ?? 0.5;
  const cryptoExp = v.demographics?.crypto_experience ?? 0.0;
  const designSens = v.demographics?.design_sensitivity ?? 0.5;
  const patience = v.demographics?.patience_level ?? 0.5;
  const ageGroup = v.demographics?.age_group;
  const securityAware = v.feedback_pattern?.security_aware ?? 0.5;
  const detailOriented = v.feedback_pattern?.detail_oriented ?? 0.5;
  const defiExpertise = v.expertise?.defi ?? 0.0;
  const generalWeb = v.expertise?.general_web ?? 0.5;

  // Site context: assumes DeFi-shape target. Phase 1C swaps with real
  // category detection. The seed-derived noise (-10..+10 per axis)
  // gives reproducible variation across personas.
  const noise0 = (seedNoise(seed, 0) - 0.5) * 20;
  const noise1 = (seedNoise(seed, 1) - 0.5) * 20;
  const noise2 = (seedNoise(seed, 2) - 0.5) * 20;
  const noise3 = (seedNoise(seed, 3) - 0.5) * 20;
  const noise4 = (seedNoise(seed, 4) - 0.5) * 20;

  // Engagement: tech literacy + design sensitivity drive it up;
  // patience modulates abandon vs extended.
  const engagement = clamp(
    20 + techLit * 50 + designSens * 20 + patience * 20 + generalWeb * 10 + noise0
  );

  // Task success on a DeFi-shaped site: crypto expertise dominates.
  const taskSuccess = clamp(
    15 + cryptoExp * 50 + defiExpertise * 30 + techLit * 15 + noise1
  );

  // Happiness: design sensitivity + a global URL "site-quality" prior
  // (the simulator's stand-in for visual quality from screenshots).
  const sitePrior = (seedNoise(simpleHash(targetUrl), 0) - 0.5) * 30;
  const happiness = clamp(
    35 + designSens * 30 + patience * 15 + sitePrior + noise2
  );

  // Adoption: crypto experience + general_web + small security bump.
  const adoption = clamp(
    20 + cryptoExp * 35 + generalWeb * 25 + securityAware * 10 + noise3
  );

  // Retention proxy → band → D-curve via the real spec §4.1 mapping.
  const ageAdjust = ageGroup === 'teen' ? -15 : ageGroup === 'senior' ? -10 : 0;
  const retentionish = clamp(
    20 + patience * 35 + detailOriented * 20 + cryptoExp * 15 + ageAdjust + noise4
  );
  const retentionBand = pickRetentionBand(retentionish);
  const retentionDCurve = RETENTION_BAND_TO_DCURVE[retentionBand];

  const engagementBand = pickEngagementBand(engagement);

  // SUS responses tied to happiness so the post-processed score
  // matches what we just computed (within Likert rounding).
  const susResponses = fabricateSusResponses(happiness, seed);
  const susRawScore = computeSusScore(susResponses);

  // Self-consistency flag (§11.1 grade-inflation guard).
  const incoherent = susRawScore > 70 && retentionBand === 'no_return';

  return {
    scores: {
      happiness: susRawScore,
      engagement: ENGAGEMENT_BAND_TO_SCORE[engagementBand],
      adoption,
      retention_d7: retentionDCurve.d7,
      task_success: taskSuccess,
    },
    retention_band: retentionBand,
    retention_d_curve: retentionDCurve,
    engagement_band: engagementBand,
    raw: {
      sus_responses: susResponses,
      sus_raw_score: susRawScore,
      signup_likelihood: adoption / 100,
      completion_likelihood: taskSuccess / 100,
    },
    is_flagged: incoherent,
    flag_reason: incoherent
      ? 'happiness > 70 but retention=no_return (self-consistency)'
      : null,
  };
}
