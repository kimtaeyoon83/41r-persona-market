// Contract tests for the pure helpers extracted from the
// audience-fit pipeline:
//   - aarrr.ts::computeAarrrFromRows  (cumulative funnel + thresholds)
//   - frictions.ts::assembleFrictionClusters (long-tail bucket + cap)
//
// Locks the behavioural rules that the report screen depends on so
// future refactors can't silently regress the funnel monotonicity
// or the cluster-sum invariant.

import { describe, expect, it } from 'vitest';
import {
  computeAarrrFromRows,
  type AarrrInputRow,
} from '../services/aarrr.js';
import {
  assembleFrictionClusters,
  type FrictionInputItem,
  type FrictionLLMCluster,
} from '../services/dimensions/frictions.js';

// ───────────────── computeAarrrFromRows ─────────────────

const baseRow = (over: Partial<AarrrInputRow> = {}): AarrrInputRow => ({
  isFlagged: false,
  happiness: 50,
  taskSuccess: 50,
  adoption: 50,
  retentionD7: 30,
  ...over,
});

describe('computeAarrrFromRows', () => {
  it('returns null when there are no non-flagged rows', () => {
    expect(computeAarrrFromRows([])).toBeNull();
    expect(
      computeAarrrFromRows([
        baseRow({ isFlagged: true }),
        baseRow({ isFlagged: true }),
      ]),
    ).toBeNull();
  });

  it('produces 5 stages with acquisition always 100%', () => {
    const out = computeAarrrFromRows([baseRow()]);
    expect(out).not.toBeNull();
    expect(out!.stages).toHaveLength(5);
    expect(out!.stages[0]).toMatchObject({
      key: 'acquisition',
      score: 100,
      n_passing: 1,
      total: 1,
    });
  });

  it('funnel is monotonically non-increasing in n_passing', () => {
    const rows: AarrrInputRow[] = [
      baseRow({ taskSuccess: 80, retentionD7: 55, happiness: 80, adoption: 80 }),
      baseRow({ taskSuccess: 35, retentionD7: 30, happiness: 65, adoption: 70 }),
      baseRow({ taskSuccess: 35, retentionD7: 30, happiness: 50, adoption: 50 }),
      baseRow({ taskSuccess: 25, retentionD7: 5, happiness: 30, adoption: 20 }),
      baseRow({ taskSuccess: 10, retentionD7: 0, happiness: 20, adoption: 10 }),
    ];
    const out = computeAarrrFromRows(rows)!;
    const ns = out.stages.map((s) => s.n_passing);
    for (let i = 1; i < ns.length; i++) {
      expect(ns[i]!).toBeLessThanOrEqual(ns[i - 1]!);
    }
  });

  it('applies thresholds at the documented boundaries', () => {
    // Boundary check: taskSuccess=30 passes activation (>=30),
    // taskSuccess=29 doesn't.
    const passes = baseRow({
      taskSuccess: 30,
      retentionD7: 30,
      happiness: 60,
      adoption: 65,
    });
    const fails = baseRow({
      taskSuccess: 29,
      retentionD7: 30,
      happiness: 60,
      adoption: 65,
    });
    const out = computeAarrrFromRows([passes, fails])!;
    // passes survives all 5; fails dies at activation.
    expect(out.stages[1]!.n_passing).toBe(1); // activation
    expect(out.stages[2]!.n_passing).toBe(1); // retention
    expect(out.stages[3]!.n_passing).toBe(1); // referral
    expect(out.stages[4]!.n_passing).toBe(1); // revenue
  });

  it('treats null dimension scores as 0 (filters them out)', () => {
    const row: AarrrInputRow = {
      isFlagged: false,
      happiness: null,
      taskSuccess: null,
      adoption: null,
      retentionD7: null,
    };
    const out = computeAarrrFromRows([row])!;
    expect(out.stages[1]!.n_passing).toBe(0); // 0 < 30
    expect(out.stages[4]!.n_passing).toBe(0);
  });

  it('flagged rows do not appear in any stage total', () => {
    const out = computeAarrrFromRows([
      baseRow(),
      baseRow({ isFlagged: true }),
      baseRow({ isFlagged: true }),
    ])!;
    expect(out.total_personas).toBe(1);
    expect(out.stages[0]!.total).toBe(1);
  });

  it('cumulative — passing referral implies passing all earlier stages', () => {
    // A row that passes referral threshold (happiness >= 60) but
    // FAILS retention (retention_d7 = 0) must be dropped at retention
    // and not resurface for referral.
    const row = baseRow({
      taskSuccess: 50,
      retentionD7: 0, // < 30 — dies at retention
      happiness: 70, // would pass referral if it got there
      adoption: 70,
    });
    const out = computeAarrrFromRows([row])!;
    expect(out.stages[1]!.n_passing).toBe(1); // activation pass
    expect(out.stages[2]!.n_passing).toBe(0); // retention drops
    expect(out.stages[3]!.n_passing).toBe(0); // referral cannot exceed retention
    expect(out.stages[4]!.n_passing).toBe(0);
  });
});

// ───────────────── assembleFrictionClusters ─────────────────

const item = (cohortId: string, friction: string): FrictionInputItem => ({
  cohortId,
  friction,
});

describe('assembleFrictionClusters', () => {
  it('returns [] when there are no input items', () => {
    expect(assembleFrictionClusters([], [])).toEqual([]);
  });

  it('ranks clusters by descending n and assigns sequential ranks', () => {
    const items = [
      item('crypto_native', 'a'),
      item('crypto_native', 'b'),
      item('senior', 'c'),
    ];
    const parsed: FrictionLLMCluster[] = [
      {
        title: 'Small',
        summary: '.',
        where: 'X',
        representative_quote: 'c',
        persona_indices: [2],
      },
      {
        title: 'Big',
        summary: '.',
        where: 'Y',
        representative_quote: 'a',
        persona_indices: [0, 1],
      },
    ];
    const out = assembleFrictionClusters(items, parsed);
    expect(out[0]!.title).toBe('Big');
    expect(out[0]!.rank).toBe(1);
    expect(out[1]!.title).toBe('Small');
    expect(out[1]!.rank).toBe(2);
  });

  it('appends Other / long-tail when LLM left some indices unassigned', () => {
    const items = [
      item('crypto_native', 'a'),
      item('senior', 'b'),
      item('senior', 'c'), // unassigned
    ];
    const parsed: FrictionLLMCluster[] = [
      {
        title: 'Wallet',
        summary: '.',
        where: 'X',
        representative_quote: 'a',
        persona_indices: [0, 1],
      },
    ];
    const out = assembleFrictionClusters(items, parsed);
    expect(out).toHaveLength(2);
    expect(out[1]!.title).toBe('Other / long-tail frictions');
    expect(out[1]!.n).toBe(1);
    expect(out[1]!.quote).toBe('c');
  });

  it('skips Other bucket when every input was assigned', () => {
    const items = [item('crypto_native', 'a'), item('senior', 'b')];
    const parsed: FrictionLLMCluster[] = [
      {
        title: 'All',
        summary: '.',
        where: 'X',
        representative_quote: 'a',
        persona_indices: [0, 1],
      },
    ];
    const out = assembleFrictionClusters(items, parsed);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('All');
  });

  it('Other bucket is appended even past the top-5 cap', () => {
    // 6 named clusters of 2 items each (12) + 1 unassigned item (13).
    const items: FrictionInputItem[] = Array.from({ length: 13 }, (_, i) =>
      item('crypto_native', `f${i}`),
    );
    const parsed: FrictionLLMCluster[] = Array.from({ length: 6 }, (_, k) => ({
      title: `C${k}`,
      summary: '.',
      where: 'X',
      representative_quote: items[k * 2]!.friction,
      persona_indices: [k * 2, k * 2 + 1],
    }));
    // items[12] is unassigned.
    const out = assembleFrictionClusters(items, parsed);
    // Top-5 cap applied to named clusters → 5 named + 1 long-tail.
    expect(out).toHaveLength(6);
    const titles = out.map((c) => c.title);
    expect(titles).toContain('Other / long-tail frictions');
    const longTail = out.find(
      (c) => c.title === 'Other / long-tail frictions',
    )!;
    expect(longTail.n).toBe(1);
  });

  it('cluster n sum + long-tail equals input items.length', () => {
    const items: FrictionInputItem[] = Array.from({ length: 10 }, (_, i) =>
      item('senior', `f${i}`),
    );
    const parsed: FrictionLLMCluster[] = [
      {
        title: 'A',
        summary: '.',
        where: 'X',
        representative_quote: 'f0',
        persona_indices: [0, 1, 2],
      },
      {
        title: 'B',
        summary: '.',
        where: 'X',
        representative_quote: 'f3',
        persona_indices: [3, 4],
      },
    ];
    const out = assembleFrictionClusters(items, parsed);
    const total = out.reduce((s, c) => s + c.n, 0);
    expect(total).toBe(items.length); // 5 assigned + 5 long-tail = 10
  });

  it('ignores invalid persona_indices (out of range)', () => {
    const items = [item('crypto_native', 'a'), item('senior', 'b')];
    const parsed: FrictionLLMCluster[] = [
      {
        title: 'Bad',
        summary: '.',
        where: 'X',
        representative_quote: 'a',
        persona_indices: [99, 100], // both invalid
      },
    ];
    const out = assembleFrictionClusters(items, parsed);
    // Named cluster filtered out (n=0). All items go to long-tail.
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Other / long-tail frictions');
    expect(out[0]!.n).toBe(2);
  });
});
