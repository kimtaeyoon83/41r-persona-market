#!/usr/bin/env npx tsx
/**
 * 41R Persona Market — Demo Seed Data
 *
 * Run with: npx tsx scripts/seed-data.ts
 *
 * Seeds the database with realistic demo data:
 *   - 1 company, 2 active tests with test cases
 *   - 5 testers, 3 with completed reports
 *   - 3 personas, 3 USDC settlements
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Client } = pg;

// ─── Config ──────────────────────────────────────────────
const CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://admin:admin41rpm@localhost:5432/persona_market';

// ─── Deterministic IDs (so verify script can reference them) ──
// Real Solana keypair-derived addresses (valid for on-chain operations)
const COMPANY_WALLET = '41vJ6xuoKp6Tvo7NNFuMQ6qB2sMiEZX7hbW2MRrc3h4b';

const TEST_IDS = {
  dex: randomUUID(),
  nft: randomUUID(),
};

const TESTER_WALLETS = {
  alice:   'B8b9UjQHVuro5PQusRpPXgks56EjENArMyJNeWTJmKf7',
  bob:     'Hkx82LPxTTuwLdeQrz9FJ2njAvgnsUqqDXaqn6V8CfRi',
  charlie: 'D8u48MaHwa854zL5iWvrdF8sEHauZXYcK2xDVniXeDA8',
  diana:   'J6CDiMgn5Cej3zPATb2VDFJxdsEs5zBECQ6h3Ze6XtCf',
  evan:    '4TwvNhBpFwTg7Dq1UXwhodsRNgKqkmxskfLwCZdATZb4',
};

const PERSONA_IDS = {
  alice:   randomUUID(),
  bob:     randomUUID(),
  charlie: randomUUID(),
};

// ─── Helpers ─────────────────────────────────────────────
function divider(title: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

// ─── Test Case Data ──────────────────────────────────────

function dexTestCases(testId: string) {
  return [
    // 4 checklist items
    { id: randomUUID(), testId, type: 'checklist', order: 0, content: JSON.stringify({
      id: 'cl-1', task: 'Connect a Phantom wallet to the DEX', expected: 'Wallet connects successfully and address is displayed in the header'
    })},
    { id: randomUUID(), testId, type: 'checklist', order: 1, content: JSON.stringify({
      id: 'cl-2', task: 'Perform a token swap (SOL to USDC)', expected: 'Swap executes, balance updates within 30s, transaction hash shown'
    })},
    { id: randomUUID(), testId, type: 'checklist', order: 2, content: JSON.stringify({
      id: 'cl-3', task: 'Check slippage settings modal', expected: 'Modal opens, slippage can be set from 0.1% to 50%, custom input works'
    })},
    { id: randomUUID(), testId, type: 'checklist', order: 3, content: JSON.stringify({
      id: 'cl-4', task: 'View transaction history', expected: 'History page loads showing past swaps with timestamps, amounts, and tx links'
    })},
    // 1 scenario
    { id: randomUUID(), testId, type: 'scenario', order: 4, content: JSON.stringify({
      id: 'sc-1',
      persona_type: 'DeFi power user',
      narrative: 'You are an experienced DeFi trader who uses multiple DEXs daily. You want to swap 500 USDC for SOL, then provide liquidity to the SOL/USDC pool. Walk through the entire flow noting any friction, confusing labels, or missing confirmations.',
      evaluation_points: [
        'Swap flow clarity and speed',
        'Liquidity provision UX',
        'Error handling for insufficient balance',
        'Fee transparency before confirmation'
      ]
    })},
    // 4 questionnaire items
    { id: randomUUID(), testId, type: 'questionnaire', order: 5, content: JSON.stringify({
      id: 'q-1', question: 'How intuitive was the swap interface? (1=very confusing, 5=very intuitive)', type: 'rating_1_5'
    })},
    { id: randomUUID(), testId, type: 'questionnaire', order: 6, content: JSON.stringify({
      id: 'q-2', question: 'How confident were you about the fees before confirming a transaction? (1=not at all, 10=completely)', type: 'rating_1_10'
    })},
    { id: randomUUID(), testId, type: 'questionnaire', order: 7, content: JSON.stringify({
      id: 'q-3', question: 'What was the most confusing part of the swap experience?', type: 'free_text'
    })},
    { id: randomUUID(), testId, type: 'questionnaire', order: 8, content: JSON.stringify({
      id: 'q-4', question: 'Would you use this DEX over your current one? Why or why not?', type: 'free_text'
    })},
  ];
}

function nftTestCases(testId: string) {
  return [
    // 4 checklist items
    { id: randomUUID(), testId, type: 'checklist', order: 0, content: JSON.stringify({
      id: 'cl-1', task: 'Browse the NFT marketplace homepage', expected: 'Homepage loads with featured collections, trending items, and search bar visible'
    })},
    { id: randomUUID(), testId, type: 'checklist', order: 1, content: JSON.stringify({
      id: 'cl-2', task: 'Search for a specific NFT collection by name', expected: 'Search returns relevant results, filters work (price, rarity, listing date)'
    })},
    { id: randomUUID(), testId, type: 'checklist', order: 2, content: JSON.stringify({
      id: 'cl-3', task: 'View NFT detail page with attributes', expected: 'Detail page shows image, attributes/traits, price history, owner info, and buy button'
    })},
    { id: randomUUID(), testId, type: 'checklist', order: 3, content: JSON.stringify({
      id: 'cl-4', task: 'List an NFT for sale', expected: 'Listing flow completes: set price, confirm in wallet, NFT appears in marketplace'
    })},
    // 1 scenario
    { id: randomUUID(), testId, type: 'scenario', order: 4, content: JSON.stringify({
      id: 'sc-1',
      persona_type: 'NFT collector (beginner)',
      narrative: 'You are new to NFTs and want to buy your first one. You have 2 SOL in your wallet. Navigate the marketplace, find an affordable NFT you like, understand what you are buying, and complete the purchase. Note any points where you felt confused or unsure.',
      evaluation_points: [
        'Onboarding clarity for new users',
        'Price and fee transparency',
        'Purchase confirmation flow',
        'Post-purchase experience (where is my NFT?)'
      ]
    })},
    // 4 questionnaire items
    { id: randomUUID(), testId, type: 'questionnaire', order: 5, content: JSON.stringify({
      id: 'q-1', question: 'How easy was it to find an NFT you wanted to buy? (1=very hard, 5=very easy)', type: 'rating_1_5'
    })},
    { id: randomUUID(), testId, type: 'questionnaire', order: 6, content: JSON.stringify({
      id: 'q-2', question: 'How trustworthy did the marketplace feel? (1=not at all, 10=completely)', type: 'rating_1_10'
    })},
    { id: randomUUID(), testId, type: 'questionnaire', order: 7, content: JSON.stringify({
      id: 'q-3', question: 'What feature would you most like to see added to this marketplace?', type: 'free_text'
    })},
    { id: randomUUID(), testId, type: 'questionnaire', order: 8, content: JSON.stringify({
      id: 'q-4', question: 'Describe your overall experience in 2-3 sentences.', type: 'free_text'
    })},
  ];
}

// ─── Tester Profiles ─────────────────────────────────────

const TESTER_PROFILES = {
  alice: {
    displayName: 'Alice Chen',
    profile: {
      age_range: '30s',
      region: 'TW',
      occupation: 'DeFi Analyst',
      expertise: ['defi', 'web3', 'saas'],
      experience_level: 'expert',
      crypto_experience: 'advanced',
      preferred_domains: ['defi', 'dao', 'marketplace'],
      ui_preference: 'power-user',
      languages: ['English', 'Mandarin'],
      device_types: ['desktop', 'mobile'],
      primary_device: 'desktop',
      design_matters: false,
      frustration_triggers: ['slow loading', 'unclear fees'],
    },
  },
  bob: {
    displayName: 'Bob Martinez',
    profile: {
      age_range: '20s',
      region: 'US',
      occupation: 'Graphic Designer',
      expertise: ['nft', 'gaming', 'social'],
      experience_level: 'intermediate',
      crypto_experience: 'beginner',
      preferred_domains: ['nft', 'gaming', 'social'],
      ui_preference: 'visual',
      languages: ['English', 'Spanish'],
      device_types: ['desktop', 'mobile'],
      primary_device: 'mobile',
      design_matters: true,
      frustration_triggers: ['confusing navigation', 'small text', 'no mobile support'],
    },
  },
  charlie: {
    displayName: 'Charlie Nakamura',
    profile: {
      age_range: '40s',
      region: 'JP',
      occupation: 'Security Engineer',
      expertise: ['web3', 'defi', 'ai_tools'],
      experience_level: 'expert',
      crypto_experience: 'advanced',
      preferred_domains: ['defi', 'dao'],
      ui_preference: 'technical',
      languages: ['English', 'Japanese'],
      device_types: ['desktop'],
      primary_device: 'desktop',
      design_matters: false,
      frustration_triggers: ['too many popups', 'complex onboarding'],
    },
  },
  diana: {
    displayName: 'Diana Okafor',
    profile: {
      age_range: '20s',
      region: 'NG',
      occupation: 'UX Designer',
      expertise: ['saas', 'social', 'e-commerce'],
      experience_level: 'intermediate',
      crypto_experience: 'beginner',
      preferred_domains: ['marketplace', 'social', 'saas'],
      ui_preference: 'minimal',
      languages: ['English', 'French'],
      device_types: ['mobile'],
      primary_device: 'mobile',
      design_matters: true,
      frustration_triggers: ['confusing navigation', 'small text', 'no mobile support'],
    },
  },
  evan: {
    displayName: 'Evan Petrov',
    profile: {
      age_range: '50s',
      region: 'RU',
      occupation: 'QA Engineer',
      expertise: ['saas', 'ai_tools'],
      experience_level: 'beginner',
      crypto_experience: 'none',
      preferred_domains: ['saas', 'ai'],
      ui_preference: 'functional',
      languages: ['English', 'Russian'],
      device_types: ['desktop'],
      primary_device: 'desktop',
      design_matters: false,
      frustration_triggers: ['slow loading', 'complex onboarding'],
    },
  },
};

// ─── Report Data ─────────────────────────────────────────

function generateReportForTest(
  testerKey: 'alice' | 'bob' | 'charlie',
  testId: string,
  testType: 'dex' | 'nft',
) {
  const reportId = randomUUID();
  const testerAddr = TESTER_WALLETS[testerKey];

  // Checklist results - vary by tester personality
  const checklistResults = [
    { id: 'cl-1', status: 'passed' as const, memo: testerKey === 'alice'
      ? 'Wallet connected in 2 seconds, address truncated properly in header'
      : testerKey === 'bob'
        ? 'Connected fine but the button was hard to find on mobile'
        : 'Connected. Verified the wallet adapter handles edge cases correctly' },
    { id: 'cl-2', status: (testerKey === 'charlie' ? 'failed' : 'passed') as const, memo: testerKey === 'alice'
      ? 'Swap executed successfully, balance updated in ~15s'
      : testerKey === 'bob'
        ? 'Swap worked but the loading animation was janky'
        : 'Failed: swap reverted when using max balance due to insufficient SOL for fees. Missing fee estimation.' },
    { id: 'cl-3', status: 'passed' as const, memo: testerKey === 'alice'
      ? 'Slippage modal works well, custom input accepts decimals'
      : testerKey === 'bob'
        ? 'Modal is clean, but what does slippage even mean? No tooltip.'
        : 'Modal functions correctly. The 50% max is reasonable. No XSS via custom input.' },
    { id: 'cl-4', status: (testerKey === 'bob' ? 'blocked' : 'passed') as const, memo: testerKey === 'alice'
      ? 'History loads fast, Solscan links open correctly'
      : testerKey === 'bob'
        ? 'Page returned 500 error when I tried to load history. Blocked.'
        : 'History page works. Pagination handles 100+ transactions without lag.' },
  ];

  // Scenario log
  const scenarioLog = [{
    id: 'sc-1',
    timeline: testerKey === 'alice'
      ? [
          { time: '00:00', action: 'Opened DEX homepage, immediately noticed the swap interface' },
          { time: '00:15', action: 'Set swap from USDC to SOL, entered 500 USDC' },
          { time: '00:30', action: 'Noticed price impact warning - good UX touch' },
          { time: '00:45', action: 'Confirmed swap, transaction completed in 12s' },
          { time: '01:10', action: 'Navigated to liquidity tab, found SOL/USDC pool' },
          { time: '01:30', action: 'Added liquidity successfully, received LP tokens' },
          { time: '02:00', action: 'Checked portfolio view - LP position shown correctly' },
        ]
      : testerKey === 'bob'
        ? [
            { time: '00:00', action: 'Landed on homepage, lots of numbers and charts - overwhelming' },
            { time: '00:20', action: 'Found swap button after scrolling, not obvious enough' },
            { time: '00:40', action: 'Tried to swap but got confused by token selector dropdown' },
            { time: '01:00', action: 'Successfully set up swap, but fee display was unclear' },
            { time: '01:20', action: 'Swap went through, nice confirmation animation' },
            { time: '01:45', action: 'Could not find liquidity section easily, had to use menu' },
            { time: '02:15', action: 'LP provision was confusing - what ratio do I need?' },
          ]
        : [
            { time: '00:00', action: 'Inspected network requests on page load - 47 API calls, excessive' },
            { time: '00:20', action: 'Checked for proper CSP headers - missing frame-ancestors directive' },
            { time: '00:40', action: 'Tested swap with edge case amounts (0, negative, MAX_UINT)' },
            { time: '01:00', action: 'Negative amount was accepted client-side but rejected by API - should validate earlier' },
            { time: '01:20', action: 'Transaction simulation shown before signing - good security practice' },
            { time: '01:45', action: 'Tested LP provision - no rug-pull warning for new pools, concerning' },
            { time: '02:10', action: 'Overall: functional but needs security hardening on edge cases' },
          ],
  }];

  // Questionnaire answers
  const questionnaireAnswers = testerKey === 'alice'
    ? [
        { id: 'q-1', answer: 4 },
        { id: 'q-2', answer: 8 },
        { id: 'q-3', answer: 'The route visualization was confusing when doing multi-hop swaps. A simpler "best price" label would help.' },
        { id: 'q-4', answer: 'Yes, the speed is noticeably faster than my current DEX. The fee structure is transparent and competitive. Would switch for daily trading.' },
      ]
    : testerKey === 'bob'
      ? [
          { id: 'q-1', answer: 3 },
          { id: 'q-2', answer: 5 },
          { id: 'q-3', answer: 'I did not understand what slippage tolerance means. There should be a "recommended" setting for beginners instead of making me pick a number.' },
          { id: 'q-4', answer: 'Maybe, but it needs better onboarding. I felt lost as someone who is not a DeFi expert. A guided tutorial would help a lot.' },
        ]
      : [
          { id: 'q-1', answer: 4 },
          { id: 'q-2', answer: 6 },
          { id: 'q-3', answer: 'The lack of transaction simulation preview before signing is concerning. Users should see exactly what will happen to their tokens before approving.' },
          { id: 'q-4', answer: 'Not yet. The security posture needs improvement: no CSP headers, client-side validation gaps, and missing rate limiting on the swap API. Fix those and it would be competitive.' },
        ];

  const qualityScores: Record<string, number> = {
    alice: 4.5,
    bob: 3.2,
    charlie: 4.8,
  };

  return {
    reportId,
    testerAddr,
    testId,
    checklistResults,
    scenarioLog,
    questionnaireAnswers,
    qualityScore: qualityScores[testerKey],
    isPersonaTest: false,
  };
}

// ─── Persona Data ────────────────────────────────────────

const PERSONA_VECTORS = {
  alice: {
    test_style: { thoroughness: 0.85, speed: 0.90, ux_focus: 0.70, bug_detection: 0.75, creativity: 0.65 },
    expertise: { defi: 0.95, nft: 0.40, gaming: 0.20, ai_tools: 0.55, general_web: 0.80 },
    feedback_pattern: { ui_critical: 0.60, security_aware: 0.50, performance_sensitive: 0.80, accessibility_focus: 0.30, detail_oriented: 0.85 },
    reliability: { quality_score: 4.5, consistency: 0.90, response_rate: 0.95 },
    demographics: { age_group: '30s', tech_literacy: 0.92, crypto_experience: 0.95, design_sensitivity: 0.35, patience_level: 0.40 },
    ux_preferences: { visual_style: 'data-dense', font_size_preference: 'small', information_density: 'high', animation_tolerance: 'low', color_contrast_need: 'normal', mobile_first: false },
    voice_sample: 'Concise, metrics-driven feedback. Focuses on performance and efficiency. Example: "Swap executed in 12s with 0.3% slippage - within acceptable range. Price impact warning at >2% is a good UX pattern. Suggest adding gas estimation before confirmation."',
  },
  bob: {
    test_style: { thoroughness: 0.60, speed: 0.50, ux_focus: 0.90, bug_detection: 0.45, creativity: 0.80 },
    expertise: { defi: 0.30, nft: 0.85, gaming: 0.75, ai_tools: 0.40, general_web: 0.70 },
    feedback_pattern: { ui_critical: 0.90, security_aware: 0.25, performance_sensitive: 0.40, accessibility_focus: 0.70, detail_oriented: 0.50 },
    reliability: { quality_score: 3.2, consistency: 0.65, response_rate: 0.80 },
    demographics: { age_group: '20s', tech_literacy: 0.60, crypto_experience: 0.30, design_sensitivity: 0.90, patience_level: 0.35 },
    ux_preferences: { visual_style: 'colorful', font_size_preference: 'medium', information_density: 'low', animation_tolerance: 'high', color_contrast_need: 'normal', mobile_first: true },
    voice_sample: 'Casual, user-experience focused. Highlights confusion points and visual issues. Example: "The swap button was kinda hidden? I kept scrolling past it. Also the loading spinner looks broken on mobile. The colors are nice tho, love the gradient."',
  },
  charlie: {
    test_style: { thoroughness: 0.95, speed: 0.40, ux_focus: 0.35, bug_detection: 0.95, creativity: 0.50 },
    expertise: { defi: 0.80, nft: 0.30, gaming: 0.15, ai_tools: 0.60, general_web: 0.90 },
    feedback_pattern: { ui_critical: 0.30, security_aware: 0.95, performance_sensitive: 0.85, accessibility_focus: 0.20, detail_oriented: 0.95 },
    reliability: { quality_score: 4.8, consistency: 0.95, response_rate: 0.85 },
    demographics: { age_group: '40s', tech_literacy: 0.98, crypto_experience: 0.90, design_sensitivity: 0.15, patience_level: 0.80 },
    ux_preferences: { visual_style: 'minimal', font_size_preference: 'small', information_density: 'high', animation_tolerance: 'none', color_contrast_need: 'normal', mobile_first: false },
    voice_sample: 'Technical, security-focused, methodical. Reports edge cases and vulnerabilities. Example: "Missing CSP frame-ancestors directive allows clickjacking. Client accepts negative swap amounts - server rejects but error message leaks API version. 47 API calls on page load suggests missing request batching."',
  },
};

// ─── Main Seed Function ──────────────────────────────────

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });

  try {
    await client.connect();
    console.log('  Connected to PostgreSQL');

    // ── Truncate all tables ────────────────────────────
    divider('Step 1: Clear existing data');
    await client.query(`
      TRUNCATE settlements, test_reports, personas, test_cases, tests, testers, companies
      CASCADE
    `);
    console.log('  All tables truncated');

    // ── Seed company ───────────────────────────────────
    divider('Step 2: Seed company');
    await client.query(`
      INSERT INTO companies (wallet_address, company_name, domain)
      VALUES ($1, $2, $3)
    `, [COMPANY_WALLET, 'DeFi Protocol X', 'defiprotocolx.io']);
    console.log('  Company "DeFi Protocol X" created');

    // ── Seed tests ─────────────────────────────────────
    divider('Step 3: Seed tests');

    await client.query(`
      INSERT INTO tests (id, company_addr, target_url, requirements, budget_usdc, status, escrow_pda)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      TEST_IDS.dex,
      COMPANY_WALLET,
      'https://jup.ag',
      'Full UX audit of the Jupiter token swap interface. Focus on wallet connection flow, swap execution, slippage settings, and transaction history. Test on both desktop and mobile viewports.',
      500.0,
      'active',
      'EscrowPda111111111111111111111111111111111111',
    ]);
    console.log('  Test 1: "demo-dex.app" (active, $500 budget)');

    await client.query(`
      INSERT INTO tests (id, company_addr, target_url, requirements, budget_usdc, status, escrow_pda)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      TEST_IDS.nft,
      COMPANY_WALLET,
      'https://magiceden.io/solana',
      'End-to-end testing of the Magic Eden NFT marketplace. Cover browsing, searching, buying, and listing flows. Pay special attention to the first-time user experience and fee transparency.',
      350.0,
      'active',
      'EscrowPda222222222222222222222222222222222222',
    ]);
    console.log('  Test 2: "demo-nft.app" (active, $350 budget)');

    // ── Seed test cases ────────────────────────────────
    divider('Step 4: Seed test cases');

    const dexCases = dexTestCases(TEST_IDS.dex);
    const nftCases = nftTestCases(TEST_IDS.nft);

    for (const tc of [...dexCases, ...nftCases]) {
      await client.query(`
        INSERT INTO test_cases (id, test_id, type, content, "order")
        VALUES ($1, $2, $3, $4, $5)
      `, [tc.id, tc.testId, tc.type, tc.content, tc.order]);
    }
    console.log(`  ${dexCases.length} test cases for demo-dex.app (4 checklist, 1 scenario, 4 questionnaire)`);
    console.log(`  ${nftCases.length} test cases for demo-nft.app (4 checklist, 1 scenario, 4 questionnaire)`);

    // ── Seed testers ───────────────────────────────────
    divider('Step 5: Seed testers');

    const testerEntries = [
      { key: 'alice',   wallet: TESTER_WALLETS.alice,   testsDone: 3, personaId: PERSONA_IDS.alice },
      { key: 'bob',     wallet: TESTER_WALLETS.bob,     testsDone: 3, personaId: PERSONA_IDS.bob },
      { key: 'charlie', wallet: TESTER_WALLETS.charlie, testsDone: 3, personaId: PERSONA_IDS.charlie },
      { key: 'diana',   wallet: TESTER_WALLETS.diana,   testsDone: 0, personaId: null },
      { key: 'evan',    wallet: TESTER_WALLETS.evan,    testsDone: 0, personaId: null },
    ] as const;

    for (const t of testerEntries) {
      const prof = TESTER_PROFILES[t.key];
      await client.query(`
        INSERT INTO testers (wallet_address, display_name, profile, tests_done, persona_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        t.wallet,
        prof.displayName,
        JSON.stringify(prof.profile),
        t.testsDone,
        t.personaId,
      ]);
      console.log(`  Tester: ${prof.displayName} (${t.key}) — tests_done=${t.testsDone}${t.personaId ? ', has persona' : ''}`);
    }

    // ── Seed test reports (3 testers x 3 reports each = 9) ──
    divider('Step 6: Seed test reports');

    const reportIds: { reportId: string; testerAddr: string; testId: string; qualityScore: number }[] = [];

    // Each of the 3 active testers gets:
    //   - 1 report for the DEX test
    //   - 1 report for the NFT test
    //   - 1 additional report for the DEX test (second round)
    for (const testerKey of ['alice', 'bob', 'charlie'] as const) {
      // Report 1: DEX test
      const r1 = generateReportForTest(testerKey, TEST_IDS.dex, 'dex');
      await client.query(`
        INSERT INTO test_reports (id, tester_addr, test_id, checklist_results, scenario_log, questionnaire_answers, quality_score, is_persona_test)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        r1.reportId, r1.testerAddr, r1.testId,
        JSON.stringify(r1.checklistResults),
        JSON.stringify(r1.scenarioLog),
        JSON.stringify(r1.questionnaireAnswers),
        r1.qualityScore, r1.isPersonaTest,
      ]);
      reportIds.push({ reportId: r1.reportId, testerAddr: r1.testerAddr, testId: r1.testId, qualityScore: r1.qualityScore });

      // Report 2: NFT test
      const r2 = generateReportForTest(testerKey, TEST_IDS.nft, 'nft');
      await client.query(`
        INSERT INTO test_reports (id, tester_addr, test_id, checklist_results, scenario_log, questionnaire_answers, quality_score, is_persona_test)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        r2.reportId, r2.testerAddr, r2.testId,
        JSON.stringify(r2.checklistResults),
        JSON.stringify(r2.scenarioLog),
        JSON.stringify(r2.questionnaireAnswers),
        r2.qualityScore, r2.isPersonaTest,
      ]);
      reportIds.push({ reportId: r2.reportId, testerAddr: r2.testerAddr, testId: r2.testId, qualityScore: r2.qualityScore });

      // Report 3: DEX test (second round with slightly different data)
      const r3 = generateReportForTest(testerKey, TEST_IDS.dex, 'dex');
      await client.query(`
        INSERT INTO test_reports (id, tester_addr, test_id, checklist_results, scenario_log, questionnaire_answers, quality_score, is_persona_test)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        r3.reportId, r3.testerAddr, r3.testId,
        JSON.stringify(r3.checklistResults),
        JSON.stringify(r3.scenarioLog),
        JSON.stringify(r3.questionnaireAnswers),
        r3.qualityScore, r3.isPersonaTest,
      ]);
      reportIds.push({ reportId: r3.reportId, testerAddr: r3.testerAddr, testId: r3.testId, qualityScore: r3.qualityScore });

      console.log(`  ${TESTER_PROFILES[testerKey].displayName}: 3 reports (quality: ${r1.qualityScore})`);
    }

    // ── Seed personas ──────────────────────────────────
    divider('Step 7: Seed personas');

    for (const testerKey of ['alice', 'bob', 'charlie'] as const) {
      const vector = PERSONA_VECTORS[testerKey];
      await client.query(`
        INSERT INTO personas (id, tester_addr, vector, is_active, sas_attest_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        PERSONA_IDS[testerKey],
        TESTER_WALLETS[testerKey],
        JSON.stringify(vector),
        true,
        `sas_demo_${testerKey}_${Date.now()}`,
      ]);
      console.log(`  Persona for ${TESTER_PROFILES[testerKey].displayName}: ${PERSONA_IDS[testerKey]}`);
      console.log(`    DeFi expertise: ${vector.expertise.defi}, Security: ${vector.feedback_pattern.security_aware}, Quality: ${vector.reliability.quality_score}`);
    }

    // ── Seed settlements (3 USDC settlements for the first report of each tester) ──
    divider('Step 8: Seed settlements');

    const paymentAmounts: Record<string, number> = {
      alice: 45.00,
      bob: 32.00,
      charlie: 48.00,
    };

    for (const testerKey of ['alice', 'bob', 'charlie'] as const) {
      const report = reportIds.find(r => r.testerAddr === TESTER_WALLETS[testerKey])!;
      const amount = paymentAmounts[testerKey];
      const fee = +(amount * 0.05).toFixed(2); // 5% platform fee

      await client.query(`
        INSERT INTO settlements (id, test_id, report_id, payer_addr, payee_addr, amount_token, fee_collected, tx_signature, settlement_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        randomUUID(),
        report.testId,
        report.reportId,
        COMPANY_WALLET,
        TESTER_WALLETS[testerKey],
        amount,
        fee,
        `demo_tx_${testerKey}_${randomUUID().slice(0, 8)}`,
        'usdc',
      ]);
      console.log(`  Settlement: ${TESTER_PROFILES[testerKey].displayName} received $${amount} USDC (fee: $${fee})`);
    }

    // ── Summary ────────────────────────────────────────
    divider('Seed Complete — Summary');

    const labels = ['companies', 'tests', 'test_cases', 'testers', 'test_reports', 'personas', 'settlements'];
    for (const table of labels) {
      const res = await client.query(`SELECT COUNT(*)::int as count FROM ${table}`);
      console.log(`  ${table.padEnd(16)} ${res.rows[0].count}`);
    }
    console.log('');

  } catch (err) {
    console.error('\n[ERROR]', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
