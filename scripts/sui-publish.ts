#!/usr/bin/env npx tsx
/**
 * Publish the rpm Move package (packages/sui-move) to Sui and print the
 * resulting package id (design doc v0.4 §0.1 chain transition).
 *
 * Operator-run. Builds the Move bytecode via the Sui CLI, then publishes
 * it in a PTB signed by SUI_KEYPAIR_JSON. Set the printed package id as
 * SUI_PACKAGE_ID afterwards so the PTB builders (services/sui/tx.ts) can
 * target it.
 *
 * Prereqs:
 *   - sui CLI installed (brew install sui)
 *   - SUI_KEYPAIR_JSON set (bech32 suiprivkey1...), address funded with
 *     gas on SUI_NETWORK (faucet for testnet/devnet)
 *
 * Usage:
 *   SUI_KEYPAIR_JSON=suiprivkey1... pnpm tsx scripts/sui-publish.ts
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Transaction } from '@mysten/sui/transactions';
import { getSuiClient, getSuiSigner } from '../apps/api/src/services/sui/client.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, '..', 'packages', 'sui-move');

async function main(): Promise<void> {
  const signer = getSuiSigner();
  const client = getSuiClient();
  const sender = signer.toSuiAddress();
  console.log(`Publishing rpm Move package as ${sender} ...`);

  // Compile to base64 bytecode + dependency ids via the Sui CLI.
  const built = JSON.parse(
    execSync(
      `sui move build --dump-bytecode-as-base64 --path ${pkgPath}`,
      { encoding: 'utf8' },
    ),
  ) as { modules: string[]; dependencies: string[] };

  const tx = new Transaction();
  const [upgradeCap] = tx.publish({
    modules: built.modules,
    dependencies: built.dependencies,
  });
  // Keep the upgrade capability with the publisher.
  tx.transferObjects([upgradeCap], sender);

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showObjectChanges: true, showEffects: true },
  });

  const published = (result.objectChanges ?? []).find(
    (c) => c.type === 'published',
  ) as { type: 'published'; packageId: string } | undefined;

  if (!published) {
    console.error('No published package in objectChanges:', result.digest);
    process.exitCode = 1;
    return;
  }

  console.log('\n✓ Published');
  console.log(`  digest:     ${result.digest}`);
  console.log(`  packageId:  ${published.packageId}`);
  console.log(`\nSet this in your env:\n  SUI_PACKAGE_ID=${published.packageId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
