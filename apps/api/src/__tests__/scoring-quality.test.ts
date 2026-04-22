import { describe, it, expect } from 'vitest';
import {
  checklistPassRate,
  computeQualityScore,
} from '../services/scoring/quality.js';
import type { ChecklistResult } from '../services/scoring/types.js';

// Mirrors apps/persona-engine/tests/test_scorers.py so any regression in
// the TS port shows up next to the Python reference's expected values.

const cl = (status: 'passed' | 'failed' | 'blocked', id = 'x'): ChecklistResult => ({
  id,
  status,
  memo: '',
  matched_turn_idx: null,
});

describe('checklistPassRate', () => {
  it('empty list → 0.0 / total 0', () => {
    expect(checklistPassRate(null)).toEqual({ rate: 0.0, total: 0 });
    expect(checklistPassRate([])).toEqual({ rate: 0.0, total: 0 });
  });

  it('blocked items excluded from denominator', () => {
    const rate = checklistPassRate([cl('passed', 'a'), cl('blocked', 'b')]);
    expect(rate.rate).toBe(1.0);
    expect(rate.total).toBe(2);
  });

  it('all blocked → 0.0 rate', () => {
    const rate = checklistPassRate([cl('blocked', 'a'), cl('blocked', 'b')]);
    expect(rate.rate).toBe(0.0);
    expect(rate.total).toBe(2);
  });

  it('mix of pass/fail', () => {
    const rate = checklistPassRate([
      cl('passed', 'a'),
      cl('failed', 'b'),
      cl('passed', 'c'),
      cl('failed', 'd'),
    ]);
    expect(rate.rate).toBe(0.5);
  });
});

describe('computeQualityScore', () => {
  it('perfect session saturates just under 5', () => {
    // outcome=task_complete (1.0), no checklist → w_outcome = 1.0
    const br = computeQualityScore({ sessionLog: { outcome: 'task_complete' } });
    expect(br.quality_score).toBeCloseTo(4.95, 2);
    expect(br.raw_score).toBe(1.0);
    expect(br.weights).toEqual({ faithfulness: 0.0, outcome: 1.0, checklist: 0.0 });
  });

  it('error outcome bottom-clamped just above 1', () => {
    // outcome=error (0.15), no checklist → raw 0.15 → 1.6
    const br = computeQualityScore({ sessionLog: { outcome: 'error' } });
    expect(br.quality_score).toBeGreaterThan(1.0);
    expect(br.quality_score).toBeLessThan(2.0);
  });

  it('abandoned + all failed checklist stays low', () => {
    const br = computeQualityScore({
      sessionLog: { outcome: 'abandoned' },
      checklistResults: [cl('failed', 'a'), cl('failed', 'b')],
    });
    // outcome 0.35 * 0.35 = 0.1225, checklist 0.0 * 0.65 = 0 → 1.49
    expect(br.quality_score).toBeLessThan(2.0);
  });

  it('task_complete + half passed lands mid-range', () => {
    const br = computeQualityScore({
      sessionLog: { outcome: 'task_complete' },
      checklistResults: [cl('passed', 'a'), cl('failed', 'b')],
    });
    // raw = 1.0*0.35 + 0.5*0.65 = 0.675 → 3.7
    expect(br.quality_score).toBeGreaterThan(3.5);
    expect(br.quality_score).toBeLessThan(4.0);
  });

  it('Phase F rebalance activates when checklist present', () => {
    const br = computeQualityScore({
      sessionLog: { outcome: 'task_complete' },
      checklistResults: [cl('passed', 'a')],
    });
    expect(br.weights.outcome).toBe(0.35);
    expect(br.weights.checklist).toBe(0.65);
    expect(br.weights.faithfulness).toBe(0.0);
  });

  it('no checklist → outcome carries 100% weight', () => {
    const br = computeQualityScore({ sessionLog: { outcome: 'partial' } });
    expect(br.weights.outcome).toBe(1.0);
    expect(br.weights.checklist).toBe(0.0);
  });

  it('partial outcome maps to mid-range float', () => {
    // partial 0.65 * 1.0 = 0.65 → 3.6
    const br = computeQualityScore({ sessionLog: { outcome: 'partial' } });
    expect(br.quality_score).toBeGreaterThan(3.4);
    expect(br.quality_score).toBeLessThan(3.8);
  });

  it('micro-differentiation: 3/4 vs 4/4 checklist', () => {
    const cl1 = [cl('passed', 'a'), cl('passed', 'b'), cl('passed', 'c'), cl('failed', 'd')];
    const cl2 = [cl('passed', 'a'), cl('passed', 'b'), cl('passed', 'c'), cl('passed', 'd')];
    const q1 = computeQualityScore({
      sessionLog: { outcome: 'task_complete' },
      checklistResults: cl1,
    }).quality_score;
    const q2 = computeQualityScore({
      sessionLog: { outcome: 'task_complete' },
      checklistResults: cl2,
    }).quality_score;
    expect(q2).toBeGreaterThan(q1);
    expect(q2 - q1).toBeGreaterThan(0.1);
  });

  it('predicate weights when has_predicates=true + checklist', () => {
    const br = computeQualityScore({
      sessionLog: { outcome: 'task_complete' },
      checklistResults: [cl('passed', 'a')],
      hasPredicates: true,
      personaFaithfulness: 0.8,
    });
    expect(br.has_predicates).toBe(true);
    expect(br.weights).toEqual({ faithfulness: 0.35, outcome: 0.25, checklist: 0.4 });
  });

  it('unknown outcome treated as 0', () => {
    const br = computeQualityScore({ sessionLog: { outcome: 'weird' } });
    expect(br.outcome_weight).toBe(0);
    expect(br.quality_score).toBe(1.05); // clamped
  });
});
