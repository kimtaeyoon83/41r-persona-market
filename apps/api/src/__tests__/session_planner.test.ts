import { describe, expect, it } from 'vitest';
import {
  planSession,
  SessionPlanError,
  type SessionRequest,
} from '../services/session/planner.js';

const base: SessionRequest = {
  source: 'user',
  targetUrl: 'https://example.com',
  tier: 'T1',
  mode: 'capture_react',
};

const GATE_OPEN = { thinkAloudGatePassed: true };
const GATE_SHUT = { thinkAloudGatePassed: false };

describe('planSession — trigger is independent of tier/mode', () => {
  it('accepts both user- and server-triggered capture_react sessions identically', () => {
    for (const source of ['user', 'campaign', 'cron'] as const) {
      const plan = planSession({ ...base, source }, GATE_SHUT);
      expect(plan.source).toBe(source);
      expect(plan.summary).toContain(`${source}-triggered`);
    }
  });

  it('a user-triggered session may run in the platform sandbox (T1)', () => {
    expect(planSession({ ...base, source: 'user', tier: 'T1' }, GATE_SHUT).tier).toBe('T1');
  });

  it('a campaign-triggered session may run on the user device (T0)', () => {
    expect(planSession({ ...base, source: 'campaign', tier: 'T0' }, GATE_SHUT).tier).toBe('T0');
  });
});

describe('planSession — Mode C gate (§11)', () => {
  it('rejects autonomous mode until the think-aloud gate passes — for ANY trigger', () => {
    for (const source of ['user', 'campaign', 'cron'] as const) {
      try {
        planSession({ ...base, source, mode: 'autonomous' }, GATE_SHUT);
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionPlanError);
        expect((e as SessionPlanError).code).toBe('mode_c_gated');
      }
    }
  });

  it('allows autonomous once the gate is open', () => {
    expect(planSession({ ...base, mode: 'autonomous' }, GATE_OPEN).mode).toBe('autonomous');
  });
});

describe('planSession — secret asset requires sandbox (§4.5.3)', () => {
  it('rejects a sealed-asset session on T0', () => {
    try {
      planSession({ ...base, tier: 'T0', secretAsset: true }, GATE_OPEN);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SessionPlanError);
      expect((e as SessionPlanError).code).toBe('secret_requires_sandbox');
    }
  });

  it('allows a sealed-asset session on T1 / T2', () => {
    expect(planSession({ ...base, tier: 'T1', secretAsset: true }, GATE_OPEN).secretAsset).toBe(true);
    expect(planSession({ ...base, tier: 'T2', secretAsset: true }, GATE_OPEN).secretAsset).toBe(true);
  });
});
