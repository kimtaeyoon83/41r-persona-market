#!/usr/bin/env tsx
/**
 * setup-sas.ts — One-time SAS (Solana Attestation Service) schema setup on devnet.
 *
 * Creates:
 *   1. A Credential (issuer identity for 41R Persona Market)
 *   2. A Schema defining tester performance attestation fields
 *
 * After running, copy the printed PDA addresses into .env:
 *   SAS_CREDENTIAL_PDA=...
 *   SAS_SCHEMA_PDA=...
 *
 * Usage:
 *   pnpm tsx scripts/setup-sas.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  sendAndConfirmTransactionFactory,
  pipe,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type TransactionSigner,
  type Instruction,
} from '@solana/kit';
// @ts-ignore — sas-lib types may not fully resolve
import {
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  deriveCredentialPda,
  deriveSchemaPda,
} from 'sas-lib';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const WSS_URL = process.env.SOLANA_WSS_URL || 'wss://api.devnet.solana.com';
const KEYPAIR_PATH = resolve(
  (process.env.SOLANA_KEYPAIR_PATH || '~/.config/solana/id.json')
    .replace('~', process.env.HOME || ''),
);

const CREDENTIAL_NAME = '41R-PERSONA-MARKET';
const SCHEMA_NAME = 'TESTER-PERFORMANCE';
const SCHEMA_VERSION = 1;
const SCHEMA_DESCRIPTION = '41R Persona Market — tester performance and persona credential attestation';

// Borsh layout: 0 = u32, 12 = string
// Fields: tests_completed(u32), avg_quality_x100(u32), expertise_defi_x100(u32),
//         expertise_ai_x100(u32), trust_tier(string), persona_activated(u32)
const SCHEMA_LAYOUT = Buffer.from([0, 0, 0, 0, 12, 0]);
const SCHEMA_FIELDS = [
  'tests_completed',
  'avg_quality_x100',
  'expertise_defi_x100',
  'expertise_ai_x100',
  'trust_tier',
  'persona_activated',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadKeypair(): Promise<TransactionSigner> {
  const secretKey = JSON.parse(readFileSync(KEYPAIR_PATH, 'utf-8')) as number[];
  return createKeyPairSignerFromBytes(Uint8Array.from(secretKey) as CryptoKey & Uint8Array);
}

async function sendInstructions(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
  payer: TransactionSigner,
  instructions: Instruction[],
  label: string,
): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (msg: any) => setTransactionMessageFeePayerSigner(payer, msg),
    (msg: any) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg: any) => appendTransactionMessageInstructions(instructions, msg),
  );

  const signed = await signTransactionMessageWithSigners(tx as any);
  const sig = getSignatureFromTransaction(signed);

  await (sendAndConfirmTransactionFactory as any)({ rpc, rpcSubscriptions })(signed, {
    commitment: 'confirmed',
  });

  console.log(`  [OK] ${label}: ${sig}`);
  return sig;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== 41R Persona Market — SAS Schema Setup ===\n');

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WSS_URL);

  // Load keypair
  console.log('1. Loading keypair...');
  const payer = await loadKeypair();
  console.log(`   Authority: ${payer.address}`);

  // Check balance
  const balance = await rpc.getBalance(payer.address).send();
  console.log(`   Balance: ${Number(balance.value) / 1e9} SOL`);
  if (Number(balance.value) < 10_000_000) {
    console.error('   Insufficient balance. Run: solana airdrop 2');
    process.exit(1);
  }

  // Step 2: Create Credential (skip if already exists)
  console.log('\n2. Creating Credential...');
  const [credentialPda] = await deriveCredentialPda({
    authority: payer.address,
    name: CREDENTIAL_NAME,
  });
  console.log(`   Credential PDA: ${credentialPda}`);

  // Check if credential already exists on-chain
  const credentialAccount = await rpc.getAccountInfo(credentialPda, { encoding: 'base64' }).send();
  if (credentialAccount.value) {
    console.log('   [SKIP] Credential already exists on-chain');
  } else {
    const credentialIx = getCreateCredentialInstruction({
      payer,
      credential: credentialPda,
      authority: payer,
      name: CREDENTIAL_NAME,
      signers: [payer.address],
    });
    await sendInstructions(rpc, rpcSubscriptions, payer, [credentialIx], 'Credential created');
  }

  // Step 3: Create Schema
  console.log('\n3. Creating Schema...');
  const [schemaPda] = await deriveSchemaPda({
    credential: credentialPda,
    name: SCHEMA_NAME,
    version: SCHEMA_VERSION,
  });
  console.log(`   Schema PDA: ${schemaPda}`);

  const schemaIx = getCreateSchemaInstruction({
    payer,
    authority: payer,
    credential: credentialPda,
    schema: schemaPda,
    name: SCHEMA_NAME,
    description: SCHEMA_DESCRIPTION,
    layout: SCHEMA_LAYOUT,
    fieldNames: SCHEMA_FIELDS,
  });

  await sendInstructions(rpc, rpcSubscriptions, payer, [schemaIx], 'Schema created');

  // Done
  console.log('\n=== Setup Complete ===\n');
  console.log('Add to your .env:\n');
  console.log(`SAS_CREDENTIAL_PDA=${credentialPda}`);
  console.log(`SAS_SCHEMA_PDA=${schemaPda}`);
  console.log(`\nExplorer:`);
  console.log(`  Credential: https://explorer.solana.com/address/${credentialPda}?cluster=devnet`);
  console.log(`  Schema:     https://explorer.solana.com/address/${schemaPda}?cluster=devnet`);
}

main().catch((err) => {
  console.error('\nSetup failed:', err);
  process.exit(1);
});
