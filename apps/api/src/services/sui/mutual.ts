// Mutual-sealed campaign lifecycle (design doc v0.4 §4.5).
//
// Two-way sealed exchange: a company seals a pre-release asset (company →
// persona) and the persona seals its session evidence (persona → company).
// True atomicity is impossible across the asymmetric reveal, so an
// escrow-backed STATE MACHINE plus a slashable stake stand in for it
// (§4.5.3). This module is the product-facing wiring over the on-chain
// rpm::mutual module + the off-chain mirror in mutual_campaigns.
//
// What's REAL here: the state machine (the source of truth) and the
// Seal-encrypt → Walrus sealing of the asset/evidence blobs (when Seal +
// the package are configured). What's DEFERRED: minting the on-chain
// rpm::mutual::MutualCampaign object — like a scan report (anchor.ts), that
// needs a funded reward Coin and is gated behind MUTUAL_ONCHAIN_ENABLED.
// The PTB builders already exist (tx.ts buildCreateMutual/…); flipping the
// flag is the future slice, not new Move work.

import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { env } from '../../config/env.js';
import { sealEncryptAndStore } from '../seal.js';
import { getSuiClient, getSuiSigner, requirePackageId } from './client.js';
import { toSealHexId } from './anchor.js';
import { buildCreateMutualFromGas } from './tx.js';
import { childLogger } from '../../logger.js';

const log = childLogger({ svc: 'sui.mutual' });

// ─── State machine (§4.5.2) — pure core, exhaustively unit-tested ────

export const MUTUAL_STATES = [
  'asset_sealed',
  'persona_opted_in',
  'asset_revealed',
  'evidence_committed',
  'evidence_revealed',
  'settled',
  'aborted',
] as const;
export type MutualState = (typeof MUTUAL_STATES)[number];

export const MUTUAL_ACTIONS = [
  'opt_in',
  'reveal_asset',
  'commit_evidence',
  'reveal_evidence',
  'settle',
  'slash',
] as const;
export type MutualAction = (typeof MUTUAL_ACTIONS)[number];

/** action → { allowed current states, resulting state }. Mirrors the Move
 *  module's asserts exactly (mutual.move): slash is reachable from any
 *  post-opt-in, pre-settle state; every other action is single-edge. */
const TRANSITIONS: Record<MutualAction, { from: readonly MutualState[]; to: MutualState }> = {
  opt_in: { from: ['asset_sealed'], to: 'persona_opted_in' },
  reveal_asset: { from: ['persona_opted_in'], to: 'asset_revealed' },
  commit_evidence: { from: ['asset_revealed'], to: 'evidence_committed' },
  reveal_evidence: { from: ['evidence_committed'], to: 'evidence_revealed' },
  settle: { from: ['evidence_revealed'], to: 'settled' },
  slash: {
    from: ['persona_opted_in', 'asset_revealed', 'evidence_committed'],
    to: 'aborted',
  },
};

/** Who may invoke each action: the requester (company, cap-holder) or the
 *  bound persona. Enforced in the route against the authed user. */
export const ACTION_ACTOR: Record<MutualAction, 'requester' | 'persona'> = {
  opt_in: 'persona', // the opting-in user *becomes* the persona
  reveal_asset: 'persona',
  commit_evidence: 'persona',
  reveal_evidence: 'requester',
  settle: 'requester',
  slash: 'requester',
};

export class MutualStateError extends Error {
  constructor(
    public action: MutualAction,
    public current: MutualState,
  ) {
    super(`mutual: cannot ${action} from ${current}`);
    this.name = 'MutualStateError';
  }
}

/** Pure: validate the transition and return the next state. Throws
 *  MutualStateError when `action` is not allowed from `current`. */
export function nextState(current: MutualState, action: MutualAction): MutualState {
  const t = TRANSITIONS[action];
  if (!t || !t.from.includes(current)) throw new MutualStateError(action, current);
  return t.to;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─── Sealing (real when configured, null otherwise) ──────────────────

export type SealResult = { blobId: string; sealId: string } | null;

/**
 * Seal-encrypt `data` to the campaign's Seal policy namespace and store the
 * ciphertext on Walrus. Best-effort: when Seal/Walrus or the package are
 * unconfigured (sealEncryptAndStore throws), returns null and the caller
 * records an unsealed reference (hash only) — the UI hides the Walrus link.
 * `sealNamespaceId` is the campaign id; encoded to hex for Seal's id field.
 */
export async function sealPayload(
  sealNamespaceId: string,
  data: Uint8Array,
): Promise<SealResult> {
  try {
    const packageId = requirePackageId();
    const sealId = toSealHexId(sealNamespaceId);
    const { blobId } = await sealEncryptAndStore({ packageId, id: sealId, data });
    return { blobId, sealId };
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'seal skipped (Seal/package unconfigured)');
    return null;
  }
}

// ─── Create + advance (injectable deps for unit tests) ───────────────

export type MutualRow = typeof schema.mutualCampaigns.$inferSelect;

export type CreateInput = {
  requesterUserId: string;
  title: string;
  description?: string | null;
  /** Plaintext asset bytes — sealed here, never persisted in the clear. */
  asset: Uint8Array;
  sandboxOnly: boolean;
  rewardAmount: bigint;
  stakeAmount: bigint;
};

/** On-chain mint args (only used when MUTUAL_ONCHAIN_ENABLED). */
export type MintArgs = {
  rewardAmount: bigint;
  assetBlobRef: string;
  assetHash: string;
  assetSealPolicy: string;
  sandboxOnly: boolean;
};
export type MintResult = { suiObjectId: string; suiCapId: string | null } | null;

export type CreateDeps = {
  seal: (sealNamespaceId: string, data: Uint8Array) => Promise<SealResult>;
  insert: (row: typeof schema.mutualCampaigns.$inferInsert) => Promise<MutualRow>;
  /** Operator-signed on-chain mint of the rpm::mutual::MutualCampaign. Called
   *  ONLY when MUTUAL_ONCHAIN_ENABLED; best-effort (createMutualCampaign
   *  swallows its errors so a chain hiccup never blocks the off-chain seal,
   *  same non-fatal contract as scan-report anchoring). */
  mintOnChain: (args: MintArgs) => Promise<MintResult>;
};

/** Default on-chain mint: split the reward from gas, create the campaign,
 *  send the cap to the operator, and pull both object ids out of the tx.
 *  LIVE-UNVERIFIED end to end (needs a funded operator wallet + a published
 *  package); gated off by default — same honesty status as the USDC sign
 *  path. The PTB builder + extraction are unit-tested; a real mint is the
 *  scripts/mint-mutual-onchain.ts one-off. */
export async function defaultMintOnChain(args: MintArgs): Promise<MintResult> {
  const packageId = requirePackageId();
  const signer = getSuiSigner();
  const operator = signer.toSuiAddress();
  const tx = buildCreateMutualFromGas(
    packageId,
    args.rewardAmount,
    args.assetBlobRef,
    args.assetHash,
    args.assetSealPolicy,
    args.sandboxOnly,
    operator,
  );
  const client = getSuiClient();
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showObjectChanges: true, showEffects: true },
  });
  await client.waitForTransaction({ digest: result.digest });
  return extractMutualIds(result.objectChanges);
}

type MutualObjectChange = { type: string; objectType?: string; objectId?: string };

/** Pure: pull the shared MutualCampaign id + the MutualOwnerCap id out of a
 *  create tx's objectChanges. Exported for unit tests. */
export function extractMutualIds(
  objectChanges: MutualObjectChange[] | null | undefined,
): MintResult {
  const created = (objectChanges ?? []).filter((c) => c.type === 'created');
  const campaign = created.find((c) => c.objectType?.includes('::mutual::MutualCampaign'))?.objectId;
  const cap = created.find((c) => c.objectType?.includes('::mutual::MutualOwnerCap'))?.objectId;
  return campaign ? { suiObjectId: campaign, suiCapId: cap ?? null } : null;
}

export function defaultCreateDeps(): CreateDeps {
  return {
    seal: sealPayload,
    insert: async (row) => {
      const [created] = await db.insert(schema.mutualCampaigns).values(row).returning();
      return created;
    },
    mintOnChain: defaultMintOnChain,
  };
}

/**
 * Create a mutual-sealed campaign: hash + Seal-encrypt the asset → Walrus,
 * persist the row in state `asset_sealed`. The id is generated up-front so
 * it can namespace the Seal policy before the insert. No Sui mint — that's
 * the MUTUAL_ONCHAIN_ENABLED follow-up (needs a funded reward Coin, §4.5).
 */
export async function createMutualCampaign(
  input: CreateInput,
  deps: CreateDeps = defaultCreateDeps(),
): Promise<MutualRow> {
  const id = randomUUID();
  const assetHash = sha256Hex(input.asset);
  const sealed = await deps.seal(id, input.asset);

  // Optional on-chain anchor — best-effort + non-fatal (a chain failure must
  // never block the off-chain seal, which IS the real artifact). Gated off by
  // default; same honesty contract as scan-report anchoring.
  let onchain: MintResult = null;
  if (env.MUTUAL_ONCHAIN_ENABLED) {
    try {
      onchain = await deps.mintOnChain({
        rewardAmount: input.rewardAmount,
        assetBlobRef: sealed?.blobId ?? '',
        assetHash,
        assetSealPolicy: sealed?.sealId ?? '',
        sandboxOnly: input.sandboxOnly,
      });
    } catch (err) {
      log.warn({ mutualId: id, err: (err as Error).message }, 'mutual on-chain mint failed (non-fatal)');
    }
  }

  const row = await deps.insert({
    id,
    requesterUserId: input.requesterUserId,
    title: input.title,
    description: input.description ?? null,
    assetHash,
    assetBlobId: sealed?.blobId ?? null,
    assetSealId: sealed?.sealId ?? null,
    assetSandboxOnly: input.sandboxOnly,
    rewardAmount: input.rewardAmount,
    stakeAmount: input.stakeAmount,
    state: 'asset_sealed',
    suiObjectId: onchain?.suiObjectId ?? null,
    suiCapId: onchain?.suiCapId ?? null,
  });
  log.info(
    { mutualId: id, sealed: sealed != null, onchain: onchain != null },
    'mutual campaign created',
  );
  return row;
}

export type AdvanceOpts = {
  /** opt_in: the user becoming the bound persona. */
  personaUserId?: string;
  /** commit_evidence: plaintext evidence bytes — sealed here. */
  evidence?: Uint8Array;
};

export type AdvanceDeps = {
  load: (id: string) => Promise<MutualRow | null>;
  seal: (sealNamespaceId: string, data: Uint8Array) => Promise<SealResult>;
  persist: (
    id: string,
    patch: Partial<typeof schema.mutualCampaigns.$inferInsert>,
  ) => Promise<MutualRow>;
};

export function defaultAdvanceDeps(): AdvanceDeps {
  return {
    load: async (id) => {
      const [row] = await db
        .select()
        .from(schema.mutualCampaigns)
        .where(eq(schema.mutualCampaigns.id, id))
        .limit(1);
      return row ?? null;
    },
    seal: sealPayload,
    persist: async (id, patch) => {
      const [row] = await db
        .update(schema.mutualCampaigns)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.mutualCampaigns.id, id))
        .returning();
      return row;
    },
  };
}

export class MutualNotFound extends Error {
  constructor(public id: string) {
    super(`mutual campaign ${id} not found`);
    this.name = 'MutualNotFound';
  }
}

/**
 * Advance a campaign through one state-machine edge. Validates the
 * transition (throws MutualStateError on a bad edge / MutualNotFound on a
 * missing row), applies the action's side effects (opt_in binds the
 * persona; commit_evidence seals the evidence blob; settle stamps
 * settled_at), and persists. Authorization (requester vs persona) is the
 * route's job — this enforces only the STATE contract.
 */
export async function advanceMutual(
  id: string,
  action: MutualAction,
  opts: AdvanceOpts = {},
  deps: AdvanceDeps = defaultAdvanceDeps(),
): Promise<MutualRow> {
  const row = await deps.load(id);
  if (!row) throw new MutualNotFound(id);
  const to = nextState(row.state as MutualState, action);

  const patch: Partial<typeof schema.mutualCampaigns.$inferInsert> = { state: to };

  if (action === 'opt_in') {
    if (!opts.personaUserId) throw new Error('opt_in requires personaUserId');
    patch.personaUserId = opts.personaUserId;
  }
  if (action === 'commit_evidence') {
    if (!opts.evidence) throw new Error('commit_evidence requires evidence bytes');
    patch.evidenceHash = sha256Hex(opts.evidence);
    const sealed = await deps.seal(`${id}:evidence`, opts.evidence);
    patch.evidenceBlobId = sealed?.blobId ?? null;
    patch.evidenceSealId = sealed?.sealId ?? null;
  }
  if (action === 'settle') {
    patch.settledAt = new Date();
  }

  const updated = await deps.persist(id, patch);
  log.info({ mutualId: id, action, state: to }, 'mutual campaign advanced');
  return updated;
}
