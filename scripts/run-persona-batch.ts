#!/usr/bin/env npx tsx
/**
 * Persona batch runner.
 *
 * Walks every (persona, active test) pair in the local DB, and for
 * pairs that don't yet have a persona report, calls
 * POST /api/autotest/run with mode=text. Purpose: populate enough
 * samples to make the /experiment/[testId] dashboard non-trivial.
 *
 * Requires the api server to be running with USE_PERSONA_ENGINE=1 and
 * the persona-engine reachable at PERSONA_ENGINE_URL. mode=text keeps
 * each call at ~15s (no Playwright session) so a 5 persona × 2 test
 * batch completes in ~2.5min.
 *
 * Env:
 *   API_URL       default http://localhost:4100
 *   DATABASE_URL  same as apps/api
 *   CONCURRENCY   default 2 (don't overwhelm Anthropic rate limits)
 *
 * Usage:
 *   pnpm tsx scripts/run-persona-batch.ts
 */
import pg from 'pg';

const { Client } = pg;

const API_URL = process.env.API_URL || 'http://localhost:4100';
const DB_URL = process.env.DATABASE_URL;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);
// --limit N truncates to the first N pairs — useful for token-tracking
// experiments where you don't want to burn the full 40-run batch.
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT = LIMIT_IDX >= 0 ? Number(process.argv[LIMIT_IDX + 1] || '0') : 0;

if (!DB_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

interface Pair {
  personaId: string;
  testerAddr: string;
  testId: string;
  targetUrl: string;
}

async function listMissingPairs(db: pg.Client): Promise<Pair[]> {
  const { rows } = await db.query<Pair>(
    `SELECT p.id AS "personaId",
            p.tester_addr AS "testerAddr",
            t.id AS "testId",
            t.target_url AS "targetUrl"
       FROM personas p
       CROSS JOIN tests t
       WHERE p.is_active = true
         AND t.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM test_reports r
            WHERE r.tester_addr = p.tester_addr
              AND r.test_id = t.id
              AND r.is_persona_test = true
         )
       ORDER BY t.id, p.id`,
  );
  return rows;
}

async function runOne(pair: Pair): Promise<{ ok: boolean; note: string }> {
  const body = {
    test_id: pair.testId,
    persona_id: pair.personaId,
    payment_tx: `devnet_demo_batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    mode: 'text' as const,
  };
  try {
    const resp = await fetch(`${API_URL}/api/autotest/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await resp.json()) as Record<string, unknown>;
    if (!resp.ok) {
      return { ok: false, note: `HTTP ${resp.status}: ${JSON.stringify(json).slice(0, 140)}` };
    }
    return {
      ok: true,
      note: `outcome=${json.outcome} q=${json.quality_score}`,
    };
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message : String(err) };
  }
}

async function runBatch<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  onEach: (idx: number, item: T, result: R) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const go = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      const r = await worker(items[i]);
      results[i] = r;
      onEach(i, items[i], r);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => go()));
  return results;
}

async function printComparisonForEachTest(db: pg.Client): Promise<void> {
  const { rows: tests } = await db.query<{ id: string; target_url: string }>(
    `SELECT id, target_url FROM tests WHERE status='active'`,
  );
  for (const t of tests) {
    try {
      const resp = await fetch(`${API_URL}/api/reports/compare/${t.id}`);
      if (!resp.ok) {
        console.log(`[compare] ${t.id.slice(0, 8)} (${t.target_url}): HTTP ${resp.status}`);
        continue;
      }
      const c = (await resp.json()) as Record<string, any>;
      const cmp = c.comparison ?? {};
      console.log(
        `[compare] test=${t.id.slice(0, 8)} url=${t.target_url}\n` +
        `  manual=${c.manual?.count} persona=${c.persona?.count}\n` +
        `  item_agreement_rate=${cmp.item_agreement_rate} (${cmp.item_agreement?.length ?? 0} items)\n` +
        `  correlation.paired=${cmp.correlation?.paired_count} ρ=${cmp.correlation?.spearman}\n` +
        `  rating_KS=${cmp.rating_distribution?.ks_statistic} (h_mean=${cmp.rating_distribution?.manual_mean}, p_mean=${cmp.rating_distribution?.persona_mean})\n` +
        `  convergence_points=${cmp.convergence?.length ?? 0}`,
      );
    } catch (err) {
      console.log(`[compare] ${t.id.slice(0, 8)} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    let pairs = await listMissingPairs(db);
    const total = pairs.length;
    if (LIMIT > 0 && total > LIMIT) {
      pairs = pairs.slice(0, LIMIT);
      console.log(`[batch] truncating to first ${LIMIT} of ${total} missing pairs (--limit)`);
    }
    console.log(`[batch] ${pairs.length} (persona, test) pairs to run`);
    if (pairs.length === 0) {
      console.log('[batch] nothing to do');
      await printComparisonForEachTest(db);
      return;
    }

    const started = Date.now();
    let okCount = 0;
    let failCount = 0;

    await runBatch(pairs, runOne, CONCURRENCY, (idx, pair, r) => {
      const prefix = `[${idx + 1}/${pairs.length}]`;
      const label = `persona=${pair.personaId.slice(0, 8)} test=${pair.testId.slice(0, 8)}`;
      if (r.ok) {
        okCount++;
        console.log(`${prefix} ✓ ${label} ${r.note}`);
      } else {
        failCount++;
        console.log(`${prefix} ✗ ${label} ${r.note}`);
      }
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n[batch] done in ${elapsed}s — ${okCount} ok, ${failCount} failed\n`);

    await printComparisonForEachTest(db);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('[batch] unhandled error:', err);
  process.exit(1);
});
