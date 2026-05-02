#!/usr/bin/env npx tsx
/**
 * Backfill site classifier (B7+B8) onto scans that landed before
 * services/site_classifier.ts existed. Those scans have the
 * placeholder triple `category='DeFi', categoryConfidence=0.5,
 * oneLinePitch=null`. Re-runs classifySite() against the cached
 * screenshot when present and updates the row in place.
 *
 * Idempotent: only touches rows matching the placeholder shape AND
 * having a screenshot. Re-runs after success are no-ops.
 *
 * Cost: ~$0.0008 per scan (Haiku vision, ~700 tokens). Caps at 25
 * scans per run to bound cost; bump --max to override.
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... pnpm tsx scripts/backfill-site-classifier.ts
 *   ... --dry-run
 *   ... --max 50
 */

import pg from 'pg';
import { classifySite } from '../apps/api/src/services/site_classifier.js';

const { Client } = pg;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY required (Haiku vision call)');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const maxIdx = process.argv.indexOf('--max');
const max =
  maxIdx >= 0 && process.argv[maxIdx + 1]
    ? parseInt(process.argv[maxIdx + 1]!, 10)
    : 25;

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  const candidates = await client.query<{
    id: string;
    target_url: string;
    capture_screenshot_urls: string[] | null;
  }>(
    `SELECT id::text, target_url, capture_screenshot_urls
       FROM audience_fit_scans
      WHERE category = 'DeFi'
        AND category_confidence = 0.5
        AND one_line_pitch IS NULL
        AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT $1`,
    [max],
  );

  const withScreenshot = candidates.rows.filter(
    (r) =>
      Array.isArray(r.capture_screenshot_urls) &&
      r.capture_screenshot_urls.length > 0,
  );

  console.log(
    `Found ${candidates.rows.length} placeholder-classified scans, ` +
      `${withScreenshot.length} have a screenshot to classify` +
      (dryRun ? ' (dry-run)' : ''),
  );

  let ok = 0;
  let skip = 0;
  let fail = 0;
  for (const row of withScreenshot) {
    process.stdout.write(
      `  ${row.id.slice(0, 8)} ${row.target_url.slice(0, 30).padEnd(30)} ... `,
    );
    if (dryRun) {
      console.log('would classify');
      ok++;
      continue;
    }
    try {
      const cls = await classifySite(
        row.target_url,
        row.capture_screenshot_urls ?? [],
      );
      if (!cls) {
        console.log('classifier returned null (image unreadable / API fail)');
        fail++;
        continue;
      }
      await client.query(
        `UPDATE audience_fit_scans
            SET category            = $1,
                category_confidence = $2,
                one_line_pitch      = $3
          WHERE id = $4`,
        [cls.category, cls.category_confidence, cls.one_line_pitch, row.id],
      );
      console.log(
        `${cls.category} ${(cls.category_confidence * 100).toFixed(0)}% — ` +
          `"${cls.one_line_pitch.slice(0, 60)}${cls.one_line_pitch.length > 60 ? '…' : ''}"`,
      );
      ok++;
    } catch (e) {
      console.log(`error: ${e instanceof Error ? e.message : 'unknown'}`);
      fail++;
    }
  }

  const noScreenshot = candidates.rows.length - withScreenshot.length;
  if (noScreenshot > 0) {
    console.log(
      `${noScreenshot} placeholder scans skipped — no cached screenshot ` +
        `(simulator runs or pre-capture-step rows).`,
    );
    skip = noScreenshot;
  }

  console.log(
    `Done — ${ok} ${dryRun ? 'would update' : 'updated'}, ${fail} failed, ${skip} skipped.`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
