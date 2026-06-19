// Privy → Sui wallet bridge (decision 나' — user-custodied keys).
//
// Solana and Sui both use Ed25519. Privy's embedded "Solana" wallet is
// therefore an Ed25519 keypair the USER controls — and the SAME public
// key derives a Sui address. So we keep Privy login (no native Sui
// support needed) while the user holds their own key, preserving the
// design's self-sovereignty pillar (§4.1/§8) that a server-custodied
// wallet would have undermined.
//
// `wallet.address` from Privy's Solana embedded wallet is the base58
// Ed25519 public key. Decoding it and computing the Sui address is
// verified to match the address you'd get from the raw pubkey directly.

import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { messageWithIntent, toSerializedSignature } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
import { blake2b } from "@noble/hashes/blake2.js";
import bs58 from "bs58";
import { suiClient } from "./sui-pay";

/**
 * Derive the user's Sui address (0x…) from their Privy Solana embedded
 * wallet address (a base58 Ed25519 public key). Same key → same owner on
 * both chains; we only ever use the Sui side.
 */
export function deriveSuiAddress(solanaAddressBase58: string): string {
  const pubkeyBytes = bs58.decode(solanaAddressBase58);
  return new Ed25519PublicKey(pubkeyBytes).toSuiAddress();
}

export type SuiTxResult = {
  digest: string;
  campaignObjectId: string | null;
  capId: string | null;
};

/**
 * Sign + execute a Sui tx AS THE USER via Privy's raw Ed25519 signMessage
 * (the design-note path). Sui's Ed25519 scheme signs blake2b256 of the
 * intent message; Privy's Solana signMessage signs raw bytes, so we feed it
 * that digest and re-wrap the 64-byte signature into Sui's serialized form.
 *
 * ⚠️ The blake2b-prehash-vs-Privy-raw-sign behaviour MUST be verified against
 * a live Privy wallet in-browser before trusting this with value. The
 * derivation above is verified; this signing path is not yet (no automated
 * browser session). Errors surface to the caller — the credits path stays the
 * default until a live-verify passes.
 */
export async function signAndExecuteSuiTx(
  tx: Transaction,
  args: {
    solanaAddressBase58: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  },
): Promise<SuiTxResult> {
  const client = suiClient();
  const txBytes = await tx.build({ client });
  const intent = messageWithIntent("TransactionData", txBytes);
  const digest = blake2b(intent, { dkLen: 32 });
  const rawSig = await args.signMessage(digest); // 64-byte ed25519
  const publicKey = new Ed25519PublicKey(bs58.decode(args.solanaAddressBase58));
  const signature = toSerializedSignature({
    signatureScheme: "ED25519",
    signature: rawSig,
    publicKey,
  });
  const res = await client.executeTransactionBlock({
    transactionBlock: txBytes,
    signature,
    options: { showObjectChanges: true, showEffects: true },
  });
  const changes = (res.objectChanges ?? []) as Array<{
    type: string;
    objectType?: string;
    objectId?: string;
  }>;
  const created = (needle: string) =>
    changes.find((c) => c.type === "created" && c.objectType?.includes(needle))?.objectId ?? null;
  return {
    digest: res.digest,
    campaignObjectId: created("::campaign::Campaign<"),
    capId: created("::campaign::CampaignOwnerCap"),
  };
}

// ─── Signing path (design note — lands with the first chain-action UI) ──
//
// To submit a Sui tx AS THE USER via the Privy embedded key:
//   1. const txBytes = await tx.build({ client });
//   2. const intent  = messageWithIntent('TransactionData', txBytes);
//        (from '@mysten/sui/cryptography')
//   3. const digest  = blake2b256(intent);   // Sui Ed25519 signs this 32B
//   4. const rawSig  = await privySolanaSignMessage(digest); // 64B ed25519
//   5. const sig     = toSerializedSignature({
//        signatureScheme: 'ED25519', signature: rawSig,
//        publicKey: new Ed25519PublicKey(bs58.decode(wallet.address)) });
//   6. await client.executeTransactionBlock({ transactionBlock: txBytes,
//        signature: sig });
//
// NOT shipped yet because (a) no UI currently signs Sui txs and (b) the
// blake2b-pre-hash vs Privy's raw-sign behaviour must be verified against
// a live Privy wallet in-browser before trusting it with value. Derivation
// (address display) above is verified and safe to ship now.
