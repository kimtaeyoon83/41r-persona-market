#!/usr/bin/env npx tsx
/**
 * Provision the 41R Fee Payer wallet (Phase 2 §3).
 *
 * The Fee Payer is a single Solana wallet 41R controls. Its job:
 *   - Phase 4: pay gas for user-signed 0 USDC sponsored tx (D6)
 *   - Phase 5: send USDC rewards to persona wallets (decision §6.1 step 7)
 *
 * Independent from PERSONA_MASTER_MNEMONIC (which is the HD root for the
 * 800 synthetic personas). The Fee Payer is one keypair, not derived.
 *
 * Idempotent: re-running with FEE_PAYER_KEYPAIR_JSON already set is a
 * no-op (just verifies + reports balance).
 *
 * Usage:
 *   pnpm tsx scripts/setup-fee-payer.ts
 *   pnpm tsx scripts/setup-fee-payer.ts --airdrop 2   # request 2 SOL on Devnet
 *
 * Required env (loaded from .env):
 *   SOLANA_RPC_URL  - Devnet by default
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const SECRETS_PATH = path.resolve(process.cwd(), 'secrets/fee-payer.keypair.json');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const args = process.argv.slice(2);
const AIRDROP_SOL = (() => {
  const idx = args.indexOf('--airdrop');
  if (idx >= 0 && args[idx + 1]) return parseFloat(args[idx + 1]!);
  return 2; // default 2 SOL on first setup
})();

function loadOrGenerateKeypair(): { keypair: Keypair; isNew: boolean } {
  const existing = process.env.FEE_PAYER_KEYPAIR_JSON;
  if (existing && existing.trim().length > 0) {
    try {
      const arr = JSON.parse(existing) as number[];
      const kp = Keypair.fromSecretKey(Uint8Array.from(arr));
      return { keypair: kp, isNew: false };
    } catch (err) {
      throw new Error(`FEE_PAYER_KEYPAIR_JSON is set but malformed: ${(err as Error).message}`);
    }
  }
  return { keypair: Keypair.generate(), isNew: true };
}

function persistNewKeypair(kp: Keypair): void {
  // .env append
  const arr = Array.from(kp.secretKey);
  const jsonLine = `FEE_PAYER_KEYPAIR_JSON=${JSON.stringify(arr)}`;

  let envContent = '';
  try { envContent = fs.readFileSync(ENV_PATH, 'utf-8'); } catch {}
  const sep = envContent && !envContent.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(
    ENV_PATH,
    `${sep}\n# Phase 2 §3 — 41R Fee Payer wallet (gas + USDC sponsorship).\n` +
      `# DO NOT commit. Backup at secrets/fee-payer.keypair.json.\n` +
      `${jsonLine}\n`,
  );

  // Backup file (Solana CLI compatible — pasteable into id.json).
  fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true });
  fs.writeFileSync(SECRETS_PATH, JSON.stringify(arr), { mode: 0o600 });
}

async function main(): Promise<void> {
  console.log(`RPC: ${RPC_URL}`);
  const { keypair, isNew } = loadOrGenerateKeypair();
  const pub = keypair.publicKey.toBase58();

  if (isNew) {
    console.log('✓ Generated new Fee Payer keypair');
    persistNewKeypair(keypair);
    console.log('✓ Saved to .env (FEE_PAYER_KEYPAIR_JSON=...)');
    console.log('✓ Backup at secrets/fee-payer.keypair.json (mode 600)');
  } else {
    console.log('✓ Loaded existing Fee Payer keypair from FEE_PAYER_KEYPAIR_JSON');
  }
  console.log(`  public address: ${pub}`);

  const conn = new Connection(RPC_URL, 'confirmed');
  let balanceLamports = await conn.getBalance(keypair.publicKey);
  console.log(`  current balance: ${(balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // Devnet airdrop — only when balance is below threshold and the RPC is Devnet.
  const isDevnet = RPC_URL.includes('devnet');
  if (!isDevnet) {
    console.log('  (mainnet RPC — airdrop skipped, fund manually via your treasury)');
    return;
  }

  if (balanceLamports < AIRDROP_SOL * LAMPORTS_PER_SOL) {
    const want = Math.floor(AIRDROP_SOL * LAMPORTS_PER_SOL);
    console.log(`  requesting airdrop: ${AIRDROP_SOL} SOL ...`);
    try {
      const sig = await conn.requestAirdrop(keypair.publicKey, want);
      // Confirm the airdrop tx (~5-15s).
      await conn.confirmTransaction(sig, 'confirmed');
      balanceLamports = await conn.getBalance(keypair.publicKey);
      console.log(`✓ Airdrop confirmed (sig: ${sig.slice(0, 16)}...)`);
      console.log(`  new balance: ${(balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    } catch (err) {
      console.error('  ✗ Airdrop failed (Devnet faucet may be rate-limited).');
      console.error('    Manual: solana airdrop 2 ' + pub + ' --url devnet');
      console.error('    Or: https://faucet.solana.com/  →  paste address');
      console.error('    Error:', err instanceof Error ? err.message : err);
    }
  } else {
    console.log('  balance sufficient — no airdrop needed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
