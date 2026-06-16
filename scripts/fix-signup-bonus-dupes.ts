/**
 * One-off: clean duplicate signup-bonus credit rows + add a partial
 * unique index so the race can never recur at the DB layer.
 *
 * The duplicates came from a concurrency race in ensureSignupBonus
 * (check-then-insert with no DB uniqueness) firing on the first authed
 * request burst after a process restart. See services/credits.ts.
 *
 * Usage:
 *   PROD_DB_URL="postgresql://…/railway" pnpm tsx scripts/fix-signup-bonus-dupes.ts          # dry-run (report only)
 *   PROD_DB_URL="postgresql://…/railway" APPLY=1 pnpm tsx scripts/fix-signup-bonus-dupes.ts  # dedup + index
 */
import pg from 'pg';

const url = process.env.PROD_DB_URL;
if (!url) {
  console.error('PROD_DB_URL is required');
  process.exit(1);
}
const apply = process.env.APPLY === '1';

const SIGNUP_REASONS = ['signup_bonus', 'signup_bonus_wallet', 'signup_bonus_upgrade'];

async function main() {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    // ── Report: who has duplicate grant rows per (user, reason) ──
    const dupes = await pool.query(
      `SELECT user_id, reason, count(*)::int AS c, sum(amount_cents)::int AS cents
         FROM credit_transactions
        WHERE reason = ANY($1)
        GROUP BY user_id, reason
       HAVING count(*) > 1
        ORDER BY c DESC`,
      [SIGNUP_REASONS],
    );
    const extraRows = dupes.rows.reduce((s, r) => s + (r.c - 1), 0);
    const extraCents = dupes.rows.reduce(
      (s, r) => s + Math.round((r.cents / r.c) * (r.c - 1)),
      0,
    );
    console.log(`\n=== signup-bonus duplicate report ===`);
    console.log(`affected (user,reason) groups : ${dupes.rows.length}`);
    console.log(`extra rows to delete          : ${extraRows}`);
    console.log(`over-granted (approx)         : $${(extraCents / 100).toFixed(2)}`);
    for (const r of dupes.rows.slice(0, 20)) {
      console.log(`  ${r.user_id}  ${r.reason}  x${r.c}  ($${(r.cents / 100).toFixed(2)})`);
    }

    if (!apply) {
      console.log(`\n(dry-run — set APPLY=1 to delete extras + create unique index)\n`);
      return;
    }

    await pool.query('BEGIN');
    // Keep the earliest row per (user_id, reason); delete the rest.
    const del = await pool.query(
      `DELETE FROM credit_transactions
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   row_number() OVER (
                     PARTITION BY user_id, reason
                     ORDER BY created_at ASC, id ASC
                   ) AS rn
              FROM credit_transactions
             WHERE reason = ANY($1)
          ) t WHERE rn > 1
        )`,
      [SIGNUP_REASONS],
    );
    console.log(`\ndeleted ${del.rowCount} duplicate row(s)`);

    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_signup_unique
         ON credit_transactions (user_id, reason)
       WHERE reason IN ('signup_bonus','signup_bonus_wallet','signup_bonus_upgrade')`,
    );
    console.log('created partial unique index credit_transactions_signup_unique');
    await pool.query('COMMIT');
    console.log('\nDONE.\n');
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
