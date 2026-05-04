import { describe, it, expect } from 'vitest';
import { backoffDelayMs, isRowEligible, isRowExpired } from '../services/settlement-worker.js';

describe('backoffDelayMs', () => {
  it('grows through 30s → 1m → 5m → 15m', () => {
    expect(backoffDelayMs(0)).toBe(30_000);
    expect(backoffDelayMs(1)).toBe(60_000);
    expect(backoffDelayMs(2)).toBe(5 * 60_000);
    expect(backoffDelayMs(3)).toBe(15 * 60_000);
  });

  it('caps at the last schedule value for further retries', () => {
    expect(backoffDelayMs(4)).toBe(15 * 60_000);
    expect(backoffDelayMs(100)).toBe(15 * 60_000);
  });

  it('treats negative counts as the first slot', () => {
    expect(backoffDelayMs(-1)).toBe(30_000);
  });
});

describe('isRowEligible', () => {
  const NOW = 1_000_000_000;

  it('retries a freshly-queued row without a lastRetryAt', () => {
    // settledAt 40s ago, never retried → eligible (> 30s threshold)
    const row = { retryCount: 0, lastRetryAt: null, settledAt: new Date(NOW - 40_000) };
    expect(isRowEligible(row, NOW)).toBe(true);
  });

  it('defers a row still inside its backoff window', () => {
    // lastRetryAt 20s ago at retryCount 0 → need 30s
    const row = { retryCount: 0, lastRetryAt: new Date(NOW - 20_000), settledAt: new Date(NOW - 40_000) };
    expect(isRowEligible(row, NOW)).toBe(false);
  });

  it('respects the escalated delay after a few retries', () => {
    // retryCount=2 → 5m delay; 2m ago not eligible, 6m ago is
    const notYet = { retryCount: 2, lastRetryAt: new Date(NOW - 2 * 60_000), settledAt: new Date(NOW - 10 * 60_000) };
    expect(isRowEligible(notYet, NOW)).toBe(false);
    const eligible = { retryCount: 2, lastRetryAt: new Date(NOW - 6 * 60_000), settledAt: new Date(NOW - 10 * 60_000) };
    expect(isRowEligible(eligible, NOW)).toBe(true);
  });
});

describe('isRowExpired', () => {
  it('flags rows older than 24 hours', () => {
    const now = Date.now();
    const fresh = { settledAt: new Date(now - 3 * 60 * 60 * 1000) };
    const stale = { settledAt: new Date(now - 25 * 60 * 60 * 1000) };
    expect(isRowExpired(fresh, now)).toBe(false);
    expect(isRowExpired(stale, now)).toBe(true);
  });

  it('treats rows with no settledAt as non-expired (data anomaly — leave alone)', () => {
    expect(isRowExpired({ settledAt: null }, Date.now())).toBe(false);
  });
});
