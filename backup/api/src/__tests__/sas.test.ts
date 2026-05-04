import { describe, it, expect } from 'vitest';
import { calculateTrustTier } from '../services/sas.js';

describe('calculateTrustTier', () => {
  it('returns Gold for high quality + many tests', () => {
    expect(calculateTrustTier(4.5, 15)).toBe('Gold');
    expect(calculateTrustTier(4.0, 10)).toBe('Gold');
  });

  it('returns Silver for medium quality + moderate tests', () => {
    expect(calculateTrustTier(3.5, 5)).toBe('Silver');
    expect(calculateTrustTier(3.8, 7)).toBe('Silver');
  });

  it('returns Bronze for low quality or few tests', () => {
    expect(calculateTrustTier(2.0, 3)).toBe('Bronze');
    expect(calculateTrustTier(3.5, 2)).toBe('Bronze');
    expect(calculateTrustTier(4.5, 3)).toBe('Bronze');
  });

  it('handles edge cases at boundaries', () => {
    // Exactly at Gold threshold
    expect(calculateTrustTier(4.0, 10)).toBe('Gold');
    // Just below Gold (quality)
    expect(calculateTrustTier(3.9, 10)).toBe('Silver');
    // Just below Gold (tests)
    expect(calculateTrustTier(4.0, 9)).toBe('Silver');
    // Exactly at Silver threshold
    expect(calculateTrustTier(3.5, 5)).toBe('Silver');
    // Just below Silver (quality)
    expect(calculateTrustTier(3.4, 5)).toBe('Bronze');
    // Just below Silver (tests)
    expect(calculateTrustTier(3.5, 4)).toBe('Bronze');
  });

  it('returns Bronze for zero values', () => {
    expect(calculateTrustTier(0, 0)).toBe('Bronze');
  });
});
