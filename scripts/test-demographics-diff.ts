/**
 * Demographics Differentiation Test
 * Same site → Teen vs Adult persona → compare actions + report
 */
import 'dotenv/config';
import { generatePersonaActions, generateAutoTestReport } from '../apps/api/src/services/llm.js';
import type { PersonaVector, GeneratedTestCases } from '@41rpm/shared';

const targetUrl = 'https://jup.ag';
const baseChecklist = [
  { id: 'CL01', task: 'Verify swap interface loads' },
  { id: 'CL02', task: 'Select SOL as input token' },
  { id: 'CL03', task: 'Check wallet connection flow' },
];

const testCases: GeneratedTestCases = {
  checklist: [
    { id: 'CL01', task: 'Verify swap interface loads', expected: 'Swap widget visible' },
    { id: 'CL02', task: 'Select SOL as input token', expected: 'SOL appears' },
    { id: 'CL03', task: 'Check wallet connection flow', expected: 'Wallet modal appears' },
  ],
  scenarios: [{ id: 'SC01', persona_type: 'First-time user', narrative: 'Try to swap SOL to USDC', evaluation_points: ['Clear flow'] }],
  questionnaire: [{ id: 'Q01', question: 'How intuitive was the interface?', type: 'rating_1_5' }],
};

const actionLog = [
  'Visited https://jup.ag',
  '[CL01] Verify swap interface loads -> OK',
  '[CL02] Select SOL as input token -> OK',
  '[CL03] Check wallet connection flow -> OK',
];

// ─── Teen Persona (16세, 크립토 초보, 디자인 민감, 인내심 낮음) ───
const teenPersona: PersonaVector = {
  test_style: { thoroughness: 0.4, speed: 0.9, ux_focus: 0.8, bug_detection: 0.3, creativity: 0.7 },
  expertise: { defi: 0.1, nft: 0.6, gaming: 0.9, ai_tools: 0.7, general_web: 0.8 },
  feedback_pattern: { ui_critical: 0.8, security_aware: 0.2, performance_sensitive: 0.7, accessibility_focus: 0.2, detail_oriented: 0.3 },
  reliability: { quality_score: 0.6, consistency: 0.5, response_rate: 0.7 },
  demographics: {
    age_group: 'teen',
    tech_literacy: 0.6,
    crypto_experience: 0.1,
    design_sensitivity: 0.9,
    patience_level: 0.2,
  },
  ux_preferences: {
    visual_style: 'playful',
    font_size_preference: 0.3,
    information_density: 0.2,
    animation_tolerance: 0.9,
    color_contrast_need: 0.3,
    mobile_first: true,
  },
  voice_sample: 'Uses casual slang, gives quick gut reactions. "this looks kinda fire ngl" or "bro this is confusing af". Gets bored fast. Judges apps like judging TikTok — 3 seconds to impress or swipe away.',
};

// ─── Adult Persona (45세, 전문직, 기능 중시, 인내심 높음) ───
const adultPersona: PersonaVector = {
  test_style: { thoroughness: 0.9, speed: 0.3, ux_focus: 0.6, bug_detection: 0.7, creativity: 0.4 },
  expertise: { defi: 0.4, nft: 0.1, gaming: 0.05, ai_tools: 0.3, general_web: 0.8 },
  feedback_pattern: { ui_critical: 0.5, security_aware: 0.8, performance_sensitive: 0.4, accessibility_focus: 0.7, detail_oriented: 0.9 },
  reliability: { quality_score: 0.9, consistency: 0.95, response_rate: 0.9 },
  demographics: {
    age_group: 'adult',
    tech_literacy: 0.5,
    crypto_experience: 0.2,
    design_sensitivity: 0.4,
    patience_level: 0.8,
  },
  ux_preferences: {
    visual_style: 'professional',
    font_size_preference: 0.7,
    information_density: 0.6,
    animation_tolerance: 0.3,
    color_contrast_need: 0.8,
    mobile_first: false,
  },
  voice_sample: 'Writes structured, formal feedback. Prioritizes clarity and trust signals. "The fee structure should be transparent before any wallet interaction." Questions everything from a risk/trust perspective.',
};

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  Demographics Test: Teen (16) vs Adult (45) on jup.ag ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Generate persona-specific actions
  console.log('Generating Teen browser actions...');
  const teenActions = await generatePersonaActions(teenPersona, targetUrl, baseChecklist);
  console.log('Generating Adult browser actions...\n');
  const adultActions = await generatePersonaActions(adultPersona, targetUrl, baseChecklist);

  console.log('═'.repeat(65));
  console.log(' TEEN (16세) — 브라우저 추가 행동');
  console.log('═'.repeat(65));
  for (const a of teenActions) {
    console.log(`  [${a.id}] ${a.action}`);
    console.log(`         → ${a.reason}\n`);
  }

  console.log('═'.repeat(65));
  console.log(' ADULT (45세) — 브라우저 추가 행동');
  console.log('═'.repeat(65));
  for (const a of adultActions) {
    console.log(`  [${a.id}] ${a.action}`);
    console.log(`         → ${a.reason}\n`);
  }

  // Generate reports with the same action data
  const teenActionLog = [...actionLog, '--- Persona-specific exploration ---', ...teenActions.map(a => `[${a.id}] ${a.action} -> OK (${a.reason})`)];
  const adultActionLog = [...actionLog, '--- Persona-specific exploration ---', ...adultActions.map(a => `[${a.id}] ${a.action} -> OK (${a.reason})`)];

  console.log('\nGenerating Teen report...');
  const teenReport = await generateAutoTestReport(teenPersona, [], teenActionLog, testCases);
  console.log('Generating Adult report...\n');
  const adultReport = await generateAutoTestReport(adultPersona, [], adultActionLog, testCases);

  console.log('═'.repeat(65));
  console.log(' TEEN REPORT');
  console.log('═'.repeat(65));
  console.log(teenReport.textReport);
  console.log('\nScores:', JSON.stringify({ overall: teenReport.uxFeedback.overall_score, usability: teenReport.uxFeedback.usability, design: teenReport.uxFeedback.visual_design }));
  console.log('Issues:');
  for (const i of (teenReport.uxFeedback.issues_found as string[] || [])) console.log('  -', i.slice(0, 120));

  console.log('\n' + '═'.repeat(65));
  console.log(' ADULT REPORT');
  console.log('═'.repeat(65));
  console.log(adultReport.textReport);
  console.log('\nScores:', JSON.stringify({ overall: adultReport.uxFeedback.overall_score, usability: adultReport.uxFeedback.usability, design: adultReport.uxFeedback.visual_design }));
  console.log('Issues:');
  for (const i of (adultReport.uxFeedback.issues_found as string[] || [])) console.log('  -', i.slice(0, 120));
}

main().catch(console.error);
