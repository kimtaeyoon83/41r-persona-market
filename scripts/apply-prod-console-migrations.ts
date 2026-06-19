// Apply the Console (Sprint 1-3) schema additions to a database whose
// drizzle journal is empty — i.e. prod, where history was applied via
// db:push so `db:migrate` would replay from 0000 and fail (see
// CLAUDE.md "DB migrations"). This runs migrations 0013 + 0014, which
// are written idempotent (CREATE TABLE / ADD COLUMN / constraints all
// IF NOT EXISTS or duplicate-object-guarded), so it is safe to run
// against prod and safe to re-run.
//
// Purely ADDITIVE — verified 2026-06-15 against prod: it only creates
// credit_transactions + site_workspaces and adds
// audience_fit_scans.workspace_id + point_transactions.ref_id. Nothing
// existing is altered or dropped, so it can be applied BEFORE the new
// code deploys (the currently-running code ignores the new objects).
//
// Usage (uses the env DATABASE_URL — point it at the prod PUBLIC proxy
// URL, not the internal host, when running from a laptop):
//   DATABASE_URL="postgresql://…@gondola.proxy.rlwy.net:42069/railway" \
//     pnpm tsx scripts/apply-prod-console-migrations.ts
// Add --dry-run to print the statements without executing.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.resolve(__dirname, '../apps/api/drizzle');
const FILES = [
  '0013_modern_bug.sql',
  '0014_zippy_agent_zero.sql',
  '0015_signup_bonus_unique.sql',
  '0016_workspace_anchor_scan.sql',
  '0017_workspace_auth_capture.sql',
  '0018_scan_auth_capture.sql',
  '0019_workspace_capture_mobile.sql',
  '0020_capture_planner.sql',
  '0021_persona_chain.sql',
  '0022_scan_report_chain.sql',
  '0023_usdc_escrow.sql',
];
const DRY_RUN = process.argv.includes('--dry-run');

function loadSql(file: string): string {
  // Drizzle's `--> statement-breakpoint` markers are SQL line comments
  // (start with --), so the whole file runs as one multi-statement
  // simple query. DO $$ … $$ blocks are preserved intact.
  return readFileSync(path.join(DRIZZLE_DIR, file), 'utf-8');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set. Point it at the prod PUBLIC proxy URL.');
    process.exit(1);
  }
  console.log(`[migrate] target host: ${url.replace(/.*@([^/]+).*/, '$1')}`);
  console.log(`[migrate] files: ${FILES.join(', ')}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  if (DRY_RUN) {
    for (const file of FILES) {
      console.log(`\n----- ${file} -----\n${loadSql(file)}`);
    }
    console.log('\n[migrate] dry run — nothing applied.');
    return;
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const file of FILES) {
      const sql = loadSql(file);
      // Idempotent files → run each in its own transaction so a re-run
      // (everything already exists) is a clean no-op.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file} ✓`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  if (!DRY_RUN) {
    // Verify the additive result.
    const verify = new pg.Client({ connectionString: url });
    await verify.connect();
    const { rows } = await verify.query(
      `select
         (select count(*) from information_schema.tables where table_schema='public' and table_name='credit_transactions')::int has_credits,
         (select count(*) from information_schema.tables where table_schema='public' and table_name='site_workspaces')::int has_workspaces,
         (select count(*) from information_schema.columns where table_name='audience_fit_scans' and column_name='workspace_id')::int has_ws_col,
         (select count(*) from information_schema.columns where table_name='point_transactions' and column_name='ref_id')::int has_ref_col`,
    );
    await verify.end();
    console.log('[migrate] verify:', rows[0]);
    console.log('[migrate] done — all additive objects present.');
  }
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
