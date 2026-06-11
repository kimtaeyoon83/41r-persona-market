// Rate limiting for the validator surface (Console Sprint 1 — closes
// Known Limitations §9). In-memory stores — fine for the current
// single-instance Railway deploy; swap MemoryStore for a shared store
// if the API ever scales horizontally.
//
// Two layers, distinct from the credit ledger:
//   rate limit = burst/DoS defense (per minute/hour)
//   credits    = business allowance (per balance)
//
// The partner beacon path (POST /api/partner/t) is deliberately NOT
// behind these — tracking beacons are high-frequency by design and
// have their own soft-cap story (events/month per site key, S3).
//
// NOTE: index.ts sets `trust proxy` so req.ip is the real client IP
// behind Railway's proxy, not the proxy itself.

import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

const TEST_ENV = process.env.NODE_ENV === 'test';

/** Keys by authed user when present, client IP otherwise. */
function userOrIpKey(req: Request): string {
  if (req.privyUser?.id) return `u:${req.privyUser.id}`;
  return ipKeyGenerator(req.ip ?? '');
}

export const RATE_LIMITS = {
  scanCreateIpPerMin: 5,
  scanCreateUserPerHour: 20,
  mutationPerMin: 30,
  readPerMin: 120,
} as const;

/** POST /api/scan — layer 1: 5/min per IP (anonymous + authed alike). */
export const scanCreateIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: RATE_LIMITS.scanCreateIpPerMin,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => TEST_ENV,
  message: { error: 'rate_limited', message: 'Too many scans — slow down.' },
});

/** POST /api/scan — layer 2: 20/hour per user (IP for anonymous).
 *  Runs AFTER optionalPrivyAuth so req.privyUser is populated. */
export const scanCreateUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: RATE_LIMITS.scanCreateUserPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  skip: () => TEST_ENV,
  message: { error: 'rate_limited', message: 'Hourly scan limit reached.' },
});

/** Generic mutation limiter — survey submit, human-aggregate, payment. */
export const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: RATE_LIMITS.mutationPerMin,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  skip: () => TEST_ENV,
  message: { error: 'rate_limited' },
});

/** Cheap-read limiter — applied router-wide on the validator surface. */
export const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: RATE_LIMITS.readPerMin,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => TEST_ENV,
  message: { error: 'rate_limited' },
});
