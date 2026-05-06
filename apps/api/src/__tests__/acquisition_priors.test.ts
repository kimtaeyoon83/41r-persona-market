import { describe, it, expect } from 'vitest';
import {
  ACQUISITION_PRIORS,
  ACQUISITION_CATEGORIES,
  CONFIDENCE_FLOOR,
  getAcquisitionPriorsFor,
  isAcquisitionCategory,
} from '@41rpm/shared';

const COHORT_IDS = [
  'crypto_native',
  'defi_beginner',
  'designer_20s',
  'senior',
  'teen_newcomer',
  'mobile_power',
  'web3_pro',
  'non_tech_30s',
] as const;

describe('ACQUISITION_PRIORS — invariants', () => {
  // Phase B1 Stage 1 — these locks ensure the v1.0 prior table is
  // arithmetically sound. If a future edit breaks any of these,
  // weighted aggregation will produce nonsense.

  it('has all 12 categories', () => {
    expect(Object.keys(ACQUISITION_PRIORS).sort()).toEqual(
      [...ACQUISITION_CATEGORIES].sort(),
    );
  });

  it('arrival shares sum to 1.0 ± 0.01 per category', () => {
    for (const cat of ACQUISITION_CATEGORIES) {
      const priors = ACQUISITION_PRIORS[cat];
      const sum = COHORT_IDS.reduce(
        (s, id) => s + priors[id].arrival_share,
        0,
      );
      expect(sum, `category ${cat} arrival_share sum`).toBeCloseTo(1.0, 1);
    }
  });

  it('every cohort has a prior in every category', () => {
    for (const cat of ACQUISITION_CATEGORIES) {
      for (const id of COHORT_IDS) {
        expect(
          ACQUISITION_PRIORS[cat][id],
          `${cat} × ${id} missing`,
        ).toBeDefined();
      }
    }
  });

  it('arrival_share in [0, 1] and abandon_rate in [0, 1]', () => {
    for (const cat of ACQUISITION_CATEGORIES) {
      const priors = ACQUISITION_PRIORS[cat];
      for (const id of COHORT_IDS) {
        const p = priors[id];
        expect(p.arrival_share, `${cat}.${id}.arrival`).toBeGreaterThanOrEqual(0);
        expect(p.arrival_share, `${cat}.${id}.arrival`).toBeLessThanOrEqual(1);
        expect(p.abandon_rate, `${cat}.${id}.abandon`).toBeGreaterThanOrEqual(0);
        expect(p.abandon_rate, `${cat}.${id}.abandon`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('directional sanity: DeFi favors web3_pro+crypto_native over senior+teen', () => {
    const d = ACQUISITION_PRIORS.DeFi;
    const web3Sum = d.web3_pro.arrival_share + d.crypto_native.arrival_share;
    const newcomerSum = d.senior.arrival_share + d.teen_newcomer.arrival_share;
    expect(web3Sum).toBeGreaterThan(newcomerSum * 5);
  });

  it('directional sanity: E-commerce favors non_tech_30s+mobile_power over crypto_native', () => {
    const e = ACQUISITION_PRIORS['E-commerce'];
    const massSum =
      e.non_tech_30s.arrival_share + e.mobile_power.arrival_share;
    expect(massSum).toBeGreaterThan(e.crypto_native.arrival_share * 10);
  });

  it('directional sanity: Crypto Wallet → senior/teen abandon ≥ 0.8', () => {
    const w = ACQUISITION_PRIORS['Crypto Wallet'];
    expect(w.senior.abandon_rate).toBeGreaterThanOrEqual(0.8);
    expect(w.teen_newcomer.abandon_rate).toBeGreaterThanOrEqual(0.8);
  });
});

describe('getAcquisitionPriorsFor — fallback logic', () => {
  it('returns Other priors when category is null', () => {
    expect(getAcquisitionPriorsFor(null, 0.99)).toBe(ACQUISITION_PRIORS.Other);
  });

  it('returns Other priors when confidence is null', () => {
    expect(getAcquisitionPriorsFor('DeFi', null)).toBe(
      ACQUISITION_PRIORS.Other,
    );
  });

  it('returns Other priors when confidence < CONFIDENCE_FLOOR', () => {
    expect(
      getAcquisitionPriorsFor('DeFi', CONFIDENCE_FLOOR - 0.01),
    ).toBe(ACQUISITION_PRIORS.Other);
  });

  it('returns category priors when confidence ≥ CONFIDENCE_FLOOR', () => {
    expect(getAcquisitionPriorsFor('DeFi', CONFIDENCE_FLOOR)).toBe(
      ACQUISITION_PRIORS.DeFi,
    );
    expect(getAcquisitionPriorsFor('E-commerce', 0.98)).toBe(
      ACQUISITION_PRIORS['E-commerce'],
    );
  });

  it('falls back to Other for unknown category strings', () => {
    expect(getAcquisitionPriorsFor('Unknown Category', 0.99)).toBe(
      ACQUISITION_PRIORS.Other,
    );
  });
});

describe('isAcquisitionCategory', () => {
  it('accepts known categories', () => {
    expect(isAcquisitionCategory('DeFi')).toBe(true);
    expect(isAcquisitionCategory('E-commerce')).toBe(true);
    expect(isAcquisitionCategory('Other')).toBe(true);
  });

  it('rejects unknown categories', () => {
    expect(isAcquisitionCategory('Web2')).toBe(false);
    expect(isAcquisitionCategory('')).toBe(false);
  });
});
