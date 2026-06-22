// Privy single-auth middleware (Phase 4 §1).
//
// Verifies the Privy access token from `Authorization: Bearer <token>`,
// fetches the canonical Privy user (linked accounts), upserts a row in
// the 41R `users` table keyed by `privy_id`, and attaches the user to
// `req.privyUser` for downstream handlers.
//
// Local dev without PRIVY_APP_ID / PRIVY_APP_SECRET set: middleware
// short-circuits with 503 so the API still boots without auth.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { PrivyClient, type AuthTokenClaims, type User as PrivyUser } from '@privy-io/server-auth';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../config/env.js';
import { ensureSignupBonus } from '../services/credits.js';
import { logger } from '../logger.js';

const log = logger.child({ service: 'privy_auth' });

let cachedClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient | null {
  if (cachedClient) return cachedClient;
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
    return null;
  }
  cachedClient = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
  return cachedClient;
}

/** What the middleware attaches to req when auth succeeds. */
export type AuthedUser = {
  /** 41R-side row id (uuid). Use this for FK joins (e.g. scan ownership). */
  id: string;
  /** Privy DID — `did:privy:c0123...`. Stable across renames/relinks. */
  privyId: string;
  /** Denormalized from Privy's linked accounts. May be null. */
  email: string | null;
  walletAddress: string | null;
  displayName: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      privyUser?: AuthedUser;
    }
  }
}

/** Extract email + first wallet from Privy linked accounts. Both may be null. */
function extractIdentity(user: PrivyUser): { email: string | null; wallet: string | null } {
  let email: string | null = null;
  let wallet: string | null = null;
  for (const acc of user.linkedAccounts ?? []) {
    if (!email && acc.type === 'email' && 'address' in acc) {
      email = (acc as { address: string }).address;
    }
    if (!wallet && acc.type === 'wallet' && 'address' in acc) {
      wallet = (acc as { address: string }).address;
    }
  }
  return { email, wallet };
}

/** Verified identity = any non-wallet linked account (email, Google,
 *  Discord, X, phone, …). Gates the signup-bonus tier: $30 verified vs
 *  $5 wallet-only (console-ia-redesign.md §12 decision 2). */
function hasVerifiedIdentity(user: PrivyUser): boolean {
  return (user.linkedAccounts ?? []).some(
    (acc) => acc.type !== 'wallet' && acc.type !== 'smart_wallet',
  );
}

/** Upsert the Privy user into the 41R users table. */
/**
 * Partner-pilot claim pass (geulbat, 2026-06-10). Survey responses and
 * point credits that arrived through the partner S2S channel land with
 * user_id NULL + a Google-verified email. When that email logs into
 * 41R, backfill user_id so /me/responses and the point balance show
 * the person's own history. Guard: never claim a survey row for a scan
 * the user already submitted to directly — that would violate the
 * (scan_id, user_id) unique index; the Privy-authored row wins.
 * Non-fatal by design: a claim failure must never block login.
 */
async function claimPartnerRows(userId: string, email: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE survey_responses SET user_id = ${userId}
      WHERE lower(email) = lower(${email}) AND user_id IS NULL
        AND scan_id NOT IN (
          SELECT scan_id FROM survey_responses WHERE user_id = ${userId}
        )`);
    await db.execute(sql`
      UPDATE point_transactions SET user_id = ${userId}
      WHERE lower(email) = lower(${email}) AND user_id IS NULL`);
    await db.execute(sql`
      UPDATE partner_profiles SET user_id = ${userId}
      WHERE lower(email) = lower(${email}) AND user_id IS NULL`);
    await db.execute(sql`
      UPDATE partner_behavior_events SET user_id = ${userId}
      WHERE lower(email) = lower(${email}) AND user_id IS NULL`);
    // Team workspaces — claim site shares invited to this email.
    await db.execute(sql`
      UPDATE site_members SET user_id = ${userId}
      WHERE lower(email) = lower(${email}) AND user_id IS NULL`);
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'partner row claim failed (non-fatal)');
  }
}

async function upsertUser(claims: AuthTokenClaims, user: PrivyUser): Promise<AuthedUser> {
  const privyId = claims.userId;
  const { email, wallet } = extractIdentity(user);

  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.privyId, privyId));

  if (existing) {
    // Touch updated_at + sync any new linked-account fields. Keep the
    // existing row's id stable so any FK references remain valid.
    await db
      .update(schema.users)
      .set({
        email: email ?? existing.email,
        walletAddress: wallet ?? existing.walletAddress,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.privyId, privyId));
    const effectiveEmail = email ?? existing.email;
    if (effectiveEmail) await claimPartnerRows(existing.id, effectiveEmail);
    await ensureSignupBonus(existing.id, hasVerifiedIdentity(user));
    return {
      id: existing.id,
      privyId,
      email: effectiveEmail,
      walletAddress: wallet ?? existing.walletAddress,
      displayName: existing.displayName,
    };
  }

  const [inserted] = await db
    .insert(schema.users)
    .values({
      privyId,
      email,
      walletAddress: wallet,
    })
    .returning();
  if (!inserted) throw new Error('users INSERT returned no row');
  if (inserted.email) await claimPartnerRows(inserted.id, inserted.email);
  await ensureSignupBonus(inserted.id, hasVerifiedIdentity(user));
  return {
    id: inserted.id,
    privyId,
    email: inserted.email,
    walletAddress: inserted.walletAddress,
    displayName: inserted.displayName,
  };
}

// ─── Dev auth bypass (E2E, 2026-06-12) ──────────────────────────────
// DEV_AUTH_BYPASS=1 + `x-dev-user-email` header → synthesizes an
// authed user (upserted into users keyed by privy_id `dev:<email>`,
// signup bonus included) without touching Privy. STRICTLY dev/test:
// hard-refused when NODE_ENV=production regardless of the env flag,
// so a leaked flag can never open prod. Used by local E2E runs where
// the Privy browser modal can't be driven headlessly.
async function devBypassUser(req: Request): Promise<AuthedUser | null> {
  if (process.env.NODE_ENV === 'production') return null;
  if (process.env.DEV_AUTH_BYPASS !== '1') return null;
  const email = req.header('x-dev-user-email');
  if (!email || !email.includes('@')) return null;
  const privyId = `dev:${email.toLowerCase()}`;
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.privyId, privyId));
  let row = existing;
  if (!row) {
    const [inserted] = await db
      .insert(schema.users)
      .values({ privyId, email: email.toLowerCase(), walletAddress: null })
      .returning();
    row = inserted!;
  }
  await ensureSignupBonus(row.id, true);
  log.warn({ email }, 'DEV_AUTH_BYPASS user attached (never in production)');
  return {
    id: row.id,
    privyId,
    email: row.email,
    walletAddress: row.walletAddress,
    displayName: row.displayName,
  };
}

/**
 * Soft variant — if a valid Privy token is present, attaches
 * `req.privyUser` and continues. If absent / invalid, just calls
 * next() without setting `req.privyUser`. Use on routes that work
 * for both authed and anonymous traffic (e.g., POST /api/scan).
 */
export const optionalPrivyAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const bypass = await devBypassUser(req).catch(() => null);
  if (bypass) {
    req.privyUser = bypass;
    next();
    return;
  }
  const client = getPrivyClient();
  if (!client) {
    next();
    return;
  }
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    next();
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    next();
    return;
  }
  try {
    const claims = await client.verifyAuthToken(token);
    const user = await client.getUser(claims.userId);
    req.privyUser = await upsertUser(claims, user);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : 'unknown' },
      'optional privy auth failed — proceeding anonymously',
    );
  }
  next();
};

/**
 * Express middleware — requires a valid Privy access token. On success
 * attaches `req.privyUser` and calls next(). On failure responds 401
 * (or 503 if the server isn't configured for Privy yet).
 */
export const requirePrivyAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const bypass = await devBypassUser(req).catch(() => null);
  if (bypass) {
    req.privyUser = bypass;
    next();
    return;
  }
  const client = getPrivyClient();
  if (!client) {
    res.status(503).json({ error: 'privy_not_configured' });
    return;
  }
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({ error: 'missing_bearer_token' });
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'empty_bearer_token' });
    return;
  }

  let claims: AuthTokenClaims;
  try {
    claims = await client.verifyAuthToken(token);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : 'unknown' },
      'privy token verification failed',
    );
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  let user: PrivyUser;
  try {
    user = await client.getUser(claims.userId);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : 'unknown', userId: claims.userId },
      'privy getUser failed',
    );
    res.status(502).json({ error: 'privy_upstream_error' });
    return;
  }

  try {
    req.privyUser = await upsertUser(claims, user);
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : 'unknown', userId: claims.userId },
      'users upsert failed',
    );
    res.status(500).json({ error: 'user_persistence_failed' });
    return;
  }

  next();
};
