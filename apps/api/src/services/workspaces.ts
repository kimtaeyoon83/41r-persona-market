// Site-workspace service (Console Sprint 2 — console-ia-redesign.md §1, §7).
//
// Key model (§3.3, two tiers — never confuse them):
//   site key   rpm_pk_…  public, beacon routing only, no read access
//   secret     rpm_sk_…  S2S + HMAC handoff signing, hash stored only,
//                        plaintext returned exactly once at issue/rotate
// Neither key grants read access — reads are Privy-session-only, so a
// leaked key's blast radius is "fake data injection", never exfiltration.

import { createHash, randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const SITE_KEY_PREFIX = 'rpm_pk_';
export const SECRET_PREFIX = 'rpm_sk_';

export function generateSiteKey(): string {
  return SITE_KEY_PREFIX + randomBytes(12).toString('hex'); // 31 chars
}

export function generateSecret(): string {
  return SECRET_PREFIX + randomBytes(24).toString('hex'); // 55 chars
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function secretLast4(secret: string): string {
  return secret.slice(-4);
}

/** Normalized grouping key — must stay in lockstep with the web's
 *  hostOf() in apps/web/app/console/_lib.ts (same rule, two runtimes). */
export function normalizeHost(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  }
}

export type Workspace = typeof schema.siteWorkspaces.$inferSelect;

/** Owner-scoped lookup — the WHERE user_id is the isolation boundary. */
export async function getWorkspaceForUser(
  userId: string,
  workspaceId: string,
): Promise<Workspace | null> {
  const [ws] = await db
    .select()
    .from(schema.siteWorkspaces)
    .where(
      and(
        eq(schema.siteWorkspaces.id, workspaceId),
        eq(schema.siteWorkspaces.userId, userId),
      ),
    );
  return ws ?? null;
}

/** Auto-link helper — the user's workspace matching a scan URL host. */
export async function findWorkspaceByHost(
  userId: string,
  url: string,
): Promise<Workspace | null> {
  const [ws] = await db
    .select()
    .from(schema.siteWorkspaces)
    .where(
      and(
        eq(schema.siteWorkspaces.userId, userId),
        eq(schema.siteWorkspaces.urlHost, normalizeHost(url)),
      ),
    );
  return ws ?? null;
}

/** Resolve a public site key to its workspace (beacon path). */
export async function findWorkspaceBySiteKey(
  siteKey: string,
): Promise<Workspace | null> {
  const [ws] = await db
    .select()
    .from(schema.siteWorkspaces)
    .where(eq(schema.siteWorkspaces.siteKey, siteKey));
  return ws ?? null;
}

/** Resolve an S2S secret to its workspace (hash, then indexed lookup —
 *  no plaintext comparison against stored values). */
export async function findWorkspaceBySecret(
  secret: string,
): Promise<Workspace | null> {
  if (!secret.startsWith(SECRET_PREFIX)) return null;
  const [ws] = await db
    .select()
    .from(schema.siteWorkspaces)
    .where(eq(schema.siteWorkspaces.secretHash, hashSecret(secret)));
  return ws ?? null;
}

/** Touch last_event_at (TRACKED-tier flag + settings "Last event"). */
export async function touchWorkspaceEvent(workspaceId: string): Promise<void> {
  await db
    .update(schema.siteWorkspaces)
    .set({ lastEventAt: new Date() })
    .where(eq(schema.siteWorkspaces.id, workspaceId));
}
