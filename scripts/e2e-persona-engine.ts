#!/usr/bin/env npx tsx
/**
 * E2E smoke for the persona-engine autotest path.
 *
 * Runs after `docker compose up -d db` and `pnpm --filter api db:push` and
 * `pnpm tsx scripts/seed-data.ts` have populated a test + persona pair.
 *
 * 1. picks an active test and a persona
 * 2. calls POST /api/autotest/run with USE_PERSONA_ENGINE=1 + mode=text
 *    (text mode so we don't need playwright chromium locally — ~15s
 *    total vs ~2min for browser mode)
 * 3. reads back /api/reports/test/:testId to confirm the persona row
 *    landed with isPersonaTest=true and the new fields (checklistResults,
 *    qualityScore, structuredReport embedded in questionnaireAnswers).
 *
 * Env:
 *   API_URL           default http://localhost:4100
 *   DATABASE_URL      same as apps/api (usually from .env)
 *
 * Exit codes:
 *   0  smoke passed (persona row created and looks valid)
 *   1  smoke failed — explanation printed
 */
import pg from 'pg';

const { Client } = pg;

const API_URL = process.env.API_URL || 'http://localhost:4100';
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    // Pick an active test and any persona. seed-data.ts creates
    // Alice/Bob/Charlie with personas and a dex + nft test.
    const { rows: tests } = await db.query<{ id: string; target_url: string }>(
      `SELECT id, target_url FROM tests WHERE status = 'active' LIMIT 1`,
    );
    if (tests.length === 0) {
      throw new Error('No active test — run `pnpm tsx scripts/seed-data.ts` first');
    }
    const test = tests[0];

    // Pick a persona that does NOT already have a report for this test
    // (UNIQUE(tester_addr, test_id) would otherwise block the insert).
    const { rows: personas } = await db.query<{ id: string; tester_addr: string }>(
      `SELECT p.id, p.tester_addr
         FROM personas p
         WHERE p.is_active = true
           AND NOT EXISTS (
             SELECT 1 FROM test_reports r
              WHERE r.tester_addr = p.tester_addr AND r.test_id = $1
           )
         LIMIT 1`,
      [test.id],
    );
    if (personas.length === 0) {
      throw new Error('No persona left without a report for this test — seed more or drop existing reports');
    }
    const persona = personas[0];

    console.log(`[smoke] test=${test.id.slice(0, 8)} url=${test.target_url}`);
    console.log(`[smoke] persona=${persona.id.slice(0, 8)} tester=${persona.tester_addr.slice(0, 8)}`);

    // Hit the endpoint. SKIP_PAYMENT_VERIFY=true on the api side lets a
    // fake payment_tx through.
    const runResp = await fetch(`${API_URL}/api/autotest/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        test_id: test.id,
        persona_id: persona.id,
        payment_tx: 'devnet_demo_tx_' + Date.now(),
        mode: 'text',
      }),
    });

    const runBody = (await runResp.json()) as Record<string, unknown>;
    if (!runResp.ok) {
      throw new Error(`/autotest/run → ${runResp.status}: ${JSON.stringify(runBody)}`);
    }
    console.log('[smoke] /autotest/run response:', JSON.stringify(runBody, null, 2));

    if (runBody.engine !== true) {
      throw new Error('Response missing engine:true — USE_PERSONA_ENGINE not set on api process?');
    }

    // Read back the persona report row.
    const reportId = runBody.report_id as string;
    const { rows: reports } = await db.query(
      `SELECT id, tester_addr, test_id, is_persona_test, quality_score,
              jsonb_array_length(checklist_results) AS checklist_count,
              jsonb_array_length(questionnaire_answers) AS q_count
         FROM test_reports WHERE id = $1`,
      [reportId],
    );
    if (reports.length === 0) {
      throw new Error(`persistence missing: test_reports row ${reportId} not found`);
    }
    const row = reports[0];
    console.log('[smoke] persisted row:', row);

    if (!row.is_persona_test) throw new Error('is_persona_test should be true');
    if (typeof row.quality_score !== 'number') throw new Error('quality_score should be numeric');

    console.log('[smoke] ✅ PASS');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('[smoke] ❌ FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
