// Seal threshold-encryption gating (design doc v0.4 §4.4, §6.3).
//
// Seal encrypts to an identity-based `id` under a `packageId` whose Move
// module defines the access policy (a `seal_approve*` function). A t-of-n
// committee of key servers releases decryption shares only when the
// on-chain policy is satisfied — "결제한 주소만 복호화" without a central
// intermediary.
//
// This module is the encrypt-before-Walrus-put bridge (§4.2 warns Walrus
// is public-by-default, so sensitive bytes must be Seal-encrypted first).
//
// ⚠️ RESIDUAL TRUST (§6.3): the key-server committee + threshold is a
// trust decision deliberately left to config (SEAL_KEY_SERVER_IDS /
// SEAL_THRESHOLD) — no provider set is hardcoded here. Decryption (which
// needs a SessionKey + a seal_approve PTB) and the Move policy module are
// the NEXT slice; this ships encrypt + storage composition.

import { SealClient } from '@mysten/seal';
import { env } from '../config/env.js';
import { getSuiClient } from './sui/client.js';
import { putBlob } from './walrus.js';

export type SealServerConfig = { objectId: string; weight: number };

export type SealConfig = {
  serverConfigs: SealServerConfig[];
  threshold: number;
};

/** Parse the committee from env. Pure — exported for tests. Each key
 *  server gets weight 1; threshold is how many must cooperate. */
export function parseSealConfig(
  idsCsv: string | undefined,
  threshold: number,
): SealConfig {
  const serverConfigs = (idsCsv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((objectId) => ({ objectId, weight: 1 }));
  return { serverConfigs, threshold };
}

export function getSealConfig(): SealConfig {
  return parseSealConfig(env.SEAL_KEY_SERVER_IDS, env.SEAL_THRESHOLD);
}

let cachedClient: SealClient | null = null;

export function getSealClient(): SealClient {
  if (!cachedClient) {
    const cfg = getSealConfig();
    if (cfg.serverConfigs.length === 0) {
      throw new Error(
        'SEAL_KEY_SERVER_IDS is not set — supply the testnet key-server committee (§6.3 trust decision)',
      );
    }
    cachedClient = new SealClient({
      // SuiClient shape is compatible with Seal's SealCompatibleClient.
      suiClient: getSuiClient() as unknown as ConstructorParameters<
        typeof SealClient
      >[0]['suiClient'],
      serverConfigs: cfg.serverConfigs,
      verifyKeyServers: false,
    });
  }
  return cachedClient;
}

/**
 * Encrypt `data` to identity `id` under `packageId`'s access policy.
 * Returns the BCS-encoded encrypted object bytes.
 */
export async function sealEncrypt(args: {
  packageId: string;
  id: string;
  data: Uint8Array;
}): Promise<Uint8Array> {
  const { threshold } = getSealConfig();
  const { encryptedObject } = await getSealClient().encrypt({
    threshold,
    packageId: args.packageId,
    id: args.id,
    data: args.data,
  });
  return encryptedObject;
}

/**
 * Pure composition: encrypt then store. Injectable deps so the
 * encrypt→put wiring (and ordering) is unit-testable without a key
 * server or Walrus. The ciphertext — never the plaintext — is what
 * reaches Walrus.
 */
export async function encryptAndStore(
  deps: {
    encrypt: (data: Uint8Array) => Promise<Uint8Array>;
    put: (data: Uint8Array) => Promise<{ blobId: string }>;
  },
  data: Uint8Array,
): Promise<{ blobId: string }> {
  const ciphertext = await deps.encrypt(data);
  return deps.put(ciphertext);
}

/** Wire the real Seal + Walrus path: encrypt to policy, store ciphertext,
 *  return the Walrus blobId for Persona.memwal_refs. */
export async function sealEncryptAndStore(args: {
  packageId: string;
  id: string;
  data: Uint8Array;
  epochs?: number;
}): Promise<{ blobId: string }> {
  return encryptAndStore(
    {
      encrypt: (data) =>
        sealEncrypt({ packageId: args.packageId, id: args.id, data }),
      put: (data) => putBlob(data, { epochs: args.epochs }),
    },
    args.data,
  );
}
