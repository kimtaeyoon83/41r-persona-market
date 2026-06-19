// Sui client + signer wiring (design doc v0.4 §0.1 chain transition).
//
// Mirrors the Solana keypair/RPC env pattern. Off-chain entry point for
// the rpm Move package (packages/sui-move). Lazily constructed so the
// API boots fine without Sui configured during the staged migration —
// only code paths that actually touch Sui require the env to be set.

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { env } from '../../config/env.js';

let cachedClient: SuiJsonRpcClient | null = null;

/** Shared read/write client against SUI_RPC_URL (default testnet).
 *  @mysten/sui v2 renamed SuiClient → SuiJsonRpcClient. */
export function getSuiClient(): SuiJsonRpcClient {
  if (!cachedClient) {
    cachedClient = new SuiJsonRpcClient({
      url: env.SUI_RPC_URL,
      network: env.SUI_NETWORK,
    });
  }
  return cachedClient;
}

/**
 * Operator signer from SUI_KEYPAIR_JSON (bech32 `suiprivkey1...`).
 * Throws when unset — callers that sign must guard on configuration.
 */
export function getSuiSigner(): Ed25519Keypair {
  if (!env.SUI_KEYPAIR_JSON) {
    throw new Error('SUI_KEYPAIR_JSON is not set');
  }
  return Ed25519Keypair.fromSecretKey(env.SUI_KEYPAIR_JSON);
}

/**
 * Published package id of the rpm Move package. Set after running
 * scripts/sui-publish.ts. Throws when unset (PTBs need it to target the
 * right module).
 */
export function requirePackageId(): string {
  if (!env.SUI_PACKAGE_ID) {
    throw new Error(
      'SUI_PACKAGE_ID is not set — publish the rpm Move package first (scripts/sui-publish.ts)',
    );
  }
  return env.SUI_PACKAGE_ID;
}
