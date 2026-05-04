// 41R Fee Payer wallet (Phase 2 §3).
//
// Single Solana keypair 41R controls. Used by:
//   - Phase 4: gas sponsorship for user-signed 0 USDC SPL transfer (D6)
//   - Phase 5: USDC reward distribution to persona wallets (§6.1 step 7)
//
// Independent from PERSONA_MASTER_MNEMONIC. Provisioned by
// scripts/setup-fee-payer.ts which generates + saves to .env +
// requests Devnet airdrop.
//
// In production, the keypair lives in Railway env var
// FEE_PAYER_KEYPAIR_JSON. NEVER commit; NEVER log secret bytes.

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

let cached: Keypair | null = null;

export function getFeePayerKeypair(): Keypair {
  if (cached) return cached;
  const raw = process.env.FEE_PAYER_KEYPAIR_JSON;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'FEE_PAYER_KEYPAIR_JSON env var is not set. Run scripts/setup-fee-payer.ts to provision.',
    );
  }
  let arr: number[];
  try {
    arr = JSON.parse(raw) as number[];
  } catch (err) {
    throw new Error(`FEE_PAYER_KEYPAIR_JSON is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(`FEE_PAYER_KEYPAIR_JSON must be a 64-element JSON array (Solana secret key)`);
  }
  cached = Keypair.fromSecretKey(Uint8Array.from(arr));
  return cached;
}

export function getFeePayerAddress(): PublicKey {
  return getFeePayerKeypair().publicKey;
}

/** Current SOL balance in lamports. Pure read. */
export async function getFeePayerBalance(connection: Connection): Promise<number> {
  return connection.getBalance(getFeePayerAddress());
}

/**
 * Devnet airdrop. NO-OP on mainnet (we never auto-airdrop in prod).
 * Returns the airdrop tx signature on success, null otherwise.
 */
export async function requestDevnetAirdrop(
  connection: Connection,
  sol = 1,
): Promise<string | null> {
  const isDevnet = (connection.rpcEndpoint || '').includes('devnet');
  if (!isDevnet) return null;
  try {
    const sig = await connection.requestAirdrop(
      getFeePayerAddress(),
      Math.floor(sol * LAMPORTS_PER_SOL),
    );
    await connection.confirmTransaction(sig, 'confirmed');
    return sig;
  } catch {
    return null;
  }
}
