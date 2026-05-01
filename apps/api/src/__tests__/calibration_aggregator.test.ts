// Contract tests for the calibration aggregator.
// Locks: Pearson correlation math, n<3 guard, zero-variance guard,
// confidence-band thresholds, delta formatting, source-track counts.

import { describe, expect, it } from 'vitest';
import {
  aggregateCalibration,
  pearson,
  type CalibrationRecord,
} from '../services/calibration/aggregator';

function mkRec(
  dim: string,
  llm: number,
  gt: number,
  source: 'stagehand' | 'human_baseline' | 'analytics' = 'stagehand',
): CalibrationRecord {
  return {
    date: '2026-04-15',
    siteUrl: 'https://test.example.com',
    personaId: null,
    dimension: dim,
    llmInference: llm,
    groundTruth: gt,
    delta: gt - llm,
    source,
  };
}

describe('pearson', () => {
  it('returns null for n<3', () => {
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([], [])).toBeNull();
  });

  it('returns 1 for perfectly linear positive', () => {
    const r = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r).toBeCloseTo(1, 6);
  });

  it('returns -1 for perfectly linear negative', () => {
    const r = pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(r).toBeCloseTo(-1, 6);
  });

  it('returns null when x has zero variance', () => {
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
  });

  it('returns null when y has zero variance', () => {
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
  });

  it('throws on length mismatch', () => {
    expect(() => pearson([1, 2, 3], [1, 2])).toThrow();
  });

  it('weak correlation produces small r', () => {
    const r = pearson([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
    expect(r).not.toBeNull();
    expect(Math.abs(r!)).toBeLessThan(0.5);
  });
});

describe('aggregateCalibration', () => {
  it('empty records → all dimensions null with n=0', () => {
    const out = aggregateCalibration([]);
    expect(out.totalRecords).toBe(0);
    for (const c of out.correlations) {
      expect(c.correlation).toBeNull();
      expect(c.n).toBe(0);
      expect(c.confidence).toBe('n/a');
    }
  });

  it('returns 5 dimensions in canonical order', () => {
    const out = aggregateCalibration([]);
    expect(out.correlations.map((c) => c.dimension)).toEqual([
      'Engagement',
      'Task Success',
      'Happiness',
      'Adoption',
      'Retention',
    ]);
  });

  it('high-confidence dimension classified High', () => {
    const records: CalibrationRecord[] = [];
    for (let i = 0; i < 10; i++) {
      records.push(mkRec('engagement', i * 10, i * 10 + 2));
    }
    const out = aggregateCalibration(records);
    const eng = out.correlations.find((c) => c.dimension === 'Engagement')!;
    expect(eng.correlation).toBeGreaterThan(0.95);
    expect(eng.confidence).toBe('High');
    expect(eng.n).toBe(10);
  });

  it('weak-correlation dimension classified Low/Low-Medium', () => {
    // Constructed via noise — llm series rises monotonically while
    // gt is nearly constant with small jitter. |r| should be small.
    const records: CalibrationRecord[] = [
      mkRec('retention', 10, 50),
      mkRec('retention', 20, 48),
      mkRec('retention', 30, 51),
      mkRec('retention', 40, 49),
      mkRec('retention', 50, 52),
      mkRec('retention', 60, 50),
    ];
    const out = aggregateCalibration(records);
    const ret = out.correlations.find((c) => c.dimension === 'Retention')!;
    expect(ret.n).toBe(6);
    expect(['Low', 'Low-Medium']).toContain(ret.confidence);
  });

  it('counts records per source track', () => {
    const records: CalibrationRecord[] = [
      mkRec('engagement', 50, 55, 'stagehand'),
      mkRec('engagement', 60, 65, 'stagehand'),
      mkRec('happiness', 70, 75, 'human_baseline'),
      mkRec('adoption', 40, 45, 'analytics'),
      mkRec('adoption', 30, 35, 'analytics'),
    ];
    const out = aggregateCalibration(records);
    const stagehand = out.tracks.find((t) => t.source === 'stagehand')!;
    const human = out.tracks.find((t) => t.source === 'human_baseline')!;
    const analytics = out.tracks.find((t) => t.source === 'analytics')!;
    expect(stagehand.n).toBe(2);
    expect(human.n).toBe(1);
    expect(analytics.n).toBe(2);
    expect(out.totalRecords).toBe(5);
  });

  it('change column reflects delta from prior period', () => {
    const curr: CalibrationRecord[] = Array.from({ length: 8 }, (_, i) =>
      mkRec('engagement', i * 10, i * 10 + 1),
    );
    const prior: CalibrationRecord[] = [
      mkRec('engagement', 10, 50),
      mkRec('engagement', 20, 30),
      mkRec('engagement', 30, 70),
      mkRec('engagement', 40, 20),
      mkRec('engagement', 50, 60),
    ];
    const out = aggregateCalibration(curr, prior);
    const eng = out.correlations.find((c) => c.dimension === 'Engagement')!;
    expect(eng.change.startsWith('+')).toBe(true);
  });

  it('change is — when prior has insufficient samples', () => {
    const curr: CalibrationRecord[] = Array.from({ length: 8 }, (_, i) =>
      mkRec('happiness', i * 10, i * 10 + 1),
    );
    const out = aggregateCalibration(curr, [mkRec('happiness', 1, 2)]);
    const hap = out.correlations.find((c) => c.dimension === 'Happiness')!;
    expect(hap.change).toBe('—');
  });

  it('exposes default version timeline (4 versions, current=v1.3)', () => {
    const out = aggregateCalibration([]);
    expect(out.versions.length).toBe(4);
    const current = out.versions.find((v) => v.current);
    expect(current?.v).toBe('v1.3');
    for (const v of out.versions) {
      const sum = v.hap + v.eng + v.tsk + v.ado + v.ret;
      expect(sum).toBeCloseTo(1, 2);
    }
  });
});
