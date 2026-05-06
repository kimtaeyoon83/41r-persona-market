// Acquisition Layer v1.1 — heuristic priors for Stage 2 weighting.
//
// 41R Stage 1 (persona simulation) measures engaged-audience reactions.
// Stage 2 weights those reactions by site-realistic traffic patterns so
// the aggregate output approximates what real visitor traffic would
// produce. This file is the v1.0 baseline prior table — educated
// guesses keyed on (site_category, cohort) → {arrival_share,
// abandon_rate}. It is NOT measured calibration; refinement candidates
// will land here as GA-validated data accumulates from beta sites.
//
// arrival_share : fraction of typical site traffic from this cohort
//                 (sums to 1.0 across the 8 cohorts per category)
// abandon_rate  : fraction of arrivals that bounce within 15 seconds
//
// Sources / reasoning consulted (all values are first-principles
// estimates, none cited as exact numbers):
//   - HTTP Archive Web Almanac 2024: bounce rate by category
//   - Statcounter device share (mobile vs desktop)
//   - Pew Research demographics by digital service category
//   - Industry reports on per-vertical engagement (e.g. SimilarWeb
//     public summaries)
//
// Categories match `apps/api/src/services/site_classifier.ts`
// CATEGORIES enum. Cohort ids match STANDARD_COHORTS in cohorts.ts.

import type { CohortId } from './cohorts.js';

// ─── Category enum (mirrors site_classifier output) ─────────────
export const ACQUISITION_CATEGORIES = [
  'DeFi',
  'SaaS',
  'E-commerce',
  'Social',
  'Gaming',
  'Productivity',
  'AI Tools',
  'Marketplace',
  'Media',
  'Crypto Wallet',
  'NFT',
  'Other',
] as const;

export type AcquisitionCategory = (typeof ACQUISITION_CATEGORIES)[number];

// ─── Per-(category, cohort) prior ───────────────────────────────
export type CohortAcquisitionPrior = {
  arrival_share: number; // 0-1, sums to 1.0 across cohorts per category
  abandon_rate: number; // 0-1, fraction abandoning within 15s
};

export type CategoryPriors = Record<CohortId, CohortAcquisitionPrior>;

// ─── The prior table — 12 categories × 8 cohorts = 96 entries ───

const _DEFI: CategoryPriors = {
  // Crypto/web3 audiences dominate; senior/teen/non-tech arrive by
  // accident or curiosity, abandon fast.
  crypto_native: { arrival_share: 0.30, abandon_rate: 0.20 },
  web3_pro: { arrival_share: 0.30, abandon_rate: 0.25 },
  defi_beginner: { arrival_share: 0.20, abandon_rate: 0.50 },
  mobile_power: { arrival_share: 0.08, abandon_rate: 0.55 },
  non_tech_30s: { arrival_share: 0.05, abandon_rate: 0.75 },
  designer_20s: { arrival_share: 0.04, abandon_rate: 0.65 },
  teen_newcomer: { arrival_share: 0.02, abandon_rate: 0.80 },
  senior: { arrival_share: 0.01, abandon_rate: 0.90 },
};

const _SAAS: CategoryPriors = {
  // B2B productivity/dev tools — mass-market 30s + designers + mobile
  // power users dominate. Crypto cohorts under-indexed.
  non_tech_30s: { arrival_share: 0.30, abandon_rate: 0.50 },
  mobile_power: { arrival_share: 0.20, abandon_rate: 0.50 },
  designer_20s: { arrival_share: 0.18, abandon_rate: 0.45 },
  defi_beginner: { arrival_share: 0.12, abandon_rate: 0.55 },
  senior: { arrival_share: 0.10, abandon_rate: 0.65 },
  web3_pro: { arrival_share: 0.05, abandon_rate: 0.60 },
  teen_newcomer: { arrival_share: 0.03, abandon_rate: 0.70 },
  crypto_native: { arrival_share: 0.02, abandon_rate: 0.65 },
};

const _ECOMMERCE: CategoryPriors = {
  // Generic retail (Merch Store, Amazon-style). Mass-market 30s lead.
  // Web3/crypto cohorts at floor — they only land here by accident.
  non_tech_30s: { arrival_share: 0.28, abandon_rate: 0.45 },
  mobile_power: { arrival_share: 0.22, abandon_rate: 0.40 },
  designer_20s: { arrival_share: 0.13, abandon_rate: 0.50 },
  defi_beginner: { arrival_share: 0.13, abandon_rate: 0.55 },
  senior: { arrival_share: 0.12, abandon_rate: 0.60 },
  teen_newcomer: { arrival_share: 0.06, abandon_rate: 0.65 },
  web3_pro: { arrival_share: 0.04, abandon_rate: 0.70 },
  crypto_native: { arrival_share: 0.02, abandon_rate: 0.75 },
};

const _SOCIAL: CategoryPriors = {
  // Wide demographic net (Twitter, Reddit, etc.) — relatively flat
  // distribution, abandon rates moderate across the board.
  non_tech_30s: { arrival_share: 0.25, abandon_rate: 0.40 },
  mobile_power: { arrival_share: 0.22, abandon_rate: 0.40 },
  designer_20s: { arrival_share: 0.15, abandon_rate: 0.45 },
  defi_beginner: { arrival_share: 0.12, abandon_rate: 0.55 },
  teen_newcomer: { arrival_share: 0.10, abandon_rate: 0.50 },
  senior: { arrival_share: 0.08, abandon_rate: 0.55 },
  web3_pro: { arrival_share: 0.05, abandon_rate: 0.50 },
  crypto_native: { arrival_share: 0.03, abandon_rate: 0.55 },
};

const _GAMING: CategoryPriors = {
  // Mobile + teen heavy. Senior under-indexed.
  mobile_power: { arrival_share: 0.25, abandon_rate: 0.40 },
  teen_newcomer: { arrival_share: 0.20, abandon_rate: 0.50 },
  non_tech_30s: { arrival_share: 0.18, abandon_rate: 0.50 },
  designer_20s: { arrival_share: 0.13, abandon_rate: 0.55 },
  defi_beginner: { arrival_share: 0.10, abandon_rate: 0.55 },
  web3_pro: { arrival_share: 0.06, abandon_rate: 0.55 },
  crypto_native: { arrival_share: 0.05, abandon_rate: 0.55 },
  senior: { arrival_share: 0.03, abandon_rate: 0.75 },
};

const _PRODUCTIVITY: CategoryPriors = {
  // Notion / Linear / Todoist — knowledge worker + designer leaning.
  non_tech_30s: { arrival_share: 0.32, abandon_rate: 0.45 },
  designer_20s: { arrival_share: 0.20, abandon_rate: 0.40 },
  mobile_power: { arrival_share: 0.15, abandon_rate: 0.50 },
  defi_beginner: { arrival_share: 0.10, abandon_rate: 0.55 },
  senior: { arrival_share: 0.10, abandon_rate: 0.65 },
  web3_pro: { arrival_share: 0.06, abandon_rate: 0.55 },
  teen_newcomer: { arrival_share: 0.04, abandon_rate: 0.65 },
  crypto_native: { arrival_share: 0.03, abandon_rate: 0.60 },
};

const _AI_TOOLS: CategoryPriors = {
  // Broadest curiosity demographic — ChatGPT-era AI tools draw
  // everyone. Abandon rates moderate.
  mobile_power: { arrival_share: 0.22, abandon_rate: 0.40 },
  non_tech_30s: { arrival_share: 0.20, abandon_rate: 0.45 },
  designer_20s: { arrival_share: 0.18, abandon_rate: 0.40 },
  defi_beginner: { arrival_share: 0.12, abandon_rate: 0.50 },
  web3_pro: { arrival_share: 0.10, abandon_rate: 0.45 },
  crypto_native: { arrival_share: 0.08, abandon_rate: 0.50 },
  teen_newcomer: { arrival_share: 0.06, abandon_rate: 0.55 },
  senior: { arrival_share: 0.04, abandon_rate: 0.70 },
};

const _MARKETPLACE: CategoryPriors = {
  // eBay/Etsy + OpenSea-adjacent — wider design/crypto distribution
  // than pure ecommerce.
  non_tech_30s: { arrival_share: 0.22, abandon_rate: 0.50 },
  mobile_power: { arrival_share: 0.20, abandon_rate: 0.45 },
  designer_20s: { arrival_share: 0.15, abandon_rate: 0.45 },
  defi_beginner: { arrival_share: 0.12, abandon_rate: 0.55 },
  web3_pro: { arrival_share: 0.10, abandon_rate: 0.50 },
  senior: { arrival_share: 0.08, abandon_rate: 0.65 },
  crypto_native: { arrival_share: 0.08, abandon_rate: 0.55 },
  teen_newcomer: { arrival_share: 0.05, abandon_rate: 0.65 },
};

const _MEDIA: CategoryPriors = {
  // News / blogs / long-form — senior over-indexed (newspaper habit),
  // young cohorts under-indexed.
  non_tech_30s: { arrival_share: 0.25, abandon_rate: 0.55 },
  senior: { arrival_share: 0.20, abandon_rate: 0.50 },
  mobile_power: { arrival_share: 0.18, abandon_rate: 0.55 },
  designer_20s: { arrival_share: 0.12, abandon_rate: 0.55 },
  defi_beginner: { arrival_share: 0.10, abandon_rate: 0.60 },
  web3_pro: { arrival_share: 0.07, abandon_rate: 0.60 },
  teen_newcomer: { arrival_share: 0.05, abandon_rate: 0.65 },
  crypto_native: { arrival_share: 0.03, abandon_rate: 0.65 },
};

const _CRYPTO_WALLET: CategoryPriors = {
  // Phantom / MetaMask / Rainbow — web3-native heavy, mass-market
  // floor.
  web3_pro: { arrival_share: 0.30, abandon_rate: 0.30 },
  crypto_native: { arrival_share: 0.30, abandon_rate: 0.20 },
  defi_beginner: { arrival_share: 0.20, abandon_rate: 0.50 },
  mobile_power: { arrival_share: 0.10, abandon_rate: 0.55 },
  non_tech_30s: { arrival_share: 0.04, abandon_rate: 0.75 },
  designer_20s: { arrival_share: 0.03, abandon_rate: 0.65 },
  teen_newcomer: { arrival_share: 0.02, abandon_rate: 0.80 },
  senior: { arrival_share: 0.01, abandon_rate: 0.90 },
};

const _NFT: CategoryPriors = {
  // OpenSea / Magic Eden / Foundation — web3 + design overlap; senior
  // at floor.
  web3_pro: { arrival_share: 0.25, abandon_rate: 0.30 },
  designer_20s: { arrival_share: 0.20, abandon_rate: 0.40 },
  crypto_native: { arrival_share: 0.20, abandon_rate: 0.30 },
  defi_beginner: { arrival_share: 0.15, abandon_rate: 0.55 },
  mobile_power: { arrival_share: 0.10, abandon_rate: 0.55 },
  non_tech_30s: { arrival_share: 0.05, abandon_rate: 0.70 },
  teen_newcomer: { arrival_share: 0.03, abandon_rate: 0.65 },
  senior: { arrival_share: 0.02, abandon_rate: 0.85 },
};

const _OTHER: CategoryPriors = {
  // Catch-all fallback — flat-ish distribution, moderate uniform
  // abandon rate. Used when classifier returns 'Other' or confidence
  // is too low to trust a specific category prior.
  non_tech_30s: { arrival_share: 0.20, abandon_rate: 0.55 },
  mobile_power: { arrival_share: 0.15, abandon_rate: 0.55 },
  designer_20s: { arrival_share: 0.13, abandon_rate: 0.55 },
  defi_beginner: { arrival_share: 0.13, abandon_rate: 0.55 },
  senior: { arrival_share: 0.13, abandon_rate: 0.55 },
  web3_pro: { arrival_share: 0.10, abandon_rate: 0.55 },
  teen_newcomer: { arrival_share: 0.08, abandon_rate: 0.55 },
  crypto_native: { arrival_share: 0.08, abandon_rate: 0.55 },
};

export const ACQUISITION_PRIORS: Record<AcquisitionCategory, CategoryPriors> = {
  DeFi: _DEFI,
  SaaS: _SAAS,
  'E-commerce': _ECOMMERCE,
  Social: _SOCIAL,
  Gaming: _GAMING,
  Productivity: _PRODUCTIVITY,
  'AI Tools': _AI_TOOLS,
  Marketplace: _MARKETPLACE,
  Media: _MEDIA,
  'Crypto Wallet': _CRYPTO_WALLET,
  NFT: _NFT,
  Other: _OTHER,
};

// ─── Lookup with fallback ───────────────────────────────────────
//
// `category`: site_classifier output, may be null when classifier
// failed.
// `confidence`: 0-1, how certain the classifier is.
//
// When confidence is too low (< CONFIDENCE_FLOOR) or category is
// missing, falls back to the 'Other' priors. This avoids letting a
// shaky classification drive aggressive cohort weights.

export const CONFIDENCE_FLOOR = 0.5;

export function getAcquisitionPriorsFor(
  category: string | null | undefined,
  confidence: number | null | undefined,
): CategoryPriors {
  if (!category || (confidence ?? 0) < CONFIDENCE_FLOOR) {
    return ACQUISITION_PRIORS.Other;
  }
  if (isAcquisitionCategory(category)) {
    return ACQUISITION_PRIORS[category];
  }
  return ACQUISITION_PRIORS.Other;
}

export function isAcquisitionCategory(s: string): s is AcquisitionCategory {
  return (ACQUISITION_CATEGORIES as readonly string[]).includes(s);
}
