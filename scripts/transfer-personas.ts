#!/usr/bin/env npx tsx
/**
 * Transfer an anchored persona to its owner's Sui address (mint-to-user,
 * §4.1 sovereignty — "소유는 유저", 2026-06-20).
 *
 * Anchored personas are operator-minted (operator-owned). This is the
 * calling surface for the existing persona::transfer_to primitive: it hands
 * a specific anchored object to a specific Sui address the operator supplies
 * (e.g. a real tester's wallet at onboarding), via
 * services/sui/anchor.ts::transferPersonaToUser. Operator-signed, idempotent
 * (a second run with the same recipient is a no-op; a different recipient
 * errors — the object is no longer operator-owned).
 *
 * Single-target by design: a transfer is a deliberate, per-user handover, not
 * a batch sweep. The persona MUST already be anchored (run
 * scripts/anchor-personas.ts first) — a transfer needs an on-chain object.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/transfer-personas.ts \
 *     --persona <persona-uuid> --to 0x<64-hex> [--dry-run]
 *   (needs SUI_PACKAGE_ID, SUI_KEYPAIR_JSON in .env; operator must own the object)
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../apps/api/src/db/index.js';
import {
  transferPersonaToUser,
  isSuiAddress,
  suiObjectUrl,
} from '../apps/api/src/services/sui/anchor.js';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const personaId = argValue('--persona');
  const recipient = argValue('--to');

  if (!personaId || !recipient) {
    console.error('usage: --persona <uuid> --to 0x<64hex> [--dry-run]');
    process.exit(2);
  }
  if (!isSuiAddress(recipient)) {
    console.error(`✗ invalid Sui address: ${recipient} (expect 0x + 64 hex)`);
    process.exit(2);
  }

  const [row] = await db
    .select({
      id: schema.personas.id,
      suiObjectId: schema.personas.suiObjectId,
      transferredTo: schema.personas.transferredTo,
    })
    .from(schema.personas)
    .where(eq(schema.personas.id, personaId))
    .limit(1);

  if (!row) {
    console.error(`✗ persona ${personaId} not found`);
    process.exit(1);
  }
  if (!row.suiObjectId) {
    console.error(`✗ persona ${personaId} is not anchored — run anchor-personas.ts first`);
    process.exit(1);
  }

  console.log(
    `persona ${personaId}\n  object ${suiObjectUrl(row.suiObjectId)}\n  → ${recipient}${
      dryRun ? '  · DRY RUN' : ''
    }`,
  );
  if (row.transferredTo) {
    console.log(`  (already transferred to ${row.transferredTo})`);
  }
  if (dryRun) return;

  const r = await transferPersonaToUser(personaId, recipient);
  if (r.status === 'skipped') {
    console.log(`  skipped: ${r.reason}`);
  } else {
    console.log(`  ✓ transferred · digest=${r.digest}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
