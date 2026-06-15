// Contract tests for the partner S2S auth middleware (workspace-keyed
// since 2026-06-12 — the geulbat env-key alias was removed; partners
// register via the console and use their rpm_sk_ secret).
// Locks: missing header → 401; key without the rpm_sk_ prefix → 403
// without ever touching the DB (findWorkspaceBySecret short-circuits
// on prefix). The valid-secret path needs a live DB and is exercised
// by smoke tests, not here.

import { describe, expect, it, vi } from 'vitest';
import { requireSiteSecret } from '../middleware/partner';
import type { Request, Response, NextFunction } from 'express';

function mkReq(partnerKey?: string): Partial<Request> {
  return {
    header: (name: string) => {
      if (name === 'x-partner-key') return partnerKey;
      return undefined;
    },
    ip: '127.0.0.1',
    path: '/survey',
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

describe('requireSiteSecret', () => {
  it('returns 401 when the header is missing', async () => {
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    await requireSiteSecret(mkReq() as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for a key without the workspace-secret prefix (no DB hit)', async () => {
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    await requireSiteSecret(
      mkReq('legacy-env-key-that-no-longer-exists') as Request,
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
