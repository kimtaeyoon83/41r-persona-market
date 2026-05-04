#!/usr/bin/env npx tsx
/**
 * Seed the DB with 8 STANDARD_COHORTS × 100 = 800 synthetic personas
 * for the Audience-Fit Validator (Phase 2 §D2).
 *
 * Wallet generation — HD-derived (BIP-39 + SLIP-10 ed25519):
 *   master mnemonic → seed → m/44'/501'/<hd_index>'/0' → Solana keypair
 *
 *   hd_index assignment:
 *     cohort_index 0 (crypto_native)     → indices 0..99
 *     cohort_index 1 (defi_beginner)     → indices 100..199
 *     ...
 *     cohort_index 7 (non_tech_30s)      → indices 700..799
 *
 *   Re-running with the same mnemonic produces the same wallets.
 *   Re-runs are idempotent (skipped via hd_index UNIQUE check).
 *
 * Required env:
 *   DATABASE_URL              - Postgres connection string
 *   PERSONA_MASTER_MNEMONIC   - 24-word BIP-39 mnemonic (auto-loaded
 *                                from .env at repo root)
 *
 * Usage:
 *   pnpm tsx scripts/seed-validator-cohorts.ts
 *   pnpm tsx scripts/seed-validator-cohorts.ts --per-cohort 50  # smaller pool for tests
 *   pnpm tsx scripts/seed-validator-cohorts.ts --dry-run
 */

import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { STANDARD_COHORTS, type CohortDef } from '@41rpm/shared';
import { getPersonaAddress } from '../apps/api/src/services/persona_wallets.js';

const { Client } = pg;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

if (!process.env.PERSONA_MASTER_MNEMONIC) {
  console.error('PERSONA_MASTER_MNEMONIC required (set in .env)');
  process.exit(1);
}

// CLI args
const args = process.argv.slice(2);
const PER_COHORT = (() => {
  const idx = args.indexOf('--per-cohort');
  if (idx >= 0 && args[idx + 1]) return parseInt(args[idx + 1]!, 10);
  return 100;
})();
const DRY_RUN = args.includes('--dry-run');

// ─── Vector building (carried over from prior version) ───────────

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

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Seeding ${STANDARD_COHORTS.length} cohorts × ${PER_COHORT} = ${STANDARD_COHORTS.length * PER_COHORT} personas`);
  if (DRY_RUN) console.log('(dry-run — no DB writes)');

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  let testersCreated = 0;
  let personasCreated = 0;
  let skippedExisting = 0;

  try {
    for (let cohortIdx = 0; cohortIdx < STANDARD_COHORTS.length; cohortIdx++) {
      const cohort = STANDARD_COHORTS[cohortIdx]!;
      for (let i = 0; i < PER_COHORT; i++) {
        const hdIndex = cohortIdx * PER_COHORT + i;
        const walletAddr = getPersonaAddress(hdIndex);
        const displayName = `${cohort.label} #${i + 1}`;

        // Idempotent — skip if a persona already exists at this hd_index.
        const existing = await client.query(
          `SELECT id FROM personas WHERE hd_index = $1 LIMIT 1`,
          [hdIndex]
        );
        if (existing.rowCount && existing.rowCount > 0) {
          skippedExisting += 1;
          continue;
        }

        if (DRY_RUN) {
          if (i < 3 || i === PER_COHORT - 1) {
            console.log(`  [${hdIndex}] ${cohort.label.padEnd(20)} → ${walletAddr}`);
          } else if (i === 3) {
            console.log(`  ... (${PER_COHORT - 4} more)`);
          }
          continue;
        }

        // Insert tester (wallet_address = HD-derived pubkey base58).
        const tIns = await client.query(
          `INSERT INTO testers (wallet_address, display_name, profile, tests_done)
           VALUES ($1, $2, $3, 5)
           ON CONFLICT (wallet_address) DO NOTHING
           RETURNING wallet_address`,
          [
            walletAddr,
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

        const personaId = randomUUID();
        const vector = buildVectorForCohort(cohort);

        await client.query(
          `INSERT INTO personas (id, tester_addr, vector, hd_index, is_active)
           VALUES ($1, $2, $3, $4, true)`,
          [personaId, walletAddr, vector, hdIndex]
        );

        await client.query(
          `UPDATE testers SET persona_id = $1 WHERE wallet_address = $2`,
          [personaId, walletAddr]
        );

        personasCreated += 1;
      }
      const generated = (cohortIdx + 1) * PER_COHORT;
      console.log(`  ${cohort.label.padEnd(22)} done (cumulative ${generated})`);
    }

    console.log('');
    console.log(`✓ testers created:   ${testersCreated}`);
    console.log(`✓ personas created:  ${personasCreated}`);
    console.log(`↻ skipped existing:  ${skippedExisting}`);
    console.log(`Σ pool target:       ${STANDARD_COHORTS.length * PER_COHORT}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
