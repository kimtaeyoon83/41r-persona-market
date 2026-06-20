// On-chain anchoring — the bridge that makes Sui/Walrus/Seal real per record.
//
// The chain layer (client/tx/walrus/seal) was testnet-verified but never
// called from a product flow. This module is the missing wiring: it mints the
// rpm::persona object, Seal-encrypts the persona's memory vector, stores the
// ciphertext on Walrus, and links the blob on-chain via add_memwal_ref — the
// canonical design flow (coin-free, operator-signed).
//
// Contract:
//  - operator-signed (getSuiSigner) — objects are operator-owned, no
//    per-persona wallet funding.
//  - idempotent — anchorPersona skips a persona that already has sui_object_id.
//  - callers run it bounded (scripts/anchor-personas.ts --max) or fire-and-
//    forget non-fatal; it must never be looped unbounded (real testnet mints).

import { eq } from 'drizzle-orm';
import type { Transaction } from '@mysten/sui/transactions';
import { db, schema } from '../../db/index.js';
import { getSuiClient, getSuiSigner, requirePackageId } from './client.js';
import { buildMintPersona, buildAddMemwalRef, buildTransferPersona } from './tx.js';
import { sealEncryptAndStore } from '../seal.js';
import { childLogger } from '../../logger.js';

const log = childLogger({ svc: 'sui.anchor' });

/** Suiscan testnet explorer link for an object id. */
export function suiObjectUrl(objectId: string): string {
  return `https://suiscan.xyz/testnet/object/${objectId}`;
}

/** Seal's `id` is the policy identity namespace — it must be a HEX string
 *  (fromHex-parseable), not an arbitrary id. Persona ids are UUIDs (dashes,
 *  non-hex), so encode the id's bytes to hex for a stable, valid namespace. */
export function toSealHexId(personaId: string): string {
  return Buffer.from(personaId, 'utf8').toString('hex');
}

type ObjectChange = { type: string; objectType?: string; objectId?: string };

/**
 * Pure: pull the newly-created object id out of a tx result's objectChanges.
 * Prefers a change whose objectType matches `typeNeedle` (e.g. the Persona
 * type) so a multi-object tx doesn't return a gas/coin object. Falls back to
 * the first `created` change. Returns null if none.
 */
export function extractCreatedObjectId(
  objectChanges: ObjectChange[] | null | undefined,
  typeNeedle?: string,
): string | null {
  const created = (objectChanges ?? []).filter((c) => c.type === 'created');
  const match = typeNeedle
    ? created.find((c) => c.objectType?.includes(typeNeedle))
    : undefined;
  return (match ?? created[0])?.objectId ?? null;
}

/** Sign + execute a built tx with the operator signer; surface digest +
 *  the created object id (if any). Not pure — does network I/O. */
export async function executeTx(
  tx: Transaction,
  opts?: { typeNeedle?: string },
): Promise<{ digest: string; createdObjectId: string | null }> {
  const client = getSuiClient();
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: getSuiSigner(),
    options: { showObjectChanges: true, showEffects: true },
  });
  // Wait until the node has indexed the tx, so objects it created are readable
  // by the NEXT dependent tx (mint → add_memwal_ref read-after-write).
  await client.waitForTransaction({ digest: result.digest });
  return {
    digest: result.digest,
    createdObjectId: extractCreatedObjectId(
      result.objectChanges as ObjectChange[] | null,
      opts?.typeNeedle,
    ),
  };
}

export type AnchorResult =
  | { status: 'skipped'; suiObjectId: string }
  | { status: 'anchored'; suiObjectId: string; walrusBlobId: string; digest: string };

/** Injectable seam so anchorPersona is unit-testable without chain/network. */
export type AnchorDeps = {
  loadPersona: (
    personaId: string,
  ) => Promise<{ suiObjectId: string | null; vector: unknown } | null>;
  encryptStore: (args: { id: string; data: Uint8Array }) => Promise<{ blobId: string }>;
  mint: () => Promise<{ digest: string; createdObjectId: string | null }>;
  addMemwalRef: (personaObjectId: string, blobId: string) => Promise<{ digest: string }>;
  persist: (
    personaId: string,
    fields: { suiObjectId: string; walrusBlobId: string; sealId: string; anchoredAt: Date },
  ) => Promise<void>;
};

/** Real deps wiring the published package + operator signer. */
export function defaultAnchorDeps(): AnchorDeps {
  const packageId = requirePackageId();
  return {
    loadPersona: async (personaId) => {
      const [row] = await db
        .select({ suiObjectId: schema.personas.suiObjectId, vector: schema.personas.vector })
        .from(schema.personas)
        .where(eq(schema.personas.id, personaId))
        .limit(1);
      return row ?? null;
    },
    encryptStore: ({ id, data }) => sealEncryptAndStore({ packageId, id, data }),
    mint: () => executeTx(buildMintPersona(packageId), { typeNeedle: '::persona::Persona' }),
    addMemwalRef: (personaObjectId, blobId) =>
      executeTx(buildAddMemwalRef(packageId, personaObjectId, blobId)),
    persist: async (personaId, fields) => {
      await db
        .update(schema.personas)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.personas.id, personaId));
    },
  };
}

/**
 * Anchor one persona on-chain: Seal-encrypt its vector → Walrus → mint the
 * Persona object → add_memwal_ref(blob) → persist the ids. Idempotent: returns
 * { skipped } when sui_object_id is already set. Order is mint-after-store so
 * the blob id exists before it's linked on-chain.
 */
export async function anchorPersona(
  personaId: string,
  deps: AnchorDeps = defaultAnchorDeps(),
  now: Date = new Date(),
): Promise<AnchorResult> {
  const persona = await deps.loadPersona(personaId);
  if (!persona) throw new Error(`persona ${personaId} not found`);
  if (persona.suiObjectId) {
    return { status: 'skipped', suiObjectId: persona.suiObjectId };
  }

  const data = new TextEncoder().encode(JSON.stringify(persona.vector));
  const sealId = toSealHexId(personaId);
  const { blobId } = await deps.encryptStore({ id: sealId, data });

  const { createdObjectId } = await deps.mint();
  if (!createdObjectId) throw new Error('mint returned no created object id');

  const { digest } = await deps.addMemwalRef(createdObjectId, blobId);

  await deps.persist(personaId, {
    suiObjectId: createdObjectId,
    walrusBlobId: blobId,
    sealId,
    anchoredAt: now,
  });

  log.info({ personaId, suiObjectId: createdObjectId, blobId }, 'persona anchored on-chain');
  return { status: 'anchored', suiObjectId: createdObjectId, walrusBlobId: blobId, digest };
}

// ─── Scan report anchor (Walrus + Seal, Phase 2) ─────────────────────
// Unlike personas, a scan report is NOT minted as a Sui object (scan ≈
// Campaign would need an escrow coin — deferred). The honest scan-level
// artifact is the Seal-encrypted report blob on Walrus, a tamper-evident
// snapshot of the AI verdict. Called fire-and-forget at scan completion.

export type ScanReportAnchorResult =
  | { status: 'skipped'; walrusBlobId: string }
  | { status: 'anchored'; walrusBlobId: string };

/** Compact, stable report snapshot — what gets sealed + stored. */
export function buildScanReportPayload(scan: typeof schema.audienceFitScans.$inferSelect) {
  return {
    scan_id: scan.id,
    target_url: scan.targetUrl,
    mode: scan.mode,
    category: scan.category,
    one_line_pitch: scan.oneLinePitch,
    audience_fit_score: scan.audienceFitScore,
    best_cohort_id: scan.bestCohortId,
    best_cohort_score: scan.bestCohortScore,
    worst_cohort_id: scan.worstCohortId,
    worst_cohort_score: scan.worstCohortScore,
    median_cohort_score: scan.medianCohortScore,
    personas_completed: scan.personasCompleted,
    mode_b_verdict: scan.modeBVerdict,
    completed_at: scan.completedAt ? scan.completedAt.toISOString() : null,
  };
}

export type ScanAnchorDeps = {
  loadScan: (
    scanId: string,
  ) => Promise<{ reportWalrusBlobId: string | null; payload: unknown } | null>;
  encryptStore: (args: { id: string; data: Uint8Array }) => Promise<{ blobId: string }>;
  persist: (
    scanId: string,
    fields: { reportWalrusBlobId: string; reportSealId: string; reportAnchoredAt: Date },
  ) => Promise<void>;
};

export function defaultScanAnchorDeps(): ScanAnchorDeps {
  const packageId = requirePackageId();
  return {
    loadScan: async (scanId) => {
      const [row] = await db
        .select()
        .from(schema.audienceFitScans)
        .where(eq(schema.audienceFitScans.id, scanId))
        .limit(1);
      if (!row) return null;
      return { reportWalrusBlobId: row.reportWalrusBlobId, payload: buildScanReportPayload(row) };
    },
    encryptStore: ({ id, data }) => sealEncryptAndStore({ packageId, id, data }),
    persist: async (scanId, fields) => {
      await db
        .update(schema.audienceFitScans)
        .set(fields)
        .where(eq(schema.audienceFitScans.id, scanId));
    },
  };
}

/**
 * Anchor a completed scan's report: Seal-encrypt the report snapshot →
 * Walrus → persist the blob id. Idempotent (skips when already anchored).
 * No Sui mint — Walrus+Seal only. Throws on failure; callers run it
 * fire-and-forget so it never blocks scan completion.
 */
export async function anchorScanReport(
  scanId: string,
  deps: ScanAnchorDeps = defaultScanAnchorDeps(),
  now: Date = new Date(),
): Promise<ScanReportAnchorResult> {
  const scan = await deps.loadScan(scanId);
  if (!scan) throw new Error(`scan ${scanId} not found`);
  if (scan.reportWalrusBlobId) {
    return { status: 'skipped', walrusBlobId: scan.reportWalrusBlobId };
  }

  const data = new TextEncoder().encode(JSON.stringify(scan.payload));
  const sealId = toSealHexId(scanId);
  const { blobId } = await deps.encryptStore({ id: sealId, data });

  await deps.persist(scanId, {
    reportWalrusBlobId: blobId,
    reportSealId: sealId,
    reportAnchoredAt: now,
  });

  log.info({ scanId, blobId }, 'scan report anchored on-chain (Walrus+Seal)');
  return { status: 'anchored', walrusBlobId: blobId };
}

// ─── Mint-to-user transfer (§4.1 sovereignty) ────────────────────────
// The "소유는 유저" pillar's calling surface: hand an anchored,
// operator-minted persona object to its owner's Sui address via
// persona::transfer_to. The PTB builder (buildTransferPersona) + the Move
// entry already existed — this is the missing wiring that actually invokes
// them per record and records the handover. Operator-signed (the operator
// currently owns the object, so only it can transfer). Bounded + idempotent,
// run via scripts/transfer-personas.ts.

/** A valid Sui address: 0x + 64 hex (same shape escrow respondents use). */
const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

export function isSuiAddress(addr: string): boolean {
  return SUI_ADDRESS_RE.test(addr);
}

export type TransferResult =
  | { status: 'skipped'; reason: string }
  | { status: 'transferred'; suiObjectId: string; recipient: string; digest: string };

export type TransferDeps = {
  loadPersona: (
    personaId: string,
  ) => Promise<{ suiObjectId: string | null; transferredTo: string | null } | null>;
  transfer: (
    personaObjectId: string,
    recipient: string,
  ) => Promise<{ digest: string }>;
  persist: (
    personaId: string,
    fields: { transferredTo: string; transferredAt: Date },
  ) => Promise<void>;
};

export function defaultTransferDeps(): TransferDeps {
  const packageId = requirePackageId();
  return {
    loadPersona: async (personaId) => {
      const [row] = await db
        .select({
          suiObjectId: schema.personas.suiObjectId,
          transferredTo: schema.personas.transferredTo,
        })
        .from(schema.personas)
        .where(eq(schema.personas.id, personaId))
        .limit(1);
      return row ?? null;
    },
    transfer: (personaObjectId, recipient) =>
      executeTx(buildTransferPersona(packageId, personaObjectId, recipient)),
    persist: async (personaId, fields) => {
      await db
        .update(schema.personas)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.personas.id, personaId));
    },
  };
}

/**
 * Transfer an anchored persona to `recipient` (its owner's Sui address).
 * Guards: persona must exist + be anchored (a transfer needs an on-chain
 * object); recipient must be a valid Sui address. Idempotent: returns
 * { skipped } when already transferred (records the prior recipient when it
 * matches, errors on a conflicting recipient so a re-target is explicit).
 * Operator-signed via executeTx.
 */
export async function transferPersonaToUser(
  personaId: string,
  recipient: string,
  deps: TransferDeps = defaultTransferDeps(),
  now: Date = new Date(),
): Promise<TransferResult> {
  if (!isSuiAddress(recipient)) {
    return { status: 'skipped', reason: 'invalid_recipient' };
  }
  const persona = await deps.loadPersona(personaId);
  if (!persona) throw new Error(`persona ${personaId} not found`);
  if (!persona.suiObjectId) {
    return { status: 'skipped', reason: 'not_anchored' };
  }
  if (persona.transferredTo) {
    // Already handed over. Re-running with the same recipient is a no-op;
    // a DIFFERENT recipient is a caller error (the object is no longer
    // operator-owned, so a re-transfer would fail on-chain anyway).
    if (persona.transferredTo === recipient) {
      return { status: 'skipped', reason: 'already_transferred' };
    }
    throw new Error(
      `persona ${personaId} already transferred to ${persona.transferredTo}`,
    );
  }

  const { digest } = await deps.transfer(persona.suiObjectId, recipient);
  await deps.persist(personaId, { transferredTo: recipient, transferredAt: now });

  log.info({ personaId, suiObjectId: persona.suiObjectId, recipient }, 'persona transferred to user');
  return { status: 'transferred', suiObjectId: persona.suiObjectId, recipient, digest };
}
