// One-shot migration to apply Phase 1 voice cleanup (2026-05-07) to
// existing personas. The seed script `seed-validator-cohorts.ts` is
// `ON CONFLICT DO NOTHING`, so re-running it after editing
// VOICE_BY_COHORT will NOT update existing rows. This script does an
// in-place UPDATE for each old → new voice mapping, idempotent.
//
// Usage:
//   DATABASE_URL=postgres://... pnpm tsx scripts/update-validator-voice-samples.ts [--dry-run]
//
// What it does:
//   - For each OLD voice_sample string we used to seed crypto_native /
//     web3_pro / defi_beginner cohorts, find personas with that exact
//     `vector.voice_sample` and rewrite to a deterministic NEW value.
//   - Deterministic mapping (1-to-1): preserves persona identity. We
//     don't randomize on update, so re-running is a no-op.

import 'dotenv/config';
import { Client } from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/r41pm';

// 1-to-1 mapping. Old strings come from the pre-2026-05-07 seed.
const REPLACEMENTS: Array<{ from: string; to: string }> = [
  // crypto_native
  {
    from: 'Slippage and MEV signaling matter most to me. I move fast.',
    to: 'I evaluate products on speed, transparency, and control. Numbers matter more than marketing.',
  },
  {
    from: 'I prefer mobile wallets that just work — keyboard shortcuts on desktop are a bonus.',
    to: 'I want power-user shortcuts on desktop and apps that do not waste my time on mobile.',
  },
  // crypto_native — "If the security model is unclear in 30 seconds, I bounce." preserved.

  // defi_beginner — only one phrase changed semantically
  {
    from: 'I ask questions before pressing anything that costs money.',
    to: 'I ask questions before pressing anything that has consequences.',
  },
  {
    from: 'I want to learn but the jargon scares me off. Hand-holding helps.',
    to: 'I want to learn but jargon scares me off. Hand-holding helps.',
  },

  // web3_pro
  {
    from: 'I run multi-chain ops. Power-user shortcuts and CSV export are non-negotiable.',
    to: 'Power-user shortcuts, CSV export, and keyboard nav are non-negotiable for me.',
  },
  {
    from: 'I notice gas-aware UX and signing UX immediately.',
    to: 'I notice friction in confirmation flows and notification UX immediately.',
  },
  // web3_pro — "I will dig into a docs page if the surface UI is solid." preserved.
];

async function main(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  console.log(
    `${DRY_RUN ? '[DRY-RUN] ' : ''}Applying ${REPLACEMENTS.length} voice_sample rewrites…`,
  );

  let totalMatched = 0;
  let totalUpdated = 0;

  try {
    for (const r of REPLACEMENTS) {
      const { rows: matchRows } = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM personas
         WHERE vector ->> 'voice_sample' = $1`,
        [r.from],
      );
      const matched = Number(matchRows[0]?.n ?? '0');
      totalMatched += matched;

      if (matched === 0) {
        console.log(`  · 0 rows match: "${r.from.slice(0, 60)}…" (skipped)`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  · would update ${matched} rows: "${r.from.slice(0, 60)}…"`);
        continue;
      }

      const result = await client.query(
        `UPDATE personas
         SET vector = jsonb_set(vector, '{voice_sample}', to_jsonb($2::text), false)
         WHERE vector ->> 'voice_sample' = $1`,
        [r.from, r.to],
      );
      totalUpdated += result.rowCount ?? 0;
      console.log(`  · updated ${result.rowCount} rows: "${r.from.slice(0, 60)}…"`);
    }

    console.log('');
    console.log(
      `${DRY_RUN ? '[DRY-RUN] ' : ''}Done. matched=${totalMatched} updated=${totalUpdated}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
