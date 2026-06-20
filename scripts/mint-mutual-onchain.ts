#!/usr/bin/env npx tsx
/**
 * One-off LIVE proof that the mutual on-chain mint path works (B2 ignition,
 * 2026-06-20). Mints a real rpm::mutual::MutualCampaign on testnet via the
 * SAME code path the gated createMutualCampaign uses (defaultMintOnChain →
 * buildCreateMutualFromGas → operator-signed execute), with dummy blob refs
 * and a small reward split from gas.
 *
 * This needs NO database — it exercises only the chain layer, so it proves
 * the mint independent of the (env-blocked) DB. Requires SUI_PACKAGE_ID +
 * SUI_KEYPAIR_JSON in .env and a funded operator wallet.
 *
 * Guarded: pass --confirm to actually mint (it spends real testnet gas + locks
 * the reward in the campaign). Without it, prints what it would do.
 *
 * Usage:
 *   DATABASE_URL=unused pnpm tsx scripts/mint-mutual-onchain.ts --confirm [--reward 5000000]
 */
import 'dotenv/config';
import { defaultMintOnChain, sha256Hex } from '../apps/api/src/services/sui/mutual.js';
import { suiObjectUrl } from '../apps/api/src/services/sui/anchor.js';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  // Default reward 0.005 SUI (5_000_000 MIST) — small, just enough to exercise
  // the real split+lock path, leaving the operator wallet funded.
  const reward = BigInt(argValue('--reward') ?? '5000000');

  const args = {
    rewardAmount: reward,
    assetBlobRef: 'proof-blob-ref',
    assetHash: sha256Hex(new TextEncoder().encode('b2-ignition-proof')),
    assetSealPolicy: 'proof-seal-id',
    sandboxOnly: true,
  };

  console.log(`mint mutual on-chain · reward=${reward} MIST${confirm ? '' : '  · DRY RUN (pass --confirm)'}`);
  console.log(`  asset_hash=${args.assetHash.slice(0, 16)}…`);
  if (!confirm) return;

  const r = await defaultMintOnChain(args);
  if (!r) {
    console.error('✗ mint returned no MutualCampaign object id');
    process.exit(1);
  }
  console.log(`  ✓ MutualCampaign: ${suiObjectUrl(r.suiObjectId)}`);
  console.log(`  ✓ OwnerCap: ${r.suiCapId ?? '(none found)'}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
