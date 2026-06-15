// Console Sprint 1 contract tests.
//
// Locks the §12 decisions from docs/console-ia-redesign.md that have
// code-level constants or pure logic:
//   1. Pricing — Mode A $2 / Mode B $1; signup bonus $30 verified /
//      $5 wallet-only (decisions 1-2).
//   2. Anonymous demo allowance — 1 fresh scan per IP per 24h window.
//   3. Calibration soft gate — open without ADMIN_API_KEY (dev),
//      operator-only when configured (§3.2 demotion).
//   4. Rate-limit envelope numbers (Known Limitations §9 closure).
// DB-bound paths (debit/refund/grant) are exercised against a live DB
// only — their race-safety relies on pg advisory locks that mocks
// can't represent honestly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  SCAN_PRICE_CENTS,
  SIGNUP_BONUS_VERIFIED_CENTS,
  SIGNUP_BONUS_WALLET_CENTS,
} from '../services/credits';
import { RATE_LIMITS } from '../middleware/rate_limit';
import { isAdminRequest, requireAdminKeyIfConfigured } from '../middleware/admin';
import { checkDemoIpAllowance, recordDemoIpScan } from '../routes/scan';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('credit pricing constants (§12 decisions 1-2)', () => {
  it('prices Mode A at $2 and Mode B at $1', () => {
    expect(SCAN_PRICE_CENTS.A).toBe(200);
    expect(SCAN_PRICE_CENTS.B).toBe(100);
  });

  it('grants $30 verified / $5 wallet-only signup bonus', () => {
    expect(SIGNUP_BONUS_VERIFIED_CENTS).toBe(3000);
    expect(SIGNUP_BONUS_WALLET_CENTS).toBe(500);
    // The upgrade row is the difference — wallet-only users who later
    // link an email must end at exactly the verified total.
    expect(SIGNUP_BONUS_VERIFIED_CENTS - SIGNUP_BONUS_WALLET_CENTS).toBe(2500);
  });
});

describe('anonymous demo allowance (1 per IP per 24h)', () => {
  it('allows a fresh IP, blocks within 24h, allows after the window', () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
    const t0 = 1_700_000_000_000;

    expect(checkDemoIpAllowance(ip, t0)).toBe(true);
    recordDemoIpScan(ip, t0);

    expect(checkDemoIpAllowance(ip, t0 + 1000)).toBe(false);
    expect(checkDemoIpAllowance(ip, t0 + DAY_MS - 1)).toBe(false);
    expect(checkDemoIpAllowance(ip, t0 + DAY_MS)).toBe(true);
  });

  it('tracks IPs independently', () => {
    const t0 = 1_700_000_000_000;
    recordDemoIpScan('203.0.113.7', t0);
    expect(checkDemoIpAllowance('203.0.113.8', t0 + 1000)).toBe(true);
  });
});

describe('rate-limit envelope (Known Limitations §9)', () => {
  it('keeps the agreed limits', () => {
    expect(RATE_LIMITS.scanCreateIpPerMin).toBe(5);
    expect(RATE_LIMITS.scanCreateUserPerHour).toBe(20);
    expect(RATE_LIMITS.mutationPerMin).toBe(30);
  });
});

describe('calibration soft gate (requireAdminKeyIfConfigured)', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_API_KEY;
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalKey;
  });

  function mkReq(adminKey?: string): Request {
    return {
      header: (name: string) =>
        name === 'x-admin-key' ? adminKey : undefined,
      ip: '127.0.0.1',
      path: '/report',
    } as unknown as Request;
  }
  function mkRes() {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { res: { status } as unknown as Response, status, json };
  }

  it('stays open when ADMIN_API_KEY is unset (local dev)', () => {
    delete process.env.ADMIN_API_KEY;
    const next = vi.fn();
    const { res, status } = mkRes();
    requireAdminKeyIfConfigured(mkReq(), res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects without the key when configured', () => {
    process.env.ADMIN_API_KEY = 'super-secret-operator-key';
    const next = vi.fn();
    const { res, status } = mkRes();
    requireAdminKeyIfConfigured(mkReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('passes with the correct key when configured', () => {
    process.env.ADMIN_API_KEY = 'super-secret-operator-key';
    const next = vi.fn();
    const { res, status } = mkRes();
    requireAdminKeyIfConfigured(mkReq('super-secret-operator-key'), res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('isAdminRequest is false when key unset or too short', () => {
    delete process.env.ADMIN_API_KEY;
    expect(isAdminRequest(mkReq('anything'))).toBe(false);
    process.env.ADMIN_API_KEY = 'short';
    expect(isAdminRequest(mkReq('short'))).toBe(false);
    process.env.ADMIN_API_KEY = 'super-secret-operator-key';
    expect(isAdminRequest(mkReq('super-secret-operator-key'))).toBe(true);
    expect(isAdminRequest(mkReq('wrong-key-entirely'))).toBe(false);
  });
});
