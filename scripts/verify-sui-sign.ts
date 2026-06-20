#!/usr/bin/env npx tsx
/**
 * Verify the Sui-side signature ASSEMBLY used by the browser USDC path
 * (apps/web/lib/sui-wallet.ts::signAndExecuteSuiTx) — B1, 2026-06-20.
 *
 * sui-wallet.ts assembles a Sui signature from a raw Ed25519 signature over
 * blake2b(intent(txBytes), 32) — its load-bearing assumption is that Privy's
 * signMessage RAW-signs those 32 bytes (no re-hash). This harness replicates
 * that EXACT assembly with the operator's Ed25519 key and checks two things:
 *
 *   (1) byte-identical proof — the hand-assembled signature equals what the
 *       standard kp.signTransaction(txBytes) produces. If equal, the
 *       intent → blake2b → raw-sign → toSerializedSignature pipeline is
 *       provably correct (this is what "raw-sign the digest" must yield).
 *   (2) network-accept proof (--confirm) — execute the hand-assembled tx on
 *       testnet; a success status means a node accepts the assembly.
 *
 * What this CANNOT prove: whether Privy's *own* signMessage raw-signs vs
 * pre-hashes — that's wallet-internal and needs a real Privy session in a
 * browser. This harness reduces B1 to exactly that one unknown.
 *
 * No database. Needs SUI_KEYPAIR_JSON + a funded operator wallet for --confirm.
 *
 * Usage:
 *   pnpm tsx scripts/verify-sui-sign.ts [--confirm]
 */
import 'dotenv/config';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { messageWithIntent, toSerializedSignature } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { blake2b } from '@noble/hashes/blake2.js';

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const net = process.env.SUI_NETWORK || 'testnet';
  const client = new SuiJsonRpcClient({
    url: process.env.SUI_RPC_URL || `https://fullnode.${net}.sui.io`,
    network: net,
  });
  const kp = Ed25519Keypair.fromSecretKey(process.env.SUI_KEYPAIR_JSON!);
  const me = kp.toSuiAddress();

  // A trivial, valid tx: split 0 MIST off gas and return it to self. Costs
  // only gas, moves no value, but is a real signable TransactionData.
  const tx = new Transaction();
  tx.setSender(me);
  const [zero] = tx.splitCoins(tx.gas, [tx.pure.u64(0)]);
  tx.transferObjects([zero], tx.pure.address(me));
  const txBytes = await tx.build({ client });

  // ── (1) Hand-assemble exactly as sui-wallet.ts does ──
  const intent = messageWithIntent('TransactionData', txBytes);
  const digest = blake2b(intent, { dkLen: 32 });
  const rawSig = await kp.sign(digest); // "Privy raw-signs the 32B digest"
  const manual = toSerializedSignature({
    signatureScheme: 'ED25519',
    signature: rawSig,
    publicKey: kp.getPublicKey(),
  });

  // Reference: the SDK's standard signing path over the same bytes.
  const { signature: reference } = await kp.signTransaction(txBytes);

  const identical = manual === reference;
  console.log(`operator: ${me}`);
  console.log(`(1) assembly byte-identical to signTransaction: ${identical ? '✓ YES' : '✗ NO'}`);
  if (!identical) {
    console.log(`    manual:    ${manual.slice(0, 24)}…`);
    console.log(`    reference: ${reference.slice(0, 24)}…`);
    process.exit(1);
  }

  if (!confirm) {
    console.log('(2) network-accept: skipped (pass --confirm to execute on testnet)');
    return;
  }

  // ── (2) Execute the HAND-ASSEMBLED signature on testnet ──
  const res = await client.executeTransactionBlock({
    transactionBlock: txBytes,
    signature: manual,
    options: { showEffects: true },
  });
  const status = res.effects?.status?.status;
  console.log(`(2) network-accept: ${status === 'success' ? '✓ success' : '✗ ' + JSON.stringify(res.effects?.status)}`);
  console.log(`    digest: ${res.digest}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
