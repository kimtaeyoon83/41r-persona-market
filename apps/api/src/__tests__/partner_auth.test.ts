// Contract tests for the partner S2S auth middleware (geulbat pilot).
// Locks: env-unset/short → 503, missing header → 401, invalid → 403,
// valid → next(). Mirrors admin_auth.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireGeulbatKey } from '../middleware/partner';
import type { Request, Response, NextFunction } from 'express';

function mkReq(partnerKey?: string): Partial<Request> {
  return {
    header: (name: string) => {
      if (name === 'x-partner-key') return partnerKey;
      return undefined;
    },
    ip: '127.0.0.1',
    path: '/geulbat/survey',
  } as Partial<Request>;
}

function mkRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe('requireGeulbatKey', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.PARTNER_API_KEY_GEULBAT;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PARTNER_API_KEY_GEULBAT;
    else process.env.PARTNER_API_KEY_GEULBAT = originalEnv;
  });

  it('returns 503 when the env key is unset', () => {
    delete process.env.PARTNER_API_KEY_GEULBAT;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireGeulbatKey(mkReq('whatever') as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 when the env key is shorter than 12 chars', () => {
    process.env.PARTNER_API_KEY_GEULBAT = 'short';
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireGeulbatKey(mkReq('short') as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the header is missing', () => {
    process.env.PARTNER_API_KEY_GEULBAT = 'a-valid-partner-key';
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireGeulbatKey(mkReq(undefined) as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 on key mismatch', () => {
    process.env.PARTNER_API_KEY_GEULBAT = 'a-valid-partner-key';
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireGeulbatKey(mkReq('wrong-key-entirely') as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() on a matching key', () => {
    process.env.PARTNER_API_KEY_GEULBAT = 'a-valid-partner-key';
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireGeulbatKey(mkReq('a-valid-partner-key') as Request, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
