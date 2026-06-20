#!/usr/bin/env npx tsx
/**
 * Backfill plaintext content-hash commitments (Method B, 2026-06-20).
 *
 * For every ALREADY-anchored persona missing a content_hash, commit
 * sha256(plaintext vector) via a public Walrus manifest add_memwal_ref'd onto
 * its Sui object (services/sui/anchor.ts::commitPersonaContentHash) — makes the
 * persona's content client-verifiable without decrypting the sealed blob. For
 * anchored scan reports, store report_content_hash (no Sui object → DB hash
 * only, recomputed from the report payload).
 *
 * Idempotent + gas-aware: skips rows that already have a hash, stops if the
 * operator balance drops too low (each persona = one add_memwal_ref tx).
 *
 * Usage:
 *   DATABASE_URL=<prod-proxy> pnpm tsx scripts/backfill-content-hash.ts [--max N] [--dry-run]
 *   (needs SUI_PACKAGE_ID, SUI_KEYPAIR_JSON, WALRUS_* in .env)
 */
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '../apps/api/src/db/index.js';
import {
  commitPersonaContentHash,
  buildScanReportPayload,
  sha256Hex,
} from '../apps/api/src/services/sui/anchor.js';
import { getSuiClient, getSuiSigner } from '../apps/api/src/services/sui/client.js';

const dryRun = process.argv.includes('--dry-run');
const maxIdx = process.argv.indexOf('--max');
const max = maxIdx >= 0 && process.argv[maxIdx + 1] ? parseInt(process.argv[maxIdx + 1]!, 10) : 200;

async function balanceSui(): Promise<number> {
  const b = await getSuiClient().getBalance({ owner: getSuiSigner().toSuiAddress() });
  return Number(b.totalBalance) / 1e9;
}

async function main(): Promise<void> {
  // ── Personas: anchored, no content hash yet ──
  const personas = await db
    .select({ id: schema.personas.id })
    .from(schema.personas)
    .where(and(isNotNull(schema.personas.suiObjectId), isNull(schema.personas.contentHash)))
    .limit(max);
  console.log(
    `personas to commit: ${personas.length} (--max ${max})${dryRun ? ' · DRY RUN' : ''}`,
  );
  if (!dryRun && personas.length) console.log(`start balance: ${(await balanceSui()).toFixed(4)} SUI`);

  let ok = 0,
    fail = 0;
  for (let i = 0; i < personas.length; i++) {
    const id = personas[i]!.id;
    if (dryRun) {
      console.log(`  would commit ${id.slice(0, 8)}`);
      continue;
    }
    if (i % 25 === 0 && (await balanceSui()) < 0.05) {
      console.log('  ⚠ stopping — operator balance too low');
      break;
    }
    try {
      const r = await commitPersonaContentHash(id);
      ok++;
      console.log(
        `  [${i + 1}/${personas.length}] ${id.slice(0, 8)} ${r.status}` +
          (r.status === 'committed' ? ` sha256=${r.contentHash.slice(0, 12)}…` : ''),
      );
    } catch (e) {
      fail++;
      console.log(
        `  [${i + 1}/${personas.length}] ${id.slice(0, 8)} ✗ ${(e as Error).message.slice(0, 70)}`,
      );
    }
  }

  // ── Reports: anchored snapshot, no content hash yet (DB hash, no tx) ──
  const scans = await db
    .select()
    .from(schema.audienceFitScans)
    .where(
      and(
        isNotNull(schema.audienceFitScans.reportWalrusBlobId),
        isNull(schema.audienceFitScans.reportContentHash),
      ),
    );
  console.log(`\nreports to hash: ${scans.length}${dryRun ? ' · DRY RUN' : ''}`);
  let rOk = 0;
  for (const row of scans) {
    const hash = sha256Hex(JSON.stringify(buildScanReportPayload(row)));
    if (dryRun) {
      console.log(`  would hash ${row.id.slice(0, 8)} → ${hash.slice(0, 12)}…`);
      continue;
    }
    await db
      .update(schema.audienceFitScans)
      .set({ reportContentHash: hash })
      .where(eq(schema.audienceFitScans.id, row.id));
    rOk++;
    console.log(`  ${row.id.slice(0, 8)} → ${hash.slice(0, 12)}…`);
  }

  if (!dryRun) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.personas)
      .where(and(isNotNull(schema.personas.suiObjectId), isNull(schema.personas.contentHash)));
    console.log(`\npersonas: committed ${ok} · failed ${fail} · still pending ${n}`);
    console.log(`reports: hashed ${rOk}`);
    console.log(`end balance: ${(await balanceSui()).toFixed(4)} SUI`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
