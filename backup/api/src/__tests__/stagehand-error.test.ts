import { describe, expect, it } from 'vitest';
import {
  captureSessionError,
  type SessionErrorInfo,
} from '../services/stagehand_hybrid.js';

// Currently when stagehand crashes mid-run, the catch block console.warns
// the message and discards it. Without persistence we can't RCA the 70%
// failure rate observed on jup.ag. captureSessionError is the small pure
// helper the catch sites call to produce a sentinel-shaped record that
// the route handler then writes into questionnaireAnswers as
// `_session_error` — same pattern as `_quirks` / `_quality_breakdown`.

describe('captureSessionError', () => {
  it('extracts message + stack snippet from a real Error', () => {
    const e = new Error('act("Click wallet button") failed: TimeoutError');
    const out: SessionErrorInfo = captureSessionError(e, 'phase_c', 'Click wallet button');
    expect(out.message).toBe('act("Click wallet button") failed: TimeoutError');
    expect(out.phase).toBe('phase_c');
    expect(out.last_action).toBe('Click wallet button');
    expect(out.stack).toBeDefined();
    // Stack must be capped — we don't want a 50KB v8 trace per row.
    expect((out.stack ?? '').length).toBeLessThanOrEqual(2000);
  });

  it('handles a non-Error throw (string, number) without crashing', () => {
    expect(captureSessionError('plain string', 'init').message).toBe('plain string');
    expect(captureSessionError(42, 'init').message).toBe('42');
    expect(captureSessionError(null, 'init').message).toBe('null');
    expect(captureSessionError(undefined, 'init').message).toBe('undefined');
  });

  it('caps long error messages so the row stays bounded', () => {
    const huge = 'x'.repeat(10_000);
    const out = captureSessionError(new Error(huge), 'phase_a');
    expect(out.message.length).toBeLessThanOrEqual(2000);
  });

  it('omits last_action when none was attempted (e.g. init failure)', () => {
    const out = captureSessionError(new Error('Stagehand init failed'), 'init');
    expect(out.last_action).toBeUndefined();
    expect(out.phase).toBe('init');
  });

  it('truncates extremely long last_action values', () => {
    const longAction = 'a'.repeat(2000);
    const out = captureSessionError(new Error('boom'), 'phase_d', longAction);
    expect((out.last_action ?? '').length).toBeLessThanOrEqual(500);
  });

  it('phase is preserved verbatim — used for grouping in RCA queries', () => {
    for (const phase of ['init', 'phase_a', 'phase_b', 'phase_c', 'phase_d', 'final', 'cleanup']) {
      const out = captureSessionError(new Error('x'), phase);
      expect(out.phase).toBe(phase);
    }
  });
});
