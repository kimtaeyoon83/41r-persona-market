// 8 standard audience cohorts for Mode A discovery scans.
// Selectors define ranges over PersonaVector axes (see
// apps/api/src/db/schema.ts personas.vector). The selection service
// (Phase 1B) will pick `target_n` personas per cohort from the active
// pool whose vectors fall inside every defined range.
//
// IDs and labels are referenced by both backend aggregation and
// frontend rendering — keep them stable. Renaming requires a data
// migration on `scan_cohort_results.cohort_id`.

type AgeGroup = 'teen' | 'young_adult' | 'adult' | 'senior';

export type CohortSelector = {
  age_group?: AgeGroup[];
  tech_literacy?: [number, number];
  crypto_experience?: [number, number];
  design_sensitivity?: [number, number];
  patience_level?: [number, number];
  english_fluency?: [number, number];
  mobile_first?: boolean[];

  // expertise.* axes (0-1)
  expertise_defi?: [number, number];
  expertise_nft?: [number, number];
  expertise_general_web?: [number, number];

  // feedback_pattern.* axes (0-1)
  ui_critical?: [number, number];
  security_aware?: [number, number];
  detail_oriented?: [number, number];
};

export type CohortDef = {
  id: string;
  label: string;
  description: string;
  selector: CohortSelector;
  target_n: number;
};

// Total 8 × 14 = 112 personas (≈ "113 personas" in the design prototype).
// If a cohort under-quotas (n_completed < target_n), the report card
// labels it "n=8/14 (under-quota)" so users see the gap explicitly
// rather than the aggregator silently filling with adjacent personas.
export const STANDARD_COHORTS: readonly CohortDef[] = [
  {
    id: 'crypto_native',
    label: 'Crypto Native',
    description: '30s expert, security-aware, mobile-first',
    selector: {
      age_group: ['young_adult', 'adult'],
      crypto_experience: [0.7, 1.0],
      expertise_defi: [0.6, 1.0],
      security_aware: [0.5, 1.0],
    },
    target_n: 14,
  },
  {
    id: 'defi_beginner',
    label: 'DeFi Beginner',
    description: 'Curious but new to crypto',
    selector: {
      age_group: ['young_adult', 'adult'],
      crypto_experience: [0.0, 0.3],
      patience_level: [0.4, 0.8],
    },
    target_n: 14,
  },
  {
    id: 'designer_20s',
    label: 'Designer (20s)',
    description: 'Design-literate, UI-critical',
    selector: {
      age_group: ['young_adult'],
      design_sensitivity: [0.7, 1.0],
      ui_critical: [0.5, 1.0],
    },
    target_n: 14,
  },
  {
    id: 'senior',
    label: 'Senior (50+)',
    description: 'Low tech-literacy, risk-averse, desktop',
    selector: {
      age_group: ['senior'],
      tech_literacy: [0.0, 0.5],
      mobile_first: [false],
    },
    target_n: 14,
  },
  {
    id: 'teen_newcomer',
    label: 'Teen newcomer',
    description: 'Mobile-first, no crypto, English-fluency varies',
    selector: {
      age_group: ['teen'],
      crypto_experience: [0.0, 0.2],
      mobile_first: [true],
    },
    target_n: 14,
  },
  {
    id: 'mobile_power',
    label: 'Mobile Power',
    description: 'Mobile-first, mid tech-literacy, transactional',
    selector: {
      age_group: ['young_adult', 'adult'],
      mobile_first: [true],
      tech_literacy: [0.5, 0.85],
    },
    target_n: 14,
  },
  {
    id: 'web3_pro',
    label: 'Web3 Pro',
    description: 'Power user, multi-chain, detail-oriented',
    selector: {
      expertise_defi: [0.7, 1.0],
      expertise_nft: [0.5, 1.0],
      detail_oriented: [0.5, 1.0],
    },
    target_n: 14,
  },
  {
    id: 'non_tech_30s',
    label: 'Non-technical 30s',
    description: 'General web user, no crypto background',
    selector: {
      age_group: ['adult'],
      tech_literacy: [0.3, 0.6],
      crypto_experience: [0.0, 0.3],
      expertise_general_web: [0.5, 1.0],
    },
    target_n: 14,
  },
];

export const COHORT_BY_ID: Record<string, CohortDef> = Object.fromEntries(
  STANDARD_COHORTS.map((c) => [c.id, c])
);
