// Site-workspace service (Console Sprint 2 — console-ia-redesign.md §1, §7).
//
// Key model (§3.3, two tiers — never confuse them):
//   site key   rpm_pk_…  public, beacon routing only, no read access
//   secret     rpm_sk_…  S2S + HMAC handoff signing, hash stored only,
//                        plaintext returned exactly once at issue/rotate
// Neither key grants read access — reads are Privy-session-only, so a
// leaked key's blast radius is "fake data injection", never exfiltration.

import { createHash, randomBytes } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { encryptSecret, decryptSecret } from './crypto_box.js';

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

/** Unscoped id lookup — for system paths that already hold a verified
 *  reference (e.g. handoff-token verification), NOT user requests. */
export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const [ws] = await db
    .select()
    .from(schema.siteWorkspaces)
    .where(eq(schema.siteWorkspaces.id, id));
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

/**
 * Resolve the workspace's anchor scan — the canonical analysis partner
 * surveys attach to. Returns the pinned `anchor_scan_id` when set;
 * otherwise falls back to the latest completed scan linked to this
 * workspace and lazily pins it (so the first analysis becomes the stable
 * anchor even for workspaces created before this column existed).
 * Returns null when the site has never been scanned — the caller turns
 * that into a "run a scan first" response.
 */
export async function resolveAnchorScanId(ws: Workspace): Promise<string | null> {
  if (ws.anchorScanId) return ws.anchorScanId;
  const [latest] = await db
    .select({ id: schema.audienceFitScans.id })
    .from(schema.audienceFitScans)
    .where(
      and(
        eq(schema.audienceFitScans.workspaceId, ws.id),
        eq(schema.audienceFitScans.status, 'completed'),
      ),
    )
    .orderBy(desc(schema.audienceFitScans.completedAt))
    .limit(1);
  if (!latest) return null;
  await db
    .update(schema.siteWorkspaces)
    .set({ anchorScanId: latest.id })
    .where(
      and(
        eq(schema.siteWorkspaces.id, ws.id),
        isNull(schema.siteWorkspaces.anchorScanId),
      ),
    );
  return latest.id;
}

/**
 * Pin a freshly-completed scan as its workspace's anchor, but only when
 * the workspace has none yet (first analysis wins, stays stable across
 * re-scans). One statement: the subquery resolves the scan's workspace,
 * the IS NULL guard makes it idempotent and no-op for unlinked scans.
 * Never throws (called from the pipeline completion path).
 */
export async function setWorkspaceAnchorFromScan(scanId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE site_workspaces
         SET anchor_scan_id = ${scanId}
       WHERE id = (SELECT workspace_id FROM audience_fit_scans WHERE id = ${scanId})
         AND anchor_scan_id IS NULL`);
  } catch {
    // non-fatal: a scan completing must never fail on anchor bookkeeping
  }
}

/**
 * Store an encrypted auth session (Playwright storageState JSON) for a
 * workspace, optionally with the key screens to capture. The plaintext
 * is encrypted with crypto_box and never persisted raw. Validates the
 * storageState is JSON before storing so a paste error fails loudly.
 */
export async function setWorkspaceAuthSession(
  workspaceId: string,
  storageStateJson: string,
  capturePaths?: string[] | null,
  captureMobile?: boolean,
): Promise<void> {
  // Sanity-check it parses (storageState is { cookies, origins }).
  const parsed = JSON.parse(storageStateJson) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('storage_state must be a JSON object');
  }
  await db
    .update(schema.siteWorkspaces)
    .set({
      authSessionEnc: encryptSecret(storageStateJson),
      authSessionUpdatedAt: new Date(),
      ...(capturePaths !== undefined
        ? { capturePaths: capturePaths && capturePaths.length ? capturePaths : null }
        : {}),
      ...(captureMobile !== undefined ? { captureMobile } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.siteWorkspaces.id, workspaceId));
}

/** Clear a workspace's stored auth session (capture_paths kept). */
export async function clearWorkspaceAuthSession(workspaceId: string): Promise<void> {
  await db
    .update(schema.siteWorkspaces)
    .set({ authSessionEnc: null, authSessionUpdatedAt: null, updatedAt: new Date() })
    .where(eq(schema.siteWorkspaces.id, workspaceId));
}

/** Decrypt + parse a workspace's auth session into a Playwright
 *  storageState object. Returns null when none stored or undecryptable
 *  (key rotated / corrupt) — capture then runs anonymously. */
export function getWorkspaceAuthState(ws: Workspace): unknown | null {
  if (!ws.authSessionEnc) return null;
  const plain = decryptSecret(ws.authSessionEnc);
  if (!plain) return null;
  try {
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

/** Touch last_event_at (TRACKED-tier flag + settings "Last event"). */
export async function touchWorkspaceEvent(workspaceId: string): Promise<void> {
  await db
    .update(schema.siteWorkspaces)
    .set({ lastEventAt: new Date() })
    .where(eq(schema.siteWorkspaces.id, workspaceId));
}
