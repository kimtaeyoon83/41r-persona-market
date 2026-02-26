#!/usr/bin/env tsx
/**
 * test-x402.ts — Test client for the x402 payment-gated /api/hello endpoint.
 *
 * Uses @x402/fetch + @x402/svm to automatically handle the 402 payment flow:
 *   1. Makes a GET to /api/hello
 *   2. Receives 402 + payment requirements
 *   3. Signs a USDC transfer on Solana devnet
 *   4. Retries with the payment-signature header
 *   5. Receives the gated content
 *
 * Usage:
 *   pnpm tsx scripts/test-x402.ts [--fallback]
 *
 * Flags:
 *   --fallback  Use the raw fallback flow (manual X-Payment header) instead
 *               of @x402/fetch automatic handling.
 *
 * Env:
 *   SOLANA_KEYPAIR_PATH  path to a Solana keypair JSON (default: ~/.config/solana/id.json)
 *   API_URL              base URL of the API (default: http://localhost:4100)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactSvmScheme } from '@x402/svm/exact/client';
import { createKeyPairSignerFromBytes } from '@solana/kit';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.env.API_URL || 'http://localhost:4100';
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH
  ? resolve(process.env.SOLANA_KEYPAIR_PATH.replace('~', process.env.HOME || ''))
  : resolve(process.env.HOME || '', '.config/solana/id.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeypairBytes(): Uint8Array {
  try {
    const raw = readFileSync(KEYPAIR_PATH, 'utf-8');
    const arr: number[] = JSON.parse(raw);
    return Uint8Array.from(arr);
  } catch (err) {
    console.error(`Failed to load keypair from ${KEYPAIR_PATH}`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// x402/fetch automatic flow
// ---------------------------------------------------------------------------

async function testWithX402Fetch() {
  console.log('--- x402/fetch automatic flow ---');
  console.log(`Keypair : ${KEYPAIR_PATH}`);
  console.log(`API     : ${API_URL}/api/hello\n`);

  const keypairBytes = loadKeypairBytes();

  // createKeyPairSignerFromBytes expects the full 64-byte secret key
  const signer = await createKeyPairSignerFromBytes(keypairBytes);
  console.log(`Signer  : ${signer.address}\n`);

  const client = new x402Client();
  registerExactSvmScheme(client, { signer });

  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  console.log('Requesting /api/hello (will auto-pay if 402)...\n');

  const res = await fetchWithPay(`${API_URL}/api/hello`);

  console.log(`Status  : ${res.status} ${res.statusText}`);

  // Print payment response header if present
  const paymentResponse = res.headers.get('x-payment-response');
  if (paymentResponse) {
    console.log('Payment : verified');
  }

  const body = await res.json();
  console.log('Body    :', JSON.stringify(body, null, 2));
}

// ---------------------------------------------------------------------------
// Fallback manual flow (for when x402 facilitator is unavailable)
// ---------------------------------------------------------------------------

async function testFallbackFlow() {
  console.log('--- Fallback manual payment flow ---');
  console.log(`API     : ${API_URL}/api/hello\n`);

  // Step 1: Request without payment => 402
  console.log('Step 1: GET /api/hello (no payment)');
  const res402 = await fetch(`${API_URL}/api/hello`);
  console.log(`Status  : ${res402.status}`);

  if (res402.status !== 402) {
    console.log('Expected 402, got', res402.status);
    const body = await res402.text();
    console.log('Body:', body);
    return;
  }

  const paymentInfo = await res402.json();
  console.log('Payment info:', JSON.stringify(paymentInfo, null, 2));

  // Step 2: Build, sign, and send payment
  console.log('\nStep 2: Building payment transaction...');

  // Dynamic imports for the fallback path (uses @solana/web3.js v1 API)
  const { Connection, Keypair, PublicKey, Transaction } = await import(
    '@solana/web3.js'
  );
  const { createTransferInstruction, getAssociatedTokenAddress } = await import(
    '@solana/spl-token'
  );

  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const keypairData: number[] = JSON.parse(readFileSync(KEYPAIR_PATH, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log(`Payer   : ${payer.publicKey.toBase58()}`);

  const payment = paymentInfo.payment;
  const recipientATA = new PublicKey(payment.tokenAccount);
  const mint = new PublicKey(payment.mint);
  const amount = payment.amount;

  // Get payer's ATA
  const payerATA = await getAssociatedTokenAddress(mint, payer.publicKey);
  console.log(`Payer ATA: ${payerATA.toBase58()}`);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    blockhash,
    lastValidBlockHeight,
  });
  tx.add(
    createTransferInstruction(payerATA, recipientATA, payer.publicKey, amount),
  );
  tx.sign(payer);

  const serializedTx = tx.serialize().toString('base64');
  const paymentProof = {
    x402Version: 1,
    scheme: 'exact',
    network: 'solana-devnet',
    payload: { serializedTransaction: serializedTx },
  };

  const xPaymentHeader = Buffer.from(JSON.stringify(paymentProof)).toString(
    'base64',
  );

  // Step 3: Retry with payment header
  console.log('\nStep 3: Retrying with X-Payment header...');
  const paidRes = await fetch(`${API_URL}/api/hello`, {
    headers: { 'X-Payment': xPaymentHeader },
  });

  console.log(`Status  : ${paidRes.status}`);
  const paidBody = await paidRes.json();
  console.log('Body    :', JSON.stringify(paidBody, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const useFallback = process.argv.includes('--fallback');

  try {
    if (useFallback) {
      await testFallbackFlow();
    } else {
      await testWithX402Fetch();
    }
    console.log('\nDone.');
  } catch (err) {
    console.error('\nTest failed:');
    console.error(err);
    process.exit(1);
  }
}

main();
