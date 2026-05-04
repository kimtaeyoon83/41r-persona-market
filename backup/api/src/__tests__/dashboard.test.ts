import { describe, it, expect } from 'vitest';
import {
  timeAgo,
  shortenUrl,
  tierFromTestsDone,
  dayBucket,
  spark7,
  spark7Avg,
  spark7Cumulative,
  countInWindow,
  sumInWindow,
  avgInWindow,
  formatCountDelta,
  formatSumDelta,
  formatAvgDelta,
} from '../services/dashboard.js';

describe('dashboard/timeAgo', () => {
  const now = new Date('2026-04-23T05:00:00Z');

  it('formats seconds under a minute', () => {
    expect(timeAgo(new Date('2026-04-23T04:59:30Z'), now)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(timeAgo(new Date('2026-04-23T04:45:00Z'), now)).toBe('15m');
  });

  it('formats hours', () => {
    expect(timeAgo(new Date('2026-04-23T02:00:00Z'), now)).toBe('3h');
  });

  it('formats days', () => {
    expect(timeAgo(new Date('2026-04-21T05:00:00Z'), now)).toBe('2d');
  });

  it('formats weeks', () => {
    expect(timeAgo(new Date('2026-04-09T05:00:00Z'), now)).toBe('2w');
  });

  it('handles null', () => {
    expect(timeAgo(null, now)).toBe('—');
  });

  it('clamps future dates to 0s', () => {
    expect(timeAgo(new Date('2026-04-23T05:01:00Z'), now)).toBe('0s');
  });
});

describe('dashboard/shortenUrl', () => {
  it('strips www.', () => {
    expect(shortenUrl('https://www.vercel.com/')).toBe('vercel.com');
  });

  it('keeps path when present', () => {
    expect(shortenUrl('https://vercel.com/pricing')).toBe('vercel.com/pricing');
  });

  it('drops bare /', () => {
    expect(shortenUrl('https://vercel.com/')).toBe('vercel.com');
  });

  it('passes through invalid URLs unchanged', () => {
    expect(shortenUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('dashboard/dayBucket', () => {
  const ref = new Date('2026-04-23T12:00:00Z');

  it('0 for same UTC day', () => {
    expect(dayBucket(new Date('2026-04-23T00:01:00Z'), ref)).toBe(0);
    expect(dayBucket(new Date('2026-04-23T23:59:00Z'), ref)).toBe(0);
  });

  it('1 for yesterday', () => {
    expect(dayBucket(new Date('2026-04-22T12:00:00Z'), ref)).toBe(1);
  });

  it('6 for six days ago (edge)', () => {
    expect(dayBucket(new Date('2026-04-17T12:00:00Z'), ref)).toBe(6);
  });

  it('-1 for older than 7 days', () => {
    expect(dayBucket(new Date('2026-04-16T23:59:00Z'), ref)).toBe(-1);
  });

  it('-1 for null', () => {
    expect(dayBucket(null, ref)).toBe(-1);
  });

  it('-1 for future date', () => {
    expect(dayBucket(new Date('2026-04-24T00:00:00Z'), ref)).toBe(-1);
  });
});

describe('dashboard/spark7', () => {
  const ref = new Date('2026-04-23T12:00:00Z');

  it('counts events per day, chronological (today last)', () => {
    const items = [
      { at: new Date('2026-04-23T10:00:00Z') }, // today
      { at: new Date('2026-04-23T11:00:00Z') }, // today
      { at: new Date('2026-04-22T10:00:00Z') }, // 1d ago
      { at: new Date('2026-04-17T10:00:00Z') }, // 6d ago
      { at: new Date('2026-04-10T10:00:00Z') }, // older, dropped
    ];
    const result = spark7(items, (i) => i.at, () => 1, ref);
    // index 0 = 6 days ago, index 6 = today
    expect(result).toEqual([1, 0, 0, 0, 0, 1, 2]);
  });

  it('returns all zeros for empty input', () => {
    expect(spark7([], () => null, () => 1, ref)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('can sum a numeric value instead of counting', () => {
    const items = [
      { at: new Date('2026-04-23T10:00:00Z'), amt: 5 },
      { at: new Date('2026-04-23T11:00:00Z'), amt: 3 },
    ];
    const result = spark7(items, (i) => i.at, (i) => i.amt, ref);
    expect(result[6]).toBe(8);
  });
});

describe('dashboard/spark7Avg', () => {
  const ref = new Date('2026-04-23T12:00:00Z');

  it('computes per-day average, 0 when bucket empty', () => {
    const items = [
      { at: new Date('2026-04-23T10:00:00Z'), q: 4 },
      { at: new Date('2026-04-23T11:00:00Z'), q: 5 },
      { at: new Date('2026-04-22T10:00:00Z'), q: 3 },
    ];
    const result = spark7Avg(items, (i) => i.at, (i) => i.q, ref);
    expect(result[6]).toBe(4.5); // today avg (4+5)/2
    expect(result[5]).toBe(3);   // yesterday avg
    expect(result[0]).toBe(0);   // 6d ago — no data
  });
});

describe('dashboard/spark7Cumulative', () => {
  const ref = new Date('2026-04-23T12:00:00Z');

  it('runs a monotonic sum starting from baseline', () => {
    const items = [
      { at: new Date('2026-04-22T10:00:00Z') }, // 1d ago
      { at: new Date('2026-04-23T10:00:00Z') }, // today
      { at: new Date('2026-04-23T11:00:00Z') }, // today
    ];
    const result = spark7Cumulative(items, (i) => i.at, 10, ref);
    // baseline 10 → +0 six days ago … +0 … +0 … +0 … +1 yesterday … +2 today
    expect(result).toEqual([10, 10, 10, 10, 10, 11, 13]);
  });
});

describe('dashboard/countInWindow', () => {
  const ref = new Date('2026-04-23T12:00:00Z');
  const items = [
    { at: new Date('2026-04-23T10:00:00Z') }, // today (day 0)
    { at: new Date('2026-04-22T10:00:00Z') }, // 1d ago
    { at: new Date('2026-04-17T10:00:00Z') }, // 6d ago
    { at: new Date('2026-04-16T10:00:00Z') }, // 7d ago
    { at: new Date('2026-04-10T10:00:00Z') }, // 13d ago
    { at: new Date('2026-04-09T10:00:00Z') }, // 14d ago — dropped
  ];

  it('counts events in current 7-day window (0..6 days ago)', () => {
    expect(countInWindow(items, (i) => i.at, 6, 0, ref)).toBe(3); // today, 1d, 6d
  });

  it('counts events in prior 7-day window (7..13 days ago)', () => {
    expect(countInWindow(items, (i) => i.at, 13, 7, ref)).toBe(2); // 7d, 13d
  });

  it('returns 0 for empty array', () => {
    expect(countInWindow([], (i: { at: Date }) => i.at, 6, 0, ref)).toBe(0);
  });
});

describe('dashboard/sumInWindow', () => {
  const ref = new Date('2026-04-23T12:00:00Z');

  it('sums numeric values in the window', () => {
    const items = [
      { at: new Date('2026-04-23T10:00:00Z'), amt: 10 }, // today
      { at: new Date('2026-04-22T10:00:00Z'), amt: 5 },  // 1d
      { at: new Date('2026-04-10T10:00:00Z'), amt: 99 }, // 13d — outside 0..6
    ];
    expect(sumInWindow(items, (i) => i.at, (i) => i.amt, 6, 0, ref)).toBe(15);
  });
});

describe('dashboard/avgInWindow', () => {
  const ref = new Date('2026-04-23T12:00:00Z');

  it('averages values in the window', () => {
    const items = [
      { at: new Date('2026-04-23T10:00:00Z'), q: 4 },
      { at: new Date('2026-04-22T10:00:00Z'), q: 5 },
    ];
    expect(avgInWindow(items, (i) => i.at, (i) => i.q, 6, 0, ref)).toBe(4.5);
  });

  it('returns null when no samples', () => {
    expect(avgInWindow([], (i: { at: Date }) => i.at, (_i: { at: Date }) => 0, 6, 0, ref)).toBe(null);
  });
});

describe('dashboard/formatCountDelta', () => {
  it('positive diff', () => {
    expect(formatCountDelta(5, 3)).toBe('+2 this week');
  });

  it('negative diff', () => {
    expect(formatCountDelta(2, 5)).toBe('-3 this week');
  });

  it('zero diff on non-empty period', () => {
    expect(formatCountDelta(4, 4)).toBe('+0 this week');
  });

  it('new when prior empty', () => {
    expect(formatCountDelta(3, 0)).toBe('+3 this week (new)');
  });

  it('no activity when both zero', () => {
    expect(formatCountDelta(0, 0)).toBe('no activity this week');
  });
});

describe('dashboard/formatSumDelta', () => {
  it('signs and rounds the diff', () => {
    expect(formatSumDelta(125, 100, 'USDC')).toBe('+25.00 USDC this week');
  });

  it('new when prior zero', () => {
    expect(formatSumDelta(50, 0, 'USDC')).toBe('+50.00 USDC this week (new)');
  });

  it('both zero → no flow', () => {
    expect(formatSumDelta(0, 0)).toBe('no flow this week');
  });
});

describe('dashboard/formatAvgDelta', () => {
  it('diff between avgs', () => {
    expect(formatAvgDelta(4.2, 3.9)).toBe('+0.30 vs last wk');
  });

  it('avg only this week when no prior', () => {
    expect(formatAvgDelta(4.2, null)).toBe('avg 4.20 this week');
  });

  it('no samples when both null', () => {
    expect(formatAvgDelta(null, null)).toBe('no samples this week');
  });
});

describe('dashboard/tierFromTestsDone', () => {
  it('L1 for under 3', () => {
    expect(tierFromTestsDone(0)).toBe('L1');
    expect(tierFromTestsDone(2)).toBe('L1');
  });

  it('L2 for 3-5', () => {
    expect(tierFromTestsDone(3)).toBe('L2');
    expect(tierFromTestsDone(5)).toBe('L2');
  });

  it('L3 for 6-10', () => {
    expect(tierFromTestsDone(6)).toBe('L3');
    expect(tierFromTestsDone(10)).toBe('L3');
  });

  it('L4 for 11+', () => {
    expect(tierFromTestsDone(11)).toBe('L4');
    expect(tierFromTestsDone(99)).toBe('L4');
  });
});
