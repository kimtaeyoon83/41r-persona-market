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
import { buildMintPersona, buildAddMemwalRef } from './tx.js';
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
