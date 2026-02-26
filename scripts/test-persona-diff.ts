/**
 * Persona Differentiation Test
 * Same screenshots + same action log → two different personas → compare reports
 */
import 'dotenv/config';
import { generateAutoTestReport } from '../apps/api/src/services/llm.js';
import type { PersonaVector, GeneratedTestCases } from '@41rpm/shared';

// ─── Same input data for both ───────────────────────
const actionLog = [
  'Visited https://jup.ag',
  '[CL01] Verify swap interface loads -> OK',
  '[CL02] Select SOL as input token -> OK',
  '[CL03] Select USDC as output token -> OK',
  '[CL04] Enter 1 SOL and check quote -> OK (received 87.32 USDC estimate)',
  '[CL05] Check wallet connection flow -> OK (Phantom modal appeared)',
  '[CL06] Check slippage settings -> Failed (no visible slippage control before connecting wallet)',
];

const testCases: GeneratedTestCases = {
  checklist: [
    { id: 'CL01', task: 'Verify swap interface loads', expected: 'Swap widget visible with token selectors' },
    { id: 'CL02', task: 'Select SOL as input token', expected: 'SOL appears in input field' },
    { id: 'CL03', task: 'Select USDC as output', expected: 'USDC selectable from token list' },
    { id: 'CL04', task: 'Enter amount and check quote', expected: 'Real-time quote with price impact' },
    { id: 'CL05', task: 'Test wallet connection', expected: 'Modal with supported wallets' },
    { id: 'CL06', task: 'Check slippage settings', expected: 'Accessible and modifiable slippage tolerance' },
  ],
  scenarios: [
    { id: 'SC01', persona_type: 'DeFi newcomer', narrative: 'First time using Jupiter to swap SOL to USDC', evaluation_points: ['Intuitive flow', 'Clear fee display', 'Confidence to execute'] },
  ],
  questionnaire: [
    { id: 'Q01', question: 'How easy was the swap interface?', type: 'rating_1_5' },
    { id: 'Q02', question: 'Were fees and price impact clear?', type: 'rating_1_5' },
    { id: 'Q03', question: 'What would you improve?', type: 'free_text' },
  ],
};

// ─── Persona A: Alice — DeFi expert, metrics-driven ─
const alicePersona: PersonaVector = {
  test_style: { thoroughness: 0.8, speed: 0.85, ux_focus: 0.7, bug_detection: 0.75, creativity: 0.5 },
  expertise: { defi: 0.95, nft: 0.4, gaming: 0.2, ai_tools: 0.6, general_web: 0.8 },
  feedback_pattern: { ui_critical: 0.6, security_aware: 0.5, performance_sensitive: 0.9, accessibility_focus: 0.3, detail_oriented: 0.85 },
  reliability: { quality_score: 0.9, consistency: 0.85, response_rate: 0.95 },
  voice_sample: 'Concise, metrics-driven feedback. Focuses on performance and efficiency. Benchmarks against competing DEXes like Raydium and Orca. Cares about execution speed, price impact accuracy, and MEV protection. Skips cosmetic issues.',
};

// ─── Persona B: Charlie — Security-focused, methodical ─
const charliePersona: PersonaVector = {
  test_style: { thoroughness: 0.95, speed: 0.4, ux_focus: 0.35, bug_detection: 0.9, creativity: 0.7 },
  expertise: { defi: 0.8, nft: 0.3, gaming: 0.15, ai_tools: 0.5, general_web: 0.9 },
  feedback_pattern: { ui_critical: 0.4, security_aware: 0.95, performance_sensitive: 0.6, accessibility_focus: 0.8, detail_oriented: 0.95 },
  reliability: { quality_score: 0.88, consistency: 0.92, response_rate: 0.9 },
  voice_sample: 'Technical, security-focused, methodical. Reports edge cases and potential vulnerabilities. Checks for XSS vectors, token approval risks, smart contract interaction transparency. Always asks: "what happens if the user makes a mistake?"',
};

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  Persona Differentiation Test                        ║');
  console.log('║  Same site, same actions → two personas → compare    ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  console.log('Generating Alice report (DeFi expert, metrics-driven)...');
  const aliceReport = await generateAutoTestReport(alicePersona, [], actionLog, testCases);

  console.log('Generating Charlie report (Security-focused, methodical)...\n');
  const charlieReport = await generateAutoTestReport(charliePersona, [], actionLog, testCases);

  // ─── Compare ──────────────────────────────────────
  console.log('═'.repeat(70));
  console.log(' ALICE (DeFi=0.95, security=0.5, performance=0.9)');
  console.log('═'.repeat(70));
  console.log('\n[Report]\n' + aliceReport.textReport);
  console.log('\n[Scores] overall=' + aliceReport.uxFeedback.overall_score +
    ' usability=' + aliceReport.uxFeedback.usability +
    ' design=' + aliceReport.uxFeedback.visual_design +
    ' perf=' + aliceReport.uxFeedback.performance);
  console.log('[Issues] ' + JSON.stringify(aliceReport.uxFeedback.issues_found));
  console.log('[Suggestions] ' + JSON.stringify(aliceReport.uxFeedback.suggestions));

  console.log('\n\n' + '═'.repeat(70));
  console.log(' CHARLIE (DeFi=0.8, security=0.95, detail=0.95)');
  console.log('═'.repeat(70));
  console.log('\n[Report]\n' + charlieReport.textReport);
  console.log('\n[Scores] overall=' + charlieReport.uxFeedback.overall_score +
    ' usability=' + charlieReport.uxFeedback.usability +
    ' design=' + charlieReport.uxFeedback.visual_design +
    ' perf=' + charlieReport.uxFeedback.performance);
  console.log('[Issues] ' + JSON.stringify(charlieReport.uxFeedback.issues_found));
  console.log('[Suggestions] ' + JSON.stringify(charlieReport.uxFeedback.suggestions));

  // ─── Diff Summary ─────────────────────────────────
  console.log('\n\n' + '═'.repeat(70));
  console.log(' COMPARISON');
  console.log('═'.repeat(70));

  const aIssues = (aliceReport.uxFeedback.issues_found as string[]) || [];
  const cIssues = (charlieReport.uxFeedback.issues_found as string[]) || [];

  console.log(`\nAlice: ${aIssues.length} issues, overall=${aliceReport.uxFeedback.overall_score}`);
  console.log(`Charlie: ${cIssues.length} issues, overall=${charlieReport.uxFeedback.overall_score}`);
  console.log(`\nAlice report length: ${aliceReport.textReport.length} chars`);
  console.log(`Charlie report length: ${charlieReport.textReport.length} chars`);
}

main().catch(console.error);
