// Team workspaces (2026-06-22) — read-only sharing of a site's analyses.
//
// A site_workspace is owned by one user; its owner invites teammates by email.
// Each invite is a site_members row (user_id=null until the invitee logs in,
// then claimed by email — same pattern as partner-row claiming). A member's
// access is READ-ONLY: the console GET routes accept owner OR member; every
// mutation stays owner-only.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type WorkspaceRole = 'owner' | 'viewer';

export type SiteMemberView = {
  id: string;
  email: string;
  user_id: string | null;
  role: string;
  /** pending = invited but not yet logged in / claimed. */
  status: 'pending' | 'active';
  created_at: Date;
};

const normEmail = (e: string) => e.trim().toLowerCase();

/** Members of a workspace (owner-facing list). */
export async function listMembers(workspaceId: string): Promise<SiteMemberView[]> {
  const rows = await db
    .select()
    .from(schema.siteMembers)
    .where(eq(schema.siteMembers.workspaceId, workspaceId))
    .orderBy(schema.siteMembers.createdAt);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    user_id: r.userId,
    role: r.role,
    status: r.userId ? 'active' : 'pending',
    created_at: r.createdAt,
  }));
}

/** Invite a teammate by email. Links an existing user immediately so they see
 *  the share without re-login; otherwise it's claimed on their first login.
 *  Idempotent per (workspace, email). */
export async function inviteMember(
  workspaceId: string,
  email: string,
  invitedBy: string,
): Promise<{ created: boolean }> {
  const e = normEmail(email);
  const [u] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, e))
    .limit(1);
  const res = await db
    .insert(schema.siteMembers)
    .values({ workspaceId, email: e, userId: u?.id ?? null, role: 'viewer', invitedBy })
    .onConflictDoNothing()
    .returning({ id: schema.siteMembers.id });
  return { created: res.length > 0 };
}

/** Remove a member from a workspace (owner action). */
export async function removeMember(workspaceId: string, memberId: string): Promise<boolean> {
  const res = await db
    .delete(schema.siteMembers)
    .where(
      and(eq(schema.siteMembers.id, memberId), eq(schema.siteMembers.workspaceId, workspaceId)),
    )
    .returning({ id: schema.siteMembers.id });
  return res.length > 0;
}

/** Claim pending invites for a freshly-logged-in user (by email). Non-fatal —
 *  mirrors claimPartnerRows; never blocks login. */
export async function claimMemberships(userId: string, email: string): Promise<void> {
  const e = normEmail(email);
  await db
    .update(schema.siteMembers)
    .set({ userId })
    .where(and(eq(sql`lower(${schema.siteMembers.email})`, e), isNull(schema.siteMembers.userId)));
}

/** Workspace ids shared WITH this user (claimed memberships). */
export async function memberWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ wid: schema.siteMembers.workspaceId })
    .from(schema.siteMembers)
    .where(eq(schema.siteMembers.userId, userId));
  return rows.map((r) => r.wid);
}

/** The user's role on a workspace, or null if no access. Owner wins. */
export async function workspaceRole(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const [ws] = await db
    .select({ owner: schema.siteWorkspaces.userId })
    .from(schema.siteWorkspaces)
    .where(eq(schema.siteWorkspaces.id, workspaceId))
    .limit(1);
  if (!ws) return null;
  if (ws.owner === userId) return 'owner';
  const [m] = await db
    .select({ id: schema.siteMembers.id })
    .from(schema.siteMembers)
    .where(
      and(eq(schema.siteMembers.workspaceId, workspaceId), eq(schema.siteMembers.userId, userId)),
    )
    .limit(1);
  return m ? 'viewer' : null;
}
