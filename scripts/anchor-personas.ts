#!/usr/bin/env npx tsx
/**
 * Anchor synthetic personas on-chain (chain wiring, 2026-06-19).
 *
 * For each persona with no sui_object_id, runs the canonical design flow via
 * services/sui/anchor.ts::anchorPersona: Seal-encrypt the persona's vector →
 * Walrus blob → mint the rpm::persona object (operator-signed) →
 * add_memwal_ref → persist the ids. This is what puts REAL Sui/Walrus ids on
 * the persona detail screen.
 *
 * Idempotent + bounded: skips already-anchored rows, caps at --max per run so
 * we never mint 808 testnet objects by accident. Real on-chain mints cost
 * operator gas — fund the SUI_KEYPAIR_JSON address via the testnet faucet first.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/anchor-personas.ts [--max 5] [--dry-run]
 *   (needs SUI_PACKAGE_ID, SUI_KEYPAIR_JSON, SEAL_KEY_SERVER_IDS, WALRUS_* in .env)
 */
import { isNull } from 'drizzle-orm';
import { db, schema } from '../apps/api/src/db/index.js';
import { anchorPersona, suiObjectUrl } from '../apps/api/src/services/sui/anchor.js';

const dryRun = process.argv.includes('--dry-run');
const maxIdx = process.argv.indexOf('--max');
const max = maxIdx >= 0 && process.argv[maxIdx + 1] ? parseInt(process.argv[maxIdx + 1]!, 10) : 5;

async function main(): Promise<void> {
  const rows = await db
    .select({ id: schema.personas.id })
    .from(schema.personas)
    .where(isNull(schema.personas.suiObjectId))
    .limit(max);

  console.log(
    `unanchored personas to process: ${rows.length} (--max ${max})${dryRun ? ' · DRY RUN' : ''}`,
  );
  if (rows.length === 0) return;

  let anchored = 0;
  let failed = 0;
  for (const { id } of rows) {
    if (dryRun) {
      console.log(`  would anchor ${id}`);
      continue;
    }
    try {
      const r = await anchorPersona(id);
      if (r.status === 'skipped') {
        console.log(`  ${id}: already anchored (${r.suiObjectId})`);
      } else {
        anchored++;
        console.log(`  ${id}: ✓ ${suiObjectUrl(r.suiObjectId)} · walrus=${r.walrusBlobId}`);
      }
    } catch (err) {
      failed++;
      console.error(`  ${id}: ✗ ${(err as Error).message}`);
    }
  }

  console.log(`\n✓ anchored ${anchored} · failed ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
