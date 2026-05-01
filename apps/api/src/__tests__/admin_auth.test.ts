// Contract tests for the admin auth middleware.
// Locks: env-unset → 503, missing header → 401, invalid → 403,
// valid → next().

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdminKey } from '../middleware/admin';
import type { Request, Response, NextFunction } from 'express';

function mkReq(adminKey?: string): Partial<Request> {
  return {
    header: (name: string) => {
      if (name === 'x-admin-key') return adminKey;
      return undefined;
    },
    ip: '127.0.0.1',
    path: '/run-track-a',
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

describe('requireAdminKey', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.ADMIN_API_KEY;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalEnv;
  });

  it('503 when ADMIN_API_KEY env unset', () => {
    delete process.env.ADMIN_API_KEY;
    const req = mkReq('any-key') as Request;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireAdminKey(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('503 when ADMIN_API_KEY too short (<12 chars)', () => {
    process.env.ADMIN_API_KEY = 'short';
    const req = mkReq('short') as Request;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireAdminKey(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('401 when x-admin-key header missing', () => {
    process.env.ADMIN_API_KEY = 'a-very-long-admin-key-here';
    const req = mkReq(undefined) as Request;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireAdminKey(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 when x-admin-key header mismatches', () => {
    process.env.ADMIN_API_KEY = 'a-very-long-admin-key-here';
    const req = mkReq('wrong-key-but-long-enough') as Request;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireAdminKey(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('next() when key matches', () => {
    process.env.ADMIN_API_KEY = 'a-very-long-admin-key-here';
    const req = mkReq('a-very-long-admin-key-here') as Request;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    requireAdminKey(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
