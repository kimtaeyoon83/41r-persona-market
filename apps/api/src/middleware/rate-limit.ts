import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { isTest } from '../config/env.js';

// Prefer a verified signed wallet, then the route's wallet param, then the
// body's wallet field, finally the remote IP. Wallet-keyed buckets ensure
// one abusive wallet can't starve the rest. IP fallback is raw — fine for
// devnet beta where unauthenticated abuse isn't yet a real threat model;
// the library's ipKeyGenerator helper insists on IPv6 CIDR input which
// crashed on localhost traffic. Revisit when we see actual abuse in logs.
function keyFor(req: Request): string {
  const signed = (req as unknown as { signedWallet?: string }).signedWallet;
  if (signed) return `w:${signed}`;
  const paramWallet = (req.params as Record<string, string | undefined>).wallet;
  if (paramWallet) return `w:${paramWallet}`;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const bodyWallet = body.wallet_address ?? body.tester_addr ?? body.company_wallet;
  if (typeof bodyWallet === 'string' && bodyWallet.length > 0) return `w:${bodyWallet}`;
  return `ip:${req.ip ?? 'anon'}`;
}

function buildLimiter(overrides: Partial<Options>) {
  return rateLimit({
    windowMs: 60_000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyFor,
    // Validation in v8 enforces the ipKeyGenerator helper; we opt out
    // because keyFor always prefers a wallet over the IP.
    validate: { keyGeneratorIpFallback: false },
    skip: () => isTest,
    message: { error: 'Too many requests — please slow down.' },
    ...overrides,
  });
}

export const autotestRunLimiter = buildLimiter({ max: 2 });
export const reportSubmitLimiter = buildLimiter({ max: 5 });
export const llmGenerateLimiter = buildLimiter({ max: 10 });
