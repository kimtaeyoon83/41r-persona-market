#!/usr/bin/env tsx
/**
 * E2E Integration Test — Full flow walkthrough
 *
 * Tests the complete 41R Persona Market flow:
 * 1. Company registers a test
 * 2. Tester registers profile
 * 3. Tester completes 3 manual tests
 * 4. Persona is generated
 * 5. Auto test is triggered
 *
 * Usage: npx tsx scripts/e2e-flow.ts
 * Requires: API running on localhost:4100
 */

const API = process.env.API_URL || 'http://localhost:4100';

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function log(step: string, detail: string) {
  console.log(`  [${step}] ${detail}`);
}

function pass(label: string) {
  console.log(`\x1b[32m  ✓ ${label}\x1b[0m`);
}

function fail(label: string, err: unknown) {
  console.log(`\x1b[31m  ✗ ${label}: ${err instanceof Error ? err.message : err}\x1b[0m`);
}

async function main() {
  console.log('\n=== 41R Persona Market — E2E Integration Test ===\n');

  // 0. Health check
  try {
    const health = await request('/api/health');
    pass(`API Health: ${health.status}`);
  } catch (err) {
    fail('API Health', err);
    console.log('\n  Make sure the API is running: pnpm dev\n');
    process.exit(1);
  }

  const companyWallet = `E2ECompany${Date.now().toString(36)}11111111111111111`;
  const testerWallet = `E2ETester${Date.now().toString(36)}111111111111111111`;

  // 1. Company registers a test
  console.log('\n--- Step 1: Company Registers Test ---');
  let testId: string;
  try {
    const result = await request('/api/test/register', {
      method: 'POST',
      body: JSON.stringify({
        target_url: 'https://example.com',
        requirements: 'Test the main page load and navigation',
        budget_usdc: 50,
        company_wallet: companyWallet,
      }),
    });
    testId = result.test.id;
    pass(`Test created: ${testId}`);
    log('Test Cases', `checklist: ${result.test_cases.checklist.length}, scenarios: ${result.test_cases.scenarios.length}, questionnaire: ${result.test_cases.questionnaire.length}`);
  } catch (err) {
    fail('Register Test', err);
    process.exit(1);
  }

  // 2. Tester registers
  console.log('\n--- Step 2: Tester Registers ---');
  try {
    await request('/api/tester/register', {
      method: 'POST',
      body: JSON.stringify({
        wallet_address: testerWallet,
        display_name: 'E2E Tester',
        profile: {
          expertise: ['defi', 'general_web'],
          experience_level: 'intermediate',
          preferred_domains: ['blockchain'],
          ui_preference: 'minimal',
          languages: ['en'],
          device_types: ['desktop'],
        },
      }),
    });
    pass(`Tester registered: ${testerWallet.slice(0, 16)}...`);
  } catch (err) {
    fail('Register Tester', err);
    process.exit(1);
  }

  // 3. Submit 3 test reports
  console.log('\n--- Step 3: Submit 3 Test Reports ---');
  let personaTriggered = false;

  for (let i = 1; i <= 3; i++) {
    try {
      const result = await request('/api/report/submit', {
        method: 'POST',
        body: JSON.stringify({
          tester_addr: testerWallet,
          test_id: testId!,
          checklist_results: [
            { id: 'CL01', status: 'passed', memo: `E2E test round ${i} - item 1` },
            { id: 'CL02', status: 'passed', memo: `E2E test round ${i} - item 2` },
            { id: 'CL03', status: i === 2 ? 'failed' : 'passed', memo: `E2E test round ${i} - item 3` },
            { id: 'CL04', status: 'passed', memo: `E2E test round ${i} - item 4` },
          ],
          scenario_log: [{
            id: 'SC01',
            timeline: [
              { time: new Date().toISOString(), action: `Started round ${i}` },
              { time: new Date().toISOString(), action: `Completed round ${i}` },
            ],
          }],
          questionnaire_answers: [
            { id: 'Q01', answer: 3 + i },
            { id: 'Q02', answer: `Round ${i} feedback: UI is clean but could use better error messages` },
            { id: 'Q03', answer: 6 + i },
            { id: 'Q04', answer: `Suggestion from round ${i}: Add loading states` },
          ],
        }),
      });

      pass(`Report ${i}/3 — quality: ${result.quality_score}, reward: $${result.reward_amount?.toFixed(2)}`);

      if (result.persona_triggered) {
        personaTriggered = true;
        log('Persona', 'Generation triggered!');
      }
    } catch (err) {
      fail(`Report ${i}`, err);
    }
  }

  // 4. Verify persona trigger
  console.log('\n--- Step 4: Persona Generation ---');
  if (personaTriggered) {
    try {
      const result = await request('/api/persona/generate', {
        method: 'POST',
        body: JSON.stringify({ tester_addr: testerWallet }),
      });
      pass(`Persona generated: ${result.persona.id}`);
      if (result.persona.sasAttestId) {
        log('SAS', `Attestation: ${result.persona.sasAttestId}`);
      }

      // 5. Auto test
      console.log('\n--- Step 5: Auto Test ---');
      try {
        const autoResult = await request('/api/autotest/run', {
          method: 'POST',
          body: JSON.stringify({
            test_id: testId!,
            persona_id: result.persona.id,
          }),
        });
        pass(`Auto test job started: ${autoResult.job_id}`);

        // Poll for completion (max 60s)
        let attempts = 0;
        while (attempts < 12) {
          await new Promise(r => setTimeout(r, 5000));
          const status = await request(`/api/autotest/status/${autoResult.job_id}`);
          log('Status', `${status.status} (${status.progress}%)`);
          if (status.status === 'completed') {
            pass(`Auto test completed! Report: ${status.report_id}`);
            break;
          }
          if (status.status === 'failed') {
            fail('Auto test', status.error);
            break;
          }
          attempts++;
        }
      } catch (err) {
        fail('Auto Test', err);
      }
    } catch (err) {
      fail('Persona Generation', err);
    }
  } else {
    log('Skip', 'Persona was not triggered (may already exist)');
  }

  // 6. Verify data
  console.log('\n--- Step 6: Data Verification ---');
  try {
    const tester = await request(`/api/tester/${testerWallet}`);
    pass(`Tester testsDone: ${tester.tester.testsDone}`);
    if (tester.persona) {
      pass(`Persona linked: ${tester.persona.id}`);
    }
  } catch (err) {
    fail('Verification', err);
  }

  try {
    const reports = await request(`/api/reports/test/${testId!}`);
    pass(`Total reports for test: ${reports.length}`);
  } catch (err) {
    fail('Reports check', err);
  }

  console.log('\n=== E2E Test Complete ===\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
