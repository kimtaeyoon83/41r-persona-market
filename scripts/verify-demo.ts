#!/usr/bin/env npx tsx
/**
 * 41R Persona Market — Demo Verification Script
 *
 * Run with: npx tsx scripts/verify-demo.ts
 *
 * Checks all prerequisites for the demo:
 *   - DB connection
 *   - Table row counts
 *   - Persona existence
 *   - Tester qualification (testsDone >= 3)
 *   - Active tests available
 */

import pg from 'pg';

const { Client } = pg;

const CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://admin:admin41rpm@localhost:5432/persona_market';

// ─── Types ───────────────────────────────────────────────
interface CheckResult {
  label: string;
  passed: boolean;
  detail: string;
}

// ─── Helpers ─────────────────────────────────────────────
function icon(passed: boolean): string {
  return passed ? '[PASS]' : '[FAIL]';
}

function divider(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log('\n  41R Persona Market — Demo Verification');
  console.log('  ======================================\n');

  const results: CheckResult[] = [];
  const client = new Client({ connectionString: CONNECTION_STRING });

  // ── Check 1: DB Connection ──
  try {
    await client.connect();
    results.push({ label: 'Database connection', passed: true, detail: 'Connected to persona_market' });
  } catch (err) {
    results.push({ label: 'Database connection', passed: false, detail: `Failed: ${(err as Error).message}` });
    printResults(results);
    process.exit(1);
  }

  // ── Check 2: Table row counts ──
  divider('Table Row Counts');

  const tables = ['companies', 'tests', 'test_cases', 'testers', 'test_reports', 'personas', 'settlements'];
  const expectedMin: Record<string, number> = {
    companies: 1,
    tests: 1,
    test_cases: 9,
    testers: 3,
    test_reports: 3,
    personas: 3,
    settlements: 1,
  };

  for (const table of tables) {
    try {
      const res = await client.query(`SELECT COUNT(*)::int as count FROM ${table}`);
      const count = res.rows[0].count;
      const min = expectedMin[table] || 1;
      const passed = count >= min;
      const detail = `${count} rows (need >= ${min})`;
      results.push({ label: `Table: ${table}`, passed, detail });
      console.log(`  ${icon(passed)} ${table.padEnd(16)} ${detail}`);
    } catch (err) {
      results.push({ label: `Table: ${table}`, passed: false, detail: `Query failed: ${(err as Error).message}` });
      console.log(`  ${icon(false)} ${table.padEnd(16)} Query failed`);
    }
  }

  // ── Check 3: Active tests exist ──
  divider('Active Tests');

  try {
    const res = await client.query(`
      SELECT t.id, t.target_url, t.budget_usdc, t.status,
             (SELECT COUNT(*)::int FROM test_cases tc WHERE tc.test_id = t.id) as case_count
      FROM tests t
      WHERE t.status = 'active'
    `);

    const hasActiveTest = res.rows.length >= 1;
    results.push({ label: 'At least 1 active test', passed: hasActiveTest, detail: `${res.rows.length} active test(s)` });
    console.log(`  ${icon(hasActiveTest)} ${res.rows.length} active test(s) found`);

    for (const row of res.rows) {
      const hasCases = row.case_count >= 9;
      results.push({
        label: `Test cases for ${row.target_url}`,
        passed: hasCases,
        detail: `${row.case_count} cases (need >= 9)`,
      });
      console.log(`       ${row.target_url}`);
      console.log(`         Budget: $${row.budget_usdc} USDC`);
      console.log(`         Test cases: ${row.case_count} ${icon(hasCases)}`);
    }
  } catch (err) {
    results.push({ label: 'Active tests query', passed: false, detail: `Failed: ${(err as Error).message}` });
  }

  // ── Check 4: Qualified testers (testsDone >= 3) ──
  divider('Qualified Testers (tests_done >= 3)');

  try {
    const res = await client.query(`
      SELECT t.display_name, t.wallet_address, t.tests_done, t.persona_id,
             (SELECT COUNT(*)::int FROM test_reports tr WHERE tr.tester_addr = t.wallet_address) as actual_reports
      FROM testers t
      WHERE t.tests_done >= 3
      ORDER BY t.tests_done DESC
    `);

    const hasQualified = res.rows.length >= 3;
    results.push({ label: 'At least 3 testers with testsDone>=3', passed: hasQualified, detail: `${res.rows.length} qualified` });
    console.log(`  ${icon(hasQualified)} ${res.rows.length} qualified tester(s)`);

    for (const row of res.rows) {
      const hasPersona = !!row.persona_id;
      const reportsMatch = row.actual_reports >= 3;
      console.log(`       ${row.display_name}`);
      console.log(`         tests_done: ${row.tests_done}, actual reports: ${row.actual_reports} ${icon(reportsMatch)}`);
      console.log(`         persona: ${hasPersona ? row.persona_id.slice(0, 8) + '...' : 'none'} ${icon(hasPersona)}`);
    }
  } catch (err) {
    results.push({ label: 'Qualified testers query', passed: false, detail: `Failed: ${(err as Error).message}` });
  }

  // ── Check 5: Personas exist and are valid ──
  divider('Personas');

  try {
    const res = await client.query(`
      SELECT p.id, p.tester_addr, p.is_active, p.sas_attest_id,
             p.vector::text as vector_text,
             t.display_name
      FROM personas p
      JOIN testers t ON t.wallet_address = p.tester_addr
      ORDER BY t.display_name
    `);

    const hasPersonas = res.rows.length >= 3;
    results.push({ label: 'At least 3 personas exist', passed: hasPersonas, detail: `${res.rows.length} persona(s)` });
    console.log(`  ${icon(hasPersonas)} ${res.rows.length} persona(s) found`);

    for (const row of res.rows) {
      let vector: any;
      try {
        vector = JSON.parse(row.vector_text);
      } catch {
        vector = null;
      }

      const hasVector = vector && vector.test_style && vector.expertise && vector.feedback_pattern && vector.reliability && vector.voice_sample;
      const isActive = row.is_active === true;
      const hasAttest = !!row.sas_attest_id;

      results.push({
        label: `Persona vector for ${row.display_name}`,
        passed: !!hasVector,
        detail: hasVector ? 'Complete vector data' : 'Missing vector fields',
      });

      console.log(`       ${row.display_name} (${row.id.slice(0, 8)}...)`);
      console.log(`         Active: ${isActive} ${icon(isActive)}`);
      console.log(`         Vector complete: ${icon(!!hasVector)}`);
      console.log(`         SAS attestation: ${hasAttest ? row.sas_attest_id : 'none'} ${icon(hasAttest)}`);

      if (hasVector) {
        console.log(`         DeFi: ${vector.expertise.defi}, NFT: ${vector.expertise.nft}, Quality: ${vector.reliability.quality_score}`);
      }
    }
  } catch (err) {
    results.push({ label: 'Personas query', passed: false, detail: `Failed: ${(err as Error).message}` });
  }

  // ── Check 6: Settlements ──
  divider('Settlements');

  try {
    const res = await client.query(`
      SELECT s.id, s.settlement_type, s.amount_token, s.fee_collected,
             s.payee_addr, t.display_name as payee_name
      FROM settlements s
      LEFT JOIN testers t ON t.wallet_address = s.payee_addr
      ORDER BY s.settled_at
    `);

    const hasSettlements = res.rows.length >= 3;
    results.push({ label: 'At least 3 settlements', passed: hasSettlements, detail: `${res.rows.length} settlement(s)` });
    console.log(`  ${icon(hasSettlements)} ${res.rows.length} settlement(s) found`);

    let totalPaid = 0;
    let totalFees = 0;
    for (const row of res.rows) {
      totalPaid += row.amount_token;
      totalFees += row.fee_collected || 0;
      console.log(`       ${row.payee_name || row.payee_addr.slice(0, 12) + '...'}: $${row.amount_token} ${row.settlement_type.toUpperCase()} (fee: $${row.fee_collected})`);
    }
    console.log(`       Total paid: $${totalPaid.toFixed(2)} | Total fees: $${totalFees.toFixed(2)}`);
  } catch (err) {
    results.push({ label: 'Settlements query', passed: false, detail: `Failed: ${(err as Error).message}` });
  }

  // ── Final Summary ──
  printResults(results);

  await client.end();

  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

function printResults(results: CheckResult[]) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  VERIFICATION SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`\n  ${passed}/${total} checks passed`);

  if (failed > 0) {
    console.log(`\n  Failed checks:`);
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ${icon(false)} ${r.label}: ${r.detail}`);
    }
  }

  console.log('');

  if (failed === 0) {
    console.log('  ALL CHECKS PASSED — Demo environment is ready!');
  } else {
    console.log(`  ${failed} CHECK(S) FAILED — Run "npx tsx scripts/seed-data.ts" to fix.`);
  }

  console.log('');
}

main().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
