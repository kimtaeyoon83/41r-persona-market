import { describe, expect, it } from 'vitest';
import {
  buildConfusionMatrix,
  cohortKey,
  computeCohortItemMetrics,
  computeCohortMetrics,
  computePerItemAgreement,
  convergenceCurve,
  jaccard,
  ksStatistic,
  pearson,
  spearman,
} from '../services/comparison.js';

describe('computePerItemAgreement', () => {
  it('returns empty when both populations empty', () => {
    const out = computePerItemAgreement([], []);
    expect(out.items).toEqual([]);
    expect(out.overallAgreementRate).toBe(0);
  });

  it('majority vote decides, and agreement is boolean', () => {
    const manual = [
      [{ id: 'a', status: 'passed' as const }],
      [{ id: 'a', status: 'passed' as const }],
      [{ id: 'a', status: 'failed' as const }], // 2 passed, 1 failed → passed
    ];
    const persona = [
      [{ id: 'a', status: 'passed' as const }],
      [{ id: 'a', status: 'passed' as const }],
    ];
    const out = computePerItemAgreement(manual, persona);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].humanMajority).toBe('passed');
    expect(out.items[0].personaMajority).toBe('passed');
    expect(out.items[0].agree).toBe(true);
    expect(out.overallAgreementRate).toBe(1);
  });

  it('disagreement lowers overall rate', () => {
    const manual = [[{ id: 'a', status: 'passed' as const }]];
    const persona = [[{ id: 'a', status: 'failed' as const }]];
    const out = computePerItemAgreement(manual, persona);
    expect(out.items[0].agree).toBe(false);
    expect(out.overallAgreementRate).toBe(0);
  });

  it('collects votes across multiple items', () => {
    const manual = [[
      { id: 'a', status: 'passed' as const },
      { id: 'b', status: 'blocked' as const },
    ]];
    const persona = [[
      { id: 'a', status: 'passed' as const },
      { id: 'b', status: 'failed' as const },
    ]];
    const out = computePerItemAgreement(manual, persona);
    expect(out.items).toHaveLength(2);
    expect(out.overallAgreementRate).toBe(0.5);
  });
});

describe('buildConfusionMatrix', () => {
  it('counts each (personaMajority, humanMajority) pair', () => {
    const items = [
      { itemId: '1', humanMajority: 'passed' as const, personaMajority: 'passed' as const, agree: true,
        humanVotes: { passed: 1, failed: 0, blocked: 0 }, personaVotes: { passed: 1, failed: 0, blocked: 0 } },
      { itemId: '2', humanMajority: 'passed' as const, personaMajority: 'failed' as const, agree: false,
        humanVotes: { passed: 1, failed: 0, blocked: 0 }, personaVotes: { passed: 0, failed: 1, blocked: 0 } },
      { itemId: '3', humanMajority: null, personaMajority: 'passed' as const, agree: false,
        humanVotes: { passed: 0, failed: 0, blocked: 0 }, personaVotes: { passed: 1, failed: 0, blocked: 0 } },
    ];
    const m = buildConfusionMatrix(items);
    expect(m.passed.passed).toBe(1);
    expect(m.failed.passed).toBe(1);
    expect(m.passed.none).toBe(1);
  });
});

describe('pearson correlation', () => {
  it('perfectly correlated inputs give 1', () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 6);
  });

  it('perfectly anti-correlated inputs give -1', () => {
    expect(pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 6);
  });

  it('zero variance gives 0', () => {
    expect(pearson([3, 3, 3], [1, 2, 3])).toBe(0);
  });

  it('short samples return 0', () => {
    expect(pearson([1], [1])).toBe(0);
    expect(pearson([], [1, 2])).toBe(0);
  });
});

describe('spearman correlation', () => {
  it('monotonic non-linear pair gets 1 in spearman but not pearson', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [1, 4, 9, 16, 25]; // y = x^2 on positive range, strictly monotonic
    expect(spearman(x, y)).toBeCloseTo(1, 6);
    expect(pearson(x, y)).toBeLessThan(1);
  });

  it('handles ties with average ranks', () => {
    const x = [1, 2, 2, 3];
    const y = [10, 20, 20, 30];
    expect(spearman(x, y)).toBeCloseTo(1, 6);
  });
});

describe('ksStatistic', () => {
  it('identical samples give 0', () => {
    expect(ksStatistic([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('disjoint samples give 1', () => {
    expect(ksStatistic([1, 2, 3], [10, 20, 30])).toBe(1);
  });

  it('partially overlapping samples give middle value', () => {
    const d = ksStatistic([1, 2, 3, 4], [3, 4, 5, 6]);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });

  it('empty sample returns 0', () => {
    expect(ksStatistic([], [1, 2])).toBe(0);
  });
});

describe('jaccard', () => {
  it('identical sets give 1', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });

  it('disjoint sets give 0', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('partial overlap', () => {
    // {a,b,c} ∩ {b,c,d} = 2, union = 4 → 0.5
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(0.5);
  });

  it('both empty → 1 by convention', () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
  });
});

describe('convergenceCurve', () => {
  it('emits one point per configured step, plus the total', () => {
    const human = Array.from({ length: 100 }, (_, i) => i);
    const persona = Array.from({ length: 100 }, (_, i) => i + 0.1);
    const pts = convergenceCurve(human, persona);
    const ns = pts.map((p) => p.n);
    expect(ns).toContain(10);
    expect(ns).toContain(50);
    expect(ns).toContain(100);
  });

  it('shrinking absDiff as N grows when samples share a mean', () => {
    const rng = (seed: number) => {
      let s = seed;
      return () => { s = (s * 1103515245 + 12345) % 2 ** 31; return s / 2 ** 31; };
    };
    const r1 = rng(1);
    const r2 = rng(2);
    const human = Array.from({ length: 500 }, () => 3 + (r1() - 0.5) * 2);
    const persona = Array.from({ length: 500 }, () => 3 + (r2() - 0.5) * 2);
    const pts = convergenceCurve(human, persona);
    const first = pts.find((p) => p.n === 10);
    const last = pts[pts.length - 1];
    expect(last.absDiff).toBeLessThan(first!.absDiff);
  });

  it('emits fine-grained points under N=5 then the total', () => {
    const pts = convergenceCurve([1, 2, 3], [4, 5, 6]);
    // defaults include 1,2,3 under maxN=3 and 3 is also the total.
    expect(pts.map((p) => p.n)).toEqual([1, 2, 3]);
  });

  it('dedups when maxN matches a default step', () => {
    const arr = Array.from({ length: 10 }, () => 3);
    const pts = convergenceCurve(arr, arr);
    const ns = pts.map((p) => p.n);
    // must not include 10 twice
    expect(ns.filter((n) => n === 10)).toHaveLength(1);
  });
});

describe('cohortKey', () => {
  it('single dimension defaults to crypto_experience', () => {
    expect(cohortKey({ crypto_experience: 'advanced' })).toBe('advanced');
    expect(cohortKey({ crypto_experience: 'none' })).toBe('none');
  });

  it('missing/empty fields bucket into "unknown"', () => {
    expect(cohortKey(null)).toBe('unknown');
    expect(cohortKey({})).toBe('unknown');
    expect(cohortKey({ crypto_experience: '' })).toBe('unknown');
  });

  it('multi-dimension joins with /', () => {
    const profile = { crypto_experience: 'beginner', age_range: '20s', primary_device: 'mobile' };
    expect(cohortKey(profile, ['age_range', 'crypto_experience', 'primary_device']))
      .toBe('20s/beginner/mobile');
  });
});

describe('computeCohortMetrics', () => {
  const mk = (profile: Record<string, unknown>, isPersona: boolean, q: number, cl: Array<{ id: string; status: 'passed' | 'failed' | 'blocked' }>) => ({
    testerAddr: Math.random().toString(36).slice(2, 10),
    isPersonaTest: isPersona,
    qualityScore: q,
    checklistResults: cl,
    profile,
  });

  it('groups reports by crypto_experience cohort', () => {
    const reports = [
      mk({ crypto_experience: 'advanced' }, false, 4.5, [{ id: 'a', status: 'passed' }]),
      mk({ crypto_experience: 'advanced' }, true, 4.2, [{ id: 'a', status: 'passed' }]),
      mk({ crypto_experience: 'beginner' }, false, 3.0, [{ id: 'a', status: 'failed' }]),
      mk({ crypto_experience: 'beginner' }, true, 2.5, [{ id: 'a', status: 'failed' }]),
    ];
    const cohorts = computeCohortMetrics(reports);
    expect(cohorts.map((c) => c.cohort).sort()).toEqual(['advanced', 'beginner']);
    const adv = cohorts.find((c) => c.cohort === 'advanced')!;
    expect(adv.humanCount).toBe(1);
    expect(adv.personaCount).toBe(1);
    expect(adv.itemAgreementRate).toBe(1); // both passed
  });

  it('cohorts sorted by total population descending', () => {
    const reports = [
      mk({ crypto_experience: 'none' }, false, 3.0, []),
      mk({ crypto_experience: 'advanced' }, false, 4.0, []),
      mk({ crypto_experience: 'advanced' }, true, 4.0, []),
      mk({ crypto_experience: 'advanced' }, true, 4.0, []),
    ];
    const cohorts = computeCohortMetrics(reports);
    expect(cohorts[0].cohort).toBe('advanced');
    expect(cohorts[0].humanCount + cohorts[0].personaCount).toBe(3);
    expect(cohorts[1].cohort).toBe('none');
  });

  it('null profile → unknown cohort', () => {
    const reports = [
      mk(null as unknown as Record<string, unknown>, false, 3.0, []),
      mk({ crypto_experience: 'advanced' }, true, 4.0, []),
    ];
    const cohorts = computeCohortMetrics(reports);
    expect(cohorts.some((c) => c.cohort === 'unknown')).toBe(true);
  });

  it('computes quality mean diff per cohort', () => {
    const reports = [
      mk({ crypto_experience: 'x' }, false, 4.0, []),
      mk({ crypto_experience: 'x' }, false, 5.0, []),
      mk({ crypto_experience: 'x' }, true, 3.0, []),
      mk({ crypto_experience: 'x' }, true, 4.0, []),
    ];
    const cohorts = computeCohortMetrics(reports);
    const c = cohorts[0];
    expect(c.humanMeanQuality).toBe(4.5);
    expect(c.personaMeanQuality).toBe(3.5);
    expect(c.qualityAbsDiff).toBe(1);
  });

  it('nulls derived metrics when one side has zero reports', () => {
    // Cohort with only personas — human mean / |Δ| / agreement / KS
    // must not default to zero (previously |0 − 4|=4 was rendered as a
    // real gap in the dashboard).
    const reports = [
      mk({ crypto_experience: 'advanced' }, true, 4.0, [{ id: 'a', status: 'passed' }]),
      mk({ crypto_experience: 'advanced' }, true, 3.5, [{ id: 'a', status: 'failed' }]),
    ];
    const cohorts = computeCohortMetrics(reports);
    const c = cohorts[0];
    expect(c.humanCount).toBe(0);
    expect(c.personaCount).toBe(2);
    expect(c.humanMeanQuality).toBeNull();
    expect(c.personaMeanQuality).toBe(3.75);
    expect(c.qualityAbsDiff).toBeNull();
    expect(c.itemAgreementRate).toBeNull();
    expect(c.ksStatisticQuality).toBeNull();
  });
});

describe('computeCohortItemMetrics', () => {
  const mk = (profile: Record<string, unknown>, isPersona: boolean, cl: Array<{ id: string; status: 'passed' | 'failed' | 'blocked' }>) => ({
    testerAddr: Math.random().toString(36).slice(2, 10),
    isPersonaTest: isPersona,
    checklistResults: cl,
    profile,
  });

  it('flags a cohort×item where both sides fail as both-fail', () => {
    const reports = [
      // 3 humans, 3/3 fail on CL01 in novice
      mk({ crypto_experience: 'novice' }, false, [{ id: 'CL01', status: 'failed' }]),
      mk({ crypto_experience: 'novice' }, false, [{ id: 'CL01', status: 'failed' }]),
      mk({ crypto_experience: 'novice' }, false, [{ id: 'CL01', status: 'failed' }]),
      // 3 personas, 3/3 fail on CL01 in novice
      mk({ crypto_experience: 'novice' }, true, [{ id: 'CL01', status: 'failed' }]),
      mk({ crypto_experience: 'novice' }, true, [{ id: 'CL01', status: 'failed' }]),
      mk({ crypto_experience: 'novice' }, true, [{ id: 'CL01', status: 'failed' }]),
    ];
    const metrics = computeCohortItemMetrics(reports);
    const cell = metrics.find((m) => m.cohort === 'novice' && m.itemId === 'CL01');
    expect(cell).toBeDefined();
    expect(cell!.humanFailRate).toBe(1);
    expect(cell!.personaFailRate).toBe(1);
    expect(cell!.flag).toBe('both-fail');
  });

  it('flags persona-worse when persona fails >=30pp more than human', () => {
    const reports = [
      // 4 humans, all pass
      mk({ crypto_experience: 'advanced' }, false, [{ id: 'CL02', status: 'passed' }]),
      mk({ crypto_experience: 'advanced' }, false, [{ id: 'CL02', status: 'passed' }]),
      mk({ crypto_experience: 'advanced' }, false, [{ id: 'CL02', status: 'passed' }]),
      mk({ crypto_experience: 'advanced' }, false, [{ id: 'CL02', status: 'passed' }]),
      // 4 personas, 3 fail 1 pass (75% fail) — classic bailout signature
      mk({ crypto_experience: 'advanced' }, true, [{ id: 'CL02', status: 'failed' }]),
      mk({ crypto_experience: 'advanced' }, true, [{ id: 'CL02', status: 'failed' }]),
      mk({ crypto_experience: 'advanced' }, true, [{ id: 'CL02', status: 'failed' }]),
      mk({ crypto_experience: 'advanced' }, true, [{ id: 'CL02', status: 'passed' }]),
    ];
    const metrics = computeCohortItemMetrics(reports);
    const cell = metrics.find((m) => m.itemId === 'CL02')!;
    expect(cell.humanFailRate).toBe(0);
    expect(cell.personaFailRate).toBe(0.75);
    expect(cell.flag).toBe('persona-worse');
  });

  it('marks a cell insufficient when one side has <2 samples', () => {
    const reports = [
      mk({ crypto_experience: 'novice' }, false, [{ id: 'CL01', status: 'failed' }]),
      mk({ crypto_experience: 'novice' }, true, [{ id: 'CL01', status: 'failed' }]),
      mk({ crypto_experience: 'novice' }, true, [{ id: 'CL01', status: 'failed' }]),
    ];
    const metrics = computeCohortItemMetrics(reports);
    const cell = metrics.find((m) => m.itemId === 'CL01')!;
    expect(cell.humanN).toBe(1);
    expect(cell.personaN).toBe(2);
    expect(cell.flag).toBe('insufficient');
  });

  it('excludes blocked statuses from the denominator', () => {
    const reports = [
      mk({ crypto_experience: 'novice' }, false, [{ id: 'CL01', status: 'passed' }]),
      mk({ crypto_experience: 'novice' }, false, [{ id: 'CL01', status: 'passed' }]),
      mk({ crypto_experience: 'novice' }, false, [{ id: 'CL01', status: 'blocked' }]),
      mk({ crypto_experience: 'novice' }, true, [{ id: 'CL01', status: 'passed' }]),
      mk({ crypto_experience: 'novice' }, true, [{ id: 'CL01', status: 'blocked' }]),
    ];
    const metrics = computeCohortItemMetrics(reports);
    const cell = metrics.find((m) => m.itemId === 'CL01')!;
    // 2 human non-blocked (both passed) / 1 persona non-blocked (passed)
    expect(cell.humanN).toBe(2);
    expect(cell.personaN).toBe(1);
    expect(cell.humanFailRate).toBe(0);
    expect(cell.personaFailRate).toBe(0);
    // personaN<2 → insufficient regardless of rates
    expect(cell.flag).toBe('insufficient');
  });
});
