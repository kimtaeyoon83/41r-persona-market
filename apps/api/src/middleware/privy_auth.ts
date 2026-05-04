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
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../config/env.js';
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

/** Upsert the Privy user into the 41R users table. */
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
    return {
      id: existing.id,
      privyId,
      email: email ?? existing.email,
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
  return {
    id: inserted.id,
    privyId,
    email: inserted.email,
    walletAddress: inserted.walletAddress,
    displayName: inserted.displayName,
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
