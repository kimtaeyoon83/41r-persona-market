// Phase 4 §3 / D6 — sponsored 0 USDC transaction.
//
// Builds a SystemProgram.transfer(lamports=0) tx where:
//   - source: the user's Privy wallet (pubkey only — they sign client-side)
//   - dest:   41R treasury (Fee Payer's pubkey)
//   - feePayer: Fee Payer (covers gas)
//   - amount: 0 lamports
//
// Why SystemProgram.transfer(0) and not USDC TransferChecked(0)?
//   - User's USDC ATA may not exist yet — TransferChecked needs both
//     ATAs present, which would require an extra create-ATA instruction
//     (rent ~0.00203 SOL paid by Fee Payer per new user).
//   - On Devnet during Internal Testing, the visual fact ("user signed
//     a real Solana tx, here's Solscan") matters more than which
//     instruction. UI surface still says "Cost: $0.00 USDT".
//   - Phase 5 promotion to Mainnet will revisit — at that point we may
//     want USDC for branding, accept the ATA-creation cost, or use
//     Memo Program if ATA UX is too clunky.
//
// Flow:
//   1. backend buildSponsoredZeroTx(userPubkey) → returns base64 tx
//      (Fee Payer already signed; user's slot empty).
//   2. client (Privy useSignTransaction) signs with user's wallet.
//   3. backend broadcastSignedTx(signedB64) → submits to Solana RPC,
//      confirms, returns the tx signature.

import { Connection, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { getFeePayerKeypair } from './fee_payer.js';
import { env } from '../config/env.js';

let cachedConnection: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (cachedConnection) return cachedConnection;
  cachedConnection = new Connection(env.SOLANA_RPC_URL, 'confirmed');
  return cachedConnection;
}

export type SponsoredTxBuild = {
  txBase64: string;          // serialized tx with Fee Payer partial sig
  blockhash: string;
  lastValidBlockHeight: number;
  feePayer: string;          // base58 pubkey
  expiresAt: string;         // ISO; rough — caller should resign if > 1 min old
};

/**
 * Build a 0-lamport SystemProgram.transfer from the user's wallet to
 * the Fee Payer, with Fee Payer set as feePayer (gas sponsor) and
 * already partially signed. Caller forwards the base64 tx to the
 * client; the client signs with the user's Privy wallet and posts
 * back to confirm.
 */
export async function buildSponsoredZeroTx(userPubkey: string): Promise<SponsoredTxBuild> {
  const feePayer = getFeePayerKeypair();
  const conn = getSolanaConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

  const tx = new Transaction({
    feePayer: feePayer.publicKey,
    recentBlockhash: blockhash,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(userPubkey),
      toPubkey: feePayer.publicKey,
      lamports: 0,
    }),
  );
  tx.partialSign(feePayer);

  // requireAllSignatures: false — user's signature isn't here yet.
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

  // Roughly ~1 min validity window for the blockhash. Client should
  // refetch if it sits idle.
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  return {
    txBase64: serialized.toString('base64'),
    blockhash,
    lastValidBlockHeight,
    feePayer: feePayer.publicKey.toBase58(),
    expiresAt,
  };
}

/**
 * Broadcast the user-signed tx to Solana RPC and wait for confirmation.
 * Returns the tx signature on success. Throws on simulation / send
 * failure.
 */
export async function broadcastSignedTx(signedTxBase64: string): Promise<string> {
  const conn = getSolanaConnection();
  const txBytes = Buffer.from(signedTxBase64, 'base64');
  const sig = await conn.sendRawTransaction(txBytes, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

/**
 * Build a Solscan URL for the given tx signature. Cluster is inferred
 * from SOLANA_RPC_URL (devnet/testnet/mainnet-beta).
 */
export function solscanUrl(signature: string): string {
  const url = env.SOLANA_RPC_URL || '';
  const cluster = url.includes('devnet')
    ? 'devnet'
    : url.includes('testnet')
      ? 'testnet'
      : 'mainnet-beta';
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://solscan.io/tx/${signature}${suffix}`;
}
