/**
 * AI Feature Verification Script
 * Tests all 6 AI-powered functions in the 41R Persona Market
 *
 * Usage: npx tsx scripts/test-ai-features.ts
 */

import 'dotenv/config';

const API = process.env.API_URL || 'http://localhost:4100';
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';
const INFO = '\x1b[36m[INFO]\x1b[0m';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`${PASS} ${name} (${ms}ms)`);
    passed++;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`${FAIL} ${name} (${ms}ms)`);
    console.log(`       ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ─── 1. Test Case Generation (Sonnet 4.6) ─────────────
async function testCaseGeneration() {
  console.log(`\n${INFO} === Feature 1: Test Case Generation (Sonnet 4.6) ===`);

  const res = await fetch(`${API}/api/test/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_url: 'https://raydium.io/swap',
      company_wallet: 'TestWallet_AI_Verify_111111111111111111111',
      requirements: 'Test the Raydium DEX swap functionality, token selection, and price impact display',
      budget_usdc: 30,
    }),
  });

  const data = await res.json();
  assert(res.ok, `HTTP ${res.status}: ${JSON.stringify(data)}`);
  assert(data.test_cases, 'Missing test_cases in response');

  const tc = data.test_cases;
  assert(Array.isArray(tc.checklist) && tc.checklist.length >= 4, `Expected 4+ checklist items, got ${tc.checklist?.length}`);
  assert(Array.isArray(tc.scenarios) && tc.scenarios.length >= 1, `Expected 1+ scenarios, got ${tc.scenarios?.length}`);
  assert(Array.isArray(tc.questionnaire) && tc.questionnaire.length >= 4, `Expected 4+ questionnaire items, got ${tc.questionnaire?.length}`);

  // Verify Zod schema compliance
  for (const item of tc.checklist) {
    assert(item.id && item.task && item.expected, `Checklist item missing fields: ${JSON.stringify(item)}`);
  }
  for (const sc of tc.scenarios) {
    assert(sc.id && sc.persona_type && sc.narrative && Array.isArray(sc.evaluation_points), `Scenario missing fields: ${JSON.stringify(sc)}`);
  }
  for (const q of tc.questionnaire) {
    assert(q.id && q.question && ['rating_1_5', 'rating_1_10', 'free_text'].includes(q.type), `Questionnaire item invalid: ${JSON.stringify(q)}`);
  }

  console.log(`       Checklist: ${tc.checklist.length} items`);
  console.log(`       Scenarios: ${tc.scenarios.length} (${tc.scenarios.map((s: any) => s.persona_type).join(', ')})`);
  console.log(`       Questionnaire: ${tc.questionnaire.length} items`);

  // Save test ID for later use
  return data.test.id;
}

// ─── 2. Quality Score (Haiku 4.5) ─────────────────────
async function testQualityScore() {
  console.log(`\n${INFO} === Feature 2: Quality Score Calculation (Haiku 4.5) ===`);

  const { calculateQualityScore } = await import('../apps/api/src/services/llm.js');

  const mockReport = {
    checklist_results: [
      { id: 'CL01', status: 'passed', memo: 'Page loads correctly with clear swap interface' },
      { id: 'CL02', status: 'passed', memo: 'SOL token selectable, auto-populated in input' },
      { id: 'CL03', status: 'failed', memo: 'USDC search took 5 seconds, laggy dropdown' },
    ],
    scenario_log: [{ id: 'SC01', timeline: [{ action: 'Navigated to swap page', time: '10:00' }] }],
    questionnaire_answers: [
      { id: 'Q01', answer: 4 },
      { id: 'Q02', answer: 'The interface is clean but token search is slow' },
    ],
  };

  const score = await calculateQualityScore(mockReport);
  assert(typeof score === 'number', `Expected number, got ${typeof score}`);
  assert(score >= 1.0 && score <= 5.0, `Score ${score} out of range [1.0, 5.0]`);
  console.log(`       Score: ${score}/5.0`);
}

// ─── 3. Keyword Extraction (Haiku 4.5) ───────────────
async function testKeywordExtraction() {
  console.log(`\n${INFO} === Feature 3: Keyword Extraction (Haiku 4.5) ===`);

  const { extractKeywords } = await import('../apps/api/src/services/llm.js');

  const text = 'Test the DeFi swap interface on Jupiter aggregator. Check SOL to USDC conversion, slippage settings, wallet connection with Phantom, and transaction confirmation flow.';
  const keywords = await extractKeywords(text);

  assert(Array.isArray(keywords), `Expected array, got ${typeof keywords}`);
  assert(keywords.length >= 3, `Expected 3+ keywords, got ${keywords.length}`);
  assert(keywords.every((k: unknown) => typeof k === 'string'), 'All keywords must be strings');
  console.log(`       Keywords: ${keywords.join(', ')}`);
}

// ─── 4. Persona Generation (Sonnet 4.6) ─────────────
async function testPersonaGeneration() {
  console.log(`\n${INFO} === Feature 4: Persona Generation (Sonnet 4.6) ===`);

  const { generatePersona } = await import('../apps/api/src/services/llm.js');

  const profile = { wallet: '0xDEMO', experience: 'DeFi trader, 2 years, mostly Solana DEXes' };
  const reports = [
    { checklist: [{ id: 'CL01', status: 'passed', memo: 'Clean UI, tokens load fast' }], quality: 4.2, focus: 'UI responsiveness and token listing accuracy' },
    { checklist: [{ id: 'CL01', status: 'passed', memo: 'Swap executed but high slippage warning unclear' }], quality: 3.8, focus: 'Security warnings and transaction clarity' },
    { checklist: [{ id: 'CL01', status: 'failed', memo: 'Mobile layout broken on small screens' }], quality: 4.5, focus: 'Cross-device compatibility and accessibility' },
  ];

  const persona = await generatePersona(profile, reports);

  // Validate PersonaVector structure
  assert(persona.test_style !== undefined, 'Missing test_style');
  assert(persona.expertise !== undefined, 'Missing expertise');
  assert(persona.feedback_pattern !== undefined, 'Missing feedback_pattern');
  assert(persona.reliability !== undefined, 'Missing reliability');
  assert(typeof persona.voice_sample === 'string' && persona.voice_sample.length > 10, 'voice_sample too short or missing');

  // Validate ranges [0, 1]
  const allValues = [
    ...Object.values(persona.test_style),
    ...Object.values(persona.expertise),
    ...Object.values(persona.feedback_pattern),
    ...Object.values(persona.reliability),
  ];
  for (const v of allValues) {
    assert(typeof v === 'number' && v >= 0 && v <= 1, `Value ${v} out of range [0, 1]`);
  }

  console.log(`       test_style: thoroughness=${persona.test_style.thoroughness}, ux_focus=${persona.test_style.ux_focus}`);
  console.log(`       expertise: defi=${persona.expertise.defi}, general_web=${persona.expertise.general_web}`);
  console.log(`       reliability: quality=${persona.reliability.quality_score}`);
  console.log(`       voice: "${persona.voice_sample.slice(0, 80)}..."`);
}

// ─── 5. Auto Test Report Generation (Sonnet 4.6) ────
async function testAutoTestReport() {
  console.log(`\n${INFO} === Feature 5: Auto Test Report Generation (Sonnet 4.6) ===`);

  const { generateAutoTestReport } = await import('../apps/api/src/services/llm.js');

  const persona = {
    test_style: { thoroughness: 0.85, speed: 0.6, ux_focus: 0.9, bug_detection: 0.7, creativity: 0.5 },
    expertise: { defi: 0.8, nft: 0.3, gaming: 0.1, ai_tools: 0.4, general_web: 0.7 },
    feedback_pattern: { ui_critical: 0.85, security_aware: 0.6, performance_sensitive: 0.7, accessibility_focus: 0.5, detail_oriented: 0.8 },
    reliability: { quality_score: 0.84, consistency: 0.9, response_rate: 1.0 },
    voice_sample: 'This tester is meticulous about UI details. They focus heavily on user flow clarity and always suggest concrete improvements. Tends to be constructive but firm about UX issues.',
  };

  const actionLog = [
    'Visited https://raydium.io/swap',
    '[CL01] Verify swap interface loads -> OK',
    '[CL02] Select SOL as input token -> OK',
    '[CL03] Select USDC as output token -> OK',
    '[CL04] Enter 1 SOL amount and check quote -> OK',
    '[CL05] Check wallet connection flow -> Failed (no wallet extension)',
  ];

  const testCases = {
    checklist: [
      { id: 'CL01', task: 'Verify swap interface loads', expected: 'Swap widget visible' },
      { id: 'CL02', task: 'Select SOL as input', expected: 'SOL selected in dropdown' },
    ],
    scenarios: [
      { id: 'SC01', persona_type: 'DeFi expert', narrative: 'Quick swap test', evaluation_points: ['Usability', 'Speed'] },
    ],
    questionnaire: [
      { id: 'Q01', question: 'How easy was the swap?', type: 'rating_1_5' as const },
    ],
  };

  // No screenshots for this test (text-only)
  const result = await generateAutoTestReport(persona, [], actionLog, testCases);

  assert(typeof result.textReport === 'string' && result.textReport.length > 50, `textReport too short: ${result.textReport?.length} chars`);
  assert(result.uxFeedback !== undefined, 'Missing uxFeedback');
  assert(typeof result.uxFeedback.overall_score === 'number', 'Missing overall_score');

  console.log(`       Report length: ${result.textReport.length} chars`);
  console.log(`       UX Scores: overall=${result.uxFeedback.overall_score}, usability=${result.uxFeedback.usability}`);
  console.log(`       Issues: ${(result.uxFeedback.issues_found as string[])?.length || 0} found`);
  console.log(`       Suggestions: ${(result.uxFeedback.suggestions as string[])?.length || 0}`);
  console.log(`       Report preview: "${result.textReport.slice(0, 120)}..."`);
}

// ─── 6. Persona Matching + Keywords (Haiku 4.5) ─────
async function testPersonaMatching() {
  console.log(`\n${INFO} === Feature 6: Persona Matching (Haiku Keywords + Scoring) ===`);

  const { matchPersonas } = await import('../apps/api/src/services/matching.js');

  const personas = [
    {
      id: 'p1', testerAddr: 'wallet_defi_expert',
      vector: {
        test_style: { thoroughness: 0.9, speed: 0.5, ux_focus: 0.8, bug_detection: 0.7, creativity: 0.6 },
        expertise: { defi: 0.95, nft: 0.2, gaming: 0.1, ai_tools: 0.3, general_web: 0.5 },
        feedback_pattern: { ui_critical: 0.8, security_aware: 0.9, performance_sensitive: 0.7, accessibility_focus: 0.3, detail_oriented: 0.9 },
        reliability: { quality_score: 0.85, consistency: 0.9, response_rate: 0.95 },
        voice_sample: 'Detailed DeFi expert',
      },
    },
    {
      id: 'p2', testerAddr: 'wallet_gaming_tester',
      vector: {
        test_style: { thoroughness: 0.6, speed: 0.9, ux_focus: 0.5, bug_detection: 0.8, creativity: 0.7 },
        expertise: { defi: 0.1, nft: 0.4, gaming: 0.95, ai_tools: 0.2, general_web: 0.6 },
        feedback_pattern: { ui_critical: 0.5, security_aware: 0.3, performance_sensitive: 0.9, accessibility_focus: 0.4, detail_oriented: 0.5 },
        reliability: { quality_score: 0.7, consistency: 0.6, response_rate: 0.8 },
        voice_sample: 'Fast gaming tester',
      },
    },
    {
      id: 'p3', testerAddr: 'wallet_web_generalist',
      vector: {
        test_style: { thoroughness: 0.7, speed: 0.7, ux_focus: 0.7, bug_detection: 0.6, creativity: 0.5 },
        expertise: { defi: 0.3, nft: 0.3, gaming: 0.3, ai_tools: 0.5, general_web: 0.9 },
        feedback_pattern: { ui_critical: 0.6, security_aware: 0.5, performance_sensitive: 0.6, accessibility_focus: 0.7, detail_oriented: 0.6 },
        reliability: { quality_score: 0.75, consistency: 0.8, response_rate: 0.9 },
        voice_sample: 'Well-rounded web tester',
      },
    },
  ];

  const results = await matchPersonas(
    'DeFi swap testing on Solana DEX — check liquidity pools and staking features',
    'https://raydium.io/swap',
    personas,
  );

  assert(Array.isArray(results) && results.length > 0, 'No match results');
  assert(results[0].persona.id === 'p1', `Expected DeFi expert (p1) to rank first, got ${results[0].persona.id}`);
  assert(results[0].score > results[results.length - 1].score, 'Scores not properly ranked');

  for (const r of results) {
    console.log(`       #${results.indexOf(r) + 1} ${r.persona.id} (${r.persona.vector.voice_sample}) — score: ${r.score}, keywords: [${r.matchedKeywords.join(', ')}]`);
  }
}

// ─── Run All ─────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   41R Persona Market — AI Feature Verification  ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Sonnet: claude-sonnet-4-6                      ║`);
  console.log(`║  Haiku:  claude-haiku-4-5-20251001              ║`);
  console.log('╚══════════════════════════════════════════════════╝');

  // Feature 1: Test Case Generation (API endpoint)
  await test('1. Test Case Generation (Sonnet 4.6)', testCaseGeneration);

  // Feature 2: Quality Score (direct LLM call)
  await test('2. Quality Score Calculation (Haiku 4.5)', testQualityScore);

  // Feature 3: Keyword Extraction (direct LLM call)
  await test('3. Keyword Extraction (Haiku 4.5)', testKeywordExtraction);

  // Feature 4: Persona Generation (direct LLM call)
  await test('4. Persona Vector Generation (Sonnet 4.6)', testPersonaGeneration);

  // Feature 5: Auto Test Report (direct LLM call)
  await test('5. Auto Test Report Generation (Sonnet 4.6)', testAutoTestReport);

  // Feature 6: Persona Matching (Haiku keywords + scoring)
  await test('6. Persona Matching (Haiku + Scoring)', testPersonaMatching);

  console.log('\n' + '═'.repeat(52));
  console.log(`  Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
  console.log('═'.repeat(52));

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
