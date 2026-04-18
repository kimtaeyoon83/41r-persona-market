#!/usr/bin/env npx tsx
/**
 * 41R Persona Market — Demo Seed Data
 *
 * Run with: npx tsx scripts/seed-data.ts
 *
 * Seeds the database with realistic demo data:
 *   - 1 company, 2 active tests with test cases (with reward_per_tester)
 *   - 5 testers: 3 with personas, 1 (Diana) with 3 reports but NO persona (for live demo), 1 inactive
 *   - 3 personas, 3 USDC settlements
 *   - Diana's persona vector is commented out for reference — demo generates it live
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
  fiona:   '7YttLkHDoN68PGqkEWCTkW6aB96v7eMEA4oFBFRYr6bP',
  grace:   '9RgJMJF8vLPBMf7TKKzX5nfCwzVmV4fR8PZJuqh3pump',
};

const PERSONA_IDS = {
  alice:   randomUUID(),
  bob:     randomUUID(),
  charlie: randomUUID(),
  fiona:   randomUUID(),
  grace:   randomUUID(),
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
      age_range: '30s', region: 'TW', occupation: 'DeFi Quantitative Trader',
      expertise: ['defi', 'web3', 'performance'], experience_level: 'expert', crypto_experience: 'advanced',
      preferred_domains: ['defi', 'dao', 'trading'], ui_preference: 'data-dense',
      languages: ['English', 'Mandarin'], device_types: ['desktop'], primary_device: 'desktop',
      design_matters: false,
      frustration_triggers: ['slow loading', 'hidden fees', 'missing gas estimation', 'no latency metrics'],
    },
  },
  bob: {
    displayName: 'Bobby Kim',
    profile: {
      age_range: '10s', region: 'KR', occupation: 'High School Student / Content Creator',
      expertise: ['gaming', 'nft', 'social'], experience_level: 'beginner', crypto_experience: 'beginner',
      preferred_domains: ['gaming', 'nft', 'social'], ui_preference: 'playful',
      languages: ['Korean', 'English'], device_types: ['mobile'], primary_device: 'mobile',
      design_matters: true,
      frustration_triggers: ['boring design', 'too much text', 'no dark mode', 'slow animations', 'confusing words'],
    },
  },
  charlie: {
    displayName: 'Charlie Nakamura',
    profile: {
      age_range: '40s', region: 'JP', occupation: 'Blockchain Security Auditor (Trail of Bits)',
      expertise: ['web3', 'defi', 'security'], experience_level: 'expert', crypto_experience: 'advanced',
      preferred_domains: ['defi', 'bridge', 'dao'], ui_preference: 'minimal',
      languages: ['English', 'Japanese'], device_types: ['desktop'], primary_device: 'desktop',
      design_matters: false,
      frustration_triggers: ['missing CSP headers', 'unlimited token approvals', 'no tx simulation', 'client-side validation only'],
    },
  },
  diana: {
    displayName: 'Diana Okafor',
    profile: {
      age_range: '20s', region: 'NG', occupation: 'Senior UX Designer (Figma)',
      expertise: ['saas', 'social', 'e-commerce'], experience_level: 'intermediate', crypto_experience: 'beginner',
      preferred_domains: ['marketplace', 'social', 'saas'], ui_preference: 'minimal',
      languages: ['English', 'French'], device_types: ['mobile'], primary_device: 'mobile',
      design_matters: true,
      frustration_triggers: ['inconsistent spacing', 'bad typography', 'no mobile layout', 'missing micro-interactions'],
    },
  },
  evan: {
    displayName: 'Evan Petrov',
    profile: {
      age_range: '50s', region: 'RU', occupation: 'QA Engineer',
      expertise: ['saas', 'ai_tools'], experience_level: 'beginner', crypto_experience: 'none',
      preferred_domains: ['saas', 'ai'], ui_preference: 'functional',
      languages: ['English', 'Russian'], device_types: ['desktop'], primary_device: 'desktop',
      design_matters: false,
      frustration_triggers: ['slow loading', 'complex onboarding'],
    },
  },
  fiona: {
    displayName: 'Fiona Bergström',
    profile: {
      age_range: '60+', region: 'SE', occupation: 'Retired Professor / Accessibility Consultant',
      expertise: ['accessibility', 'saas', 'e-commerce'], experience_level: 'intermediate', crypto_experience: 'none',
      preferred_domains: ['saas', 'marketplace', 'gov'], ui_preference: 'accessible',
      languages: ['English', 'Swedish'], device_types: ['desktop', 'tablet'], primary_device: 'desktop',
      design_matters: true,
      frustration_triggers: ['small text', 'low contrast', 'no keyboard nav', 'hover-only interactions', 'no alt text'],
    },
  },
  grace: {
    displayName: 'Grace Park',
    profile: {
      age_range: '30s', region: 'US', occupation: 'Design System Lead (ex-Airbnb)',
      expertise: ['saas', 'e-commerce', 'design-systems'], experience_level: 'expert', crypto_experience: 'intermediate',
      preferred_domains: ['saas', 'marketplace', 'fintech'], ui_preference: 'systematic',
      languages: ['English', 'Korean'], device_types: ['desktop', 'mobile'], primary_device: 'desktop',
      design_matters: true,
      frustration_triggers: ['inconsistent components', 'random spacing values', 'no type scale', 'misaligned elements', 'non-standard icons'],
    },
  },
};

// ─── Report Data ─────────────────────────────────────────

function generateReportForTest(
  testerKey: 'alice' | 'bob' | 'charlie' | 'diana' | 'fiona' | 'grace',
  testId: string,
  _testType: 'dex' | 'nft',
) {
  const reportId = randomUUID();
  const testerAddr = TESTER_WALLETS[testerKey];

  // Checklist results - vary by tester personality
  const checklistMemos: Record<string, Record<string, string>> = {
    alice: {
      'cl-1': 'Wallet connected in 2 seconds, address truncated properly in header',
      'cl-2': 'Swap executed successfully, balance updated in ~15s',
      'cl-3': 'Slippage modal works well, custom input accepts decimals',
      'cl-4': 'History loads fast, Solscan links open correctly',
    },
    bob: {
      'cl-1': 'Connected fine but the button was hard to find on mobile',
      'cl-2': 'Swap worked but the loading animation was janky',
      'cl-3': 'Modal is clean, but what does slippage even mean? No tooltip.',
      'cl-4': 'Page returned 500 error when I tried to load history. Blocked.',
    },
    charlie: {
      'cl-1': 'Connected. Verified the wallet adapter handles edge cases correctly',
      'cl-2': 'Failed: swap reverted when using max balance due to insufficient SOL for fees. Missing fee estimation.',
      'cl-3': 'Modal functions correctly. The 50% max is reasonable. No XSS via custom input.',
      'cl-4': 'History page works. Pagination handles 100+ transactions without lag.',
    },
    diana: {
      'cl-1': 'Wallet button has poor touch target on mobile — only 32px. Needs 44px minimum per WCAG. Connected on second tap.',
      'cl-2': 'Swap worked but the confirmation screen has no visual hierarchy. The amount and token name should be larger than the fee details.',
      'cl-3': 'Slippage modal layout breaks on iPhone SE width. The percentage buttons overlap the custom input field.',
      'cl-4': 'History page is functional but the table rows are too dense for mobile. Cards would be a better pattern here.',
    },
    fiona: {
      'cl-1': 'Keyboard navigation fails — Tab key skips the Connect Wallet button entirely. Had to use mouse. Screen reader announced "button" with no accessible label.',
      'cl-2': 'Could not complete swap. The confirmation modal has no visible focus indicator and the Confirm/Cancel buttons are indistinguishable for low-vision users (same size, same weight, 2.1:1 contrast ratio).',
      'cl-3': 'Slippage modal opens but I cannot close it with Escape key. The percentage options are not in a radio group — ARIA roles missing. Custom input has no label element associated.',
      'cl-4': 'History table has no caption or summary. Column headers are not using <th> with scope. I could read the data but could not sort or filter with keyboard alone.',
    },
    grace: {
      'cl-1': 'Connect button uses border-radius: 8px but the header nav items use 4px — inconsistent rounding. Button padding is 8px 16px but other CTAs use 12px 24px. Connected fine functionally.',
      'cl-2': 'Swap executed correctly. However, the confirmation modal uses 3 different font weights (400, 500, 700) and 4 different text colors. The amount display should use tabular-nums for alignment. Token icon sizes vary between 20px and 24px.',
      'cl-3': 'Modal design is clean but the spacing between percentage buttons is 8px while the margin to the custom input is 16px — visual rhythm is off. The active state uses opacity: 0.8 instead of a distinct color — feels like a disabled state.',
      'cl-4': 'History page layout: 16px section padding but 24px gap between rows. Row height alternates between 48px and 52px depending on content — needs min-height normalization. The date format is inconsistent: some show "2h ago" others show "Jan 15".',
    },
  };

  const cl2Status: 'passed' | 'failed' = testerKey === 'charlie' ? 'failed' : 'passed';
  const cl4Status: 'passed' | 'blocked' = testerKey === 'bob' ? 'blocked' : 'passed';

  const checklistResults = [
    { id: 'cl-1', status: 'passed' as const, memo: checklistMemos[testerKey]['cl-1'] },
    { id: 'cl-2', status: cl2Status, memo: checklistMemos[testerKey]['cl-2'] },
    { id: 'cl-3', status: 'passed' as const, memo: checklistMemos[testerKey]['cl-3'] },
    { id: 'cl-4', status: cl4Status, memo: checklistMemos[testerKey]['cl-4'] },
  ];

  // Scenario log
  const scenarioTimelines: Record<string, { time: string; action: string }[]> = {
    alice: [
      { time: '00:00', action: 'Opened DEX homepage, immediately noticed the swap interface' },
      { time: '00:15', action: 'Set swap from USDC to SOL, entered 500 USDC' },
      { time: '00:30', action: 'Noticed price impact warning - good UX touch' },
      { time: '00:45', action: 'Confirmed swap, transaction completed in 12s' },
      { time: '01:10', action: 'Navigated to liquidity tab, found SOL/USDC pool' },
      { time: '01:30', action: 'Added liquidity successfully, received LP tokens' },
      { time: '02:00', action: 'Checked portfolio view - LP position shown correctly' },
    ],
    bob: [
      { time: '00:00', action: 'Landed on homepage, lots of numbers and charts - overwhelming' },
      { time: '00:20', action: 'Found swap button after scrolling, not obvious enough' },
      { time: '00:40', action: 'Tried to swap but got confused by token selector dropdown' },
      { time: '01:00', action: 'Successfully set up swap, but fee display was unclear' },
      { time: '01:20', action: 'Swap went through, nice confirmation animation' },
      { time: '01:45', action: 'Could not find liquidity section easily, had to use menu' },
      { time: '02:15', action: 'LP provision was confusing - what ratio do I need?' },
    ],
    charlie: [
      { time: '00:00', action: 'Inspected network requests on page load - 47 API calls, excessive' },
      { time: '00:20', action: 'Checked for proper CSP headers - missing frame-ancestors directive' },
      { time: '00:40', action: 'Tested swap with edge case amounts (0, negative, MAX_UINT)' },
      { time: '01:00', action: 'Negative amount was accepted client-side but rejected by API - should validate earlier' },
      { time: '01:20', action: 'Transaction simulation shown before signing - good security practice' },
      { time: '01:45', action: 'Tested LP provision - no rug-pull warning for new pools, concerning' },
      { time: '02:10', action: 'Overall: functional but needs security hardening on edge cases' },
    ],
    diana: [
      { time: '00:00', action: 'First impression: landing page has no clear visual hierarchy. CTA competes with nav links.' },
      { time: '00:15', action: 'Swap form layout is decent on desktop but tested on mobile — fields stack awkwardly at 375px width' },
      { time: '00:35', action: 'Token selector dropdown has no search affordance — the magnifying glass icon is too small and low contrast' },
      { time: '00:50', action: 'Swap confirmation modal: good that it exists, but the "Confirm" button is the same visual weight as "Cancel" — dangerous' },
      { time: '01:10', action: 'Success state is too subtle — a small green checkmark. Should be a more celebratory moment for first-time users' },
      { time: '01:30', action: 'Navigated to LP section — the two-column layout completely breaks on mobile, content overlaps' },
      { time: '01:50', action: 'Overall: solid functionality but the mobile experience needs a dedicated responsive pass. Typography scale is inconsistent.' },
    ],
    fiona: [
      { time: '00:00', action: 'Starting accessibility audit. Set browser zoom to 200%. Page content overflows horizontally — fails WCAG 1.4.10 Reflow.' },
      { time: '00:30', action: 'Turned on VoiceOver. Navigation landmarks are missing — no <main>, no <nav> regions defined.' },
      { time: '01:00', action: 'Tab order: header links → skip to footer (skips entire page content). Main swap form is unreachable via keyboard alone.' },
      { time: '01:30', action: 'Tried to use swap form with keyboard. Amount input accepts Tab but the token selector requires mouse click — trap.' },
      { time: '02:00', action: 'All error messages are communicated only by color (red text). No icon, no aria-live announcement. Fails WCAG 1.4.1.' },
      { time: '02:30', action: 'Tested with high contrast mode (Windows). Many elements disappear because they rely on background-color for visibility.' },
      { time: '03:00', action: 'Summary: This application is inaccessible to keyboard-only, screen reader, and low-vision users. Needs fundamental remediation.' },
    ],
    grace: [
      { time: '00:00', action: 'Audit starting. Opening DevTools to inspect design tokens. No CSS custom properties — all values are hardcoded magic numbers.' },
      { time: '00:20', action: 'Typography inventory: Found 7 different font-size values on the homepage alone (12, 13, 14, 16, 18, 22, 28px). No type scale.' },
      { time: '00:40', action: 'Spacing analysis: Padding values include 8, 12, 14, 16, 18, 20, 24, 32px. Not following 4px or 8px grid.' },
      { time: '01:00', action: 'Color audit: 6 different gray values in use (#666, #888, #999, #aaa, #bbb, #ccc). Should be max 3 in a system.' },
      { time: '01:20', action: 'Component consistency: Buttons have 3 different border-radius values (4px, 8px, 12px). Cards use 2 different shadow styles.' },
      { time: '01:40', action: 'Interactive states: Hover uses opacity on some buttons, background-color change on others, and transform: scale on a third set.' },
      { time: '02:00', action: 'Responsive behavior: Breakpoints at 768px and 1024px but layout jumps — no fluid scaling between. Grid switches from 3-col to 1-col with no 2-col intermediate.' },
      { time: '02:20', action: 'Recommendation: Build a design token system first (spacing: 4/8/12/16/24/32/48, type: 12/14/16/20/24/32, radius: 4/8/12). Then refactor all components to use tokens.' },
    ],
  };

  const scenarioLog = [{
    id: 'sc-1',
    timeline: scenarioTimelines[testerKey],
  }];

  // Questionnaire answers
  const questionnaireMap: Record<string, { id: string; answer: string | number }[]> = {
    alice: [
      { id: 'q-1', answer: 4 },
      { id: 'q-2', answer: 8 },
      { id: 'q-3', answer: 'The route visualization was confusing when doing multi-hop swaps. A simpler "best price" label would help.' },
      { id: 'q-4', answer: 'Yes, the speed is noticeably faster than my current DEX. The fee structure is transparent and competitive. Would switch for daily trading.' },
    ],
    bob: [
      { id: 'q-1', answer: 3 },
      { id: 'q-2', answer: 5 },
      { id: 'q-3', answer: 'I did not understand what slippage tolerance means. There should be a "recommended" setting for beginners instead of making me pick a number.' },
      { id: 'q-4', answer: 'Maybe, but it needs better onboarding. I felt lost as someone who is not a DeFi expert. A guided tutorial would help a lot.' },
    ],
    charlie: [
      { id: 'q-1', answer: 4 },
      { id: 'q-2', answer: 6 },
      { id: 'q-3', answer: 'The lack of transaction simulation preview before signing is concerning. Users should see exactly what will happen to their tokens before approving.' },
      { id: 'q-4', answer: 'Not yet. The security posture needs improvement: no CSP headers, client-side validation gaps, and missing rate limiting on the swap API. Fix those and it would be competitive.' },
    ],
    diana: [
      { id: 'q-1', answer: 3 },
      { id: 'q-2', answer: 7 },
      { id: 'q-3', answer: 'The typography is inconsistent — I counted 4 different font sizes on the swap page alone. Establish a clear type scale (e.g. 14/16/20/24px) and stick to it. Also the primary CTA button needs more vertical padding on mobile.' },
      { id: 'q-4', answer: 'The core UX flow is solid but the visual design needs polish. Inconsistent spacing, poor mobile responsiveness, and missing micro-interactions make it feel like an MVP. With a focused design sprint it could be great.' },
    ],
    fiona: [
      { id: 'q-1', answer: 1 },
      { id: 'q-2', answer: 2 },
      { id: 'q-3', answer: 'Everything. I could not use the swap form with keyboard alone. The tab order is completely broken — it skips the main content area. Error messages are only shown in red text with no icon or screen reader announcement. For someone who relies on assistive technology, this application is essentially unusable.' },
      { id: 'q-4', answer: 'Not in its current state. My students with visual impairments could not use this at all. The text is too small (13px body), contrast ratios fail WCAG AA on most interactive elements, and there are zero ARIA landmarks. I would need to see full WCAG 2.1 AA compliance before recommending this to anyone.' },
    ],
    grace: [
      { id: 'q-1', answer: 3 },
      { id: 'q-2', answer: 4 },
      { id: 'q-3', answer: 'The lack of a design system is the root cause of every visual issue. I found 7 different font sizes, 6 different grays, 3 different border-radius values, and inconsistent spacing throughout. Building with Figma tokens or Tailwind config constraints would solve 80% of the visual inconsistencies I documented.' },
      { id: 'q-4', answer: 'Would not recommend yet. The visual language is fragmented — it feels like 3 different designers worked on different sections without a shared system. The good news: the component structure is there, and a design token pass (spacing, type scale, color, radius) would transform this. I have done this exact refactor at my previous company and it typically takes 2-3 weeks for a product this size.' },
    ],
  };
  const questionnaireAnswers = questionnaireMap[testerKey];

  const qualityScores: Record<string, number> = {
    alice: 4.5,
    bob: 2.8,
    charlie: 4.9,
    diana: 3.8,
    fiona: 4.2,
    grace: 4.6,
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
  // ── 1. "Speed Demon" — DeFi Performance Analyst ──
  alice: {
    test_style: { thoroughness: 0.80, speed: 0.95, ux_focus: 0.40, bug_detection: 0.70, creativity: 0.50 },
    expertise: { defi: 0.98, nft: 0.20, gaming: 0.10, ai_tools: 0.45, general_web: 0.60 },
    feedback_pattern: { ui_critical: 0.30, security_aware: 0.55, performance_sensitive: 0.98, accessibility_focus: 0.10, detail_oriented: 0.85 },
    reliability: { quality_score: 4.5, consistency: 0.92, response_rate: 0.95 },
    demographics: { age_group: 'adult', tech_literacy: 0.95, crypto_experience: 0.98, design_sensitivity: 0.20, patience_level: 0.25 },
    ux_preferences: { visual_style: 'minimal', font_size_preference: 0.3, information_density: 0.95, animation_tolerance: 0.1, color_contrast_need: 0.4, mobile_first: false },
    voice_sample: 'Numbers don\'t lie. Swap latency was 12.3s — unacceptable for a DEX claiming "instant" execution. Price impact showed 0.3% but actual slippage was 0.7% post-execution. Where\'s the gas estimation? I had to guess if I had enough SOL for fees. Add a "Max" button that accounts for gas. Charting is decent but needs 1m candles, not just 15m.',
  },
  // ── 2. "Zoomer" — Gen Z Teen Tester ──
  bob: {
    test_style: { thoroughness: 0.40, speed: 0.30, ux_focus: 0.95, bug_detection: 0.25, creativity: 0.90 },
    expertise: { defi: 0.15, nft: 0.80, gaming: 0.90, ai_tools: 0.70, general_web: 0.85 },
    feedback_pattern: { ui_critical: 0.95, security_aware: 0.10, performance_sensitive: 0.55, accessibility_focus: 0.30, detail_oriented: 0.35 },
    reliability: { quality_score: 2.8, consistency: 0.55, response_rate: 0.70 },
    demographics: { age_group: 'teen', tech_literacy: 0.75, crypto_experience: 0.20, design_sensitivity: 0.95, patience_level: 0.15 },
    ux_preferences: { visual_style: 'playful', font_size_preference: 0.5, information_density: 0.2, animation_tolerance: 0.95, color_contrast_need: 0.3, mobile_first: true },
    voice_sample: 'ok so first off this looks like it was made in 2019 lol 💀 where\'s the dark mode?? the font is giving corporate spreadsheet vibes. also why do i need to read a whole paragraph just to swap tokens? just make it simple like one big button. the loading animation is SO slow it literally made me want to close the tab. ngl the gradient on the header is kinda fire tho 🔥',
  },
  // ── 3. "The Auditor" — Blockchain Security Expert ──
  charlie: {
    test_style: { thoroughness: 0.98, speed: 0.30, ux_focus: 0.20, bug_detection: 0.99, creativity: 0.45 },
    expertise: { defi: 0.90, nft: 0.40, gaming: 0.10, ai_tools: 0.50, general_web: 0.85 },
    feedback_pattern: { ui_critical: 0.15, security_aware: 0.99, performance_sensitive: 0.80, accessibility_focus: 0.10, detail_oriented: 0.98 },
    reliability: { quality_score: 4.9, consistency: 0.97, response_rate: 0.85 },
    demographics: { age_group: 'adult', tech_literacy: 0.99, crypto_experience: 0.95, design_sensitivity: 0.10, patience_level: 0.85 },
    ux_preferences: { visual_style: 'minimal', font_size_preference: 0.4, information_density: 0.9, animation_tolerance: 0.05, color_contrast_need: 0.5, mobile_first: false },
    voice_sample: 'CRITICAL: Token approval request asks for unlimited allowance (type(uint256).max) — should be exact amount only. CSP headers missing frame-ancestors directive → clickjacking vector. API error responses leak stack traces including server path /app/src/routes/swap.ts:142. Client-side amount validation uses parseFloat which rounds — attacker could drain dust amounts. 47 uncached API calls on page load. No rate limiting on swap endpoint. Recommend: implement request batching, add CSP, scope token approvals, sanitize errors.',
  },
  // ── 4. "Eagle Eye" — Accessibility & Senior UX Expert ──
  fiona: {
    test_style: { thoroughness: 0.90, speed: 0.35, ux_focus: 0.85, bug_detection: 0.60, creativity: 0.40 },
    expertise: { defi: 0.10, nft: 0.15, gaming: 0.05, ai_tools: 0.25, general_web: 0.95 },
    feedback_pattern: { ui_critical: 0.75, security_aware: 0.20, performance_sensitive: 0.45, accessibility_focus: 0.99, detail_oriented: 0.90 },
    reliability: { quality_score: 4.2, consistency: 0.88, response_rate: 0.75 },
    demographics: { age_group: 'senior', tech_literacy: 0.55, crypto_experience: 0.08, design_sensitivity: 0.70, patience_level: 0.90 },
    ux_preferences: { visual_style: 'professional', font_size_preference: 0.9, information_density: 0.3, animation_tolerance: 0.2, color_contrast_need: 0.95, mobile_first: false },
    voice_sample: 'The body text at 13px is far too small — WCAG requires minimum 16px for comfortable reading. I tried navigating with keyboard only: Tab order skips the swap button entirely, going from the amount input directly to the footer. The "Connect Wallet" button has a 2.1:1 contrast ratio against its background — WCAG AA requires 4.5:1 minimum. None of the input fields have visible focus indicators. The token dropdown has no ARIA labels — my screen reader announced it as "button" with no context.',
  },
  // ── 5. "Pixel Perfect" — UI/UX Design System Lead ──
  grace: {
    test_style: { thoroughness: 0.85, speed: 0.50, ux_focus: 0.98, bug_detection: 0.55, creativity: 0.85 },
    expertise: { defi: 0.35, nft: 0.45, gaming: 0.25, ai_tools: 0.40, general_web: 0.95 },
    feedback_pattern: { ui_critical: 0.99, security_aware: 0.15, performance_sensitive: 0.50, accessibility_focus: 0.70, detail_oriented: 0.95 },
    reliability: { quality_score: 4.6, consistency: 0.90, response_rate: 0.88 },
    demographics: { age_group: 'young_adult', tech_literacy: 0.85, crypto_experience: 0.50, design_sensitivity: 0.99, patience_level: 0.60 },
    ux_preferences: { visual_style: 'rich', font_size_preference: 0.6, information_density: 0.5, animation_tolerance: 0.7, color_contrast_need: 0.8, mobile_first: false },
    voice_sample: 'The type scale is broken — I count 14px, 15px, 16px, 18px, and 22px on this one page alone. Pick 4 sizes max and stick to them. Spacing grid appears to be 8px-based but the card padding is 18px (not divisible by 8) and the section gap alternates between 24px and 32px with no pattern. The primary CTA uses border-radius: 8px but the secondary uses 12px — inconsistent. Color system has 4 different grays in the sidebar alone. This needs a design tokens pass before shipping.',
  },
};

// ─── Diana's Persona Vector (NOT inserted — demo will generate this live) ──
// This is the expected output for reference / verification after the demo:
//
// const DIANA_PERSONA_VECTOR = {
//   test_style: { thoroughness: 0.75, speed: 0.65, ux_focus: 0.95, bug_detection: 0.60, creativity: 0.80 },
//   expertise: { defi: 0.25, nft: 0.35, gaming: 0.20, ai_tools: 0.30, general_web: 0.85 },
//   feedback_pattern: { ui_critical: 0.95, security_aware: 0.20, performance_sensitive: 0.50, accessibility_focus: 0.85, detail_oriented: 0.80 },
//   reliability: { quality_score: 3.8, consistency: 0.75, response_rate: 0.90 },
//   demographics: { age_group: '20s', tech_literacy: 0.70, crypto_experience: 0.25, design_sensitivity: 0.95, patience_level: 0.55 },
//   ux_preferences: { visual_style: 'minimal', font_size_preference: 'medium', information_density: 'low', animation_tolerance: 'medium', color_contrast_need: 'high', mobile_first: true },
//   voice_sample: 'Design-focused, mobile-first perspective. Highlights visual hierarchy, spacing, and responsive issues. Example: "The CTA button competes with nav links — needs more visual weight. Typography scale is inconsistent: 4 different sizes on one page. Mobile layout breaks at 375px. Solid functionality but needs a design systems pass."',
// };

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
      INSERT INTO tests (id, company_addr, target_url, requirements, budget_usdc, reward_per_tester, status, escrow_pda)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      TEST_IDS.dex,
      COMPANY_WALLET,
      'https://jup.ag',
      'Full UX audit of the Jupiter token swap interface. Focus on wallet connection flow, swap execution, slippage settings, and transaction history. Test on both desktop and mobile viewports.',
      500.0,
      5.0,
      'active',
      'EscrowPda111111111111111111111111111111111111',
    ]);
    console.log('  Test 1: "demo-dex.app" (active, $500 budget, $5/tester)');

    await client.query(`
      INSERT INTO tests (id, company_addr, target_url, requirements, budget_usdc, reward_per_tester, status, escrow_pda)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      TEST_IDS.nft,
      COMPANY_WALLET,
      'https://magiceden.io/solana',
      'End-to-end testing of the Magic Eden NFT marketplace. Cover browsing, searching, buying, and listing flows. Pay special attention to the first-time user experience and fee transparency.',
      350.0,
      3.0,
      'active',
      'EscrowPda222222222222222222222222222222222222',
    ]);
    console.log('  Test 2: "demo-nft.app" (active, $350 budget, $3/tester)');

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
      { key: 'fiona',   wallet: TESTER_WALLETS.fiona,   testsDone: 3, personaId: PERSONA_IDS.fiona },
      { key: 'grace',   wallet: TESTER_WALLETS.grace,   testsDone: 3, personaId: PERSONA_IDS.grace },
      { key: 'diana',   wallet: TESTER_WALLETS.diana,   testsDone: 3, personaId: null },
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

    // Each active tester gets 1 report per test. UNIQUE (tester_addr,
    // test_id, is_persona_test) blocks a same-tester "retake" on the
    // same test — previously the seed inserted two DEX rows per tester
    // to demonstrate resubmission, but that was a demo artifact and is
    // now disallowed. To bulk up DEX counts, use different personas.
    for (const testerKey of ['alice', 'bob', 'charlie', 'fiona', 'grace'] as const) {
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

      console.log(`  ${TESTER_PROFILES[testerKey].displayName}: 2 reports (quality: ${r1.qualityScore})`);
    }

    // Diana: 2 unique reports (DEX + NFT). testers.tests_done is still
    // 3 per the hardcoded seed above — that column is independent of
    // the test_reports row count and drives the persona-generation gate.
    {
      // Report 1: DEX test
      const dr1 = generateReportForTest('diana', TEST_IDS.dex, 'dex');
      await client.query(`
        INSERT INTO test_reports (id, tester_addr, test_id, checklist_results, scenario_log, questionnaire_answers, quality_score, is_persona_test)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        dr1.reportId, dr1.testerAddr, dr1.testId,
        JSON.stringify(dr1.checklistResults),
        JSON.stringify(dr1.scenarioLog),
        JSON.stringify(dr1.questionnaireAnswers),
        dr1.qualityScore, dr1.isPersonaTest,
      ]);
      reportIds.push({ reportId: dr1.reportId, testerAddr: dr1.testerAddr, testId: dr1.testId, qualityScore: dr1.qualityScore });

      // Report 2: NFT test
      const dr3 = generateReportForTest('diana', TEST_IDS.nft, 'nft');
      await client.query(`
        INSERT INTO test_reports (id, tester_addr, test_id, checklist_results, scenario_log, questionnaire_answers, quality_score, is_persona_test)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        dr3.reportId, dr3.testerAddr, dr3.testId,
        JSON.stringify(dr3.checklistResults),
        JSON.stringify(dr3.scenarioLog),
        JSON.stringify(dr3.questionnaireAnswers),
        dr3.qualityScore, dr3.isPersonaTest,
      ]);
      reportIds.push({ reportId: dr3.reportId, testerAddr: dr3.testerAddr, testId: dr3.testId, qualityScore: dr3.qualityScore });

      console.log(`  ${TESTER_PROFILES.diana.displayName}: 3 reports (quality: ${dr1.qualityScore}) — NO persona (will generate live in demo)`);
    }

    // ── Seed personas ──────────────────────────────────
    divider('Step 7: Seed personas');

    for (const testerKey of ['alice', 'bob', 'charlie', 'fiona', 'grace'] as const) {
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
      const specialties: Record<string, string> = {
        alice: 'DeFi Performance',
        bob: 'Gen Z / Teen UX',
        charlie: 'Security Audit',
        fiona: 'Accessibility',
        grace: 'Design Systems',
      };
      console.log(`  Persona: ${TESTER_PROFILES[testerKey].displayName} [${specialties[testerKey]}] — Quality: ${vector.reliability.quality_score}/5`);
    }

    // ── Seed settlements (3 USDC settlements for the first report of each tester) ──
    divider('Step 8: Seed settlements');

    const paymentAmounts: Record<string, number> = {
      alice: 45.00,
      bob: 28.00,
      charlie: 49.00,
      fiona: 42.00,
      grace: 46.00,
    };

    for (const testerKey of ['alice', 'bob', 'charlie', 'fiona', 'grace'] as const) {
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

    // ── Issue real SAS attestations via API ─────────────
    divider('Step 9: Issue SAS attestations (on-chain)');

    const API_BASE = process.env.API_URL || 'http://localhost:4100';
    for (const testerKey of ['alice', 'bob', 'charlie', 'fiona', 'grace'] as const) {
      const personaId = PERSONA_IDS[testerKey];
      try {
        const resp = await fetch(`${API_BASE}/api/persona/${personaId}/renew-sas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (resp.ok) {
          const result = await resp.json() as { attestationId: string; onChain: boolean; explorerUrl?: string };
          // Update the persona's SAS attestation ID in DB
          await client.query(
            `UPDATE personas SET sas_attest_id = $1 WHERE id = $2`,
            [result.attestationId, personaId],
          );
          console.log(`  ${TESTER_PROFILES[testerKey].displayName}: ${result.onChain ? 'ON-CHAIN' : 'fallback'} — ${result.attestationId.slice(0, 16)}...`);
          if (result.explorerUrl) {
            console.log(`    Explorer: ${result.explorerUrl}`);
          }
        } else {
          const err = await resp.text();
          console.warn(`  ${TESTER_PROFILES[testerKey].displayName}: SAS failed (${resp.status}) — ${err}`);
        }
      } catch (fetchErr) {
        console.warn(`  ${TESTER_PROFILES[testerKey].displayName}: API unreachable — make sure API server is running on ${API_BASE}`);
      }
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
