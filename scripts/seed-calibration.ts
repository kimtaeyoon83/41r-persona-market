#!/usr/bin/env npx tsx
/**
 * Seed the local DB with ~600 synthetic calibration_records spanning
 * 2026-01 through 2026-04. Realistic correlation patterns matching
 * spec §5.4 sample:
 *   Engagement   r ≈ 0.78  (High)
 *   Task Success r ≈ 0.71  (High)
 *   Happiness    r ≈ 0.65  (Medium-High)
 *   Adoption     r ≈ 0.38  (Low-Medium)
 *   Retention    r ≈ 0.18  (Low)
 *
 * Idempotent: deletes existing rows first (no other consumers yet).
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/seed-calibration.ts
 */

import pg from 'pg';

const { Client } = pg;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

let rngState = 41410001;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

function gauss(): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Generate (llm, gt) pair with target Pearson r:
//   llm = uniform 0-100
//   gt  = r * (llm - 50) + sqrt(1-r²) * noise + 50, clipped 0-100
function pairFor(targetR: number): [number, number] {
  const llm = rand() * 100;
  const noise = gauss() * 30;
  const gt =
    targetR * (llm - 50) +
    Math.sqrt(Math.max(0, 1 - targetR * targetR)) * noise +
    50;
  return [
    Math.max(0, Math.min(100, llm)),
    Math.max(0, Math.min(100, gt)),
  ];
}

const DIM_TARGET_R: Record<string, number> = {
  engagement: 0.78,
  task_success: 0.71,
  happiness: 0.65,
  adoption: 0.38,
  retention: 0.18,
};

// Source distribution per spec §5.4 (Track A dominant — automated
// weekly Stagehand runs; Track B fewer — quarterly human SUS;
// Track C smallest — opt-in analytics).
const SOURCE_WEIGHTS: Array<{ src: string; weight: number }> = [
  { src: 'stagehand', weight: 70 },
  { src: 'human_baseline', weight: 17 },
  { src: 'analytics', weight: 5 },
];

function pickSource(): string {
  const total = SOURCE_WEIGHTS.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const { src, weight } of SOURCE_WEIGHTS) {
    r -= weight;
    if (r <= 0) return src;
  }
  return 'stagehand';
}

const SITE_URLS = [
  'https://uniswap.org',
  'https://linear.app',
  'https://playcamp.io',
  'https://aave.com',
  'https://opensea.io',
  'https://figma.com',
  'https://notion.so',
];

function pickDate(): string {
  // Span 2026-01-01 to 2026-04-30 (current quarter window).
  const start = new Date('2026-01-01').getTime();
  const end = new Date('2026-04-30').getTime();
  const t = start + rand() * (end - start);
  return new Date(t).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    const before = await client.query(
      'SELECT count(*)::int AS n FROM calibration_records',
    );
    console.log(`existing records: ${before.rows[0].n}`);

    await client.query('DELETE FROM calibration_records');
    console.log('cleared existing records');

    const ROWS_PER_DIM = 120;
    let inserted = 0;

    for (const [dim, targetR] of Object.entries(DIM_TARGET_R)) {
      for (let i = 0; i < ROWS_PER_DIM; i++) {
        const [llm, gt] = pairFor(targetR);
        const delta = gt - llm;
        await client.query(
          `INSERT INTO calibration_records
           (date, site_url, persona_id, dimension, llm_inference, ground_truth, delta, source)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)`,
          [
            pickDate(),
            SITE_URLS[Math.floor(rand() * SITE_URLS.length)],
            dim,
            llm,
            gt,
            delta,
            pickSource(),
          ],
        );
        inserted += 1;
      }
    }

    console.log(`✓ inserted ${inserted} calibration records`);

    const stats = await client.query(`
      SELECT dimension,
             count(*)::int AS n,
             corr(llm_inference, ground_truth)::numeric(4, 3) AS r
      FROM calibration_records
      GROUP BY dimension
      ORDER BY r DESC NULLS LAST
    `);
    console.log('Per-dimension correlation:');
    for (const row of stats.rows) {
      console.log(`  ${row.dimension.padEnd(14)} n=${row.n}  r=${row.r}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
