/**
 * Derive investor-facing "findings" from a /compare result.
 *
 * Pure function — no LLM, no DB. Given the raw numbers the
 * comparison service already computed, emit a short list of
 * structured insights the dashboard can render without the viewer
 * doing statistics in their head.
 *
 * Each finding has:
 *   - severity: "positive" (supports persona ≈ human), "neutral"
 *     (interesting but inconclusive), "negative" (personas diverge).
 *   - headline: one sentence.
 *   - detail: optional supporting numbers.
 *
 * Selection rules are intentionally simple and tunable in one place
 * so we can refine them once the dashboard has been shown to actual
 * investors.
 */

import type { ConvergencePoint, PerItemAgreement } from './comparison.js';

export type FindingSeverity = 'positive' | 'neutral' | 'negative';

export interface Finding {
  id: string;
  severity: FindingSeverity;
  headline: string;
  detail?: string;
}

export interface FindingsInput {
  manualCount: number;
  personaCount: number;
  itemAgreementRate: number;      // 0..1
  itemAgreement: PerItemAgreement[];
  correlation: { pearson: number; spearman: number; pairedCount: number };
  ratingKs: number;               // 0..1
  ratingManualMean: number;
  ratingPersonaMean: number;
  convergence: ConvergencePoint[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function deriveFindings(inp: FindingsInput): Finding[] {
  const out: Finding[] = [];

  // ─── Sample-size sanity (always surfaced first) ────────────────
  if (inp.manualCount < 5 || inp.personaCount < 5) {
    out.push({
      id: 'sample-size',
      severity: 'neutral',
      headline: `Sample still small (${inp.manualCount} humans vs ${inp.personaCount} personas) — treat findings as directional.`,
    });
  } else {
    out.push({
      id: 'sample-size',
      severity: 'positive',
      headline: `Sample supports inference: ${inp.manualCount} humans, ${inp.personaCount} personas, ${inp.correlation.pairedCount} paired.`,
    });
  }

  // ─── Item-level agreement ─────────────────────────────────────
  if (inp.itemAgreement.length > 0) {
    if (inp.itemAgreementRate >= 0.75) {
      out.push({
        id: 'item-agreement-high',
        severity: 'positive',
        headline: `Personas and humans agree on ${pct(inp.itemAgreementRate)} of checklist items — personas correctly identify what works and what breaks.`,
      });
    } else if (inp.itemAgreementRate >= 0.4) {
      out.push({
        id: 'item-agreement-mid',
        severity: 'neutral',
        headline: `Item-level agreement is ${pct(inp.itemAgreementRate)} — personas are directionally correct on about half of items.`,
      });
    } else {
      out.push({
        id: 'item-agreement-low',
        severity: 'negative',
        headline: `Only ${pct(inp.itemAgreementRate)} of items match at majority level — personas often reach the opposite verdict from testers.`,
      });
    }

    // Surface items where personas said blocked while humans passed —
    // usually signals the persona bailed on a flow the humans handled.
    const bailouts = inp.itemAgreement.filter(
      (i) => i.personaMajority === 'blocked' && i.humanMajority === 'passed',
    );
    if (bailouts.length > 0) {
      out.push({
        id: 'persona-bailout',
        severity: 'negative',
        headline: `Personas bailed on ${bailouts.length} item(s) where humans completed the task.`,
        detail: `Items: ${bailouts.map((b) => b.itemId).join(', ')}. Likely cause: agent gave up early on interactive flows that humans navigate intuitively.`,
      });
    }
  }

  // ─── Quality-score correlation ────────────────────────────────
  if (inp.correlation.pairedCount >= 5) {
    const s = inp.correlation.spearman;
    if (s >= 0.5) {
      out.push({
        id: 'quality-correlation-pos',
        severity: 'positive',
        headline: `Quality scores co-move with humans (Spearman ρ = ${r3(s)}) — personas also rate the stronger tests higher.`,
      });
    } else if (s <= -0.3) {
      out.push({
        id: 'quality-correlation-neg',
        severity: 'negative',
        headline: `Quality scores run opposite to humans (Spearman ρ = ${r3(s)}) — personas rank the best and worst tests in reverse order.`,
        detail: 'Most commonly caused by personas clustering at low scores when the task involves dynamic UI, while humans differentiate.',
      });
    } else {
      out.push({
        id: 'quality-correlation-flat',
        severity: 'neutral',
        headline: `Quality scores show weak correlation (Spearman ρ = ${r3(s)}).`,
      });
    }
  } else {
    out.push({
      id: 'quality-correlation-na',
      severity: 'neutral',
      headline: `Not enough paired reports (${inp.correlation.pairedCount}) for a reliable correlation yet.`,
    });
  }

  // ─── "Agree on items but disagree on magnitude" pattern ───────
  if (
    inp.itemAgreement.length > 0 &&
    inp.itemAgreementRate >= 0.6 &&
    inp.correlation.pairedCount >= 5 &&
    inp.correlation.spearman < 0.3
  ) {
    out.push({
      id: 'items-agree-magnitude-disagree',
      severity: 'neutral',
      headline: 'Personas catch the same issues humans do, but their quality scoring is on a different scale.',
      detail: 'Item-level agreement is high while quality-score correlation is weak — a calibration target, not a correctness failure.',
    });
  }

  // ─── Rating distribution ──────────────────────────────────────
  const ks = inp.ratingKs;
  const meanGap = Math.abs(inp.ratingManualMean - inp.ratingPersonaMean);
  if (ks <= 0.2 && meanGap <= 0.5) {
    out.push({
      id: 'rating-close',
      severity: 'positive',
      headline: `Questionnaire ratings follow nearly the same distribution (KS = ${r3(ks)}, mean gap ${r3(meanGap)}).`,
    });
  } else if (ks >= 0.5) {
    out.push({
      id: 'rating-diverge',
      severity: 'negative',
      headline: `Rating distributions diverge (KS = ${r3(ks)}, persona mean ${r3(inp.ratingPersonaMean)} vs human ${r3(inp.ratingManualMean)}).`,
      detail: 'Personas are consistently harsher or more lenient than humans — adjusting persona-voice prompting can close this gap.',
    });
  }

  // ─── Convergence ──────────────────────────────────────────────
  if (inp.convergence.length >= 3) {
    const first = inp.convergence[0];
    const last = inp.convergence[inp.convergence.length - 1];
    if (last.absDiff < first.absDiff * 0.6) {
      out.push({
        id: 'convergence-good',
        severity: 'positive',
        headline: `Agreement tightens with sample size: |Δ mean| drops from ${r3(first.absDiff)} at N=${first.n} to ${r3(last.absDiff)} at N=${last.n}.`,
      });
    } else if (last.absDiff > first.absDiff * 1.2) {
      out.push({
        id: 'convergence-diverges',
        severity: 'negative',
        headline: `Agreement widens with N (|Δ mean| grew from ${r3(first.absDiff)} to ${r3(last.absDiff)}) — adding samples didn't help.`,
      });
    } else {
      out.push({
        id: 'convergence-stable',
        severity: 'neutral',
        headline: `Gap stays roughly flat as N grows (|Δ mean| ≈ ${r3(last.absDiff)}).`,
      });
    }
  }

  return out;
}
