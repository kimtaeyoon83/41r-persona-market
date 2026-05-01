#!/usr/bin/env npx tsx
/**
 * Seed the local DB with 112 fake personas covering all 8
 * STANDARD_COHORTS (14 per cohort) for the Audience-Fit Validator
 * Phase 1B simulator runs. Without this seed the cohort selector
 * leaves senior / web3_pro / etc. under-quota when only the legacy
 * append-diverse-personas pool (~20 personas) is loaded.
 *
 * Idempotent: each tester wallet is `seed_cohort_<id>_NN`. Existing
 * rows are skipped via ON CONFLICT / pre-check, so re-running is a
 * no-op once the 112 wallets exist.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/seed-validator-cohorts.ts
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { STANDARD_COHORTS, type CohortDef } from '@41rpm/shared';

const { Client } = pg;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

// Deterministic-ish RNG so a re-run with the same seed produces the
// same vectors (useful for diffing scan results).
let rngState = 1234567;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}
function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)]!;
}
function inRange(
  range: [number, number] | undefined,
  fallback: [number, number] = [0.3, 0.7]
): number {
  const [lo, hi] = range ?? fallback;
  return lo + rand() * (hi - lo);
}

// Cohort-specific voice sample templates. Sounds like the persona,
// not like the engineer who built them.
const VOICE_BY_COHORT: Record<string, string[]> = {
  crypto_native: [
    'Slippage and MEV signaling matter most to me. I move fast.',
    'I prefer mobile wallets that just work — keyboard shortcuts on desktop are a bonus.',
    'If the security model is unclear in 30 seconds, I bounce.',
  ],
  defi_beginner: [
    'I want to learn but the jargon scares me off. Hand-holding helps.',
    'I ask questions before pressing anything that costs money.',
    'A clear glossary would make me much more comfortable.',
  ],
  designer_20s: [
    'Visual hierarchy and consistency matter. Cluttered UIs lose me fast.',
    'I notice typography choices and motion easing more than the average user.',
    'Information density is fine if the rhythm is right.',
  ],
  senior: [
    'Buttons need to be big enough to tap without squinting.',
    "I'm cautious — if it looks risky I won't proceed.",
    'I prefer desktop and longer sessions over mobile dashes.',
  ],
  teen_newcomer: [
    'I follow my friends. If they use it, I might.',
    "If it's all in English jargon I just close the tab.",
    'I prefer fun, mobile-first interfaces.',
  ],
  mobile_power: [
    'Mobile-first or I lose interest. I expect the desktop to follow.',
    'I use this on the subway between meetings — no time for friction.',
    'Speed matters more than depth.',
  ],
  web3_pro: [
    'I run multi-chain ops. Power-user shortcuts and CSV export are non-negotiable.',
    'I notice gas-aware UX and signing UX immediately.',
    'I will dig into a docs page if the surface UI is solid.',
  ],
  non_tech_30s: [
    'I just want it to work. I do not want to read a tutorial.',
    "If I'm uncertain about a button I won't press it.",
    'Clear price + clear next step is what gets me through.',
  ],
};

function buildVectorForCohort(cohort: CohortDef): unknown {
  const sel = cohort.selector;

  const ageGroup = sel.age_group ? pick(sel.age_group) : pick(['young_adult', 'adult'] as const);
  const techLit = inRange(sel.tech_literacy, [0.4, 0.8]);
  const cryptoExp = inRange(sel.crypto_experience, [0.0, 0.6]);
  const designSens = inRange(sel.design_sensitivity, [0.3, 0.7]);
  const patience = inRange(sel.patience_level, [0.4, 0.8]);

  const mobileFirst = sel.mobile_first
    ? pick(sel.mobile_first)
    : Math.random() < 0.5;

  const defi = inRange(sel.expertise_defi, [0.0, 0.5]);
  const nft = inRange(sel.expertise_nft, [0.0, 0.4]);
  const generalWeb = inRange(sel.expertise_general_web, [0.4, 0.8]);

  const uiCritical = inRange(sel.ui_critical, [0.3, 0.7]);
  const securityAware = inRange(sel.security_aware, [0.3, 0.7]);
  const detailOriented = inRange(sel.detail_oriented, [0.3, 0.7]);

  return {
    test_style: {
      thoroughness: 0.4 + rand() * 0.4,
      speed: 0.3 + rand() * 0.5,
      ux_focus: designSens,
      bug_detection: 0.3 + rand() * 0.4,
      creativity: 0.3 + rand() * 0.5,
    },
    expertise: {
      defi,
      nft,
      gaming: ageGroup === 'teen' ? 0.5 + rand() * 0.4 : 0.1 + rand() * 0.4,
      ai_tools: 0.2 + rand() * 0.5,
      general_web: generalWeb,
    },
    feedback_pattern: {
      ui_critical: uiCritical,
      security_aware: securityAware,
      performance_sensitive: 0.3 + rand() * 0.5,
      accessibility_focus: ageGroup === 'senior' ? 0.5 + rand() * 0.4 : 0.2 + rand() * 0.4,
      detail_oriented: detailOriented,
    },
    reliability: {
      quality_score: 0.6 + rand() * 0.35,
      consistency: 0.6 + rand() * 0.3,
      response_rate: 0.7 + rand() * 0.3,
    },
    demographics: {
      age_group: ageGroup,
      tech_literacy: techLit,
      crypto_experience: cryptoExp,
      design_sensitivity: designSens,
      patience_level: patience,
    },
    ux_preferences: {
      visual_style: pick(['minimal', 'rich', 'playful', 'professional'] as const),
      font_size_preference: ageGroup === 'senior' ? 0.7 + rand() * 0.3 : 0.4 + rand() * 0.4,
      information_density: 0.4 + rand() * 0.4,
      animation_tolerance: ageGroup === 'teen' ? 0.6 + rand() * 0.4 : 0.3 + rand() * 0.5,
      color_contrast_need: ageGroup === 'senior' ? 0.6 + rand() * 0.4 : 0.3 + rand() * 0.4,
      mobile_first: mobileFirst,
    },
    voice_sample: pick(VOICE_BY_COHORT[cohort.id] ?? ['Synthetic seed persona.']),
  };
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  let testersCreated = 0;
  let personasCreated = 0;

  try {
    for (const cohort of STANDARD_COHORTS) {
      for (let i = 1; i <= cohort.target_n; i++) {
        const wallet = `seed_cohort_${cohort.id}_${String(i).padStart(2, '0')}`;
        const displayName = `${cohort.label} #${i}`;

        const tIns = await client.query(
          `INSERT INTO testers (wallet_address, display_name, profile, tests_done)
           VALUES ($1, $2, $3, 5)
           ON CONFLICT (wallet_address) DO NOTHING
           RETURNING wallet_address`,
          [
            wallet,
            displayName,
            {
              expertise:
                cohort.id === 'crypto_native' || cohort.id === 'web3_pro'
                  ? ['defi', 'nft']
                  : ['general_web'],
              experience_level:
                cohort.id === 'crypto_native' || cohort.id === 'web3_pro'
                  ? 'advanced'
                  : 'beginner',
              preferred_domains: ['defi', 'wallet'],
              ui_preference: 'clean',
              languages: ['ko', 'en'],
              device_types: cohort.selector.mobile_first?.[0]
                ? ['mobile']
                : ['desktop'],
            },
          ]
        );
        if (tIns.rowCount && tIns.rowCount > 0) testersCreated += 1;

        const existing = await client.query(
          `SELECT id FROM personas WHERE tester_addr = $1 LIMIT 1`,
          [wallet]
        );
        if (existing.rowCount && existing.rowCount > 0) continue;

        const personaId = randomUUID();
        const vector = buildVectorForCohort(cohort);

        await client.query(
          `INSERT INTO personas (id, tester_addr, vector, is_active)
           VALUES ($1, $2, $3, true)`,
          [personaId, wallet, vector]
        );

        await client.query(
          `UPDATE testers SET persona_id = $1 WHERE wallet_address = $2`,
          [personaId, wallet]
        );

        personasCreated += 1;
      }
    }

    console.log(`✓ testers created: ${testersCreated}`);
    console.log(`✓ personas created: ${personasCreated}`);
    console.log(
      `✓ target: ${STANDARD_COHORTS.length} cohorts × ${STANDARD_COHORTS[0]!.target_n} = ${
        STANDARD_COHORTS.length * STANDARD_COHORTS[0]!.target_n
      }`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
