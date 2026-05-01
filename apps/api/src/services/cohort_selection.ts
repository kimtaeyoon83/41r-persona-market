// Cohort selection — pure function. Given STANDARD_COHORTS and an
// active persona pool, produces Map<cohort_id, PersonaRow[]> with
// each persona assigned to AT MOST one cohort.
//
// Assignment rule: a persona can satisfy multiple cohort selectors
// (e.g. a 30s mobile-first DeFi expert matches both `crypto_native`
// AND `mobile_power`). To prevent double-counting in cohort means,
// each persona goes to exactly ONE cohort — the one whose selector
// midpoint is closest by L2 distance over the constrained numeric
// axes. Quota (`target_n`) is enforced: once a cohort hits target_n
// it stops accepting new personas and the next-best cohort takes the
// overflow.
//
// Defensive: persona.vector.demographics and ux_preferences are
// optional in the schema. Selectors that require those sub-objects
// reject personas where the field is absent.

import {
  STANDARD_COHORTS,
  type CohortDef,
  type CohortSelector,
} from '@41rpm/shared';
import type { schema } from '../db/index.js';

export type PersonaRow = typeof schema.personas.$inferSelect;
type Vector = PersonaRow['vector'];

export function matchesSelector(v: Vector, sel: CohortSelector): boolean {
  if (sel.age_group) {
    const g = v.demographics?.age_group;
    if (!g || !sel.age_group.includes(g)) return false;
  }
  if (sel.tech_literacy && !inRange(v.demographics?.tech_literacy, sel.tech_literacy)) return false;
  if (sel.crypto_experience && !inRange(v.demographics?.crypto_experience, sel.crypto_experience)) return false;
  if (sel.design_sensitivity && !inRange(v.demographics?.design_sensitivity, sel.design_sensitivity)) return false;
  if (sel.patience_level && !inRange(v.demographics?.patience_level, sel.patience_level)) return false;
  if (sel.mobile_first) {
    const m = v.ux_preferences?.mobile_first;
    if (m === undefined) return false;
    if (!sel.mobile_first.includes(m)) return false;
  }
  if (sel.expertise_defi && !inRange(v.expertise?.defi, sel.expertise_defi)) return false;
  if (sel.expertise_nft && !inRange(v.expertise?.nft, sel.expertise_nft)) return false;
  if (sel.expertise_general_web && !inRange(v.expertise?.general_web, sel.expertise_general_web)) return false;
  if (sel.ui_critical && !inRange(v.feedback_pattern?.ui_critical, sel.ui_critical)) return false;
  if (sel.security_aware && !inRange(v.feedback_pattern?.security_aware, sel.security_aware)) return false;
  if (sel.detail_oriented && !inRange(v.feedback_pattern?.detail_oriented, sel.detail_oriented)) return false;
  // english_fluency is in the cohort selector type but not yet on the
  // PersonaVector schema — treated as always-pass until added.
  return true;
}

function inRange(x: number | undefined, [lo, hi]: [number, number]): boolean {
  if (x === undefined || !Number.isFinite(x)) return false;
  return x >= lo && x <= hi;
}

// L2 distance from persona to selector midpoint over constrained
// numeric axes only. Categorical fields (age_group, mobile_first)
// don't add to distance; they're already pass/fail in matchesSelector.
export function distanceToSelector(v: Vector, sel: CohortSelector): number {
  let sumSq = 0;
  const consider = (val: number | undefined, range: [number, number] | undefined) => {
    if (!range || val === undefined) return;
    const mid = (range[0] + range[1]) / 2;
    sumSq += (val - mid) ** 2;
  };
  consider(v.demographics?.tech_literacy, sel.tech_literacy);
  consider(v.demographics?.crypto_experience, sel.crypto_experience);
  consider(v.demographics?.design_sensitivity, sel.design_sensitivity);
  consider(v.demographics?.patience_level, sel.patience_level);
  consider(v.expertise?.defi, sel.expertise_defi);
  consider(v.expertise?.nft, sel.expertise_nft);
  consider(v.expertise?.general_web, sel.expertise_general_web);
  consider(v.feedback_pattern?.ui_critical, sel.ui_critical);
  consider(v.feedback_pattern?.security_aware, sel.security_aware);
  consider(v.feedback_pattern?.detail_oriented, sel.detail_oriented);
  return Math.sqrt(sumSq);
}

// Two-pass assignment:
//   1. For each persona, list cohorts whose selector matches, sorted
//      by L2 distance ascending — closest fit first.
//   2. Walk personas (high-quality first); assign each to its closest
//      cohort that hasn't hit target_n yet. Personas that match no
//      cohort, or whose every matching cohort is full, end up in
//      `unassigned`.
export function selectPersonasForCohorts(
  personas: readonly PersonaRow[],
  cohorts: readonly CohortDef[] = STANDARD_COHORTS,
): { assignments: Map<string, PersonaRow[]>; unassigned: PersonaRow[] } {
  const assignments = new Map<string, PersonaRow[]>();
  for (const c of cohorts) assignments.set(c.id, []);
  const unassigned: PersonaRow[] = [];

  // Sort personas by reliability.quality_score descending so the
  // strongest personas get first claim on their best cohort.
  const sorted = [...personas].sort(
    (a, b) =>
      (b.vector.reliability?.quality_score ?? 0) -
      (a.vector.reliability?.quality_score ?? 0)
  );

  for (const persona of sorted) {
    const matches = cohorts
      .filter((c) => matchesSelector(persona.vector, c.selector))
      .map((c) => ({
        cohort: c,
        dist: distanceToSelector(persona.vector, c.selector),
      }))
      .sort((a, b) => a.dist - b.dist);

    if (matches.length === 0) {
      unassigned.push(persona);
      continue;
    }

    let placed = false;
    for (const { cohort } of matches) {
      const bucket = assignments.get(cohort.id)!;
      if (bucket.length < cohort.target_n) {
        bucket.push(persona);
        placed = true;
        break;
      }
    }
    if (!placed) unassigned.push(persona);
  }

  return { assignments, unassigned };
}
