import { describe, it, expect } from 'vitest';
import {
  generateStructuredReport,
  _internal,
} from '../services/scoring/report.js';

// Port of apps/persona-engine/tests/test_report_generator.py offline +
// helper-function invariants.

describe('generateStructuredReport (offline)', () => {
  it('useLlm=false returns skeleton', async () => {
    const r = await generateStructuredReport({
      sessionLog: { session_id: 's_abc' },
      personaId: 'p1',
      useLlm: false,
    });
    expect(r.pain_points).toEqual([]);
    expect(r.ux_scores.overall).toBe(0);
    expect(r.session_id).toBe('s_abc');
    expect(r.persona_id).toBe('p1');
  });
});

describe('helpers', () => {
  const { clamp01, parsePainPoint, strList } = _internal;

  it('clamp01 bounds', () => {
    expect(clamp01(-1.0)).toBe(0.0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2.0)).toBe(1.0);
    expect(clamp01('not a number')).toBe(0.0);
    expect(clamp01(null)).toBe(0.0);
    expect(clamp01(undefined)).toBe(0.0);
  });

  it('parsePainPoint requires description', () => {
    expect(parsePainPoint({ severity: 'high', description: '' })).toBeNull();
    expect(parsePainPoint({ severity: 'high' })).toBeNull();
    expect(parsePainPoint(null)).toBeNull();
    expect(parsePainPoint('not obj')).toBeNull();
  });

  it('parsePainPoint valid', () => {
    const p = parsePainPoint({
      severity: 'high',
      description: 'broken nav',
      evidence_turn: 2,
    });
    expect(p).toEqual({ severity: 'high', description: 'broken nav', evidence_turn: 2 });
  });

  it('unknown severity becomes low', () => {
    const p = parsePainPoint({ severity: 'critical', description: 'x' });
    expect(p?.severity).toBe('low');
  });

  it('strList strips and caps', () => {
    expect(strList(['  a  ', '', 'b'], 5)).toEqual(['a', 'b']);
    expect(strList(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(strList('not an array')).toEqual([]);
  });
});
