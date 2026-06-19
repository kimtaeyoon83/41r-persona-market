// Walrus blob storage client (design doc v0.4 §4.2 MemWal).
//
// Thin HTTP wrapper over the Walrus publisher (PUT) + aggregator (GET).
// Walrus stores content-addressed blobs and returns a `blobId` that the
// on-chain Persona object references (memwal_refs).
//
// ⚠️ Walrus blobs are PUBLIC by default — anyone with the blobId can
// read them (§4.4). Sensitive persona/session data MUST be Seal-
// encrypted BEFORE putBlob; this module deliberately takes/returns raw
// bytes and does not encrypt — that's the caller's (Seal's) job.

import { env } from '../config/env.js';

export type WalrusPutResult = {
  blobId: string;
  /** True when Walrus already had this exact content (dedup). */
  alreadyCertified: boolean;
};

// Walrus publisher returns either a `newlyCreated` or `alreadyCertified`
// envelope. Pure parser, exported for unit tests (no network).
export function parseWalrusPutResponse(json: unknown): WalrusPutResult {
  const j = json as {
    newlyCreated?: { blobObject?: { blobId?: string } };
    alreadyCertified?: { blobId?: string };
  } | null;
  const newlyId = j?.newlyCreated?.blobObject?.blobId;
  const certifiedId = j?.alreadyCertified?.blobId;
  const blobId = newlyId ?? certifiedId;
  if (!blobId) {
    throw new Error('walrus put: no blobId in response');
  }
  return { blobId, alreadyCertified: certifiedId != null && newlyId == null };
}

/** Store bytes in Walrus for `epochs` storage epochs. Returns the blobId. */
export async function putBlob(
  data: Uint8Array,
  opts?: { epochs?: number },
): Promise<WalrusPutResult> {
  const epochs = opts?.epochs ?? env.WALRUS_EPOCHS;
  const url = `${env.WALRUS_PUBLISHER_URL}/v1/blobs?epochs=${epochs}`;
  const res = await fetch(url, {
    method: 'PUT',
    // Uint8Array is a valid BodyInit; wrap in Blob for fetch typing safety.
    body: new Blob([data as BlobPart]),
  });
  if (!res.ok) {
    throw new Error(`walrus put failed: ${res.status} ${res.statusText}`);
  }
  return parseWalrusPutResponse(await res.json());
}

/** Public aggregator URL for a blob id — the same GET getBlob() uses, for
 *  surfacing in the UI so a blob is inspectable (returns Seal ciphertext). */
export function walrusBlobUrl(blobId: string): string {
  return `${env.WALRUS_AGGREGATOR_URL}/v1/blobs/${encodeURIComponent(blobId)}`;
}

/** Fetch a blob's raw bytes by id from the aggregator. */
export async function getBlob(blobId: string): Promise<Uint8Array> {
  const url = `${env.WALRUS_AGGREGATOR_URL}/v1/blobs/${encodeURIComponent(blobId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`walrus get failed: ${res.status} ${res.statusText}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
