// Console Sprint 2 contract tests.
//
// Locks: workspace key formats + hashing (two-tier key model §3.3),
// host normalization (must match the web's hostOf — same rule, two
// runtimes), survey reward constants (§4.1: 100pt, cap 30/scan), and
// the requireSiteSecret env-alias path (geulbat zero-downtime
// contract). DB-bound paths (workspace secret lookup, cap counting)
// run against a live DB only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  SECRET_PREFIX,
  SITE_KEY_PREFIX,
  generateSecret,
  generateSiteKey,
  hashSecret,
  normalizeHost,
  secretLast4,
} from '../services/workspaces';
import {
  SURVEY_REWARD_CAP_PER_SCAN,
  SURVEY_REWARD_POINTS,
} from '../services/rewards';
import { isResponseMilestone, RESPONSE_MILESTONES } from '../services/notify';
import { requireSiteSecret } from '../middleware/partner';

describe('workspace keys (two-tier model §3.3)', () => {
  it('generates distinct prefixed keys', () => {
    const pk = generateSiteKey();
    const sk = generateSecret();
    expect(pk.startsWith(SITE_KEY_PREFIX)).toBe(true);
    expect(sk.startsWith(SECRET_PREFIX)).toBe(true);
    expect(pk.length).toBeGreaterThanOrEqual(12); // beacon zod floor
    expect(sk.length).toBeGreaterThanOrEqual(40);
    expect(generateSiteKey()).not.toBe(pk);
    expect(generateSecret()).not.toBe(sk);
  });

  it('hashes secrets deterministically and never stores plaintext shape', () => {
    const sk = generateSecret();
    const h = hashSecret(sk);
    expect(h).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(hashSecret(sk)).toBe(h);
    expect(h).not.toContain(SECRET_PREFIX);
    expect(secretLast4(sk)).toBe(sk.slice(-4));
  });
});

describe('normalizeHost (must mirror web hostOf)', () => {
  it.each([
    ['https://www.Example.com/path?q=1', 'example.com'],
    ['http://sub.example.com/', 'sub.example.com'],
    ['example.com', 'example.com'],
    ['www.example.com/deep/path', 'example.com'],
    ['HTTPS://EXAMPLE.COM', 'example.com'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });
});

describe('survey reward constants (§4.1)', () => {
  it('keeps 100pt per response and the 30/scan cap', () => {
    expect(SURVEY_REWARD_POINTS).toBe(100);
    expect(SURVEY_REWARD_CAP_PER_SCAN).toBe(30);
  });
});

describe('response milestones (S3 retention loop #2)', () => {
  it('fires only on exact milestone counts', () => {
    for (const m of RESPONSE_MILESTONES) expect(isResponseMilestone(m)).toBe(true);
    expect(isResponseMilestone(0)).toBe(false);
    expect(isResponseMilestone(2)).toBe(false);
    expect(isResponseMilestone(6)).toBe(false);
    expect(isResponseMilestone(31)).toBe(false);
  });

  it('caps milestones at the reward cap (no beats past 30)', () => {
    expect(Math.max(...RESPONSE_MILESTONES)).toBe(SURVEY_REWARD_CAP_PER_SCAN);
  });
});

describe('requireSiteSecret — geulbat env alias (zero-downtime contract)', () => {
  let originalKey: string | undefined;
  beforeEach(() => {
    originalKey = process.env.PARTNER_API_KEY_GEULBAT;
    process.env.PARTNER_API_KEY_GEULBAT = 'geulbat-pilot-secret-key';
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.PARTNER_API_KEY_GEULBAT;
    else process.env.PARTNER_API_KEY_GEULBAT = originalKey;
  });

  function mkReq(key?: string): Request {
    return {
      header: (name: string) => (name === 'x-partner-key' ? key : undefined),
      ip: '127.0.0.1',
      path: '/x',
    } as unknown as Request;
  }
  function mkRes() {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { res: { status } as unknown as Response, status };
  }

  it('accepts the env geulbat key without touching the DB', async () => {
    const next = vi.fn();
    const req = mkReq('geulbat-pilot-secret-key');
    const { res, status } = mkRes();
    await requireSiteSecret(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.partnerSource).toBe('geulbat');
    expect(status).not.toHaveBeenCalled();
  });

  it('401s without a key header', async () => {
    const next = vi.fn();
    const { res, status } = mkRes();
    await requireSiteSecret(mkReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
