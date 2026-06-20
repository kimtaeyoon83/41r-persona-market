// /api/mutual — Mutual-sealed campaigns (design doc v0.4 §4.5).
//
// The product face of rpm::mutual: a company seals a pre-release asset, a
// persona owner opts in + seals session evidence, and an escrow-backed
// state machine (services/sui/mutual.ts) drives the two-way reveal. Every
// route is requirePrivyAuth; access is scoped to the requester (company)
// or the bound persona — the same isolation contract as routes/console.ts.
//
// Asset/evidence bytes are Seal-encrypted before they ever touch the DB
// (sealPayload); only the ciphertext blob ref + a sha256 integrity hash are
// stored. The plaintext is never persisted.

import { Router, type Router as RouterType, type Request, type Response } from 'express';
import { desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requirePrivyAuth } from '../middleware/privy_auth.js';
import { mutationLimiter } from '../middleware/rate_limit.js';
import { walrusBlobUrl } from '../services/walrus.js';
import {
  createMutualCampaign,
  advanceMutual,
  ACTION_ACTOR,
  MutualStateError,
  MutualNotFound,
  type MutualAction,
  type MutualRow,
} from '../services/sui/mutual.js';

const router: RouterType = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Asset / evidence arrive base64-encoded (a pre-release file or session
// trace). Cap at ~256KB decoded so a single request can't blow the 10mb
// json body limit; large assets are a follow-up (direct Walrus upload).
const MAX_PAYLOAD_B64 = 350_000;

const createBody = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  /** base64 of the plaintext asset bytes. */
  asset_base64: z.string().min(1).max(MAX_PAYLOAD_B64),
  sandbox_only: z.boolean().optional(),
  /** Reward + stake in base units (SUI MIST / USDC µ); notional off-chain. */
  reward_amount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  stake_amount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});

const commitEvidenceBody = z.object({
  evidence_base64: z.string().min(1).max(MAX_PAYLOAD_B64),
});

/** Client-safe view. Sealed blobs surface only when present (Walrus links
 *  hidden when unsealed — the hidden-when-unanchored honesty pattern). */
function shapeMutual(row: MutualRow, viewerId: string) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    state: row.state,
    role: row.requesterUserId === viewerId ? 'requester' : 'persona',
    is_requester: row.requesterUserId === viewerId,
    persona_opted_in: row.personaUserId != null,
    asset_hash: row.assetHash,
    asset_sandbox_only: row.assetSandboxOnly,
    asset_sealed: row.assetBlobId != null,
    asset_walrus_url: row.assetBlobId ? walrusBlobUrl(row.assetBlobId) : null,
    evidence_sealed: row.evidenceBlobId != null,
    evidence_walrus_url: row.evidenceBlobId ? walrusBlobUrl(row.evidenceBlobId) : null,
    reward_amount: row.rewardAmount.toString(),
    stake_amount: row.stakeAmount.toString(),
    sui_object_id: row.suiObjectId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    settled_at: row.settledAt,
  };
}

function decodeB64(s: string): Uint8Array | null {
  const buf = Buffer.from(s, 'base64');
  // Buffer.from is lenient; reject input that doesn't round-trip (junk).
  if (buf.length === 0 || buf.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '')) {
    return null;
  }
  return new Uint8Array(buf);
}

// ─── Create ──────────────────────────────────────────────────────────
router.post('/', requirePrivyAuth, mutationLimiter, async (req: Request, res: Response) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const asset = decodeB64(parsed.data.asset_base64);
  if (!asset) {
    res.status(400).json({ error: 'invalid_asset_base64' });
    return;
  }
  const row = await createMutualCampaign({
    requesterUserId: req.privyUser!.id,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    asset,
    sandboxOnly: parsed.data.sandbox_only ?? true,
    rewardAmount: BigInt(parsed.data.reward_amount ?? 0),
    stakeAmount: BigInt(parsed.data.stake_amount ?? 0),
  });
  res.status(201).json({ campaign: shapeMutual(row, req.privyUser!.id) });
});

// ─── List mine (as requester or bound persona) ───────────────────────
router.get('/', requirePrivyAuth, async (req: Request, res: Response) => {
  const me = req.privyUser!.id;
  const rows = await db
    .select()
    .from(schema.mutualCampaigns)
    .where(
      or(
        eq(schema.mutualCampaigns.requesterUserId, me),
        eq(schema.mutualCampaigns.personaUserId, me),
      ),
    )
    .orderBy(desc(schema.mutualCampaigns.createdAt))
    .limit(100);
  res.json({ campaigns: rows.map((r) => shapeMutual(r, me)) });
});

// ─── Detail ──────────────────────────────────────────────────────────
// Requester + bound persona always; a not-yet-opted-in campaign is also
// visible to any authed user holding the link (the opt-in invitation —
// the asset is sealed, so only title/terms leak).
router.get('/:id', requirePrivyAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const row = await loadOr404(id, res);
  if (!row) return;
  const me = req.privyUser!.id;
  const isParty = row.requesterUserId === me || row.personaUserId === me;
  const isOpenInvite = row.personaUserId == null && row.state === 'asset_sealed';
  if (!isParty && !isOpenInvite) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  res.json({ campaign: shapeMutual(row, me) });
});

// ─── Lifecycle transitions ───────────────────────────────────────────

// opt-in — the caller becomes the bound persona (must not be the requester).
router.post('/:id/opt-in', requirePrivyAuth, mutationLimiter, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const row = await loadOr404(id, res);
  if (!row) return;
  const me = req.privyUser!.id;
  if (row.requesterUserId === me) {
    res.status(409).json({ error: 'requester_cannot_opt_in' });
    return;
  }
  await runTransition(id, 'opt_in', { personaUserId: me }, row, me, res);
});

// commit-evidence — the bound persona seals its session evidence.
router.post('/:id/commit-evidence', requirePrivyAuth, mutationLimiter, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const parsed = commitEvidenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const evidence = decodeB64(parsed.data.evidence_base64);
  if (!evidence) {
    res.status(400).json({ error: 'invalid_evidence_base64' });
    return;
  }
  const row = await loadOr404(id, res);
  if (!row) return;
  await runTransition(id, 'commit_evidence', { evidence }, row, req.privyUser!.id, res);
});

// The remaining single-edge transitions share one handler factory.
for (const action of ['reveal_asset', 'reveal_evidence', 'settle', 'slash'] as const) {
  const path = `/:id/${action.replace('_', '-')}`;
  router.post(path, requirePrivyAuth, mutationLimiter, async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const row = await loadOr404(id, res);
    if (!row) return;
    await runTransition(id, action, {}, row, req.privyUser!.id, res);
  });
}

// ─── Shared helpers ──────────────────────────────────────────────────

async function loadOr404(id: string, res: Response): Promise<MutualRow | null> {
  const [row] = await db
    .select()
    .from(schema.mutualCampaigns)
    .where(eq(schema.mutualCampaigns.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return row;
}

/** Enforce the requester/persona actor rule, then advance the state
 *  machine. Maps MutualStateError → 409, MutualNotFound → 404. */
async function runTransition(
  id: string,
  action: MutualAction,
  opts: { personaUserId?: string; evidence?: Uint8Array },
  row: MutualRow,
  viewerId: string,
  res: Response,
): Promise<void> {
  // opt_in's actor check is special (any non-requester); the rest bind to a
  // fixed party.
  if (action !== 'opt_in') {
    const actor = ACTION_ACTOR[action];
    const allowed =
      actor === 'requester'
        ? row.requesterUserId === viewerId
        : row.personaUserId === viewerId;
    if (!allowed) {
      res.status(403).json({ error: 'forbidden', required_actor: actor });
      return;
    }
  }

  try {
    const updated = await advanceMutual(id, action, opts);
    res.json({ campaign: shapeMutual(updated, viewerId) });
  } catch (err) {
    if (err instanceof MutualStateError) {
      res.status(409).json({ error: 'invalid_transition', action, state: err.current });
      return;
    }
    if (err instanceof MutualNotFound) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    throw err;
  }
}

export default router;
