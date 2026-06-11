// /api/console — Founder Console workspace CRUD (Console Sprint 2).
//
// Every route is requirePrivyAuth + owner-scoped WHERE user_id — the
// enforced isolation boundary (same contract as routes/me_responses.ts).
// Registration is NOT an ownership claim: any user may register any
// host; uniqueness is per (user, host) only. The secret is returned in
// plaintext exactly once (create / rotate) and stored as sha256.

import { Router, type Router as RouterType } from 'express';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requirePrivyAuth } from '../middleware/privy_auth.js';
import { mutationLimiter } from '../middleware/rate_limit.js';
import {
  generateSecret,
  generateSiteKey,
  getWorkspaceForUser,
  hashSecret,
  normalizeHost,
  secretLast4,
  type Workspace,
} from '../services/workspaces.js';

const router: RouterType = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createBody = z.object({
  url: z.string().min(1).max(500),
  name: z.string().max(120).optional(),
});

const patchBody = z.object({
  url: z.string().min(1).max(500).optional(),
  name: z.string().max(120).nullable().optional(),
});

const linkScanBody = z.object({ scan_id: z.string().uuid() });

function shapeWorkspace(ws: Workspace) {
  return {
    id: ws.id,
    url_host: ws.urlHost,
    name: ws.name,
    site_key: ws.siteKey,
    secret_last4: ws.secretLast4,
    // Emergent tier (§1.2): a beacon has arrived → TRACKED.
    tracked: ws.lastEventAt != null,
    last_event_at: ws.lastEventAt ? ws.lastEventAt.toISOString() : null,
    created_at: ws.createdAt.toISOString(),
  };
}

type ScanRow = typeof schema.audienceFitScans.$inferSelect;

function shapeScan(s: ScanRow) {
  return {
    id: s.id,
    target_url: s.targetUrl,
    category: s.category,
    one_line_pitch: s.oneLinePitch,
    audience_fit_score: s.audienceFitScore,
    best_cohort_id: s.bestCohortId,
    best_cohort_label: null as string | null, // console views render ids; report pages do the label join
    best_cohort_score: s.bestCohortScore,
    mode: s.mode,
    status: s.status,
    personas_completed: s.personasCompleted,
    created_at: s.createdAt.toISOString(),
    completed_at: s.completedAt ? s.completedAt.toISOString() : null,
  };
}

/** Adopt the user's existing unassigned scans whose URL host matches —
 *  a new workspace shouldn't be born empty when its history already
 *  exists. Host matching happens in JS (per-user row counts are small
 *  and normalizeHost has no clean SQL equivalent). */
async function adoptUnassignedScans(
  userId: string,
  workspaceId: string,
  urlHost: string,
): Promise<void> {
  const unassigned = await db
    .select({
      id: schema.audienceFitScans.id,
      targetUrl: schema.audienceFitScans.targetUrl,
    })
    .from(schema.audienceFitScans)
    .where(
      and(
        eq(schema.audienceFitScans.userId, userId),
        isNull(schema.audienceFitScans.workspaceId),
      ),
    );
  const matching = unassigned
    .filter((s) => normalizeHost(s.targetUrl) === urlHost)
    .map((s) => s.id);
  if (matching.length === 0) return;
  await db
    .update(schema.audienceFitScans)
    .set({ workspaceId })
    .where(inArray(schema.audienceFitScans.id, matching));
}

// ─── Create (1-step registration, §7.2 — no verification) ─────────
router.post('/sites', requirePrivyAuth, mutationLimiter, async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const userId = req.privyUser!.id;
  const urlHost = normalizeHost(parsed.data.url);
  if (!urlHost || !urlHost.includes('.')) {
    res.status(400).json({ error: 'invalid_url' });
    return;
  }

  const secret = generateSecret();
  try {
    const [ws] = await db
      .insert(schema.siteWorkspaces)
      .values({
        userId,
        urlHost,
        name: parsed.data.name ?? urlHost,
        siteKey: generateSiteKey(),
        secretHash: hashSecret(secret),
        secretLast4: secretLast4(secret),
      })
      .returning();
    if (!ws) {
      res.status(500).json({ error: 'insert_failed' });
      return;
    }
    await adoptUnassignedScans(userId, ws.id, urlHost);
    res.json({
      workspace: shapeWorkspace(ws),
      /** Shown exactly once — the server only keeps the hash. */
      secret,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('site_workspaces_user_host_uniq')) {
      res.status(409).json({ error: 'already_registered', url_host: urlHost });
      return;
    }
    throw err;
  }
});

// ─── List (+ per-workspace scan stats) ─────────────────────────────
router.get('/sites', requirePrivyAuth, async (req, res) => {
  const userId = req.privyUser!.id;
  const workspaces = await db
    .select()
    .from(schema.siteWorkspaces)
    .where(eq(schema.siteWorkspaces.userId, userId))
    .orderBy(desc(schema.siteWorkspaces.createdAt));

  const ids = workspaces.map((w) => w.id);
  const scans = ids.length
    ? await db
        .select()
        .from(schema.audienceFitScans)
        .where(inArray(schema.audienceFitScans.workspaceId, ids))
        .orderBy(desc(schema.audienceFitScans.createdAt))
    : [];
  const byWs = new Map<string, ScanRow[]>();
  for (const s of scans) {
    if (!s.workspaceId) continue;
    if (!byWs.has(s.workspaceId)) byWs.set(s.workspaceId, []);
    byWs.get(s.workspaceId)!.push(s);
  }

  res.json({
    sites: workspaces.map((ws) => {
      const list = byWs.get(ws.id) ?? [];
      const completed = list.filter(
        (s) => s.status === 'completed' && s.audienceFitScore != null,
      );
      const latest = completed[0] ?? null;
      const prev = completed[1] ?? null;
      return {
        ...shapeWorkspace(ws),
        scan_count: list.length,
        latest_score: latest?.audienceFitScore ?? null,
        prev_score: prev?.audienceFitScore ?? null,
        latest_category: latest?.category ?? null,
        best_cohort_id: latest?.bestCohortId ?? null,
        last_scan_at: list[0]
          ? (list[0].completedAt ?? list[0].createdAt).toISOString()
          : null,
      };
    }),
  });
});

// ─── Detail (workspace + its scans) ────────────────────────────────
router.get('/sites/:id', requirePrivyAuth, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: 'workspace_not_found' });
    return;
  }
  const ws = await getWorkspaceForUser(req.privyUser!.id, id);
  if (!ws) {
    res.status(404).json({ error: 'workspace_not_found' });
    return;
  }
  const scans = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.workspaceId, ws.id))
    .orderBy(desc(schema.audienceFitScans.createdAt))
    .limit(100);
  res.json({ workspace: shapeWorkspace(ws), scans: scans.map(shapeScan) });
});

// ─── Update ────────────────────────────────────────────────────────
router.patch('/sites/:id', requirePrivyAuth, mutationLimiter, async (req, res) => {
  const id = String(req.params.id ?? '');
  const parsed = patchBody.safeParse(req.body);
  if (!UUID_RE.test(id) || !parsed.success) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const ws = await getWorkspaceForUser(req.privyUser!.id, id);
  if (!ws) {
    res.status(404).json({ error: 'workspace_not_found' });
    return;
  }
  const update: Partial<typeof schema.siteWorkspaces.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.url) {
    const host = normalizeHost(parsed.data.url);
    if (!host || !host.includes('.')) {
      res.status(400).json({ error: 'invalid_url' });
      return;
    }
    update.urlHost = host;
  }
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  const [updated] = await db
    .update(schema.siteWorkspaces)
    .set(update)
    .where(eq(schema.siteWorkspaces.id, ws.id))
    .returning();
  res.json({ workspace: shapeWorkspace(updated!) });
});

// ─── Delete (unlink, never destroy scan data — FK SET NULL) ────────
router.delete('/sites/:id', requirePrivyAuth, mutationLimiter, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: 'workspace_not_found' });
    return;
  }
  const ws = await getWorkspaceForUser(req.privyUser!.id, id);
  if (!ws) {
    res.status(404).json({ error: 'workspace_not_found' });
    return;
  }
  await db.delete(schema.siteWorkspaces).where(eq(schema.siteWorkspaces.id, ws.id));
  res.json({ ok: true });
});

// ─── Rotate secret (old key invalid immediately, plaintext once) ───
router.post(
  '/sites/:id/rotate-key',
  requirePrivyAuth,
  mutationLimiter,
  async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: 'workspace_not_found' });
      return;
    }
    const ws = await getWorkspaceForUser(req.privyUser!.id, id);
    if (!ws) {
      res.status(404).json({ error: 'workspace_not_found' });
      return;
    }
    const secret = generateSecret();
    await db
      .update(schema.siteWorkspaces)
      .set({
        secretHash: hashSecret(secret),
        secretLast4: secretLast4(secret),
        updatedAt: new Date(),
      })
      .where(eq(schema.siteWorkspaces.id, ws.id));
    res.json({ ok: true, secret, secret_last4: secretLast4(secret) });
  },
);

// ─── Link an unassigned scan ───────────────────────────────────────
router.post(
  '/sites/:id/link-scan',
  requirePrivyAuth,
  mutationLimiter,
  async (req, res) => {
    const id = String(req.params.id ?? '');
    const parsed = linkScanBody.safeParse(req.body);
    if (!UUID_RE.test(id) || !parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const userId = req.privyUser!.id;
    const ws = await getWorkspaceForUser(userId, id);
    if (!ws) {
      res.status(404).json({ error: 'workspace_not_found' });
      return;
    }
    // Only the user's own scans can be claimed into their workspace.
    const [scan] = await db
      .select()
      .from(schema.audienceFitScans)
      .where(
        and(
          eq(schema.audienceFitScans.id, parsed.data.scan_id),
          eq(schema.audienceFitScans.userId, userId),
        ),
      );
    if (!scan) {
      res.status(404).json({ error: 'scan_not_found' });
      return;
    }
    await db
      .update(schema.audienceFitScans)
      .set({ workspaceId: ws.id })
      .where(eq(schema.audienceFitScans.id, scan.id));
    res.json({ ok: true });
  },
);

export default router;
