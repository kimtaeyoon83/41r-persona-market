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
import bs58 from "bs58";

/**
 * Derive the user's Sui address (0x…) from their Privy Solana embedded
 * wallet address (a base58 Ed25519 public key). Same key → same owner on
 * both chains; we only ever use the Sui side.
 */
export function deriveSuiAddress(solanaAddressBase58: string): string {
  const pubkeyBytes = bs58.decode(solanaAddressBase58);
  return new Ed25519PublicKey(pubkeyBytes).toSuiAddress();
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
